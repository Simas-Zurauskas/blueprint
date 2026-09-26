import { array, object, oneOf, optional, string, type Infer } from '../core/schema.ts';
import type { Snapshot } from '../snapshot.ts';
import { data } from '../tasks/tasks.ts';
import { evidenceFound, FILTERS, SURVEYED, type Exempt } from './dispose.ts';

// challenge.md Q4's cold read — the single home: fresh readers, up to ten drafted rows each, briefed as the person who
// must answer, with the whole document and nothing about how the rows were routed. One of five verdicts per row, judged
// alone; a verdict without its evidence is not a verdict, and the row stands.

export const COLD_VERDICTS = ['stands', 'answered', 'irrelevant', 'simplify', 'extend'] as const;

export const ColdSchema = object({
  reads: array(
    object({
      row: string({ min: 1, max: 12 }),
      verdict: oneOf(COLD_VERDICTS),
      evidence: array(object({ where: string({ min: 1, max: 200 }), quote: string({ min: 1, max: 800 }) }), { max: 4 }),
      filter: optional(oneOf(FILTERS)),
      /** simplify: one sentence, one decision — or `split` for a bundle. */
      rewording: optional(string({ max: 300 })),
      split: optional(array(string({ max: 300 }), { max: 3 })),
      /** extend: the widened wording, and the drafted siblings it absorbs, by title. */
      widened: optional(
        object({ title: string({ min: 1, max: 300 }), absorbs: array(string({ max: 300 }), { max: 8 }) }),
      ),
    }),
    { max: 10 },
  ),
  directives: array(string()),
});
export type Cold = Infer<typeof ColdSchema>;

export interface DraftRow {
  /** R1…, the reader's handle. */
  id: string;
  /** The candidate it came from. */
  candidate: string;
  title: string;
  whyAsked: string;
  touches: string[];
  directions: string;
  exempt: Exempt;
}

export function coldBrief(o: {
  rows: readonly DraftRow[];
  s: Snapshot;
  index: string;
  standing: string;
  ledger: string;
  others: readonly string[];
}): string {
  return [
    '# Cold read (challenge.md Q4)',
    '',
    'You are the person who must answer these questions. Read each row on its own, against the whole document, and return one verdict per row with its evidence. You are told nothing about how the rows were made.',
    '',
    ...o.rows.map((r) =>
      data(
        `${r.id} — the row as it would be written`,
        [
          `Question: ${r.title}`,
          `Why asked: ${r.whyAsked}`,
          `Touches: ${r.touches.join(', ') || '(project-level)'}`,
          `Suggested directions: ${r.directions}`,
        ].join('\n'),
      ),
    ),
    '',
    data('the requirement index — every feature', o.index),
    ...o.s.features
      .filter((f) => o.rows.some((r) => r.touches.includes(f.name)))
      .map((f) => data(`«${f.name}» — the whole body`, f.content)),
    data('every standing question row by title and status, with its answer', o.standing),
    data('the standing defaults ledger', o.ledger || '(none)'),
    data("the titles of this run's other drafted rows", o.others.join('\n') || '(none)'),
  ].join('\n');
}

export interface ColdOutcome {
  row: DraftRow;
  /** write (as drafted or reworded) · discard (a cold-read demotion) · absorbed (into a widened sibling) */
  action: 'write' | 'discard' | 'absorbed';
  title: string;
  /** Rows a split adds, each written, never read cold again. */
  splits: string[];
  filter?: string;
  quote?: string;
  /** A check line for record/runs/: a rewording, or a read that offered no evidence. */
  check?: string;
  verdict: (typeof COLD_VERDICTS)[number];
}

/**
 * Apply the reads (Q4's table, "What a verdict may not do"): `answered` and `irrelevant` stand without their evidence and
 * never fire on the four undiscardable classes; a rewording that loses the client-only act is not adopted; an extension
 * absorbs drafted siblings only, never one in an undiscardable class, and two reads absorbing each other adopt neither.
 */
export function applyColdReads(
  rows: readonly DraftRow[],
  reads: Cold['reads'],
  s: Snapshot,
  logText: string,
): ColdOutcome[] {
  const byId = new Map(reads.map((r) => [r.row, r]));
  const out = new Map<string, ColdOutcome>();
  const mutual = new Set<string>();
  for (const r of rows) {
    const read = byId.get(r.id);
    for (const t of read?.verdict === 'extend' ? (read.widened?.absorbs ?? []) : []) {
      const other = rows.find((x) => x.title === t);
      const back = other ? byId.get(other.id) : undefined;
      if (back?.verdict === 'extend' && back.widened?.absorbs.includes(r.title)) mutual.add(r.id);
    }
  }
  // Extensions first: a sibling one absorbs is settled by it, whatever its own read said.
  const ordered = [...rows].sort(
    (a, b) => Number(byId.get(b.id)?.verdict === 'extend') - Number(byId.get(a.id)?.verdict === 'extend'),
  );
  for (const r of ordered) {
    if (out.has(r.id)) continue;
    const read = byId.get(r.id);
    const base: ColdOutcome = {
      row: r,
      action: 'write',
      title: r.title,
      splits: [],
      verdict: read?.verdict ?? 'stands',
    };
    if (!read || read.verdict === 'stands') {
      out.set(r.id, { ...base, verdict: 'stands' });
      continue;
    }
    const found = read.evidence.find((e) => evidenceFound(e, s, logText));
    if (read.verdict === 'answered' || read.verdict === 'irrelevant') {
      const surveyed =
        read.filter && SURVEYED.has(read.filter)
          ? read.evidence.filter((e) => evidenceFound(e, s, logText)).length >= 2
          : !!found;
      if (r.exempt || !surveyed) {
        out.set(r.id, {
          ...base,
          verdict: 'stands',
          check: `cold read: ${r.exempt ? `${read.verdict} does not fire on a ${r.exempt} row` : 'no evidence'} — stands · «${r.title}»`,
        });
        continue;
      }
      out.set(r.id, {
        ...base,
        action: 'discard',
        filter: read.filter ?? (read.verdict === 'answered' ? 'Already answered' : 'Not a specification question'),
        ...(found ? { quote: found.quote } : {}),
      });
      continue;
    }
    if (read.verdict === 'simplify') {
      if (read.split?.length) {
        out.set(r.id, {
          ...base,
          title: read.split[0] ?? r.title,
          splits: read.split.slice(1),
          check: `cold read: split «${r.title}» → ${read.split.map((x) => `«${x}»`).join(' + ')}`,
        });
        continue;
      }
      if (!read.rewording) {
        out.set(r.id, {
          ...base,
          verdict: 'stands',
          check: `cold read: simplify with no rewording — stands · «${r.title}»`,
        });
        continue;
      }
      out.set(r.id, {
        ...base,
        title: read.rewording,
        check: `cold read: simplified «${r.title}» → «${read.rewording}»`,
      });
      continue;
    }
    // extend
    if (!read.widened || mutual.has(r.id)) {
      out.set(r.id, {
        ...base,
        verdict: 'stands',
        check: mutual.has(r.id)
          ? `cold read: «${r.title}» and a sibling each absorb the other — both stand, named as a merge for a person`
          : `cold read: extend with no widened wording — stands · «${r.title}»`,
      });
      continue;
    }
    const standing = s.questions.find((q) => read.widened?.absorbs.includes(q.question));
    if (standing) {
      out.set(r.id, {
        ...base,
        action: 'discard',
        filter: 'Duplicate',
        quote: standing.question,
        check: `cold read: the widening reaches the standing row «${standing.question}» — proposed as a merge; the draft is its duplicate`,
      });
      continue;
    }
    out.set(r.id, {
      ...base,
      title: read.widened.title,
      check: `cold read: extended «${r.title}» → «${read.widened.title}»`,
    });
    for (const t of read.widened.absorbs) {
      const sib = rows.find((x) => x.title === t && x.id !== r.id);
      if (sib && !sib.exempt && !out.has(sib.id))
        out.set(sib.id, {
          row: sib,
          action: 'absorbed',
          title: sib.title,
          splits: [],
          verdict: 'extend',
          filter: 'Duplicate',
          quote: read.widened.title,
        });
    }
  }
  return rows.map((r) => out.get(r.id) ?? { row: r, action: 'write', title: r.title, splits: [], verdict: 'stands' });
}
