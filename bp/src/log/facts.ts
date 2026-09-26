import { normaliseId } from '../target/notion.ts';
import type { ParsedEntry, ParsedLog } from './parse.ts';

// Facts the checks read back out of the record (status.md S1 step 4: the log is the only source for when a question was
// flagged, and for what a later check reads back). Read from any generation of the log; a fact a legacy line does not
// state is absent, never guessed.

const ROW_ID_RE = /`([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})`/g;
// A title may nest one «…» (a question quoting a feature's name); bounded so no line can make it backtrack.
const TITLE_RE = /«([^«»]{1,400}(?:«[^«»]{0,200}»[^«»]{0,400}){0,4})»/;

export const rowIdsIn = (text: string): string[] => [...text.matchAll(ROW_ID_RE)].map((m) => normaliseId(m[1] ?? ''));

export interface Flag {
  rowId: string | null;
  title: string | null;
  objection: string;
  date: string;
  runId: string;
}

export interface Batch {
  kind: 'defaults' | 'fixes' | 'slots';
  runId: string;
  /** The entry that wrote the batch's lines. */
  date: string;
  lines: { n: number; text: string }[];
}

export interface BatchAct {
  act: 'RATIFIED' | 'VETOED';
  kind: Batch['kind'];
  runId: string;
  /** Line numbers the act names; `all` when it names the whole batch. */
  lines: number[] | 'all';
  date: string;
}

export interface Grill {
  runId: string;
  date: string;
  converged: boolean;
  /** Index of the entry in newest-first order. */
  entryIndex: number;
}

export interface LogFacts {
  entries: ParsedEntry[];
  lastRun: { date: string; command: string; runId: string } | null;
  flags: Flag[];
  carriedForward: { text: string; rowIds: string[]; date: string; runId: string }[];
  batches: Batch[];
  acts: BatchAct[];
  grills: Grill[];
  /** Every row id any line names, and every «title» an item line names. */
  namedRowIds: Set<string>;
  /** Local rows' `q-NN` keys any line names. */
  namedKeys: Set<string>;
  /** Rows a MARKERS line records a deliberate hold for (their markers stand on purpose — status C5). */
  holds: Set<string>;
  namedTitles: Set<string>;
  /** The date of a pre-v16 crossover NOTE, where one exists (resolve.md R1; status C4 scopes to rows after it). */
  crossover: string | null;
}

const BATCH_KIND: Record<string, Batch['kind']> = { ledger: 'defaults', fix: 'fixes', manifest: 'slots' };

/**
 * The batches a RATIFIED/VETOED line names. The act is the text before its first ` · ` (what follows is the human's words
 * and the spot-check), split on "and": `defaults ledger 4d7fbd, all 8 lines (#1–#8)`, `fixes batch 16f7e6, all 3 lines
 * (#1–#3), and content manifest 16f7e6 #1`, `ratify 9f2c1a defaults`, `veto 9f2c1a #3`.
 */
export function actBatches(text: string): { kind: Batch['kind']; runId: string; lines: number[] | 'all' }[] {
  const out: { kind: Batch['kind']; runId: string; lines: number[] | 'all' }[] = [];
  const act = text.split(' · ')[0] ?? text;
  /** Every `#n` and every `#n–#m` range a segment names, as one sorted set. */
  const numbers = (seg: string): number[] => {
    const set = new Set<number>();
    for (const r of seg.matchAll(/#(\d+)\s*[–-]\s*#?(\d+)/g))
      for (let i = Number(r[1]); i <= Number(r[2]); i++) set.add(i);
    for (const x of seg.replace(/#(\d+)\s*[–-]\s*#?(\d+)/g, ' ').matchAll(/#(\d+)/g)) set.add(Number(x[1]));
    return [...set].sort((a, b) => a - b);
  };
  for (const seg of act.split(/,?\s+and\s+/i)) {
    const m =
      /(defaults ledger|defaults|ledger|fixes batch|fixes|fix|content manifest|manifest|slots)\s+([0-9a-f]{6})\b|([0-9a-f]{6})\s+(defaults|fixes|slots)\b/i.exec(
        seg,
      );
    if (!m) {
      // Q1's bare command forms: `ratify <run id>` is all three of that run's batches; `veto <run id> #3 #7` names lines
      // of the numbered batch — the defaults ledger (a fix or a slot is vetoed by quoting its line).
      const bare = /\b(ratify|veto)\s+([0-9a-f]{6})\b/i.exec(seg);
      const nums = numbers(seg);
      if (bare?.[2]) {
        if (nums.length) out.push({ kind: 'defaults', runId: bare[2], lines: nums });
        else if (bare[1]?.toLowerCase() === 'ratify')
          for (const kind of ['defaults', 'fixes', 'slots'] as const) out.push({ kind, runId: bare[2], lines: 'all' });
        continue;
      }
      // A segment naming no batch of its own continues the one before it: "#1, #3 and #5".
      const prev = out[out.length - 1];
      if (prev && nums.length && prev.lines !== 'all')
        prev.lines = [...new Set([...prev.lines, ...nums])].sort((a, b) => a - b);
      continue;
    }
    const word = (m[1] ?? m[4] ?? '').toLowerCase();
    const runId = m[2] ?? m[3] ?? '';
    const kind: Batch['kind'] = word.includes('fix')
      ? 'fixes'
      : word.includes('manifest') || word === 'slots'
        ? 'slots'
        : 'defaults';
    const nums = numbers(seg);
    out.push({ kind, runId, lines: /\ball\b/i.test(seg) || !nums.length ? 'all' : nums });
  }
  return out;
}

export function readFacts(log: ParsedLog): LogFacts {
  const facts: LogFacts = {
    entries: log.entries,
    lastRun: null,
    flags: [],
    carriedForward: [],
    batches: [],
    acts: [],
    grills: [],
    namedRowIds: new Set(),
    namedKeys: new Set(),
    holds: new Set(),
    namedTitles: new Set(),
    crossover: null,
  };
  const first = log.entries[0];
  if (first) facts.lastRun = { date: first.heading.date, command: first.heading.command, runId: first.heading.runId };
  const batchMap = new Map<string, Batch>();
  log.entries.forEach((e, entryIndex) => {
    const { date, runId } = e.heading;
    for (const l of e.lines) {
      rowIdsIn(l.text).forEach((id) => facts.namedRowIds.add(id));
      for (const k of l.text.matchAll(/(?:^|[^\w-])(q-\d+)(?![\w-])/g)) if (k[1]) facts.namedKeys.add(k[1]);
      if (l.kind === 'item') {
        const t = TITLE_RE.exec(l.text)?.[1];
        if (t) facts.namedTitles.add(t);
      }
      switch (l.kind) {
        case 'FLAGGED': {
          // A Notion row by its backticked id; a local row by its backticked q-NN key.
          const ids = [...rowIdsIn(l.text), ...[...l.text.matchAll(/`(q-\d+)`/g)].map((x) => x[1] ?? '')];
          const title = TITLE_RE.exec(l.text)?.[1] ?? null;
          const cut = l.text.indexOf(' · ');
          facts.flags.push({
            rowId: ids[0] ?? null,
            title,
            objection: cut >= 0 ? l.text.slice(cut + 3).trim() : l.text,
            date,
            runId,
          });
          break;
        }
        case 'CARRIED-FORWARD':
          facts.carriedForward.push({ text: l.text, rowIds: rowIdsIn(l.text), date, runId });
          break;
        case 'ledger':
        case 'fix':
        case 'manifest': {
          const m = /^(ledger|fix|manifest)\s+([\w-]+)\s+#(\d+)$/i.exec(l.token ?? '');
          if (!m?.[1] || !m[2] || !m[3]) break;
          const kind = BATCH_KIND[m[1].toLowerCase()] ?? 'defaults';
          const key = `${kind}:${m[2]}`;
          const b = batchMap.get(key) ?? { kind, runId: m[2], date, lines: [] };
          b.lines.push({ n: Number(m[3]), text: l.text });
          batchMap.set(key, b);
          break;
        }
        case 'RATIFIED':
        case 'VETOED':
          for (const b of actBatches(l.text)) facts.acts.push({ act: l.kind, ...b, date });
          break;
        case 'MARKERS':
          for (const seg of l.text.split(/ · |; /)) {
            if (!/deliberate hold/i.test(seg)) continue;
            rowIdsIn(seg).forEach((id) => facts.holds.add(id));
            for (const k of seg.matchAll(/`(q-\d+)`/g)) if (k[1]) facts.holds.add(k[1]);
          }
          break;
        case 'GRILL':
          facts.grills.push({ runId, date, converged: /converged:\s*yes\b/i.test(l.text), entryIndex });
          break;
        case 'NOTE':
          if (/crossover/i.test(l.text)) facts.crossover = facts.crossover ?? date;
          break;
        default:
          break;
      }
    }
  });
  facts.batches = [...batchMap.values()];
  return facts;
}

/** Is line n of a batch covered by a RATIFIED act, and not later VETOED? (status C5; challenge.md Q1) */
export function ratified(facts: LogFacts, kind: Batch['kind'], runId: string, n: number): boolean {
  const covers = (a: BatchAct): boolean =>
    a.kind === kind && a.runId === runId && (a.lines === 'all' || a.lines.includes(n));
  return (
    facts.acts.some((a) => a.act === 'RATIFIED' && covers(a)) &&
    !facts.acts.some((a) => a.act === 'VETOED' && covers(a))
  );
}

/** How many write entries were opened after the given run's first entry — "sittings" a batch has waited (status C5). */
export function sittingsSince(facts: LogFacts, runId: string): number {
  const idx = facts.entries.findIndex((e) => e.heading.runId === runId);
  return idx < 0 ? 0 : idx;
}
