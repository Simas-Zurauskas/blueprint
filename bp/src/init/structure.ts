import { STATUSES } from '../domain/vocab.ts';
import { normaliseId } from '../target/notion.ts';
import type { Snapshot } from '../snapshot.ts';

// init.md I4 — the structure, exactly as spec/databases.md writes it: two databases under the overview with every
// property and every select option (including options no row uses yet), and the four saved views. On Notion these are
// connector calls bp plans and reads back; on a local folder, the layout of targets §3.

const COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray'] as const;
const quote = (s: string): string => s.replace(/'/g, "''");

/** Features (databases.md §1): Name, What it does, Area (the skeleton's Areas), Created — Questions comes from the relation. */
export function featuresDdl(areas: readonly string[]): string {
  const opts = areas.map((a, i) => `'${quote(a)}':${COLORS[i % COLORS.length] ?? 'default'}`).join(', ');
  return `CREATE TABLE ("Name" TITLE, "What it does" RICH_TEXT, "Area" SELECT(${opts || "'General':gray"}), "Created" CREATED_TIME)`;
}

/** Open Questions (databases.md §2): ten properties less the retired Key; Touches two-way to Features as `Questions`. */
export function questionsDdl(featuresDs: string): string {
  const status = STATUSES.map(
    (s, i) => `'${quote(s)}':${['gray', 'blue', 'green', 'red', 'brown', 'default'][i] ?? 'default'}`,
  ).join(', ');
  return `CREATE TABLE ("Question" TITLE, "Owner" PEOPLE, "Answer & why" RICH_TEXT, "Why asked" RICH_TEXT, "Suggested directions" RICH_TEXT, "Why flagged" RICH_TEXT, "Touches" RELATION('${featuresDs.replace(/^collection:\/\//, '')}', DUAL 'Questions'), "Status" SELECT(${status}), "Created" CREATED_TIME)`;
}

/** The four saved views (databases.md §6). */
export const VIEWS = [
  { db: 'features', name: 'Where things are', configure: 'GROUP BY "Area"; SHOW "Name", "What it does", "Area"' },
  {
    db: 'questions',
    name: 'Unsent — packet candidates',
    configure:
      'FILTER "Status" = "Open"; SORT BY "Created" ASC; SHOW "Question", "Why asked", "Suggested directions", "Touches"',
  },
  { db: 'questions', name: 'Open questions', configure: 'FILTER "Status" IN ("Open", "Answered"); GROUP BY "Status"' },
  {
    db: 'questions',
    name: 'Decision log',
    configure: 'FILTER "Status" IN ("Applied", "Closed (not applied)", "Rejected"); SORT BY "Created" DESC',
  },
] as const;

const uuid = (x: string): string =>
  x.length === 32 ? `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}` : x;

/** The ids a create-database result carries: its data source (`<data-source url="collection://…">`), and the database
 * page when the result names it — otherwise the overview's re-read supplies it (I4's verification pull). */
export function createdDatabase(result: string): { db: string | null; ds: string } | null {
  let text = result;
  try {
    const v: unknown = JSON.parse(result);
    if (v && typeof v === 'object' && 'text' in v && typeof v.text === 'string') text = v.text; // the connector's JSON envelope
  } catch {
    // plain text result
  }
  const ds = /collection:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/.exec(
    text,
  )?.[1];
  if (!ds) return null;
  const db = /<database[^>]*\burl="[^"]*?([0-9a-f]{32}|[0-9a-f-]{36})"/.exec(text)?.[1] ?? null;
  return { db: db ? normaliseId(db) : null, ds: `collection://${uuid(ds)}` };
}

/** The child databases a page's content names: `<database url="…" data-source-url="collection://…">Title</database>`. */
export function databaseTags(content: string): { tag: string; db: string; ds: string | null; title: string }[] {
  return [...content.matchAll(/<database url="([^"]+)"([^>]*)>([^<]*)<\/database>/g)].map((m) => {
    const id =
      /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(m[1] ?? '')?.[1] ?? '';
    const ds = /data-source-url="\{?\{?(collection:\/\/[0-9a-f-]+)/.exec(m[2] ?? '')?.[1] ?? null;
    return { tag: m[0], db: id ? normaliseId(id) : '', ds, title: (m[3] ?? '').trim() };
  });
}

/** The local target's ⟳ lists (targets §3): features by Area, live questions by Status — regenerated whole, never patched. */
export function localViews(s: Snapshot): { where: string; open: string } {
  const areas = [...new Set(s.features.map((f) => f.area || '(no Area)'))];
  const where = areas
    .flatMap((a) => [
      `### ${a}`,
      ...s.features
        .filter((f) => (f.area || '(no Area)') === a)
        .map((f) => `- [${f.name}](features/${f.id}.md) — ${f.whatItDoes}`),
    ])
    .join('\n');
  const live = ['Open', 'Answered'] as const;
  const open = live
    .map((st) => {
      const rows = s.questions.filter((q) => q.status === st);
      return rows.length ? [`### ${st}`, ...rows.map((q) => `- ${q.key ?? ''} · ${q.question}`)].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n');
  return { where: where || '_(no features yet)_', open: open || '_(nothing open)_' };
}

/** Regenerate a local README's two ⟳ sections whole from the rows (doc-shape §3: typed text under a ⟳ heading is never
 * kept, and the lists are views, rebuilt, never patched). Returns the new text, or null when there is nothing to change. */
export function regenerateLocalViews(readme: string, s: Snapshot): string | null {
  const views = localViews(s);
  const lines = readme.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    const which = /^##\s+⟳\s+Where things are/.test(l)
      ? views.where
      : /^##\s+⟳\s+Open questions/.test(l)
        ? views.open
        : null;
    out.push(l);
    if (which === null) continue;
    out.push(which, '');
    while (i + 1 < lines.length && !/^##\s/.test(lines[i + 1] ?? '')) i++;
  }
  const next = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return next === readme ? null : next;
}
