import { localDate } from '../core/clock.ts';
import { hasNumberedRequirement, type ParsedBody } from '../domain/feature.ts';
import type { Question } from '../domain/question.ts';
import type { FeatureRec, Snapshot } from '../snapshot.ts';

// `bp render` — the Blueprint for people to read (DESIGN.md §7). Always assembled from a snapshot, never stored, so it
// cannot go stale (doc-shape §10: "assembled, never authored"). Deterministic: the same snapshot renders the same bytes.

export const FORMATS = ['md', 'txt', 'json', 'html'] as const;
export type Format = (typeof FORMATS)[number];

const LIVE: readonly string[] = ['Open', 'Answered', 'Flagged'];
const DECIDED: readonly string[] = ['Applied', 'Rejected', 'Closed (not applied)'];

/**
 * Target escapes and tags out, for a human reader: `\[` → `[`, `<br>` → newline, Notion mentions → their URL. Code
 * fences are left exactly as written — a mermaid label uses `<br>` on purpose.
 */
export function readable(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\([[\]*_`#<>])/g, '$1')
            .replace(/<br\s*\/?>/g, '\n')
            .replace(
              /<mention-page url="([^"]+)"\s*\/?>(?:([^<]*)<\/mention-page>)?/g,
              (_m, url: string, t?: string) => (t ? `${t} (${url})` : url),
            )
            .replace(/<database[^>]*>[^<]*<\/database>\n?/g, ''),
    )
    .join('');
}

/** The read-out line every read path prepends before a body (targets §4). */
export const readOut = (f: FeatureRec): string => `«${f.name}» · ${f.area}`;

const byArea = (s: Snapshot): Map<string, FeatureRec[]> => {
  const m = new Map<string, FeatureRec[]>();
  for (const f of [...s.features].sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))) {
    m.set(f.area || '(no area)', [...(m.get(f.area || '(no area)') ?? []), f]);
  }
  return m;
};

/** Questions by the features they touch (by id and by name), built once per snapshot: a render stays linear in rows. */
const byTouch = new WeakMap<Snapshot, Map<string, Question[]>>();
const touching = (s: Snapshot, f: FeatureRec): Question[] => {
  let index = byTouch.get(s);
  if (!index) {
    const built = new Map<string, Question[]>();
    for (const q of s.questions) for (const t of new Set(q.touches)) built.set(t, [...(built.get(t) ?? []), q]);
    byTouch.set(s, built);
    index = built;
  }
  const byId = index.get(f.id) ?? [];
  const byName = index.get(f.name) ?? [];
  if (!byName.length || byName === byId) return byId;
  // Both keys hit: merge, each question once, in the snapshot's order (each list is already in that order).
  const seen = new Set(byId);
  const order = new Map(s.questions.map((q, i) => [q, i] as const));
  return [...byId, ...byName.filter((q) => !seen.has(q))].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
};

const bodyWithoutProvenance = (b: ParsedBody, raw: string): string =>
  raw
    .split('\n')
    .filter((l) => !/^\s*\*\(.*\)\*\s*$/.test(l))
    .join('\n')
    .trim() + (hasNumberedRequirement(b) ? '' : '');

function featureMd(s: Snapshot, f: FeatureRec, level: number, opts: { provenance: boolean }): string {
  const h = '#'.repeat(level);
  const body = readable(opts.provenance ? f.content : bodyWithoutProvenance(f.body, f.content)).replace(
    /^## /gm,
    `${h}# `,
  );
  const open = touching(s, f).filter((q) => q.status !== null && LIVE.includes(q.status));
  const lines = [`${h} ${f.name}`, '', `*${readOut(f)}*`, '', `> ${readable(f.whatItDoes)}`, '', body];
  if (open.length) {
    lines.push('', `${h}# Not decided yet`, ...open.map((q) => `- ${q.question} — *${q.status ?? q.statusRaw}*`));
  }
  return lines.join('\n');
}

function overviewMd(s: Snapshot): string {
  if (!s.overview) return '';
  const out: string[] = [];
  for (const sec of s.overview.parsed.sections) {
    if (sec.generated) continue;
    out.push(`## ${sec.heading}`, '', readable(sec.lines.join('\n')).trim(), '');
  }
  return out.join('\n');
}

function questionMd(q: Question): string {
  const lines = [
    `### ${q.question}`,
    '',
    `*${q.status ?? q.statusRaw}${q.created ? ` · raised ${q.created.slice(0, 10)}` : ''}*`,
  ];
  if (q.whyAsked) lines.push('', `**Why asked.** ${readable(q.whyAsked)}`);
  if (q.directions && q.status === 'Open')
    lines.push(
      '',
      `**Suggested directions** (not a source — answer in your own words, or name one by its number):`,
      '',
      readable(q.directions),
    );
  if (q.answer) lines.push('', `**Answer & why.** ${readable(q.answer)}`);
  return lines.join('\n');
}

export interface RenderOptions {
  title: string;
  feature?: string;
  questions?: 'open' | 'all' | 'none';
  provenance?: boolean;
}

/** The read's calendar date where it was read — content dates are local wall-clock, never the UTC date (clock.ts). */
const assembled = (s: Snapshot): string => localDate(new Date(s.readAt));

export function renderMarkdown(s: Snapshot, o: RenderOptions): string {
  const provenance = o.provenance ?? false;
  if (o.feature) {
    const f = findFeature(s, o.feature);
    return `${featureMd(s, f, 1, { provenance })}\n`;
  }
  const out: string[] = [
    `# ${o.title} — product definition`,
    '',
    `*Assembled from the Blueprint on ${assembled(s)} — ${s.features.length} features, ${s.questions.filter((q) => q.status !== null && LIVE.includes(q.status)).length} questions still open. This is a reading view; the Blueprint is the source.*`,
    '',
  ];
  out.push(overviewMd(s));
  out.push('## Features', '');
  for (const [area, fs] of byArea(s)) {
    out.push(`### ${area}`, '', ...fs.map((f) => `- ${f.name} — ${readable(f.whatItDoes)}`), '');
  }
  for (const [, fs] of byArea(s)) for (const f of fs) out.push(featureMd(s, f, 3, { provenance }), '');
  const mode = o.questions ?? 'open';
  if (mode !== 'none') {
    const qs = s.questions
      .filter((q) => mode === 'all' || (q.status !== null && LIVE.includes(q.status)))
      .sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
    out.push(mode === 'all' ? '## Questions and decisions' : '## Open questions', '');
    if (!qs.length) out.push('*None.*', '');
    for (const q of qs) out.push(questionMd(q), '');
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export function findFeature(s: Snapshot, ref: string): FeatureRec {
  const f =
    s.features.find((x) => x.id === ref || x.name === ref) ??
    s.features.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!f) throw new RangeError(`no feature named "${ref}" — features are: ${s.features.map((x) => x.name).join(', ')}`);
  return f;
}

/** doc-shape §10 — the build packet: assembled at build time, never stored; its two labelled negatives are the point. */
export function renderPacket(s: Snapshot, ref: string): string {
  const f = findFeature(s, ref);
  // The NOT-clause is a sentence of the paragraph: a marker or provenance line under it is never part of one.
  const what = (s.overview?.parsed.block('What this product is')?.lines ?? []).filter(
    (l) => l.trim() && !/NEEDS CLARIFICATION|^\s*\*\(.*\)\*\s*$/.test(l),
  );
  const sentences = readable(what.join(' ').trim()).split(/(?<=[.!?])\s+(?=\*{0,2}[A-Z])/);
  const notClause =
    [...sentences].reverse().find((x) => /\bnot\b|\bnever\b|\bno\b/i.test(x)) ?? '(the overview carries no NOT-clause)';
  const block = (name: string): string => {
    const b = f.body.blocks.find((x) => x.known === name);
    return b ? readable(b.lines.filter((l) => !/^\s*\*\(.*\)\*\s*$/.test(l)).join('\n')).trim() : '';
  };
  const open = touching(s, f).filter((q) => q.status !== null && LIVE.includes(q.status));
  const markers = f.body.markers.map((m) => `- ${readable(m.raw)}`);
  const lines = [
    `BUILD PACKET — «${f.name}»           assembled ${assembled(s)} from the Blueprint`,
    readOut(f),
    '',
    'WHAT THIS PRODUCT IS NOT',
    notClause.trim(),
    '',
    'NOT DOING, HERE',
    block('Not doing') || '(none written)',
    '',
    'BUILD THIS',
    block('Behaviour') || '(no numbered requirement yet — this is a title, not a spec)',
    '',
    'NOT DECIDED — do not invent. If your work touches one of these, stop and ask',
    ...(open.length || markers.length
      ? [...open.map((q) => `- ${q.question} (${q.status ?? q.statusRaw})`), ...markers]
      : ['(nothing open bears on this feature)']),
    '',
    'CALLS ALREADY MADE',
    block('Rabbit holes') || '(none)',
    '',
    'CONTEXT',
    readable(f.whatItDoes),
    '',
    block('Why'),
  ];
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export function renderText(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, (_m, t: string) => `${t.toUpperCase()}\n${'='.repeat(Math.min(t.length, 80))}`)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 <$2>')
    .replace(/^> /gm, '  ');
}

export function renderJson(s: Snapshot, o: RenderOptions): string {
  const feature = (f: FeatureRec) => ({
    id: f.id,
    name: f.name,
    area: f.area,
    whatItDoes: readable(f.whatItDoes),
    requirements: f.body.requirements.map((r) => ({
      n: r.n,
      text: readable(r.text),
      withdrawn: r.withdrawn,
      depth: r.depth,
    })),
    blocks: Object.fromEntries(f.body.blocks.map((b) => [b.name, readable(b.lines.join('\n')).trim()])),
    markers: f.body.markers.map((m) => ({ block: m.block, fr: m.fr ?? null, text: readable(m.inner) })),
    openQuestions: touching(s, f)
      .filter((q) => q.status !== null && LIVE.includes(q.status))
      .map((q) => q.id),
    bodySha12: f.hash12 ?? null,
  });
  const features = o.feature
    ? [findFeature(s, o.feature)]
    : [...s.features].sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
  const out = {
    title: o.title,
    readAt: s.readAt,
    overview: s.overview
      ? Object.fromEntries(
          s.overview.parsed.sections
            .filter((x) => !x.generated)
            .map((x) => [x.heading, readable(x.lines.join('\n')).trim()]),
        )
      : null,
    features: features.map(feature),
    questions: s.questions
      .filter((q) => (o.questions ?? 'open') === 'all' || (q.status !== null && LIVE.includes(q.status)))
      .map((q) => ({
        id: q.key ?? q.id,
        question: q.question,
        status: q.status ?? q.statusRaw,
        whyAsked: readable(q.whyAsked),
        answer: readable(q.answer),
        touches: q.touches,
        created: q.created,
      })),
    decided: s.questions.filter((q) => q.status !== null && DECIDED.includes(q.status)).length,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown → HTML for the handful of constructs a Blueprint uses. Everything is escaped first; nothing is passed through. */
export function markdownToHtml(md: string): string {
  const inline = (t: string): string =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  let list = false;
  let fence = false;
  const closeList = (): void => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      closeList();
      out.push(fence ? '</code></pre>' : '<pre><code>');
      fence = !fence;
      continue;
    }
    if (fence) {
      out.push(esc(line));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!li) closeList();
    if (h?.[1] && h[2] !== undefined) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (li?.[1] !== undefined) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.startsWith('> ')) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (fence) out.push('</code></pre>');
  return out.join('\n');
}

export function renderHtml(md: string, title: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b6862;--rule:#e4e0d8;--accent:#8a4b1f}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ecebe8;--muted:#a19d96;--rule:#34312d;--accent:#e0a36f}}
body{background:var(--bg);color:var(--fg);font:16px/1.6 ui-serif,Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem}
h1,h2,h3,h4{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.25}h2{border-top:1px solid var(--rule);padding-top:1.5rem;margin-top:2.5rem}
blockquote{color:var(--muted);margin:0 0 1rem;padding-left:1rem;border-left:3px solid var(--rule)}a{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}pre{overflow-x:auto;background:var(--rule);padding:.75rem}
em{color:var(--muted)}li{margin:.2rem 0}
</style></head><body>
${markdownToHtml(md)}
</body></html>
`;
}
