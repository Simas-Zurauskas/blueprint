import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isLinkOnly, parseDirections, readAnswer, type Direction } from '../src/domain/question.ts';

// The suggested-directions reader and the v34 pointer grammar (src/domain/question.ts). Fixtures are SYNTHETIC, in the
// shape a question row's `Suggested directions` field takes on Notion (`<br>` between paragraphs), with invented product
// text. Every expected decision clause below is copied by hand out of the fixture: the direction's text up to its `Why:`.
//
// Spec rules exercised:
//   resolve.md R2.1 (lines 199-221) — an answer that is only a link has nothing to write down; a pointer naming exactly one
//       numbered direction ("2", "answer 1", "1, but keep it quiet") is dereferenced to that direction's decision clause,
//       never its why or its counter-case, the human's other words riding along; "1 or 2", "both", "1???", a bare
//       "double-check" name no single direction and fail; a direction with an unfilled `<value>` slot is dereferenced
//       only where the pointer supplies the value ("1, five seconds"), and a bare pointer at it fails naming the slot.
//   databases.md §2 `Suggested directions` — "a word with no number" is a failing pointer.
//   challenge.md Q4 — each direction is one line: the direction, a why, its main counter-case; a client-owned value is
//       an explicit `<value>` slot; the field is dated and closed with the standing line.

// ---- fixtures --------------------------------------------------------------------------------------------------------

const DIRECTIONS_TEXT = [
  'Drafted 2026-09-08 from the document. Not an answer.',
  '1. Read path only: members see the lantern log and cannot edit it; lands on FR-3 of «Borrow a lantern». Why: FR-3 says "a member sees every lantern they have borrowed" (FR-3, quoted 2026-09-08). Counter-case: a member who logged a return by mistake cannot correct it.',
  '2. Members edit their own entries and every edit is kept in the log; lands on FR-3 of «Borrow a lantern». Why: general practice, not a source. Counter-case: an editable log is harder to trust in a dispute.',
  "3. Members may edit an entry for <value> after logging it; lands on a new requirement in «Borrow a lantern». Why: FR-3 names the log as the member's own record (FR-3, quoted 2026-09-08). Counter-case: the window is a number only the club can set.",
  'Machine-drafted decision support — not a source; answer in your own words, or name one direction by its number.',
].join('<br><br>');

/** The decision clauses, copied by hand from DIRECTIONS_TEXT (each direction's text before its `Why:`). */
const D1 = 'Read path only: members see the lantern log and cannot edit it; lands on FR-3 of «Borrow a lantern».';
const D2 = 'Members edit their own entries and every edit is kept in the log; lands on FR-3 of «Borrow a lantern».';
const D3 = 'Members may edit an entry for <value> after logging it; lands on a new requirement in «Borrow a lantern».';

/** Hand-built directions for the readAnswer tests, so they do not depend on parseDirections being right. */
const DIRS: readonly Direction[] = [
  {
    n: 1,
    decision: D1,
    slots: [],
    raw: `${D1} Why: FR-3 says "a member sees every lantern they have borrowed". Counter-case: a mistaken return cannot be corrected.`,
  },
  {
    n: 2,
    decision: D2,
    slots: [],
    raw: `${D2} Why: general practice, not a source. Counter-case: an editable log is harder to trust.`,
  },
  {
    n: 3,
    decision: D3,
    slots: ['<value>'],
    raw: `${D3} Why: FR-3 names the log as the member's own record. Counter-case: only the club can set the window.`,
  },
];

/** A pre-v34 row's free-text directions: no numbered list. */
const LEGACY_TEXT =
  'Consider a short edit window, or corrections only through the club desk. Both are common; the club has not said which it prefers.';

// ---- parseDirections -------------------------------------------------------------------------------------------------

void describe('parseDirections — the numbered directions on a row (challenge.md Q4)', () => {
  const dirs = parseDirections(DIRECTIONS_TEXT);

  void test('reads each numbered direction by its number', () => {
    assert.deepEqual(
      dirs.map((d) => d.n),
      [1, 2, 3],
    );
  });

  void test('does not read the dated drafting line or the closing standing line as a direction', () => {
    assert.equal(dirs.length, 3);
  });

  void test("takes a direction's decision clause as its text up to `Why:`", () => {
    assert.deepEqual(
      dirs.map((d) => d.decision),
      [D1, D2, D3],
    );
  });

  void test('keeps the why and the counter-case out of the decision clause', () => {
    assert.equal(
      dirs.some((d) => /Why:|Counter-case/.test(d.decision)),
      false,
    );
  });

  void test('names the `<value>` slot a direction leaves for the pointer to fill', () => {
    assert.deepEqual(
      dirs.map((d) => d.slots),
      [[], [], ['<value>']],
    );
  });

  void test('reads directions separated by plain newlines the same as by `<br>`', () => {
    assert.deepEqual(
      parseDirections(DIRECTIONS_TEXT.replace(/<br><br>/g, '\n\n')).map((d) => [d.n, d.decision]),
      [
        [1, D1],
        [2, D2],
        [3, D3],
      ],
    );
  });

  void test('reads no directions from a legacy free-text field', () => {
    assert.deepEqual(parseDirections(LEGACY_TEXT), []);
  });

  void test('keeps a labelled counter-case out of the decision clause of a direction that has no `Why:` label', () => {
    // The report's own direction shape (questions.md, the SUGGESTED DIRECTIONS sample): why after a dash, then counter-case.
    const text = [
      '1. One retry on the same order — FR-2 already isolates payment as its own step ("payment succeeds or fails"); counter-case: a retry needs an idempotent order.',
      '2. No retry; the customer starts over — simplest; counter-case: the basket is lost at the moment of highest intent.',
    ].join('<br>');
    assert.deepEqual(
      parseDirections(text).map((d) => /counter-case/i.test(d.decision)),
      [false, false],
    );
  });
});

// ---- readAnswer: pointers that dereference ---------------------------------------------------------------------------

void describe('readAnswer — a pointer at one direction is dereferenced (resolve.md R2.1)', () => {
  void test('dereferences a bare number to that direction', () => {
    assert.deepEqual(readAnswer('2', DIRS), { kind: 'pointer', n: 2, extra: '', decision: D2, slotsFilled: true });
  });

  void test('dereferences "answer 1" to direction 1', () => {
    assert.deepEqual(readAnswer('answer 1', DIRS), {
      kind: 'pointer',
      n: 1,
      extra: '',
      decision: D1,
      slotsFilled: true,
    });
  });

  void test("carries the human's own words beside the pointer along with it", () => {
    assert.deepEqual(readAnswer('1, but keep it quiet', DIRS), {
      kind: 'pointer',
      n: 1,
      extra: 'but keep it quiet',
      decision: D1,
      slotsFilled: true,
    });
  });

  void test("dereferences the real field to the decision clause only, never the direction's why or counter-case", () => {
    const r = readAnswer('1', parseDirections(DIRECTIONS_TEXT));
    assert.equal(r.kind === 'pointer' ? r.decision : null, D1);
  });

  void test('dereferences a pointer at a slotted direction when it supplies the value in words', () => {
    const r = readAnswer('3, five days', DIRS);
    assert.deepEqual(r.kind === 'pointer' ? { n: r.n, extra: r.extra } : r, { n: 3, extra: 'five days' });
  });

  void test('dereferences a pointer at a slotted direction when it supplies the value as a figure', () => {
    // "a duration, a threshold, a count" (challenge.md Q4) is the slot's usual content; "5 days" is a value, not a
    // second direction number.
    const r = readAnswer('3, 5 days', DIRS);
    assert.deepEqual(r.kind === 'pointer' ? { n: r.n, extra: r.extra } : r, { n: 3, extra: '5 days' });
  });

  void test('reads a pointer on directions it parsed itself from the real field shape', () => {
    assert.deepEqual(readAnswer('answer 2', parseDirections(DIRECTIONS_TEXT)), {
      kind: 'pointer',
      n: 2,
      extra: '',
      decision: D2,
      slotsFilled: true,
    });
  });
});

// ---- readAnswer: pointers that fail ----------------------------------------------------------------------------------

void describe('readAnswer — a pointer naming no single direction fails (resolve.md R2.1)', () => {
  void test('fails "1 or 2" as naming more than one direction', () => {
    assert.equal(readAnswer('1 or 2', DIRS).kind, 'bad-pointer');
  });

  void test('fails "both"', () => {
    assert.equal(readAnswer('both', DIRS).kind, 'bad-pointer');
  });

  void test('fails "1???"', () => {
    assert.equal(readAnswer('1???', DIRS).kind, 'bad-pointer');
  });

  void test('fails a bare word with no number ("double-check")', () => {
    assert.equal(readAnswer('double-check', DIRS).kind, 'bad-pointer');
  });

  void test('fails a bare pointer at a direction with an unfilled `<value>` slot', () => {
    assert.equal(readAnswer('3', DIRS).kind, 'bad-pointer');
  });

  void test('names the unfilled slot in the failure', () => {
    const r = readAnswer('3', DIRS);
    assert.match(r.kind === 'bad-pointer' ? r.reason : '', /<value>/);
  });

  void test('fails a pointer at a direction number the row does not offer', () => {
    assert.equal(readAnswer('4', DIRS).kind, 'bad-pointer');
  });

  void test('fails a pointer on a row whose directions are legacy free text with no numbered list', () => {
    assert.equal(readAnswer('2', parseDirections(LEGACY_TEXT)).kind, 'bad-pointer');
  });
});

// ---- readAnswer: not a pointer ---------------------------------------------------------------------------------------

void describe('readAnswer — answers that are not pointers', () => {
  void test('reads an ordinary answer that opens with a number as prose ("3 days is the limit")', () => {
    assert.deepEqual(readAnswer('3 days is the limit', DIRS), { kind: 'prose' });
  });

  void test('reads an ordinary sentence as prose', () => {
    assert.deepEqual(
      readAnswer('Members can correct a return for one day, and the club desk can correct it any time after.', DIRS),
      { kind: 'prose' },
    );
  });

  void test('reads an answer that is only a link as link-only', () => {
    assert.equal(readAnswer('see https://docs.example.com/lantern-club/rules.pdf', DIRS).kind, 'link-only');
  });

  void test('reads a whitespace-only answer as empty', () => {
    assert.deepEqual(readAnswer('  \n ', DIRS), { kind: 'empty' });
  });
});

// ---- isLinkOnly ------------------------------------------------------------------------------------------------------

void describe('isLinkOnly — an answer with nothing in it to write down (resolve.md R2.1)', () => {
  void test('holds for a bare URL', () => {
    assert.equal(isLinkOnly('https://docs.example.com/lantern-club/rules'), true);
  });

  void test('holds for a file name', () => {
    assert.equal(isLinkOnly('lantern-rules-v3.pdf'), true);
  });

  void test('holds for a ticket number', () => {
    assert.equal(isLinkOnly('LAN-142'), true);
  });

  void test('holds for a "see" reference to a ticket', () => {
    assert.equal(isLinkOnly('see LAN-142'), true);
  });

  void test('holds for a markdown link alone', () => {
    assert.equal(isLinkOnly('[the club rules](https://docs.example.com/lantern-club/rules)'), true);
  });

  void test('holds for a "see" reference to a #-numbered ticket', () => {
    assert.equal(isLinkOnly('see #142'), true);
  });

  void test('fails for a sentence that says what the product does and cites a link', () => {
    assert.equal(
      isLinkOnly('Members can correct a return for one day — see https://docs.example.com/lantern-club/rules'),
      false,
    );
  });

  void test('fails for plain prose with no reference', () => {
    assert.equal(isLinkOnly('No, a logged return is final.'), false);
  });

  void test('gives the same answer when called twice on a URL (no regex state leaks between calls)', () => {
    assert.deepEqual(
      [isLinkOnly('https://docs.example.com/a'), isLinkOnly('https://docs.example.com/b')],
      [true, true],
    );
  });
});

void test('fixture sanity: the hand-built directions match the field text they stand for', () => {
  // Guards the DIRS fixture against drifting from DIRECTIONS_TEXT; the decision clauses are compared as literals.
  assert.deepEqual(
    DIRS.map((d) => DIRECTIONS_TEXT.includes(`${d.n}. ${d.decision} Why:`)),
    [true, true, true],
  );
});

// ---- the pointer is a whole token (review wave 2) ----------------------------------------------------------------------

void describe('readAnswer — a number is a pointer only as a whole token (resolve.md R2.1)', () => {
  // Each of these opens with a digit and is an ordinary answer: a decimal, a time, a range, a rate, or a value.
  for (const answer of [
    '2.5 seconds, then the home screen',
    '3:00 pm is the cut-off',
    '1-2 business days after pickup',
    '24/7 support desk answers refunds',
    '14, as the policy states',
  ]) {
    void test(`"${answer}" is prose, not a pointer`, () => {
      assert.equal(readAnswer(answer, DIRS).kind, 'prose');
    });
  }

  void test('"No 3 — we want the opposite" is a sentence, not a pointer at direction 3', () => {
    assert.equal(readAnswer('No 3 — we want the opposite', DIRS).kind, 'prose');
  });

  for (const answer of [
    'Both the customer and the store receive the receipt',
    'Any customer may cancel within the window',
    'Either party can cancel before pickup',
  ]) {
    void test(`"${answer}" is a sentence: both/either/any name no direction only as the whole answer`, () => {
      assert.equal(readAnswer(answer, DIRS).kind, 'prose');
    });
  }

  for (const answer of ['both', 'either 1 or 2', 'all of them', 'Both.']) {
    void test(`"${answer}" names no single direction`, () => {
      assert.equal(readAnswer(answer, DIRS).kind, 'bad-pointer');
    });
  }

  for (const answer of ['Monthly.', 'Email', 'Approved.', 'No', 'yes']) {
    void test(`the one-word decision "${answer}" is an answer`, () => {
      assert.equal(readAnswer(answer, DIRS).kind, 'prose');
    });
  }

  for (const answer of ['tbd', 'Double check', '??']) {
    void test(`"${answer}" decides nothing`, () => {
      assert.equal(readAnswer(answer, DIRS).kind, 'bad-pointer');
    });
  }

  void test('a bare number the row does not offer is a pointer gone wrong', () => {
    assert.equal(readAnswer('7', DIRS).kind, 'bad-pointer');
  });
});
