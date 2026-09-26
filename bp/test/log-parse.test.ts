import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  entryState,
  kindOf,
  parseHeading,
  parseLog,
  type EntryState,
  type ParsedEntry,
  type ParsedLine,
} from '../src/log/parse.ts';
import { LOG_KINDS } from '../src/domain/vocab.ts';
import { SKILL_ROOT, makeHome, readFile, run } from './support/index.ts';

// The run log's tolerant reader (src/log/parse.ts). Every fixture below is SYNTHETIC: it mirrors the shape of the three
// formats real Blueprints carry (DESIGN.md §4.2, C5) with invented product text. Expected values are counted by hand
// from the fixture arrays: each fixture is written as one array element per physical line, so an element's index is
// its 0-based physical index and index + 1 is its 1-based line number.
//
// Spec rules exercised:
//   SKILL.md pre-flight 4 — "An entry's state is its last dated line, and only that"; headings never carry state.
//   resolve.md R1 — a human clears a dead run by writing `CLOSED (crashed)` under it, by hand.
//   resolve.md R5 — the closed list of line kinds; `closing` is `CLOSED hh:mm …` or `PAUSED …`; `ledger`/`fix`/`manifest`
//                   stand for `<kind> <run id> #<n>`, `CON` for every `CON-<k>` (a bare `CON` is no kind); `group heading`
//                   is on the list (resolve.md:917) and routed to runs/.
//   status.md C10 — the kind is lower-case `funnel`; a line written `FUNNEL` must be seen as the funnel, case flagged.
//   Fenced v21 logs — a new entry goes above the ``` fence that opens the first entry, so that fence is where the preamble
//                   ends and where the entry's block starts (ParsedLog.preambleEnd, ParsedEntry.blockStart).
//   A heading is never indented: an indented dated line continues the line above it. A UTF-8 BOM is not text.

// ---- helpers ---------------------------------------------------------------------------------------------------------

function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined)
    throw new assert.AssertionError({ message: `expected an element at index ${i}, found ${xs.length} elements` });
  return x;
}

const entryAt = (text: string, i: number): ParsedEntry => nth(parseLog(text).entries, i);
const tokens = (e: ParsedEntry): (string | null)[] => e.lines.map((l) => l.token);
const lineWithToken = (e: ParsedEntry, token: string): ParsedLine => {
  const l = e.lines.find((x) => x.token === token);
  if (!l) throw new assert.AssertionError({ message: `no line with token "${token}" in entry run ${e.heading.runId}` });
  return l;
};

/** A one-entry v37 log whose entry holds exactly `body`; returns that entry's state. */
function stateOf(
  body: string[],
  heading = '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
): EntryState {
  return entryState(
    entryAt(['# Run log — «Lantern Club» Blueprint', '', '---', '', heading, '', ...body, ''].join('\n'), 0),
  );
}

// ---- fixtures --------------------------------------------------------------------------------------------------------

/** (a) v37: `## date · time · …` headings, `- kind: text` bullets, `---` separators. */
const V37_LINES = [
  /*  0 */ '# Run log — «Lantern Club» Blueprint',
  /*  1 */ '',
  /*  2 */ 'Append-only, newest entry first. Never rewritten, never summarised away.',
  /*  3 */ '',
  /*  4 */ '---',
  /*  5 */ '',
  /*  6 */ '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
  /*  7 */ '',
  /*  8 */ '- header: date 2026-09-25 · time 16:41 · command add · run a2d011 · version 37 · sitting 1',
  /*  9 */ '- item: «Borrow a lantern» FR-3 · written',
  /* 10 */ '- fix a2d011 #1: «Return a lantern» FR-2 reworded',
  /* 11 */ '- ledger 4d7fbd #3: late-return window defaulted to seven days',
  /* 12 */ '- CON-3: «Borrow a lantern» FR-1 superseded · sources/a2d011/notes.md',
  /* 13 */ '- COLD READ: row q-07 demoted to a discard',
  /* 14 */ '- FUNNEL: drafted 3 = kept 2 · discarded 1',
  /* 15 */ '- closing: CLOSED 16:52 · HUMAN-BLOCKED · run totals: 1 applied',
  /* 16 */ '',
  /* 17 */ '---',
  /* 18 */ '',
  /* 19 */ '## 2026-09-24 · 9:05 · resolve · run 6dca4f · skill v37 · sitting 2',
  /* 20 */ '',
  /* 21 */ '- header: date 2026-09-24 · time 09:05 · command resolve · run 6dca4f · version 37 · sitting 2',
  /* 22 */ '- item: «Late returns» FR-4 · Patched',
  /* 23 */ '- closing: PAUSED 09:30 — sitting 2, 3 rows still queued',
  /* 24 */ '',
  /* 25 */ '---',
  /* 26 */ '',
];
const V37 = V37_LINES.join('\n');

/** (b) v21 column format: `## date time · …` headings, `KIND   text` lines, indented continuations, bare closings. */
const V21_LINES = [
  /*  0 */ '# Run log',
  /*  1 */ '',
  /*  2 */ 'Machine-owned. Append-only, newest entry first. Never rewritten.',
  /*  3 */ '',
  /*  4 */ '---',
  /*  5 */ '',
  /*  6 */ '## 2026-08-25 08:35 · add · run e7b41c · skill v21 · mode: default (source wins)',
  /*  7 */ 'CON-9        source-vs-document, one direction only',
  /*  8 */ 'item         «Renewals» FR-5 added from the source',
  /*  9 */ 'CLOSED 08:52 · run totals: 1 feature, 1 requirement',
  /* 10 */ '',
  /* 11 */ '## 2026-08-22 09:47 · resolve · run 4c1e7b · skill v21 · sitting 2 · 5 of 5 remaining',
  /* 12 */ 'item         «Is the renewal fee refundable?»  Patched  «Renewals» FR-4',
  /* 13 */ 'CLOSED 10:19 · HUMAN-BLOCKED · run totals: 6 applied',
  /* 14 */ '             · 1 flagged · 2 sittings',
  /* 15 */ '',
  /* 16 */ '## 2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1 · 10 of 15 queued',
  /* 17 */ 'NOTE         2026-08-22 — crossover: the older log stays on its Notion page',
  /* 18 */ '             as read-only history; new entries go here.',
  /* 19 */ 'check        R1 version — stamped v15, VERSION 21, reconciled at v16; the old entry was',
  /* 20 */ '             CLOSED 14:05 on 2026-08-19.',
  /* 21 */ 'independence: writer model-a, checker model-b · dispatch probe:',
  /* 22 */ '             attempted, succeeded via the shell',
  /* 23 */ 'ENTRY OPEN — this run is in flight.',
  /* 24 */ 'item         «Can a member renew online?»  Clean  «Renewals» FR-2',
  /* 25 */ 'FUNNEL       drafted 4 = kept 3 · discarded 1',
  /* 26 */ 'PAUSED — sitting 1 of a continuing run, 5 rows still queued',
  /* 27 */ '',
];
const V21 = V21_LINES.join('\n');

/** (c) fenced: each entry inside a ``` fence, its heading a plain line; a closing line wrapped onto unindented lines. */
const FENCE = '```';
const FENCED_LINES = [
  /*  0 */ '# Run log — Harbour Tours Blueprint',
  /*  1 */ '',
  /*  2 */ 'Append-only, newest entry first.',
  /*  3 */ '',
  /*  4 */ '---',
  /*  5 */ '',
  /*  6 */ FENCE,
  /*  7 */ '2026-08-27 16:43 · add · run 2511fb · skill v21 · sitting 1 · mode: default (source wins)',
  /*  8 */ 'independence: writer model-a, checker model-b · dispatch probe:',
  /*  9 */ '             attempted, succeeded via the shell',
  /* 10 */ 'item         «Book a tour» FR-2 written',
  /* 11 */ 'CLOSED 17:12 · HUMAN-BLOCKED — nothing actionable is left for a run, and what this',
  /* 12 */ 'run leaves behind needs a person: 3 Open rows.',
  /* 13 */ 'Run totals: 1 feature written.',
  /* 14 */ FENCE,
  /* 15 */ '',
  /* 16 */ '---',
  /* 17 */ '',
  /* 18 */ FENCE,
  /* 19 */ '2026-08-22 13:22 · resolve · run 5c07d2 · skill v21 · sitting 1 · 2 of 2 queued',
  /* 20 */ 'item         «Can a tour be moved?»  Clean  «Book a tour» FR-4',
  /* 21 */ 'PAUSED — sitting 1, 1 row still queued',
  /* 22 */ FENCE,
  /* 23 */ '',
];
const FENCED = FENCED_LINES.join('\n');

// ---- parseHeading ----------------------------------------------------------------------------------------------------

void describe('parseHeading', () => {
  void test('reads date, time, command, run id, version and sitting from a v37 markdown heading', () => {
    const h = parseHeading('## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1');
    assert.ok(h);
    assert.deepEqual(
      { date: h.date, time: h.time, command: h.command, runId: h.runId, version: h.version, sitting: h.sitting },
      { date: '2026-09-25', time: '16:41', command: 'add', runId: 'a2d011', version: 37, sitting: 1 },
    );
  });

  void test('reads a v21 heading with no separator between date and time', () => {
    const h = parseHeading('## 2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1 · 10 of 15 queued');
    assert.ok(h);
    assert.deepEqual(
      { date: h.date, time: h.time, command: h.command, runId: h.runId, version: h.version, sitting: h.sitting },
      { date: '2026-08-22', time: '08:54', command: 'resolve', runId: '4c1e7b', version: 21, sitting: 1 },
    );
  });

  void test('reads a plain-line heading with no ## prefix (the fenced format)', () => {
    const h = parseHeading('2026-08-27 16:43 · add · run 2511fb · skill v21 · sitting 1 · mode: default (source wins)');
    assert.ok(h);
    assert.deepEqual(
      [h.date, h.time, h.command, h.runId, h.version, h.sitting],
      ['2026-08-27', '16:43', 'add', '2511fb', 21, 1],
    );
  });

  void test('zero-pads a single-digit hour to hh:mm', () => {
    assert.equal(parseHeading('## 2026-09-24 · 9:05 · resolve · run 6dca4f · skill v37 · sitting 2')?.time, '09:05');
  });

  void test('keeps the queue and mode tokens after the run id as written', () => {
    const h = parseHeading(
      '## 2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1 · 10 of 15 queued · mode: force',
    );
    assert.ok(h);
    assert.match(h.rest, /skill v21 · sitting 1 · 10 of 15 queued · mode: force$/);
  });

  void test('gives a heading with no sitting token a null sitting', () => {
    const h = parseHeading('## 2026-08-25 08:35 · add · run e7b41c · skill v21 · mode: default (source wins)');
    assert.ok(h);
    assert.equal(h.sitting, null);
    assert.equal(h.version, 21);
  });

  void test('gives a heading with no skill version a null version', () => {
    const h = parseHeading('## 2026-08-25 08:35 · add · run e7b41c · sitting 3');
    assert.ok(h);
    assert.equal(h.version, null);
    assert.equal(h.sitting, 3);
  });

  void test('tolerates trailing whitespace after the heading', () => {
    assert.equal(parseHeading('## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1   ')?.runId, 'a2d011');
  });

  const notHeadings: [string, string][] = [
    ['an empty line', ''],
    ['the preamble title', '# Run log — «Lantern Club» Blueprint'],
    ['a heading with no run id', '## 2026-09-25 · 16:41 · add · skill v37 · sitting 1'],
    ['a heading whose date is not zero-padded', '## 2026-9-25 · 16:41 · add · run a2d011 · skill v37'],
    ['a heading with no time', '## 2026-09-25 · add · run a2d011 · skill v37'],
    ['a heading whose time has no colon', '## 2026-09-25 · 1641 · add · run a2d011 · skill v37'],
    ['a bullet line that mentions a date', '- check: pre-flight — newest entry 2026-09-25 · 16:41 · add · run a2d011'],
    [
      'a column NOTE that begins with a date after its kind',
      'NOTE         2026-08-22 — crossover: new entries go here',
    ],
  ];
  for (const [what, line] of notHeadings) {
    void test(`does not read ${what} as a heading`, () => {
      assert.equal(parseHeading(line), null);
    });
  }
});

// ---- kindOf ----------------------------------------------------------------------------------------------------------

void describe('kindOf', () => {
  // `CON` on the list stands for every `CON-<k>`; written bare it is no kind (tested below), so the two loops skip it.
  const writtenAsListed = LOG_KINDS.filter((k) => k !== 'CON');

  void test('maps every kind on the closed list, written exactly, to itself with no case mismatch', () => {
    for (const k of writtenAsListed) assert.deepEqual(kindOf(k), { kind: k, caseMismatch: false }, k);
  });

  void test('maps every kind on the closed list, written in the other case, to itself and flags the case mismatch', () => {
    const swapCase = (s: string): string => (s === s.toLowerCase() ? s.toUpperCase() : s.toLowerCase());
    for (const k of writtenAsListed)
      assert.deepEqual(kindOf(swapCase(k)), { kind: k, caseMismatch: true }, swapCase(k));
  });

  void test('maps a bare CON, with no -k number, to no kind', () => {
    assert.deepEqual(kindOf('CON'), { kind: null, caseMismatch: false });
  });

  void test('maps the two-word group heading token to the group heading kind (resolve.md:917)', () => {
    assert.deepEqual(kindOf('group heading'), { kind: 'group heading', caseMismatch: false });
  });

  void test('flags a group heading token written in capitals as a case mismatch', () => {
    assert.deepEqual(kindOf('GROUP HEADING'), { kind: 'group heading', caseMismatch: true });
  });

  void test('reads FUNNEL as the lower-case funnel kind and flags the case (status.md C10)', () => {
    assert.deepEqual(kindOf('FUNNEL'), { kind: 'funnel', caseMismatch: true });
  });

  void test('reads DISCARD as the lower-case discard kind and flags the case (status.md C10)', () => {
    assert.deepEqual(kindOf('DISCARD'), { kind: 'discard', caseMismatch: true });
  });

  void test('maps a numbered CON-k token to the CON kind', () => {
    assert.deepEqual(kindOf('CON-3'), { kind: 'CON', caseMismatch: false });
    assert.deepEqual(kindOf('CON-16'), { kind: 'CON', caseMismatch: false });
  });

  void test('flags a CON-k token written in lower case', () => {
    assert.deepEqual(kindOf('con-3'), { kind: 'CON', caseMismatch: true });
  });

  void test('maps `<kind> <run id> #<n>` batch tokens to fix, ledger and manifest', () => {
    assert.deepEqual(kindOf('fix a2d011 #1'), { kind: 'fix', caseMismatch: false });
    assert.deepEqual(kindOf('ledger 4d7fbd #3'), { kind: 'ledger', caseMismatch: false });
    assert.deepEqual(kindOf('manifest 16f7e6 #12'), { kind: 'manifest', caseMismatch: false });
  });

  void test('flags a batch token whose kind word is capitalised', () => {
    assert.deepEqual(kindOf('Ledger 4d7fbd #3'), { kind: 'ledger', caseMismatch: true });
    assert.deepEqual(kindOf('FIX a2d011 #2'), { kind: 'fix', caseMismatch: true });
  });

  const offList: [string, string][] = [
    ['an off-list two-word kind', 'COLD READ'],
    ['an empty token', ''],
    ['CON- with no number', 'CON-'],
    ['a lower-case bare con', 'con'],
    ['CON- with a word instead of a number', 'CON-CONSERV'],
    ['a batch token with no line number', 'fix a2d011'],
    ['a batch token whose line number is not a number', 'ledger 4d7fbd #x'],
    ['a plural near-miss of a kind', 'FIXES'],
    ['a closed-list kind followed by extra words', 'item extra'],
    ['prose that opens a v21 in-flight marker', 'ENTRY OPEN'],
  ];
  for (const [what, token] of offList) {
    void test(`maps ${what} to no kind and no case mismatch`, () => {
      assert.deepEqual(kindOf(token), { kind: null, caseMismatch: false });
    });
  }
});

// ---- parseLog: (a) v37 -----------------------------------------------------------------------------------------------

void describe('parseLog — v37 bullet format', () => {
  void test('ends the preamble at the first entry heading', () => {
    assert.equal(parseLog(V37).preambleEnd, 6);
  });

  void test('keeps the physical lines exactly as written, so the text rejoins byte for byte', () => {
    const log = parseLog(V37);
    assert.deepEqual(log.physical, V37_LINES);
    assert.equal(log.physical.join('\n'), V37);
  });

  void test('reads two entries in file order', () => {
    assert.deepEqual(
      parseLog(V37).entries.map((e) => e.heading.runId),
      ['a2d011', '6dca4f'],
    );
  });

  void test('spans each entry from its heading to the next heading, or to the end of the file', () => {
    const { entries, physical } = parseLog(V37);
    assert.deepEqual(
      entries.map((e) => [e.start, e.end, e.headingLine]),
      [
        [6, 19, 7],
        [19, physical.length, 20],
      ],
    );
    assert.equal(physical.length, 27);
  });

  void test('marks a ## heading as a markdown heading', () => {
    assert.equal(entryAt(V37, 0).markdownHeading, true);
  });

  void test("starts each unfenced entry's block at its own heading", () => {
    assert.deepEqual(
      parseLog(V37).entries.map((e) => e.blockStart),
      [6, 19],
    );
  });

  void test('reads every bullet line and skips blank lines and --- separators', () => {
    assert.deepEqual(tokens(entryAt(V37, 0)), [
      'header',
      'item',
      'fix a2d011 #1',
      'ledger 4d7fbd #3',
      'CON-3',
      'COLD READ',
      'FUNNEL',
      'closing',
    ]);
    assert.deepEqual(tokens(entryAt(V37, 1)), ['header', 'item', 'closing']);
  });

  void test('gives every bullet line the bullet format and its 1-based physical line number', () => {
    const e = entryAt(V37, 0);
    assert.ok(e.lines.every((l) => l.format === 'bullet'));
    assert.deepEqual(
      e.lines.map((l) => l.lineNo),
      [9, 10, 11, 12, 13, 14, 15, 16],
    );
  });

  void test('maps batch-numbered and CON-k tokens to their closed-list kinds', () => {
    const e = entryAt(V37, 0);
    assert.equal(lineWithToken(e, 'fix a2d011 #1').kind, 'fix');
    assert.equal(lineWithToken(e, 'ledger 4d7fbd #3').kind, 'ledger');
    assert.equal(lineWithToken(e, 'CON-3').kind, 'CON');
  });

  void test('keeps an off-list bullet token as written with no kind', () => {
    const l = lineWithToken(entryAt(V37, 0), 'COLD READ');
    assert.equal(l.kind, null);
    assert.equal(l.caseMismatch, false);
    assert.equal(l.text, 'row q-07 demoted to a discard');
  });

  void test('reads a FUNNEL bullet as the funnel kind with the case mismatch flagged (status.md C10)', () => {
    const l = lineWithToken(entryAt(V37, 0), 'FUNNEL');
    assert.equal(l.kind, 'funnel');
    assert.equal(l.caseMismatch, true);
  });

  void test('takes the text after the first kind colon, keeping later colons', () => {
    assert.equal(
      lineWithToken(entryAt(V37, 0), 'closing').text,
      'CLOSED 16:52 · HUMAN-BLOCKED · run totals: 1 applied',
    );
  });

  void test('reads a closed entry as closed and a paused entry as paused', () => {
    assert.deepEqual(parseLog(V37).entries.map(entryState), ['closed', 'paused']);
  });
});

// ---- parseLog: (b) v21 column format ---------------------------------------------------------------------------------

void describe('parseLog — v21 column format', () => {
  void test('ends the preamble at the first entry heading', () => {
    assert.equal(parseLog(V21).preambleEnd, 6);
  });

  void test('reads three entries with their commands, run ids and sittings', () => {
    assert.deepEqual(
      parseLog(V21).entries.map((e) => [e.heading.command, e.heading.runId, e.heading.sitting, e.headingLine]),
      [
        ['add', 'e7b41c', null, 7],
        ['resolve', '4c1e7b', 2, 12],
        ['resolve', '4c1e7b', 1, 17],
      ],
    );
  });

  void test('keeps the mode token on a heading with no sitting', () => {
    assert.match(entryAt(V21, 0).heading.rest, /mode: default \(source wins\)$/);
  });

  void test('reads column lines by their kind token', () => {
    assert.deepEqual(tokens(entryAt(V21, 2)), ['NOTE', 'check', 'independence', null, 'item', 'FUNNEL', 'closing']);
  });

  void test('gives column lines the column format and their first physical line number', () => {
    const e = entryAt(V21, 2);
    assert.deepEqual(
      e.lines.map((l) => [l.format, l.lineNo]),
      [
        ['column', 18],
        ['column', 20],
        ['column', 22],
        ['prose', 24],
        ['column', 25],
        ['column', 26],
        ['bare', 27],
      ],
    );
  });

  void test('takes a column line text from after the padding', () => {
    assert.equal(lineWithToken(entryAt(V21, 2), 'item').text, '«Can a member renew online?»  Clean  «Renewals» FR-2');
  });

  void test('joins an indented continuation onto its line with a single space', () => {
    assert.equal(
      lineWithToken(entryAt(V21, 2), 'NOTE').text,
      '2026-08-22 — crossover: the older log stays on its Notion page as read-only history; new entries go here.',
    );
  });

  void test('joins a continuation onto a colon-form column line (independence)', () => {
    const l = lineWithToken(entryAt(V21, 2), 'independence');
    assert.equal(l.kind, 'independence');
    assert.equal(l.text, 'writer model-a, checker model-b · dispatch probe: attempted, succeeded via the shell');
  });

  void test('maps a CON-k column token to the CON kind', () => {
    assert.equal(lineWithToken(entryAt(V21, 0), 'CON-9').kind, 'CON');
  });

  void test('reads a FUNNEL column line as the funnel kind with the case mismatch flagged (status.md C10)', () => {
    const l = lineWithToken(entryAt(V21, 2), 'FUNNEL');
    assert.deepEqual([l.kind, l.caseMismatch, l.text], ['funnel', true, 'drafted 4 = kept 3 · discarded 1']);
  });

  void test('reads a line with no closed-list kind as prose with no token', () => {
    const l = nth(entryAt(V21, 2).lines, 3);
    assert.deepEqual(
      { token: l.token, kind: l.kind, caseMismatch: l.caseMismatch, text: l.text, format: l.format },
      { token: null, kind: null, caseMismatch: false, text: 'ENTRY OPEN — this run is in flight.', format: 'prose' },
    );
  });

  void test('reads a bare CLOSED line as a closing line and joins its indented continuation', () => {
    const l = lineWithToken(entryAt(V21, 1), 'closing');
    assert.deepEqual(
      [l.kind, l.format, l.text],
      ['closing', 'bare', 'CLOSED 10:19 · HUMAN-BLOCKED · run totals: 6 applied · 1 flagged · 2 sittings'],
    );
  });

  void test('reads a bare PAUSED line as a closing line', () => {
    const l = lineWithToken(entryAt(V21, 2), 'closing');
    assert.deepEqual(
      [l.kind, l.format, l.text],
      ['closing', 'bare', 'PAUSED — sitting 1 of a continuing run, 5 rows still queued'],
    );
  });

  void test('keeps an indented continuation that begins with CLOSED inside the line it continues', () => {
    assert.equal(
      lineWithToken(entryAt(V21, 2), 'check').text,
      'R1 version — stamped v15, VERSION 21, reconciled at v16; the old entry was CLOSED 14:05 on 2026-08-19.',
    );
  });

  void test('reads each entry state from its own closing line', () => {
    assert.deepEqual(parseLog(V21).entries.map(entryState), ['closed', 'closed', 'paused']);
  });
});

// ---- parseLog: (c) fenced ---------------------------------------------------------------------------------------------

void describe('parseLog — fenced format', () => {
  void test('reads a plain-line heading inside a fence as an entry that is not a markdown heading', () => {
    const e = entryAt(FENCED, 0);
    assert.deepEqual(
      [e.heading.runId, e.heading.command, e.headingLine, e.markdownHeading],
      ['2511fb', 'add', 8, false],
    );
  });

  void test('ends the preamble at the ``` fence that opens the first entry, not inside it', () => {
    // FENCED_LINES[6] is the fence; the first heading is [7].
    assert.equal(parseLog(FENCED).preambleEnd, 6);
  });

  void test("starts the first entry's block at the fence that opens it", () => {
    assert.equal(entryAt(FENCED, 0).blockStart, 6);
  });

  void test("starts a later entry's block at its own opening fence", () => {
    // FENCED_LINES[14] closes the first entry's fence and [18] opens the second's, directly above its heading at [19].
    assert.equal(entryAt(FENCED, 1).blockStart, 18);
  });

  void test('spans each entry from its heading to the fence that opens the next entry, or to the end of the file', () => {
    const { entries, physical } = parseLog(FENCED);
    assert.equal(physical.length, 24);
    assert.deepEqual(
      entries.map((e) => [e.start, e.end]),
      [
        [7, 18],
        [19, 24],
      ],
    );
  });

  void test('does not read fence lines as entry lines', () => {
    assert.deepEqual(
      parseLog(FENCED).entries.map((e) => e.lines.length),
      [5, 2],
    );
  });

  void test('reads the lines of a closing wrapped onto unindented lines as prose after the closing', () => {
    const e = entryAt(FENCED, 0);
    assert.deepEqual(
      e.lines.map((l) => [l.token, l.format]),
      [
        ['independence', 'column'],
        ['item', 'column'],
        ['closing', 'bare'],
        [null, 'prose'],
        [null, 'prose'],
      ],
    );
  });

  void test('reads an entry whose CLOSED line wraps onto unindented prose as closed', () => {
    assert.equal(entryState(entryAt(FENCED, 0)), 'closed');
  });

  void test('reads an entry ending in a bare PAUSED line as paused', () => {
    assert.equal(entryState(entryAt(FENCED, 1)), 'paused');
  });
});

// ---- entryState (SKILL.md pre-flight 4, resolve.md R1) ---------------------------------------------------------------

void describe('entryState', () => {
  void test('reads an entry with no closing line as open', () => {
    assert.equal(stateOf(['- header: date 2026-09-25', '- item: «Borrow a lantern» FR-3 · written']), 'open');
  });

  void test('reads an entry with only a heading as open', () => {
    assert.equal(stateOf([]), 'open');
  });

  void test('reads `closing: CLOSED hh:mm` as closed', () => {
    assert.equal(stateOf(['- item: «Borrow a lantern» FR-3', '- closing: CLOSED 16:52 · DRAINED']), 'closed');
  });

  void test('reads `closing: PAUSED …` as paused', () => {
    assert.equal(
      stateOf(['- item: «Borrow a lantern» FR-3', '- closing: PAUSED 16:52 — sitting 1, 2 rows still queued']),
      'paused',
    );
  });

  void test('reads a hand-written bare CLOSED (crashed) under an open entry as closed (resolve.md R1)', () => {
    assert.equal(stateOf(['- item: «Borrow a lantern» FR-3 · written', 'CLOSED (crashed)']), 'closed');
  });

  void test('reads a hand-written CLOSED (crashed) written as a markdown bullet as closed', () => {
    assert.equal(stateOf(['- item: «Borrow a lantern» FR-3 · written', '- CLOSED (crashed)']), 'closed');
  });

  void test('reads a hand-written `closing: CLOSED (crashed)` without the bullet dash as closed', () => {
    assert.equal(stateOf(['- item: «Borrow a lantern» FR-3 · written', 'closing: CLOSED (crashed)']), 'closed');
  });

  void test('reads CLOSED (crashed) written after a PAUSED line as closed — the last dated line wins', () => {
    assert.equal(stateOf(['- closing: PAUSED 15:12 — sitting 1', 'CLOSED (crashed)']), 'closed');
  });

  void test('reads a PAUSED line written after a CLOSED line as paused — only the last dated line counts', () => {
    assert.equal(stateOf(['- closing: CLOSED 15:12 · DRAINED', '- closing: PAUSED 15:40 — sitting 2']), 'paused');
  });

  void test('ignores a status token written on the heading', () => {
    assert.equal(
      stateOf(
        ['- item: «Borrow a lantern» FR-3'],
        '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1 · CLOSED 16:52',
      ),
      'open',
    );
  });

  void test('ignores CLOSED at the start of a line of another kind', () => {
    assert.equal(
      stateOf([
        '- NOTE: CLOSED 14:05 was the last line of the Notion log',
        '- check: pre-flight — newest entry reads CLOSED 16:52',
      ]),
      'open',
    );
  });

  void test('reads the state of each entry from its own lines only', () => {
    const text = [
      '## 2026-09-25 · 17:27 · add · run 9dc077 · skill v37 · sitting 1',
      '- item: «Borrow a lantern» FR-3 · written',
      '---',
      '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
      '- closing: CLOSED 16:52 · DRAINED',
      '',
    ].join('\n');
    assert.deepEqual(parseLog(text).entries.map(entryState), ['open', 'closed']);
  });
});

// ---- malformed and edge input ----------------------------------------------------------------------------------------

void describe('parseLog — malformed and edge input', () => {
  void test('reads empty text as no entries with the preamble running to the end', () => {
    const log = parseLog('');
    assert.deepEqual([log.entries.length, log.preambleEnd, log.physical], [0, 1, ['']]);
  });

  void test('reads a preamble with no entries as no entries with the preamble running to the end', () => {
    const log = parseLog('# Run log — «Lantern Club» Blueprint\n\nAppend-only.\n\n---\n');
    assert.deepEqual([log.entries.length, log.preambleEnd], [0, 6]);
  });

  void test('does not attribute kind-shaped lines in the preamble to any entry', () => {
    const text = [
      '# Run log',
      '- NOTE: crossover, older entries live on the Notion page',
      'CLOSED 14:05',
      '',
      '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
      '- item: «Borrow a lantern» FR-3',
      '',
    ].join('\n');
    const log = parseLog(text);
    assert.equal(log.preambleEnd, 4);
    assert.deepEqual(tokens(nth(log.entries, 0)), ['item']);
    assert.equal(entryState(nth(log.entries, 0)), 'open');
  });

  void test('keeps a heading-like line with no run id inside the current entry as prose', () => {
    const text = [
      '## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1',
      '- item: «Borrow a lantern» FR-3',
      '## 2026-09-25 · 17:00 · add · skill v37 · sitting 1',
      '',
    ].join('\n');
    const log = parseLog(text);
    assert.equal(log.entries.length, 1);
    assert.deepEqual(
      nth(log.entries, 0).lines.map((l) => [l.token, l.format]),
      [
        ['item', 'bullet'],
        [null, 'prose'],
      ],
    );
  });

  void test('reads a bullet with a kind and no text as that kind with empty text', () => {
    const l = nth(
      entryAt(['## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1', '- closing:', ''].join('\n'), 0)
        .lines,
      0,
    );
    assert.deepEqual([l.token, l.kind, l.text, l.format], ['closing', 'closing', '', 'bullet']);
  });

  void test('reads CRLF line endings exactly as LF ones', () => {
    const crlf = parseLog(V21.replace(/\n/g, '\r\n'));
    assert.deepEqual(
      crlf.entries.map((e) => [e.heading.runId, e.heading.sitting, entryState(e), e.lines.length]),
      [
        ['e7b41c', null, 'closed', 3],
        ['4c1e7b', 2, 'closed', 2],
        ['4c1e7b', 1, 'paused', 7],
      ],
    );
    assert.ok(crlf.physical.every((p) => !p.includes('\r')));
  });

  void test('joins an indented continuation that quotes an older heading instead of opening an entry at it', () => {
    // A v21 crossover NOTE names the Notion log's newest entry (resolve.md R1); wrapped, the quoted heading can land at
    // the start of an indented continuation line. That line continues the NOTE (DESIGN.md §4.2) and is not a heading.
    const text = [
      '## 2026-08-22 08:54 · resolve · run 4c1e7b · skill v21 · sitting 1 · 3 of 3 queued',
      'NOTE         2026-08-22 — crossover; the Notion log stays as history. Its newest entry is',
      '             2026-08-19 14:00 · resolve · run f7a3c1 · skill v15, closed there.',
      'item         «Can a member renew online?»  Clean  «Renewals» FR-2',
      'PAUSED — sitting 1 of a continuing run, 2 rows still queued',
      '',
    ].join('\n');
    const log = parseLog(text);
    assert.deepEqual(
      log.entries.map((e) => e.heading.runId),
      ['4c1e7b'],
    );
    assert.equal(entryState(nth(log.entries, 0)), 'paused');
  });

  void test('joins an indented dated bullet-format line onto the line above instead of opening an entry at it', () => {
    const text = [
      '## 2026-09-25 · 16:41 · resolve · run a2d011 · skill v38 · sitting 1', // 1
      '- NOTE: crossover · the Notion log stays as history; its newest entry is', // 2
      '  ## 2026-08-19 · 14:00 · resolve · run f7a3c1 · skill v15 · sitting 1', // 3 — indented, so a continuation
      '- item: «Borrow a lantern» FR-3 · Clean', // 4
      '',
    ].join('\n');
    const log = parseLog(text);
    assert.deepEqual(
      log.entries.map((e) => e.heading.runId),
      ['a2d011'],
    );
    assert.equal(
      lineWithToken(nth(log.entries, 0), 'NOTE').text,
      'crossover · the Notion log stays as history; its newest entry is ## 2026-08-19 · 14:00 · resolve · run f7a3c1 · skill v15 · sitting 1',
    );
  });

  void test('does not read a tab-indented dated line as a heading', () => {
    const text = [
      '## 2026-09-25 · 16:41 · resolve · run a2d011 · skill v38 · sitting 1',
      '- NOTE: the older entry was',
      '\t2026-08-19 14:00 · resolve · run f7a3c1 · skill v15 · sitting 1',
      '',
    ].join('\n');
    assert.equal(parseLog(text).entries.length, 1);
  });

  void test('ignores a UTF-8 byte-order mark before the first heading', () => {
    const log = parseLog(
      '\uFEFF## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1\n- item: «Borrow a lantern» FR-3\n',
    );
    const e = nth(log.entries, 0);
    assert.deepEqual(
      [log.entries.length, e.heading.runId, e.headingLine, e.markdownHeading, log.preambleEnd],
      [1, 'a2d011', 1, true, 0],
    );
  });

  void test('reads a bare CON bullet, with no -k number, as a token with no kind', () => {
    const l = nth(
      entryAt(
        [
          '## 2026-09-25 · 16:41 · init · run a2d011 · skill v38 · sitting 1',
          '- CON: notes.md §2 vs call.md §4',
          '',
        ].join('\n'),
        0,
      ).lines,
      0,
    );
    assert.deepEqual([l.token, l.kind, l.caseMismatch, l.format], ['CON', null, false, 'bullet']);
  });

  void test('reads a group heading bullet as the group heading kind', () => {
    const l = nth(
      entryAt(
        ['## 2026-09-25 · 16:41 · resolve · run a2d011 · skill v38 · sitting 1', '- group heading: APPLIED', ''].join(
          '\n',
        ),
        0,
      ).lines,
      0,
    );
    assert.deepEqual(
      [l.token, l.kind, l.caseMismatch, l.text, l.format],
      ['group heading', 'group heading', false, 'APPLIED', 'bullet'],
    );
  });

  void test("reads a human's hand-written `- CLOSED (crashed)` as a closing line (resolve.md:876)", () => {
    const l = nth(
      entryAt(
        ['## 2026-09-25 · 16:41 · resolve · run a2d011 · skill v38 · sitting 1', '- CLOSED (crashed)', ''].join('\n'),
        0,
      ).lines,
      0,
    );
    assert.deepEqual([l.token, l.kind, l.text, l.format], ['closing', 'closing', 'CLOSED (crashed)', 'bare']);
  });

  void test('reads a line of control characters and stray punctuation as prose without throwing', () => {
    const l = nth(
      entryAt(
        ['## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1', '\u0000\u0001 «» :: ##', ''].join('\n'),
        0,
      ).lines,
      0,
    );
    assert.deepEqual([l.token, l.kind, l.format], [null, null, 'prose']);
  });

  void test('reads a large log of 5,000 entries completely', () => {
    const parts: string[] = ['# Run log', '', '---', ''];
    for (let i = 0; i < 5000; i++) {
      const id = i.toString(16).padStart(6, '0');
      parts.push(
        `## 2026-09-25 · 16:41 · resolve · run ${id} · skill v37 · sitting 1`,
        '',
        `- item: «Row ${i}» · Applied`,
        '- closing: CLOSED 16:52 · DRAINED',
        '',
        '---',
        '',
      );
    }
    const log = parseLog(parts.join('\n'));
    assert.equal(log.entries.length, 5000);
    assert.equal(nth(log.entries, 4999).heading.runId, '001387'); // 4999 = 0x1387
    assert.ok(log.entries.every((e) => entryState(e) === 'closed' && e.lines.length === 2));
  });

  void test('reads a single 200,000-character line without a heading as prose', () => {
    const long = `## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1\n${'word '.repeat(40000)}\n`;
    const l = nth(entryAt(long, 0).lines, 0);
    assert.deepEqual([l.format, l.text.length], ['prose', 5 * 40000 - 1]);
  });
});

// ---- drift: resolve.md R5's own samples ------------------------------------------------------------------------------

/**
 * The two sample entries R5 prints ("the samples below are the cap", resolve.md:956), read from the prose itself: every
 * ``` block whose first line is a `## 2026-08-12 · ` heading.
 */
function r5Samples(): string[] {
  const prose = readFile(join(SKILL_ROOT, 'resolve.md'));
  return [...prose.matchAll(/^```\n([\s\S]*?)^```$/gm)]
    .map((m) => m[1] ?? '')
    .filter((b) => b.startsWith('## 2026-08-12 · '));
}

void describe('parseLog — resolve.md R5 samples', () => {
  void test('R5 prints exactly two sample entries', () => {
    assert.equal(r5Samples().length, 2);
  });

  void test('reads the first sample as sitting 1 of run 7f3a2c, stamped with the current VERSION (lint.sh pins it)', () => {
    const h = entryAt(nth(r5Samples(), 0), 0).heading;
    const version = Number(readFile(join(SKILL_ROOT, 'VERSION')).trim());
    assert.deepEqual(
      [h.date, h.time, h.command, h.runId, h.version, h.sitting],
      ['2026-08-12', '09:14', 'resolve', '7f3a2c', version, 1],
    );
  });

  void test("reads the first sample's sixteen lines by their kinds, in order", () => {
    // resolve.md:961–976 — "Seventeen lines for six items" counts the heading too.
    assert.deepEqual(tokens(entryAt(nth(r5Samples(), 0), 0)), [
      'header',
      'independence',
      'SWEEP-NOTE',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item',
      'FLAGGED',
      'FLAGGED',
      'GATE',
      'MARKERS',
      'HASHES',
      'COUNTS',
      'closing',
    ]);
  });

  void test('reads the first sample, which closes PAUSED, as paused', () => {
    assert.equal(entryState(entryAt(nth(r5Samples(), 0), 0)), 'paused');
  });

  void test('reads the second sample as sitting 3 of the same run, closed', () => {
    const e = entryAt(nth(r5Samples(), 1), 0);
    assert.deepEqual(
      [e.heading.runId, e.heading.sitting, e.heading.time, entryState(e)],
      ['7f3a2c', 3, '12:41', 'closed'],
    );
  });

  void test("reads the second sample's lines by their kinds, its elision as prose", () => {
    assert.deepEqual(tokens(entryAt(nth(r5Samples(), 1), 0)), ['header', null, 'GATE', 'SWEEP', 'closing']);
  });
});

// ---- the seam: `bp log state` reads through this parser --------------------------------------------------------------

void describe('bp log state', () => {
  void test('reports each v21 entry with the state its last closing line gives it', () => {
    const home = makeHome({ log: V21 });
    const r = run(['log', 'state', '--home', home, '--json'], { workspace: join(home, '..') });
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out) as {
      entries: { runId: string; sitting: number | null; state: string; lines: number }[];
    };
    assert.deepEqual(
      out.entries.map((e) => [e.runId, e.sitting, e.state, e.lines]),
      [
        ['e7b41c', null, 'closed', 3],
        ['4c1e7b', 2, 'closed', 2],
        ['4c1e7b', 1, 'paused', 7],
      ],
    );
  });
});
