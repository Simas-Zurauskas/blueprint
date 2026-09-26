import { join } from 'node:path';
import { exists, listDir, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { isRecord } from '../core/schema.ts';
import { CONNECTOR } from './relay.ts';
import { normaliseId } from './notion.ts';
import { canonicalJson, latestCall, type ToolCall } from './transcript.ts';

// Creating rows (targets.md §1 operation 2's row half, and every run that writes a question or a feature). On Notion
// through the relay's `notion-create-pages` call — its result carries the new page ids; on the local target by writing
// the file or the `### q-NN` section, with q-NN never reused (targets §3).

export interface NewRow {
  /** Stable key within the run, so a resumed run recognises a row it already created. */
  key: string;
  properties: Record<string, string>;
  /** The page body (a feature's body skeleton), or empty. */
  content?: string;
}

/** The connector call creating rows under a data source. One call may carry several pages. */
export function createCall(dataSource: string, rows: readonly NewRow[]) {
  return {
    tool: CONNECTOR.create,
    input: {
      parent: { type: 'data_source_id', data_source_id: dataSource.replace(/^collection:\/\//, '') },
      allow_async: false,
      pages: rows.map((r) => ({ properties: r.properties, ...(r.content ? { content: r.content } : {}) })),
    },
  };
}

/** Read the ids of created pages out of the connector's result, in the order the pages were sent. */
export function createdIds(result: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['pages'])) return null;
  return (parsed['pages'] as unknown[])
    .map((p) => (isRecord(p) && typeof p['id'] === 'string' ? normaliseId(p['id']) : ''))
    .filter(Boolean);
}

/** Find the result of a planned create call in the transcript. */
export function createResult(
  calls: readonly ToolCall[],
  call: ReturnType<typeof createCall>,
  after: string,
): { ids: string[] } | { error: string } | null {
  const c = latestCall(calls, call.tool, (input) => canonicalJson(input) === canonicalJson(call.input), after);
  if (!c?.result) return null;
  if (c.result.isError) return { error: c.result.text.slice(0, 200) };
  const ids = createdIds(c.result.text);
  if (!ids || ids.length !== call.input.pages.length)
    return { error: 'the create result carried no page id for every page sent' };
  return { ids };
}

// ---- the local target ----------------------------------------------------------------------------------------------------

/** The next unused `q-NN` in questions.md — never a reused one (targets §3). */
export function nextQuestionKey(questionsMd: string): string {
  const used = [...questionsMd.matchAll(/^###\s+q-(\d+)/gm)].map((m) => Number(m[1]));
  const n = used.length ? Math.max(...used) + 1 : 1;
  return `q-${String(n).padStart(2, '0')}`;
}

export interface LocalQuestion {
  question: string;
  status: string;
  touches: string[];
  whyAsked: string;
  directions?: string;
  created: string;
  answer?: string;
}

/** Append one question section, in q-NN order, and return its key. */
export function appendLocalQuestion(docDir: string, q: LocalQuestion): string {
  const path = join(docDir, 'questions.md');
  const text = readTextIfExists(path) ?? '';
  const key = nextQuestionKey(text);
  for (const [name, v] of Object.entries({ question: q.question, whyAsked: q.whyAsked })) {
    if (/[\r\n]/.test(v)) throw new RangeError(`a question's ${name} is one line on the local target`);
  }
  const lines = [
    `### ${key} · ${q.question}`,
    `- **Status:** ${q.status}`,
    '- **Owner:**',
    `- **Touches:** ${q.touches.join(', ')}`,
    `- **Why asked:** ${q.whyAsked}`,
    ...(q.directions ? [`- **Suggested directions:** ${q.directions}`] : []),
    `- **Created:** ${q.created}`,
    '',
    `**Answer & why:** ${q.answer?.trim() ? q.answer : '_(unanswered)_'}`,
  ];
  const next = `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${lines.join('\n')}\n`;
  writeTextAtomic(path, next);
  return key;
}

/** `NN-slug.md` for a new feature file — the next free number, a case-unique slug (targets §3's hazards). */
export function newFeatureFile(docDir: string, name: string): string {
  const dir = join(docDir, 'features');
  const files = listDir(dir).filter((f) => f.endsWith('.md'));
  const n = files.reduce((m, f) => Math.max(m, Number(/^(\d+)-/.exec(f)?.[1] ?? 0)), 0) + 1;
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'feature';
  const base = `${String(n).padStart(2, '0')}-${slug}`;
  let file = `${base}.md`;
  // Case-insensitive filesystems make Checkout.md and checkout.md one file: a clash takes a counted suffix, never chance.
  for (let k = 2; files.some((f) => f.toLowerCase() === file.toLowerCase()) || exists(join(dir, file)); k++)
    file = `${base}-${k}.md`;
  return join(dir, file);
}

/** Write a new local feature file: YAML front matter, then the body. */
export function writeLocalFeature(
  path: string,
  f: { name: string; whatItDoes: string; area: string; questions: string[]; created: string; body: string },
): void {
  const esc = (s: string): string => (/[:#[\]{}]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);
  const fm = [
    '---',
    `name: ${esc(f.name)}`,
    `what_it_does: ${esc(f.whatItDoes)}`,
    `area: ${esc(f.area)}`,
    `questions: [${f.questions.join(', ')}]`,
    `created: ${f.created}`,
    '---',
    '',
  ];
  writeTextAtomic(path, `${fm.join('\n')}\n${f.body.replace(/\s*$/, '')}\n`);
}
