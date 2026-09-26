import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../src/core/errors.ts';
import {
  CONNECTOR,
  newPull,
  savePull,
  stepPull,
  toSnapshot,
  type PlannedCall,
  type PullState,
} from '../src/target/relay.ts';
import { statusPullPath } from '../src/target/relay-cli.ts';
import { locateTranscripts, type TranscriptSet } from '../src/target/transcript.ts';
import type { Snapshot } from '../src/snapshot.ts';
import {
  fetchResult,
  NOW_ISO,
  run,
  tempDir,
  writeFile,
  writeTranscript,
  type FakeCall,
  type RunResult,
} from './support/index.ts';

// Scope: the relay pull — src/target/relay.ts (plan, ingest, advance, snapshot) and src/target/relay-cli.ts (runPull, as
// `bp status` drives it on a Notion target).
// Spec: DESIGN.md §5 (5.1 plans and connector input shapes, 5.2 ingest, 5.3 parsing), spec/notion-mechanics.md §4 (the
// 10,000-result `request_status` trap, the 25-reference relation truncation), status.md S1 (read both databases in full;
// halt conditions), SKILL.md pre-flight 5 (the Board database).
// Every expected value below is written by hand from those rules. Production code only arranges (newPull, savePull,
// statusPullPath, locateTranscripts).

// ---- hermetic git: preflight and `bp status` shell out to git; no repository above tmpdir, no user/system config ----
const gitHome = tempDir('bp-githome-');
writeFile(join(gitHome, 'gitconfig'), '');
process.env['GIT_CONFIG_NOSYSTEM'] = '1';
process.env['GIT_CONFIG_GLOBAL'] = join(gitHome, 'gitconfig');
process.env['GIT_CEILING_DIRECTORIES'] = [tmpdir(), realpathSync(tmpdir())].join(':');

// ---- ids and addresses ------------------------------------------------------------------------------------------------

/** The overview page, as target.md writes it (hyphenated) and in canonical form (32 lowercase hex). */
const OVERVIEW_HYPHENATED = '0a1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9';
const OVERVIEW = '0a1b2c3d4e5f40618293a4b5c6d7e8f9';
const FEATURES_DS = 'collection://11111111-2222-4333-8444-555555555555';
const QUESTIONS_DS = 'collection://66666666-7777-4888-9999-aaaaaaaaaaaa';
const BOARD_DS = 'collection://bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
/** A 32-hex id from a short hex prefix — readable in failures, canonical by construction. */
const id32 = (prefix: string): string => prefix.padEnd(32, '0');
const F1 = id32('f1');
const F2 = id32('f2');
const Q1 = id32('e1');
const Q2 = id32('e2');
/** Row urls as the connector's query returns them (no `/p/`), and page urls as a fetch returns them. */
const rowUrl = (id: string): string => `https://app.notion.com/${id}`;
const pageUrl = (id: string): string => `https://app.notion.com/p/${id}`;

/** The tool names as a real session records them (DESIGN.md §5.1 table, under the `notion` MCP server). */
const FETCH = 'mcp__notion__notion-fetch';
const QUERY = 'mcp__notion__notion-query-data-sources';

/*
 * The two queries the plan must carry, written out by hand: `url` then the defined columns (databases.md) the data
 * source's schema holds — Features in its fixed order, Open Questions in schema order — every name double-quoted, FROM
 * the data source url. DESIGN.md §5.1: `{ data: { data_source_urls: [url], query: "<SQL>" } }`.
 */
const FEATURES_SQL =
  'SELECT url, "Name", "Area", "What it does", "Created", "Questions" FROM "collection://11111111-2222-4333-8444-555555555555"';
const QUESTIONS_SQL =
  'SELECT url, "Question", "Status", "Answer & why", "Why asked", "Suggested directions", "Why flagged", "Touches", "Owner", "Created" FROM "collection://66666666-7777-4888-9999-aaaaaaaaaaaa"';
const FEATURES_QUERY_INPUT = { data: { data_source_urls: [FEATURES_DS], query: FEATURES_SQL } };
const QUESTIONS_QUERY_INPUT = { data: { data_source_urls: [QUESTIONS_DS], query: QUESTIONS_SQL } };

// ---- time -------------------------------------------------------------------------------------------------------------

const T0 = new Date(NOW_ISO).getTime();
/** An ISO instant `s` seconds after the test clock's now (negative: before it). */
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();
/** The instant every unit-level pull is issued at — the same instant `bp status` issues its pull at under the test clock. */
const ISSUED = at(0);

// ---- connector results in their real shapes -------------------------------------------------------------------------

/** The overview page embeds each database inline and links it below — the real page names each data source twice. */
function overviewContent(extra: string[] = [], dbs: { ds: string; title: string; db: string }[] = DEFAULT_DBS): string {
  return [
    '## TL;DR',
    'Pickup slots for a café, paid ahead.',
    ...dbs.map((d) => `<database url="${pageUrl(d.db)}" inline="true" data-source-url="${d.ds}"></database>`),
    '---',
    ...dbs.map(
      (d) => `<database url="${pageUrl(d.db)}" inline="false" data-source-url="${d.ds}">${d.title}</database>`,
    ),
    ...extra,
  ].join('\n');
}
const DEFAULT_DBS = [
  { ds: FEATURES_DS, title: 'Features', db: id32('d1') },
  { ds: QUESTIONS_DS, title: 'Open Questions', db: id32('d2') },
];

const FEATURE_SCHEMA = {
  Name: { name: 'Name', type: 'title' },
  Area: { name: 'Area', type: 'select' },
  'What it does': { name: 'What it does', type: 'text' },
  Created: { name: 'Created', type: 'created_time' },
  Questions: { name: 'Questions', type: 'relation' },
};
const QUESTION_SCHEMA = {
  Question: { name: 'Question', type: 'title' },
  Status: { name: 'Status', type: 'select' },
  'Answer & why': { name: 'Answer & why', type: 'text' },
  'Why asked': { name: 'Why asked', type: 'text' },
  'Suggested directions': { name: 'Suggested directions', type: 'text' },
  'Why flagged': { name: 'Why flagged', type: 'text' },
  Touches: { name: 'Touches', type: 'relation' },
  Owner: { name: 'Owner', type: 'person' },
  Created: { name: 'Created', type: 'created_time' },
};

/** A data-source fetch result, in the connector's JSON envelope. */
function dsResult(ds: string, title: string, schema: Record<string, unknown>): string {
  const text = [
    `<data-source url="{{${ds}}}">`,
    `The title of this Data Source is: ${title}`,
    '',
    "Here is the database's configurable state:",
    'Properties with `readOnly: true` are synced or system-managed. Do not try to update their values with page update tools.',
    '<data-source-state>',
    JSON.stringify({ name: title, schema }),
    '</data-source-state>',
    '</data-source>',
  ].join('\n');
  return JSON.stringify({ metadata: { type: 'data_source' }, title, url: pageUrl(id32('d9')), text });
}

/** A query result: rows, `has_more`, and whatever else a test needs (request_status). */
function queryResult(rows: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ results: rows, has_more: false, data_source_ids: ['x'], ...extra });
}

const F1_ROW = {
  url: rowUrl(F1),
  Name: 'Checkout',
  Area: 'Payments',
  'What it does': 'Pay for a pickup slot.<br>Once.',
  Created: '2026-09-08 08:35:37Z',
  Questions: JSON.stringify([rowUrl(Q1)]),
};
const F2_ROW = {
  url: rowUrl(F2),
  Name: 'Pickup',
  Area: 'Slots',
  'What it does': 'Collect the order.',
  Created: '2026-09-08 08:36:00Z',
  Questions: null,
};
const Q1_ROW = {
  url: rowUrl(Q1),
  Question: 'Which payment provider?',
  Status: 'Open',
  'Answer & why': null,
  'Why asked': 'FR-1 names no provider.',
  'Suggested directions': null,
  'Why flagged': null,
  Touches: JSON.stringify([rowUrl(F1)]),
  Owner: null,
  Created: '2026-09-09 10:00:00Z',
};
const Q2_ROW = {
  url: rowUrl(Q2),
  Question: 'Can a slot be moved?',
  Status: 'Answered',
  'Answer & why': 'Yes, once.<br>Because staff asked.',
  'Why asked': 'FR-2 is silent.',
  'Suggested directions': null,
  'Why flagged': null,
  Touches: JSON.stringify([rowUrl(F1), rowUrl(F2)]),
  Owner: null,
  Created: '2026-09-09 10:05:00Z',
};

const BODY_F1 = '## Why\nCustomers pay for a pickup slot.\n\n## Behaviour\n1. **FR-1** The app charges the card once.';
const BODY_F2 = '## Why\nCustomers collect their order.\n\n## Behaviour\n1. **FR-1** Staff hand over the order.';

// ---- transcript calls -------------------------------------------------------------------------------------------------

let callSeq = 0;
const nextId = (): string => `toolu_relay_${String(++callSeq).padStart(4, '0')}`;

function fetchCall(
  inputId: string,
  result: string,
  when: string,
  opts: { name?: string; isError?: boolean } = {},
): FakeCall {
  return {
    id: nextId(),
    name: opts.name ?? FETCH,
    input: { id: inputId },
    result: [{ type: 'text', text: result }],
    at: when,
    ...(opts.isError ? { isError: true } : {}),
  };
}
function queryCall(input: unknown, result: string, when: string): FakeCall {
  return { id: nextId(), name: QUERY, input, result: [{ type: 'text', text: result }], at: when };
}

const overviewCall = (when: string, content = overviewContent()): FakeCall =>
  fetchCall(
    OVERVIEW,
    fetchResult({ id: OVERVIEW, properties: { title: 'PRD — Café' }, content, title: 'PRD — Café' }),
    when,
  );
const dsCalls = (when: number): FakeCall[] => [
  fetchCall(FEATURES_DS, dsResult(FEATURES_DS, 'Features', FEATURE_SCHEMA), at(when)),
  fetchCall(QUESTIONS_DS, dsResult(QUESTIONS_DS, 'Open Questions', QUESTION_SCHEMA), at(when + 1)),
];
const queryCalls = (
  when: number,
  features: Record<string, unknown>[] = [F1_ROW, F2_ROW],
  questions: Record<string, unknown>[] = [Q1_ROW, Q2_ROW],
): FakeCall[] => [
  queryCall(FEATURES_QUERY_INPUT, queryResult(features), at(when)),
  queryCall(QUESTIONS_QUERY_INPUT, queryResult(questions), at(when + 1)),
];
const bodyCall = (id: string, content: string, when: number, props: Record<string, unknown> = {}): FakeCall =>
  fetchCall(id, fetchResult({ id, properties: { Name: 'feature', ...props }, content }), at(when));
const bodyCalls = (when: number): FakeCall[] => [bodyCall(F1, BODY_F1, when), bodyCall(F2, BODY_F2, when + 1)];

/** Every call of a complete two-feature pull, stage by stage. */
const happyStages = (): FakeCall[][] => [[overviewCall(at(1))], dsCalls(10), queryCalls(20), bodyCalls(30)];

/** Append calls to a transcript in Claude Code's shape — the same two events `writeTranscript` writes per call. */
function appendCalls(path: string, calls: FakeCall[]): void {
  const lines = calls.flatMap((c) => [
    JSON.stringify({
      type: 'assistant',
      timestamp: c.at,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }] },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: c.at,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: c.id, content: c.result, ...(c.isError ? { is_error: true } : {}) },
        ],
      },
    }),
  ]);
  appendFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

const transcriptOf = (calls: FakeCall[]): TranscriptSet => ({
  main: writeTranscript(join(tempDir('bp-transcript-'), 'session.jsonl'), calls),
  subagents: [],
});

/**
 * Step a fresh pull stage by stage: the transcript starts with the first stage's calls, and each later stage's calls are
 * appended before the next step — the orchestrator making the calls bp printed, then running bp again.
 */
function stepThrough(stages: FakeCall[][], deep = false): { state: PullState; done: boolean } {
  const state = newPull(OVERVIEW, ISSUED, deep);
  const t = transcriptOf(stages[0] ?? []);
  let done = stepPull(state, t).done;
  for (const calls of stages.slice(1)) {
    appendCalls(t.main, calls);
    done = stepPull(state, t).done;
  }
  return { state, done };
}

/** A pull stepped to its end against a transcript holding every call (arranging a finished pull for snapshot tests). */
function finishedPull(stages: FakeCall[][]): PullState {
  const { state, done } = stepThrough(stages);
  assert.ok(
    done,
    `arranged pull did not finish: stage ${state.stage}, pending ${state.pending.map((p) => p.key).join(', ')}`,
  );
  return state;
}
const snapshotOf = (stages: FakeCall[][]): Snapshot => toSnapshot(finishedPull(stages), ISSUED);

const keys = (pending: readonly PlannedCall[]): string[] => pending.map((p) => p.key);

// ---- the plan, stage by stage (overview → data sources → queries → bodies → done) ---------------------------------------

void describe('relay pull — the plan, stage by stage', () => {
  void test('a new pull plans one fetch of the overview page by its canonical id', () => {
    const s = newPull(OVERVIEW_HYPHENATED.toUpperCase(), ISSUED);
    assert.equal(s.stage, 'overview');
    assert.deepEqual(s.pending, [{ key: 'overview', tool: 'notion-fetch', input: { id: OVERVIEW } }]);
  });

  void test('the overview result plans one fetch per data source the overview embeds', () => {
    const { state, done } = stepThrough([[overviewCall(at(1))]]);
    assert.equal(done, false);
    assert.equal(state.stage, 'schemas');
    // Four <database> tags, two data sources: each is fetched once.
    assert.deepEqual(
      state.pending.map((p) => ({ tool: p.tool, input: p.input })),
      [
        { tool: 'notion-fetch', input: { id: FEATURES_DS } },
        { tool: 'notion-fetch', input: { id: QUESTIONS_DS } },
      ],
    );
  });

  void test('the data-source results plan one query per database, url first, then the defined columns', () => {
    const { state } = stepThrough([[overviewCall(at(1))], dsCalls(10)]);
    assert.equal(state.stage, 'queries');
    assert.deepEqual(state.pending, [
      { key: 'q:features', tool: 'notion-query-data-sources', input: FEATURES_QUERY_INPUT },
      { key: 'q:questions', tool: 'notion-query-data-sources', input: QUESTIONS_QUERY_INPUT },
    ]);
  });

  void test('the query results plan one body fetch per feature row', () => {
    const { state } = stepThrough([[overviewCall(at(1))], dsCalls(10), queryCalls(20)]);
    assert.equal(state.stage, 'bodies');
    assert.deepEqual(state.pending, [
      { key: `body:${F1}`, tool: 'notion-fetch', input: { id: F1 } },
      { key: `body:${F2}`, tool: 'notion-fetch', input: { id: F2 } },
    ]);
  });

  void test('the body results finish the pull with nothing owed', () => {
    const { state, done } = stepThrough(happyStages());
    assert.equal(done, true);
    assert.equal(state.stage, 'done');
    assert.deepEqual(state.pending, []);
  });

  void test('a deep pull also plans a fetch of every question row', () => {
    const { state } = stepThrough([[overviewCall(at(1))], dsCalls(10), queryCalls(20)], true);
    assert.deepEqual(keys(state.pending), [`body:${F1}`, `body:${F2}`, `qbody:${Q1}`, `qbody:${Q2}`]);
  });

  void test('the planned tools are the connector names DESIGN.md §5.1 lists', () => {
    assert.deepEqual(
      { fetch: CONNECTOR.fetch, query: CONNECTOR.query },
      { fetch: 'notion-fetch', query: 'notion-query-data-sources' },
    );
  });
});

// ---- matching transcript calls to the plan (DESIGN.md §5.2) -------------------------------------------------------------

void describe('relay pull — matching transcript calls to the plan', () => {
  void test('a call made before the pull began is ignored', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const { outcome } = stepPull(s, transcriptOf([overviewCall(at(-60))]));
    assert.deepEqual(outcome.missing, ['overview']);
    assert.equal(s.stage, 'overview');
  });

  void test('a call made at the instant the pull was issued is ingested', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const { outcome } = stepPull(s, transcriptOf([overviewCall(ISSUED)]));
    assert.deepEqual(outcome.found, ['overview']);
  });

  void test('calls made ahead of the plan within the pull are ingested in the same step', () => {
    // The transcript already answers the data-source fetches the overview result is about to plan.
    const s = newPull(OVERVIEW, ISSUED);
    stepPull(s, transcriptOf([overviewCall(at(1)), ...dsCalls(2)]));
    assert.equal(s.stage, 'queries');
    assert.deepEqual(keys(s.pending), ['q:features', 'q:questions']);
  });

  void test('a transcript already holding every call of the pull finishes it in one step', () => {
    // §5.2: every planned call is matched against the transcript — none is reported owed while its result is there.
    const s = newPull(OVERVIEW, ISSUED);
    const { done } = stepPull(s, transcriptOf(happyStages().flat()));
    assert.deepEqual(keys(s.pending), []);
    assert.equal(done, true);
  });

  void test('the fetch tool under another MCP server prefix answers the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = { ...overviewCall(at(1)), name: 'mcp__claude_ai_Notion__notion-fetch' };
    const { outcome } = stepPull(s, transcriptOf([call]));
    assert.deepEqual(outcome.found, ['overview']);
  });

  void test('a tool whose name only ends in the same letters does not answer the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = { ...overviewCall(at(1)), name: 'mcp__other__not-notion-fetch' };
    const { outcome } = stepPull(s, transcriptOf([call]));
    assert.deepEqual(outcome.missing, ['overview']);
  });

  void test('an overview fetched by its hyphenated upper-case id answers the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = { ...overviewCall(at(1)), input: { id: OVERVIEW_HYPHENATED.toUpperCase() } };
    const { outcome } = stepPull(s, transcriptOf([call]));
    assert.deepEqual(outcome.found, ['overview']);
  });

  void test('an overview fetched by its page URL answers the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = { ...overviewCall(at(1)), input: { id: `https://www.notion.so/acme/PRD-Cafe-${OVERVIEW}?pvs=4` } };
    const { outcome } = stepPull(s, transcriptOf([call]));
    assert.deepEqual(outcome.found, ['overview']);
  });

  void test('a data source fetched in its double-braced form answers the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const [features, questions] = dsCalls(2);
    const braced = [{ ...features!, input: { id: `{{${FEATURES_DS}}}` } }, questions!];
    stepPull(s, transcriptOf([overviewCall(at(1)), ...braced]));
    assert.equal(s.stage, 'queries');
  });

  void test('a fetch of a different page does not answer the plan', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = { ...overviewCall(at(1)), input: { id: id32('abc') } };
    const { outcome } = stepPull(s, transcriptOf([call]));
    assert.deepEqual(outcome.missing, ['overview']);
  });

  void test('a query answers the plan whatever order its input keys were written in', () => {
    const reordered = { data: { query: FEATURES_SQL, data_source_urls: [FEATURES_DS] } };
    const [, questions] = queryCalls(20);
    const { state } = stepThrough([
      [overviewCall(at(1))],
      dsCalls(10),
      [queryCall(reordered, queryResult([F1_ROW, F2_ROW]), at(20)), questions!],
    ]);
    assert.equal(state.stage, 'bodies');
  });

  void test('a query with different SQL does not answer the plan', () => {
    const other = { data: { data_source_urls: [FEATURES_DS], query: `SELECT * FROM "${FEATURES_DS}"` } };
    const [, questions] = queryCalls(20);
    const { state } = stepThrough([
      [overviewCall(at(1))],
      dsCalls(10),
      [queryCall(other, queryResult([F1_ROW]), at(20)), questions!],
    ]);
    assert.equal(state.stage, 'queries');
    assert.deepEqual(keys(state.pending), ['q:features']);
  });

  void test('an error result keeps the call pending and reports the error by key', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const call = fetchCall(OVERVIEW, 'object_not_found: Could not find page', at(1), { isError: true });
    const { outcome, done } = stepPull(s, transcriptOf([call]));
    assert.equal(done, false);
    assert.deepEqual(keys(s.pending), ['overview']);
    assert.deepEqual(outcome.errors, [{ key: 'overview', text: 'object_not_found: Could not find page' }]);
  });

  void test('a successful retry after an error result is ingested', () => {
    const s = newPull(OVERVIEW, ISSUED);
    const failed = fetchCall(OVERVIEW, 'rate_limited', at(1), { isError: true });
    const { outcome } = stepPull(s, transcriptOf([failed, overviewCall(at(5))]));
    assert.deepEqual(outcome.found, ['overview']);
    assert.deepEqual(outcome.errors, []);
  });

  void test("a result in one of the session's subagent transcripts answers the plan", () => {
    const dir = tempDir('bp-transcript-');
    const main = writeTranscript(join(dir, 'session.jsonl'), []);
    writeTranscript(join(dir, 'session', 'subagents', 'agent-a1.jsonl'), [overviewCall(at(1))]);
    const s = newPull(OVERVIEW, ISSUED);
    const { outcome } = stepPull(s, locateTranscripts({ explicit: main }));
    assert.deepEqual(outcome.found, ['overview']);
  });
});

// ---- the snapshot and its completeness (DESIGN.md §5.3, notion-mechanics §4) ---------------------------------------------

void describe('relay pull — the snapshot and its completeness', () => {
  void test("a finished pull's snapshot carries every feature row with its body", () => {
    const s = snapshotOf(happyStages());
    assert.deepEqual(
      s.features.map((f) => ({
        id: f.id,
        name: f.name,
        area: f.area,
        whatItDoes: f.whatItDoes,
        created: f.created,
        questionRefs: f.questionRefs,
        content: f.content,
      })),
      [
        {
          id: F1,
          name: 'Checkout',
          area: 'Payments',
          whatItDoes: 'Pay for a pickup slot.\nOnce.',
          created: '2026-09-08 08:35:37Z',
          questionRefs: [Q1],
          content: BODY_F1,
        },
        {
          id: F2,
          name: 'Pickup',
          area: 'Slots',
          whatItDoes: 'Collect the order.',
          created: '2026-09-08 08:36:00Z',
          questionRefs: [],
          content: BODY_F2,
        },
      ],
    );
  });

  void test("a finished pull's snapshot carries every question row, Touches read from the query's JSON-encoded relation", () => {
    const s = snapshotOf(happyStages());
    assert.deepEqual(
      s.questions.map((q) => ({
        id: q.id,
        question: q.question,
        status: q.status,
        answer: q.answer,
        whyAsked: q.whyAsked,
        touches: q.touches,
      })),
      [
        {
          id: Q1,
          question: 'Which payment provider?',
          status: 'Open',
          answer: '',
          whyAsked: 'FR-1 names no provider.',
          touches: [F1],
        },
        {
          id: Q2,
          question: 'Can a slot be moved?',
          status: 'Answered',
          answer: 'Yes, once.\nBecause staff asked.',
          whyAsked: 'FR-2 is silent.',
          touches: [F1, F2],
        },
      ],
    );
  });

  void test('a complete pull reports nothing incomplete, no Board, and the Why flagged property', () => {
    const s = snapshotOf(happyStages());
    assert.deepEqual(
      { incomplete: s.incomplete, legacyBoard: s.legacyBoard, hasWhyFlagged: s.hasWhyFlagged, target: s.target },
      {
        incomplete: [],
        legacyBoard: false,
        hasWhyFlagged: true,
        target: { kind: 'notion', address: OVERVIEW },
      },
    );
  });

  void test('has_more on the Features query marks the read incomplete', () => {
    const [ov, ds, , bodies] = happyStages();
    const q = [
      queryCall(FEATURES_QUERY_INPUT, queryResult([F1_ROW, F2_ROW], { has_more: true }), at(20)),
      queryCall(QUESTIONS_QUERY_INPUT, queryResult([Q1_ROW]), at(21)),
    ];
    const s = snapshotOf([ov!, ds!, q, bodies!]);
    assert.equal(s.incomplete.length, 1);
    assert.match(s.incomplete[0]!, /Features.*has_more/);
  });

  void test('request_status "incomplete" on the Open Questions query marks the read incomplete though has_more is false', () => {
    const [ov, ds, , bodies] = happyStages();
    const q = [
      queryCall(FEATURES_QUERY_INPUT, queryResult([F1_ROW, F2_ROW]), at(20)),
      queryCall(
        QUESTIONS_QUERY_INPUT,
        queryResult([Q1_ROW], { has_more: false, request_status: { type: 'incomplete' } }),
        at(21),
      ),
    ];
    const s = snapshotOf([ov!, ds!, q, bodies!]);
    assert.equal(s.incomplete.length, 1);
    assert.match(s.incomplete[0]!, /Open Questions/);
  });

  void test('a Board data source beneath the overview marks the Blueprint as the superseded skill’s', () => {
    // The Board is embedded inline only, so its tag carries no title: only its data-source fetch names it.
    const content = overviewContent([
      `<database url="${pageUrl(id32('d3'))}" inline="true" data-source-url="${BOARD_DS}"></database>`,
    ]);
    const board = fetchCall(BOARD_DS, dsResult(BOARD_DS, 'Board', { Name: { name: 'Name', type: 'title' } }), at(12));
    const s = snapshotOf([[overviewCall(at(1), content)], [...dsCalls(10), board], queryCalls(20), bodyCalls(30)]);
    assert.equal(s.legacyBoard, true);
  });

  void test('a Board database named on the overview marks the Blueprint as the superseded skill’s', () => {
    const content = overviewContent([
      `<database url="${pageUrl(id32('d3'))}" inline="false" data-source-url="${BOARD_DS}">Board</database>`,
    ]);
    const board = fetchCall(BOARD_DS, dsResult(BOARD_DS, 'Board', { Name: { name: 'Name', type: 'title' } }), at(12));
    const s = snapshotOf([[overviewCall(at(1), content)], [...dsCalls(10), board], queryCalls(20), bodyCalls(30)]);
    assert.equal(s.legacyBoard, true);
  });

  void test('a missing Open Questions data source marks the read incomplete and plans no question query', () => {
    const content = overviewContent([], [DEFAULT_DBS[0]!]);
    const { state } = stepThrough([[overviewCall(at(1), content)], [dsCalls(10)[0]!]]);
    assert.deepEqual(keys(state.pending), ['q:features']);
  });

  void test('a missing Open Questions data source leaves the snapshot incomplete, naming the database', () => {
    const content = overviewContent([], [DEFAULT_DBS[0]!]);
    const s = snapshotOf([
      [overviewCall(at(1), content)],
      [dsCalls(10)[0]!],
      [queryCall(FEATURES_QUERY_INPUT, queryResult([F1_ROW, F2_ROW]), at(20))],
      bodyCalls(30),
    ]);
    assert.ok(s.incomplete.length > 0);
    assert.ok(
      s.incomplete.every((r) => r.includes('Open Questions')),
      s.incomplete.join(' | '),
    );
    assert.equal(s.hasWhyFlagged, null);
  });

  void test('an overview naming no child database ends the pull and says to run init', () => {
    const content = '## TL;DR\nPickup slots for a café, paid ahead.';
    const s = newPull(OVERVIEW, ISSUED);
    const { done } = stepPull(s, transcriptOf([overviewCall(at(1), content)]));
    assert.equal(done, true);
    const snap = toSnapshot(s, ISSUED);
    assert.ok(
      snap.incomplete.some((r) => r.includes('/blueprint init')),
      snap.incomplete.join(' | '),
    );
  });

  void test('a feature page the connector returned truncated marks the read incomplete', () => {
    const truncated = JSON.stringify({
      ...(JSON.parse(fetchResult({ id: F1, properties: { Name: 'Checkout' }, content: BODY_F1 })) as Record<
        string,
        unknown
      >),
      truncated: true,
    });
    const [ov, ds, q] = happyStages();
    const s = snapshotOf([ov!, ds!, q!, [fetchCall(F1, truncated, at(30)), bodyCall(F2, BODY_F2, 31)]]);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]!.includes(F1) && s.incomplete[0]!.includes('truncated'), s.incomplete[0]);
  });

  void test('a feature page with blocks the connector could not render marks the read incomplete', () => {
    const partial = JSON.stringify({
      ...(JSON.parse(fetchResult({ id: F2, properties: { Name: 'Pickup' }, content: BODY_F2 })) as Record<
        string,
        unknown
      >),
      unknown_block_count: 2,
    });
    const [ov, ds, q] = happyStages();
    const s = snapshotOf([ov!, ds!, q!, [bodyCall(F1, BODY_F1, 30), fetchCall(F2, partial, at(31))]]);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]!.includes(F2), s.incomplete[0]);
  });

  /** A Features row whose Questions relation (JSON-encoded, as a query returns it) holds `n` references. */
  const rowWithRefs = (n: number): Record<string, unknown> => ({
    ...F1_ROW,
    Questions: JSON.stringify(Array.from({ length: n }, (_, i) => rowUrl(id32(`c${i.toString(16).padStart(2, '0')}`)))),
  });

  void test('a Questions relation holding 25 references marks the read incomplete (notion-mechanics §4)', () => {
    const [ov, ds, , bodies] = happyStages();
    const s = snapshotOf([ov!, ds!, queryCalls(20, [rowWithRefs(25), F2_ROW], []), bodies!]);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]!.includes('Checkout') && s.incomplete[0]!.includes('25'), s.incomplete[0]);
  });

  void test('a Questions relation holding 24 references is a complete read', () => {
    const [ov, ds, , bodies] = happyStages();
    const s = snapshotOf([ov!, ds!, queryCalls(20, [rowWithRefs(24), F2_ROW], []), bodies!]);
    assert.deepEqual(s.incomplete, []);
    assert.equal(s.features[0]!.questionRefs.length, 24);
  });

  void test('a Touches relation holding 25 references marks the read incomplete (DESIGN.md §5.3)', () => {
    const features = Array.from({ length: 25 }, (_, i) => rowUrl(id32(`b${i.toString(16).padStart(2, '0')}`)));
    const wide = { ...Q1_ROW, Touches: JSON.stringify(features) };
    const [ov, ds, , bodies] = happyStages();
    const s = snapshotOf([ov!, ds!, queryCalls(20, [F1_ROW, F2_ROW], [wide]), bodies!]);
    assert.equal(s.incomplete.length, 1, s.incomplete.join(' | '));
    assert.ok(s.incomplete[0]!.includes('Touches'), s.incomplete[0]);
  });

  void test("a feature's Questions relation comes from the query row, never off the fetched page", () => {
    // The query says Pickup relates to no question; the page object claims one. Only the query side is read
    // (DESIGN.md §5.3, notion-mechanics §4 "Never read a relation off a page object").
    const [ov, ds, q] = happyStages();
    const pickup = bodyCall(F2, BODY_F2, 31, { Questions: [pageUrl(Q2)] });
    const s = snapshotOf([ov!, ds!, q!, [bodyCall(F1, BODY_F1, 30), pickup]]);
    assert.deepEqual(s.features.find((f) => f.id === F2)?.questionRefs, []);
  });
});

// ---- bp status on a Notion target (relay-cli.ts runPull) ------------------------------------------------------------------

const SESSION = 'relay-session-0001';
const statePaths: string[] = [];
after(() => {
  for (const p of statePaths) rmSync(p, { force: true });
});

interface NotionSetup {
  ws: string;
  transcript: string;
  env: Record<string, string>;
  statePath: string;
}

/** A standalone workspace whose target.md names a Notion overview, and a session transcript under a temp HOME. */
function notionSetup(calls: FakeCall[] = []): NotionSetup {
  const ws = tempDir('bp-ws-');
  const home = join(ws, '.blueprint');
  writeFile(join(home, 'target.md'), `# Target\n\nkind: notion\noverview_page_id: ${OVERVIEW_HYPHENATED}\n`);
  const claudeHome = tempDir('bp-claude-home-');
  const transcript = writeTranscript(
    join(claudeHome, '.claude', 'projects', '-tmp-relay-project', `${SESSION}.jsonl`),
    calls,
  );
  const statePath = statusPullPath(home);
  statePaths.push(statePath);
  return { ws, transcript, env: { CLAUDE_CODE_SESSION_ID: SESSION, HOME: claudeHome }, statePath };
}

const status = (w: NotionSetup, extra: string[] = [], now?: string): RunResult =>
  run(['status', '--title', 'Relay', ...extra], { workspace: w.ws, env: w.env, ...(now ? { now } : {}) });

/** The numbered call lines of a WAITING screen. */
const callLines = (out: string): string[] => out.split('\n').filter((l) => /^\s+\d+\. /.test(l));

/** The first line of the status screen (status.md S3), for the title and the test clock's local date. */
const SCREEN_HEAD = 'BLUEPRINT STATUS · Relay · 2026-09-25';

/** A finished pull saved to a file, for --replay. */
function savedPull(stages: FakeCall[][]): string {
  const path = join(tempDir('bp-replay-'), 'pull.json');
  savePull(path, finishedPull(stages));
  return path;
}

void describe('bp status on a Notion target', () => {
  void test('prints WAITING with exactly the overview fetch and exits 4', () => {
    const r = status(notionSetup());
    assert.equal(r.code, EXIT.waiting);
    assert.match(r.out, /^WAITING/);
    assert.match(r.out, /at most 3 in flight/);
    assert.deepEqual(callLines(r.out), [`  1. notion-fetch  {"id":"${OVERVIEW}"}`]);
  });

  void test('--json prints the owed calls as data', () => {
    const r = status(notionSetup(), ['--json']);
    assert.equal(r.code, EXIT.waiting);
    const parsed: unknown = JSON.parse(r.out);
    assert.deepEqual(parsed, {
      status: 'waiting',
      stage: 'overview',
      calls: [{ tool: 'notion-fetch', input: { id: OVERVIEW } }],
      errors: [],
    });
  });

  void test('advances to the data-source fetches once the overview result is appended to the transcript', () => {
    const w = notionSetup();
    assert.equal(status(w).code, EXIT.waiting);
    appendCalls(w.transcript, [overviewCall(at(1))]);
    const r = status(w);
    assert.equal(r.code, EXIT.waiting);
    assert.deepEqual(callLines(r.out), [
      `  1. notion-fetch  {"id":"${FEATURES_DS}"}`,
      `  2. notion-fetch  {"id":"${QUESTIONS_DS}"}`,
    ]);
  });

  void test('prints the two queries, input verbatim, once the data-source results are in', () => {
    const w = notionSetup();
    status(w);
    appendCalls(w.transcript, [overviewCall(at(1))]);
    status(w);
    appendCalls(w.transcript, dsCalls(10));
    const r = status(w, ['--json']);
    assert.equal(r.code, EXIT.waiting);
    const parsed: unknown = JSON.parse(r.out);
    assert.deepEqual(parsed, {
      status: 'waiting',
      stage: 'queries',
      calls: [
        { tool: 'notion-query-data-sources', input: FEATURES_QUERY_INPUT },
        { tool: 'notion-query-data-sources', input: QUESTIONS_QUERY_INPUT },
      ],
      errors: [],
    });
  });

  void test("reaches the status screen once every stage's results have been appended", () => {
    const w = notionSetup();
    for (const calls of happyStages()) {
      assert.equal(status(w).code, EXIT.waiting);
      appendCalls(w.transcript, calls);
    }
    const r = status(w);
    assert.notEqual(r.code, EXIT.waiting);
    assert.notEqual(r.code, EXIT.halt, r.err);
    assert.equal(r.out.split('\n')[0], SCREEN_HEAD);
  });

  void test('reports an error result and asks for the same call again', () => {
    const w = notionSetup([fetchCall(OVERVIEW, 'object_not_found: Could not find page', at(1), { isError: true })]);
    const r = status(w);
    assert.equal(r.code, EXIT.waiting);
    assert.deepEqual(callLines(r.out), [`  1. notion-fetch  {"id":"${OVERVIEW}"}`]);
    assert.match(r.out, /! overview returned an error: object_not_found: Could not find page/);
  });

  void test('ignores a result made before the pull began', () => {
    const w = notionSetup([overviewCall(at(-120))]);
    const r = status(w, ['--json']);
    assert.equal(r.code, EXIT.waiting);
    const parsed: unknown = JSON.parse(r.out);
    assert.deepEqual(parsed, {
      status: 'waiting',
      stage: 'overview',
      calls: [{ tool: 'notion-fetch', input: { id: OVERVIEW } }],
      errors: [],
    });
  });

  void test('reads the transcript named by --transcript without a session id', () => {
    const w = notionSetup([overviewCall(at(1))]);
    const r = run(['status', '--title', 'Relay', '--transcript', w.transcript], { workspace: w.ws, env: {} });
    assert.equal(r.code, EXIT.waiting);
    assert.deepEqual(callLines(r.out), [
      `  1. notion-fetch  {"id":"${FEATURES_DS}"}`,
      `  2. notion-fetch  {"id":"${QUESTIONS_DS}"}`,
    ]);
  });

  void test('with no session transcript it stops with a usage error naming --transcript', () => {
    const w = notionSetup();
    const r = run(['status', '--title', 'Relay'], { workspace: w.ws, env: { HOME: tempDir('bp-empty-home-') } });
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--transcript/);
  });

  void test('--fresh discards a saved pull and plans the overview fetch again', () => {
    const w = notionSetup();
    status(w);
    appendCalls(w.transcript, [overviewCall(at(1))]);
    // Ten minutes on, the saved pull would still resume (it would plan the data sources); --fresh starts over, and the
    // overview result made before the new pull began no longer counts.
    const r = status(w, ['--fresh', '--json'], '2026-09-25T14:17:00');
    assert.equal(r.code, EXIT.waiting);
    const parsed: unknown = JSON.parse(r.out);
    assert.deepEqual(parsed, {
      status: 'waiting',
      stage: 'overview',
      calls: [{ tool: 'notion-fetch', input: { id: OVERVIEW } }],
      errors: [],
    });
  });

  void test('without --fresh a saved pull resumes where it was', () => {
    const w = notionSetup();
    status(w);
    appendCalls(w.transcript, [overviewCall(at(1))]);
    const r = status(w, ['--json'], '2026-09-25T14:17:00');
    assert.equal(r.code, EXIT.waiting);
    const parsed: unknown = JSON.parse(r.out);
    assert.deepEqual(parsed, {
      status: 'waiting',
      stage: 'schemas',
      calls: [
        { tool: 'notion-fetch', input: { id: FEATURES_DS } },
        { tool: 'notion-fetch', input: { id: QUESTIONS_DS } },
      ],
      errors: [],
    });
  });

  void test('--replay of a saved finished pull prints the status screen with no transcript at all', () => {
    const w = notionSetup();
    const r = run(['status', '--title', 'Relay', '--replay', savedPull(happyStages())], { workspace: w.ws, env: {} });
    assert.notEqual(r.code, EXIT.waiting);
    assert.notEqual(r.code, EXIT.halt, r.err);
    assert.equal(r.out.split('\n')[0], SCREEN_HEAD);
  });

  void test('--replay of a pull that has not finished is a usage error', () => {
    const w = notionSetup();
    const path = join(tempDir('bp-replay-'), 'pull.json');
    savePull(path, newPull(OVERVIEW, ISSUED));
    const r = run(['status', '--replay', path], { workspace: w.ws, env: {} });
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /not finished/);
  });

  void test('a Board database beneath the overview halts status', () => {
    const w = notionSetup();
    const content = overviewContent([
      `<database url="${pageUrl(id32('d3'))}" inline="false" data-source-url="${BOARD_DS}">Board</database>`,
    ]);
    const board = fetchCall(BOARD_DS, dsResult(BOARD_DS, 'Board', { Name: { name: 'Name', type: 'title' } }), at(12));
    const replay = savedPull([[overviewCall(at(1), content)], [...dsCalls(10), board], queryCalls(20), bodyCalls(30)]);
    const r = run(['status', '--replay', replay], { workspace: w.ws, env: {} });
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /Board/);
  });

  void test('an incomplete query halts status and names the database', () => {
    const w = notionSetup();
    const [ov, ds, , bodies] = happyStages();
    const q = [
      queryCall(
        FEATURES_QUERY_INPUT,
        queryResult([F1_ROW, F2_ROW], { request_status: { type: 'incomplete' } }),
        at(20),
      ),
      queryCall(QUESTIONS_QUERY_INPUT, queryResult([Q1_ROW]), at(21)),
    ];
    const r = run(['status', '--replay', savedPull([ov!, ds!, q, bodies!])], { workspace: w.ws, env: {} });
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /Features/);
  });

  void test('a missing database halts status, names it, and says to run /blueprint init (status.md S1)', () => {
    const w = notionSetup();
    const content = overviewContent([], [DEFAULT_DBS[0]!]);
    const replay = savedPull([
      [overviewCall(at(1), content)],
      [dsCalls(10)[0]!],
      [queryCall(FEATURES_QUERY_INPUT, queryResult([F1_ROW, F2_ROW]), at(20))],
      bodyCalls(30),
    ]);
    const r = run(['status', '--replay', replay], { workspace: w.ws, env: {} });
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /Open Questions/);
    assert.match(r.err, /\/blueprint init/);
  });
});
