import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exists, isDirectory, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { halt, isNodeError, usage } from '../core/errors.ts';
import { kindsFor, RUNS_ONLY_KINDS, type LogKind, type WriteCommand, type Mode } from '../domain/vocab.ts';
import { entryState, kindOf, parseHeading, parseLog, type ParsedEntry, type ParsedLog } from './parse.ts';

// Writing the run log. It is append-only and newest-first (SKILL.md; targets §1 operation 7): a new entry goes directly
// above the newest one, a new line goes at the end of the run's own open entry, and no byte outside the entry being
// written ever changes. Every read-modify-write holds an exclusive lock file (so two bp processes cannot interleave),
// and re-reads the file under the lock (so an editor's save in between is caught rather than overwritten).

export const LOG_PREAMBLE = (title: string): string =>
  `# Run log — «${title}» Blueprint\n\nAppend-only, newest entry first. Never rewritten, never summarised away.\n\n---\n\n`;

export interface RecordPaths {
  home: string;
  log: string;
  runsDir: string;
}

export const recordPaths = (home: string): RecordPaths => ({
  home,
  log: join(home, 'record', 'run-log.md'),
  runsDir: join(home, 'record', 'runs'),
});

/** A run id: six lowercase hex characters (bp's), or an earlier run's word-and-hyphen id. Never a space, a `·` or a newline. */
export const RUN_ID = /^[0-9a-z][\w-]{2,40}$/;

export interface HeaderFields {
  date: string;
  time: string;
  command: WriteCommand;
  runId: string;
  version: number;
  sitting: number;
  mode?: Mode;
  /** Free tokens appended to the header line: queue, sources, resumes… */
  extra?: string;
}

export function headingLine(h: HeaderFields): string {
  return `## ${h.date} · ${h.time} · ${h.command} · run ${h.runId} · skill v${h.version} · sitting ${h.sitting}`;
}

export function headerLine(h: HeaderFields): string {
  const parts = [
    `date ${h.date}`,
    `time ${h.time}`,
    `command ${h.command}`,
    `run ${h.runId}`,
    `version ${h.version}`,
    `sitting ${h.sitting}`,
  ];
  if (h.extra) parts.push(h.extra);
  if (h.mode) parts.push(`mode: ${h.mode}`);
  return `- header: ${parts.join(' · ')}`;
}

/** One log line. "No line is a paragraph" (R5): a line carrying a newline is refused, never silently joined. */
export function formatLine(token: string, text: string): string {
  if (/[\r\n]/.test(text))
    throw usage(
      `a log line is one line (resolve.md R5: "No line is a paragraph") — got a newline in the ${token} line`,
    );
  if (/[\r\n]/.test(token)) throw usage('a log kind token cannot contain a newline');
  if (text.length > 4000)
    throw usage(
      `a ${token} line of ${text.length} characters is a paragraph, not a line — the report carries the account, the log the fact (R5)`,
    );
  const t = text.trim();
  return t.length ? `- ${token}: ${t}` : `- ${token}:`;
}

/** Kinds bp composes itself: `bp log add` refuses them so no model can type what code must compute (rule 7, R5). */
export const COMPUTED_KINDS: ReadonlySet<LogKind> = new Set<LogKind>([
  'header',
  'COUNTS',
  'HASHES',
  'funnel',
  'closing',
]);

/** Validate a token against the closed list for the command. Returns the kind. */
export function admitToken(token: string, command: WriteCommand, opts: { computed?: boolean } = {}): LogKind {
  const { kind, caseMismatch } = kindOf(token);
  if (kind === null)
    throw usage(
      `"${token}" is not a line kind on resolve.md R5's closed list`,
      'a kind not on the list does not go in either file; widen the list with a skill edit and a VERSION bump',
    );
  if (caseMismatch) throw usage(`"${token}" is written with different case from the closed list's "${kind}"`);
  if (!kindsFor(command).has(kind)) throw usage(`"${kind}" is not a kind a ${command} entry admits`);
  if (!opts.computed && COMPUTED_KINDS.has(kind)) {
    const cmd =
      kind === 'COUNTS'
        ? 'bp log counts'
        : kind === 'HASHES'
          ? 'bp log hashes'
          : kind === 'funnel'
            ? 'bp log funnel'
            : kind === 'closing'
              ? 'bp log close'
              : 'bp log open';
    throw usage(`a ${kind} line is composed by bp, never typed — use ${cmd}`);
  }
  return kind;
}

/** R5's routing column: check, DEVIATIONS, COST and group headings go to runs/<id>.md; R1's version-reconciliation check stays. */
export function routeOf(kind: LogKind, opts: { versionReconciliation?: boolean } = {}): 'log' | 'runs' {
  if (kind === 'check' && opts.versionReconciliation) return 'log';
  return RUNS_ONLY_KINDS.has(kind) ? 'runs' : 'log';
}

// ---- the lock --------------------------------------------------------------------------------------------------------

const LOCK_STALE_MS = 30_000;

function withLock<T>(path: string, fn: () => T): T {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true }); // record/runs/ may not exist yet on a run's first routed line
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'EEXIST') throw err;
      let age: number;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // the lock vanished between the failed create and the stat: try again
      }
      if (age > LOCK_STALE_MS) {
        rmSync(lock, { force: true });
        continue;
      }
      if (attempt > 200)
        throw halt(
          `${path} is locked by another bp process`,
          'one write run at a time per project (SKILL.md pre-flight 4)',
        );
      const until = Date.now() + 25;
      while (Date.now() < until) {
        // a short synchronous wait: bp's writes take milliseconds
      }
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Read the file as it is right now, under the lock. */
const readNow = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return undefined;
    throw err;
  }
};

/** Keep a file's line endings: a CRLF log stays CRLF, so no byte outside the touched entry changes. */
function eolOf(text: string): '\n' | '\r\n' {
  return /\r\n/.test(text) && !/(^|[^\r])\n/.test(text) ? '\r\n' : '\n';
}

// ---- the working folder's ignore file (targets §5) ----------------------------------------------------------------------

export const IGNORE_SEED =
  '# blueprint working folder — spec/targets.md §5: sources/ and cache/ are never committed; record/ is.\nsources/\ncache/\n';

/** Seed `<home>/.gitignore` when absent, never rewrite it — and always before anything else is written into `<home>`. */
export function seedIgnore(home: string): boolean {
  const p = join(home, '.gitignore');
  if (exists(p)) return false;
  writeTextAtomic(p, IGNORE_SEED);
  return true;
}

/**
 * Insert whole lines before physical line `at` of `text`, leaving every other byte as it was — a byte-order mark, mixed
 * line endings, a missing final newline (DESIGN §4.1: every byte outside the entry it touched is unchanged).
 */
export function insertLinesAt(text: string, at: number, add: readonly string[], eol: string): string {
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const starts = [bom];
  for (const m of text.slice(bom).matchAll(/\r\n|\r|\n/g)) starts.push(bom + (m.index ?? 0) + m[0].length);
  const chunk = add.map((l) => `${l}${eol}`).join('');
  const off = starts[at];
  if (off !== undefined) return `${text.slice(0, off)}${chunk}${text.slice(off)}`;
  return `${text}${/[\r\n]$/.test(text) || text.length === bom ? '' : eol}${chunk}`;
}

/** Dated markdown headings bp cannot read — 1-based line numbers. */
export function unreadableHeadings(log: ParsedLog): number[] {
  return log.physical.flatMap((l, i) => (/^##\s+\d{4}-\d{2}-\d{2}/.test(l) && !parseHeading(l) ? [i + 1] : []));
}

// ---- entries --------------------------------------------------------------------------------------------------------

/** Open a new entry above the newest one. Enforces the sitting rules R5 gives: one open entry per run, sittings in order. */
export function openEntry(paths: RecordPaths, h: HeaderFields, title: string): void {
  if (!RUN_ID.test(h.runId)) throw usage(`"${h.runId}" is not a run id — six lowercase hex characters (bp runid)`);
  if (!Number.isInteger(h.sitting) || h.sitting < 1) throw usage('a sitting number is 1 or more');
  for (const [name, v] of [
    ['--extra', h.extra ?? ''],
    ['--title', title],
  ] as const) {
    if (/[\r\n]/.test(v)) throw usage(`${name} cannot carry a newline — it goes on the heading or the header line`);
  }
  if (!isDirectory(paths.home))
    throw usage(
      `the working folder ${paths.home} does not exist — resolve it first (bp preflight); bp creates no tree it was not asked for`,
    );
  seedIgnore(paths.home);
  withLock(paths.log, () => {
    const before = readNow(paths.log);
    const text = before === undefined || before.trim() === '' ? LOG_PREAMBLE(title) : before;
    const eol = eolOf(text);
    const log = parseLog(text);
    const unreadable = unreadableHeadings(log);
    if (unreadable.length || (!log.entries.length && /^(?:## )?\d{4}-\d{2}-\d{2}/m.test(text))) {
      throw halt(
        `${paths.log} has entries bp cannot read${unreadable.length ? ` (line ${unreadable.join(', ')})` : ''} — nothing is appended to a log whose shape is unknown`,
        'fix the heading to the `## date · time · command · run id · …` shape, or move the entry below the newest readable one',
      );
    }
    const mine = log.entries.filter((e) => e.heading.runId === h.runId);
    if (mine.some((e) => e.heading.sitting === h.sitting))
      throw usage(`run ${h.runId} sitting ${h.sitting} already has an entry — resume it or open the next sitting`);
    const open = mine.find((e) => entryState(e) === 'open');
    if (open)
      throw usage(
        `run ${h.runId} sitting ${open.heading.sitting ?? '?'} is still open — close or pause it before opening another sitting`,
      );
    const last = Math.max(0, ...mine.map((e) => e.heading.sitting ?? 0));
    if (mine.length && h.sitting !== last + 1)
      throw usage(`run ${h.runId}'s next sitting is ${last + 1}, not ${h.sitting}`);
    if (!mine.length && h.sitting !== 1) throw usage(`run ${h.runId} has no entry yet — its first sitting is 1`);
    if (mine.some((e) => e.heading.command !== h.command))
      throw usage(`run ${h.runId} is a ${mine[0]?.heading.command ?? '?'} run, not ${h.command}`);
    const block = [headingLine(h), '', headerLine(h), '', '---', ''];
    const first = log.entries[0];
    if (first) {
      writeTextAtomic(paths.log, insertLinesAt(text, first.blockStart, block, eol));
      return;
    }
    // Only a preamble so far: the first entry goes after it, below one separator.
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const physical = [...log.physical];
    while (physical.length && physical[physical.length - 1] === '') physical.pop();
    if (physical[physical.length - 1] !== '---') physical.push('', '---');
    physical.push('', ...block);
    writeTextAtomic(paths.log, `${bom}${physical.join('\n').replace(/\n+$/, '')}\n`.replace(/\n/g, eol));
  });
}

/** The newest entry for a run (and sitting, where given). */
export function findEntry(log: ParsedLog, runId: string, sitting?: number): ParsedEntry | undefined {
  return log.entries.find((e) => e.heading.runId === runId && (sitting === undefined || e.heading.sitting === sitting));
}

/** Append one line to a run's open entry, after its last line and before its closing separator. */
export function appendLine(paths: RecordPaths, runId: string, line: string, opts: { sitting?: number } = {}): void {
  withLock(paths.log, () => {
    const before = readNow(paths.log);
    if (before === undefined) throw usage(`no run log at ${paths.log} — open the entry first (bp log open)`);
    const eol = eolOf(before);
    const log = parseLog(before);
    const entry = findEntry(log, runId, opts.sitting);
    if (!entry)
      throw usage(
        `no entry for run ${runId}${opts.sitting ? ` sitting ${opts.sitting}` : ''} — open it first (bp log open)`,
      );
    if (entry !== log.entries[0])
      throw halt(
        `run ${runId}'s entry is not the newest in the log — a newer entry was opened above it`,
        'one write run at a time per project (SKILL.md pre-flight 4)',
      );
    if (!entry.markdownHeading)
      throw usage(`run ${runId}'s entry was not written by bp; bp appends only to entries it opened`);
    if (entryState(entry) !== 'open')
      throw usage(`run ${runId}'s entry is ${entryState(entry)} — open the next sitting instead`);
    let insertAt = entry.start + 1;
    for (let i = entry.start + 1; i < entry.end; i++) {
      const t = (log.physical[i] ?? '').trim();
      if (t !== '' && t !== '---') insertAt = i + 1;
    }
    writeTextAtomic(paths.log, insertLinesAt(before, insertAt, [line], eol));
  });
}

/** Append a line to record/runs/<run-id>.md, creating it with a title line. */
export function appendRunsLine(paths: RecordPaths, runId: string, title: string, line: string): void {
  const path = join(paths.runsDir, `${runId}.md`);
  withLock(path, () => {
    const before = readNow(path);
    const text = before ?? `# Run ${runId} — ${title}\n`;
    writeTextAtomic(path, `${text.replace(/\n*$/, '\n')}${line}\n`);
  });
}

/** Every line of an entry as physical text. */
export function entryText(log: ParsedLog, entry: ParsedEntry): string[] {
  return log.physical.slice(entry.start, entry.end);
}

export const readLogText = (paths: RecordPaths): string | undefined => readTextIfExists(paths.log);
