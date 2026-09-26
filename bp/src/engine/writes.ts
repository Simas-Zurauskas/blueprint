import { join } from 'node:path';
import { blockText, hashBody, sha12, type Sha12 } from '../core/hash.ts';
import { readTextIfExists } from '../core/fsx.ts';
import { appendLocalQuestion, createCall, createResult, newFeatureFile, writeLocalFeature } from '../target/create.ts';
import { writeLocalBlock, setLocalQuestionFields } from '../target/local-write.ts';
import { splitFrontMatter } from '../target/local.ts';
import { normaliseId, parseFetch, richText } from '../target/notion.ts';
import { advanceWrite, fetchCall, type PushItemState, type StagedBlockWrite } from '../target/push.ts';
import { CONNECTOR } from '../target/relay.ts';
import { canonicalJson, latestCall, type ToolCall } from '../target/transcript.ts';
import type { Owed } from './state.ts';

// The one serial commit path (SKILL.md rule 8(ii); targets.md operation 8) for add, challenge and init: each write in
// order, one at a time — a block rewritten after a fresh fetch and a diff and read back, a row created and its id read
// out of the result, a property set and read back. A block write's text is built at the moment it runs, from the body
// as the last write left it, so two writes to one page never plan against stale text.

interface Base {
  key: string;
  stage: 'plan' | 'run' | 'done';
  plannedAt: string;
  outcome?: { kind: 'landed' | 'conflict' | 'refused' | 'skipped'; detail?: string; bodyHash?: string };
}

/** A change to one named block (or a span), prepared by the command from the page's current text when it runs. */
export interface BlockWrite extends Base {
  kind: 'block';
  /** The page: a feature (by its key in the run's page map) or the overview. */
  page: string;
  label: string;
  /** What the command's `prepare` reads to build the text — opaque to the executor. */
  spec: unknown;
  block?: string;
  through?: string;
  before?: string;
  after?: string;
  push?: unknown;
}

export interface CreateFeature extends Base {
  kind: 'create-feature';
  name: string;
  area: string;
  whatItDoes: string;
  body: string;
  created: string;
  id?: string;
}

export interface CreateQuestion extends Base {
  kind: 'create-question';
  question: string;
  status: string;
  whyAsked: string;
  directions?: string;
  answer?: string;
  /** Features by page key (an existing feature's id, or a create-feature write's key). */
  touches: string[];
  created: string;
  id?: string;
}

export interface SetProps extends Base {
  kind: 'props';
  /** A question row by page key. */
  page: string;
  fields: Record<string, string>;
}

export type Write = BlockWrite | CreateFeature | CreateQuestion | SetProps;

export interface WriteEnv {
  targetKind: 'notion' | 'local';
  /** Local: the document folder. */
  docDir?: string;
  nowIso: string;
  calls: readonly ToolCall[];
  /** Notion: the two data sources (collection://…), for row creation. */
  featuresDs?: string | null;
  questionsDs?: string | null;
}

/** Pages this run knows: a key (a feature's id, a create's key, 'overview') → its target address and current content. */
export interface Pages {
  address: Record<string, string>;
  /** Features and questions by display name, for local Touches. */
  name: Record<string, string>;
  content: Record<string, string>;
}

export type Prepared =
  { block: string; through?: string; before: string; after: string } | { skip: string } | { error: string };

export interface Landed {
  write: Write;
  /** The body hash after a block write lands, or of a created feature's body. */
  bodyHash?: Sha12 | 'none';
}

const hashOf = (content: string): Sha12 | 'none' => {
  const h = hashBody(content);
  return h ? sha12(h) : 'none';
};

const notionUrl = (id: string): string => `https://app.notion.com/p/${normaliseId(id)}`;

/**
 * Run the queue as far as the transcript allows. Returns the writes that finished this call (for their log lines) and
 * leaves what is owed in `owed`. Stops at the first write still waiting — the path is serial.
 */
export function runWrites(
  queue: Write[],
  pages: Pages,
  env: WriteEnv,
  prepare: (w: BlockWrite, current: string) => Prepared,
  owed: Owed,
): Landed[] {
  const landed: Landed[] = [];
  for (const w of queue) {
    if (w.stage === 'done') continue;
    if (!w.plannedAt) w.plannedAt = env.nowIso;
    const done = step(w, pages, env, prepare, owed);
    if (!done) break;
    landed.push(done);
  }
  return landed;
}

function step(
  w: Write,
  pages: Pages,
  env: WriteEnv,
  prepare: (w: BlockWrite, current: string) => Prepared,
  owed: Owed,
): Landed | null {
  switch (w.kind) {
    case 'block':
      return stepBlock(w, pages, env, prepare, owed);
    case 'create-feature':
      return stepCreateFeature(w, pages, env, owed);
    case 'create-question':
      return stepCreateQuestion(w, pages, env, owed);
    case 'props':
      return stepProps(w, pages, env, owed);
  }
}

const finish = (w: Write, outcome: NonNullable<Base['outcome']>, bodyHash?: Sha12 | 'none'): Landed => {
  w.stage = 'done';
  w.outcome = outcome;
  return { write: w, ...(bodyHash ? { bodyHash } : {}) };
};

function stepBlock(
  w: BlockWrite,
  pages: Pages,
  env: WriteEnv,
  prepare: (w: BlockWrite, current: string) => Prepared,
  owed: Owed,
): Landed | null {
  const address = pages.address[w.page];
  if (!address) return finish(w, { kind: 'refused', detail: `no page ${w.page} is known to this run` });
  if (w.stage === 'plan') {
    const current = pages.content[w.page] ?? '';
    const p = prepare(w, current);
    if ('skip' in p) return finish(w, { kind: 'skipped', detail: p.skip });
    if ('error' in p) return finish(w, { kind: 'refused', detail: p.error });
    if (p.before.replace(/\s+$/, '') === p.after.replace(/\s+$/, ''))
      return finish(w, { kind: 'skipped', detail: 'the page already says it' });
    w.block = p.block;
    if (p.through) w.through = p.through;
    w.before = p.before;
    w.after = p.after;
    w.stage = 'run';
    w.plannedAt = env.nowIso;
    const write: StagedBlockWrite = {
      key: w.key,
      page: address,
      label: w.label,
      block: p.block,
      ...(p.through ? { through: p.through } : {}),
      before: p.before,
      after: p.after,
    };
    w.push = { write, stage: 'fetch', plannedAt: env.nowIso } satisfies PushItemState;
  }
  const push = w.push as PushItemState;
  let result;
  if (env.targetKind === 'local') {
    result = writeLocalBlock(address, push.write.block, push.write.before, push.write.after, push.write.through);
  } else {
    const call = advanceWrite(push, env.calls, env.nowIso);
    if (call) {
      owed.calls.push(call.call);
      return null;
    }
    result = push.outcome;
  }
  if (!result) return null;
  if (result.kind === 'conflict') return finish(w, { kind: 'conflict', detail: result.current });
  if (result.kind === 'refused') return finish(w, { kind: 'refused', detail: result.reason });
  pages.content[w.page] = result.content ?? (pages.content[w.page] ?? '').replace(push.write.before, push.write.after);
  return finish(w, { kind: 'landed', bodyHash: result.bodyHash }, result.bodyHash);
}

function stepCreateFeature(w: CreateFeature, pages: Pages, env: WriteEnv, owed: Owed): Landed | null {
  if (env.targetKind === 'local') {
    if (!env.docDir) return finish(w, { kind: 'refused', detail: 'no document folder' });
    const path = newFeatureFile(env.docDir, w.name);
    writeLocalFeature(path, {
      name: w.name,
      whatItDoes: w.whatItDoes,
      area: w.area,
      questions: [],
      created: w.created,
      body: w.body,
    });
    const back = splitFrontMatter(readTextIfExists(path) ?? '').body.replace(/\n+$/, '');
    w.id = path.replace(/^.*\/features\//, '').replace(/\.md$/, '');
    pages.address[w.key] = path;
    pages.address[w.id] = path;
    pages.content[w.key] = back;
    pages.name[w.name] = w.key;
    return finish(w, { kind: 'landed', bodyHash: hashOf(back) }, hashOf(back));
  }
  if (!env.featuresDs) return finish(w, { kind: 'refused', detail: 'the Features data source is not known' });
  const call = createCall(env.featuresDs, [
    { key: w.key, properties: { Name: w.name, Area: w.area, 'What it does': w.whatItDoes }, content: w.body },
  ]);
  const r = createResult(env.calls, call, w.plannedAt);
  if (!r) {
    owed.calls.push(call);
    return null;
  }
  if ('error' in r) return finish(w, { kind: 'refused', detail: r.error });
  w.id = r.ids[0] ?? '';
  pages.address[w.key] = w.id;
  pages.content[w.key] = w.body;
  pages.name[w.name] = w.key;
  return finish(w, { kind: 'landed', bodyHash: hashOf(w.body) }, hashOf(w.body));
}

/**
 * A Touches entry as a key of `pages`: a key already, or a feature named the way a task wrote it — «Name», «Name» FR-6,
 * name in any case. One the name cannot resolve stays as given, and a feature named twice is touched once.
 */
export function touchKeys(touches: readonly string[], pages: Pages): string[] {
  const bare = (t: string): string =>
    t
      .replace(/[«»]/g, '')
      .replace(/\s+(?:FR|EC|ND|RH)-\d+\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const byName = new Map(Object.entries(pages.name).map(([n, k]) => [bare(n), k]));
  const keys = touches.map((t) => (pages.address[t] !== undefined ? t : (byName.get(bare(t)) ?? t)));
  return [...new Set(keys)];
}

function stepCreateQuestion(w: CreateQuestion, pages: Pages, env: WriteEnv, owed: Owed): Landed | null {
  w.touches = touchKeys(w.touches, pages);
  const touches = w.touches.map((k) => pages.address[k] ?? k);
  if (env.targetKind === 'local') {
    if (!env.docDir) return finish(w, { kind: 'refused', detail: 'no document folder' });
    // Local Touches names the feature (targets §3); a created feature is named by the name it was created with.
    const names = w.touches.map((k) => Object.entries(pages.name).find(([, key]) => key === k)?.[0] ?? k);
    const key = appendLocalQuestion(env.docDir, {
      question: w.question,
      status: w.status,
      touches: names,
      whyAsked: w.whyAsked.split('\n')[0] ?? '',
      ...(w.directions ? { directions: w.directions.replace(/\n/g, '<br>') } : {}),
      created: w.created,
      ...(w.answer ? { answer: w.answer } : {}),
    });
    // A multi-line Why asked (a proposal appended to it) continues on indented lines, as the reader expects.
    if (w.whyAsked.includes('\n'))
      setLocalQuestionFields(join(env.docDir, 'questions.md'), key, { 'Why asked': w.whyAsked });
    w.id = key;
    pages.address[w.key] = key;
    return finish(w, { kind: 'landed' });
  }
  if (!env.questionsDs) return finish(w, { kind: 'refused', detail: 'the Open Questions data source is not known' });
  const properties: Record<string, string> = {
    Question: w.question,
    Status: w.status,
    'Why asked': w.whyAsked,
    ...(w.directions ? { 'Suggested directions': w.directions } : {}),
    ...(w.answer ? { 'Answer & why': w.answer } : {}),
    ...(touches.length ? { Touches: JSON.stringify(touches.map(notionUrl)) } : {}),
  };
  const call = createCall(env.questionsDs, [{ key: w.key, properties }]);
  const r = createResult(env.calls, call, w.plannedAt);
  if (!r) {
    owed.calls.push(call);
    return null;
  }
  if ('error' in r) return finish(w, { kind: 'refused', detail: r.error });
  w.id = r.ids[0] ?? '';
  pages.address[w.key] = w.id;
  return finish(w, { kind: 'landed' });
}

const updateProps = (page: string, properties: Record<string, string>) => ({
  tool: CONNECTOR.update,
  input: { page_id: normaliseId(page), command: 'update_properties', allow_async: false, properties },
});

function stepProps(w: SetProps, pages: Pages, env: WriteEnv, owed: Owed): Landed | null {
  const address = pages.address[w.page] ?? w.page;
  if (env.targetKind === 'local') {
    if (!env.docDir) return finish(w, { kind: 'refused', detail: 'no document folder' });
    const r = setLocalQuestionFields(join(env.docDir, 'questions.md'), address, w.fields);
    return finish(w, r.ok ? { kind: 'landed' } : { kind: 'refused', detail: r.reason });
  }
  if (w.stage === 'plan') {
    w.stage = 'run';
    w.plannedAt = env.nowIso;
  }
  const call = updateProps(address, w.fields);
  const wrote = latestCall(
    env.calls,
    call.tool,
    (input) => canonicalJson(input) === canonicalJson(call.input),
    w.plannedAt,
  );
  if (!wrote?.result) {
    owed.calls.push(call);
    return null;
  }
  if (wrote.result.isError) return finish(w, { kind: 'refused', detail: wrote.result.text.slice(0, 160) });
  const read = latestCall(
    env.calls,
    CONNECTOR.fetch,
    (input) =>
      typeof input === 'object' &&
      input !== null &&
      'id' in input &&
      typeof input.id === 'string' &&
      normaliseId(input.id) === normaliseId(address),
    wrote.timestamp,
  );
  if (!read?.result) {
    owed.calls.push(fetchCall(address));
    return null;
  }
  const got = parseFetch(read.result.text)?.properties ?? {};
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const bad = Object.entries(w.fields).filter(([k, v]) => clean(richText(got[k] ?? '')) !== clean(v));
  return finish(
    w,
    bad.length
      ? { kind: 'refused', detail: `did not read back: ${bad.map(([k]) => k).join(', ')}` }
      : { kind: 'landed' },
  );
}

/** The current text of a block on a page this run knows. */
export const blockOf = (pages: Pages, page: string, block: string): string | undefined =>
  blockText(pages.content[page] ?? '', block);
