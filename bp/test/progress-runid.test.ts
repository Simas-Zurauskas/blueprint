import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { BP_ROOT, makeHome, run, tempDir, writeFile, type RunResult } from './support/index.ts';
import { seededRand } from '../src/core/rand.ts';
import { EXIT } from '../src/core/errors.ts';
import type { Progress } from '../src/progress.ts';
import type { ProgressState } from '../src/domain/vocab.ts';

// `bp progress --json-file <path>` (spec/run-progress.md) and `bp runid --home <home>` (resolve.md R5: "a six-character
// run id … minted at R1 and never reused").
//
// Every expected block below is written out by hand from spec/run-progress.md §1: two spaces of indent, the state word,
// the phase id and label, the note on the same line, and the rule-off line `  ————   <total> <unit> · <disposed> disposed
// · <total − disposed> to go`, the subtraction done by hand in each test.

// ---- helpers ----------------------------------------------------------------------------------------------------------

type Phase = Progress['phases'][number];

const phase = (state: ProgressState, id: string, label: string, note?: string): Phase =>
  note === undefined ? { state, id, label } : { state, id, label, note };

/** A valid live `status` block with no notes: the base the malformed-input tests break one field of. */
function statusBlock(overrides: Partial<Progress> = {}): Progress {
  return {
    command: 'status',
    runId: '1a2b3c',
    sitting: 1,
    phases: [phase('done', 'S1', 'read'), phase('now', 'S2', 'ten checks'), phase('next', 'S3', 'print one screen')],
    total: 10,
    disposed: 4,
    ...overrides,
  };
}

/** Write the progress state (valid or deliberately not) to a temp file and render it through the CLI. */
function progress(state: unknown): RunResult {
  const path = writeFile(join(tempDir('bp-progress-'), 'progress.json'), JSON.stringify(state));
  return run(['progress', '--json-file', path]);
}

function progressRaw(text: string): RunResult {
  const path = writeFile(join(tempDir('bp-progress-'), 'progress.json'), text);
  return run(['progress', '--json-file', path]);
}

const outLines = (r: RunResult): string[] => r.out.split('\n');

/** The rendered line for a phase, found by `<id> ` anywhere in it (so a state word run into the id still matches). */
function lineFor(r: RunResult, phaseId: string): string {
  const l = outLines(r).find((x) => x.includes(`${phaseId} `));
  assert.ok(l !== undefined, `no line for ${phaseId} in:\n${r.out}`);
  return l;
}

/** A refusal: usage exit, nothing printed on stdout (no half-rendered block), the reason on stderr. */
function assertRefused(r: RunResult, reason: RegExp): void {
  assert.equal(r.code, EXIT.usage, `expected a usage refusal, got exit ${r.code}\nout:\n${r.out}\nerr:\n${r.err}`);
  assert.equal(r.out, '');
  assert.match(r.err, reason);
}

// ---- progress: exact rendering ----------------------------------------------------------------------------------------

void describe('bp progress — exact rendering', () => {
  void test("renders the spec's own worked live block byte for byte", () => {
    // spec/run-progress.md lines 19-24, pasted verbatim. The notes start 27 columns after the label's first character.
    const r = progress({
      command: 'resolve',
      runId: '7f3a2c',
      sitting: 2,
      mode: 'force',
      phases: [
        phase('done', 'R1', 'load the queue', '18 eligible'),
        phase('done', 'R2', 'pre-write checks', '4 bases hashed · 0 blockers'),
        phase('now', 'R3', 'write, item 7 of 10', '4 applied · 1 flagged · 2 superseded'),
        phase('next', 'R5', 'gate, log, report'),
      ],
      total: 18,
      disposed: 11,
    } satisfies Progress);
    assert.equal(r.code, EXIT.ok);
    assert.equal(
      r.out,
      [
        'BLUEPRINT resolve · run 7f3a2c · sitting 2 · mode: force',
        '  done   R1 load the queue          18 eligible',
        '  done   R2 pre-write checks        4 bases hashed · 0 blockers',
        '  now    R3 write, item 7 of 10     4 applied · 1 flagged · 2 superseded',
        '  next   R5 gate, log, report',
        '  ————   18 queued · 11 disposed · 7 to go',
      ].join('\n'),
    );
  });

  void test('renders a live block without notes exactly: header, done, now, next, rule-off', () => {
    const r = progress(statusBlock());
    assert.equal(r.code, EXIT.ok);
    // 10 - 4 = 6 to go. status has no mode, so the header carries none (run-progress §1: "where the command has one").
    assert.equal(
      r.out,
      [
        'BLUEPRINT status · run 1a2b3c · sitting 1',
        '  done   S1 read',
        '  now    S2 ten checks',
        '  next   S3 print one screen',
        '  ————   10 queued · 4 disposed · 6 to go',
      ].join('\n'),
    );
  });

  void test('renders a finished block exactly: the header, the done lines and the rule-off line only', () => {
    // run-progress §1a: "A finished block … carries done lines and the rule-off line only. now and next are omitted".
    // The header stays: only now and next are named as omitted. 18 - 18 = 0 to go.
    const r = progress({
      command: 'resolve',
      runId: '7f3a2c',
      sitting: 3,
      mode: 'force',
      phases: [
        phase('done', 'R1', 'load'),
        phase('done', 'R2', 'pre-write checks'),
        phase('done', 'R3', 'write, per item'),
        phase('done', 'R4', 'report what a person owns'),
        phase('done', 'R5', 'gate, log, close'),
      ],
      total: 18,
      disposed: 18,
    } satisfies Progress);
    assert.equal(r.code, EXIT.ok);
    assert.equal(
      r.out,
      [
        'BLUEPRINT resolve · run 7f3a2c · sitting 3 · mode: force',
        '  done   R1 load',
        '  done   R2 pre-write checks',
        '  done   R3 write, per item',
        '  done   R4 report what a person owns',
        '  done   R5 gate, log, close',
        '  ————   18 queued · 18 disposed · 0 to go',
      ].join('\n'),
    );
  });

  void test('reads the progress state from stdin when --json-file is -', () => {
    // src/bin.ts is the executable entry point the `bp` wrapper runs; cli.ts only exports main and has no side effect.
    const entry = join(BP_ROOT, 'src', 'bin.ts');
    const r = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', entry, 'progress', '--json-file', '-'],
      {
        input: JSON.stringify(statusBlock()),
        encoding: 'utf8',
        cwd: tempDir('bp-stdin-'),
        env: {},
      },
    );
    assert.equal(r.status, EXIT.ok, r.stderr);
    assert.equal(
      r.stdout,
      [
        'BLUEPRINT status · run 1a2b3c · sitting 1',
        '  done   S1 read',
        '  now    S2 ten checks',
        '  next   S3 print one screen',
        '  ————   10 queued · 4 disposed · 6 to go',
        '',
      ].join('\n'),
    );
  });
});

// ---- progress: the parts ----------------------------------------------------------------------------------------------

void describe('bp progress — header', () => {
  void test('prints the soft mode as the modifier a human types', () => {
    const r = progress(statusBlock({ command: 'add', runId: 'a2d011', mode: 'soft' }));
    assert.equal(r.code, EXIT.ok);
    assert.equal(outLines(r)[0], 'BLUEPRINT add · run a2d011 · sitting 1 · mode: soft');
  });

  void test('refuses mode "default", which is not a third mode', () => {
    // run-progress §1 header row: "force or soft, never default" (v22).
    assertRefused(progress({ ...statusBlock({ command: 'add' }), mode: 'default' }), /\$\.mode/);
  });

  void test('refuses a mode word with the wrong case', () => {
    assertRefused(progress({ ...statusBlock({ command: 'add' }), mode: 'Force' }), /\$\.mode/);
  });

  void test('an add block with no mode is refused: its header says which mode is running, every time', () => {
    // add.md:21-22 — "the progress block's header line says which mode is running, every time"; add.md:27-29 makes that
    // grammar govern both write seams. run-progress §1: the header carries "the mode, where the command has one".
    assertRefused(progress(statusBlock({ command: 'add', runId: 'a2d011' })), /force or soft/);
  });

  void test('a resolve block with no mode is refused', () => {
    assertRefused(progress(statusBlock({ command: 'resolve', runId: '7f3a2c' })), /force or soft/);
  });

  for (const command of ['status', 'challenge', 'init']) {
    void test(`a ${command} block carrying a mode is refused: only add and resolve have one`, () => {
      assertRefused(progress(statusBlock({ command, mode: 'force' })), /has no mode/);
    });
  }

  void test('prints the force mode as the modifier a human types', () => {
    const r = progress(statusBlock({ command: 'resolve', runId: '7f3a2c', mode: 'force' }));
    assert.equal(r.code, EXIT.ok);
    assert.equal(outLines(r)[0], 'BLUEPRINT resolve · run 7f3a2c · sitting 1 · mode: force');
  });

  void test("an embedded run's block carries the outer run's header and its own task list", () => {
    // run-progress §1a: the embedded challenge run prints its own block; its header carries the outer run's header
    // line (command, run id, sitting, mode), its list is Q1…Q6.
    const r = progress({
      command: 'challenge',
      embeddedIn: 'add',
      runId: 'a2d011',
      sitting: 1,
      mode: 'soft',
      phases: [
        phase('done', 'Q1', 'reconcile', '0 reconciled'),
        phase('now', 'Q2', 'grill', '37 candidates'),
        phase('next', 'Q3', 'deduplicate'),
        phase('next', 'Q4', 'dispose and write'),
        phase('next', 'Q5', 'sitting, on request'),
        phase('next', 'Q6', 'dispositions, log, report'),
      ],
      total: 37,
      disposed: 0,
      unit: 'candidates',
    } satisfies Progress);
    assert.equal(r.code, EXIT.ok);
    const lines = outLines(r);
    assert.match(lines[0] ?? '', /^BLUEPRINT add\b.* · run a2d011 · sitting 1 · mode: soft$/);
    assert.equal(lines.filter((l) => l.startsWith('BLUEPRINT')).length, 1, 'one header line, not two');
    assert.deepEqual(
      lines.slice(1, -1).map((l) => /(Q\d) /.exec(l)?.[1]),
      ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
    );
    // 37 - 0 = 37 to go.
    assert.equal(lines.at(-1), '  ————   37 candidates · 0 disposed · 37 to go');
  });

  void test("an embedded block under add that omits add's mode is refused: the outer header carries it", () => {
    // run-progress §1a: "The embedded block carries the outer run's header line" — and add's header says which mode is
    // running, every time (add.md:21-22). Without the mode the embedded header is not add's header line.
    assertRefused(
      progress({
        command: 'challenge',
        embeddedIn: 'add',
        runId: 'a2d011',
        sitting: 1,
        phases: [phase('now', 'Q1', 'reconcile'), phase('next', 'Q2', 'grill')],
        total: 0,
        disposed: 0,
      } satisfies Progress),
      /mode/,
    );
  });
});

void describe('bp progress — phase lines', () => {
  void test('a next line is named, never annotated with a note', () => {
    // run-progress §1: next lines are "Named, never counted".
    const r = progress(
      statusBlock({
        phases: [
          phase('now', 'S1', 'read'),
          phase('next', 'S2', 'ten checks', '3 phases remain'),
          phase('next', 'S3', 'print one screen'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
    assert.equal(lineFor(r, 'S2'), '  next   S2 ten checks');
  });

  void test('notes on done and now lines start in one column after the widest label', () => {
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read', '12 features'),
          phase('now', 'S2', 'ten checks, check 4 of 10', '3 findings'),
          phase('next', 'S3', 'print one screen'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
    const s1 = lineFor(r, 'S1');
    const s2 = lineFor(r, 'S2');
    assert.ok(s1.endsWith('12 features') && s2.endsWith('3 findings'), `${s1}\n${s2}`);
    assert.equal(s1.indexOf('12 features'), s2.indexOf('3 findings'), 'notes are not aligned');
    assert.match(s2, /S2 ten checks, check 4 of 10 {2,}3 findings$/, 'the widest label runs into its note');
  });

  void test('a blocked line names what is in the way on the same line', () => {
    const r = progress(
      statusBlock({
        command: 'resolve',
        mode: 'force',
        phases: [
          phase('done', 'R1', 'load', '18 eligible'),
          phase('blocked', 'R3', 'write, item 7 of 10', 'Notion returned 429 twice'),
          phase('next', 'R5', 'gate, log, close'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
    const l = lineFor(r, 'R3');
    assert.ok(
      l.startsWith('  blocked') && l.includes('R3 write, item 7 of 10') && l.endsWith('Notion returned 429 twice'),
      l,
    );
  });

  void test('the seven-letter blocked state takes one space, and its note sits in the note column', () => {
    // run-progress §1's sample: state words sit in a 7-wide column ("done   ", "now    "); blocked is already 7 letters,
    // so one space separates it from the id. Notes start 5 columns past the longest "id label": "S3 print one screen"
    // is 19 characters, so the column is 24 wide and "S2 ten checks" (13) is followed by 11 spaces.
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read'),
          phase('blocked', 'S2', 'ten checks', 'Notion search timed out'),
          phase('next', 'S3', 'print one screen'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
    assert.equal(lineFor(r, 'S2'), `  blocked S2 ten checks${' '.repeat(11)}Notion search timed out`);
  });

  void test('the skipped state word is separated from the phase id', () => {
    const r = progress(
      statusBlock({
        command: 'challenge',
        phases: [
          phase('done', 'Q4', 'dispose and write'),
          phase('skipped', 'Q5', 'sitting, on request'),
          phase('now', 'Q6', 'dispositions, log, report'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
    // skipped is seven letters, so one space; a line with no note carries no trailing padding.
    assert.equal(lineFor(r, 'Q5'), '  skipped Q5 sitting, on request');
  });

  void test('a finished block keeps a skipped phase as skipped, never as done', () => {
    // run-progress §1: skipped exists because writing done against a phase that never ran is a lie a reader cannot
    // detect; dropping it from the closing block would hide the same thing.
    const r = progress(
      statusBlock({
        command: 'challenge',
        phases: [
          phase('done', 'Q4', 'dispose and write'),
          phase('skipped', 'Q5', 'sitting, on request'),
          phase('done', 'Q6', 'dispositions, log, report'),
        ],
        total: 5,
        disposed: 5,
      }),
    );
    assert.equal(r.code, EXIT.ok);
    const q5 = lineFor(r, 'Q5');
    assert.ok(q5.startsWith('  skipped'), q5);
    assert.ok(!q5.includes('done'), q5);
  });

  void test('a finished block carries no now or next line', () => {
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read', '12 features'),
          phase('done', 'S2', 'ten checks', '3 findings'),
          phase('done', 'S3', 'print one screen'),
        ],
        disposed: 10,
      }),
    );
    assert.equal(r.code, EXIT.ok);
    const lines = outLines(r);
    assert.equal(lines.length, 5, r.out);
    assert.ok(
      lines.every((l) => !/^ {2}(now|next)\b/.test(l)),
      r.out,
    );
  });
});

void describe('bp progress — the rule-off line', () => {
  void test('prints total, disposed and the remainder that adds up, in the given unit', () => {
    // 37 - 26 = 11.
    const r = progress(statusBlock({ total: 37, disposed: 26, unit: 'candidates' }));
    assert.equal(r.code, EXIT.ok);
    assert.equal(outLines(r).at(-1), '  ————   37 candidates · 26 disposed · 11 to go');
  });

  void test('prints 0 to go when everything is disposed', () => {
    const r = progress(statusBlock({ total: 4, disposed: 4 }));
    assert.equal(r.code, EXIT.ok);
    assert.equal(outLines(r).at(-1), '  ————   4 queued · 4 disposed · 0 to go');
  });

  void test('a finished block with items left still prints them as to go', () => {
    // run-progress §3 rule 3: "The remaining count is what a run may not lie about." 18 - 11 = 7.
    const r = progress(
      statusBlock({
        phases: [phase('done', 'S1', 'read'), phase('done', 'S2', 'ten checks')],
        total: 18,
        disposed: 11,
      }),
    );
    assert.equal(r.code, EXIT.ok);
    assert.equal(outLines(r).at(-1), '  ————   18 queued · 11 disposed · 7 to go');
  });

  void test('refuses disposed greater than total', () => {
    assertRefused(progress(statusBlock({ total: 4, disposed: 5 })), /disposed \(5\) exceeds total \(4\)/);
  });
});

// ---- progress: the live-line and order rules --------------------------------------------------------------------------

void describe('bp progress — exactly one now or blocked while live', () => {
  void test('refuses two now lines', () => {
    assertRefused(
      progress(
        statusBlock({
          phases: [
            phase('now', 'S1', 'read'),
            phase('now', 'S2', 'ten checks'),
            phase('next', 'S3', 'print one screen'),
          ],
        }),
      ),
      /exactly one "now" or "blocked"/,
    );
  });

  void test('refuses a live block with no now line', () => {
    assertRefused(
      progress(statusBlock({ phases: [phase('done', 'S1', 'read'), phase('next', 'S2', 'ten checks')] })),
      /exactly one "now" or "blocked"/,
    );
  });

  void test('refuses a now line and a blocked line together, since blocked replaces now', () => {
    assertRefused(
      progress(
        statusBlock({
          phases: [
            phase('now', 'S1', 'read'),
            phase('blocked', 'S2', 'ten checks', 'no token'),
            phase('next', 'S3', 'print one screen'),
          ],
        }),
      ),
      /exactly one "now" or "blocked"/,
    );
  });

  void test('accepts a blocked line in place of now', () => {
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read'),
          phase('blocked', 'S2', 'ten checks', 'Notion search timed out'),
          phase('next', 'S3', 'print one screen'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
  });

  void test('refuses a blocked line that names nothing in the way', () => {
    // run-progress.md:37-38 — blocked "names what is in the way on the same line".
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read'),
          phase('blocked', 'S2', 'ten checks'),
          phase('next', 'S3', 'print one screen'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.usage, r.out);
    assert.equal(r.out, '');
  });
});

void describe('bp progress — phases in run order', () => {
  void test('refuses a next phase listed before the now phase', () => {
    assertRefused(
      progress(
        statusBlock({
          phases: [
            phase('done', 'S1', 'read'),
            phase('next', 'S3', 'print one screen'),
            phase('now', 'S2', 'ten checks'),
          ],
        }),
      ),
      /run order/,
    );
  });

  void test('refuses a next phase listed before a done phase', () => {
    assertRefused(
      progress(
        statusBlock({
          phases: [
            phase('now', 'S1', 'read'),
            phase('next', 'S2', 'ten checks'),
            phase('done', 'S3', 'print one screen'),
          ],
        }),
      ),
      /run order/,
    );
  });

  void test('refuses a done phase listed after the now phase', () => {
    // run-progress §1: done lines are finished phases, now is the one running, next the ones not started — a done line
    // below now claims a phase finished that the run has not reached.
    assertRefused(
      progress(
        statusBlock({
          phases: [
            phase('done', 'S1', 'read'),
            phase('now', 'S2', 'ten checks'),
            phase('done', 'S3', 'print one screen'),
          ],
        }),
      ),
      /run order/,
    );
  });

  void test('accepts a skipped phase among the finished ones, before now', () => {
    const r = progress(
      statusBlock({
        command: 'challenge',
        phases: [
          phase('done', 'Q4', 'dispose and write'),
          phase('skipped', 'Q5', 'sitting, on request'),
          phase('now', 'Q6', 'dispositions, log, report'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.ok);
  });

  void test('refuses a next phase listed before the blocked phase', () => {
    // blocked replaces now (run-progress.md:37-38), so a next ahead of it is the same order fault as a next ahead of now.
    const r = progress(
      statusBlock({
        phases: [
          phase('done', 'S1', 'read'),
          phase('next', 'S3', 'print one screen'),
          phase('blocked', 'S2', 'ten checks', 'Notion search timed out'),
        ],
      }),
    );
    assert.equal(r.code, EXIT.usage, r.out);
    assert.equal(r.out, '');
  });
});

// ---- progress: malformed input -----------------------------------------------------------------------------------------

void describe('bp progress — malformed input', () => {
  void test('refuses an unknown state, naming the phase', () => {
    // run-progress §1: the five are the only states; "started but not finished" is deliberately absent.
    const s = statusBlock();
    assertRefused(
      progress({ ...s, phases: [s.phases[0], { state: 'started', id: 'S2', label: 'ten checks' }] }),
      /\$\.phases\[1\]\.state/,
    );
  });

  void test('refuses a sixth top-level part', () => {
    assertRefused(progress({ ...statusBlock(), footer: 'eta 4 min' }), /\$\.footer: unknown field/);
  });

  void test('refuses an empty phase list', () => {
    assertRefused(progress(statusBlock({ phases: [] })), /\$\.phases/);
  });

  void test('refuses a missing run id', () => {
    const { runId: _drop, ...rest } = statusBlock();
    assertRefused(progress(rest), /\$\.runId: required/);
  });

  void test('refuses sitting 0', () => {
    assertRefused(progress(statusBlock({ sitting: 0 })), /\$\.sitting/);
  });

  void test('refuses a negative total', () => {
    assertRefused(progress(statusBlock({ total: -1, disposed: 0 })), /\$\.total/);
  });

  void test('refuses a fractional disposed count', () => {
    assertRefused(progress(statusBlock({ total: 4, disposed: 1.5 })), /\$\.disposed/);
  });

  void test('refuses a count given as a string', () => {
    assertRefused(progress({ ...statusBlock(), total: '10' }), /\$\.total/);
  });

  void test('refuses an empty phase label', () => {
    const s = statusBlock();
    assertRefused(progress({ ...s, phases: [phase('now', 'S1', '')] }), /\$\.phases\[0\]\.label/);
  });

  void test('refuses a JSON array in place of the state object', () => {
    assertRefused(progress([statusBlock()]), /expected object/);
  });

  void test('refuses a file that is not JSON', () => {
    assertRefused(progressRaw('{ "command": "status", '), /is not JSON/);
  });

  void test('refuses a phase note that carries a newline', () => {
    // run-progress.md:32-33 — one line per phase; a newline in a note prints a line that is none of the five parts.
    const r = progress(
      statusBlock({
        phases: [phase('done', 'S1', 'read', '12 features\n3 archived'), phase('now', 'S2', 'ten checks')],
      }),
    );
    assert.equal(r.code, EXIT.usage, r.out);
    assert.equal(r.out, '');
  });

  void test('refuses a phase label that carries a newline', () => {
    const r = progress(statusBlock({ phases: [phase('done', 'S1', 'read'), phase('now', 'S2', 'ten\nchecks')] }));
    assert.equal(r.code, EXIT.usage, r.out);
    assert.equal(r.out, '');
  });

  void test('refuses a phase id that carries a newline', () => {
    assertRefused(
      progress(statusBlock({ phases: [phase('done', 'S1', 'read'), phase('now', 'S\n2', 'ten checks')] })),
      /newline/,
    );
  });

  void test('refuses a phase note that carries a carriage return', () => {
    assertRefused(
      progress(
        statusBlock({
          phases: [phase('done', 'S1', 'read', '12 features\r3 archived'), phase('now', 'S2', 'ten checks')],
        }),
      ),
      /newline/,
    );
  });

  void test('without --json-file it is a usage error', () => {
    assertRefused(run(['progress']), /--json-file is required/);
  });

  void test('--json-file given twice is a usage error', () => {
    const path = writeFile(join(tempDir('bp-progress-'), 'p.json'), JSON.stringify(statusBlock()));
    assertRefused(run(['progress', '--json-file', path, '--json-file', path]), /--json-file was given 2 times/);
  });

  void test('a --json-file that does not exist is a usage error, not an internal error', () => {
    // DESIGN.md:262-266 — exit 2 is usage; 3 is a pre-flight or safety stop. A wrong path is the caller's to fix.
    const r = run(['progress', '--json-file', join(tempDir('bp-progress-'), 'missing.json')]);
    assert.equal(r.code, EXIT.usage, r.err);
    assert.doesNotMatch(r.err, /internal error/);
  });

  void test('--json prints {"block": …} holding exactly the rendered block', () => {
    // DESIGN.md:258 — "Every command supports --json"; the block is the same five parts the plain output prints.
    const path = writeFile(join(tempDir('bp-progress-'), 'p.json'), JSON.stringify(statusBlock()));
    const r = run(['progress', '--json-file', path, '--json']);
    assert.equal(r.code, EXIT.ok);
    assert.deepEqual(JSON.parse(r.out), {
      block: [
        'BLUEPRINT status · run 1a2b3c · sitting 1',
        '  done   S1 read',
        '  now    S2 ten checks',
        '  next   S3 print one screen',
        '  ————   10 queued · 4 disposed · 6 to go',
      ].join('\n'),
    });
  });

  void test('a flag bp progress does not take is refused, exit 2, naming it', () => {
    const path = writeFile(join(tempDir('bp-progress-'), 'p.json'), JSON.stringify(statusBlock()));
    const r = run(['progress', '--json-file', path, '--mode', 'force']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown flag --mode/);
    assert.equal(r.out, '');
  });
});

// ---- runid ------------------------------------------------------------------------------------------------------------

const SEED = 20260925;
const HEX6 = /^[0-9a-f]{6}$/;

/** The first n ids the seeded source would draw (arrangement only: the injected randomness, not the command). */
function firstDraws(seed: number, n: number): string[] {
  const r = seededRand(seed);
  return Array.from({ length: n }, () => r.hex(3));
}

/** A v37-format run log (repperoni's shape) with one closed entry per id, newest first. */
function v37Log(ids: readonly string[]): string {
  const entries = ids.map((id, i) =>
    [
      `## 2026-09-${String(24 - (i % 20)).padStart(2, '0')} · 10:00 · resolve · run ${id} · skill v37 · sitting 1`,
      `- header: date 2026-09-24 · time 10:00 · command resolve · run ${id} · version 37 · sitting 1 · mode: force`,
      '- closing: CLOSED 10:30 · DRAINED',
      '',
      '---',
      '',
    ].join('\n'),
  );
  return `# Run log — «Demo» Blueprint\n\nAppend-only, newest entry first. Never rewritten, never summarised away.\n\n---\n\n${entries.join('')}`;
}

/** A v21-format (elf) run log: plain heading with no `·` between date and time, column lines, inside a fence. */
function v21Log(id: string): string {
  return [
    '# Run log',
    '',
    '```',
    `2026-08-22 08:54 · resolve · run ${id} · skill v21 · sitting 1 · 4 of 4 queued`,
    'GATE         4 applied, 0 returned',
    'CLOSED 09:20 · DRAINED · run totals: 4 applied',
    '```',
    '',
  ].join('\n');
}

void describe('bp runid', () => {
  void test('prints six lowercase hex characters and nothing else', () => {
    const r = run(['runid', '--home', makeHome()], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
  });

  void test('draws an id even when the home has no record yet', () => {
    const home = join(tempDir('bp-home-'), 'never-created');
    const r = run(['runid', '--home', home], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
  });

  void test('is deterministic under a fixed seed', () => {
    const home = makeHome({ log: v37Log(['0a0b0c']) });
    const a = run(['runid', '--home', home], { seed: SEED });
    const b = run(['runid', '--home', home], { seed: SEED });
    assert.equal(a.code, EXIT.ok);
    assert.equal(a.out, b.out);
  });

  void test('never prints an id already used by an entry in the run log', () => {
    // The first three ids this seed would draw are all taken, so an id that ignored the log would be one of them.
    const taken = firstDraws(SEED, 3);
    const r = run(['runid', '--home', makeHome({ log: v37Log(taken) })], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.ok(!taken.includes(r.out), `${r.out} is already in the log (${taken.join(', ')})`);
  });

  void test('never prints an id already used by a file in record/runs/', () => {
    const taken = firstDraws(SEED, 2);
    const home = makeHome();
    for (const id of taken) writeFile(join(home, 'record', 'runs', `${id}.md`), `# ${id}\n`);
    const r = run(['runid', '--home', home], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.ok(!taken.includes(r.out), `${r.out} already has a runs/ file (${taken.join(', ')})`);
  });

  void test('avoids ids taken in the log and in record/runs/ together', () => {
    const [first = '', second = ''] = firstDraws(SEED, 2);
    const home = makeHome({ log: v37Log([first]) });
    writeFile(join(home, 'record', 'runs', `${second}.md`), `# ${second}\n`);
    const r = run(['runid', '--home', home], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.notEqual(r.out, first);
    assert.notEqual(r.out, second);
  });

  void test('treats an id in a legacy v21 log heading as used', () => {
    // DESIGN.md C5: every existing Blueprint keeps working, v15–v37 logs included.
    const [first = ''] = firstDraws(SEED, 1);
    const r = run(['runid', '--home', makeHome({ log: v21Log(first) })], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.notEqual(r.out, first);
  });

  void test('draws an id from a log with no entry headings at all', () => {
    const r = run(['runid', '--home', makeHome({ log: 'not a run log\n- item: stray line\n' })], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
  });

  void test('resolves a relative --home against the workspace', () => {
    const workspace = tempDir('bp-ws-');
    const [first = ''] = firstDraws(SEED, 1);
    writeFile(join(workspace, 'bp-home', 'record', 'run-log.md'), v37Log([first]));
    const r = run(['runid', '--home', 'bp-home'], { workspace, seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.notEqual(r.out, first);
  });

  void test("without --home it reads the log at the workspace's resolved home", () => {
    // targets §5: one wiki-* folder in the workspace → <home> is its blueprint/ folder.
    const workspace = tempDir('bp-ws-');
    mkdirSync(join(workspace, 'wiki-demo'), { recursive: true });
    const [first = ''] = firstDraws(SEED, 1);
    writeFile(join(workspace, 'wiki-demo', 'blueprint', 'record', 'run-log.md'), v37Log([first]));
    const r = run(['runid'], { workspace, seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.notEqual(r.out, first);
  });

  void test('exhausting its draws, it refuses rather than print a used id', () => {
    // Every id the seed yields in its first 100 draws is taken. Refusing is correct; so is finding an unused one later.
    const taken = firstDraws(SEED, 100);
    const r = run(['runid', '--home', makeHome({ log: v37Log(taken) })], { seed: SEED });
    if (r.code === EXIT.ok) {
      assert.match(r.out, HEX6);
      assert.ok(!taken.includes(r.out), `${r.out} is already in the log`);
    } else {
      assert.equal(r.out, '');
      assert.match(r.err, /could not draw an unused run id/);
    }
  });

  void test('--json prints {"runId": …} carrying the same id the plain output prints', () => {
    // DESIGN.md:258 — "Every command supports --json". Same home, same seed: the same draw.
    const home = makeHome();
    const plain = run(['runid', '--home', home], { seed: SEED });
    const r = run(['runid', '--home', home, '--json'], { seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(plain.out, HEX6);
    assert.deepEqual(JSON.parse(r.out), { runId: plain.out });
  });

  void test('reads the log at a pre-v33 location while the move to <home> is pending (targets §5)', () => {
    // A marked wiki makes <home> wiki-demo/blueprint, which holds no target.md; the record is still at .blueprint/, and
    // "status … reads the pre-v33 location when <home> holds no target.md" — bp runid reads where pre-flight reads.
    const workspace = tempDir('bp-ws-');
    writeFile(join(workspace, 'wiki-demo', '.internal', 'plan.yaml'), 'sections: []\n');
    const [first = ''] = firstDraws(SEED, 1);
    writeFile(
      join(workspace, '.blueprint', 'target.md'),
      'kind: notion\noverview_page_id: 3d4c2628ef9580e29a99c481e093c7a8\n',
    );
    writeFile(join(workspace, '.blueprint', 'record', 'run-log.md'), v37Log([first]));
    const r = run(['runid'], { workspace, seed: SEED });
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, HEX6);
    assert.notEqual(r.out, first);
  });

  void test('a flag bp runid does not take is refused, exit 2, naming it', () => {
    const r = run(['runid', '--home', makeHome(), '--page', 'x'], { seed: SEED });
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown flag --page/);
    assert.equal(r.out, '');
  });
});
