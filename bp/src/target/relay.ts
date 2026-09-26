import { readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { sha256 } from '../core/hash.ts';
import {
  isRecord,
  parseJson,
  must,
  object,
  string,
  array,
  oneOf,
  integer,
  record,
  nullable,
  boolean,
  type Schema,
} from '../core/schema.ts';
import type { Question } from '../domain/question.ts';
import { STATUSES, type Status } from '../domain/vocab.ts';
import { makeFeature, makeOverview, type FeatureRec, type Snapshot } from '../snapshot.ts';
import {
  connectorText,
  normaliseId,
  parseFetch,
  parseQuery,
  relationIds,
  richText,
  RELATION_TRUNCATION,
  type FetchedPage,
} from './notion.ts';
import {
  canonicalJson,
  instant,
  readAllToolCalls,
  toolMatches,
  type ToolCall,
  type TranscriptSet,
} from './transcript.ts';

// The relay (DESIGN.md §5): bp cannot authenticate to the hosted Notion connector, so it plans the exact connector calls,
// the orchestrating model makes them, and bp reads each result back out of the session transcript — no retyping.
// A pull is a small state machine persisted between invocations: overview → data sources → queries → bodies → done.

export const CONNECTOR = {
  fetch: 'notion-fetch',
  query: 'notion-query-data-sources',
  update: 'notion-update-page',
  create: 'notion-create-pages',
} as const;

/** A pull only ever reads: a planned call is a fetch or a query, whatever a saved state file says (DESIGN §5). */
const PlannedCallSchema = object({
  key: string(),
  tool: oneOf([CONNECTOR.fetch, CONNECTOR.query] as const),
  input: record(anyValue()),
});
function anyValue(): Schema<unknown> {
  return { kind: 'unknown', parse: (v: unknown) => ({ ok: true, value: v }), json: () => ({}) };
}

export const PULL_STAGES = ['overview', 'schemas', 'queries', 'bodies', 'done'] as const;
export type PullStage = (typeof PULL_STAGES)[number];

const PullStateSchema = object({
  version: integer({ min: 1, max: 1 }),
  overviewId: string(),
  deep: boolean(),
  stage: oneOf(PULL_STAGES),
  issuedAt: string(),
  pending: array(PlannedCallSchema),
  results: record(string()),
  featuresDs: nullable(string()),
  questionsDs: nullable(string()),
  featureSchema: array(string()),
  questionSchema: array(string()),
  notes: array(string()),
});

export interface PlannedCall {
  key: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface PullState {
  version: number;
  overviewId: string;
  deep: boolean;
  stage: PullStage;
  issuedAt: string;
  pending: PlannedCall[];
  results: Record<string, string>;
  featuresDs: string | null;
  questionsDs: string | null;
  featureSchema: string[];
  questionSchema: string[];
  notes: string[];
}

export function newPull(overviewId: string, issuedAt: string, deep = false): PullState {
  return {
    version: 1,
    overviewId: normaliseId(overviewId),
    deep,
    stage: 'overview',
    issuedAt,
    pending: [{ key: 'overview', tool: CONNECTOR.fetch, input: { id: normaliseId(overviewId) } }],
    results: {},
    featuresDs: null,
    questionsDs: null,
    featureSchema: [],
    questionSchema: [],
    notes: [],
  };
}

export function loadPull(path: string): PullState | undefined {
  const raw = readTextIfExists(path);
  if (raw === undefined) return undefined;
  return must(PullStateSchema, parseJson(raw, path), 'pull state');
}

export function savePull(path: string, s: PullState): void {
  writeTextAtomic(path, `${JSON.stringify(s, null, 2)}\n`);
}

/** Does a transcript call answer a planned one? Fetches match on the canonical page id; everything else on deep equality. */
/** The key a call answers under: a fetch by its page's canonical id, a query by its exact input. */
function callKey(tool: string, input: unknown): string {
  if (tool === CONNECTOR.fetch)
    return `fetch|${isRecord(input) && typeof input['id'] === 'string' ? normaliseId(input['id']) : ''}`;
  return `query|${canonicalJson(input)}`;
}

/**
 * The newest answered call per key, made at or after the floor — built once per ingest, so matching a large pull's plan
 * is linear in the transcript rather than pending × calls.
 */
function indexCalls(calls: readonly ToolCall[], floorIso: string): Map<string, ToolCall> {
  const floor = instant(floorIso);
  const index = new Map<string, ToolCall>();
  for (const c of calls) {
    if (!c.result) continue;
    const t = instant(c.timestamp);
    if (Number.isNaN(t) || (!Number.isNaN(floor) && t < floor)) continue;
    const tool = toolMatches(c.name, CONNECTOR.fetch)
      ? CONNECTOR.fetch
      : toolMatches(c.name, CONNECTOR.query)
        ? CONNECTOR.query
        : null;
    if (!tool) continue;
    const key = callKey(tool, c.input);
    const prev = index.get(key);
    if (!prev || instant(prev.timestamp) <= t) index.set(key, c);
  }
  return index;
}

export interface IngestOutcome {
  found: string[];
  missing: string[];
  errors: { key: string; text: string }[];
}

/** Move every pending call that has a result in the transcript into `results`. */
export function ingest(s: PullState, calls: readonly ToolCall[]): IngestOutcome {
  const out: IngestOutcome = { found: [], missing: [], errors: [] };
  const still: PlannedCall[] = [];
  const index = indexCalls(calls, s.issuedAt);
  for (const p of s.pending) {
    const c = index.get(callKey(p.tool, p.input));
    if (!c?.result) {
      out.missing.push(p.key);
      still.push(p);
      continue;
    }
    if (c.result.isError) {
      out.errors.push({ key: p.key, text: c.result.text.slice(0, 300) });
      still.push(p);
      continue;
    }
    s.results[p.key] = c.result.text;
    out.found.push(p.key);
  }
  s.pending = still;
  return out;
}

const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const FEATURE_COLUMNS = ['Name', 'Area', 'What it does', 'Created', 'Questions'];
const QUESTION_COLUMNS = [
  'Question',
  'Status',
  'Answer & why',
  'Why asked',
  'Suggested directions',
  'Why flagged',
  'Touches',
  'Owner',
  'Created',
  'Key',
];

function dsTitleAndSchema(result: string): { title: string; props: string[] } | null {
  const text = connectorText(result);
  const title = /The title of this Data Source is:\s*(.+)/.exec(text)?.[1]?.trim();
  const state = /<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/.exec(text)?.[1];
  let props: string[] = [];
  if (state) {
    try {
      const parsed: unknown = JSON.parse(state);
      if (isRecord(parsed) && isRecord(parsed['schema'])) props = Object.keys(parsed['schema']);
    } catch {
      props = [];
    }
  }
  return title ? { title, props } : null;
}

/** status.md S1's halt wording for a missing database; bp status tells it apart from a truncated read by this text. */
export const NOT_SET_UP = 'the Blueprint was never set up here (run /blueprint init)';

/** Advance the machine as far as the results in hand allow. Returns the pending calls (empty when done). */
export function advance(s: PullState): void {
  for (let guard = 0; guard < 8 && s.pending.length === 0 && s.stage !== 'done'; guard++) {
    switch (s.stage) {
      case 'overview': {
        const page = parseFetch(s.results['overview'] ?? '');
        if (!page) {
          s.notes.push('the overview fetch did not return a page');
          s.stage = 'done';
          break;
        }
        const sources = page.databases.map((d) => d.dataSourceUrl).filter((u): u is string => !!u);
        const unique = [...new Set(sources)];
        s.pending = unique.map((u, i) => ({ key: `ds:${i}`, tool: CONNECTOR.fetch, input: { id: u } }));
        s.stage = 'schemas';
        if (!unique.length) {
          s.notes.push(`the overview names no child database — ${NOT_SET_UP}`);
          s.stage = 'done';
        }
        break;
      }
      case 'schemas': {
        for (const [key, text] of Object.entries(s.results)) {
          if (!key.startsWith('ds:')) continue;
          const d = dsTitleAndSchema(text);
          const url = /<data-source url="\{?\{?(collection:\/\/[0-9a-f-]+)/.exec(connectorText(text))?.[1];
          if (!d || !url) continue;
          // Two data sources under one title (a linked view of another project's database, say) are never chosen
          // between silently: the read is incomplete and status halts naming both (status.md S1).
          if (d.title === 'Features') {
            if (s.featuresDs && s.featuresDs !== url)
              s.notes.push(
                `two data sources titled "Features" beneath the overview (${s.featuresDs}, ${url}) — bp will not guess which is this Blueprint's`,
              );
            s.featuresDs = s.featuresDs ?? url;
            if (s.featuresDs === url) s.featureSchema = d.props;
          } else if (d.title === 'Open Questions') {
            if (s.questionsDs && s.questionsDs !== url)
              s.notes.push(
                `two data sources titled "Open Questions" beneath the overview (${s.questionsDs}, ${url}) — bp will not guess which is this Blueprint's`,
              );
            s.questionsDs = s.questionsDs ?? url;
            if (s.questionsDs === url) s.questionSchema = d.props;
          } else if (d.title === 'Board') s.notes.push('BOARD');
        }
        const plan: PlannedCall[] = [];
        if (s.featuresDs) {
          const cols = ['url', ...FEATURE_COLUMNS.filter((c) => s.featureSchema.includes(c))];
          plan.push({
            key: 'q:features',
            tool: CONNECTOR.query,
            input: {
              data: {
                data_source_urls: [s.featuresDs],
                query: `SELECT ${cols.map((c) => (c === 'url' ? c : q(c))).join(', ')} FROM ${q(s.featuresDs)}`,
              },
            },
          });
        } else s.notes.push(`no data source titled "Features" beneath the overview — ${NOT_SET_UP}`);
        if (s.questionsDs) {
          const cols = ['url', ...s.questionSchema];
          plan.push({
            key: 'q:questions',
            tool: CONNECTOR.query,
            input: {
              data: {
                data_source_urls: [s.questionsDs],
                query: `SELECT ${cols.map((c) => (c === 'url' ? c : q(c))).join(', ')} FROM ${q(s.questionsDs)}`,
              },
            },
          });
        } else s.notes.push(`no data source titled "Open Questions" beneath the overview — ${NOT_SET_UP}`);
        s.pending = plan;
        s.stage = 'queries';
        if (!plan.length) s.stage = 'done';
        break;
      }
      case 'queries': {
        const f = parseQuery(s.results['q:features'] ?? '');
        const bodies = (f?.rows ?? [])
          .map((r) => (typeof r['url'] === 'string' ? normaliseId(r['url']) : ''))
          .filter(Boolean);
        s.pending = bodies.map((id) => ({ key: `body:${id}`, tool: CONNECTOR.fetch, input: { id } }));
        if (s.deep) {
          const qr = parseQuery(s.results['q:questions'] ?? '');
          for (const r of qr?.rows ?? []) {
            if (typeof r['url'] === 'string')
              s.pending.push({
                key: `qbody:${normaliseId(r['url'])}`,
                tool: CONNECTOR.fetch,
                input: { id: normaliseId(r['url']) },
              });
          }
        }
        s.stage = 'bodies';
        break;
      }
      case 'bodies':
        s.stage = 'done';
        break;
    }
  }
}

const asStatus = (v: unknown): { status: Status | null; raw: string } => {
  const raw = typeof v === 'string' ? v : '';
  return { status: (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null, raw }; // checked by includes
};

const DEFINED_QUESTION_PROPS = new Set([...QUESTION_COLUMNS, 'url', 'createdTime']);
const DEFINED_FEATURE_PROPS = new Set([...FEATURE_COLUMNS, 'url', 'createdTime']);

/** Build the snapshot from a finished pull. */
export function toSnapshot(s: PullState, readAt: string): Snapshot {
  const incomplete: string[] = [...s.notes.filter((n) => n !== 'BOARD')];
  const overviewPage: FetchedPage | null = parseFetch(s.results['overview'] ?? '');
  const f = parseQuery(s.results['q:features'] ?? '');
  const qr = parseQuery(s.results['q:questions'] ?? '');
  if (!f) {
    if (s.featuresDs) incomplete.push('the Features query returned nothing bp can read');
  } else if (f.hasMore)
    incomplete.push('the Features query came back with has_more: true — the database was not read in full');
  if (!qr) {
    if (s.questionsDs) incomplete.push('the Open Questions query returned nothing bp can read');
  } else if (qr.hasMore)
    incomplete.push('the Open Questions query came back with has_more: true — the database was not read in full');
  const featureAdHoc = s.featureSchema.filter((p) => !DEFINED_FEATURE_PROPS.has(p));
  const questionAdHoc = s.questionSchema.filter((p) => !DEFINED_QUESTION_PROPS.has(p));

  const features: FeatureRec[] = [];
  for (const row of f?.rows ?? []) {
    const id = typeof row['url'] === 'string' ? normaliseId(row['url']) : '';
    const bodyText = s.results[`body:${id}`];
    const page = bodyText ? parseFetch(bodyText) : null;
    if (!page) {
      incomplete.push(`the body of feature ${id} was not read`);
      continue;
    }
    // A result describing another page is not this feature's body, whatever call it answered.
    if (page.id !== id) {
      incomplete.push(`the fetch for feature ${id} returned page ${page.id} — the body of feature ${id} was not read`);
      continue;
    }
    if (page.truncated)
      incomplete.push(`the connector returned feature ${id}'s body truncated or with blocks it could not render`);
    // A relation is read from the query row, never off the page object (notion-mechanics §4): an empty cell is empty.
    const refs = relationIds(row['Questions']);
    if (refs.length >= RELATION_TRUNCATION)
      incomplete.push(
        `«${typeof row['Name'] === 'string' ? row['Name'] : id}»'s Questions relation reached ${RELATION_TRUNCATION} — read Touches from the question side (notion-mechanics §4)`,
      );
    features.push(
      makeFeature({
        id,
        name: typeof row['Name'] === 'string' ? row['Name'] : '',
        whatItDoes: richText(row['What it does']),
        area: typeof row['Area'] === 'string' ? row['Area'] : '',
        created: typeof row['Created'] === 'string' ? row['Created'] : null,
        questionRefs: refs,
        content: page.content,
        source: `transcript:${sha256(bodyText ?? '').slice(0, 12)}`,
        adHoc: featureAdHoc,
      }),
    );
  }
  const questions: Question[] = (qr?.rows ?? []).map((row) => {
    const st = asStatus(row['Status']);
    const touches = relationIds(row['Touches']);
    if (touches.length >= RELATION_TRUNCATION)
      incomplete.push(
        `«${typeof row['Question'] === 'string' ? row['Question'] : 'a question'}»'s Touches relation reached ${RELATION_TRUNCATION} — the connector may have cut it short (notion-mechanics §4)`,
      );
    return {
      id: typeof row['url'] === 'string' ? normaliseId(row['url']) : '',
      question: typeof row['Question'] === 'string' ? row['Question'] : '',
      status: st.status,
      statusRaw: st.raw,
      owner: typeof row['Owner'] === 'string' ? row['Owner'] : '',
      answer: richText(row['Answer & why']),
      whyAsked: richText(row['Why asked']),
      directions: richText(row['Suggested directions']),
      whyFlagged: richText(row['Why flagged']),
      touches,
      created: typeof row['Created'] === 'string' ? row['Created'] : null,
      adHoc: questionAdHoc,
    };
  });
  return {
    target: { kind: 'notion', address: s.overviewId },
    readAt,
    overview: overviewPage ? makeOverview(overviewPage.id, overviewPage.content, overviewPage.databases) : null,
    features,
    questions,
    incomplete,
    legacyBoard: s.notes.includes('BOARD') || (overviewPage?.databases.some((d) => d.title === 'Board') ?? false),
    hasWhyFlagged: s.questionsDs ? s.questionSchema.includes('Why flagged') : null,
  };
}

/** One step of a relay pull: ingest what the transcript holds, advance, and report what is still owed. */
export function stepPull(s: PullState, transcripts: TranscriptSet | null): { done: boolean; outcome: IngestOutcome } {
  const calls = transcripts ? readAllToolCalls(transcripts) : [];
  const outcome = transcripts ? ingest(s, calls) : { found: [], missing: s.pending.map((p) => p.key), errors: [] };
  // A model that ran ahead may already have answered every later stage: advance and ingest until a stage is still owed.
  for (let guard = 0; guard < 8 && s.pending.length === 0 && s.stage !== 'done'; guard++) {
    advance(s);
    if (!transcripts || !s.pending.length) continue;
    const more = ingest(s, calls);
    outcome.found.push(...more.found);
    outcome.missing = more.missing;
    outcome.errors.push(...more.errors);
  }
  return { done: s.stage === 'done' && s.pending.length === 0, outcome };
}
