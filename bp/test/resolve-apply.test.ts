import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble,
  contentCheck,
  DeltaRefused,
  groundingKinds,
  outcome,
  provenanceLine,
  type Assembled,
  type CheckerOutput,
  type Outcome,
  type WriterOutput,
} from '../src/resolve/apply.ts';
import type { Item } from '../src/resolve/plan.ts';
import { makeFeature, type FeatureRec } from '../src/snapshot.ts';
import type { Question } from '../src/domain/question.ts';
import type { ContentFinding } from '../src/checks/content.ts';

// resolve.md R3 as src/resolve/apply.ts executes it: assembling the writer's typed delta into the block (bp numbers new
// requirements and writes every provenance line), the closed set of grounding kinds, R3.6's soft gate and R3.3's
// outcomes, and R2.5's write-path content check. Every fixture is SYNTHETIC (an invented lantern-lending club); every
// expected block, line and verdict is written out by hand from the spec lines cited below.
//
// Spec rules exercised:
//   R3.1 — "Every requirement this seam creates or changes gets its OWN provenance line" (v24), carrying `· depth n`;
//          a new FR takes "the next free number, appended, never renumbering"; the delta caps: "no variant label (`FR-1a`
//          is the observed case), no new named block, note or heading"; the set of grounding kinds is closed at run start
//          and "a writer never composes a new one"; "direction n on that row, chosen by the answer" is the label a
//          dereferenced pointer carries, and "a clause the human added beside the pointer keeps answer and reasoning on
//          that row".
//   R3.2 — a contradiction supersedes, "quoting the replaced text" in the dated provenance line (add.md A4 step 5).
//   R3.3 — the six outcomes; a Patched anchor must be an excerpt of "the feature body as it currently stands", and an
//          unanchored one re-dispatches the CHECKER once, then ends Flagged; Unverified when no check ran.
//   R3.4 — only a Flagged from the check on a writer's delta retries, once; Kept never retries.
//   R3.6 — the soft gate runs "before step 1 and independently of R3.2's verdict": a delta that replaces or removes an
//          FR, an Edge cases line or a Not doing line is Kept (nothing written); a purely additive one is written.
//   R3.3 (seed) — where Behaviour holds no numbered requirement, the writer drafts FR-1 and it is written.
//   doc-shape §8 — a tombstone is never rewritten and its number never reused; §9 — a marker links one row.
//   doc-shape §6 — "no contract terms or dates, no penalties, no prices".

// ---- fixtures ----------------------------------------------------------------------------------------------------------

const DATE = '2026-09-25';
const ROW = '0a0a0a0a0b0b0c0c0d0d0e0e0e0e0e0e';
const OTHER_ROW = '9f9f9f9f8e8e7d7d6c6c5b5b5b5b5b5b';
const ASKED = 'Who checks a returned lantern?';
const ANSWER_KIND = 'answer and reasoning on that row';

const OWN_MARKER = `[NEEDS CLARIFICATION: who checks a returned lantern? → Question: https://app.notion.com/p/${ROW}]`;
const OTHER_MARKER = `[NEEDS CLARIFICATION: is a scratched lantern still lendable? → Question: https://app.notion.com/p/${OTHER_ROW}]`;

const FR1 = 'FR-1 — When a member taps Borrow, the system reserves the lantern for them.';
const FR1_PROV =
  '*(Applied 2026-08-04 from «Can a member borrow two lanterns?» `q-01` · depth 1 — standard practice, adopted, not client-specific.)*';
const FR2 = `FR-2 — When a lantern is returned, the system marks it available. ${OWN_MARKER} ${OTHER_MARKER}`;
const FR3_TOMBSTONE = 'FR-3 — *withdrawn 2026-08-04, replaced by FR-4. No behaviour here.*';
const FR4 = 'FR-4 — When a lantern is overdue, the system emails the member.';
const FR4_PROV =
  '*(Applied 2026-08-10 from «When is a lantern overdue?» `q-02` · depth 1 — design-confirmed; replaces "When a lantern is late, the system emails the member.".)*';
const EDGE_OFFLINE = '- Offline: the Borrow button is disabled.';
const NOT_DOING = 'No delivery — because members collect in person; revisit if a courier partner appears.';

/** The Behaviour block's lines after its heading, the separating blank line included. */
const BEHAVIOUR = [FR1, FR1_PROV, FR2, FR3_TOMBSTONE, FR4, FR4_PROV, ''];

const bodyWith = (behaviour: string[], opts: { rabbitHoles?: boolean } = {}): string =>
  [
    '## Why',
    'Members borrow lanterns for night walks.',
    '',
    '## Behaviour',
    ...behaviour,
    '## Edge cases',
    EDGE_OFFLINE,
    '',
    ...(opts.rabbitHoles === false ? [] : ['## Rabbit holes', '']),
    '## Not doing',
    NOT_DOING,
  ].join('\n');

function feature(content: string, id = 'a1a1a1a1b2b2c3c3d4d4e5e5e5e5e5e5', name = 'Borrow a lantern'): FeatureRec {
  return makeFeature({
    id,
    name,
    whatItDoes: 'Members borrow a lantern.',
    area: 'Lending',
    created: null,
    questionRefs: [],
    content,
    source: `fetch-${id}`,
    adHoc: [],
  });
}

const LANTERN = feature(bodyWith(BEHAVIOUR));

function row(over: Partial<Question> = {}): Question {
  return {
    id: ROW,
    question: ASKED,
    status: 'Answered',
    statusRaw: 'Answered',
    owner: '',
    answer: 'A staff member inspects every returned lantern before it is lent again.',
    whyAsked: 'FR-2 of «Borrow a lantern» never says who checks a lantern. · depth 2',
    directions: '',
    whyFlagged: '',
    touches: ['a1a1a1a1b2b2c3c3d4d4e5e5e5e5e5e5'],
    created: null,
    adHoc: [],
    ...over,
  };
}

function itemOn(f: FeatureRec, over: Partial<Item> = {}): Item {
  return {
    row: row(),
    reading: { kind: 'prose' },
    path: 'single',
    features: [f],
    markers: [],
    depth: 2,
    seed: false,
    ...over,
  };
}

type Delta = Extract<WriterOutput, { output: 'delta' }>;

function delta(over: Partial<Delta> & Pick<Delta, 'block'>): Delta {
  return { output: 'delta', groundingKind: ANSWER_KIND, removesMarker: false, directives: [], ...over };
}

function assembleOn(f: FeatureRec, out: Delta, item: Item = itemOn(f)): Assembled {
  return assemble({ item, feature: f, out, date: DATE, kinds: groundingKinds([f]) });
}

/** The provenance line this seam writes for ROW at depth 2, spelled out by hand from the format under test below. */
const prov = (kind = ANSWER_KIND, replaces?: string): string =>
  `*(Applied ${DATE} from «${ASKED}» **\`${ROW}\`** · depth 2 — ${kind}${replaces === undefined ? '' : `; replaces "${replaces}"`}.)*`;

const lineOf = (block: string, prefix: string): string => {
  const l = block.split('\n').find((x) => x.startsWith(prefix));
  if (l === undefined)
    throw new assert.AssertionError({ message: `no line starting ${JSON.stringify(prefix)} in:\n${block}` });
  return l;
};

const nonBlank = (block: string): string[] => block.split('\n').filter((l) => l.trim() !== '');

const refused = (fn: () => unknown, mentions?: string): void => {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DeltaRefused && (mentions === undefined || e.message.includes(mentions)),
  );
};

// ---- provenanceLine ----------------------------------------------------------------------------------------------------

void describe('provenanceLine — the dated line under every requirement this seam writes', () => {
  void test('spells date, question, row id, depth and grounding kind in the fixed shape', () => {
    assert.equal(
      provenanceLine({ date: DATE, question: ASKED, rowId: 'q-04', depth: 2, kind: ANSWER_KIND }),
      '*(Applied 2026-09-25 from «Who checks a returned lantern?» **`q-04`** · depth 2 — answer and reasoning on that row.)*',
    );
  });

  void test('a supersession quotes the replaced text after the kind', () => {
    assert.equal(
      provenanceLine({
        date: DATE,
        question: ASKED,
        rowId: 'q-04',
        depth: 3,
        kind: 'design-confirmed',
        replaces: 'When a lantern is returned, the system marks it available.',
      }),
      '*(Applied 2026-09-25 from «Who checks a returned lantern?» **`q-04`** · depth 3 — design-confirmed; replaces "When a lantern is returned, the system marks it available.".)*',
    );
  });

  void test('keeps exactly one «…» pair when the question itself carries guillemets', () => {
    const line = provenanceLine({
      date: DATE,
      question: 'Is «late» a day or an hour?',
      rowId: 'q-04',
      depth: 1,
      kind: ANSWER_KIND,
    });
    assert.deepEqual([[...line].filter((c) => c === '«').length, [...line].filter((c) => c === '»').length], [1, 1]);
  });

  void test('keeps the replaced quote closed when the replaced text carries double quotes', () => {
    const line = provenanceLine({
      date: DATE,
      question: ASKED,
      rowId: 'q-04',
      depth: 1,
      kind: ANSWER_KIND,
      replaces: 'The button says "Borrow".',
    });
    assert.equal([...line].filter((c) => c === '"').length, 2);
  });
});

// ---- groundingKinds ----------------------------------------------------------------------------------------------------

void describe("groundingKinds — the closed set, read from the Blueprint's own provenance lines", () => {
  void test('holds only "answer and reasoning on that row" on a Blueprint with no provenance lines', () => {
    assert.deepEqual(groundingKinds([]), new Set([ANSWER_KIND]));
  });

  void test('adds the kind each existing Applied line names, without its replaces clause', () => {
    assert.deepEqual(
      groundingKinds([LANTERN]),
      new Set([ANSWER_KIND, 'standard practice, adopted, not client-specific', 'design-confirmed']),
    );
  });
});

// ---- assemble: Behaviour -----------------------------------------------------------------------------------------------

void describe('assemble — Behaviour deltas', () => {
  const REPLACE_FR1 = 'When a member taps Borrow, the system asks them to pick a pickup time.';

  void test('an FR replaced gets its own provenance line quoting the old sentence, after the lines already under it', () => {
    const a = assembleOn(LANTERN, delta({ block: 'Behaviour', changes: [{ fr: 1, text: REPLACE_FR1 }] }));
    assert.equal(
      a.after,
      [
        '## Behaviour',
        `FR-1 — ${REPLACE_FR1}`,
        FR1_PROV,
        prov(ANSWER_KIND, 'When a member taps Borrow, the system reserves the lantern for them.'),
        FR2,
        FR3_TOMBSTONE,
        FR4,
        FR4_PROV,
        '',
      ].join('\n'),
    );
  });

  void test('a replacing change is reported as replacing, naming the requirement and its old sentence', () => {
    const a = assembleOn(LANTERN, delta({ block: 'Behaviour', changes: [{ fr: 1, text: REPLACE_FR1 }] }));
    assert.deepEqual(
      [a.replaces, a.replaced, a.touched],
      [
        true,
        [
          {
            target: 'FR-1',
            old: 'When a member taps Borrow, the system reserves the lantern for them.',
            new: REPLACE_FR1,
          },
        ],
        ['FR-1'],
      ],
    );
  });

  void test('an additive change (old sentence kept, closing punctuation aside) gets a provenance line with no replaces clause', () => {
    const a = assembleOn(
      LANTERN,
      delta({
        block: 'Behaviour',
        changes: [{ fr: 4, text: 'When a lantern is overdue, the system emails the member within one hour.' }],
      }),
    );
    assert.equal(
      a.after,
      [
        '## Behaviour',
        FR1,
        FR1_PROV,
        FR2,
        FR3_TOMBSTONE,
        'FR-4 — When a lantern is overdue, the system emails the member within one hour.',
        FR4_PROV,
        prov(),
        '',
      ].join('\n'),
    );
  });

  void test('an additive change is not reported as replacing', () => {
    const a = assembleOn(
      LANTERN,
      delta({
        block: 'Behaviour',
        changes: [{ fr: 4, text: 'When a lantern is overdue, the system emails the member within one hour.' }],
      }),
    );
    assert.deepEqual([a.replaces, a.replaced], [false, []]);
  });

  void test('a new requirement takes the next free number, after the last FR and its provenance lines', () => {
    const a = assembleOn(
      LANTERN,
      delta({
        block: 'Behaviour',
        changes: [{ fr: null, text: 'When a member borrows a lantern, the system records the time it left.' }],
      }),
    );
    assert.equal(
      a.after,
      [
        '## Behaviour',
        FR1,
        FR1_PROV,
        FR2,
        FR3_TOMBSTONE,
        FR4,
        FR4_PROV,
        'FR-5 — When a member borrows a lantern, the system records the time it left.',
        prov(),
        '',
      ].join('\n'),
    );
  });

  void test('two new requirements in one delta each get their own number and their own provenance line', () => {
    const a = assembleOn(
      LANTERN,
      delta({
        block: 'Behaviour',
        changes: [
          { fr: null, text: 'When a member borrows a lantern, the system records the time it left.' },
          { fr: null, text: 'When a member returns a lantern, the system records the time it came back.' },
        ],
      }),
    );
    assert.equal(
      a.after,
      [
        '## Behaviour',
        FR1,
        FR1_PROV,
        FR2,
        FR3_TOMBSTONE,
        FR4,
        FR4_PROV,
        'FR-5 — When a member borrows a lantern, the system records the time it left.',
        prov(),
        'FR-6 — When a member returns a lantern, the system records the time it came back.',
        prov(),
        '',
      ].join('\n'),
    );
  });

  void test("never reuses a withdrawn requirement's number, even when it is the highest", () => {
    const f = feature(bodyWith([FR1, 'FR-2 — *withdrawn 2026-08-04, replaced by FR-1. No behaviour here.*', '']));
    const a = assembleOn(
      f,
      delta({
        block: 'Behaviour',
        changes: [{ fr: null, text: 'When a member cancels a borrow, the system frees the lantern.' }],
      }),
    );
    assert.equal(
      a.after,
      [
        '## Behaviour',
        FR1,
        'FR-2 — *withdrawn 2026-08-04, replaced by FR-1. No behaviour here.*',
        'FR-3 — When a member cancels a borrow, the system frees the lantern.',
        prov(),
        '',
      ].join('\n'),
    );
  });

  void test('seeds FR-1 with its provenance line into a Behaviour block that holds no requirement', () => {
    const f = feature(bodyWith(['']));
    const a = assembleOn(
      f,
      delta({
        block: 'Behaviour',
        changes: [
          { fr: null, text: 'When a lantern is returned, a staff member inspects it before it is lent again.' },
        ],
      }),
      itemOn(f, { seed: true }),
    );
    assert.equal(
      a.after,
      [
        '## Behaviour',
        'FR-1 — When a lantern is returned, a staff member inspects it before it is lent again.',
        prov(),
        '',
      ].join('\n'),
    );
  });
});

// ---- assemble: markers -------------------------------------------------------------------------------------------------

void describe('assemble — markers on a rewritten requirement', () => {
  const FR2_TEXT = 'When a lantern is returned, the system marks it available after a staff member inspects it.';

  void test('keeps a marker that points at another row on the rewritten line', () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Behaviour', removesMarker: true, changes: [{ fr: 2, text: FR2_TEXT }] }),
    );
    assert.equal(lineOf(a.after, 'FR-2 —').includes(OTHER_MARKER), true);
  });

  void test("removes the row's own marker when the delta resolves it", () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Behaviour', removesMarker: true, changes: [{ fr: 2, text: FR2_TEXT }] }),
    );
    assert.equal(lineOf(a.after, 'FR-2 —'), `FR-2 — ${FR2_TEXT} ${OTHER_MARKER}`);
  });

  void test("keeps the row's own marker when the delta does not resolve it", () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Behaviour', removesMarker: false, changes: [{ fr: 2, text: FR2_TEXT }] }),
    );
    assert.equal(lineOf(a.after, 'FR-2 —'), `FR-2 — ${FR2_TEXT} ${OWN_MARKER} ${OTHER_MARKER}`);
  });

  void test("on the local target, removes the row's own marker that links it by its q-NN key", () => {
    const local = feature(
      bodyWith([
        'FR-1 — When a member picks a slot, the system holds it for them. [NEEDS CLARIFICATION: how long is a slot held? → Question: q-04]',
        '',
      ]),
      'borrow-a-lantern',
    );
    const item = itemOn(local, { row: row({ id: 'q-04', key: 'q-04', touches: ['Borrow a lantern'] }) });
    const a = assembleOn(
      local,
      delta({
        block: 'Behaviour',
        removesMarker: true,
        changes: [{ fr: 1, text: 'When a member picks a slot, the system holds it for them for fifteen minutes.' }],
      }),
      item,
    );
    assert.equal(
      lineOf(a.after, 'FR-1 —'),
      'FR-1 — When a member picks a slot, the system holds it for them for fifteen minutes.',
    );
  });
});

// ---- assemble: other blocks --------------------------------------------------------------------------------------------

void describe('assemble — deltas on blocks other than Behaviour', () => {
  void test('a new Edge cases line gets its own provenance line; the unchanged line gets none', () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Edge cases', lines: [EDGE_OFFLINE, '- Two members tap Borrow at once: the first tap wins.'] }),
    );
    assert.deepEqual(nonBlank(a.after), [
      '## Edge cases',
      EDGE_OFFLINE,
      '- Two members tap Borrow at once: the first tap wins.',
      prov(),
    ]);
  });

  void test('a replaced Edge cases line gets a provenance line quoting the line it replaced', () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Edge cases', lines: ['- Offline: the Borrow button explains that it needs a connection.'] }),
    );
    assert.deepEqual(nonBlank(a.after), [
      '## Edge cases',
      '- Offline: the Borrow button explains that it needs a connection.',
      prov(ANSWER_KIND, EDGE_OFFLINE),
    ]);
  });

  void test('a replaced Edge cases line is reported as replacing', () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Edge cases', lines: ['- Offline: the Borrow button explains that it needs a connection.'] }),
    );
    assert.equal(a.replaces, true);
  });

  void test('removing a Not doing line is reported as replacing', () => {
    const a = assembleOn(LANTERN, delta({ block: 'Not doing', lines: [] }));
    assert.equal(a.replaces, true);
  });
});

// ---- assemble: grounding kinds -----------------------------------------------------------------------------------------

void describe('assemble — the grounding kind a provenance line may name', () => {
  const POINTER: Item['reading'] = {
    kind: 'pointer',
    n: 2,
    extra: '',
    decision: 'A staff member inspects every returned lantern.',
    slotsFilled: true,
  };
  const CHANGE = [
    { fr: null, text: 'When a lantern is returned, a staff member inspects it before it is lent again.' },
  ];

  void test("accepts a kind the Blueprint's own provenance lines already use", () => {
    const a = assembleOn(LANTERN, delta({ block: 'Behaviour', groundingKind: 'design-confirmed', changes: CHANGE }));
    assert.equal(lineOf(a.after, '*(Applied 2026-09-25'), prov('design-confirmed'));
  });

  void test("refuses a kind outside the run's closed set", () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({ block: 'Behaviour', groundingKind: 'the client said so on a call', changes: CHANGE }),
      ),
    );
  });

  void test('a bare pointer carries "direction n on that row, chosen by the answer"', () => {
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Behaviour', groundingKind: 'direction 2 on that row, chosen by the answer', changes: CHANGE }),
      itemOn(LANTERN, { reading: POINTER }),
    );
    assert.equal(lineOf(a.after, '*(Applied 2026-09-25'), prov('direction 2 on that row, chosen by the answer'));
  });

  void test("refuses a bare pointer labelled as the answer's own reasoning", () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({ block: 'Behaviour', groundingKind: ANSWER_KIND, changes: CHANGE }),
        itemOn(LANTERN, { reading: POINTER }),
      ),
    );
  });

  void test('a pointer with the human\'s own words beside it keeps "answer and reasoning on that row"', () => {
    const withWords: Item['reading'] = { ...POINTER, extra: 'but only on weekdays' };
    const a = assembleOn(
      LANTERN,
      delta({ block: 'Behaviour', groundingKind: ANSWER_KIND, changes: CHANGE }),
      itemOn(LANTERN, { reading: withWords }),
    );
    assert.equal(lineOf(a.after, '*(Applied 2026-09-25'), prov());
  });

  void test('refuses a direction label naming a direction the answer did not choose', () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({ block: 'Behaviour', groundingKind: 'direction 1 on that row, chosen by the answer', changes: CHANGE }),
        itemOn(LANTERN, { reading: POINTER }),
      ),
    );
  });
});

// ---- assemble: the delta caps ------------------------------------------------------------------------------------------

void describe("assemble — refusals (R3.1's caps)", () => {
  void test('refuses a change to a requirement the body does not have', () => {
    refused(
      () =>
        assembleOn(
          LANTERN,
          delta({
            block: 'Behaviour',
            changes: [{ fr: 9, text: 'When a lantern is lost, the system notifies staff.' }],
          }),
        ),
      'FR-9',
    );
  });

  void test('refuses to rewrite a withdrawn requirement', () => {
    refused(
      () =>
        assembleOn(
          LANTERN,
          delta({
            block: 'Behaviour',
            changes: [{ fr: 3, text: 'When a lantern is lost, the system notifies staff.' }],
          }),
        ),
      'FR-3',
    );
  });

  void test('refuses a requirement that spans more than one line', () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({
          block: 'Behaviour',
          changes: [
            { fr: null, text: 'When a lantern is lost, the system notifies staff.\nIt also locks the account.' },
          ],
        }),
      ),
    );
  });

  void test('refuses a variant label such as FR-3a in the text', () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({
          block: 'Behaviour',
          changes: [{ fr: null, text: 'When a lantern is lost, the rule in FR-3a applies.' }],
        }),
      ),
    );
  });

  void test('refuses requirement text that carries its own number — bp numbers requirements', () => {
    refused(() =>
      assembleOn(
        LANTERN,
        delta({
          block: 'Behaviour',
          changes: [{ fr: null, text: 'FR-5 — When a lantern is lost, the system notifies staff.' }],
        }),
      ),
    );
  });

  void test('refuses a delta for a named block the body does not have — a delta never adds one', () => {
    const f = feature(bodyWith(BEHAVIOUR, { rabbitHoles: false }));
    refused(() => assembleOn(f, delta({ block: 'Rabbit holes', lines: ['Do not build a lantern-tracking map.'] })));
  });

  void test("refuses a heading among a block's lines", () => {
    refused(() =>
      assembleOn(LANTERN, delta({ block: 'Edge cases', lines: [EDGE_OFFLINE, '## Notes', '- Nobody asked.'] })),
    );
  });

  void test("refuses a provenance line among a block's lines — bp writes those", () => {
    refused(() => assembleOn(LANTERN, delta({ block: 'Edge cases', lines: [EDGE_OFFLINE, prov()] })));
  });
});

// ---- outcome -----------------------------------------------------------------------------------------------------------

type Verdict = CheckerOutput['verdicts'][number];
const v = (verdict: Verdict['verdict'], over: Partial<Verdict> = {}): Verdict => ({
  target: 'FR-4',
  verdict,
  inconsistency: '',
  answerQuote: '',
  ...over,
});
const check = (...verdicts: Verdict[]): CheckerOutput => ({ verdicts, directives: [] });

const FR4_ADDED = 'FR-4 — When a lantern is overdue, the system emails the member within one hour.';
const ADDITIVE: Assembled = {
  block: 'Behaviour',
  before: ['## Behaviour', FR4].join('\n'),
  after: ['## Behaviour', FR4_ADDED, prov()].join('\n'),
  touched: ['FR-4'],
  replaced: [],
  replaces: false,
  markersRemoved: [],
};
const REPLACED_FR1 = 'When a member taps Borrow, the system reserves the lantern for them.';
const REPLACING: Assembled = {
  block: 'Behaviour',
  before: ['## Behaviour', FR1].join('\n'),
  after: [
    '## Behaviour',
    'FR-1 — When a member taps Borrow, the system asks them to pick a pickup time.',
    prov(ANSWER_KIND, REPLACED_FR1),
  ].join('\n'),
  touched: ['FR-1'],
  replaced: [
    {
      target: 'FR-1',
      old: REPLACED_FR1,
      new: 'When a member taps Borrow, the system asks them to pick a pickup time.',
    },
  ],
  replaces: true,
  markersRemoved: [],
};

function decide(
  o: Partial<Parameters<typeof outcome>[0]> & Pick<Parameters<typeof outcome>[0], 'assembled' | 'check'>,
): Outcome {
  return outcome({ mode: 'force', writerRetried: false, checkerRepaired: false, feature: LANTERN, ...o });
}

void describe("outcome — R3.6's soft gate, then R3.3's roll-up", () => {
  const PATCH = { fr: 4, anchor: 'emails the member', addition: 'at their registered address' };

  void test('soft with a replacing delta is Kept, writing nothing, whatever the check said', () => {
    const checks: (CheckerOutput | null)[] = [
      check(v('Clean')),
      check(v('Superseded')),
      check(v('Flagged', { inconsistency: 'the answer never says who is emailed' })),
      check(v('Patched', { patch: PATCH })),
    ];
    for (const c of checks) {
      const r = decide({ assembled: REPLACING, check: c, mode: 'soft' });
      assert.deepEqual(
        [r.kind, 'after' in r],
        ['Kept', false],
        `check ${JSON.stringify(c?.verdicts.map((x) => x.verdict))}`,
      );
    }
  });

  void test('soft with a replacing delta and no check at all is Kept, never Unverified', () => {
    assert.equal(decide({ assembled: REPLACING, check: null, mode: 'soft' }).kind, 'Kept');
  });

  void test('a Kept objection quotes the text the answer would have replaced', () => {
    const r = decide({ assembled: REPLACING, check: check(v('Clean')), mode: 'soft' });
    assert.equal(r.kind === 'Kept' && r.objection.includes(REPLACED_FR1), true);
  });

  void test('soft writes a purely additive delta exactly as the default mode does', () => {
    assert.deepEqual(decide({ assembled: ADDITIVE, check: check(v('Clean')), mode: 'soft' }), {
      kind: 'Clean',
      after: ADDITIVE.after,
    });
  });

  void test('no check at all is Unverified, and the delta is written', () => {
    assert.deepEqual(decide({ assembled: ADDITIVE, check: null }), { kind: 'Unverified', after: ADDITIVE.after });
  });

  void test('any Flagged verdict flags the item, with one writer retry owed', () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Clean', { target: 'FR-1' }), v('Flagged', { inconsistency: 'the answer never says one hour' })),
    });
    assert.deepEqual([r.kind, r.kind === 'Flagged' && r.retry], ['Flagged', true]);
  });

  void test("a Flagged verdict after the writer's retry stands, with no further retry", () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Flagged', { inconsistency: 'the answer never says one hour' })),
      writerRetried: true,
    });
    assert.deepEqual([r.kind, r.kind === 'Flagged' && r.retry], ['Flagged', false]);
  });

  void test('a Flagged objection carries the inconsistency the check named', () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Flagged', { inconsistency: 'the answer never says one hour' })),
    });
    assert.equal(r.kind === 'Flagged' && r.objection.includes('the answer never says one hour'), true);
  });

  void test('a Patched verdict anchored in the current body completes the delta after its anchor', () => {
    const r = decide({ assembled: ADDITIVE, check: check(v('Patched', { patch: PATCH })) });
    assert.deepEqual(r, {
      kind: 'Patched',
      after: [
        '## Behaviour',
        'FR-4 — When a lantern is overdue, the system emails the member at their registered address within one hour.',
        prov(),
      ].join('\n'),
    });
  });

  void test("a Patched anchor found only in the writer's proposal sends the checker back once to repair it", () => {
    // "within one hour" is in the delta's FR-4, not in FR-4 of the body as it stands.
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Patched', { patch: { ...PATCH, anchor: 'within one hour' } })),
    });
    assert.equal(r.kind, 'repair-check');
  });

  void test("a Patched anchor still not in the body after the checker's repair ends Flagged, with no writer retry", () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Patched', { patch: { ...PATCH, anchor: 'within one hour' } })),
      checkerRepaired: true,
    });
    assert.deepEqual([r.kind, r.kind === 'Flagged' && r.retry], ['Flagged', false]);
  });

  void test('a Patched verdict that carries no patch is not a verdict: the checker is sent back to repair it', () => {
    assert.equal(decide({ assembled: ADDITIVE, check: check(v('Patched')) }).kind, 'repair-check');
  });

  void test('a Superseded verdict is written', () => {
    assert.deepEqual(decide({ assembled: REPLACING, check: check(v('Superseded', { target: 'FR-1' })) }), {
      kind: 'Superseded',
      after: REPLACING.after,
    });
  });

  void test('a replacing delta the check found clean is written as a supersession in the default mode', () => {
    assert.deepEqual(decide({ assembled: REPLACING, check: check(v('Clean', { target: 'FR-1' })) }), {
      kind: 'Superseded',
      after: REPLACING.after,
    });
  });

  void test('an additive delta with every verdict Clean is Clean and written', () => {
    assert.deepEqual(decide({ assembled: ADDITIVE, check: check(v('Clean'), v('Clean', { target: 'FR-1' })) }), {
      kind: 'Clean',
      after: ADDITIVE.after,
    });
  });

  void test('a touched requirement with no verdict is unchecked: the check is sent back once, then the row is Flagged', () => {
    // resolve.md R3.2: one requirement at a time, one verdict each; SKILL.md rule 6: unchecked is never Clean.
    const only = check(v('Clean', { target: 'FR-1' }));
    assert.equal(decide({ assembled: ADDITIVE, check: only }).kind, 'repair-check');
    assert.deepEqual(
      ((r) => [r.kind, r.kind === 'Flagged' && r.retry])(
        decide({ assembled: ADDITIVE, check: only, checkerRepaired: true }),
      ),
      ['Flagged', false],
    );
  });

  void test('a patch on a requirement the delta did not touch is not a completion of the delta', () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(
        v('Clean'),
        v('Patched', { target: 'FR-1', patch: { fr: 1, anchor: 'reserves', addition: 'for an hour' } }),
      ),
    });
    assert.equal(r.kind, 'repair-check');
  });

  void test("a patch's addition is inserted as text: $& and $' are never replacement patterns", () => {
    const r = decide({
      assembled: ADDITIVE,
      check: check(v('Patched', { patch: { ...PATCH, addition: "per $' and $& terms" } })),
    });
    assert.equal(
      r.kind === 'Patched' && r.after.includes("emails the member per $' and $& terms within one hour."),
      true,
    );
  });

  void test('a Kept objection quotes both sides, and withholds a side that carries a barred class', () => {
    const priced: Assembled = {
      ...REPLACING,
      replaced: [
        {
          target: 'FR-1',
          old: 'When a member borrows, the system charges £5.',
          new: 'When a member borrows, nothing is charged.',
        },
      ],
    };
    const r = decide({ assembled: priced, check: null, mode: 'soft' });
    if (r.kind !== 'Kept') assert.fail(`expected Kept, got ${r.kind}`);
    assert.doesNotMatch(r.objection, /£5/);
    assert.match(r.objection, /the document says \(withheld: a price or amount of money\)/);
    assert.match(r.objection, /the answer says "When a member borrows, nothing is charged\."/);
  });
});

// ---- contentCheck ------------------------------------------------------------------------------------------------------

void describe('contentCheck — R2.5 on the write path (doc-shape §6)', () => {
  const PRICE: ContentFinding['cls'] = 'a price or amount of money';
  const CONTRACT_DATE: ContentFinding['cls'] = 'a contract or deadline date';
  const BARRED: ContentFinding['cls'] = 'a barred term';

  void test('refuses a price', () => {
    assert.deepEqual(contentCheck('When a member returns a lantern late, the system charges £5.', []), [PRICE]);
  });

  void test('refuses a contract date', () => {
    assert.deepEqual(
      contentCheck('When the hall contract expires on 2028-03-31, the system stops taking bookings.', []),
      [CONTRACT_DATE],
    );
  });

  void test("finds every class in doc-shape §6's own example of what may not appear", () => {
    const found = contentCheck('Northgate Retail Park — P1 4 hours, £250 penalty, contract to 2028-03-31', [
      'Northgate Retail Park',
    ]);
    assert.deepEqual(new Set(found), new Set([BARRED, PRICE, CONTRACT_DATE]));
  });

  void test("passes doc-shape §6's own role-not-specific rewrite of that example", () => {
    assert.deepEqual(
      contentCheck(
        'a site on the enterprise contract has a contracted response target for P1 faults, with a penalty for missing it',
        ['Northgate Retail Park'],
      ),
      [],
    );
  });
});
