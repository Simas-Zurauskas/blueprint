import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lstatSync, mkdirSync, rmSync } from 'node:fs';
import { flag, bool, type Args } from '../core/args.ts';
import { sha12, sha256 } from '../core/hash.ts';
import { isNodeError, usage } from '../core/errors.ts';
import type { Ctx } from '../context.ts';
import type { Snapshot } from '../snapshot.ts';
import { loadPull, newPull, savePull, stepPull, toSnapshot, type PullState } from './relay.ts';
import { locateTranscripts, type TranscriptSet } from './transcript.ts';

// Running a relay pull from a command: load or start the machine, step it against the session transcript, and either
// hand back the snapshot or the exact calls still owed (exit code 4, DESIGN.md §7).

export type PullOutcome =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'waiting'; state: PullState; text: string; json: Record<string, unknown> };

const STALE_MS = 30 * 60 * 1000;

/** The session's transcripts, from the injected environment only (never process.env behind the caller's back). */
export function transcriptsFor(ctx: Ctx, args: Args): TranscriptSet | null {
  const explicit = flag(args, 'transcript');
  const sessionId = ctx.env['CLAUDE_CODE_SESSION_ID'];
  const home = ctx.env['HOME'];
  try {
    return locateTranscripts({
      ...(explicit ? { explicit } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(home ? { projectsDir: join(home, '.claude', 'projects') } : {}),
    });
  } catch (err) {
    if (explicit) throw err;
    return null;
  }
}

/**
 * A directory private to this user under the system temp folder: created 0700, and refused unless it is a real directory
 * this user owns that nobody else can write — where the temp folder is shared (/tmp on Linux), a planted state file could
 * otherwise put calls in front of the model or redirect a write through a symlink.
 */
export function privateStateDir(base = tmpdir()): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dir = join(base, `bp-${uid ?? 'user'}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (!isNodeError(err) || err.code !== 'EEXIST') throw err;
  }
  const st = lstatSync(dir);
  if (!st.isDirectory() || (uid !== null && st.uid !== uid) || (st.mode & 0o077) !== 0) {
    throw usage(
      `${dir} is not a directory private to you — bp keeps its status state there and will not use it`,
      `remove ${dir} and run again`,
    );
  }
  return dir;
}

/** Where a pull's state lives: `status` keeps it outside the working folder (it writes nothing there); a run keeps it in cache/. */
export const statusPullPath = (current: string): string =>
  join(privateStateDir(), `status-${sha12(sha256(current))}.json`);

export function runPull(ctx: Ctx, args: Args, statePath: string, overviewId: string): PullOutcome {
  const now = ctx.clock.now();
  const nowIso = now.toISOString();
  // --replay: a finished pull saved earlier (tests, debugging) — no transcript, no calls.
  const replay = flag(args, 'replay');
  if (replay) {
    const saved = loadPull(replay);
    if (!saved) throw usage(`no pull state at ${replay}`);
    if (saved.stage !== 'done') throw usage(`${replay} is a pull that has not finished (stage ${saved.stage})`);
    return { kind: 'snapshot', snapshot: toSnapshot(saved, nowIso) };
  }
  let state = bool(args, 'fresh') ? undefined : loadPull(statePath);
  // A saved pull is resumed only when it is this overview's, this depth's, and issued in the last half hour (never later).
  const age = state ? now.getTime() - Date.parse(state.issuedAt) : NaN;
  if (state && (state.overviewId !== overviewId || state.deep !== bool(args, 'deep') || !(age >= 0 && age <= STALE_MS)))
    state = undefined;
  if (!state) state = newPull(overviewId, nowIso, bool(args, 'deep'));
  const transcripts = transcriptsFor(ctx, args);
  if (!transcripts)
    throw usage(
      'the relay needs the session transcript to read Notion results, and none was found',
      'run inside Claude Code (CLAUDE_CODE_SESSION_ID set), or pass --transcript <path>',
    );
  const { done, outcome } = stepPull(state, transcripts);
  if (done) {
    rmSync(statePath, { force: true });
    return { kind: 'snapshot', snapshot: toSnapshot(state, nowIso) };
  }
  savePull(statePath, state);
  const calls = state.pending.map((p, i) => `  ${i + 1}. ${p.tool}  ${JSON.stringify(p.input)}`);
  const errors = outcome.errors.map((e) => `  ! ${e.key} returned an error: ${e.text.slice(0, 160)}`);
  const text = [
    `WAITING — bp needs ${state.pending.length} Notion call(s) (${state.stage}). Make them with the Notion connector, at most 3 in flight,`,
    'passing each input exactly as written, then run the same bp command again:',
    ...calls,
    ...(errors.length ? ['', 'Errors on the last attempt (make the call again):', ...errors] : []),
  ].join('\n');
  return {
    kind: 'waiting',
    state,
    text,
    json: {
      status: 'waiting',
      stage: state.stage,
      calls: state.pending.map((p) => ({ tool: p.tool, input: p.input })),
      errors: outcome.errors,
    },
  };
}
