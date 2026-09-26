import { hasNumberedRequirement, nextFreeFr, type BodyMarker } from '../domain/feature.ts';
import { parseDirections, readAnswer, type AnswerReading, type Question } from '../domain/question.ts';
import type { ParsedLog } from '../log/parse.ts';
import { normaliseId } from '../target/notion.ts';
import { touchedFeatures, type FeatureRec, type Snapshot } from '../snapshot.ts';
import { contentFindings } from '../checks/content.ts';

// resolve.md R1 (the queue) and R2 (is there anything to apply?) — "Deterministic, no judgement, no sub-agents."
// Every row that fails a check ends Flagged with the one-line fix as its objection (R4); every row that passes becomes an
// item for R3's writer and checker.

export type FlagRoute = 'R2.1' | 'R2.3' | 'R2.4';

export interface R2Flag {
  row: Question;
  route: FlagRoute;
  objection: string;
}

export interface Item {
  row: Question;
  reading: Extract<AnswerReading, { kind: 'pointer' } | { kind: 'prose' }>;
  /** 'single' — Touches names one feature; 'project' — empty or several, the serial project-level path (R2.1). */
  path: 'single' | 'project';
  features: FeatureRec[];
  /** The markers on the touched features that point at this row — the ones its answer would remove. */
  markers: (BodyMarker & { feature: string })[];
  /** The row's derivation depth, from the closing clause of its `Why asked` (challenge.md Q4); 1 when absent. */
  depth: number;
  seed: boolean;
}

export interface ResolvePlan {
  queue: Question[];
  items: Item[];
  flags: R2Flag[];
  /** Groups of single-feature items by feature id, in a stable order; project-level items run after, serially. */
  groups: { feature: FeatureRec; items: Item[] }[];
  projectLevel: Item[];
  /** R2.3: a body changed outside the seam — its current hash becomes the new baseline in this entry's HASHES line. */
  rebaselines: { feature: FeatureRec; recorded: string; current: string }[];
  /** R2.4 findings on bodies no queued row touches are not this run's; on touched ones they flag. */
  notes: string[];
  /** R2.5's mechanical findings on the fields in scope — reported, and a delta carrying one is refused. */
  content: { where: string; cls: string }[];
}

/** R1: the queue is exactly `Status = Answered` and `Answer & why` non-empty (databases.md §4). */
export const queueOf = (s: Snapshot): Question[] =>
  s.questions.filter((q) => q.status === 'Answered' && q.answer.trim().length > 0);

export const depthOf = (whyAsked: string): number => {
  const m = /·\s*depth\s+(\d+)\s*\.?\s*$/m.exec(whyAsked.trim()) ?? /·\s*depth\s+(\d+)/.exec(whyAsked);
  return m?.[1] ? Number(m[1]) : 1;
};

export interface Baseline {
  /** The recorded 12-hex hash, or null when the newest write naming the body recorded none ("hash not taken"). */
  hash: string | null;
  runId: string;
  date: string;
}

/**
 * R2.3's baseline: the newest line that names each feature body — an `item` line or a `HASHES` line, whichever is later
 * (v20). Keyed by canonical feature id where the line carries one, and by «name» as well. **Where that newest line is a
 * logged write that recorded no hash, the baseline is void**: the change is a logged run's, not a foreign edit, and the
 * body is in exactly the state R2.3 calls vacuous — "a body no entry has ever hashed has no baseline and is not a
 * finding" — until this run's `HASHES` line records its first real one.
 */
/** An item line's verdict field: one that wrote, and one that did not (R5's item shape; v37's written/amended forms). */
const WROTE =
  /^(?:Clean|Patched|Superseded|Unverified|Applied|written|amended|added|superseded|replaced|relabel\w*|seeded)\b/;
const NO_WRITE = /^(?:Flagged|Kept|re-queued|requeued|conflict|refused|R\d(?:\.\d)?\b|no change)/;

/** Where each baseline sits in the log, newest first: a lower number is a newer line. */
const RECENCY = new WeakMap<Baseline, number>();

export function baselines(log: ParsedLog | null): Map<string, Baseline> {
  const out = new Map<string, Baseline>();
  if (!log) return out;
  let seq = 0;
  for (const e of log.entries) {
    const { runId, date } = e.heading;
    // Entries are newest first; within an entry a later line is newer — so read the entry's lines last-to-first.
    for (const l of [...e.lines].reverse()) {
      seq++;
      const put = (k: string | null, b: Baseline): void => {
        if (k && !out.has(k)) out.set(k, b);
      };
      if (l.kind === 'HASHES') {
        for (const m of l.text.matchAll(/«([^»]+)»\s+([0-9a-f]{12})\b/g)) {
          const b: Baseline = { hash: m[2] ?? null, runId, date };
          RECENCY.set(b, seq);
          put(`«${m[1] ?? ''}»`, b);
        }
      }
      if (l.kind === 'item') {
        for (const m of l.text.matchAll(/«([^»]+)»\s*(?:`([0-9a-f-]{32,36})`)?((?:(?!«)[^])*)/g)) {
          const [, name = '', id, tail = ''] = m;
          const hash = /\bbody\s+([0-9a-f]{12})\b/.exec(tail)?.[1];
          // Whether the line wrote is read from its verdict field, never from free text (an objection says "added" or
          // "written" about text that was NOT written). A line that wrote nothing — re-queued, Flagged, Kept, a
          // conflict, R5's `body —` — says nothing about the body and leaves the older baseline standing; a logged
          // write that recorded no hash voids it.
          const segs = l.text.split(' · ').map((x) => x.trim());
          const wroteNothing = segs.some((x) => NO_WRITE.test(x)) || /\bbody\s+—/.test(tail);
          const wrote = segs.some((x) => WROTE.test(x));
          const hashless = !hash && !wroteNothing && (/hash not taken|\bbody none\b/.test(tail) || wrote);
          if (!hash && !hashless) continue;
          const b: Baseline = { hash: hash ?? null, runId, date };
          RECENCY.set(b, seq);
          put(id ? normaliseId(id) : null, b);
          put(`«${name}»`, b);
        }
      }
    }
  }
  return out;
}

/** A feature's baseline: the newer of the line naming it by id and the line naming it by «name». */
export function baselineOf(base: Map<string, Baseline>, f: { id: string; name: string }): Baseline | undefined {
  const byId = base.get(f.id);
  const byName = base.get(`«${f.name}»`);
  if (!byId || !byName) return byId ?? byName;
  return (RECENCY.get(byName) ?? Infinity) < (RECENCY.get(byId) ?? Infinity) ? byName : byId;
}

export function planResolve(s: Snapshot, log: ParsedLog | null): ResolvePlan {
  const queue = queueOf(s);
  const flags: R2Flag[] = [];
  const items: Item[] = [];
  const notes: string[] = [];
  const base = baselines(log);

  // R2.3 first, over every feature a queued row touches: a changed body flags every queued row touching it.
  const touchedIds = new Set(queue.flatMap((q) => touchedFeatures(s, q).found.map((f) => f.id)));
  const candidates = new Map<string, ResolvePlan['rebaselines'][number]>();
  const foreign = new Set<string>();
  for (const f of s.features.filter((x) => touchedIds.has(x.id))) {
    const recorded = baselineOf(base, f);
    if (!f.hash12) continue;
    if (!recorded) continue; // a body no entry ever hashed has no baseline and is not a finding
    if (recorded.hash === null) {
      notes.push(
        `«${f.name}»: the newest write naming it (run ${recorded.runId}, ${recorded.date}) recorded no hash — no baseline, so R2.3 is vacuous for it; this run's HASHES line records its first`,
      );
      continue;
    }
    if (recorded.hash !== f.hash12) {
      foreign.add(f.id);
      candidates.set(f.id, { feature: f, recorded: recorded.hash, current: f.hash12 });
    }
  }
  /** R2.3's finding, named in any objection a row touching a changed body ends with — so the vouch is never skipped. */
  const alsoChanged = (found: readonly FeatureRec[]): string => {
    const changed = found.filter((f) => foreign.has(f.id));
    return changed.length
      ? ` (also: ${changed.map((f) => `«${f.name}»`).join(', ')} changed outside this seam since the last recorded hash — look at the edit before moving it back)`
      : '';
  };

  const flaggedFor = new Set<string>();
  for (const row of queue) {
    const { found, missing } = touchedFeatures(s, row);
    if (missing.length) {
      flags.push({
        row,
        route: 'R2.1',
        objection: `Touches names ${missing.length === 1 ? 'a feature' : `${missing.length} features`} that does not exist — repoint Touches at the feature this answer belongs to${alsoChanged(found)}`,
      });
      continue;
    }
    const reading = readAnswer(row.answer, parseDirections(row.directions));
    if (reading.kind === 'bad-pointer') {
      flags.push({
        row,
        route: 'R2.1',
        objection: `${reading.reason} — name one direction by its number (and give any value it leaves open), or write the decision in a sentence${alsoChanged(found)}`,
      });
      continue;
    }
    if (reading.kind === 'link-only') {
      flags.push({
        row,
        route: 'R2.1',
        objection: `the answer is only a link or a reference — write the decision itself, in a sentence, then set the row back to Answered${alsoChanged(found)}`,
      });
      continue;
    }
    if (reading.kind === 'empty') continue; // excluded by the queue's own definition
    const changed = found.filter((f) => foreign.has(f.id));
    if (changed.length) {
      flags.push({
        row,
        route: 'R2.3',
        objection: `${changed.map((f) => `«${f.name}»`).join(', ')} changed outside this seam since the last recorded hash — look at the edit; moving this row back to Answered vouches for it`,
      });
      // The re-baseline fires once a row is flagged for the change: the vouch is that row moving back (R2.3).
      for (const f of changed) flaggedFor.add(f.id);
      continue;
    }
    const path: Item['path'] = found.length === 1 ? 'single' : 'project';
    // R2.4, for every feature the row touches: a named block missing outright is a finding (an EMPTY Edge cases or
    // Rabbit holes block is fine — it is present). A body with no numbered requirement is the seed case, never a flag.
    const broken = found.map((f) => ({ f, gone: f.body.missing })).filter((x) => x.gone.length);
    if (broken.length) {
      const what = broken
        .map(({ f, gone }) => `«${f.name}»'s ${gone.join(', ')} block${gone.length > 1 ? 's' : ''}`)
        .join('; ');
      const many = broken.reduce((n, x) => n + x.gone.length, 0) > 1;
      flags.push({
        row,
        route: 'R2.4',
        objection: `not a spec any more: ${what} ${many ? 'are' : 'is'} missing — a human writes ${many ? 'them' : 'it'}, then sets this row back to Answered`,
      });
      continue;
    }
    const markers = found.flatMap((f) =>
      f.body.markers
        .filter(
          (m) =>
            m.link.kind === 'question' &&
            (m.link.id === row.id || m.link.key === row.id || (row.key !== undefined && m.link.key === row.key)),
        )
        .map((m) => ({ ...m, feature: f.id })),
    );
    items.push({
      row,
      reading,
      path,
      features: found,
      markers,
      depth: depthOf(row.whyAsked),
      seed: !found.some((f) => hasNumberedRequirement(f.body)),
    });
  }

  const groups: ResolvePlan['groups'] = [];
  for (const it of items.filter((i) => i.path === 'single')) {
    const f = it.features[0];
    if (!f) continue;
    const g = groups.find((x) => x.feature.id === f.id);
    if (g) g.items.push(it);
    else groups.push({ feature: f, items: [it] });
  }
  const content = contentFindings(
    { ...s, features: s.features.filter((f) => touchedIds.has(f.id)), questions: queue },
    [],
    [],
  ).map((c) => ({ where: c.where, cls: c.cls }));
  if (!queue.length) notes.push('the queue is empty — a valid run: skip R3, do the rest (R1)');
  const rebaselines = [...candidates.values()].filter((r) => flaggedFor.has(r.feature.id));
  return {
    queue,
    items,
    flags,
    groups,
    projectLevel: items.filter((i) => i.path === 'project'),
    rebaselines,
    notes,
    content,
  };
}

export { nextFreeFr };
