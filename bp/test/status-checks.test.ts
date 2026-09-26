import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../src/core/errors.ts';
import type { Status, WriteCommand } from '../src/domain/vocab.ts';
import { makeHome, readFile, run, writeFile, type RunResult } from './support/index.ts';

// `bp status` end to end (status.md S1–S3) on SYNTHETIC local-markdown Blueprints (spec/targets.md §3) with a run log at
// <home>/record/run-log.md (spec/targets.md §5). Every product, person and number below is invented. Expected values are
// derived by hand from the fixture and the spec: ages count calendar days back from the injected clock, 2026-09-25
// (NOW_ISO), so a log entry dated 2026-09-20 is 5d old and a row created 2026-09-05 is 20d old; counts are counted off
// the fixture's rows by eye. Section headings are status.md S3's own names (status.md:112-114).
//
// Spec rules exercised (status.md unless named): S1 step 4 (no log → say which checks could not be computed), C1–C10,
// S3 (fixed order worst first · ≤5 rows then `+N more` · empty sections omitted · every line ends in a move · clean → two
// lines), the What-is-still-unsettled block (six lines, never a score), the NEXT-line constraint (v23), "Never print a
// value the content rule bars", "Never invent an age", "This run never writes", and the residue line (Not read by code).

// ---- the screen's vocabulary, from the spec --------------------------------------------------------------------------

/** status.md S3's fixed order, worst first. */
const SPEC_ORDER = [
  'CONTENT THE RULE BARS', // C9
  'COULD NOT APPLY', // C1
  'STATE NOTHING WROTE OR RECONCILED', // C4
  'RUN-LOG ARITHMETIC', // C10
  'WILL NOT APPLY NEXT TIME', // C3
  'BLOCKING LINKS', // C5
  'UNSENT QUESTIONS', // C2
  'STUCK AND GOING STALE', // C7
  'THE FRONT DOOR', // C8
] as const;
type Heading = (typeof SPEC_ORDER)[number];

// ---- fixtures: a local Blueprint -------------------------------------------------------------------------------------

interface FeatureFx {
  file: string;
  name: string;
  body: string;
}

interface QuestionFx {
  key: string;
  title: string;
  status: Status;
  touches?: string;
  whyAsked?: string;
  directions?: string[];
  whyFlagged?: string;
  owner?: string;
  /** A local timestamp; the default is 2026-09-20 09:00 (5d before the clock). */
  created?: string | null;
  answer?: string;
}

/** A doc-shape §5 body: the five blocks, with a Behaviour block of the given lines. */
function body(o: { why?: string; behaviour?: string[]; edge?: string[] } = {}): string {
  return [
    '## Why',
    o.why ?? 'Members want light on evening walks.',
    '',
    '## Behaviour',
    ...(o.behaviour ?? ['FR-1 — A member can borrow one lantern at a time.']),
    '',
    '## Edge cases',
    ...(o.edge ?? ['- A member with a lantern out cannot borrow a second one.']),
    '',
    '## Rabbit holes',
    '- None named yet.',
    '',
    '## Not doing',
    '- Delivery, because members collect in person. revisit if: members ask for it.',
    '',
  ].join('\n');
}

const BORROW: FeatureFx = { file: '01-borrow-a-lantern.md', name: 'Borrow a lantern', body: body() };
const RETURN: FeatureFx = {
  file: '02-return-a-lantern.md',
  name: 'Return a lantern',
  body: body({
    why: 'A lantern that does not come back cannot be lent again.',
    behaviour: ['FR-1 — A member returns the lantern to the shelf it came from.'],
    edge: ['- A lantern returned broken is set aside.'],
  }),
};

function featureFile(f: FeatureFx): string {
  return [
    '---',
    `name: ${f.name}`,
    `what_it_does: ${f.name} at the club.`,
    'area: Lending',
    'questions: []',
    'created: 2026-09-01',
    '---',
    '',
    f.body,
  ].join('\n');
}

function questionSection(q: QuestionFx): string {
  const lines = [
    `### ${q.key} · ${q.title}`,
    `- **Status:** ${q.status}`,
    `- **Owner:** ${q.owner ?? ''}`,
    `- **Touches:** ${q.touches ?? ''}`,
    `- **Why asked:** ${q.whyAsked ?? 'No source says.'}`,
  ];
  if (q.directions) lines.push(`- **Suggested directions:** ${q.directions[0] ?? ''}`, ...q.directions.slice(1));
  if (q.whyFlagged) lines.push(`- **Why flagged:** ${q.whyFlagged}`);
  const created = q.created === undefined ? '2026-09-20T09:00:00' : q.created;
  if (created !== null) lines.push(`- **Created:** ${created}`);
  lines.push('', `**Answer & why:** ${q.answer ?? '_(unanswered)_'}`, '');
  return lines.join('\n');
}

interface ReadmeFx {
  tldr?: string[];
  /** Lines under `## ⟳ Where things are`; the default lists every feature. */
  where?: string[];
  openQuestions?: string[];
  links?: string[];
  operating?: string[];
}

function readmeText(r: ReadmeFx, features: FeatureFx[]): string {
  return [
    '# Lantern Club',
    '',
    '## TL;DR',
    ...(r.tldr ?? ['A lending club for lanterns. Read the features first.']),
    '',
    '## What this product is',
    'Members borrow a lantern for an evening walk and bring it back. It is not a shop.',
    '',
    "## Who it's for",
    '- Members: borrow a lantern for an evening walk.',
    '',
    '## ⟳ Where things are',
    ...(r.where ?? features.map((f) => `- [${f.name}](features/${f.file})`)),
    '',
    '## ⟳ Open questions',
    ...(r.openQuestions ?? ['_Regenerated by every write run._']),
    '',
    '## Links',
    ...(r.links ?? ['- Design file: https://example.com/lantern/design']),
    '',
    '## Operating',
    ...(r.operating ?? [
      '- Run record: https://github.com/example/lantern/blob/main/blueprint/record/run-log.md',
      '- Always-ask register: payments, personal data',
    ]),
    '',
  ].join('\n');
}

// ---- fixtures: the run log --------------------------------------------------------------------------------------------

interface EntryFx {
  date: string;
  command: WriteCommand;
  run: string;
  sitting?: number;
  version?: number;
  lines?: string[];
}

function entryText(e: EntryFx): string[] {
  const v = e.version ?? 38;
  const s = e.sitting ?? 1;
  return [
    `## ${e.date} · 10:00 · ${e.command} · run ${e.run} · skill v${v} · sitting ${s}`,
    '',
    `- header: date ${e.date} · time 10:00 · command ${e.command} · run ${e.run} · version ${v} · sitting ${s}`,
    ...(e.lines ?? []),
    '- closing: CLOSED 10:30 · DRAINED',
    '',
    '---',
    '',
  ];
}

/** A run log of the given entries, newest first. */
const logOf = (...entries: EntryFx[]): string =>
  [
    '# Run log — «Lantern Club» Blueprint',
    '',
    'Append-only, newest entry first. Never rewritten, never summarised away.',
    '',
    '---',
    '',
    ...entries.flatMap(entryText),
  ].join('\n');

/** The default question: Applied, and named by the default log's item line — so neither C4 nor anything else fires on it. */
const APPLIED_Q1: QuestionFx = {
  key: 'q-01',
  title: 'Can a member borrow two lanterns?',
  status: 'Applied',
  touches: 'Borrow a lantern',
  answer: 'No — one lantern per member at a time, so the shelf never empties.',
  created: '2026-09-10T09:00:00',
};
const RESOLVE_ENTRY: EntryFx = {
  date: '2026-09-20',
  command: 'resolve',
  run: '7f3a2c',
  lines: ['- item: «Can a member borrow two lanterns?» · Clean · «Borrow a lantern» FR-1'],
};

interface BlueprintFx {
  features?: FeatureFx[];
  questions?: QuestionFx[];
  readme?: ReadmeFx;
  /** The run log's text; null for a machine with no readable log. */
  log?: string | null;
  runs?: Record<string, string>;
  barred?: string[];
}

/** Write a local Blueprint and its working folder; returns `<home>`. */
function blueprint(fx: BlueprintFx = {}): string {
  const features = fx.features ?? [BORROW];
  const questions = fx.questions ?? [APPLIED_Q1];
  const log = fx.log === undefined ? logOf(RESOLVE_ENTRY) : fx.log;
  const home = makeHome({ target: 'kind: local\npath: document\n', ...(log === null ? {} : { log }) });
  const doc = join(home, 'document');
  writeFile(join(doc, 'README.md'), readmeText(fx.readme ?? {}, features));
  for (const f of features) writeFile(join(doc, 'features', f.file), featureFile(f));
  writeFile(join(doc, 'questions.md'), ['# Open questions', '', ...questions.map(questionSection)].join('\n'));
  for (const [name, text] of Object.entries(fx.runs ?? {})) writeFile(join(home, 'record', 'runs', name), text);
  if (fx.barred) writeFile(join(home, 'sources', '7f3a2c', 'barred-terms.json'), JSON.stringify(fx.barred));
  return home;
}

const status = (home: string): RunResult => run(['status', '--home', home, '--title', 'Lantern Club']);

// ---- reading the screen -----------------------------------------------------------------------------------------------

/** The blank-line-separated block whose first line starts with `heading`. */
function sectionOf(out: string, heading: Heading | 'WHAT IS STILL UNSETTLED'): string[] | undefined {
  return out
    .split('\n\n')
    .map((b) => b.split('\n'))
    .find((b) => b[0]?.startsWith(heading));
}

function mustSection(out: string, heading: Heading | 'WHAT IS STILL UNSETTLED'): string[] {
  const s = sectionOf(out, heading);
  if (!s) throw new assert.AssertionError({ message: `no ${heading} section in:\n${out}` });
  return s;
}

/** The row lines of a section (a mark `!`, `x` or `~` after two spaces). */
const rowsOf = (section: string[]): string[] => section.filter((l) => /^ {2}[!x~] /.test(l));

/** The line of `section` containing `needle`, joined with its continuation lines up to and including its move. */
function rowWith(section: string[], needle: string): string {
  const i = section.findIndex((l) => /^ {2}[!x~] /.test(l) && l.includes(needle));
  if (i < 0) throw new assert.AssertionError({ message: `no row containing "${needle}" in:\n${section.join('\n')}` });
  const out = [section[i] ?? ''];
  for (let j = i + 1; j < section.length && !/^ {2}[!x~+] /.test(section[j] ?? ''); j++) out.push(section[j] ?? '');
  return out.join('\n');
}

const headingsIn = (out: string): Heading[] => SPEC_ORDER.filter((h) => out.split('\n').some((l) => l.startsWith(h)));
const nextLine = (out: string): string => out.split('\n').find((l) => l.startsWith('NEXT:')) ?? '';

// ---- a clean Blueprint -------------------------------------------------------------------------------------------------

void describe('S3: a clean Blueprint', () => {
  void test('exits 0 and prints no section, no unsettled block and no NEXT line', () => {
    const r = status(blueprint());
    assert.equal(r.code, EXIT.ok, r.out + r.err);
    assert.deepEqual(headingsIn(r.out), []);
    assert.doesNotMatch(r.out, /WHAT IS STILL UNSETTLED|^NEXT:/m);
  });

  void test('opens with the title line naming the project and the date', () => {
    const r = status(blueprint());
    assert.equal(r.out.split('\n')[0], 'BLUEPRINT STATUS · Lantern Club · 2026-09-25');
  });

  void test('is said in two lines and stops', () => {
    // status.md S3: "When everything is clean, say so in two lines and stop."
    const r = status(blueprint());
    assert.equal(r.out.split('\n').length, 2, r.out);
  });

  void test('a content slot somebody outside still owes keeps the screen from reading clean', () => {
    // status.md S3 unsettled line 6: without it "a slot nobody ever fills would be invisible". Route 7 has already
    // removed the slot's marker, so no check section fires on it; only the unsettled block can carry it.
    const slotted: FeatureFx = {
      ...BORROW,
      body: body({
        behaviour: [
          'FR-1 — A member can borrow one lantern at a time.',
          'Content slot — client-supplied: the lantern catalogue, supplied by the club secretary.',
        ],
      }),
    };
    const r = status(blueprint({ features: [slotted] }));
    const unsettled = mustSection(r.out, 'WHAT IS STILL UNSETTLED');
    assert.match(unsettled.join('\n'), /«Borrow a lantern» \(the club secretary\)/);
  });
});

// ---- the header ---------------------------------------------------------------------------------------------------------

void describe('S3: the header carries the queue numbers and the last run date', () => {
  void test('the last run is the newest log entry, with its age in days', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          {
            key: 'q-02',
            title: 'How late may a lantern come back?',
            status: 'Answered',
            touches: 'Return a lantern',
            answer: 'Up to seven days, because walks can run long.',
          },
        ],
        features: [BORROW, RETURN],
      }),
    );
    assert.match(r.out.split('\n')[1] ?? '', /^Last run 2026-09-20 \(5d\)/);
  });

  void test('counts the answered-and-waiting and the open-unanswered rows', () => {
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [
          APPLIED_Q1,
          {
            key: 'q-02',
            title: 'How late may a lantern come back?',
            status: 'Answered',
            touches: 'Return a lantern',
            answer: 'Up to seven days, because walks can run long.',
          },
          { key: 'q-03', title: 'May a guest borrow a lantern?', status: 'Open' },
          { key: 'q-04', title: 'Is a lantern lent in the rain?', status: 'Open' },
        ],
      }),
    );
    const header = r.out.split('\n')[1] ?? '';
    assert.match(header, /\b1 answered and waiting\b/);
    assert.match(header, /\b2 open, unanswered\b/);
  });
});

// ---- S3: the screen's shape -------------------------------------------------------------------------------------------

/** A Blueprint that fires every one of the nine sections once. */
function everySection(): string {
  const carried: FeatureFx = {
    ...RETURN,
    body: body({
      why: 'A lantern that does not come back cannot be lent again.',
      behaviour: [
        'FR-1 — A member returns the lantern by [NEEDS CLARIFICATION: what time does the shelf close? → Question: carried].',
      ],
      edge: ['- A lost lantern costs the member £40.'],
    }),
  };
  return blueprint({
    features: [BORROW, carried],
    readme: { openQuestions: ['Ask the secretary about the late fee first.'] },
    questions: [
      APPLIED_Q1,
      {
        key: 'q-02',
        title: 'What is the late-return fee?',
        status: 'Flagged',
        touches: 'Return a lantern',
        answer: 'https://example.com/fees',
        whyFlagged: 'the answer is only a link — write the decision in a sentence',
      },
      {
        key: 'q-03',
        title: 'Can a lantern be renewed?',
        status: 'Applied',
        touches: 'Borrow a lantern',
        answer: 'Yes, once, because a walk can run to a second evening.',
      },
      {
        key: 'q-04',
        title: 'Who checks a returned lantern?',
        status: 'Answered',
        touches: 'Return a lantern',
        answer: 'https://example.com/checks',
      },
      {
        key: 'q-05',
        title: 'How late may a lantern come back?',
        status: 'Answered',
        touches: 'Return a lantern',
        answer: 'Up to seven days, because walks can run long.',
      },
      { key: 'q-06', title: 'May a guest borrow a lantern?', status: 'Open' },
    ],
    log: logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- FLAGGED: «What is the late-return fee?» · the answer is only a link — write the decision in a sentence',
        '- COUNTS: question rows 9 = Applied 5 · Flagged 1 · Answered 2 · Open 1',
      ],
    }),
  });
}

void describe('S3: one screen, fixed order, worst first', () => {
  void test('prints the nine sections in the spec order', () => {
    const r = status(everySection());
    const lines = r.out.split('\n');
    const at = SPEC_ORDER.map((h) => lines.findIndex((l) => l.startsWith(h)));
    assert.deepEqual(
      at.map((i, k) => [SPEC_ORDER[k], i >= 0]),
      SPEC_ORDER.map((h) => [h, true]),
      r.out,
    );
    assert.deepEqual(
      [...at].sort((a, b) => a - b),
      at,
    );
  });

  void test('exits 1 when there are findings', () => {
    assert.equal(status(everySection()).code, EXIT.findings);
  });

  void test('every row ends in a move', () => {
    const lines = status(everySection()).out.split('\n');
    const rowAt = lines.flatMap((l, i) => (/^ {2}[!x~] /.test(l) ? [i] : []));
    assert.ok(rowAt.length >= 9);
    for (const i of rowAt) {
      let j = i + 1;
      while (j < lines.length && /^ {8}/.test(lines[j] ?? '') && !/^ {6}→/.test(lines[j] ?? '')) j++;
      assert.match(lines[j] ?? '', /^ {6}→ \S/, `row without a move: ${lines[i] ?? ''}`);
    }
  });

  void test('an empty section is omitted, never printed empty', () => {
    // Only an Answered row waiting on a resolve run: C7 alone has something to say.
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [
          APPLIED_Q1,
          {
            key: 'q-02',
            title: 'How late may a lantern come back?',
            status: 'Answered',
            touches: 'Return a lantern',
            answer: 'Up to seven days, because walks can run long.',
          },
        ],
      }),
    );
    assert.deepEqual(headingsIn(r.out), ['STUCK AND GOING STALE']);
  });

  void test('a section prints at most five rows, then "+N more"', () => {
    // Seven Answered rows whose answers are only links: seven C3 rows.
    const links: QuestionFx[] = [2, 3, 4, 5, 6, 7, 8].map((n) => ({
      key: `q-0${n}`,
      title: `Link-only question number ${n}?`,
      status: 'Answered',
      touches: 'Borrow a lantern',
      answer: `https://example.com/decision-${n}`,
    }));
    const r = status(blueprint({ questions: [APPLIED_Q1, ...links] }));
    const c3 = mustSection(r.out, 'WILL NOT APPLY NEXT TIME');
    assert.equal(rowsOf(c3).length, 5);
    assert.match(c3.join('\n'), /^ {2}\+2 more\b/m);
  });
});

// ---- C1 — could not apply ---------------------------------------------------------------------------------------------

const FLAGGED_Q2: QuestionFx = {
  key: 'q-02',
  title: 'What is the late-return fee?',
  status: 'Flagged',
  touches: 'Return a lantern',
  answer: 'https://example.com/fees',
  whyFlagged: 'the answer is only a link — write the decision in a sentence',
};

void describe('C1 — could not apply', () => {
  void test("a Flagged row is named with the FLAGGED line's objection and the flag's age from the log", () => {
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- FLAGGED: «What is the late-return fee?» · the answer is only a link — write the decision in a sentence',
      ],
    });
    const r = status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, FLAGGED_Q2], log }));
    const row = rowWith(mustSection(r.out, 'COULD NOT APPLY'), '«What is the late-return fee?»');
    assert.match(row, /^ {2}! /);
    assert.match(row, /Flagged 5d/);
    assert.match(row, /the answer is only a link — write the decision in a sentence/);
    assert.match(row, /→ .*back to Answered/);
  });

  void test("the flag's age comes from the newest FLAGGED line for the row", () => {
    const log = logOf(
      {
        date: '2026-09-23',
        command: 'resolve',
        run: 'b2b2b2',
        lines: [
          '- FLAGGED: «What is the late-return fee?» · the answer is only a link — write the decision in a sentence',
        ],
      },
      {
        ...RESOLVE_ENTRY,
        lines: [
          ...(RESOLVE_ENTRY.lines ?? []),
          '- FLAGGED: «What is the late-return fee?» · answer names no single direction',
        ],
      },
    );
    const r = status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, FLAGGED_Q2], log }));
    assert.match(rowWith(mustSection(r.out, 'COULD NOT APPLY'), '«What is the late-return fee?»'), /Flagged 2d/);
  });

  void test("where the row's Why flagged differs from the log, the row is named and the log's objection is printed", () => {
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- FLAGGED: «What is the late-return fee?» · the answer is only a link — write the decision in a sentence',
      ],
    });
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [APPLIED_Q1, { ...FLAGGED_Q2, whyFlagged: 'soft mode was told not to write this' }],
        log,
      }),
    );
    const row = rowWith(mustSection(r.out, 'COULD NOT APPLY'), '«What is the late-return fee?»');
    assert.match(row, /differs/);
    assert.match(row, /the answer is only a link — write the decision in a sentence/);
  });

  void test('a Flagged row with no FLAGGED line has an unknown age, never 0d', () => {
    const r = status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, FLAGGED_Q2] }));
    const row = rowWith(mustSection(r.out, 'COULD NOT APPLY'), '«What is the late-return fee?»');
    assert.match(row, /unknown/);
    assert.doesNotMatch(row, /\b0d\b/);
  });
});

// ---- C2 — unsent questions ------------------------------------------------------------------------------------------

void describe('C2 — unsent questions', () => {
  void test('an Open row whose Answer & why is filled gets its own line, and the move is to set it to Answered', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          {
            key: 'q-02',
            title: 'May a guest borrow a lantern?',
            status: 'Open',
            touches: 'Borrow a lantern',
            answer: 'Yes, with a member present, because the member is answerable.',
          },
        ],
      }),
    );
    const row = rowWith(mustSection(r.out, 'UNSENT QUESTIONS'), '«May a guest borrow a lantern?»');
    assert.match(row, /→ set it to Answered/);
  });

  void test('the filled-in Open row comes first in the section', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          { key: 'q-02', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-01T09:00:00' },
          {
            key: 'q-03',
            title: 'May a guest borrow a lantern?',
            status: 'Open',
            answer: 'Yes, with a member present, because the member is answerable.',
          },
        ],
      }),
    );
    assert.match(rowsOf(mustSection(r.out, 'UNSENT QUESTIONS'))[0] ?? '', /«May a guest borrow a lantern\?»/);
  });

  void test('unanswered Open rows are counted with the oldest named and its age', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          { key: 'q-02', title: 'May a guest borrow a lantern?', status: 'Open', created: '2026-09-15T09:00:00' },
          { key: 'q-03', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-12T09:00:00' },
        ],
      }),
    );
    const c2 = mustSection(r.out, 'UNSENT QUESTIONS');
    assert.match(c2[0] ?? '', /\(2\)$/);
    assert.match(c2.join('\n'), /oldest 13d · «Is a lantern lent in the rain\?»/);
  });

  void test('the section ends with the running count of Rejected rows', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          { key: 'q-02', title: 'May a guest borrow a lantern?', status: 'Open' },
          {
            key: 'q-03',
            title: 'Should lanterns be sold?',
            status: 'Rejected',
            answer: 'Not a real gap: the club lends and never sells.',
          },
          {
            key: 'q-04',
            title: 'Should lanterns glow blue?',
            status: 'Rejected',
            answer: 'Already decided: colour is out of scope.',
          },
        ],
      }),
    );
    const rows = rowsOf(mustSection(r.out, 'UNSENT QUESTIONS'));
    assert.match(rows[rows.length - 1] ?? '', /Rejected\D*2\b/);
  });
});

// ---- C3 — will not apply next time (resolve.md R2.1) ---------------------------------------------------------------

const answered = (over: Partial<QuestionFx>): QuestionFx => ({
  key: 'q-02',
  title: 'How late may a lantern come back?',
  status: 'Answered',
  touches: 'Return a lantern',
  answer: 'Up to seven days, because walks can run long.',
  ...over,
});
const DIRECTIONS = ['1. Seven days. Why: most walks end within a week.', '2. Fourteen days. Why: members travel.'];

void describe('C3 — will not apply next time, and will be Flagged (resolve.md R2.1)', () => {
  const c3Of = (q: QuestionFx): string[] | undefined =>
    sectionOf(
      status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, q] })).out,
      'WILL NOT APPLY NEXT TIME',
    );

  void test('Touches naming a feature that does not exist is named, with the move to repoint it', () => {
    const row = rowWith(c3Of(answered({ touches: 'Lantern repairs' })) ?? [], '«How late may a lantern come back?»');
    assert.match(row, /Touches/);
    assert.match(row, /→ .*repoint/);
  });

  void test('an empty Touches is not a failure (a project-level row)', () => {
    assert.equal(c3Of(answered({ touches: '' })), undefined);
  });

  void test('Touches naming two existing features is not a failure', () => {
    assert.equal(c3Of(answered({ touches: 'Borrow a lantern, Return a lantern' })), undefined);
  });

  void test('a pointer naming more than one direction is named', () => {
    const row = rowWith(
      c3Of(answered({ directions: DIRECTIONS, answer: '1 or 2' })) ?? [],
      '«How late may a lantern come back?»',
    );
    assert.match(row, /more than one direction/);
  });

  void test('a bare pointer at a direction with an unfilled <value> slot is named, naming the slot', () => {
    const row = rowWith(
      c3Of(
        answered({
          directions: [
            '1. A late fee of <amount> per day. Why: a fee brings lanterns back.',
            '2. No fee. Why: goodwill.',
          ],
          answer: '1',
        }),
      ) ?? [],
      '«How late may a lantern come back?»',
    );
    assert.match(row, /<amount>/);
  });

  void test('a pointer naming exactly one direction is an answer (v34)', () => {
    assert.equal(c3Of(answered({ directions: DIRECTIONS, answer: '2' })), undefined);
  });

  void test('an answer that is only a link is named, with the move to write the decision in a sentence', () => {
    const row = rowWith(
      c3Of(answered({ answer: 'https://example.com/decision' })) ?? [],
      '«How late may a lantern come back?»',
    );
    assert.match(row, /only a link/);
    assert.match(row, /→ write the decision/);
  });

  void test('a prose answer to an existing feature is not named', () => {
    assert.equal(c3Of(answered({})), undefined);
  });
});

// ---- C4 — state nothing wrote, and state nothing reconciled --------------------------------------------------------

const APPLIED_Q3: QuestionFx = {
  key: 'q-03',
  title: 'Can a lantern be renewed?',
  status: 'Applied',
  touches: 'Borrow a lantern',
  answer: 'Yes, once, because a walk can run to a second evening.',
  created: '2026-09-12T09:00:00',
};

void describe('C4 — Applied rows nothing wrote, and late verdicts nothing reconciled', () => {
  void test('an Applied row no run-log entry names is named, with the one drag that mends it', () => {
    const r = status(blueprint({ questions: [APPLIED_Q1, APPLIED_Q3] }));
    const row = rowWith(mustSection(r.out, 'STATE NOTHING WROTE OR RECONCILED'), '«Can a lantern be renewed?»');
    assert.match(row, /→ .*back to Answered/);
  });

  void test('an Applied row an item line names is not named', () => {
    const r = status(blueprint());
    assert.equal(sectionOf(r.out, 'STATE NOTHING WROTE OR RECONCILED'), undefined);
  });

  void test('an Applied row created before the crossover NOTE is out of scope', () => {
    const log = logOf(RESOLVE_ENTRY, {
      date: '2026-09-11',
      command: 'resolve',
      run: '5e5e5e',
      lines: [
        '- NOTE: crossover — the pre-v16 run log stays on the Notion page «Run log», last entry 2026-09-09, skill v15',
      ],
    });
    const early: QuestionFx = { ...APPLIED_Q3, created: '2026-09-02T09:00:00' };
    assert.equal(
      sectionOf(status(blueprint({ questions: [APPLIED_Q1, early], log })).out, 'STATE NOTHING WROTE OR RECONCILED'),
      undefined,
    );
  });

  void test('an Applied row created after the crossover NOTE is still checked', () => {
    const log = logOf(RESOLVE_ENTRY, {
      date: '2026-09-11',
      command: 'resolve',
      run: '5e5e5e',
      lines: [
        '- NOTE: crossover — the pre-v16 run log stays on the Notion page «Run log», last entry 2026-09-09, skill v15',
      ],
    });
    const r = status(blueprint({ questions: [APPLIED_Q1, APPLIED_Q3], log }));
    rowWith(mustSection(r.out, 'STATE NOTHING WROTE OR RECONCILED'), '«Can a lantern be renewed?»');
  });

  void test('an Applied row an item line names by its q-NN key is not named', () => {
    // spec/targets.md §3: on the local target a question is keyed by its stable q-NN; R5's item line leads with the row.
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [...(RESOLVE_ENTRY.lines ?? []), '- item: q-03 · Clean · «Borrow a lantern» FR-2'],
    });
    assert.equal(
      sectionOf(
        status(blueprint({ questions: [APPLIED_Q1, APPLIED_Q3], log })).out,
        'STATE NOTHING WROTE OR RECONCILED',
      ),
      undefined,
    );
  });

  void test("an Applied row an item line names by R5's shortened title is not named", () => {
    // resolve.md R5's sample item lines shorten a long title with an ellipsis: «Can a customer retry a failed…».
    const long: QuestionFx = { ...APPLIED_Q3, title: 'Can a member renew a lantern for a second evening?' };
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- item: «Can a member renew a lantern for a…» · Clean · «Borrow a lantern» FR-2',
      ],
    });
    assert.equal(
      sectionOf(status(blueprint({ questions: [APPLIED_Q1, long], log })).out, 'STATE NOTHING WROTE OR RECONCILED'),
      undefined,
    );
  });

  void test('an Applied row a CARRIED-FORWARD line carries a late verdict for is named first', () => {
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- item: «Can a lantern be renewed?» · Clean · «Borrow a lantern» FR-2',
        '- CARRIED-FORWARD: q-03 «Can a lantern be renewed?» · late check verdict Wrong, returned after the write — disagrees with «Borrow a lantern» FR-2',
      ],
    });
    const r = status(blueprint({ questions: [APPLIED_Q1, APPLIED_Q3], log }));
    const rows = rowsOf(mustSection(r.out, 'STATE NOTHING WROTE OR RECONCILED'));
    assert.match(rows[0] ?? '', /«Can a lantern be renewed\?»/);
  });
});

// ---- C5 — blocking links -------------------------------------------------------------------------------------------

const withMarkers = (feature: FeatureFx, ...markers: string[]): FeatureFx => ({
  ...feature,
  body: body({
    behaviour: [
      'FR-1 — A member can borrow one lantern at a time.',
      ...markers.map((m, i) => `FR-${i + 2} — A member ${m}.`),
    ],
  }),
});

void describe('C5 — blocking links', () => {
  void test('a marker pointing at a deleted row is broken, one line naming the feature', () => {
    const r = status(
      blueprint({
        features: [withMarkers(BORROW, 'renews a loan [NEEDS CLARIFICATION: can a loan be renewed? → Question: q-09]')],
      }),
    );
    const c5 = mustSection(r.out, 'BLOCKING LINKS');
    assert.equal(c5[0], 'BLOCKING LINKS (1 broken, 0 carried)');
    const row = rowWith(c5, '«Borrow a lantern»');
    assert.match(row, /deleted/);
    assert.match(row, /Broken; nothing clears it/);
  });

  void test('carried markers are one counted line naming the features', () => {
    const r = status(
      blueprint({
        features: [
          withMarkers(
            BORROW,
            'renews [NEEDS CLARIFICATION: how often? → Question: carried]',
            'reserves [NEEDS CLARIFICATION: how far ahead? → Question: carried]',
          ),
          {
            ...RETURN,
            body: body({
              behaviour: [
                'FR-1 — A member returns by [NEEDS CLARIFICATION: what time does the shelf close? → Question: carried].',
              ],
            }),
          },
        ],
      }),
    );
    const c5 = mustSection(r.out, 'BLOCKING LINKS');
    assert.equal(c5[0], 'BLOCKING LINKS (0 broken, 3 carried)');
    assert.equal(rowsOf(c5).length, 1);
    assert.match(rowsOf(c5)[0] ?? '', /«Borrow a lantern» ×2, «Return a lantern» ×1/);
  });

  void test('an escaped marker (the Notion round trip) is still counted', () => {
    const r = status(
      blueprint({
        features: [withMarkers(BORROW, 'renews \\[NEEDS CLARIFICATION: how often? → Question: carried\\]')],
      }),
    );
    assert.equal(mustSection(r.out, 'BLOCKING LINKS')[0], 'BLOCKING LINKS (0 broken, 1 carried)');
  });

  void test('a marker patched to an unratified ledger line is one counted awaiting-ratification line that says how to ratify', () => {
    const log = logOf(RESOLVE_ENTRY, {
      date: '2026-09-19',
      command: 'challenge',
      run: '9f2c1a',
      lines: ['- ledger 9f2c1a #1: a loan may be renewed once · standard practice'],
    });
    const r = status(
      blueprint({
        features: [
          withMarkers(
            BORROW,
            'renews [NEEDS CLARIFICATION: how often? → Default: ledger 9f2c1a #1, awaiting ratification]',
          ),
        ],
        log,
      }),
    );
    const row = rowWith(mustSection(r.out, 'BLOCKING LINKS'), 'awaiting');
    assert.match(row, /\b1\b/);
    assert.match(row, /name the batch to the next challenge run/);
    assert.match(row, /ratify <run id>/);
    assert.match(row, /veto <run id> #n/);
  });

  void test('a marker whose ledger line carries a RATIFIED line is not counted as awaiting ratification', () => {
    const log = logOf(
      {
        date: '2026-09-21',
        command: 'challenge',
        run: 'c3c3c3',
        lines: ['- RATIFIED: defaults ledger 9f2c1a, all 1 lines (#1) · "ratify 9f2c1a defaults"'],
      },
      RESOLVE_ENTRY,
      {
        date: '2026-09-19',
        command: 'challenge',
        run: '9f2c1a',
        lines: ['- ledger 9f2c1a #1: a loan may be renewed once · standard practice'],
      },
    );
    const r = status(
      blueprint({
        features: [
          withMarkers(
            BORROW,
            'renews [NEEDS CLARIFICATION: how often? → Default: ledger 9f2c1a #1, awaiting ratification]',
          ),
        ],
        log,
      }),
    );
    assert.doesNotMatch(r.out, /awaiting a defaults ratification/);
  });

  void test('a marker pointing at a Rejected row is broken, and the line says the next challenge run removes it', () => {
    const rejected: QuestionFx = {
      key: 'q-02',
      title: 'Should a loan be renewable?',
      status: 'Rejected',
      answer: 'Not a real gap: renewals are out.',
    };
    const r = status(
      blueprint({
        features: [withMarkers(BORROW, 'renews [NEEDS CLARIFICATION: can a loan be renewed? → Question: q-02]')],
        questions: [APPLIED_Q1, rejected],
      }),
    );
    const row = rowWith(mustSection(r.out, 'BLOCKING LINKS'), 'Rejected');
    assert.match(row, /next challenge run removes it/);
  });

  void test('a marker pointing at an Applied row is broken, and the line says the next challenge run checks it', () => {
    const r = status(
      blueprint({
        features: [withMarkers(BORROW, 'borrows [NEEDS CLARIFICATION: how many at once? → Question: q-01]')],
      }),
    );
    const c5 = mustSection(r.out, 'BLOCKING LINKS');
    assert.equal(c5[0], 'BLOCKING LINKS (1 broken, 0 carried)');
    assert.match(rowWith(c5, 'Applied'), /next challenge run checks/);
  });

  void test('a marker linking to no row is broken', () => {
    const r = status(blueprint({ features: [withMarkers(BORROW, 'renews [NEEDS CLARIFICATION: is this right?]')] }));
    assert.equal(mustSection(r.out, 'BLOCKING LINKS')[0], 'BLOCKING LINKS (1 broken, 0 carried)');
  });

  void test('a marker reading "→ Question: pending" is broken', () => {
    const r = status(
      blueprint({ features: [withMarkers(BORROW, 'renews [NEEDS CLARIFICATION: how often? → Question: pending]')] }),
    );
    assert.equal(mustSection(r.out, 'BLOCKING LINKS')[0], 'BLOCKING LINKS (1 broken, 0 carried)');
  });

  void test('a marker whose link names no single row is broken', () => {
    const r = status(
      blueprint({
        features: [
          withMarkers(
            BORROW,
            "renews [NEEDS CLARIFICATION: how often? → Question: asked 2026-09-08, see this row's Questions]",
          ),
        ],
      }),
    );
    assert.equal(mustSection(r.out, 'BLOCKING LINKS')[0], 'BLOCKING LINKS (1 broken, 0 carried)');
  });

  void test('a batch unratified past two sittings is named by run id with its line count', () => {
    const log = logOf(
      { date: '2026-09-24', command: 'resolve', run: 'd4d4d4' },
      { date: '2026-09-23', command: 'add', run: 'c3c3c3' },
      RESOLVE_ENTRY,
      {
        date: '2026-09-19',
        command: 'challenge',
        run: '9f2c1a',
        lines: [
          '- ledger 9f2c1a #1: a loan may be renewed once',
          '- ledger 9f2c1a #2: a lantern is lent for one evening',
        ],
      },
    );
    const r = status(blueprint({ log }));
    const row = rowWith(mustSection(r.out, 'BLOCKING LINKS'), '9f2c1a');
    assert.match(row, /\b2\b/);
    assert.match(row, /unratified/);
  });

  void test('a batch one sitting old is not named in C5', () => {
    const log = logOf(RESOLVE_ENTRY, {
      date: '2026-09-19',
      command: 'challenge',
      run: '9f2c1a',
      lines: ['- ledger 9f2c1a #1: a loan may be renewed once'],
    });
    assert.equal(sectionOf(status(blueprint({ log })).out, 'BLOCKING LINKS'), undefined);
  });
});

// ---- C7 — stuck and going stale -------------------------------------------------------------------------------------

void describe('C7 — stuck and going stale', () => {
  void test('an Answered row no resolve run has picked up is named, with its age', () => {
    const r = status(
      blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, answered({ created: '2026-09-16T09:00:00' })] }),
    );
    const row = rowWith(mustSection(r.out, 'STUCK AND GOING STALE'), '«How late may a lantern come back?»');
    assert.match(row, /\b9d\b/);
    assert.match(row, /→ .*resolve/);
  });

  void test("an Open row past 14 days is named with its age — on C2's line where C2 names it, never twice", () => {
    // status.md C7: "An item C1–C5 already names is not repeated here; its age goes on that line instead."
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          { key: 'q-02', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-05T09:00:00' },
        ],
      }),
    );
    assert.match(
      mustSection(r.out, 'UNSENT QUESTIONS').join('\n'),
      /oldest 20d · «Is a lantern lent in the rain\?» · past 14 days/,
    );
    assert.equal(sectionOf(r.out, 'STUCK AND GOING STALE'), undefined);
  });

  void test('a stale Open row beyond the oldest few C2 names is named in C7', () => {
    const open = (n: number, day: string) =>
      ({ key: `q-0${n}`, title: `Open question ${n}?`, status: 'Open', created: `2026-09-${day}T09:00:00` }) as const;
    const r = status(
      blueprint({ questions: [APPLIED_Q1, open(2, '01'), open(3, '02'), open(4, '03'), open(5, '04')] }),
    );
    assert.match(rowWith(mustSection(r.out, 'STUCK AND GOING STALE'), '«Open question 5?»'), /Open 21d/);
  });

  void test('an Open row 10 days old is not stale', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          { key: 'q-02', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-15T09:00:00' },
        ],
      }),
    );
    assert.equal(sectionOf(r.out, 'STUCK AND GOING STALE'), undefined);
  });

  void test('an empty Owner is never a finding', () => {
    const r = status(
      blueprint({
        questions: [
          APPLIED_Q1,
          {
            key: 'q-02',
            title: 'Is a lantern lent in the rain?',
            status: 'Open',
            owner: '',
            created: '2026-09-05T09:00:00',
          },
        ],
      }),
    );
    assert.doesNotMatch(r.out, /Owner/);
  });

  void test('a row C3 already names is not repeated here', () => {
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [APPLIED_Q1, answered({ answer: 'https://example.com/decision' })],
      }),
    );
    assert.equal(r.out.split('«How late may a lantern come back?»').length - 1, 1, r.out);
  });
});

// ---- C8 — the front door --------------------------------------------------------------------------------------------

void describe('C8 — the front door', () => {
  void test('text typed under a ⟳ heading is named with the heading', () => {
    const r = status(blueprint({ readme: { openQuestions: ['Ask the secretary about the late fee first.'] } }));
    assert.match(mustSection(r.out, 'THE FRONT DOOR').join('\n'), /typed under «⟳ Open questions»/);
  });

  for (const [kind, path] of [
    ['a home-folder path', '~/Dropbox/lantern/notes.md'],
    ['a working-folder path', 'sources/7f3a2c/deck.pdf'],
    ['a path prefixed with the wiki folder', 'wiki-lantern/blueprint/record/run-log.md'],
  ] as const) {
    void test(`${kind} in Links is named with the block`, () => {
      const r = status(blueprint({ readme: { links: [`- Notes: ${path}`] } }));
      assert.match(mustSection(r.out, 'THE FRONT DOOR').join('\n'), /«Links».*machine-local path/);
    });
  }

  void test('a machine-local path in Operating is named with the block', () => {
    const r = status(
      blueprint({
        readme: { operating: ['- Run record: /Users/someone/lantern/wiki-lantern/blueprint/record/run-log.md'] },
      }),
    );
    assert.match(mustSection(r.out, 'THE FRONT DOOR').join('\n'), /«Operating».*machine-local path/);
  });

  void test('a web URL in Links is not a machine-local path', () => {
    const r = status(blueprint({ readme: { links: ['- Notes: https://example.com/lantern/notes.md'] } }));
    assert.equal(sectionOf(r.out, 'THE FRONT DOOR'), undefined);
  });

  void test('a TL;DR carrying a count is named', () => {
    const r = status(blueprint({ readme: { tldr: ['A lending club for lanterns, with 3 open questions.'] } }));
    assert.match(mustSection(r.out, 'THE FRONT DOOR').join('\n'), /TL;DR/);
  });

  void test('a ⟳ Where things are list that disagrees with the features is named', () => {
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        readme: { where: ['- [Borrow a lantern](features/01-borrow-a-lantern.md)'] },
      }),
    );
    const row = rowWith(mustSection(r.out, 'THE FRONT DOOR'), 'Where things are');
    assert.match(row, /\b1\b.*\b2\b/);
  });

  void test('an Operating line saying the record is not yet published, in a repository with a remote, gets the run-log link', () => {
    const home = blueprint({ readme: { operating: ['- The run record is not yet published.'] } });
    execFileSync('git', ['init', '-q', '-b', 'main', home], { stdio: 'pipe' });
    execFileSync('git', ['-C', home, 'remote', 'add', 'origin', 'git@github.com:example/lantern.git'], {
      stdio: 'pipe',
    });
    const row = rowWith(mustSection(status(home).out, 'THE FRONT DOOR'), '«Operating»');
    // doc-shape.md §3 Operating: the link is the web URL of record/run-log.md on the repository's branch.
    assert.match(row, /https:\/\/github\.com\/example\/lantern\/blob\/[^/\s]+\/record\/run-log\.md/);
  });
});

// ---- C9 — content the rule bars ------------------------------------------------------------------------------------

void describe('C9 — content the rule bars: the row, the block and the class, never the value', () => {
  void test('a barred term in a feature body names the feature and block, and the term is not printed', () => {
    const f: FeatureFx = { ...BORROW, body: body({ why: 'Lanterns are supplied by Brightwater Outfitters.' }) };
    const r = status(blueprint({ features: [f], barred: ['Brightwater Outfitters'] }));
    const c9 = mustSection(r.out, 'CONTENT THE RULE BARS').join('\n');
    assert.match(c9, /«Borrow a lantern» Why/);
    assert.match(c9, /barred term/);
    assert.doesNotMatch(r.out, /Brightwater/);
  });

  void test('a price in an Answer & why names the row and the class, and the price is not printed', () => {
    const q: QuestionFx = {
      key: 'q-02',
      title: 'What does a lost lantern cost?',
      status: 'Rejected',
      answer: 'Already decided: a lost lantern costs £40.',
    };
    const r = status(blueprint({ questions: [APPLIED_Q1, q] }));
    const c9 = mustSection(r.out, 'CONTENT THE RULE BARS').join('\n');
    assert.match(c9, /q-02 Answer & why/);
    assert.match(c9, /price/);
    assert.doesNotMatch(r.out, /£40/);
  });

  void test('a contract date in Why asked names the row and the class, and the date is not printed', () => {
    const q: QuestionFx = {
      key: 'q-02',
      title: 'Who supplies the lanterns after the current deal?',
      status: 'Open',
      whyAsked: 'The supply contract expires 2027-03-31 and no source says what follows.',
    };
    const r = status(blueprint({ questions: [APPLIED_Q1, q] }));
    const c9 = mustSection(r.out, 'CONTENT THE RULE BARS').join('\n');
    assert.match(c9, /q-02 Why asked/);
    assert.match(c9, /contract or deadline date/);
    assert.doesNotMatch(r.out, /2027-03-31/);
  });

  void test('a barred term in the run log is named by file, and the term is not printed', () => {
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        '- item: «Can a member borrow two lanterns?» · Clean · «Borrow a lantern» FR-1 · confirmed with Brightwater Outfitters',
      ],
    });
    const r = status(blueprint({ log, barred: ['Brightwater Outfitters'] }));
    assert.match(mustSection(r.out, 'CONTENT THE RULE BARS').join('\n'), /record\/run-log\.md/);
    assert.doesNotMatch(r.out, /Brightwater/);
  });

  void test('a barred term in a per-run record file is named by file', () => {
    const r = status(
      blueprint({
        runs: { '7f3a2c.md': '- check: verdict lifted from the deck of Brightwater Outfitters\n' },
        barred: ['Brightwater Outfitters'],
      }),
    );
    assert.match(mustSection(r.out, 'CONTENT THE RULE BARS').join('\n'), /record\/runs\/7f3a2c\.md/);
    assert.doesNotMatch(r.out, /Brightwater/);
  });

  void test('the people-typed Owner is never a finding', () => {
    const q: QuestionFx = {
      key: 'q-02',
      title: 'May a guest borrow a lantern?',
      status: 'Open',
      owner: 'Ana Kowalczyk',
    };
    const r = status(blueprint({ questions: [APPLIED_Q1, q], barred: ['Ana Kowalczyk'] }));
    assert.equal(sectionOf(r.out, 'CONTENT THE RULE BARS'), undefined);
  });

  void test('a barred term in a FLAGGED objection is not echoed by C1', () => {
    // status.md Constraints: "Never print a value the content rule bars" — the whole screen, not only C9's lines.
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [
        ...(RESOLVE_ENTRY.lines ?? []),
        '- FLAGGED: «What is the late-return fee?» · answer "as Brightwater Outfitters charge" — nothing derivable',
      ],
    });
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [APPLIED_Q1, FLAGGED_Q2],
        log,
        barred: ['Brightwater Outfitters'],
      }),
    );
    assert.doesNotMatch(r.out, /Brightwater/);
  });

  void test('a price in an answer C3 rejects is not echoed by C3', () => {
    const r = status(
      blueprint({
        features: [BORROW, RETURN],
        questions: [APPLIED_Q1, answered({ directions: DIRECTIONS, answer: 'both, at £25 a night' })],
      }),
    );
    assert.doesNotMatch(r.out, /£25/);
  });
});

// ---- C10 — run-log arithmetic --------------------------------------------------------------------------------------

void describe('C10 — run-log arithmetic', () => {
  void test('a COUNTS line whose total disagrees with its own addends is named', () => {
    // 1 + 1 = 2, not 3.
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [...(RESOLVE_ENTRY.lines ?? []), '- COUNTS: question rows 3 = Applied 1 · Open 1'],
    });
    const r = status(blueprint({ log }));
    assert.match(mustSection(r.out, 'RUN-LOG ARITHMETIC').join('\n'), /7f3a2c/);
  });

  void test('a COUNTS line claiming more question rows than the recount finds is named with both numbers', () => {
    // The log claims 5 (= 3 + 2); questions.md holds 1 row.
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [...(RESOLVE_ENTRY.lines ?? []), '- COUNTS: question rows 5 = Applied 3 · Open 2'],
    });
    const row = rowsOf(mustSection(status(blueprint({ log })).out, 'RUN-LOG ARITHMETIC')).join('\n');
    assert.match(row, /\b5\b/);
    assert.match(row, /\b1\b/);
  });

  void test('a COUNTS line that agrees with the recount is not named', () => {
    const log = logOf({
      ...RESOLVE_ENTRY,
      lines: [...(RESOLVE_ENTRY.lines ?? []), '- COUNTS: question rows 1 = Applied 1'],
    });
    assert.equal(sectionOf(status(blueprint({ log })).out, 'RUN-LOG ARITHMETIC'), undefined);
  });

  void test('a funnel claiming more discards than the entry carries discard lines is named', () => {
    // 3 drafted → 0 + 0 + 0 + 1 + 2 = 3 outcomes, but only one discard line.
    const log = logOf(RESOLVE_ENTRY, {
      date: '2026-09-19',
      command: 'challenge',
      run: '9f2c1a',
      lines: [
        '- discard: "is the lantern bright enough?" · filter: not a product decision',
        '- funnel: 3 drafted → 0 routed default · 0 routed fix · 0 routed slot · 1 written as questions · 2 discarded',
      ],
    });
    assert.match(mustSection(status(blueprint({ log })).out, 'RUN-LOG ARITHMETIC').join('\n'), /9f2c1a/);
  });
});

// ---- S1 step 4 — no readable log ------------------------------------------------------------------------------------

void describe('S1 step 4 — a machine with no readable run log', () => {
  void test('says C4 and C10 could not be computed, and does not report clean', () => {
    const r = status(blueprint({ log: null }));
    assert.equal(r.code, EXIT.findings);
    assert.match(mustSection(r.out, 'STATE NOTHING WROTE OR RECONCILED').join('\n'), /could not be computed/);
    assert.match(mustSection(r.out, 'RUN-LOG ARITHMETIC').join('\n'), /could not be computed/);
  });

  void test('the header says the last run is unknown, never a date', () => {
    const r = status(blueprint({ log: null }));
    assert.match(r.out.split('\n')[1] ?? '', /^Last run unknown/);
  });
});

// ---- What is still unsettled -----------------------------------------------------------------------------------------

void describe('What is still unsettled — six lines, each naming rows, never a score', () => {
  const home = (): string =>
    blueprint({
      features: [
        withMarkers(
          BORROW,
          'renews [NEEDS CLARIFICATION: how often? → Question: carried]',
          'reserves [NEEDS CLARIFICATION: how far ahead? → Question: q-09]',
        ),
        {
          ...RETURN,
          body: body({
            behaviour: [
              'A member brings the lantern back.',
              'Content slot — client-supplied: the returns rota, supplied by the club secretary.',
            ],
          }),
        },
      ],
      questions: [
        APPLIED_Q1,
        { key: 'q-02', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-05T09:00:00' },
        {
          key: 'q-03',
          title: 'May a guest borrow a lantern?',
          status: 'Open',
          answer: 'Yes, with a member present, because the member is answerable.',
          created: '2026-09-01T09:00:00',
        },
        answered({ key: 'q-04' }),
        { ...FLAGGED_Q2, key: 'q-05' },
      ],
      log: logOf(RESOLVE_ENTRY, {
        date: '2026-09-19',
        command: 'challenge',
        run: '9f2c1a',
        lines: [
          '- ledger 9f2c1a #1: a loan may be renewed once',
          '- ledger 9f2c1a #2: a lantern is lent for one evening',
        ],
      }),
    });

  /** The block's content lines: after the heading, before the closing sentence. */
  function unsettled(): string[] {
    const block = mustSection(status(home()).out, 'WHAT IS STILL UNSETTLED');
    const end = block.findIndex((l) => /None of it blocks anything/.test(l));
    return block.slice(1, end < 0 ? block.length : end);
  }

  void test('has exactly six lines before its closing sentence', () => {
    assert.equal(unsettled().length, 6);
  });

  void test('line 1 names the features carrying a marker, broken and carried counted apart', () => {
    const l = unsettled()[0] ?? '';
    assert.match(l, /«Borrow a lantern»/);
    assert.doesNotMatch(l, /«Return a lantern»/);
    assert.match(l, /1 broken/);
    assert.match(l, /1 carried/);
  });

  void test('line 2 counts the Open, Answered and Flagged questions', () => {
    const l = unsettled()[1] ?? '';
    assert.match(l, /2 Open/);
    assert.match(l, /1 Answered/);
    assert.match(l, /1 Flagged/);
  });

  void test('line 3 names the features whose Behaviour holds no numbered requirement', () => {
    const l = unsettled()[2] ?? '';
    assert.match(l, /«Return a lantern»/);
    assert.doesNotMatch(l, /«Borrow a lantern»/);
  });

  void test('line 4 counts the unanswered Open questions and ages the oldest', () => {
    // q-02 is Open and unanswered, created 2026-09-05 → 20d. q-03 is older but answered, so it is not the oldest unanswered.
    const l = unsettled()[3] ?? '';
    assert.match(l, /^ {2}1 Open unanswered/);
    assert.match(l, /20d/);
  });

  void test('line 5 names each unratified batch by run id and line count', () => {
    assert.match(unsettled()[4] ?? '', /9f2c1a \(2\)/);
  });

  void test('line 6 names each content slot with its feature and who supplies it', () => {
    assert.match(unsettled()[5] ?? '', /«Return a lantern» \(the club secretary\)/);
  });

  void test('never prints a score', () => {
    assert.doesNotMatch(unsettled().join('\n'), /%/);
  });
});

// ---- the NEXT line (Constraints, v23) --------------------------------------------------------------------------------

void describe('NEXT — the challenge step is omitted only on a read of a converged, newest GRILL line', () => {
  const GRILL_YES = '- GRILL: scale delta · «Borrow a lantern» 0123456789ab (delta) · converged: yes';
  const GRILL_NO = '- GRILL: scale delta · «Borrow a lantern» 0123456789ab (delta) · converged: no';
  const waiting = answered({});
  const nextFor = (log: string): string =>
    nextLine(status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, waiting], log })).out);

  void test('omitted where the newest challenge entry converged and is also the newest write entry', () => {
    const n = nextFor(
      logOf({ date: '2026-09-22', command: 'challenge', run: '9f2c1a', lines: [GRILL_YES] }, RESOLVE_ENTRY),
    );
    assert.doesNotMatch(n, /\/blueprint challenge/);
    assert.match(n, /\/blueprint resolve \(1\)/);
  });

  void test('kept where a newer write entry follows the converged challenge entry', () => {
    const n = nextFor(
      logOf(RESOLVE_ENTRY, { date: '2026-09-18', command: 'challenge', run: '9f2c1a', lines: [GRILL_YES] }),
    );
    assert.match(n, /\/blueprint challenge/);
  });

  void test('kept where the newest GRILL line did not converge', () => {
    const n = nextFor(
      logOf({ date: '2026-09-22', command: 'challenge', run: '9f2c1a', lines: [GRILL_NO] }, RESOLVE_ENTRY),
    );
    assert.match(n, /\/blueprint challenge/);
  });

  void test('kept where the log carries no GRILL line', () => {
    assert.match(nextFor(logOf(RESOLVE_ENTRY)), /\/blueprint challenge/);
  });
});

// ---- the residue line ----------------------------------------------------------------------------------------------

void describe('the residue — what only a reader can decide', () => {
  void test('the screen ends with a "Not read by code" line naming C8\'s prose read and C9\'s names in prose', () => {
    const lines = status(everySection()).out.split('\n');
    const last = lines[lines.length - 1] ?? '';
    assert.match(last, /^Not read by code/);
    assert.match(last, /C8/);
    assert.match(last, /C9/);
  });

  void test('a pointer whose extra words may fill a <value> slot is handed to the reader under C3', () => {
    const q = answered({
      directions: ['1. A late fee of <amount> per day. Why: a fee brings lanterns back.', '2. No fee. Why: goodwill.'],
      answer: '1, a small one',
    });
    const lines = status(blueprint({ features: [BORROW, RETURN], questions: [APPLIED_Q1, q] })).out.split('\n');
    assert.match(lines[lines.length - 1] ?? '', /C3/);
  });

  void test('C3 is not in the residue when no pointer leaves a slot to judge', () => {
    const lines = status(everySection()).out.split('\n');
    assert.doesNotMatch(lines[lines.length - 1] ?? '', /\bC3\b/);
  });
});

// ---- this run never writes -------------------------------------------------------------------------------------------

function tree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(p, `${st.mtimeMs}:${readFile(p)}`);
    }
  };
  walk(dir);
  return out;
}

void describe('this run never writes', () => {
  void test('the working folder and the document are byte-for-byte and time-for-time unchanged', () => {
    const home = everySection();
    const before = tree(home);
    status(home);
    assert.deepEqual(tree(home), before);
  });
});

// ---- ages from the local target's date-only Created -------------------------------------------------------------------

void describe("ages from a date-only Created (spec/targets.md §3's own format) count calendar days in any timezone", () => {
  // status.md: "Never invent an age or a date". 2026-09-11 → 2026-09-25 is 14 calendar days, so the row is 14d old and not
  // yet "past 14 days" (C7). The machine's timezone is pinned for the test and restored after it.
  for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
    void test(`a row created 14 calendar days ago is 14d old, not stale, in ${tz}`, () => {
      const saved = process.env.TZ;
      process.env.TZ = tz;
      try {
        const r = status(
          blueprint({
            questions: [
              APPLIED_Q1,
              { key: 'q-02', title: 'Is a lantern lent in the rain?', status: 'Open', created: '2026-09-11' },
            ],
          }),
        );
        assert.match(mustSection(r.out, 'UNSENT QUESTIONS').join('\n'), /oldest 14d/);
        assert.equal(sectionOf(r.out, 'STUCK AND GOING STALE'), undefined);
      } finally {
        if (saved === undefined) delete process.env.TZ;
        else process.env.TZ = saved;
      }
    });
  }
});
