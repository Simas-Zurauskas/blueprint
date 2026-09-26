import { lstatSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { isNodeError } from '../core/errors.ts';
import { exists, listDir, readText, readTextIfExists } from '../core/fsx.ts';
import { lines as splitLines } from '../core/text.ts';
import { STATUSES, type Status } from '../domain/vocab.ts';
import type { Question } from '../domain/question.ts';
import { makeFeature, makeOverview, type FeatureRec, type Snapshot } from '../snapshot.ts';

// The local-markdown target (targets.md §3):
//   <dir>/README.md                the overview
//   <dir>/features/NN-slug.md      YAML-ish front matter (name, what_it_does, area, questions, created), then the body
//   <dir>/questions.md             one `### q-NN · <question>` section per question, in q-NN order
// Read-only here; the writes are local-write.ts and create.ts.

const FEATURE_KEYS = ['name', 'what_it_does', 'area', 'questions', 'created'] as const;

interface FrontMatter {
  fields: Map<string, string>;
  body: string;
}

export function splitFrontMatter(text: string): FrontMatter {
  // A byte-order mark (many Windows editors write one) is not part of the text: it would hide the front matter.
  const norm = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(norm);
  if (!m) return { fields: new Map(), body: norm };
  const fields = new Map<string, string>();
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv?.[1]) fields.set(kv[1], (kv[2] ?? '').trim());
  }
  return { fields, body: norm.slice(m[0].length).replace(/^\n+/, '') };
}

const unquote = (s: string): string => s.replace(/^(['"])(.*)\1$/, '$2');

/** `[q-04, q-07]` → ['q-04', 'q-07']. */
export function yamlList(s: string): string[] {
  const inner = /^\[(.*)\]$/.exec(s.trim())?.[1];
  const raw = inner ?? s;
  return raw
    .split(',')
    .map((x) => unquote(x.trim()))
    .filter(Boolean);
}

export function readFeatureFile(path: string, file: string): FeatureRec {
  const { fields, body } = splitFrontMatter(readText(path));
  return makeFeature({
    id: file.replace(/\.md$/, ''),
    name: unquote(fields.get('name') ?? file.replace(/^\d+-|\.md$/g, '')),
    whatItDoes: unquote(fields.get('what_it_does') ?? ''),
    area: unquote(fields.get('area') ?? ''),
    created: fields.get('created') ? unquote(fields.get('created') ?? '') : null,
    questionRefs: yamlList(fields.get('questions') ?? ''),
    content: body.replace(/\n+$/, ''),
    source: path,
    adHoc: [...fields.keys()].filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k)),
  });
}

const QUESTION_FIELDS = [
  'Status',
  'Owner',
  'Touches',
  'Why asked',
  'Suggested directions',
  'Why flagged',
  'Created',
  'Key',
] as const;

const asStatus = (s: string): Status | null => ((STATUSES as readonly string[]).includes(s) ? (s as Status) : null); // checked by includes

/** Parse `questions.md`: `### q-NN · title`, `- **Field:** value` lines (continuations indented or plain until the next field), then `**Answer & why:** …`. */
/** A question heading: `### q-NN · title` — a hyphen, dash or colon in the dot's place is read the same. */
export const QUESTION_HEADING = /^###\s+(q-\d+)\s*[·\-–—:]\s*(.*)$/;

/** What in questions.md bp could not read as a question: a `### q-NN` heading off the shape, or a key used twice. */
export function questionsFileProblems(text: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  splitLines(text.replace(/^\uFEFF/, '')).forEach((line, i) => {
    if (!/^###\s+q-\d+/.test(line)) return;
    const h = QUESTION_HEADING.exec(line);
    if (!h?.[1]) {
      problems.push(`questions.md line ${i + 1} opens a question bp cannot read: "${line.slice(0, 60)}"`);
      return;
    }
    const first = seen.get(h[1]);
    if (first !== undefined)
      problems.push(
        `questions.md uses ${h[1]} twice (lines ${first} and ${i + 1}) — a key is never reused (targets §3)`,
      );
    else seen.set(h[1], i + 1);
  });
  return problems;
}

export function parseQuestionsFile(text: string): Question[] {
  const out: Question[] = [];
  const all = splitLines(text.replace(/^\uFEFF/, ''));
  let cur: {
    key: string;
    title: string;
    fields: Map<string, string[]>;
    answer: string[] | null;
    adHoc: string[];
  } | null = null;
  let field: string | null = null;
  const flush = (): void => {
    if (!cur) return;
    const get = (k: string): string => (cur?.fields.get(k) ?? []).join('\n').trim();
    const statusRaw = get('Status');
    const answer = (cur.answer ?? []).join('\n').trim();
    out.push({
      id: cur.key,
      key: cur.key,
      question: cur.title,
      status: asStatus(statusRaw),
      statusRaw,
      owner: get('Owner'),
      answer: /^_\(unanswered\)_$/.test(answer) ? '' : answer,
      whyAsked: get('Why asked'),
      directions: get('Suggested directions'),
      whyFlagged: get('Why flagged'),
      touches: get('Touches')
        .split(/\s*[,·]\s*/)
        .map((t) => t.replace(/^«|»$/g, '').trim())
        .filter(Boolean),
      created: get('Created') || null,
      adHoc: cur.adHoc,
    });
  };
  for (const line of all) {
    const h = QUESTION_HEADING.exec(line);
    if (h?.[1]) {
      flush();
      cur = { key: h[1], title: (h[2] ?? '').trim(), fields: new Map(), answer: null, adHoc: [] };
      field = null;
      continue;
    }
    if (!cur) continue;
    const ans = /^\*\*Answer & why:\*\*\s*(.*)$/.exec(line);
    if (ans) {
      cur.answer = [ans[1] ?? ''];
      field = null;
      continue;
    }
    if (cur.answer) {
      cur.answer.push(line);
      continue;
    }
    const f = /^- \*\*([^*]+?):\*\*\s*(.*)$/.exec(line);
    if (f?.[1]) {
      field = f[1];
      if (!(QUESTION_FIELDS as readonly string[]).includes(field)) cur.adHoc.push(field);
      cur.fields.set(field, [f[2] ?? '']);
      continue;
    }
    if (field && line.trim()) cur.fields.get(field)?.push(line.trim());
  }
  flush();
  return out;
}

export function readLocal(dir: string, readAt: string): Snapshot {
  const incomplete: string[] = [];
  const readme = lstatIfExists(join(dir, 'README.md'))?.isSymbolicLink()
    ? undefined
    : readTextIfExists(join(dir, 'README.md'));
  if (readme === undefined) incomplete.push(`${join(dir, 'README.md')} is missing — the overview could not be read`);
  const featuresDir = join(dir, 'features');
  if (!exists(featuresDir)) incomplete.push(`${featuresDir} is missing`);
  // Features in the order of their numeric prefix — 99-… before 100-… — then by name (targets §3: deterministic order).
  const num = (f: string): number => Number(/^(\d+)-/.exec(f)?.[1] ?? Number.MAX_SAFE_INTEGER);
  // Only plain files inside the folder are the Blueprint: a symbolic link (git keeps them) could pull any file on the
  // machine into a report, a brief or a write.
  const plain = (path: string): boolean => {
    const st = lstatIfExists(path);
    if (st && !st.isFile()) {
      incomplete.push(
        `${path} is ${st.isSymbolicLink() ? 'a symbolic link' : 'not a plain file'} — bp reads only plain files inside the Blueprint's folder`,
      );
      return false;
    }
    return true;
  };
  const features = listDir(featuresDir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0))
    .filter((f) => plain(join(featuresDir, f)))
    .map((f) => readFeatureFile(join(featuresDir, f), f));
  const qPath = join(dir, 'questions.md');
  const qText = plain(qPath) ? readTextIfExists(qPath) : undefined;
  if (qText === undefined && !incomplete.some((x) => x.startsWith(qPath))) incomplete.push(`${qPath} is missing`);
  if (qText !== undefined) incomplete.push(...questionsFileProblems(qText));
  return {
    target: { kind: 'local', address: dir },
    readAt,
    overview: readme === undefined ? null : makeOverview('README.md', readme),
    features,
    questions: qText === undefined ? [] : parseQuestionsFile(qText),
    incomplete,
    legacyBoard: false,
    hasWhyFlagged: null,
  };
}

function lstatIfExists(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return undefined;
    throw err;
  }
}
