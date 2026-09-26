import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../src/log/parse.ts';
import { ratified, readFacts, rowIdsIn, sittingsSince, type BatchAct, type LogFacts } from '../src/log/facts.ts';
import type { WriteCommand } from '../src/domain/vocab.ts';

// The facts status reads back out of the run log (src/log/facts.ts). Every log below is SYNTHETIC, written in the v38
// bullet shape bp writes (resolve.md R5's samples), with invented product text. Expected values are read off the
// fixture by hand: dates and run ids are the headings' own, row ids are the backticked literals with their hyphens
// removed and lower-cased, and entry indices count headings newest first.
//
// Spec rules exercised:
//   status.md S1 step 4 — the log is the only source for when a question was flagged (C1) and for a NOTE a later check reads.
//   resolve.md R5 — FLAGGED "one per row: the row and its objection"; CARRIED-FORWARD names the row and the late verdict;
//                   RATIFIED/VETOED "one per batch act, each citing the ledger / fixes batch / content manifest by run id
//                   and the line numbers"; GRILL ends `converged: yes | no`; `ledger|fix|manifest <run id> #<n>` lines.
//   challenge.md Q1 — `ratify <run id>` ratifies all three batches; `ratify <run id> defaults|fixes|slots` names one;
//                     `veto <run id> #3 #7` names ledger lines; "a line the human did not name is neither".
//   resolve.md R1 — the first local entry of a pre-v16 Blueprint opens with a NOTE crossover line (status C4 scopes to it).
//   status.md C5 — "a batch unratified past two sittings is named here"; challenge.md Q6 step 9 puts each batch to its human
//                  in the closing report of the run that wrote it.

// ---- fixtures --------------------------------------------------------------------------------------------------------

const PREAMBLE = [
  '# Run log — «Lantern Club» Blueprint',
  '',
  'Append-only, newest entry first. Never rewritten, never summarised away.',
  '',
  '---',
  '',
];

interface Heading {
  date: string;
  command: WriteCommand;
  run: string;
  sitting?: number;
}

/** One v38 entry: heading, header line, the given lines, a closing line. */
function entry(h: Heading, lines: string[]): string[] {
  const sitting = h.sitting ?? 1;
  return [
    `## ${h.date} · 10:00 · ${h.command} · run ${h.run} · skill v38 · sitting ${sitting}`,
    '',
    `- header: date ${h.date} · time 10:00 · command ${h.command} · run ${h.run} · version 38 · sitting ${sitting}`,
    ...lines,
    '- closing: CLOSED 10:30 · DRAINED',
    '',
    '---',
    '',
  ];
}

/** The facts of a log made of the given entries, newest first. */
const factsOf = (...entries: string[][]): LogFacts => readFacts(parseLog([...PREAMBLE, ...entries.flat()].join('\n')));

const ROW_A = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const ROW_A_ID = '1f2e3d4c5b6a49788a9b0c1d2e3f4a5b'; // ROW_A without hyphens
const ROW_B = '0a0b0c0d0e0f40418293a4b5c6d7e8f9';

const act = (
  a: BatchAct['act'],
  kind: BatchAct['kind'],
  runId: string,
  lines: BatchAct['lines'],
  date: string,
): BatchAct => ({ act: a, kind, runId, lines, date });

// ---- flags (status C1) ------------------------------------------------------------------------------------------------

void describe('readFacts: FLAGGED lines (status C1 reads the flag and its age from the log)', () => {
  void test('a FLAGGED line yields its row id, title, objection, and the date and run id of its entry', () => {
    const f = factsOf(
      entry({ date: '2026-09-20', command: 'resolve', run: '7f3a2c' }, [
        `- FLAGGED: «What is the late-return fee?» \`${ROW_A}\` · the answer is only a link — write the decision in a sentence`,
      ]),
    );
    assert.deepEqual(f.flags, [
      {
        rowId: ROW_A_ID,
        title: 'What is the late-return fee?',
        objection: 'the answer is only a link — write the decision in a sentence',
        date: '2026-09-20',
        runId: '7f3a2c',
      },
    ]);
  });

  void test('a FLAGGED line naming the row by title alone (the R5 sample) has a null row id', () => {
    const f = factsOf(
      entry({ date: '2026-09-20', command: 'resolve', run: '7f3a2c' }, [
        '- FLAGGED: «What is the refund window?» · the answer is only a link — write the decision in a sentence',
      ]),
    );
    assert.equal(f.flags.length, 1);
    assert.equal(f.flags[0]?.rowId, null);
    assert.equal(f.flags[0]?.title, 'What is the refund window?');
  });

  void test('the objection is everything after the first separator, a trailing proposal hash included', () => {
    // resolve.md R5's second FLAGGED sample: the objection, then the hash R3.1's overview route pins.
    const f = factsOf(
      entry({ date: '2026-09-20', command: 'resolve', run: '7f3a2c' }, [
        '- FLAGGED: «Can a customer cancel after paying?» · answer "as agreed with ops on the call" — nothing derivable · 3afc…b75',
      ]),
    );
    assert.equal(f.flags[0]?.objection, 'answer "as agreed with ops on the call" — nothing derivable · 3afc…b75');
  });

  void test('a title quoting a feature name in nested guillemets is read whole', () => {
    const f = factsOf(
      entry({ date: '2026-09-20', command: 'resolve', run: '7f3a2c' }, [
        '- FLAGGED: «Does «Borrow a lantern» cover renewals?» · no behaviour derivable',
      ]),
    );
    assert.equal(f.flags[0]?.title, 'Does «Borrow a lantern» cover renewals?');
  });

  void test('flags from every entry are read, the newest entry first', () => {
    const f = factsOf(
      entry({ date: '2026-09-22', command: 'resolve', run: 'b2b2b2' }, [
        '- FLAGGED: «What is the late-return fee?» · the answer is only a link',
      ]),
      entry({ date: '2026-09-18', command: 'resolve', run: 'a1a1a1' }, [
        '- FLAGGED: «What is the late-return fee?» · answer names no single direction',
      ]),
    );
    assert.deepEqual(
      f.flags.map((x) => [x.date, x.runId, x.objection]),
      [
        ['2026-09-22', 'b2b2b2', 'the answer is only a link'],
        ['2026-09-18', 'a1a1a1', 'answer names no single direction'],
      ],
    );
  });
});

// ---- carried forward (status C4) --------------------------------------------------------------------------------------

void describe('readFacts: CARRIED-FORWARD lines (status C4 reads a late verdict back)', () => {
  void test('a CARRIED-FORWARD line keeps its text, the row ids it names, and its entry date and run id', () => {
    const text = `«Can a member renew a loan?» \`${ROW_A}\` · late check verdict Wrong — disagrees with «Borrow a lantern» FR-2`;
    const f = factsOf(entry({ date: '2026-09-21', command: 'resolve', run: '6dca4f' }, [`- CARRIED-FORWARD: ${text}`]));
    assert.deepEqual(f.carriedForward, [{ text, rowIds: [ROW_A_ID], date: '2026-09-21', runId: '6dca4f' }]);
  });
});

// ---- batches (status C5, unsettled line 5) ----------------------------------------------------------------------------

void describe('readFacts: batch lines `ledger|fix|manifest <run id> #n`', () => {
  const f = factsOf(
    entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a' }, [
      '- ledger 9f2c1a #1: late returns default to seven days · standard practice',
      '- ledger 9f2c1a #2: a lantern is lent for one evening · standard practice',
      '- fix 9f2c1a #1: «Borrow a lantern» FR-1 reworded to name the member',
      '- manifest 9f2c1a #1: «Borrow a lantern» the lantern catalogue · supplied by the club secretary',
    ]),
  );

  void test('ledger lines become the defaults batch of their run id, each line numbered with its text', () => {
    const b = f.batches.find((x) => x.kind === 'defaults');
    assert.deepEqual(b, {
      kind: 'defaults',
      runId: '9f2c1a',
      date: '2026-09-19',
      lines: [
        { n: 1, text: 'late returns default to seven days · standard practice' },
        { n: 2, text: 'a lantern is lent for one evening · standard practice' },
      ],
    });
  });

  void test('fix lines become the fixes batch and manifest lines the slots batch', () => {
    assert.deepEqual(f.batches.map((b) => [b.kind, b.runId, b.lines.map((l) => l.n)]).sort(), [
      ['defaults', '9f2c1a', [1, 2]],
      ['fixes', '9f2c1a', [1]],
      ['slots', '9f2c1a', [1]],
    ]);
  });

  void test('lines of one batch written in two sittings of the same run join that one batch', () => {
    const two = factsOf(
      entry({ date: '2026-09-20', command: 'challenge', run: '9f2c1a', sitting: 2 }, [
        '- ledger 9f2c1a #2: a lantern is lent for one evening',
      ]),
      entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a', sitting: 1 }, [
        '- ledger 9f2c1a #1: late returns default to seven days',
      ]),
    );
    assert.equal(two.batches.length, 1);
    assert.deepEqual(two.batches[0]?.lines.map((l) => l.n).sort(), [1, 2]);
  });

  void test('batches of different runs are kept apart', () => {
    const two = factsOf(
      entry({ date: '2026-09-20', command: 'challenge', run: '4d7fbd' }, [
        '- ledger 4d7fbd #1: a returned lantern is checked before relending',
      ]),
      entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a' }, [
        '- ledger 9f2c1a #1: late returns default to seven days',
      ]),
    );
    assert.deepEqual(two.batches.map((b) => b.runId).sort(), ['4d7fbd', '9f2c1a']);
  });
});

// ---- acts (RATIFIED / VETOED) -----------------------------------------------------------------------------------------

void describe('readFacts: RATIFIED and VETOED lines name the batches they act on', () => {
  const on = (line: string): LogFacts =>
    factsOf(entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [line]));

  void test('"defaults ledger 4d7fbd, all 8 lines (#1–#8)" ratifies the whole defaults batch of run 4d7fbd', () => {
    const f = on(
      '- RATIFIED: defaults ledger 4d7fbd, all 8 lines (#1–#8) · "ratify 4d7fbd defaults" · spot-checked #2, #5',
    );
    assert.deepEqual(f.acts, [act('RATIFIED', 'defaults', '4d7fbd', 'all', '2026-09-24')]);
  });

  void test('"fixes batch 16f7e6, all 3 lines (#1–#3), and content manifest 16f7e6 #1" is two acts: all fixes, and slot line 1', () => {
    const f = on(
      '- RATIFIED: fixes batch 16f7e6, all 3 lines (#1–#3), and content manifest 16f7e6 #1 · "ratify 16f7e6 fixes and slots"',
    );
    assert.deepEqual(f.acts, [
      act('RATIFIED', 'fixes', '16f7e6', 'all', '2026-09-24'),
      act('RATIFIED', 'slots', '16f7e6', [1], '2026-09-24'),
    ]);
  });

  void test("the human's words after the first separator are not read as a further act", () => {
    const f = on(
      '- RATIFIED: defaults ledger 4d7fbd #2 · "ratify 4d7fbd and the fixes 16f7e6 later" · spot-checked #2',
    );
    assert.deepEqual(f.acts, [act('RATIFIED', 'defaults', '4d7fbd', [2], '2026-09-24')]);
  });

  void test('a VETOED line naming two ledger lines vetoes exactly those two', () => {
    const f = on(
      '- VETOED: ledger 9f2c1a #3 #7 · "veto 9f2c1a #3 #7" · #3 matched by content to "late returns default to seven days"',
    );
    assert.deepEqual(f.acts, [act('VETOED', 'defaults', '9f2c1a', [3, 7], '2026-09-24')]);
  });

  void test('a range "#2–#4" names lines 2, 3 and 4', () => {
    const f = on('- RATIFIED: defaults ledger 9f2c1a #2–#4 · "ratify 2 to 4"');
    assert.deepEqual(f.acts, [act('RATIFIED', 'defaults', '9f2c1a', [2, 3, 4], '2026-09-24')]);
  });

  void test('"ratify 9f2c1a defaults" (the Q1 form naming one batch) ratifies that whole batch', () => {
    const f = on('- RATIFIED: ratify 9f2c1a defaults · "ratify 9f2c1a defaults"');
    assert.deepEqual(f.acts, [act('RATIFIED', 'defaults', '9f2c1a', 'all', '2026-09-24')]);
  });

  void test('"veto 9f2c1a #3" (the Q1 command form) vetoes ledger line 3 of run 9f2c1a', () => {
    // challenge.md Q1: "`veto <run id> #3 #7` names ledger lines (the numbered batch …)" — the defaults ledger.
    const f = on('- VETOED: veto 9f2c1a #3 · "veto 9f2c1a #3"');
    assert.deepEqual(f.acts, [act('VETOED', 'defaults', '9f2c1a', [3], '2026-09-24')]);
  });

  void test('"ratify 9f2c1a" (the Q1 form with no batch named) ratifies all three of that run\'s batches', () => {
    // challenge.md Q1: "`ratify <run id>` ratifies all three of that run's batches".
    const f = on('- RATIFIED: ratify 9f2c1a · "ratify 9f2c1a"');
    assert.deepEqual(
      [...f.acts].sort((a, b) => a.kind.localeCompare(b.kind)),
      [
        act('RATIFIED', 'defaults', '9f2c1a', 'all', '2026-09-24'),
        act('RATIFIED', 'fixes', '9f2c1a', 'all', '2026-09-24'),
        act('RATIFIED', 'slots', '9f2c1a', 'all', '2026-09-24'),
      ],
    );
  });
});

// ---- ratified() -------------------------------------------------------------------------------------------------------

void describe('ratified(): a batch line is ratified when a RATIFIED act covers it and no VETOED act does', () => {
  const ledger = entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a' }, [
    '- ledger 9f2c1a #1: late returns default to seven days',
    '- ledger 9f2c1a #2: a lantern is lent for one evening',
    '- ledger 9f2c1a #3: a lost lantern is reported the same evening',
    '- fix 9f2c1a #1: «Borrow a lantern» FR-1 reworded to name the member',
  ]);

  void test('a line under a whole-batch RATIFIED act is ratified', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [
        '- RATIFIED: defaults ledger 9f2c1a, all 3 lines (#1–#3) · "ratify 9f2c1a defaults"',
      ]),
      ledger,
    );
    assert.equal(ratified(f, 'defaults', '9f2c1a', 2), true);
  });

  void test('a line no act names is not ratified, however long it has stood', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'c3c3c3' }, [
        '- item: «Can a member borrow two lanterns?» · Clean · «Borrow a lantern» FR-1',
      ]),
      ledger,
    );
    assert.equal(ratified(f, 'defaults', '9f2c1a', 1), false);
  });

  void test('a line the RATIFIED act did not name is neither ratified nor vetoed', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [
        '- RATIFIED: defaults ledger 9f2c1a #1 #2 · "ratify one and two"',
      ]),
      ledger,
    );
    assert.deepEqual(
      [1, 2, 3].map((n) => ratified(f, 'defaults', '9f2c1a', n)),
      [true, true, false],
    );
  });

  void test('"ratify the rest" after a veto leaves the vetoed line unratified', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [
        '- VETOED: ledger 9f2c1a #3 · "veto 9f2c1a #3"',
        '- RATIFIED: defaults ledger 9f2c1a, all 3 lines (#1–#3) · "ratify the rest"',
      ]),
      ledger,
    );
    assert.deepEqual(
      [1, 2, 3].map((n) => ratified(f, 'defaults', '9f2c1a', n)),
      [true, true, false],
    );
  });

  void test("ratifying the fixes batch does not ratify the same run's defaults ledger", () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [
        '- RATIFIED: fixes batch 9f2c1a, all 1 lines (#1) · "ratify 9f2c1a fixes"',
      ]),
      ledger,
    );
    assert.deepEqual([ratified(f, 'fixes', '9f2c1a', 1), ratified(f, 'defaults', '9f2c1a', 1)], [true, false]);
  });

  void test("ratifying another run's ledger does not ratify this one", () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'c3c3c3' }, [
        '- RATIFIED: defaults ledger 4d7fbd, all 8 lines (#1–#8) · "ratify 4d7fbd"',
      ]),
      ledger,
    );
    assert.equal(ratified(f, 'defaults', '9f2c1a', 1), false);
  });
});

// ---- sittingsSince() --------------------------------------------------------------------------------------------------

void describe('sittingsSince(): how many sittings a batch has waited (status C5 "past two sittings")', () => {
  void test('counts the entries opened after the one run entry that wrote the batch', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, []),
      entry({ date: '2026-09-23', command: 'add', run: 'c3c3c3' }, []),
      entry({ date: '2026-09-22', command: 'resolve', run: 'b2b2b2' }, []),
      entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a' }, [
        '- ledger 9f2c1a #1: late returns default to seven days',
      ]),
    );
    assert.equal(sittingsSince(f, '9f2c1a'), 3);
  });

  void test('a batch in the newest entry has waited no sitting', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: '9f2c1a' }, [
        '- ledger 9f2c1a #1: late returns default to seven days',
      ]),
    );
    assert.equal(sittingsSince(f, '9f2c1a'), 0);
  });

  void test("a multi-sitting run's batch waits from that run's last sitting, where its closing report put it to the human", () => {
    // challenge.md Q6 step 9: the batch is printed in the closing report; later sittings of the same run are not waits.
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, []),
      entry({ date: '2026-09-23', command: 'add', run: 'c3c3c3' }, []),
      entry({ date: '2026-09-20', command: 'challenge', run: '9f2c1a', sitting: 2 }, []),
      entry({ date: '2026-09-19', command: 'challenge', run: '9f2c1a', sitting: 1 }, [
        '- ledger 9f2c1a #1: late returns default to seven days',
      ]),
    );
    assert.equal(sittingsSince(f, '9f2c1a'), 2);
  });
});

// ---- grills (the NEXT line) -------------------------------------------------------------------------------------------

void describe('readFacts: GRILL lines (status reads converged for the NEXT line)', () => {
  const grill = (verdict: string): string =>
    `- GRILL: scale delta · «Borrow a lantern» 0123456789ab (delta) · converged: ${verdict}`;

  void test('a GRILL line ending "converged: yes" is converged, with its run id, date and entry index', () => {
    const f = factsOf(entry({ date: '2026-09-24', command: 'challenge', run: '9f2c1a' }, [grill('yes')]));
    assert.deepEqual(f.grills, [{ runId: '9f2c1a', date: '2026-09-24', converged: true, entryIndex: 0 }]);
  });

  void test('a GRILL line ending "converged: no" is not converged', () => {
    const f = factsOf(entry({ date: '2026-09-24', command: 'challenge', run: '9f2c1a' }, [grill('no')]));
    assert.equal(f.grills[0]?.converged, false);
  });

  void test("a GRILL line's entry index counts the newer entries above it", () => {
    const f = factsOf(
      entry({ date: '2026-09-25', command: 'resolve', run: 'd4d4d4' }, []),
      entry({ date: '2026-09-24', command: 'challenge', run: '9f2c1a' }, [grill('yes')]),
    );
    assert.deepEqual(
      f.grills.map((g) => [g.runId, g.entryIndex]),
      [['9f2c1a', 1]],
    );
  });

  void test('grills are listed newest first', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'challenge', run: 'b2b2b2' }, [grill('no')]),
      entry({ date: '2026-09-20', command: 'challenge', run: 'a1a1a1' }, [grill('yes')]),
    );
    assert.deepEqual(
      f.grills.map((g) => [g.runId, g.converged]),
      [
        ['b2b2b2', false],
        ['a1a1a1', true],
      ],
    );
  });
});

// ---- crossover (status C4's scope) ------------------------------------------------------------------------------------

void describe('readFacts: the crossover NOTE (resolve.md R1; status C4 scopes to rows after it)', () => {
  void test('a crossover NOTE gives the date of the entry that carries it', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, []),
      entry({ date: '2026-08-01', command: 'resolve', run: '5e5e5e' }, [
        '- NOTE: crossover — the pre-v16 run log stays on the Notion page «Run log», last entry 2026-07-30, skill v15',
      ]),
    );
    assert.equal(f.crossover, '2026-08-01');
  });

  void test('a log with no crossover NOTE has none, whatever other NOTE lines it carries', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, [
        '- NOTE: working folder moved from .blueprint/ to wiki-lantern/blueprint/',
      ]),
    );
    assert.equal(f.crossover, null);
  });
});

// ---- named rows (status C4) -------------------------------------------------------------------------------------------

void describe('readFacts: the rows any entry names (status C4 — Applied rows nothing wrote)', () => {
  const f = factsOf(
    entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, [
      `- item: «Can a member borrow two lanterns?» \`${ROW_A}\` · Clean · «Borrow a lantern» FR-1 · body 0123456789ab`,
      `- MARKERS: 1 removed, row \`${ROW_B}\` cited · 0 still carried`,
      '- FLAGGED: «What is the late-return fee?» · the answer is only a link',
    ]),
  );

  void test('a backticked row id on any line kind is named, hyphens removed and lower-cased', () => {
    assert.deepEqual([...f.namedRowIds].sort(), [ROW_B, ROW_A_ID].sort());
  });

  void test('a hyphenated and an unhyphenated spelling of one id are one named row', () => {
    const g = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, [
        `- item: \`${ROW_A}\` · Clean`,
        `- item: \`${ROW_A_ID.toUpperCase()}\` · no change`,
      ]),
    );
    assert.deepEqual([...g.namedRowIds], [ROW_A_ID]);
  });

  void test('an item line names its «title»; a FLAGGED line does not', () => {
    assert.deepEqual([...f.namedTitles], ['Can a member borrow two lanterns?']);
  });

  void test('rowIdsIn finds only backticked ids, each normalised', () => {
    assert.deepEqual(rowIdsIn(`rows \`${ROW_A}\` and \`${ROW_B}\``), [ROW_A_ID, ROW_B]);
  });
});

// ---- the last run -----------------------------------------------------------------------------------------------------

void describe('readFacts: the last run (the status header)', () => {
  void test('is the newest entry: its date, command and run id', () => {
    const f = factsOf(
      entry({ date: '2026-09-24', command: 'resolve', run: 'd4d4d4' }, []),
      entry({ date: '2026-09-20', command: 'challenge', run: '9f2c1a' }, []),
    );
    assert.deepEqual(f.lastRun, { date: '2026-09-24', command: 'resolve', runId: 'd4d4d4' });
  });

  void test('is null for a log with no entry', () => {
    assert.equal(factsOf().lastRun, null);
  });
});
