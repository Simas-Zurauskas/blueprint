import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bool, flag, requireFlag, type Args } from '../core/args.ts';
import { EXIT, usage, type ExitCode } from '../core/errors.ts';
import { listDir, readText, readTextIfExists } from '../core/fsx.ts';
import { blockText, bodyFromWhy, hashBody, hashText, sha12, sha256 } from '../core/hash.ts';
import { must, parseJson, array, object, optional, string } from '../core/schema.ts';
import { quoteCount, quoteFound } from '../core/text.ts';
import { homeOf, type Ctx } from '../context.ts';
import { canonicalCommand, COMMANDS, FEATURE_BLOCKS } from '../domain/vocab.ts';
import { recordPaths } from '../log/entry.ts';
import { parseLog } from '../log/parse.ts';
import { preflight, skillVersion } from '../preflight.ts';
import { renderProgress, ProgressSchema } from '../progress.ts';
import { normaliseId, parseFetch } from '../target/notion.ts';
import { latestCall, readAllToolCalls } from '../target/transcript.ts';
import { transcriptsFor } from '../target/relay-cli.ts';

const readStdin = (): string => readFileSync(0, 'utf8');
const propText = (v: unknown): string => (typeof v === 'string' ? v : '');

function sourceText(args: Args): string {
  const file = flag(args, 'file');
  if (file) return readText(file);
  if (bool(args, 'stdin')) return readStdin();
  throw usage('give the text with --file <path> or --stdin');
}

/** The newest fetch of a page in the session transcript, parsed. */
export function fetchedPage(ctx: Ctx, args: Args, pageId: string) {
  const set = transcriptsFor(ctx, args);
  if (!set) throw usage('no session transcript: CLAUDE_CODE_SESSION_ID is not set', 'pass --transcript <path>');
  const want = normaliseId(pageId);
  const after = flag(args, 'after');
  const call = latestCall(
    readAllToolCalls(set),
    'notion-fetch',
    (input) =>
      typeof input === 'object' &&
      input !== null &&
      'id' in input &&
      typeof input.id === 'string' &&
      normaliseId(input.id) === want,
    after,
  );
  if (!call?.result)
    throw usage(
      `no notion-fetch of ${pageId} with a result in this session's transcript${after ? ` after ${after}` : ''}`,
      'fetch the page first, then run this again',
    );
  if (call.result.isError) throw usage(`the newest fetch of ${pageId} returned an error`);
  const page = parseFetch(call.result.text);
  if (!page) throw usage(`the newest fetch of ${pageId} is not a page fetch bp can read`);
  return { call, page };
}

export function hashCommand(ctx: Ctx, args: Args): ExitCode {
  const sub = args.positionals[1];
  const json = bool(args, 'json');
  const emit = (o: Record<string, unknown>, text: string): void => ctx.out(json ? JSON.stringify(o, null, 2) : text);
  switch (sub) {
    case 'body': {
      const h = hashBody(sourceText(args));
      if (!h) throw usage('no "## Why" line — a body without one has no hash under targets §5 (R2.4 reports it)');
      emit({ sha256: h, sha12: sha12(h) }, sha12(h));
      return EXIT.ok;
    }
    case 'text': {
      const h = hashText(sourceText(args));
      emit({ sha256: h, sha12: sha12(h) }, sha12(h));
      return EXIT.ok;
    }
    case 'file': {
      const path = args.positionals[2] ?? requireFlag(args, 'file');
      const h = sha256(readFileSync(path));
      emit({ path, sha256: h, sha12: sha12(h) }, `${h}  ${path}`);
      return EXIT.ok;
    }
    case 'fetch': {
      const pageId = requireFlag(args, 'page');
      const { call, page } = fetchedPage(ctx, args, pageId);
      const body = bodyFromWhy(page.content);
      const h = hashBody(page.content);
      const blocks: Record<string, string> = {};
      for (const b of FEATURE_BLOCKS) {
        const t = blockText(page.content, b);
        if (t !== undefined) blocks[b] = sha12(hashText(t));
      }
      emit(
        {
          page: page.id,
          fetchedAt: call.result?.timestamp ?? call.timestamp,
          body: h ? { sha256: h, sha12: sha12(h) } : null,
          blocks,
          chars: body?.length ?? 0,
        },
        h
          ? `${sha12(h)}  «${propText(page.properties['Name']) || propText(page.properties['title']) || page.id}» fetched ${call.result?.timestamp ?? call.timestamp}`
          : `no "## Why" in ${page.id} — no body hash (R2.4)`,
      );
      return h ? EXIT.ok : EXIT.findings;
    }
    default:
      throw usage(`unknown "bp hash ${sub ?? ''}"`, 'body | text | file | fetch');
  }
}

const QuoteBatch = array(
  object({
    quote: string({ min: 1 }),
    file: optional(string()),
    page: optional(string()),
    block: optional(string()),
    label: optional(string()),
  }),
);

export function quoteCommand(ctx: Ctx, args: Args): ExitCode {
  if (args.positionals[1] !== 'check') throw usage('bp quote check …');
  const batchPath = flag(args, 'batch');
  const items = batchPath
    ? must(QuoteBatch, parseJson(readText(batchPath), batchPath), 'quote batch')
    : [
        {
          quote: requireFlag(args, 'quote'),
          ...(flag(args, 'file') ? { file: flag(args, 'file') ?? '' } : {}),
          ...(flag(args, 'page') ? { page: flag(args, 'page') ?? '' } : {}),
          ...(flag(args, 'block') ? { block: flag(args, 'block') ?? '' } : {}),
        },
      ];
  const results = items.map((it) => {
    let hay: string;
    let site: string;
    if (it.file) {
      hay = readText(it.file);
      site = it.label ?? it.file;
    } else if (it.page) {
      const { page } = fetchedPage(ctx, args, it.page);
      hay = page.content;
      site = it.label ?? `«${propText(page.properties['Name']) || propText(page.properties['Question']) || page.id}»`;
    } else throw usage('each quote needs a file or a page to be checked against');
    if (it.block) {
      const b = blockText(hay, it.block);
      if (b === undefined) return { ...it, site, matched: false, count: 0, reason: `no "## ${it.block}" block` };
      hay = b;
    }
    const matched = quoteFound(hay, it.quote);
    return {
      ...it,
      site,
      matched,
      count: quoteCount(hay, it.quote),
      line: `citation: ${matched ? 'matched' : 'NOT matched'} ${site}${it.block ? ` «${it.block}»` : ''}`,
    };
  });
  if (bool(args, 'json')) ctx.out(JSON.stringify({ results }, null, 2));
  else
    results.forEach((r) =>
      ctx.out(
        `${r.matched ? 'matched' : 'NOT matched'}  ${r.site}${r.block ? ` · ${r.block}` : ''}  "${r.quote.slice(0, 60)}${r.quote.length > 60 ? '…' : ''}"`,
      ),
    );
  return results.every((r) => r.matched) ? EXIT.ok : EXIT.findings;
}

export function runidCommand(ctx: Ctx, args: Args): ExitCode {
  const home = homeOf(ctx, args);
  const paths = recordPaths(home);
  const taken = new Set<string>();
  const text = readTextIfExists(paths.log);
  if (text) parseLog(text).entries.forEach((e) => taken.add(e.heading.runId));
  listDir(paths.runsDir).forEach((f) => taken.add(f.replace(/\.md$/, '')));
  for (let i = 0; i < 100; i++) {
    const id = ctx.rand.hex(3);
    if (!taken.has(id)) {
      ctx.out(bool(args, 'json') ? JSON.stringify({ runId: id }) : id);
      return EXIT.ok;
    }
  }
  throw usage('could not draw an unused run id in 100 tries');
}

export function progressCommand(ctx: Ctx, args: Args): ExitCode {
  const path = requireFlag(args, 'json-file', 'pass the progress state as --json-file <path> (or - for stdin)');
  const raw = path === '-' ? readStdin() : readText(path);
  const block = renderProgress(must(ProgressSchema, parseJson(raw, path), 'progress state'));
  ctx.out(bool(args, 'json') ? JSON.stringify({ block }) : block);
  return EXIT.ok;
}

export function preflightCommand(ctx: Ctx, args: Args): ExitCode {
  const given = flag(args, 'command');
  const command = given === undefined ? undefined : canonicalCommand(given);
  if (!command) throw usage(`--command is required (${COMMANDS.join(', ')}) — the checks differ by command`);
  if (!(COMMANDS as readonly string[]).includes(command))
    throw usage(`--command must be one of ${COMMANDS.join(', ')}`);
  const ws = flag(args, 'workspace');
  const named = flag(args, 'home');
  const runId = flag(args, 'run');
  const p = preflight({
    workspace: ws ? resolve(ctx.workspace, ws) : ctx.workspace,
    skillRoot: ctx.skillRoot,
    command: command as (typeof COMMANDS)[number], // checked against COMMANDS above
    clock: ctx.clock,
    ...(runId ? { runId } : {}),
    ...(named ? { named } : {}),
  });
  if (bool(args, 'json'))
    ctx.out(JSON.stringify({ ...p, target: p.target ? { ...p.target, raw: undefined } : null }, null, 2));
  else {
    ctx.out(
      `home      ${p.home}${p.current !== p.home ? ` (record now at ${p.current})` : ''} (${p.homeVia})${p.homeNote ? ` — ${p.homeNote}` : ''}`,
    );
    ctx.out(`target    ${p.target ? `${p.target.kind} ${p.target.address}` : 'none recorded'}`);
    ctx.out(
      `version   skill v${p.version.current} · Blueprint stamped ${p.version.stamped === null ? 'none (no log yet)' : `v${p.version.stamped}`} · ${p.version.relation}${p.version.crossed.length ? ` · crosses ${p.version.crossed.map((c) => `v${c.version} (${c.route})`).join(', ')}` : ''}`,
    );
    ctx.out(`ignore    ${p.ignore.detail}`);
    if (p.concurrent.length)
      ctx.out(`open      ${p.concurrent.map((c) => `${c.command} ${c.runId} ${c.date} ${c.time}`).join(', ')}`);
    p.notes.forEach((n) => ctx.out(`note      ${n}`));
    p.halts.forEach((h) => ctx.out(`HALT      ${h}`));
  }
  return p.halts.length ? EXIT.halt : EXIT.ok;
}

export function versionCommand(ctx: Ctx): ExitCode {
  ctx.out(`blueprint skill v${skillVersion(ctx.skillRoot)}`);
  return EXIT.ok;
}
