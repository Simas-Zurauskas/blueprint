import type { Snapshot } from '../snapshot.ts';

// status C9's mechanical half (doc-shape.md §6: write the role, never the specific). Code decides only what it can decide
// exactly — a barred term recorded at source capture, a currency amount, a contract or deadline date — and reports the
// row, the block and the CLASS, never the value (status.md: "this report is read by the same people the rule protects
// the document from"). Names in prose are a reader's call and go to the residue task. Dated provenance lines are the
// skill's own process dates and are exempt by design (doc-shape §5 mandates them).

export interface ContentFinding {
  where: string;
  cls: 'a barred term' | 'a price or amount of money' | 'a contract or deadline date';
}

const PROVENANCE = /^\s*\*\(.*\)\*\s*$/;
const MONEY = /(?:[£$€¥]\s?\d[\d,.]*(?:\s?(?:k|m|bn))?\b|\b\d[\d,.]*\s?(?:GBP|USD|EUR|pounds?|dollars?|euros?)\b)/i;
const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
// A date is barred only when it is a contract term or deadline — the skill's own dated provenance and process tags
// ("by run 4d7fbd (2026-09-24", "(run 9f2c1a · 2026-08-14)") are process metadata and are stripped before the scan.
const CONTRACT_DATE = new RegExp(
  `\\b(?:contract(?:ed|s)?|expir(?:es|y|ing|ation)|deadline|due(?:\\s+(?:date|on|by))?|renew(?:s|al)?|terminat(?:es|ion)|SLA|notice period)\\b[^.\\n]{0,24}?(?:\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b|\\b(?:${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}\\b)`,
  'i',
);
const PROCESS_TAG = /\b(?:run|runs|batch|ledger|manifest)\s+[0-9a-f]{6}\b[^)\n]{0,40}?\d{4}-\d{2}-\d{2}/gi;

/**
 * A barred term as a whole word — "Ana" never matches "analytics" or "A manager approves" — case-insensitive, Unicode-aware.
 * Terms of two characters or fewer are too short to match safely and are skipped.
 */
function termRe(term: string, flags = 'iu'): RegExp | null {
  const t = term.trim();
  if (t.length <= 2) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, flags);
}

/** The classes a text carries, under the mechanical half of the content rule. */
export function scan(text: string, barred: readonly string[]): ContentFinding['cls'][] {
  const out = new Set<ContentFinding['cls']>();
  const lines = text
    .split('\n')
    .filter((l) => !PROVENANCE.test(l))
    .map((l) => l.replace(PROCESS_TAG, ' '));
  const body = lines.join('\n');
  if (barred.some((t) => termRe(t)?.test(body))) out.add('a barred term');
  if (MONEY.test(body)) out.add('a price or amount of money');
  if (CONTRACT_DATE.test(body)) out.add('a contract or deadline date');
  return [...out];
}

/**
 * A text with every value the rule bars replaced by its class — for any report line that quotes a row or a log line
 * (status.md: "Never print a value the content rule bars … a report that quotes the leak spreads it").
 */
export function redact(text: string, barred: readonly string[]): string {
  let out = text;
  for (const t of barred) {
    const re = termRe(t, 'giu');
    if (re) out = out.replace(re, '‹a barred term›');
  }
  out = out.replace(new RegExp(MONEY.source, 'gi'), '‹an amount›');
  out = out.replace(new RegExp(CONTRACT_DATE.source, 'gi'), '‹a contract date›');
  return out;
}

/** Every in-scope field (resolve.md R2.5's list; status C9), including everything under `record/`. The Owner property is exempt. */
export function contentFindings(
  s: Snapshot,
  record: { name: string; text: string }[],
  barred: readonly string[],
): ContentFinding[] {
  const out: ContentFinding[] = [];
  const push = (where: string, text: string): void => {
    for (const cls of scan(text, barred)) out.push({ where, cls });
  };
  for (const f of s.features) {
    // A name carrying a barred value never labels its own finding: the row is named by its id instead.
    const label = scan(f.name, barred).length ? `feature ${f.id} (its name withheld)` : `«${f.name}»`;
    push(`${label} Name`, f.name);
    push(`${label} What it does`, f.whatItDoes);
    for (const b of f.body.blocks) push(`${label} ${b.name}`, b.lines.join('\n'));
  }
  for (const q of s.questions) {
    const t =
      q.key ??
      (scan(q.question, barred).length
        ? `${q.id} (its title withheld)`
        : `«${q.question.length > 50 ? `${q.question.slice(0, 49)}…` : q.question}»`);
    push(`question ${t} title`, q.question);
    push(`question ${t} Answer & why`, q.answer);
    push(`question ${t} Why asked`, q.whyAsked);
    push(`question ${t} Suggested directions`, q.directions);
    push(`question ${t} Why flagged`, q.whyFlagged);
  }
  if (s.overview)
    for (const sec of s.overview.parsed.sections)
      if (!sec.generated) push(`overview «${sec.heading}»`, sec.lines.join('\n'));
  for (const r of record) {
    // Every class, record/ included — its verdicts are lifted from client sources (status C9). Only the entry headings
    // and the computed header and closing lines are process metadata, and are left out of the sweep.
    const swept = r.text
      .split('\n')
      .filter((l) => !/^##\s+\d{4}-\d{2}-\d{2}/.test(l) && !/^-\s+(?:header|closing):/.test(l))
      .join('\n');
    for (const cls of scan(swept, barred)) out.push({ where: r.name, cls });
  }
  return out;
}
