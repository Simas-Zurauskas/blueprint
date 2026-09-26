import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { bool, flag, oneOfFlag, type Args } from '../core/args.ts';
import { EXIT, halt, isNodeError, usage, type ExitCode } from '../core/errors.ts';
import { writeTextAtomic } from '../core/fsx.ts';
import type { Ctx } from '../context.ts';
import { preflight } from '../preflight.ts';
import { FORMATS, renderHtml, renderJson, renderMarkdown, renderPacket, renderText } from '../render/prd.ts';
import { statusPullPath } from '../target/relay-cli.ts';
import { loadSnapshot } from './status.ts';

// `bp render` — the human-readable Blueprint (md | txt | json | html), one feature, or a build packet. Reads the target
// the same way `status` does and writes nothing unless --out names a file.

export function renderCommand(ctx: Ctx, args: Args): ExitCode {
  const format = oneOfFlag(args, 'format', FORMATS) ?? 'md';
  const questions = oneOfFlag(args, 'questions', ['open', 'all', 'none'] as const) ?? 'open';
  const ws = flag(args, 'workspace');
  const named = flag(args, 'home');
  const p = preflight({
    workspace: ws ? resolve(ctx.workspace, ws) : ctx.workspace,
    skillRoot: ctx.skillRoot,
    command: 'status',
    clock: ctx.clock,
    ...(named ? { named } : {}),
  });
  if (p.halts.length) throw halt(p.halts.join('\n'));
  if (!p.target) throw halt('Where does this Blueprint live? No target.md was found.');
  const loaded = loadSnapshot(ctx, args, p.current, p.target, statusPullPath(p.current));
  if ('waiting' in loaded) {
    ctx.out(bool(args, 'json') ? JSON.stringify(loaded.json, null, 2) : loaded.waiting);
    return EXIT.waiting;
  }
  if (loaded.incomplete.length)
    throw halt(`the read is incomplete — a partial document is not rendered:\n  ${loaded.incomplete.join('\n  ')}`);
  const title = flag(args, 'title') ?? basename(p.workspace);
  const feature = flag(args, 'feature');
  const packet = flag(args, 'packet');
  let out: string;
  try {
    if (packet) out = renderPacket(loaded, packet);
    else if (format === 'json') out = renderJson(loaded, { title, questions, ...(feature ? { feature } : {}) });
    else {
      const md = renderMarkdown(loaded, {
        title,
        questions,
        provenance: bool(args, 'provenance'),
        ...(feature ? { feature } : {}),
      });
      out = format === 'md' ? md : format === 'txt' ? renderText(md) : renderHtml(md, `${title} — product definition`);
    }
  } catch (err) {
    if (err instanceof RangeError) throw usage(err.message);
    throw err;
  }
  const dest = flag(args, 'out');
  if (dest) {
    const path = resolve(ctx.workspace, dest);
    // Compared on real paths, case-folded where the filesystem folds case: a symlink, the /tmp alias or a different case
    // never reaches the record or a local Blueprint's own document.
    const real = canonical(path);
    const guarded = [canonical(p.current), ...(p.target.kind === 'local' ? [canonical(p.target.address)] : [])];
    if (guarded.some((root) => within(real, root)))
      throw usage(
        '--out may not write inside the working folder or the Blueprint itself — render is a reading view, not the record',
      );
    const st = lstatIfExists(path);
    if (st?.isDirectory()) throw usage(`--out names a folder (${path}) — name the file to write`);
    if (st?.isSymbolicLink()) throw usage(`--out names a symbolic link (${path}) — name a plain file`);
    writeTextAtomic(path, out);
    ctx.out(`wrote ${path} (${out.length} characters, ${format}${packet ? ', build packet' : ''})`);
  } else ctx.out(out.replace(/\n$/, ''));
  return EXIT.ok;
}

/** A path with its nearest existing ancestor resolved through every symlink — the file it would really land in. */
function canonical(path: string): string {
  const rest: string[] = [];
  let at = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(at), ...rest.reverse());
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
      const up = dirname(at);
      if (up === at) return resolve(path);
      rest.push(at.slice(up.length + (up.endsWith(sep) ? 0 : 1)));
      at = up;
    }
  }
}

const FOLDS_CASE = process.platform === 'darwin' || process.platform === 'win32';

function within(path: string, root: string): boolean {
  const [a, r] = FOLDS_CASE ? [path.toLowerCase(), root.toLowerCase()] : [path, root];
  return a === r || a.startsWith(r.endsWith(sep) ? r : `${r}${sep}`);
}

function lstatIfExists(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return undefined;
    throw err;
  }
}
