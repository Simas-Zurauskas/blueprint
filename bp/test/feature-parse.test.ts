import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasNumberedRequirement,
  markerLink,
  nextFreeFr,
  parseBody,
  type BodyMarker,
  type LabelledLine,
  type ParsedBody,
  type Requirement,
} from '../src/domain/feature.ts';
import { FEATURE_BLOCKS } from '../src/domain/vocab.ts';

// The feature row body reader (src/domain/feature.ts). Every fixture is SYNTHETIC, written in the shape doc-shape.md
// gives, with invented product text. Each multi-line fixture is one array element per physical line, so an element's
// index is its 0-based line index — the `line`, `start` and `end` values asserted below are read off those indices by
// hand.
//
// Spec rules exercised:
//   doc-shape.md §5   — the body is five blocks (Why · Behaviour · Edge cases · Rabbit holes · Not doing) and starts at
//                       `## Why`; FR-n lines; provenance lines `*(Applied … · depth n — …)*` under the requirement they
//                       touched, a line with no token being depth 1; `Default (standard practice — ratify on review): …
//                       (run <id> · <date>)` and `(… — ratified <date>)`; `Default (adopted from …, — ratify on review)`;
//                       `Not doing` is "No X — because Y; revisit if Z"; a missing block is reported, never written.
//   doc-shape.md §5 / databases.md §4 — a body with no numbered requirement in `Behaviour` is the seed case.
//   doc-shape.md §8   — requirement numbers never renumbered or reused; a deleted one leaves a tombstone
//                       `FR-4 — *withdrawn 2026-08-04, replaced by FR-7. No behaviour here.*`
//   doc-shape.md §9   — markers `[NEEDS CLARIFICATION: … → Question: <link to the row>]`, `→ Question: carried …`,
//                       `→ Default: ledger <run id> #<n>, awaiting ratification`; `→ Question: pending` names neither
//                       state; matched without the leading bracket because Notion escapes it (notion-mechanics.md §3).
//   targets.md §local — a named block is a `##` heading and everything under it up to the next `##`; writing one block
//                       changes nothing else in the file; questions are keyed by `q-NN`.
//   challenge.md Q4   — `Content slot — client-supplied: <what> · <shape/format> · <cardinality or bounds> · <who supplies>`.

// ---- helpers ---------------------------------------------------------------------------------------------------------

function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined)
    throw new assert.AssertionError({ message: `expected an element at index ${i}, found ${xs.length} elements` });
  return x;
}

const body = (lines: readonly string[]): string => lines.join('\n');

function requirement(p: ParsedBody, n: number): Requirement {
  const r = p.requirements.find((x) => x.n === n);
  if (!r) throw new assert.AssertionError({ message: `no FR-${n} among ${p.requirements.map((x) => x.n).join(', ')}` });
  return r;
}

function onlyLabelled(p: ParsedBody): LabelledLine {
  assert.equal(p.labelled.length, 1, `expected exactly one labelled line, found ${p.labelled.length}`);
  return nth(p.labelled, 0);
}

function onlyMarker(p: ParsedBody): BodyMarker {
  assert.equal(p.markers.length, 1, `expected exactly one marker, found ${p.markers.length}`);
  return nth(p.markers, 0);
}

/** A 32-hex Notion page id, invented for these tests. */
const ROW_ID = '2f1c3a9b7e4d4c2a8b6f1e0d9c8b7a61';

// ---- the full-shape fixture ------------------------------------------------------------------------------------------

/** All five blocks, a Notion-escaped marker on an FR line, a tombstone, provenance, a default and a carried marker. */
const FULL = [
  /*  0 */ '## Why',
  /*  1 */ 'Customers who pay for a pickup slot sometimes cannot make it, and today the only fix is a phone call to the shop.',
  /*  2 */ '',
  /*  3 */ '## Behaviour',
  /*  4 */ 'FR-1 — When a customer pays for an order, the system reserves the chosen pickup slot for that order.',
  /*  5 */ '*(Applied 2026-08-04 from «Can a customer change a pickup slot after paying?» `q-04` · depth 1 — answer and reasoning on that row.)*',
  /*  6 */ '*(Narrowed 2026-08-06 by the faithfulness check · depth 2 — the source says "most orders", not "all orders".)*',
  /*  7 */ `FR-2 — When a customer moves a paid order to another slot, the system frees the old slot. \\[NEEDS CLARIFICATION: FR-2 of «Checkout» — can a customer change a pickup slot after paying? → Question: <mention-page url="https://app.notion.com/p/${ROW_ID}"/>\\]`,
  /*  8 */ 'FR-3 — *withdrawn 2026-08-04, replaced by FR-5. No behaviour here.*',
  /*  9 */ 'FR-4 — When the shop closes a slot, the system tells every customer booked into it.',
  /* 10 */ "Slots are shown in the shop's local time.",
  /* 11 */ 'FR-5 — When a customer cancels a paid order before its slot, the system refunds the full amount.',
  /* 12 */ '',
  /* 13 */ '## Edge cases',
  /* 14 */ 'A slot that fills while the customer is paying: the payment is refused before the card is charged.',
  /* 15 */ 'Default (standard practice — ratify on review): an unpaid basket holds its slot for ten minutes. (run 9f2c1a · 2026-08-14)',
  /* 16 */ '[NEEDS CLARIFICATION: Edge cases of «Checkout» — what does a customer see when every slot today is full? → Question: carried (CON-7 · run-log 2026-08-04-init-1)]',
  /* 17 */ '',
  /* 18 */ '## Rabbit holes',
  /* 19 */ 'Slot capacity is counted at payment, not at basket time — the call is already made.',
  /* 20 */ '',
  /* 21 */ '## Not doing',
  /* 22 */ 'No native mobile app — because the team cannot staff two clients; revisit if a customer asks and will pay for it.',
  /* 23 */ 'No delivery — because the shop has no drivers.',
  /* 24 */ '',
] as const;

const FULL_TEXT = body(FULL);
const full = parseBody(FULL_TEXT);

// ---- blocks ----------------------------------------------------------------------------------------------------------

void describe('parseBody — the five blocks (doc-shape §5)', () => {
  void test('reads the five named blocks in the order they are written', () => {
    assert.deepEqual(
      full.blocks.map((b) => b.name),
      ['Why', 'Behaviour', 'Edge cases', 'Rabbit holes', 'Not doing'],
    );
  });

  void test('marks each of the five headings as the named block it is', () => {
    assert.deepEqual(
      full.blocks.map((b) => b.known),
      [...FEATURE_BLOCKS],
    );
  });

  void test('reports nothing missing and nothing foreign on a complete body', () => {
    assert.deepEqual({ missing: full.missing, foreign: full.foreign }, { missing: [], foreign: [] });
  });

  void test('runs each block from its heading up to the next `##` heading', () => {
    // Headings sit at FULL indices 0, 3, 13, 18, 21; the last block runs to the end (25 lines).
    assert.deepEqual(
      full.blocks.map((b) => [b.start, b.end]),
      [
        [0, 3],
        [3, 13],
        [13, 18],
        [18, 21],
        [21, 25],
      ],
    );
  });

  void test("keeps a block's lines after the heading exactly as written", () => {
    assert.deepEqual(nth(full.blocks, 3).lines, [FULL[19], FULL[20]]);
  });

  void test("keeps a block's raw text, heading included, exactly as written", () => {
    assert.equal(nth(full.blocks, 1).raw, FULL.slice(3, 13).join('\n'));
  });

  void test('reproduces the whole body byte for byte from the preamble and the blocks (one block can be replaced alone)', () => {
    assert.equal([...full.preamble, ...full.blocks.map((b) => b.raw)].join('\n'), FULL_TEXT);
  });

  void test('carries text above the first heading as the preamble, and still round-trips it', () => {
    const text = body([
      'Imported from the kickoff deck.',
      '',
      '## Why',
      'Members lose track of borrowed lanterns.',
      '',
      '## Behaviour',
      'FR-1 — When a member borrows a lantern, the system logs it.',
    ]);
    const p = parseBody(text);
    assert.deepEqual(p.preamble, ['Imported from the kickoff deck.', '']);
    assert.equal([...p.preamble, ...p.blocks.map((b) => b.raw)].join('\n'), text);
  });

  void test('names every block a body leaves out, in doc-shape order', () => {
    const p = parseBody(
      body([
        '## Why',
        'Members lose track of borrowed lanterns.',
        '',
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
      ]),
    );
    assert.deepEqual(p.missing, ['Edge cases', 'Rabbit holes', 'Not doing']);
  });

  void test('reports `Why` missing on a body that opens at `## Behaviour`', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
        '',
        '## Edge cases',
        'None yet.',
      ]),
    );
    assert.deepEqual(
      { first: nth(p.blocks, 0).name, missing: p.missing },
      { first: 'Behaviour', missing: ['Why', 'Rabbit holes', 'Not doing'] },
    );
  });

  void test('reports all five blocks missing on an empty body (a row a human created by hand)', () => {
    const p = parseBody('');
    assert.deepEqual({ blocks: p.blocks.length, missing: p.missing }, { blocks: 0, missing: [...FEATURE_BLOCKS] });
  });

  void test('keeps a heading doc-shape does not define as a foreign block, never dropping it', () => {
    const p = parseBody(
      body([
        '## Why',
        'Members lose track of borrowed lanterns.',
        '## Open notes',
        'Ask the club about winter hours.',
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
      ]),
    );
    assert.deepEqual(
      { foreign: p.foreign, blocks: p.blocks.map((b) => [b.name, b.known]) },
      {
        foreign: ['Open notes'],
        blocks: [
          ['Why', 'Why'],
          ['Open notes', null],
          ['Behaviour', 'Behaviour'],
        ],
      },
    );
  });

  void test('ends the block above at a foreign heading', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
        '## Open notes',
        'Ask the club about winter hours.',
      ]),
    );
    assert.deepEqual(nth(p.blocks, 0).lines, ['FR-1 — When a member borrows a lantern, the system logs it.']);
  });

  void test('does not open a block at a `###` sub-heading or a `#` title', () => {
    const p = parseBody(
      body([
        '# Borrow a lantern',
        '## Behaviour',
        '### Borrowing',
        'FR-1 — When a member borrows a lantern, the system logs it.',
      ]),
    );
    assert.deepEqual(
      p.blocks.map((b) => b.name),
      ['Behaviour'],
    );
  });

  void test('does not open a block at a `## ` line inside a code fence', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a customer pays, the system emails a receipt.',
        '```markdown',
        '## Receipt',
        'Thanks for your order.',
        '```',
        'FR-2 — When the receipt email bounces, the system shows the receipt on the order page.',
        '',
        '## Edge cases',
        'A customer with no email address gets no receipt email.',
      ]),
    );
    assert.deepEqual(
      { blocks: p.blocks.map((b) => b.name), foreign: p.foreign },
      { blocks: ['Behaviour', 'Edge cases'], foreign: [] },
    );
  });

  void test('keeps reading requirements after a code fence closes', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a customer pays, the system emails a receipt.',
        '```',
        '## Receipt',
        '```',
        'FR-2 — When the receipt email bounces, the system shows the receipt on the order page.',
      ]),
    );
    assert.deepEqual(
      p.requirements.map((r) => r.n),
      [1, 2],
    );
  });

  void test('reads a body with Windows line endings into the same blocks', () => {
    const p = parseBody(FULL.join('\r\n'));
    assert.deepEqual(
      p.blocks.map((b) => [b.name, b.start, b.end]),
      full.blocks.map((b) => [b.name, b.start, b.end]),
    );
  });

  void test('does not let a byte-order mark hide the first heading', () => {
    const p = parseBody('﻿## Why\nMembers lose track of borrowed lanterns.');
    assert.deepEqual({ first: nth(p.blocks, 0).name, preamble: p.preamble }, { first: 'Why', preamble: [] });
  });
});

// ---- requirements ----------------------------------------------------------------------------------------------------

void describe('parseBody — numbered requirements (doc-shape §5, §8)', () => {
  void test('reads every FR-n line in Behaviour by its number', () => {
    assert.deepEqual(
      full.requirements.map((r) => r.n),
      [1, 2, 3, 4, 5],
    );
  });

  void test("reads a requirement's sentence after `FR-n —`", () => {
    assert.equal(
      requirement(full, 1).text,
      'When a customer pays for an order, the system reserves the chosen pickup slot for that order.',
    );
  });

  void test("records a requirement's 0-based line in the whole body", () => {
    assert.deepEqual(
      full.requirements.map((r) => r.line),
      [4, 7, 8, 9, 11],
    );
  });

  void test('reads a multi-digit requirement number', () => {
    const p = parseBody(body(['## Behaviour', 'FR-12 — When a lantern is overdue, the system emails the borrower.']));
    assert.equal(nth(p.requirements, 0).n, 12);
  });

  void test('reads the tombstone shape as a withdrawn requirement', () => {
    assert.deepEqual(
      full.requirements.map((r) => [r.n, r.withdrawn]),
      [
        [1, false],
        [2, false],
        [3, true],
        [4, false],
        [5, false],
      ],
    );
  });

  void test('reads a live requirement that mentions withdrawal mid-sentence as live', () => {
    const p = parseBody(
      body(['## Behaviour', 'FR-1 — When a member has withdrawn from the club, the system hides their lanterns.']),
    );
    assert.equal(nth(p.requirements, 0).withdrawn, false);
  });

  void test('reads a live requirement whose sentence opens with the word "Withdrawn" as live, not a tombstone', () => {
    // §8's tombstone is `*withdrawn <date>, replaced by FR-n. No behaviour here.*`; this line is a failable requirement.
    const p = parseBody(
      body(['## Behaviour', 'FR-1 — Withdrawn bookings are refunded to the card that paid for them.']),
    );
    assert.equal(nth(p.requirements, 0).withdrawn, false);
  });

  void test('attaches provenance lines to the requirement above them', () => {
    assert.deepEqual(requirement(full, 1).provenance, [FULL[5], FULL[6]]);
  });

  void test('does not attach provenance to a requirement below it', () => {
    assert.deepEqual(requirement(full, 2).provenance, []);
  });

  void test('does not count a provenance line as unnumbered behaviour text', () => {
    assert.equal(
      full.unnumbered.some((u) => u.text.startsWith('*(')),
      false,
    );
  });

  void test("takes a requirement's depth from its newest provenance line", () => {
    assert.equal(requirement(full, 1).depth, 2);
  });

  void test('reads a requirement with no provenance as depth 1', () => {
    assert.equal(requirement(full, 4).depth, 1);
  });

  void test('reads a requirement whose provenance line carries no depth token as depth 1', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
        '*(Applied 2026-08-04 from «Who may borrow?» `q-02` — answer and reasoning on that row.)*',
      ]),
    );
    assert.equal(nth(p.requirements, 0).depth, 1);
  });

  void test('collects a non-empty Behaviour line that is not an FR, provenance or labelled line as unnumbered text', () => {
    assert.deepEqual(full.unnumbered, [{ text: "Slots are shown in the shop's local time.", line: 10 }]);
  });

  void test('does not read an FR-n line outside `Behaviour` as a requirement', () => {
    const p = parseBody(
      body([
        '## Why',
        'Members lose track of borrowed lanterns.',
        '## Edge cases',
        'FR-1 — When a member borrows a lantern, the system logs it.',
      ]),
    );
    assert.deepEqual(p.requirements, []);
  });
});

// ---- labelled lines --------------------------------------------------------------------------------------------------

void describe('parseBody — Default and Content-slot lines (doc-shape §5, challenge.md Q4)', () => {
  void test('reads an unratified standard-practice default with its run id and block', () => {
    const d = onlyLabelled(full);
    assert.deepEqual(
      { kind: d.kind, line: d.line, block: d.block, ratified: d.ratified, runId: d.runId },
      { kind: 'default', line: 15, block: 'Edge cases', ratified: false, runId: '9f2c1a' },
    );
  });

  void test('reads a re-labelled `ratified <date>` default as ratified', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'Default (standard practice — ratified 2026-08-20): reset links are single-use and expire. (run 9f2c1a · 2026-08-14)',
      ]),
    );
    assert.equal(onlyLabelled(p).ratified, true);
  });

  void test('reads a default adopted from a ratified design as an unratified default', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'Default (adopted from the ratified design, frame 298:9042 — ratify on review): the basket badge shows the item count.',
      ]),
    );
    const d = onlyLabelled(p);
    assert.deepEqual({ kind: d.kind, ratified: d.ratified }, { kind: 'default', ratified: false });
  });

  void test('does not count a Default line in Behaviour as unnumbered text', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member requests a reset, the system emails a link.',
        'Default (standard practice — ratify on review): reset links are single-use and expire. (run 9f2c1a · 2026-08-14)',
      ]),
    );
    assert.deepEqual(p.unnumbered, []);
  });

  void test('reads a content slot and who supplies it', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'Content slot — client-supplied: the pastry list · name + price + allergens · 20–60 items · supplied by the client · depth 1',
      ]),
    );
    const s = onlyLabelled(p);
    assert.deepEqual(
      { kind: s.kind, suppliedBy: s.suppliedBy, line: s.line, block: s.block },
      { kind: 'slot', suppliedBy: 'the client', line: 1, block: 'Behaviour' },
    );
  });
});

// ---- Not doing -------------------------------------------------------------------------------------------------------

void describe('parseBody — Not doing lines (doc-shape §5)', () => {
  void test('reads each non-empty Not doing line with its line number', () => {
    assert.deepEqual(
      full.notDoing.map((n) => [n.text, n.line]),
      [
        [FULL[22], 22],
        [FULL[23], 23],
      ],
    );
  });

  void test('sees both the because and the revisit if on a full-shape line', () => {
    const n = nth(full.notDoing, 0);
    assert.deepEqual({ hasBecause: n.hasBecause, hasRevisit: n.hasRevisit }, { hasBecause: true, hasRevisit: true });
  });

  void test('sees a line with no revisit if as missing its reopening condition', () => {
    const n = nth(full.notDoing, 1);
    assert.deepEqual({ hasBecause: n.hasBecause, hasRevisit: n.hasRevisit }, { hasBecause: true, hasRevisit: false });
  });

  void test('sees a bare refusal as missing both its why and its reopening condition', () => {
    const p = parseBody(body(['## Not doing', 'No gift cards.']));
    const n = nth(p.notDoing, 0);
    assert.deepEqual({ hasBecause: n.hasBecause, hasRevisit: n.hasRevisit }, { hasBecause: false, hasRevisit: false });
  });
});

// ---- markers in the body ---------------------------------------------------------------------------------------------

void describe('parseBody — markers (doc-shape §9, notion-mechanics §3)', () => {
  void test("finds a marker in Notion's escaped `\\[NEEDS CLARIFICATION: … \\]` form", () => {
    assert.equal(full.markers.filter((m) => m.line === 7).length, 1);
  });

  void test('finds every marker in the body, escaped or not', () => {
    assert.deepEqual(
      full.markers.map((m) => [m.block, m.line]),
      [
        ['Behaviour', 7],
        ['Edge cases', 16],
      ],
    );
  });

  void test('ties a marker on an FR line to that requirement', () => {
    assert.equal(nth(full.markers, 0).fr, 2);
  });

  void test('reads the Notion mention in an escaped marker as the question row id', () => {
    assert.deepEqual(nth(full.markers, 0).link, { kind: 'question', id: ROW_ID });
  });

  void test('ties no requirement to a marker outside `Behaviour`', () => {
    assert.equal(nth(full.markers, 1).fr, undefined);
  });

  void test('reads a carried marker with its contradiction citation', () => {
    assert.deepEqual(nth(full.markers, 1).link, { kind: 'carried', detail: '(CON-7 · run-log 2026-08-04-init-1)' });
  });

  void test('finds a marker in the Why block', () => {
    const p = parseBody(
      body([
        '## Why',
        'Members lose track of lanterns. [NEEDS CLARIFICATION: Why of «Borrow a lantern» — how many lanterns does the club own? → Question: q-03]',
      ]),
    );
    const m = onlyMarker(p);
    assert.deepEqual(
      { block: m.block, line: m.line, link: m.link },
      { block: 'Why', line: 1, link: { kind: 'question', key: 'q-03' } },
    );
  });
});

// ---- markerLink ------------------------------------------------------------------------------------------------------

void describe('markerLink — the link after the arrow (doc-shape §9)', () => {
  void test('reads a Notion markdown link to the row as that row id', () => {
    assert.deepEqual(
      markerLink(
        `can a customer change a pickup slot after paying? → Question: [Can a customer change a pickup slot after paying?](https://app.notion.com/p/${ROW_ID})`,
      ),
      {
        kind: 'question',
        id: ROW_ID,
      },
    );
  });

  void test('reads a Notion page mention as that row id', () => {
    assert.deepEqual(
      markerLink(
        `FR-2 of «Checkout» — can a slot change after paying? → Question: <mention-page url="https://app.notion.com/p/${ROW_ID}"/>`,
      ),
      { kind: 'question', id: ROW_ID },
    );
  });

  void test('reads an old-domain Notion URL with a title slug as the row id', () => {
    assert.deepEqual(
      markerLink(
        `FR-2 of «Checkout» — can a slot change after paying? → Question: https://www.notion.so/Pickup-slot-after-paying-${ROW_ID}`,
      ),
      { kind: 'question', id: ROW_ID },
    );
  });

  void test('normalises a dashed upper-case page id to 32 lower-case hex', () => {
    assert.deepEqual(
      markerLink(
        'FR-2 of «Checkout» — can a slot change after paying? → Question: https://app.notion.com/p/2F1C3A9B-7E4D-4C2A-8B6F-1E0D9C8B7A61',
      ),
      { kind: 'question', id: ROW_ID },
    );
  });

  void test('reads a local markdown link to a `q-NN` section as that key', () => {
    assert.deepEqual(
      markerLink(
        'FR-2 of «Checkout» — can a slot change after paying? → Question: [q-04](../questions.md#q-04--can-a-customer-change-a-pickup-slot-after-paying)',
      ),
      {
        kind: 'question',
        key: 'q-04',
      },
    );
  });

  void test('reads a bare `q-NN` key', () => {
    assert.deepEqual(markerLink('FR-2 of «Checkout» — can a slot change after paying? → Question: q-12'), {
      kind: 'question',
      key: 'q-12',
    });
  });

  void test('reads a bare `carried` with no detail', () => {
    assert.deepEqual(markerLink('FR-2 of «Checkout» — can a slot change after paying? → Question: carried'), {
      kind: 'carried',
      detail: '',
    });
  });

  void test('reads a default marker patched to its ledger line', () => {
    assert.deepEqual(
      markerLink(
        'FR-3 of «Reset password» — do reset links expire? → Default: ledger 9f2c1a #3, awaiting ratification',
      ),
      { kind: 'default', runId: '9f2c1a', n: 3 },
    );
  });

  void test('reads `→ Question: pending` as pending, the state that names neither carried nor a row', () => {
    assert.deepEqual(markerLink('FR-2 of «Checkout» — can a slot change after paying? → Question: pending'), {
      kind: 'pending',
    });
  });

  void test('reads link text that names no single row as unresolved, keeping the text', () => {
    assert.deepEqual(
      markerLink(
        "FR-2 of «Checkout» — can a slot change after paying? → Question: asked 2026-09-08, see this row's Questions",
      ),
      {
        kind: 'unresolved',
        text: "asked 2026-09-08, see this row's Questions",
      },
    );
  });

  void test('reads a marker with no arrow as having no link', () => {
    assert.deepEqual(markerLink('FR-2 of «Checkout» — can a customer change a pickup slot after paying?'), {
      kind: 'none',
    });
  });

  void test('reads an arrow with nothing after it as having no link', () => {
    assert.deepEqual(markerLink('FR-2 of «Checkout» — can a slot change after paying? → Question:'), { kind: 'none' });
  });
});

// ---- hasNumberedRequirement ------------------------------------------------------------------------------------------

void describe('hasNumberedRequirement — the fully-written test (databases §4)', () => {
  void test('holds for a body with a live numbered requirement', () => {
    assert.equal(hasNumberedRequirement(full), true);
  });

  void test('fails for a body whose Behaviour holds only unnumbered text (the seed case)', () => {
    const p = parseBody(
      body(['## Why', 'Members lose track of borrowed lanterns.', '', '## Behaviour', 'Members can borrow lanterns.']),
    );
    assert.equal(hasNumberedRequirement(p), false);
  });

  void test('fails for a body whose only requirements are tombstones', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — *withdrawn 2026-08-04, replaced by FR-1 of «Return a lantern». No behaviour here.*',
      ]),
    );
    assert.equal(hasNumberedRequirement(p), false);
  });

  void test('fails for an empty body', () => {
    assert.equal(hasNumberedRequirement(parseBody('')), false);
  });
});

// ---- nextFreeFr ------------------------------------------------------------------------------------------------------

void describe('nextFreeFr — never a reused number (doc-shape §8)', () => {
  void test('is one past the highest number, counting tombstones', () => {
    // FULL holds FR-1..FR-5, FR-3 a tombstone.
    assert.equal(nextFreeFr(full), 6);
  });

  void test('does not reuse the number of a withdrawn highest requirement', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
        'FR-2 — *withdrawn 2026-08-04, replaced by FR-1. No behaviour here.*',
      ]),
    );
    assert.equal(nextFreeFr(p), 3);
  });

  void test('does not refill a gap in the numbering', () => {
    const p = parseBody(
      body([
        '## Behaviour',
        'FR-1 — When a member borrows a lantern, the system logs it.',
        'FR-3 — When a lantern is returned, the system closes the loan.',
      ]),
    );
    assert.equal(nextFreeFr(p), 4);
  });

  void test('is 1 for a body with no numbered requirement', () => {
    assert.equal(
      nextFreeFr(parseBody(body(['## Why', 'Members lose track of borrowed lanterns.', '## Behaviour']))),
      1,
    );
  });
});
