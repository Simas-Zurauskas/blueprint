import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselines,
  depthOf,
  planResolve,
  queueOf,
  type Item,
  type R2Flag,
  type ResolvePlan,
} from '../src/resolve/plan.ts';
import { makeFeature, makeOverview, type FeatureRec, type Snapshot } from '../src/snapshot.ts';
import { parseLog, type ParsedLog } from '../src/log/parse.ts';
import { STATUSES } from '../src/domain/vocab.ts';
import type { Question } from '../src/domain/question.ts';
import { NOW_ISO } from './support/index.ts';

// resolve.md R1 (the queue) and R2 (is there anything to apply?) as src/resolve/plan.ts executes them. Every fixture is
// SYNTHETIC — an invented lantern-lending club — and every expected value is derived by hand from the spec lines cited
// on each describe block. Body hashes were computed in a shell, never by the code under test (see each constant).
//
// Spec rules exercised:
//   R1     — "The queue is exactly: Status = Answered and Answer & why non-empty"; every other status excluded by name.
//   R2.1   — Touches resolves to features that exist, or is empty (project-level); more than one feature goes down the
//            same project-level serial path; a missing feature, a link-only answer and a pointer naming no single
//            direction (or leaving a <value> slot unfilled) fail and end Flagged with the one-line fix as objection.
//   R2.3   — a body changed outside this seam flags every queued row touching it; the flag records the current hash as
//            the new baseline; the baseline is the newest recorded hash from an item line or HASHES line, whichever is
//            later; "A body no entry has ever hashed has no baseline and is not a finding".
//   R2.4   — a named block missing outright is a finding; an empty Rabbit holes or Edge cases is not; a Behaviour with no
//            numbered requirement is exempt where the row is seed-eligible; every other row touching a non-spec body is
//            Flagged naming the missing block.
//   R3     — items grouped by the one feature their Touches names; project-level rows run in one serial pass after.
//   challenge.md Q4 — Why asked's closing clause carries `· depth n`, values open (1, 2, 3 and beyond).

// ---- identities --------------------------------------------------------------------------------------------------------

const BORROW_ID = 'a1a1a1a1b2b2c3c3d4d4e5e5e5e5e5e5';
const BORROW_ID_DASHED = 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5';
const RETURN_ID = 'f0f0f0f0a1a1b2b2c3c3d4d4d4d4d4d4';
const SLOT_ID = 'c0c0c0c0d1d1e2e2f3f3a4a4a4a4a4a4';
const HALF_ID = 'b5b5b5b5c6c6d7d7e8e8f9f9f9f9f9f9';

const ROW_1 = '0a0a0a0a0b0b0c0c0d0d0e0e0e0e0e0e';
const ROW_2 = '1b1b1b1b2c2c3d3d4e4e5f5f5f5f5f5f';
const ROW_3 = '2c2c2c2c3d3d4e4e5f5f6a6a6a6a6a6a';
const OTHER_ROW = '9f9f9f9f8e8e7d7d6c6c5b5b5b5b5b5b';

/** An old, recorded 12-hex hash that no current fixture body has. */
const STALE_H12 = '0123456789ab';

// ---- bodies ------------------------------------------------------------------------------------------------------------

const BORROW_BODY = [
  '## Why',
  'Members borrow lanterns for night walks.',
  '',
  '## Behaviour',
  'FR-1 — When a member taps Borrow, the system reserves the lantern for them.',
  '',
  '## Edge cases',
  '',
  '## Rabbit holes',
  '',
  '## Not doing',
  'No delivery — because members collect in person; revisit if a courier partner appears.',
].join('\n');
// printf '<BORROW_BODY, lines joined by \n, no trailing newline>' | shasum -a 256
//   → 1ccd042349a75c52584ad7a0e2af84f1fd5fe97512fb6b9a8a0a9638d97d707c
const BORROW_H12 = '1ccd042349a7';

const RETURN_BODY = [
  '## Why',
  'Members bring lanterns back after a walk.',
  '',
  '## Behaviour',
  'FR-1 — When a member scans a returned lantern, the system marks it available.',
  '',
  '## Edge cases',
  '',
  '## Rabbit holes',
  '',
  '## Not doing',
  'No late fees — because the club runs on trust; revisit if lanterns go missing.',
].join('\n');
// printf '<RETURN_BODY>' | shasum -a 256 → 58a38b026e45301921b6b402d7b8a22edc3c44af739dc130d3f6d8fad2217cf4 (not
// asserted below; recorded so a reader can see no fixture log names it).

/** Two markers on two requirements: FR-1's links ROW_1, FR-2's links another row. */
const SLOT_BODY = [
  '## Why',
  'Members book a pickup slot before collecting.',
  '',
  '## Behaviour',
  `FR-1 — When a member picks a slot, the system holds it for them. [NEEDS CLARIFICATION: how long is a slot held? → Question: https://app.notion.com/p/${ROW_1}]`,
  `FR-2 — When a slot is full, the system hides it. [NEEDS CLARIFICATION: can staff override a full slot? → Question: https://app.notion.com/p/${OTHER_ROW}]`,
  '',
  '## Edge cases',
  '',
  '## Rabbit holes',
  '',
  '## Not doing',
  'No waitlist — because slots are short; revisit if members ask for one.',
].join('\n');

const withoutBlock = (body: string, heading: string): string => {
  const lines = body.split('\n');
  const at = lines.indexOf(`## ${heading}`);
  if (at < 0) throw new Error(`fixture has no ## ${heading}`);
  let end = at + 1;
  while (end < lines.length && !(lines[end] ?? '').startsWith('## ')) end++;
  return [...lines.slice(0, at), ...lines.slice(end)].join('\n');
};

/** BORROW_BODY with an empty Behaviour: the heading is there, no requirement is. */
const EMPTY_BEHAVIOUR_BODY = BORROW_BODY.replace(
  'FR-1 — When a member taps Borrow, the system reserves the lantern for them.\n',
  '',
);

// ---- factories ---------------------------------------------------------------------------------------------------------

function feature(id: string, name: string, content: string): FeatureRec {
  return makeFeature({
    id,
    name,
    whatItDoes: `${name}.`,
    area: 'Lending',
    created: null,
    questionRefs: [],
    content,
    source: `fetch-${id}`,
    adHoc: [],
  });
}

const borrow = (): FeatureRec => feature(BORROW_ID, 'Borrow a lantern', BORROW_BODY);
const giveBack = (): FeatureRec => feature(RETURN_ID, 'Return a lantern', RETURN_BODY);

function question(over: Partial<Question> & Pick<Question, 'id'>): Question {
  return {
    question: 'Can a member borrow two lanterns at once?',
    status: 'Answered',
    statusRaw: 'Answered',
    owner: '',
    answer: 'Yes — a member may hold up to two lanterns at a time.',
    whyAsked: 'FR-1 of «Borrow a lantern» says "the lantern", which reads as one per member. · depth 1',
    directions: '',
    whyFlagged: '',
    touches: [BORROW_ID],
    created: null,
    adHoc: [],
    ...over,
  };
}

function snapshot(
  features: FeatureRec[],
  questions: Question[],
  kind: Snapshot['target']['kind'] = 'notion',
): Snapshot {
  return {
    target: { kind, address: kind === 'notion' ? 'd0d0d0d0e1e1f2f2a3a3b4b4b4b4b4b4' : '/tmp/blueprint' },
    readAt: NOW_ISO,
    overview: makeOverview('d0d0d0d0e1e1f2f2a3a3b4b4b4b4b4b4', '## TL;DR\nA club lends lanterns to its members.\n'),
    features,
    questions,
    incomplete: [],
    legacyBoard: false,
    hasWhyFlagged: true,
  };
}

/** A run log, entries newest first, each with the given body lines between its header and its closing line. */
function logOf(...entries: { date: string; runId: string; lines: string[] }[]): ParsedLog {
  const text = ['# Run log', '', 'Append-only, newest entry first.', '', '---', ''];
  for (const e of entries) {
    text.push(
      `## ${e.date} · 10:00 · resolve · run ${e.runId} · skill v38 · sitting 1`,
      '',
      `- header: date ${e.date} · time 10:00 · command resolve · run ${e.runId} · version 38 · sitting 1`,
      ...e.lines,
      '- closing: CLOSED 10:30 · DRAINED',
      '',
      '---',
      '',
    );
  }
  return parseLog(text.join('\n'));
}

const writtenWith = (hash: string, name = 'Borrow a lantern', id = BORROW_ID_DASHED): string =>
  `- item: «${name}» \`${id}\` · q-01 · written · FR-1 · read back line for line · body ${hash}`;

const flagsFor = (p: ResolvePlan, route: R2Flag['route']): string[] =>
  p.flags.filter((f) => f.route === route).map((f) => f.row.id);
const itemRows = (p: ResolvePlan): string[] => p.items.map((i) => i.row.id);

function onlyItem(p: ResolvePlan): Item {
  assert.equal(
    p.items.length,
    1,
    `expected exactly one item, got ${p.items.length}; flags: ${p.flags.map((f) => f.objection).join(' | ')}`,
  );
  const it = p.items[0];
  if (!it) throw new assert.AssertionError({ message: 'no item' });
  return it;
}

function onlyFlag(p: ResolvePlan): R2Flag {
  assert.equal(p.flags.length, 1, `expected exactly one flag, got ${p.flags.length}`);
  const f = p.flags[0];
  if (!f) throw new assert.AssertionError({ message: 'no flag' });
  return f;
}

// ---- R1: the queue -----------------------------------------------------------------------------------------------------

void describe('queueOf — R1: Status = Answered and Answer & why non-empty', () => {
  void test('queues an Answered row whose answer is non-empty', () => {
    const s = snapshot([borrow()], [question({ id: ROW_1 })]);
    assert.deepEqual(
      queueOf(s).map((q) => q.id),
      [ROW_1],
    );
  });

  void test('leaves out an Answered row whose answer is blank or only whitespace', () => {
    const s = snapshot([borrow()], [question({ id: ROW_1, answer: '' }), question({ id: ROW_2, answer: '  \n\t ' })]);
    assert.deepEqual(queueOf(s), []);
  });

  void test('leaves out every status other than Answered, a legacy value included, even with an answer', () => {
    const others = STATUSES.filter((st) => st !== 'Answered').map((st, i) =>
      question({ id: `q-0${i + 1}`, status: st, statusRaw: st }),
    );
    const legacy = question({ id: 'q-09', status: null, statusRaw: 'Proposed' });
    assert.deepEqual(queueOf(snapshot([borrow()], [...others, legacy])), []);
  });
});

// ---- challenge.md Q4: the depth clause ---------------------------------------------------------------------------------

void describe('depthOf — the `· depth n` closing clause of Why asked', () => {
  void test('reads the depth from the closing clause', () => {
    assert.equal(depthOf('FR-2 of «Return a lantern» was written from an answer. · depth 2'), 2);
  });

  void test('reads the depth when the clause ends with a full stop', () => {
    assert.equal(depthOf('Derived from an answer-written line. · depth 3.'), 3);
  });

  void test('reads a depth past nine — the values are open, not a fixed pair', () => {
    assert.equal(depthOf('A long chain of derived answers. · depth 12'), 12);
  });

  void test('is 1 when Why asked carries no depth clause', () => {
    assert.equal(depthOf('Nobody said what happens when a lantern breaks.'), 1);
  });

  void test('still reads the clause once a proposed block text has been appended after it', () => {
    const why = [
      'The overview never says who the club is for. · depth 2',
      '',
      'Proposed block text:',
      'Members of a walking club who borrow lanterns.',
    ].join('\n');
    assert.equal(depthOf(why), 2);
  });
});

// ---- R2.3's baseline ---------------------------------------------------------------------------------------------------

void describe('baselines — R2.3: the newest recorded hash for each body', () => {
  void test('is empty when there is no run log', () => {
    assert.equal(baselines(null).size, 0);
  });

  void test('an item line with `body <12hex>` sets the baseline under the feature «name»', () => {
    const b = baselines(logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }));
    assert.deepEqual(b.get('«Borrow a lantern»'), { hash: STALE_H12, runId: 'a1b2c3', date: '2026-09-20' });
  });

  void test('an item line carrying the feature id sets the baseline under the canonical id too', () => {
    const b = baselines(logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }));
    assert.deepEqual(b.get(BORROW_ID), { hash: STALE_H12, runId: 'a1b2c3', date: '2026-09-20' });
  });

  void test('a HASHES line sets the baseline for every body it names', () => {
    const b = baselines(
      logOf({
        date: '2026-09-20',
        runId: 'a1b2c3',
        lines: [`- HASHES: «Borrow a lantern» ${STALE_H12} · «Return a lantern» abcdefabcdef`],
      }),
    );
    assert.deepEqual(
      [b.get('«Borrow a lantern»')?.hash, b.get('«Return a lantern»')?.hash],
      [STALE_H12, 'abcdefabcdef'],
    );
  });

  void test('the newest entry naming a body wins over an older one', () => {
    const b = baselines(
      logOf(
        { date: '2026-09-22', runId: 'b2c3d4', lines: [writtenWith(BORROW_H12)] },
        { date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] },
      ),
    );
    assert.deepEqual(b.get('«Borrow a lantern»'), { hash: BORROW_H12, runId: 'b2c3d4', date: '2026-09-22' });
  });

  void test('within one entry the later line wins', () => {
    const b = baselines(
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12), writtenWith(BORROW_H12)] }),
    );
    assert.equal(b.get('«Borrow a lantern»')?.hash, BORROW_H12);
  });

  void test('a newer write that recorded "hash not taken" makes the baseline void', () => {
    const b = baselines(
      logOf(
        {
          date: '2026-09-22',
          runId: 'b2c3d4',
          lines: [
            `- item: «Borrow a lantern» \`${BORROW_ID_DASHED}\` · q-01 · written · FR-2 added · read back line for line · body hash not taken`,
          ],
        },
        { date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] },
      ),
    );
    assert.deepEqual(b.get('«Borrow a lantern»'), { hash: null, runId: 'b2c3d4', date: '2026-09-22' });
  });

  void test('a re-queued item that names a body it did not write leaves the older baseline standing', () => {
    // R5's own sample line: `item: «Should the menu cache?» · re-queued · … · belongs to «Offline behaviour» · body —`.
    // Nothing was written into the body it names, so it records no hash; R2.3 compares against the newest RECORDED one.
    const b = baselines(
      logOf(
        {
          date: '2026-09-22',
          runId: 'b2c3d4',
          lines: [
            '- item: «Can a lantern be booked ahead?» · re-queued · 0a0a…0e0e · belongs to «Borrow a lantern» · body —',
          ],
        },
        { date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] },
      ),
    );
    assert.deepEqual(b.get('«Borrow a lantern»'), { hash: STALE_H12, runId: 'a1b2c3', date: '2026-09-20' });
  });
});

// ---- R2.1 --------------------------------------------------------------------------------------------------------------

void describe('planResolve — R2.1 per queued row', () => {
  const DIRECTIONS = [
    '1. Hold a slot for fifteen minutes. Why: most pickups happen within that.',
    '2. Hold a slot until the end of the day. Why: members are often late.',
  ].join('\n');
  const SLOTTED = [
    '1. Hold a slot for <minutes> minutes. Why: pickups are quick.',
    '2. Hold a slot until the end of the day. Why: members are often late.',
  ].join('\n');

  void test('flags a row whose Touches names a feature that does not exist', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1, touches: ['deadbeefdeadbeefdeadbeefdeadbeef'] })]),
      null,
    );
    assert.deepEqual([flagsFor(p, 'R2.1'), itemRows(p)], [[ROW_1], []]);
  });

  void test('flags a pointer that names more than one direction', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1, answer: '1 or 2', directions: DIRECTIONS })]),
      null,
    );
    assert.deepEqual([flagsFor(p, 'R2.1'), itemRows(p)], [[ROW_1], []]);
  });

  void test('flags a bare pointer at a direction with an unfilled <value> slot, naming the slot', () => {
    const p = planResolve(snapshot([borrow()], [question({ id: ROW_1, answer: '1', directions: SLOTTED })]), null);
    const f = onlyFlag(p);
    assert.deepEqual([f.route, f.objection.includes('<minutes>')], ['R2.1', true]);
  });

  void test('flags an answer that is only a link', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1, answer: 'See https://docs.example.com/lending-policy.pdf' })]),
      null,
    );
    assert.deepEqual([flagsFor(p, 'R2.1'), itemRows(p)], [[ROW_1], []]);
  });

  void test('every R2.1 objection is a single non-empty line', () => {
    const p = planResolve(
      snapshot(
        [borrow()],
        [
          question({ id: ROW_1, touches: ['deadbeefdeadbeefdeadbeefdeadbeef'] }),
          question({ id: ROW_2, answer: 'both', directions: DIRECTIONS }),
          question({ id: ROW_3, answer: 'https://docs.example.com/lending-policy.pdf' }),
        ],
      ),
      null,
    );
    assert.equal(p.flags.length, 3);
    for (const f of p.flags)
      assert.match(
        f.objection,
        /^[^\n]+$/,
        `objection for ${f.row.id} is not one line: ${JSON.stringify(f.objection)}`,
      );
  });

  void test("dereferences a pointer at one direction to that direction's decision clause, never its why", () => {
    const it = onlyItem(
      planResolve(snapshot([borrow()], [question({ id: ROW_1, answer: '2', directions: DIRECTIONS })]), null),
    );
    assert.deepEqual(it.reading.kind === 'pointer' ? [it.reading.n, it.reading.decision] : it.reading.kind, [
      2,
      'Hold a slot until the end of the day.',
    ]);
  });

  void test('a pointer that supplies the value its direction leaves open is queued as an item', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1, answer: '1, twenty', directions: SLOTTED })]),
      null,
    );
    assert.deepEqual([itemRows(p), p.flags.length], [[ROW_1], 0]);
  });

  void test('an empty Touches is not a failure: the row takes the project-level path', () => {
    const p = planResolve(snapshot([borrow()], [question({ id: ROW_1, touches: [] })]), null);
    assert.deepEqual([onlyItem(p).path, p.projectLevel.map((i) => i.row.id), p.groups.length], ['project', [ROW_1], 0]);
  });

  void test('a Touches naming several features takes the same project-level path, with every named feature', () => {
    const it = onlyItem(
      planResolve(snapshot([borrow(), giveBack()], [question({ id: ROW_1, touches: [BORROW_ID, RETURN_ID] })]), null),
    );
    assert.deepEqual([it.path, it.features.map((f) => f.id)], ['project', [BORROW_ID, RETURN_ID]]);
  });

  void test("resolves a local Touches entry by the feature's exact name", () => {
    const local = feature('borrow-a-lantern', 'Borrow a lantern', BORROW_BODY);
    const it = onlyItem(
      planResolve(
        snapshot([local], [question({ id: 'q-04', key: 'q-04', touches: ['Borrow a lantern'] })], 'local'),
        null,
      ),
    );
    assert.deepEqual(
      it.features.map((f) => f.id),
      ['borrow-a-lantern'],
    );
  });
});

// ---- R2.3 --------------------------------------------------------------------------------------------------------------

void describe('planResolve — R2.3 an edit this seam did not make', () => {
  const rows = (): Question[] => [
    question({ id: ROW_1 }),
    question({ id: ROW_2, question: 'Who may borrow?' }),
    question({ id: ROW_3, touches: [RETURN_ID] }),
  ];

  void test('flags every queued row touching a body whose hash moved since the newest recorded one', () => {
    const p = planResolve(
      snapshot([borrow(), giveBack()], rows()),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }),
    );
    assert.deepEqual([flagsFor(p, 'R2.3'), itemRows(p)], [[ROW_1, ROW_2], [ROW_3]]);
  });

  void test('lists the changed body for re-baselining: recorded hash and current hash', () => {
    const p = planResolve(
      snapshot([borrow(), giveBack()], rows()),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }),
    );
    assert.deepEqual(
      p.rebaselines.map((r) => [r.feature.id, r.recorded, r.current]),
      [[BORROW_ID, STALE_H12, BORROW_H12]],
    );
  });

  void test('the R2.3 objection names the changed feature on one line', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }),
    );
    const f = onlyFlag(p);
    assert.deepEqual([f.objection.includes('«Borrow a lantern»'), /\n/.test(f.objection)], [true, false]);
  });

  void test('flags a multi-feature row when any body it touches changed', () => {
    const p = planResolve(
      snapshot([borrow(), giveBack()], [question({ id: ROW_1, touches: [BORROW_ID, RETURN_ID] })]),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] }),
    );
    assert.deepEqual(flagsFor(p, 'R2.3'), [ROW_1]);
  });

  void test('a body matching its newest recorded hash is not a finding', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(BORROW_H12)] }),
    );
    assert.deepEqual([p.flags.length, p.rebaselines.length, itemRows(p)], [0, 0, [ROW_1]]);
  });

  void test('a body no entry has ever hashed has no baseline and is not a finding', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12, 'Return a lantern', RETURN_ID)] }),
    );
    assert.deepEqual([p.flags.length, p.rebaselines.length], [0, 0]);
  });

  void test('a newer HASHES re-baseline clears the flag — it fires once, not forever', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf(
        { date: '2026-09-22', runId: 'b2c3d4', lines: [`- HASHES: «Borrow a lantern» ${BORROW_H12}`] },
        { date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] },
      ),
    );
    assert.deepEqual([p.flags.length, itemRows(p)], [0, [ROW_1]]);
  });

  void test('a void baseline ("hash not taken" on the newest write) makes R2.3 vacuous for that body', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf(
        {
          date: '2026-09-22',
          runId: 'b2c3d4',
          lines: [
            `- item: «Borrow a lantern» \`${BORROW_ID_DASHED}\` · q-01 · written · FR-2 added · body hash not taken`,
          ],
        },
        { date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12)] },
      ),
    );
    assert.deepEqual([p.flags.length, p.rebaselines.length, itemRows(p)], [0, 0, [ROW_1]]);
  });

  void test('finds a baseline recorded under the feature id after the feature was renamed', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1 })]),
      logOf({ date: '2026-09-20', runId: 'a1b2c3', lines: [writtenWith(STALE_H12, 'Borrow lanterns')] }),
    );
    assert.deepEqual(flagsFor(p, 'R2.3'), [ROW_1]);
  });
});

// ---- R2.4 --------------------------------------------------------------------------------------------------------------

void describe('planResolve — R2.4 is the body still a spec?', () => {
  void test('flags a row whose feature is missing a named block, naming the block', () => {
    const f = feature(HALF_ID, 'Pick a slot', withoutBlock(BORROW_BODY, 'Not doing'));
    const flag = onlyFlag(planResolve(snapshot([f], [question({ id: ROW_1, touches: [HALF_ID] })]), null));
    assert.deepEqual(
      [flag.route, flag.objection.includes('Not doing'), /\n/.test(flag.objection)],
      ['R2.4', true, false],
    );
  });

  void test('an empty Edge cases and an empty Rabbit holes are not a finding', () => {
    // BORROW_BODY carries both headings with nothing beneath them.
    const p = planResolve(snapshot([borrow()], [question({ id: ROW_1 })]), null);
    assert.deepEqual([p.flags.length, itemRows(p)], [0, [ROW_1]]);
  });

  void test('an Edge cases block missing outright is a finding', () => {
    const f = feature(HALF_ID, 'Pick a slot', withoutBlock(BORROW_BODY, 'Edge cases'));
    const p = planResolve(snapshot([f], [question({ id: ROW_1, touches: [HALF_ID] })]), null);
    assert.deepEqual(flagsFor(p, 'R2.4'), [ROW_1]);
  });

  void test('a Behaviour holding no numbered requirement does not flag a seed-eligible row: it proceeds as a seed', () => {
    const f = feature(HALF_ID, 'Pick a slot', EMPTY_BEHAVIOUR_BODY);
    const it = onlyItem(planResolve(snapshot([f], [question({ id: ROW_1, touches: [HALF_ID] })]), null));
    assert.equal(it.seed, true);
  });

  void test('a row touching a body that holds a numbered requirement is not a seed', () => {
    assert.equal(onlyItem(planResolve(snapshot([borrow()], [question({ id: ROW_1 })]), null)).seed, false);
  });

  void test('a multi-feature row touching a body with a missing named block is flagged', () => {
    const f = feature(HALF_ID, 'Pick a slot', withoutBlock(BORROW_BODY, 'Not doing'));
    const p = planResolve(snapshot([borrow(), f], [question({ id: ROW_1, touches: [BORROW_ID, HALF_ID] })]), null);
    assert.deepEqual(flagsFor(p, 'R2.4'), [ROW_1]);
  });
});

// ---- R3 grouping, depth and markers ------------------------------------------------------------------------------------

void describe('planResolve — items, groups and markers', () => {
  void test('groups single-feature items by feature, in the order the queue first reaches each', () => {
    const p = planResolve(
      snapshot(
        [borrow(), giveBack()],
        [question({ id: ROW_1 }), question({ id: ROW_2, touches: [RETURN_ID] }), question({ id: ROW_3 })],
      ),
      null,
    );
    assert.deepEqual(
      p.groups.map((g) => [g.feature.id, g.items.map((i) => i.row.id)]),
      [
        [BORROW_ID, [ROW_1, ROW_3]],
        [RETURN_ID, [ROW_2]],
      ],
    );
  });

  void test('keeps project-level items out of the groups and lists them apart', () => {
    const p = planResolve(
      snapshot(
        [borrow(), giveBack()],
        [
          question({ id: ROW_1 }),
          question({ id: ROW_2, touches: [] }),
          question({ id: ROW_3, touches: [BORROW_ID, RETURN_ID] }),
        ],
      ),
      null,
    );
    assert.deepEqual(
      [p.groups.flatMap((g) => g.items.map((i) => i.row.id)), p.projectLevel.map((i) => i.row.id)],
      [[ROW_1], [ROW_2, ROW_3]],
    );
  });

  void test("carries the row's depth from its Why asked onto its item", () => {
    const it = onlyItem(
      planResolve(
        snapshot([borrow()], [question({ id: ROW_1, whyAsked: 'FR-1 was written from an earlier answer. · depth 2' })]),
        null,
      ),
    );
    assert.equal(it.depth, 2);
  });

  void test('an item carries the markers that link its own row, and no marker linking another row', () => {
    const slot = feature(SLOT_ID, 'Pick a slot', SLOT_BODY);
    const it = onlyItem(planResolve(snapshot([slot], [question({ id: ROW_1, touches: [SLOT_ID] })]), null));
    assert.deepEqual(
      it.markers.map((m) => [m.feature, m.fr]),
      [[SLOT_ID, 1]],
    );
  });

  void test("on the local target, a marker linking the row by its q-NN key is the row's marker", () => {
    // doc-shape §9: the link names the row; on the local target a row's identity is its `q-NN` key.
    const body = SLOT_BODY.replace(`https://app.notion.com/p/${ROW_1}`, 'q-04').replace(
      `https://app.notion.com/p/${OTHER_ROW}`,
      'q-11',
    );
    const slot = feature('pick-a-slot', 'Pick a slot', body);
    const it = onlyItem(
      planResolve(snapshot([slot], [question({ id: 'q-04', key: 'q-04', touches: ['Pick a slot'] })], 'local'), null),
    );
    assert.deepEqual(
      it.markers.map((m) => [m.feature, m.fr]),
      [['pick-a-slot', 1]],
    );
  });

  void test('an empty queue plans nothing and flags nothing', () => {
    const p = planResolve(
      snapshot([borrow()], [question({ id: ROW_1, status: 'Applied', statusRaw: 'Applied' })]),
      null,
    );
    assert.deepEqual([p.queue.length, p.items.length, p.flags.length], [0, 0, 0]);
  });
});
