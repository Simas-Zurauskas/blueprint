import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BP_ROOT,
  fakeSkillRoot,
  fileExists,
  makeHome,
  readFile,
  run,
  tempDir,
  writeFile,
  type RunResult,
} from './support/index.ts';
import { EXIT } from '../src/core/errors.ts';
import {
  CORE_KINDS,
  INIT_ADD_KINDS,
  CHALLENGE_KINDS,
  RUNS_ONLY_KINDS,
  STOP_REASONS,
  WRITE_COMMANDS,
  type LogKind,
  type WriteCommand,
} from '../src/domain/vocab.ts';

// Writing the run log through `bp log open|add|counts|hashes|funnel|close` (src/log/entry.ts, src/commands/log.ts).
// Spec: resolve.md R5 (the closed list of line kinds, its routing column, "No line is a paragraph", COUNTS carry their
// addends, HASHES repeat the item hashes character for character, a closing line names a stop reason from the closed
// list, a sitting that is not the last closes PAUSED and only the last names a reason; resolve.md:873–875 "written only
// through bp log … appends it without touching any other byte"), SKILL.md rule 1 (never compose what bp produces) and
// rule 7, SKILL.md pre-flight 4 and "Never rewrites the run log — it is append-only", spec/targets.md operation 7
// (append-only, newest first, written atomically) and §5 (<home>/.gitignore seeded when absent, never rewritten).
// Every expected file below is written out by hand.

// ---- arrangement -----------------------------------------------------------------------------------------------------

const VERSION = 38;
/** The default clock is NOW_ISO, 2026-09-25 14:07 local time; this is a second reading later the same day. */
const AT_1530 = '2026-09-25T15:30:00';

interface Project {
  home: string;
  logPath: string;
  runsPath: (runId: string) => string;
  bp: (args: string[], now?: string) => RunResult;
}

function project(opts: { log?: string; workspace?: string; home?: string } = {}): Project {
  const home = opts.home ?? makeHome(opts.log === undefined ? {} : { log: opts.log });
  const skillRoot = fakeSkillRoot(VERSION);
  return {
    home,
    logPath: join(home, 'record', 'run-log.md'),
    runsPath: (runId) => join(home, 'record', 'runs', `${runId}.md`),
    bp: (args, now) =>
      run(['log', ...args, '--home', home], {
        skillRoot,
        ...(now === undefined ? {} : { now }),
        ...(opts.workspace === undefined ? {} : { workspace: opts.workspace }),
      }),
  };
}

/** Arrange a step that must succeed; a failure here names the step rather than surfacing as a later diff. */
function must(r: RunResult, step: string): void {
  assert.equal(r.code, EXIT.ok, `arrange step "${step}" failed: ${r.err}`);
}

function open(p: Project, runId: string, command: WriteCommand, extra: string[] = [], now?: string): void {
  must(
    p.bp(['open', '--run', runId, '--command', command, '--title', 'Golden Crumb', ...extra], now),
    `open ${command} ${runId}`,
  );
}

function add(p: Project, runId: string, kind: string, text: string, extra: string[] = []): void {
  must(p.bp(['add', '--run', runId, '--kind', kind, '--text', text, ...extra]), `add ${kind}`);
}

/** The line token a kind is written with: `CON-<k>`, `<kind> <run id> #<n>` for the batch kinds, the kind otherwise. */
const tokenFor = (k: LogKind): string =>
  k === 'CON' ? 'CON-2' : k === 'ledger' || k === 'fix' || k === 'manifest' ? `${k} a2d011 #1` : k;

// ---- expected text, by hand ------------------------------------------------------------------------------------------

const PREAMBLE =
  '# Run log — «Golden Crumb» Blueprint\n\nAppend-only, newest entry first. Never rewritten, never summarised away.\n\n---\n\n';

/** An entry as bp lays it out: heading, blank, header, its lines, blank, separator. Entries are joined by one blank line. */
const entry = (heading: string, header: string, ...lines: string[]): string =>
  `${heading}\n\n${header}\n${lines.map((l) => `${l}\n`).join('')}\n---\n`;
const logOf = (...entries: string[]): string => PREAMBLE + entries.join('\n');

// run a1b2c3 · resolve · sitting 1 · opened at 14:07
const A_HEAD = '## 2026-09-25 · 14:07 · resolve · run a1b2c3 · skill v38 · sitting 1';
const A_HDR = '- header: date 2026-09-25 · time 14:07 · command resolve · run a1b2c3 · version 38 · sitting 1';
// run b2c3d4 · challenge · sitting 1 · opened at 15:30
const B_HEAD = '## 2026-09-25 · 15:30 · challenge · run b2c3d4 · skill v38 · sitting 1';
const B_HDR = '- header: date 2026-09-25 · time 15:30 · command challenge · run b2c3d4 · version 38 · sitting 1';
// run b2c3d4 · challenge · sitting 1 · opened at 14:07
const Q_HEAD = '## 2026-09-25 · 14:07 · challenge · run b2c3d4 · skill v38 · sitting 1';
const Q_HDR = '- header: date 2026-09-25 · time 14:07 · command challenge · run b2c3d4 · version 38 · sitting 1';
// run c3d4e5 · init · sitting 1 · opened at 14:07
const I_HEAD = '## 2026-09-25 · 14:07 · init · run c3d4e5 · skill v38 · sitting 1';
const I_HDR = '- header: date 2026-09-25 · time 14:07 · command init · run c3d4e5 · version 38 · sitting 1';

/** The first line of a runs/ file for run a1b2c3's resolve entry. */
const A_RUNS_TITLE = '# Run a1b2c3 — resolve · 2026-09-25 · skill v38';

// Body hashes: first 12 hex of SHA-256, derived with `printf '<text>' | shasum -a 256`.
const H_CHECKOUT = '73926ee83534'; // printf 'checkout body' | shasum -a 256
const H_SLOTS = '82c76180630f'; // printf 'pickup slots body' | shasum -a 256
const H_CHECKOUT_V2 = 'bcdafeab73be'; // printf 'checkout body v2' | shasum -a 256
const H_ABC = 'ba7816bf8f01'; // the known vector sha256("abc")

/** Kinds bp composes itself, which `bp log add` refuses (SKILL.md rule 1 and rule 7; resolve.md R5). */
const COMPOSED_KINDS: readonly LogKind[] = ['header', 'COUNTS', 'HASHES', 'funnel', 'closing'];

/** A legacy v21 entry in the fenced shape: its heading a plain line directly under an opening ``` fence. */
const FENCE = '```';
const LEGACY_PREAMBLE = '# Run log — «Golden Crumb» Blueprint\n\nAppend-only, newest entry first.\n\n---\n\n';
const OLD_ENTRY =
  '## 2026-09-24 · 16:41 · add · run a2d011 · skill v37 · sitting 1\n\n- closing: CLOSED 17:02 · DRAINED\n';

// ---- open ------------------------------------------------------------------------------------------------------------

void describe('bp log open', () => {
  void test('a first open on a folder with no run log writes the preamble, then the entry', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR)));
  });

  void test('the preamble title defaults to the workspace folder name', () => {
    const p = project({ workspace: join(tempDir(), 'golden-crumb') });
    must(p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve']), 'open');
    assert.equal(
      readFile(p.logPath),
      `# Run log — «golden-crumb» Blueprint\n\nAppend-only, newest entry first. Never rewritten, never summarised away.\n\n---\n\n${entry(A_HEAD, A_HDR)}`,
    );
  });

  void test('a second entry goes directly under the preamble, above the first', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close a1b2c3');
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(
      readFile(p.logPath),
      logOf(entry(B_HEAD, B_HDR), entry(A_HEAD, A_HDR, '- closing: CLOSED 14:07 · DRAINED')),
    );
  });

  void test('opening a new entry leaves every byte of the older entries unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'HUMAN-BLOCKED']), 'close');
    const before = readFile(p.logPath);
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    const after = readFile(p.logPath);
    // Everything from the older entry's heading to the end of the file is the same bytes as before.
    assert.equal(after, `${PREAMBLE}${entry(B_HEAD, B_HDR)}\n${before.slice(PREAMBLE.length)}`);
  });

  void test('a hand-written legacy log keeps its preamble and every entry byte-for-byte when bp opens an entry above them', () => {
    const legacyPreamble = '# Run log — «Golden Crumb» Blueprint\n\nAppend-only, newest entry first.\n\n---\n\n';
    const legacyEntries = [
      '## 2026-09-24 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
      '',
      '- header: date 2026-09-24 · time 16:41 · command add · run a2d011 · version 37 · sitting 1 · mode: soft',
      `- item: F-03 «Checkout» from sources/a2d011/notes.md §2 · body ${H_CHECKOUT}`,
      '- closing: CLOSED 17:02 · DRAINED',
      '',
      '---',
      '',
      '2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1',
      'item       «Do slots roll over?»  Patched  «Pickup slots» FR-3',
      '           carried on an indented continuation line',
      'CLOSED 09:30 · DRAINED',
      '',
    ].join('\n');
    const p = project({ log: legacyPreamble + legacyEntries });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${legacyPreamble}${entry(B_HEAD, B_HDR)}\n${legacyEntries}`);
  });

  void test('a legacy log that does not end in a newline still ends exactly as it did', () => {
    const legacyEntries = '2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1\nCLOSED 09:30 · DRAINED';
    const p = project({ log: PREAMBLE + legacyEntries });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${PREAMBLE}${entry(B_HEAD, B_HDR)}\n${legacyEntries}`);
  });

  void test('a legacy log ending in blank lines keeps every one of them', () => {
    const legacyEntries =
      '2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1\nCLOSED 09:30 · DRAINED\n\n\n';
    const p = project({ log: PREAMBLE + legacyEntries });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${PREAMBLE}${entry(B_HEAD, B_HDR)}\n${legacyEntries}`);
  });

  void test('a log file with a title and no entries gets a separator before its first entry', () => {
    const p = project({ log: '# Golden Crumb run log\n' });
    open(p, 'a1b2c3', 'resolve');
    assert.equal(readFile(p.logPath), `# Golden Crumb run log\n\n---\n\n${entry(A_HEAD, A_HDR)}`);
  });

  void test('the header carries the queue and then the mode, in R5 order, and the heading carries neither', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve', ['--extra', '6 of 18 queued', '--mode', 'force']);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          '- header: date 2026-09-25 · time 14:07 · command resolve · run a1b2c3 · version 38 · sitting 1 · 6 of 18 queued · mode: force',
        ),
      ),
    );
  });

  void test("a run's first sitting is 1: --sitting 3 on a run with no entry is refused and writes no log", () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb', '--sitting', '3']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /first sitting is 1/);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('the next sitting of the same run opens its own entry above the paused one', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--state',
        'PAUSED',
        '--text',
        'sitting 1 of a continuing run, 4 rows still queued',
      ]),
      'pause',
    );
    open(p, 'a1b2c3', 'resolve', ['--sitting', '2'], AT_1530);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          '## 2026-09-25 · 15:30 · resolve · run a1b2c3 · skill v38 · sitting 2',
          '- header: date 2026-09-25 · time 15:30 · command resolve · run a1b2c3 · version 38 · sitting 2',
        ),
        entry(A_HEAD, A_HDR, '- closing: PAUSED 14:07 · sitting 1 of a continuing run, 4 rows still queued'),
      ),
    );
  });

  void test('opening the same run and sitting twice is refused and leaves the log unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /a1b2c3 sitting 1 already has an entry/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('opening a sitting that already exists lower in the log is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    const before = readFile(p.logPath);
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('open without --command is refused and writes nothing', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('open for status, which never writes, is refused', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'status']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('open without --run is refused and writes nothing', () => {
    const p = project();
    const r = p.bp(['open', '--command', 'resolve']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('a mode that is not one a human can type is refused', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'add', '--mode', 'default']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('a write leaves no temp file beside the log (temp file plus rename)', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'NOTE', 'crossover: first local entry');
    assert.deepEqual(readdirSync(join(p.home, 'record')), ['run-log.md']);
  });
});

// ---- open: R5's sitting rules ----------------------------------------------------------------------------------------

void describe("bp log open — R5's sitting rules and its inputs", () => {
  // A run id is six lowercase hex characters (bp runid), or an earlier run's word-and-hyphen id: /^[0-9a-z][\w-]{2,40}$/ —
  // never a space, a `·` or a newline, which would break the heading it is written into.
  const badIds: [string, string][] = [
    ['an upper-case first character', 'A1b2c3'],
    ['two characters', 'a1'],
    ['a leading hyphen', '-a1b2c'],
    ['a space', 'a1b 2c3'],
    ['a middle dot', 'a1·b2c3'],
    ['42 characters, one past the longest', 'a'.repeat(42)],
  ];
  for (const [what, id] of badIds) {
    void test(`a run id with ${what} is refused and writes no log`, () => {
      const p = project();
      const r = p.bp(['open', '--run', id, '--command', 'resolve', '--title', 'Golden Crumb']);
      assert.equal(r.code, EXIT.usage);
      assert.equal(fileExists(p.logPath), false);
    });
  }

  void test('a word-and-hyphen run id of 41 characters, the longest allowed, opens an entry', () => {
    const p = project();
    const id = `run-${'a'.repeat(37)}`; // 4 + 37 = 41
    const r = p.bp(['open', '--run', id, '--command', 'resolve', '--title', 'Golden Crumb']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          `## 2026-09-25 · 14:07 · resolve · run ${id} · skill v38 · sitting 1`,
          `- header: date 2026-09-25 · time 14:07 · command resolve · run ${id} · version 38 · sitting 1`,
        ),
      ),
    );
  });

  void test('sitting 0 is refused and writes no log', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--sitting', '0']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('a sitting that skips one (sitting 3 after sitting 1) is refused and the log is unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--state', 'PAUSED', '--text', 'sitting 1 of a continuing run']), 'pause');
    const before = readFile(p.logPath);
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--sitting', '3'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /next sitting is 2/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('the next sitting cannot open while the previous one is still open, and the log is unchanged', () => {
    // resolve.md:784–787: a sitting that is not the last closes PAUSED, so only a crash inside a sitting leaves one open.
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--sitting', '2'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /still open/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a run id keeps one command: a challenge sitting under a resolve run is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--state', 'PAUSED', '--text', 'sitting 1 of a continuing run']), 'pause');
    const before = readFile(p.logPath);
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'challenge', '--sitting', '2'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('--extra carrying a newline is refused and writes no log', () => {
    const p = project();
    const r = p.bp([
      'open',
      '--run',
      'a1b2c3',
      '--command',
      'resolve',
      '--extra',
      '6 of 18 queued\n- closing: CLOSED 14:07 · DRAINED',
    ]);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('--title carrying a newline is refused and writes no log', () => {
    const p = project();
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden\nCrumb']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('a working folder that does not exist is refused (exit 2) and is not created', () => {
    const home = join(tempDir(), 'nowhere', 'blueprint');
    const p = project({ home });
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(home), false);
  });

  void test('a first open in a working folder with no record/ folder yet writes record/run-log.md', () => {
    // spec/targets.md §5: the log's home is <home>/record/run-log.md; the working folder is what must already exist.
    const home = join(tempDir(), 'blueprint');
    mkdirSync(home);
    const p = project({ home });
    const r = p.bp(['open', '--run', 'a1b2c3', '--command', 'resolve', '--title', 'Golden Crumb']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR)));
  });
});

// ---- open: the working folder's ignore file (targets §5) --------------------------------------------------------------

void describe('bp log open — <home>/.gitignore', () => {
  void test('the first open seeds .gitignore naming sources/ and cache/, and never record/', () => {
    // spec/targets.md:213 and :240 — "the ignore file names sources/ and cache/, not the whole folder".
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const rules = readFile(join(p.home, '.gitignore'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    assert.deepEqual(rules, ['sources/', 'cache/']);
  });

  void test('an existing .gitignore is never rewritten', () => {
    // spec/targets.md:251 — "seeded when absent, never rewritten — whatever a project adds to it stands".
    const p = project();
    const mine = '# ours\nsources/\n*.tmp\n';
    writeFile(join(p.home, '.gitignore'), mine);
    open(p, 'a1b2c3', 'resolve');
    assert.equal(readFile(join(p.home, '.gitignore')), mine);
  });
});

// ---- open and add: the bytes of the file bp did not write ------------------------------------------------------------

void describe('bp log — the file around the entry keeps its bytes', () => {
  void test('a CRLF log keeps CRLF on every line when bp opens an entry above it', () => {
    const legacyCrlf = (LEGACY_PREAMBLE + OLD_ENTRY).replace(/\n/g, '\r\n');
    const p = project({ log: legacyCrlf });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${LEGACY_PREAMBLE}${entry(B_HEAD, B_HDR)}\n${OLD_ENTRY}`.replace(/\n/g, '\r\n'));
  });

  void test('a CRLF log keeps CRLF when bp appends a line to its open entry', () => {
    const p = project({ log: logOf(entry(A_HEAD, A_HDR)).replace(/\n/g, '\r\n') });
    add(p, 'a1b2c3', 'NOTE', 'a deferral');
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, '- NOTE: a deferral')).replace(/\n/g, '\r\n'));
  });

  void test('an empty (0-byte) run-log.md gets the preamble before the first entry', () => {
    const p = project({ log: '' });
    open(p, 'a1b2c3', 'resolve');
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR)));
  });

  void test('a whitespace-only run-log.md gets the preamble before the first entry', () => {
    const p = project({ log: '\n  \n\t\n' });
    open(p, 'a1b2c3', 'resolve');
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR)));
  });

  void test('a log starting with a UTF-8 byte-order mark keeps it when bp opens an entry', () => {
    const p = project({ log: `\uFEFF${LEGACY_PREAMBLE}${OLD_ENTRY}` });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `\uFEFF${LEGACY_PREAMBLE}${entry(B_HEAD, B_HDR)}\n${OLD_ENTRY}`);
  });
});

// ---- open: fenced v21 logs -------------------------------------------------------------------------------------------

void describe('bp log open — a fenced v21 log', () => {
  void test('the new entry goes above the ``` fence that opens the first entry, never inside it', () => {
    const fenced = [
      FENCE,
      '2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1',
      'item       «Do slots roll over?»  Patched  «Pickup slots» FR-3',
      'CLOSED 09:30 · DRAINED',
      FENCE,
      '',
    ].join('\n');
    const p = project({ log: LEGACY_PREAMBLE + fenced });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${LEGACY_PREAMBLE}${entry(B_HEAD, B_HDR)}\n${fenced}`);
  });

  void test('the new entry goes above the opening fence even when a blank line separates the fence from the heading', () => {
    const fenced = [
      FENCE,
      '',
      '2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1',
      'CLOSED 09:30 · DRAINED',
      FENCE,
      '',
    ].join('\n');
    const p = project({ log: LEGACY_PREAMBLE + fenced });
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    assert.equal(readFile(p.logPath), `${LEGACY_PREAMBLE}${entry(B_HEAD, B_HDR)}\n${fenced}`);
  });
});

// ---- open: a log bp cannot read --------------------------------------------------------------------------------------

void describe('bp log open — a log whose dated entries bp cannot read halts', () => {
  const unreadable = '## 2026-09-24 — resolve, run 7f3a2c, crashed mid-sitting\n- item: «Checkout» FR-2 · Clean\n';

  void test('an unreadable dated entry under a preamble halts (exit 3) and the log is unchanged', () => {
    const p = project({ log: LEGACY_PREAMBLE + unreadable });
    const r = p.bp(['open', '--run', 'b2c3d4', '--command', 'challenge']);
    assert.equal(r.code, EXIT.halt);
    assert.equal(readFile(p.logPath), LEGACY_PREAMBLE + unreadable);
  });

  void test('an unreadable dated entry on the very first line halts (exit 3) and the log is unchanged', () => {
    const p = project({ log: unreadable });
    const r = p.bp(['open', '--run', 'b2c3d4', '--command', 'challenge']);
    assert.equal(r.code, EXIT.halt);
    assert.equal(readFile(p.logPath), unreadable);
  });

  void test('an unreadable dated entry above a readable one halts rather than filing the new entry beneath it', () => {
    // Newest first (targets.md operation 7): a new entry under a newer-dated one would break the order.
    const log = `${LEGACY_PREAMBLE}${unreadable}\n---\n\n${OLD_ENTRY}`;
    const p = project({ log });
    const r = p.bp(['open', '--run', 'b2c3d4', '--command', 'challenge']);
    assert.equal(r.code, EXIT.halt);
    assert.equal(readFile(p.logPath), log);
  });
});

// ---- the lock --------------------------------------------------------------------------------------------------------

/** Run the real `bp` entry point in a child process; resolves with its exit code and stderr. */
function bpProcess(argv: string[]): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', join(BP_ROOT, 'src', 'bin.ts'), ...argv],
      {
        cwd: tempDir(),
        env: {},
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, err }));
  });
}

void describe('bp log — the exclusive lock on the run log', () => {
  void test('no lock file is left beside the log after a write', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'NOTE', 'a deferral');
    assert.equal(fileExists(`${p.logPath}.lock`), false);
  });

  void test('a refused append releases the lock, so the next write goes ahead', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    assert.equal(p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'too late']).code, EXIT.usage);
    assert.equal(fileExists(`${p.logPath}.lock`), false);
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
  });

  void test('six bp processes appending at once each land their line, none lost', { timeout: 60_000 }, async () => {
    // testing §3.4: concurrent writers against the real file. Without the lock two read-modify-writes interleave and the
    // later rename drops the earlier line.
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const notes = [1, 2, 3, 4, 5, 6].map((n) => `- NOTE: deferral ${n}`);
    const results = await Promise.all(
      notes.map((_, i) =>
        bpProcess(['log', 'add', '--home', p.home, '--run', 'a1b2c3', '--kind', 'NOTE', '--text', `deferral ${i + 1}`]),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.code),
      [0, 0, 0, 0, 0, 0],
      results.map((r) => r.err).join('\n'),
    );
    const landed = readFile(p.logPath)
      .split('\n')
      .filter((l) => l.startsWith('- NOTE: '));
    assert.deepEqual([...landed].sort(), notes);
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, ...landed)));
  });
});

// ---- add: placement --------------------------------------------------------------------------------------------------

void describe('bp log add — placement', () => {
  void test('a line lands at the end of the open entry, before its separator', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'independence', '--text', 'writer opus, checker sonnet']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, '- independence: writer opus, checker sonnet')));
  });

  void test('lines keep the order they were appended in', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'SWEEP-NOTE', 'content rule swept rows 1–18 · 0 findings');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    add(p, 'a1b2c3', 'FLAGGED', 'q-09 the answer is only a link — write the decision in a sentence');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          '- SWEEP-NOTE: content rule swept rows 1–18 · 0 findings',
          `- item: q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`,
          '- FLAGGED: q-09 the answer is only a link — write the decision in a sentence',
        ),
      ),
    );
  });

  void test('a line added to the newer of two entries leaves the older entry byte-for-byte unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    add(p, 'b2c3d4', 'GRILL', `scale delta · bodies attacked «Checkout» ${H_ABC} (delta) · converged: no`);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(B_HEAD, B_HDR, `- GRILL: scale delta · bodies attacked «Checkout» ${H_ABC} (delta) · converged: no`),
        entry(A_HEAD, A_HDR, '- closing: CLOSED 14:07 · DRAINED'),
      ),
    );
  });

  void test("without --sitting a line goes to the run's newest sitting", () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--state',
        'PAUSED',
        '--text',
        'sitting 1 of a continuing run, 4 rows still queued',
      ]),
      'pause',
    );
    open(p, 'a1b2c3', 'resolve', ['--sitting', '2'], AT_1530);
    add(p, 'a1b2c3', 'GATE', '4 applied, 0 returned');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          '## 2026-09-25 · 15:30 · resolve · run a1b2c3 · skill v38 · sitting 2',
          '- header: date 2026-09-25 · time 15:30 · command resolve · run a1b2c3 · version 38 · sitting 2',
          '- GATE: 4 applied, 0 returned',
        ),
        entry(A_HEAD, A_HDR, '- closing: PAUSED 14:07 · sitting 1 of a continuing run, 4 rows still queued'),
      ),
    );
  });

  void test('the command reports which file the line went to', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'crossover: first local entry']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.match(r.out, /^record\/run-log\.md ← - NOTE: crossover: first local entry$/);
  });
});

// ---- add: routing (R5's → runs/ column) ------------------------------------------------------------------------------

void describe('bp log add — routing to record/runs/<run-id>.md', () => {
  void test('a check line goes to runs/<run-id>.md under a title line, and the log is untouched', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'check', '--text', 'R2.1 answer present · pass']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.runsPath('a1b2c3')), `${A_RUNS_TITLE}\n- check: R2.1 answer present · pass\n`);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a DEVIATIONS line goes to runs/, not the log', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    add(p, 'a1b2c3', 'DEVIATIONS', 'label-normalised · q-12');
    assert.equal(readFile(p.runsPath('a1b2c3')), `${A_RUNS_TITLE}\n- DEVIATIONS: label-normalised · q-12\n`);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a COST line goes to runs/, not the log', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    add(
      p,
      'a1b2c3',
      'COST',
      '12 dispatches · ~180k tokens · 41 min (self-reported, not recountable) · 6 applied / 0 returned / 2 flagged',
    );
    assert.equal(
      readFile(p.runsPath('a1b2c3')),
      `${A_RUNS_TITLE}\n- COST: 12 dispatches · ~180k tokens · 41 min (self-reported, not recountable) · 6 applied / 0 returned / 2 flagged\n`,
    );
    assert.equal(readFile(p.logPath), before);
  });

  void test('every runs-only kind leaves the run log byte-for-byte unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    for (const k of RUNS_ONLY_KINDS) add(p, 'a1b2c3', k, `a ${k} line`);
    assert.equal(readFile(p.logPath), before);
  });

  void test('runs/ lines are appended in order under the one title line', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'check', 'pre-flight 4 · no other run in flight');
    add(p, 'a1b2c3', 'COST', '3 dispatches (self-reported, not recountable)');
    assert.equal(
      readFile(p.runsPath('a1b2c3')),
      `${A_RUNS_TITLE}\n- check: pre-flight 4 · no other run in flight\n- COST: 3 dispatches (self-reported, not recountable)\n`,
    );
  });

  void test("R1's version-reconciliation check stays in the log when flagged --reconciliation", () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp([
      'add',
      '--run',
      'a1b2c3',
      '--kind',
      'check',
      '--text',
      'version reconciliation: stamped v37, VERSION 38, no register entry crossed',
      '--reconciliation',
    ]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(A_HEAD, A_HDR, '- check: version reconciliation: stamped v37, VERSION 38, no register entry crossed'),
      ),
    );
    assert.equal(fileExists(p.runsPath('a1b2c3')), false);
  });

  void test('--reconciliation does not pull a COST line into the log (the exception is the check line alone)', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    add(p, 'a1b2c3', 'COST', '3 dispatches (self-reported, not recountable)', ['--reconciliation']);
    assert.equal(readFile(p.logPath), before);
    assert.equal(
      readFile(p.runsPath('a1b2c3')),
      `${A_RUNS_TITLE}\n- COST: 3 dispatches (self-reported, not recountable)\n`,
    );
  });

  void test('a group heading, a kind R5 routes to runs/, is written there', () => {
    // resolve.md:898 and :915 list `group heading` on the closed list with the (→ runs/) mark.
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'group heading', '--text', 'APPLIED']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.runsPath('a1b2c3')), `${A_RUNS_TITLE}\n- group heading: APPLIED\n`);
    assert.equal(readFile(p.logPath), before);
  });

  void test('the reply names the runs/ file a routed line went to', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'check', '--text', 'R2.1 pass']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.match(r.out, /^record\/runs\/a1b2c3\.md ← - check: R2\.1 pass$/);
  });
});

// ---- add: the closed list --------------------------------------------------------------------------------------------

void describe('bp log add — the closed list of kinds', () => {
  void test('a kind on no list is refused with exit 2 and neither file changes', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'SUMMARY', '--text', 'went well']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /"SUMMARY" is not a line kind/);
    assert.equal(readFile(p.logPath), before);
    assert.equal(fileExists(p.runsPath('a1b2c3')), false);
  });

  void test('a core kind written in the wrong case is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'Item', '--text', 'q-04 Clean']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /different case/);
    assert.equal(readFile(p.logPath), before);
  });

  void test("FUNNEL in capitals is refused on a challenge entry (status C10's vacuous-pass trap)", () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'b2c3d4', '--kind', 'FUNNEL', '--text', '3 drafted → 3 discarded']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a lower-case con-k is refused on an init entry', () => {
    const p = project();
    open(p, 'c3d4e5', 'init');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'c3d4e5', '--kind', 'con-2', '--text', 'notes.md §2 vs call.md §4']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a capitalised batch token (Fix <run> #n) is refused on a challenge entry', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'b2c3d4', '--kind', 'Fix a2d011 #1', '--text', '«Checkout» FR-2 typo']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  for (const k of [...new Set<LogKind>([...INIT_ADD_KINDS, ...CHALLENGE_KINDS])]) {
    const token = tokenFor(k);
    void test(`a resolve entry refuses ${token}, a kind of init, add or questions alone`, () => {
      const p = project();
      open(p, 'a1b2c3', 'resolve');
      const before = readFile(p.logPath);
      const r = p.bp(['add', '--run', 'a1b2c3', '--kind', token, '--text', 'x']);
      assert.equal(r.code, EXIT.usage);
      assert.match(r.err, /is not a kind a resolve entry admits/);
      assert.equal(readFile(p.logPath), before);
    });
  }

  for (const k of INIT_ADD_KINDS.filter((x) => !(CHALLENGE_KINDS as readonly string[]).includes(x))) {
    const token = tokenFor(k);
    void test(`a challenge entry refuses ${token}, a kind of init and add alone`, () => {
      const p = project();
      open(p, 'b2c3d4', 'challenge');
      const before = readFile(p.logPath);
      const r = p.bp(['add', '--run', 'b2c3d4', '--kind', token, '--text', 'x']);
      assert.equal(r.code, EXIT.usage);
      assert.equal(readFile(p.logPath), before);
    });
  }

  // The composed kinds are refused by add (their describe below); the runs-only kinds are admitted and routed to runs/
  // (the routing describe above), so this loop covers every core kind a run types into the log itself.
  const typedCore = CORE_KINDS.filter((k) => !COMPOSED_KINDS.includes(k) && !RUNS_ONLY_KINDS.has(k));
  for (const command of WRITE_COMMANDS) {
    void test(`a ${command} entry admits every core kind a run types into the log`, () => {
      const p = project();
      open(p, 'a1b2c3', command);
      for (const k of typedCore) {
        const r = p.bp(['add', '--run', 'a1b2c3', '--kind', k, '--text', `a ${k} line`]);
        assert.equal(r.code, EXIT.ok, `${k} on ${command}: ${r.err}`);
      }
    });
  }

  void test('a bare CON, with no -k number, is refused on an init entry', () => {
    const p = project();
    open(p, 'c3d4e5', 'init');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'c3d4e5', '--kind', 'CON', '--text', 'notes.md §2 vs call.md §4']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /"CON" is not a line kind/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('an init entry admits a CON-k line', () => {
    const p = project();
    open(p, 'c3d4e5', 'init');
    add(p, 'c3d4e5', 'CON-2', 'notes.md §2 vs call.md §4 · sources/c3d4e5/contradictions.md');
    assert.equal(
      readFile(p.logPath),
      logOf(entry(I_HEAD, I_HDR, '- CON-2: notes.md §2 vs call.md §4 · sources/c3d4e5/contradictions.md')),
    );
  });

  void test('a challenge entry admits a fixes-batch line keyed by run id and number', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    add(p, 'b2c3d4', 'fix b2c3d4 #1', '«Checkout» FR-2 · "refund" → "refunds"');
    assert.equal(
      readFile(p.logPath),
      logOf(entry(Q_HEAD, Q_HDR, '- fix b2c3d4 #1: «Checkout» FR-2 · "refund" → "refunds"')),
    );
  });

  void test('an add entry admits a discard line', () => {
    const p = project();
    open(p, 'd4e5f6', 'add');
    add(p, 'd4e5f6', 'discard', 'Not a specification question · «Checkout» payment provider choice');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          '## 2026-09-25 · 14:07 · add · run d4e5f6 · skill v38 · sitting 1',
          '- header: date 2026-09-25 · time 14:07 · command add · run d4e5f6 · version 38 · sitting 1',
          '- discard: Not a specification question · «Checkout» payment provider choice',
        ),
      ),
    );
  });
});

// ---- add: one line, one entry ----------------------------------------------------------------------------------------

void describe('bp log add — refusals that protect the append-only log', () => {
  void test('a newline in the text is refused ("No line is a paragraph") and the log is unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'first line\nsecond line']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /No line is a paragraph/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a carriage return in the text is refused as a newline', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'first line\rsecond line']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a newline in a line routed to runs/ is refused and no runs/ file is created', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'check', '--text', 'R2.1\npass']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.runsPath('a1b2c3')), false);
  });

  void test('appending to a CLOSED entry is refused and the log is unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'too late']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /is closed/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('appending to a PAUSED entry is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--state',
        'PAUSED',
        '--text',
        'sitting 1 of a continuing run, 4 rows still queued',
      ]),
      'pause',
    );
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'too late']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /is paused/);
    assert.equal(readFile(p.logPath), before);
  });

  void test("appending under a human's hand-written CLOSED (crashed) is refused", () => {
    const crashed = logOf(
      entry(A_HEAD, A_HDR, `- item: q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`, 'CLOSED (crashed)'),
    );
    const p = project({ log: crashed });
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'resuming']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), crashed);
  });

  void test('appending to an entry with a newer entry above it halts (exit 3) and the log is unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'late write']);
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /not the newest/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('appending to an older sitting of the same run halts (exit 3)', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--state', 'PAUSED', '--text', 'sitting 1 of a continuing run']), 'pause');
    open(p, 'a1b2c3', 'resolve', ['--sitting', '2'], AT_1530);
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--sitting', '1', '--kind', 'NOTE', '--text', 'late write']);
    assert.equal(r.code, EXIT.halt);
    assert.equal(readFile(p.logPath), before);
  });

  void test('appending for a run with no entry is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'ffffff', '--kind', 'NOTE', '--text', 'orphan']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('appending with no run log at all is refused and creates none', () => {
    const p = project();
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE', '--text', 'orphan']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(fileExists(p.logPath), false);
  });

  void test('add without --text is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['add', '--run', 'a1b2c3', '--kind', 'NOTE']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('an unknown log subcommand is refused', () => {
    const p = project();
    const r = p.bp(['rewrite', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown "bp log rewrite"/);
  });
});

// ---- add: the kinds bp composes itself -----------------------------------------------------------------------------

void describe('bp log add — the kinds bp composes itself are refused, however well-formed', () => {
  // SKILL.md:63 rule 1 "Never compose what bp produces" and :358 rule 7 "a run supplies the parts, never the sum": each
  // of these lines has its own subcommand, and add names it.
  const cases: { kind: LogKind; command: WriteCommand; runId: string; text: string; sub: string }[] = [
    {
      kind: 'header',
      command: 'resolve',
      runId: 'a1b2c3',
      text: 'date 2026-09-25 · time 14:07 · command resolve · run a1b2c3 · version 38 · sitting 1',
      sub: 'bp log open',
    },
    // 4 + 24 = 28: the arithmetic is right, and the line is still not add's to write.
    {
      kind: 'COUNTS',
      command: 'resolve',
      runId: 'a1b2c3',
      text: 'markers 28 = README 4 · features 24',
      sub: 'bp log counts',
    },
    { kind: 'HASHES', command: 'resolve', runId: 'a1b2c3', text: `«Checkout» ${H_CHECKOUT}`, sub: 'bp log hashes' },
    // 14 + 2 + 1 + 3 + 13 = 33
    {
      kind: 'funnel',
      command: 'challenge',
      runId: 'b2c3d4',
      text: '33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded',
      sub: 'bp log funnel',
    },
    { kind: 'closing', command: 'resolve', runId: 'a1b2c3', text: 'CLOSED 14:07 · DRAINED', sub: 'bp log close' },
  ];
  for (const c of cases) {
    void test(`a ${c.kind} line typed through add is refused with exit 2, naming ${c.sub}, and the log is unchanged`, () => {
      const p = project();
      open(p, c.runId, c.command);
      // The HASHES value repeats this item's hash, so only the route is wrong.
      add(p, c.runId, 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
      const before = readFile(p.logPath);
      const r = p.bp(['add', '--run', c.runId, '--kind', c.kind, '--text', c.text]);
      assert.equal(r.code, EXIT.usage);
      assert.ok(r.err.includes(c.sub), `the refusal names ${c.sub}: ${r.err}`);
      assert.equal(readFile(p.logPath), before);
    });
  }
});

// ---- counts ----------------------------------------------------------------------------------------------------------

void describe('bp log counts', () => {
  void test('the total is computed from the addends and written before them', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    // 47 + 26 + 2 = 75
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'question rows: Applied=47, Open=26, Flagged=2']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(
      readFile(p.logPath),
      logOf(entry(A_HEAD, A_HDR, '- COUNTS: question rows 75 = Applied 47 · Open 26 · Flagged 2')),
    );
  });

  void test('several groups share one COUNTS line, separated by semicolons', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    // 4 + 24 = 28; 3 + 0 = 3
    must(
      p.bp([
        'counts',
        '--run',
        'a1b2c3',
        '--group',
        'markers: README=4, features=24',
        '--group',
        'rows: Open=3, Flagged=0',
      ]),
      'counts',
    );
    assert.equal(
      readFile(p.logPath),
      logOf(entry(A_HEAD, A_HDR, '- COUNTS: markers 28 = README 4 · features 24; rows 3 = Open 3 · Flagged 0')),
    );
  });

  void test('a zero addend is written, not dropped', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['counts', '--run', 'a1b2c3', '--group', 'question rows: Applied=48, Open=0']), 'counts');
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, '- COUNTS: question rows 48 = Applied 48 · Open 0')));
  });

  void test('counts with no --group is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a group with no label separator is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'markers 28']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a group with no addends (a bare total) is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'markers:']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /no addends/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a group with an empty label is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', ': Open=3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('an addend that is not a whole number is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'rows: Open=many']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a negative addend is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'rows: Open=-1']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('an addend name carrying the separator "·" is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'rows: Open · now=3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('counts into a closed entry is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    const before = readFile(p.logPath);
    const r = p.bp(['counts', '--run', 'a1b2c3', '--group', 'rows: Open=3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });
});

// ---- hashes ----------------------------------------------------------------------------------------------------------

void describe('bp log hashes', () => {
  void test("the roll-up repeats each item line's body hash character for character", () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2, FR-5 · body ${H_CHECKOUT}`);
    add(p, 'a1b2c3', 'item', `q-07 Patched «Pickup slots» FR-3 · body ${H_SLOTS}`);
    const r = p.bp(['hashes', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          `- item: q-04 Clean «Checkout» FR-2, FR-5 · body ${H_CHECKOUT}`,
          `- item: q-07 Patched «Pickup slots» FR-3 · body ${H_SLOTS}`,
          `- HASHES: «Checkout» ${H_CHECKOUT} · «Pickup slots» ${H_SLOTS}`,
        ),
      ),
    );
  });

  void test('the feature is the one named nearest before the hash, not the question title', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `«Can a customer retry a failed payment?» Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    must(p.bp(['hashes', '--run', 'a1b2c3']), 'hashes');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          `- item: «Can a customer retry a failed payment?» Clean «Checkout» FR-2 · body ${H_CHECKOUT}`,
          `- HASHES: «Checkout» ${H_CHECKOUT}`,
        ),
      ),
    );
  });

  void test('a body written twice rolls up its newest hash (R2.3: the newest recorded hash is the baseline)', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    add(p, 'a1b2c3', 'item', `q-05 Clean «Checkout» FR-6 · body ${H_CHECKOUT_V2}`);
    must(p.bp(['hashes', '--run', 'a1b2c3']), 'hashes');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          `- item: q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`,
          `- item: q-05 Clean «Checkout» FR-6 · body ${H_CHECKOUT_V2}`,
          `- HASHES: «Checkout» ${H_CHECKOUT_V2}`,
        ),
      ),
    );
  });

  void test('an item line with no body hash contributes nothing to the roll-up', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    add(p, 'a1b2c3', 'item', 'q-09 Flagged «Refunds» R2.1: answer is only a link · body —');
    must(p.bp(['hashes', '--run', 'a1b2c3']), 'hashes');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          `- item: q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`,
          '- item: q-09 Flagged «Refunds» R2.1: answer is only a link · body —',
          `- HASHES: «Checkout» ${H_CHECKOUT}`,
        ),
      ),
    );
  });

  void test('a roll-up with no item hash in the entry is refused and the log is unchanged', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', 'q-09 Flagged «Refunds» R2.1: answer is only a link · body —');
    const before = readFile(p.logPath);
    const r = p.bp(['hashes', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /nothing to roll up/);
    assert.equal(readFile(p.logPath), before);
  });

  void test("a roll-up reads only this entry: an earlier sitting's item hashes do not count", () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--state',
        'PAUSED',
        '--text',
        'sitting 1 of a continuing run, 4 rows still queued',
      ]),
      'pause',
    );
    open(p, 'a1b2c3', 'resolve', ['--sitting', '2'], AT_1530);
    const before = readFile(p.logPath);
    const r = p.bp(['hashes', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });
});

// ---- funnel ----------------------------------------------------------------------------------------------------------

void describe('bp log funnel', () => {
  const funnelArgs = (drafted: string, discarded: string): string[] => [
    'funnel',
    '--run',
    'b2c3d4',
    '--drafted',
    drafted,
    '--defaults',
    '14',
    '--fixes',
    '2',
    '--slots',
    '1',
    '--questions',
    '3',
    '--discarded',
    discarded,
  ];

  void test('a funnel whose outcomes sum to drafted is written in the drafted → outcomes shape', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    // 14 + 2 + 1 + 3 + 13 = 33
    const r = p.bp(funnelArgs('33', '13'));
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          Q_HEAD,
          Q_HDR,
          '- funnel: 33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded',
        ),
      ),
    );
  });

  void test('--detail is appended after the counts', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    must(p.bp([...funnelArgs('33', '13'), '--detail', '1 transcribed from a carried marker']), 'funnel');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          Q_HEAD,
          Q_HDR,
          '- funnel: 33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded · 1 transcribed from a carried marker',
        ),
      ),
    );
  });

  void test('a funnel whose outcomes do not sum to drafted is refused and the log is unchanged', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    const before = readFile(p.logPath);
    // 14 + 2 + 1 + 3 + 12 = 32 ≠ 33
    const r = p.bp(funnelArgs('33', '12'));
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /does not add up/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a funnel missing one of its terms is refused', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    const before = readFile(p.logPath);
    const r = p.bp([
      'funnel',
      '--run',
      'b2c3d4',
      '--drafted',
      '3',
      '--defaults',
      '3',
      '--fixes',
      '0',
      '--slots',
      '0',
      '--questions',
      '0',
    ]);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a funnel term that is not a whole number is refused', () => {
    const p = project();
    open(p, 'b2c3d4', 'challenge');
    const before = readFile(p.logPath);
    const r = p.bp(funnelArgs('33', '-13'));
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a resolve entry refuses a funnel line', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp([
      'funnel',
      '--run',
      'a1b2c3',
      '--drafted',
      '1',
      '--defaults',
      '1',
      '--fixes',
      '0',
      '--slots',
      '0',
      '--questions',
      '0',
      '--discarded',
      '0',
    ]);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });
});

// ---- close -----------------------------------------------------------------------------------------------------------

void describe('bp log close', () => {
  void test('a CLOSED line carries the clock time and the stop reason', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const r = p.bp(['close', '--run', 'a1b2c3', '--reason', 'HUMAN-BLOCKED'], AT_1530);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, '- closing: CLOSED 15:30 · HUMAN-BLOCKED')));
  });

  void test('--text follows the stop reason on the CLOSED line', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--reason',
        'DRAINED',
        '--text',
        'run totals: 14 applied, 1 returned by a sitting gate, 0 by the sweep · 3 sittings',
      ]),
      'close',
    );
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          A_HDR,
          '- closing: CLOSED 14:07 · DRAINED · run totals: 14 applied, 1 returned by a sitting gate, 0 by the sweep · 3 sittings',
        ),
      ),
    );
  });

  for (const reason of STOP_REASONS) {
    void test(`${reason}, a reason on R5's closed list, closes the entry`, () => {
      const p = project();
      open(p, 'a1b2c3', 'resolve');
      must(p.bp(['close', '--run', 'a1b2c3', '--reason', reason]), `close ${reason}`);
      assert.equal(readFile(p.logPath), logOf(entry(A_HEAD, A_HDR, `- closing: CLOSED 14:07 · ${reason}`)));
    });
  }

  void test('CLOSED without --reason is refused and the entry stays open', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /names its stop reason/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a stop reason off the closed list is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--reason', 'FINISHED']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a stop reason in the wrong case is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--reason', 'drained']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a PAUSED line needs no stop reason and carries the clock time and its text', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(
      p.bp([
        'close',
        '--run',
        'a1b2c3',
        '--state',
        'PAUSED',
        '--text',
        'sitting 1 of a continuing run, 12 rows still queued',
      ]),
      'pause',
    );
    assert.equal(
      readFile(p.logPath),
      logOf(entry(A_HEAD, A_HDR, '- closing: PAUSED 14:07 · sitting 1 of a continuing run, 12 rows still queued')),
    );
  });

  void test('a PAUSED line may not carry a stop reason (only the last sitting names one)', () => {
    // resolve.md:784–785: "only the last carries CLOSED hh:mm and the stop reason".
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--state', 'PAUSED', '--reason', 'DRAINED']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /PAUSED line names no stop reason/);
    assert.equal(readFile(p.logPath), before);
  });

  void test('a state other than CLOSED or PAUSED is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--state', 'DONE', '--reason', 'DRAINED']);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('closing an entry twice is refused', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED']), 'close');
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--reason', 'INTERRUPTED'], AT_1530);
    assert.equal(r.code, EXIT.usage);
    assert.equal(readFile(p.logPath), before);
  });

  void test('closing an entry that a newer entry sits above halts (exit 3)', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    open(p, 'b2c3d4', 'challenge', [], AT_1530);
    const before = readFile(p.logPath);
    const r = p.bp(['close', '--run', 'a1b2c3', '--reason', 'INTERRUPTED'], AT_1530);
    assert.equal(r.code, EXIT.halt);
    assert.equal(readFile(p.logPath), before);
  });
});

// ---- a whole sitting, end to end -------------------------------------------------------------------------------------

void describe('bp log — one sitting, end to end', () => {
  void test('open, lines, counts, hashes and close produce the exact entry, with check and COST in runs/', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve', ['--extra', '2 of 2 queued', '--mode', 'force']);
    add(p, 'a1b2c3', 'independence', 'writer opus, checker sonnet · probe succeeded via Task');
    add(p, 'a1b2c3', 'check', 'pre-flight 4 · no other run in flight');
    add(p, 'a1b2c3', 'item', `q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`);
    add(p, 'a1b2c3', 'item', `q-07 Patched «Pickup slots» FR-3 · body ${H_SLOTS}`);
    add(p, 'a1b2c3', 'GATE', '2 applied, 0 returned');
    must(p.bp(['hashes', '--run', 'a1b2c3']), 'hashes');
    must(p.bp(['counts', '--run', 'a1b2c3', '--group', 'question rows: Applied=2, Open=0']), 'counts');
    add(p, 'a1b2c3', 'COST', '4 dispatches (self-reported, not recountable)');
    must(p.bp(['close', '--run', 'a1b2c3', '--reason', 'DRAINED'], AT_1530), 'close');
    assert.equal(
      readFile(p.logPath),
      logOf(
        entry(
          A_HEAD,
          '- header: date 2026-09-25 · time 14:07 · command resolve · run a1b2c3 · version 38 · sitting 1 · 2 of 2 queued · mode: force',
          '- independence: writer opus, checker sonnet · probe succeeded via Task',
          `- item: q-04 Clean «Checkout» FR-2 · body ${H_CHECKOUT}`,
          `- item: q-07 Patched «Pickup slots» FR-3 · body ${H_SLOTS}`,
          '- GATE: 2 applied, 0 returned',
          `- HASHES: «Checkout» ${H_CHECKOUT} · «Pickup slots» ${H_SLOTS}`,
          '- COUNTS: question rows 2 = Applied 2 · Open 0',
          '- closing: CLOSED 15:30 · DRAINED',
        ),
      ),
    );
    assert.equal(
      readFile(p.runsPath('a1b2c3')),
      `${A_RUNS_TITLE}\n- check: pre-flight 4 · no other run in flight\n- COST: 4 dispatches (self-reported, not recountable)\n`,
    );
  });
});

// A second writer on disk: a hand edit between two bp calls is kept, never overwritten.
void describe('bp log — a foreign edit between calls', () => {
  void test('a line a human appended to the open entry survives the next bp append', () => {
    const p = project();
    open(p, 'a1b2c3', 'resolve');
    // A human adds a NOTE by hand, exactly where bp would.
    writeFile(p.logPath, logOf(entry(A_HEAD, A_HDR, '- NOTE: human: paused for lunch')));
    add(p, 'a1b2c3', 'GATE', '0 applied, 0 returned');
    assert.equal(
      readFile(p.logPath),
      logOf(entry(A_HEAD, A_HDR, '- NOTE: human: paused for lunch', '- GATE: 0 applied, 0 returned')),
    );
  });
});
