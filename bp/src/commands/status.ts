import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { bool, flag, type Args } from '../core/args.ts';
import { EXIT, halt, type ExitCode } from '../core/errors.ts';
import { listDir, readTextIfExists } from '../core/fsx.ts';
import { isRecord } from '../core/schema.ts';
import type { Ctx } from '../context.ts';
import { statusReport } from '../checks/status.ts';
import { parseLog } from '../log/parse.ts';
import { recordPaths } from '../log/entry.ts';
import { preflight } from '../preflight.ts';
import { renderStatus } from '../render/status-screen.ts';
import { readLocal } from '../target/local.ts';
import { NOT_SET_UP } from '../target/relay.ts';
import { runPull, statusPullPath } from '../target/relay-cli.ts';
import type { Snapshot } from '../snapshot.ts';

// `bp status` — status.md end to end: S1 read, S2 checks, S3 one screen. It writes nothing in the working folder, ever.

/** The web URL of a repository's origin remote, where it has one a reader can open (doc-shape §3 Operating). */
export function remoteWebUrl(dir: string): string | null {
  const url = git(dir, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url);
  if (ssh?.[1] && ssh[2]) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/.exec(url);
  return https?.[1] ? `https://${https[1]}` : null;
}

/** doc-shape §3's run-log link: `<repo>/blob/<branch>/<home's path in the repo>/record/run-log.md`. */
export function runLogWebUrl(home: string): string | null {
  const root = remoteWebUrl(home);
  if (!root) return null;
  // symbolic-ref names the branch even before its first commit; a detached HEAD has none, and gets the repository root.
  const branch = git(home, ['symbolic-ref', '--short', 'HEAD']);
  const prefix = git(home, ['rev-parse', '--show-prefix']) ?? '';
  if (!branch) return root;
  const blob = /gitlab/i.test(root) ? '-/blob' : 'blob';
  return `${root}/${blob}/${branch}/${prefix}record/run-log.md`;
}

function git(dir: string, argv: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...argv], { stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function barredTerms(current: string): string[] {
  const out: string[] = [];
  for (const run of listDir(join(current, 'sources'))) {
    const raw = readTextIfExists(join(current, 'sources', run, 'barred-terms.json'));
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed.filter((x): x is string => typeof x === 'string'));
      else if (isRecord(parsed) && Array.isArray(parsed['terms']))
        out.push(...(parsed['terms'] as unknown[]).filter((x): x is string => typeof x === 'string'));
    } catch {
      // an unreadable barred-terms file is skipped; C9's reader still reads every field
    }
  }
  return out;
}

export function loadSnapshot(
  ctx: Ctx,
  args: Args,
  current: string,
  target: { kind: 'notion' | 'local'; address: string },
  statePath: string,
): Snapshot | { waiting: string; json: Record<string, unknown> } {
  if (target.kind === 'local') return readLocal(target.address, ctx.clock.now().toISOString());
  const pulled = runPull(ctx, args, statePath, target.address);
  if (pulled.kind === 'waiting') return { waiting: pulled.text, json: pulled.json };
  return pulled.snapshot;
}

export function statusCommand(ctx: Ctx, args: Args): ExitCode {
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
  if (!p.target) throw halt('Where does this Blueprint live? No target.md was found (status S1 halt conditions).');
  const loaded = loadSnapshot(ctx, args, p.current, p.target, statusPullPath(p.current));
  if ('waiting' in loaded) {
    ctx.out(bool(args, 'json') ? JSON.stringify(loaded.json, null, 2) : loaded.waiting);
    return EXIT.waiting;
  }
  const s = loaded;
  if (s.legacyBoard)
    throw halt(
      'a Board database sits beneath the overview — the superseded skill built this Blueprint and this one cannot read it (pre-flight 5). Never migrate it, never delete it; ask for a fresh overview page',
    );
  const unset = s.incomplete.filter((n) => n.includes(NOT_SET_UP));
  if (unset.length) throw halt(`one or both databases are missing:\n  ${unset.join('\n  ')}`);
  if (s.incomplete.length)
    throw halt(
      `the read is incomplete, and a count from a truncated read is a confident wrong answer:\n  ${s.incomplete.join('\n  ')}`,
    );

  const paths = recordPaths(p.current);
  const logText = readTextIfExists(paths.log);
  const log = logText === undefined ? null : parseLog(logText);
  const recordText = [
    ...(logText === undefined ? [] : [{ name: 'record/run-log.md', text: logText }]),
    ...listDir(paths.runsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ name: `record/runs/${f}`, text: readTextIfExists(join(paths.runsDir, f)) ?? '' })),
  ];
  const report = statusReport({
    snapshot: s,
    log,
    recordText,
    barredTerms: barredTerms(p.current),
    today: ctx.clock.now(),
    runLogUrl: runLogWebUrl(p.current),
    projectTitle: flag(args, 'title') ?? basename(p.workspace),
    full: bool(args, 'full'),
  });
  if (bool(args, 'json')) ctx.out(JSON.stringify(report, null, 2));
  else ctx.out(renderStatus(report));
  return report.clean ? EXIT.ok : EXIT.findings;
}
