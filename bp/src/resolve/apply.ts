import { findMarkers } from '../core/text.ts';
import {
  array,
  boolean,
  integer,
  literal,
  nullable,
  object,
  oneOf,
  optional,
  string,
  tagged,
  type Infer,
} from '../core/schema.ts';
import { FEATURE_BLOCKS } from '../domain/vocab.ts';
import { markerLink } from '../domain/feature.ts';
import type { FeatureRec } from '../snapshot.ts';
import { scan } from '../checks/content.ts';
import type { Item } from './plan.ts';

// resolve.md R3 — the writer's typed output, the assembly of its delta into the block (bp numbers new requirements and
// writes every provenance line, so none is ever missing or shared — v24), the independent check's per-requirement
// verdicts, R3.6's soft-mode gate, and R3.3's six outcomes.

// ---- the writer (R3.1): four permitted outputs, no fifth ---------------------------------------------------------------

const directives = array(string());

/** A delta's fields — the single-feature writer's `delta` output, and each per-feature write of the project writer. */
export const deltaFields = {
  block: oneOf(FEATURE_BLOCKS),
  /** Behaviour: requirement edits. `fr` is an existing number, or null for a new requirement (bp numbers it). */
  changes: optional(
    array(object({ fr: nullable(integer({ min: 1 })), text: string({ min: 1, max: 1200 }) }), { max: 12 }),
  ),
  /** Any other block: its full new lines, heading and provenance lines excluded (bp writes those). */
  lines: optional(array(string({ max: 1200 }), { max: 60 })),
  /** A seed only (the Behaviour block holds no numbered requirement): the `## Why` paragraph, where Why is empty. */
  why: optional(string({ max: 1500 })),
  groundingKind: string({ min: 1, max: 120 }),
  removesMarker: boolean(),
  directives,
};

export const WriterSchema = tagged('output', {
  delta: object({ output: literal('delta'), ...deltaFields }),
  already_carries: object({ output: literal('already_carries'), quote: string({ min: 1 }), directives }),
  belongs_to: object({ output: literal('belongs_to'), feature: string({ min: 1 }), directives }),
  conflict: object({ output: literal('conflict'), section: string({ min: 1 }), directives }),
});
export type WriterOutput = Infer<typeof WriterSchema>;

// ---- the check (R3.2): one verdict per requirement --------------------------------------------------------------------

export const CheckerSchema = object({
  verdicts: array(
    object({
      target: string({ min: 1, max: 60 }),
      verdict: oneOf(['Clean', 'Patched', 'Superseded', 'Flagged'] as const),
      inconsistency: string({ max: 1200 }),
      answerQuote: string({ max: 1200 }),
      patch: optional(
        object({ fr: integer({ min: 1 }), anchor: string({ min: 1 }), addition: string({ min: 1, max: 600 }) }),
      ),
    }),
    { min: 1, max: 20 },
  ),
  directives,
});
export type CheckerOutput = Infer<typeof CheckerSchema>;

// ---- assembly ----------------------------------------------------------------------------------------------------------

export interface Assembled {
  /** The heading of the block written — the first of a span where `through` is set. */
  block: string;
  /** A seed writes `## Why` through `## Behaviour` as one span (R3.3). */
  through?: string;
  before: string;
  after: string;
  /** Requirements this delta created or changed, for the item line's pointer. */
  touched: string[];
  /** Each replaced or removed line: the old text, and the new text (empty where the line was removed). */
  replaced: { target: string; old: string; new: string }[];
  /** R3.6: whether the delta replaces or removes existing text in an FR, an Edge case or a Not doing line. */
  replaces: boolean;
  /** This row's markers the write removes — the MARKERS line counts these, never a recomputation. */
  markersRemoved: string[];
}

const FR_LINE = /^\s*(?:[-*]\s+)?\**FR-(\d+)\**\s*(?:[—–-]|:)\s*(.*)$/;
const PROV = /^\s*\*\(.*\)\*\s*$/;
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Strip markers out of a sentence (the writer is told not to write them; bp re-attaches the ones that stay). */
const stripMarkers = (text: string): string => {
  let out = text;
  for (const m of findMarkers(text)) out = out.replace(m.raw, '');
  return clean(out);
};

export function provenanceLine(o: {
  date: string;
  question: string;
  rowId: string;
  depth: number;
  kind: string;
  replaces?: string;
  removes?: string;
}): string {
  const q = o.question.replace(/[«»]/g, '"');
  const quote = (t: string): string => `"${t.replace(/"/g, "'")}"`;
  const change = o.replaces ? `; replaces ${quote(o.replaces)}` : o.removes ? `; removes ${quote(o.removes)}` : '';
  return `*(Applied ${o.date} from «${q}» **\`${o.rowId}\`** · depth ${o.depth} — ${o.kind}${change}.)*`;
}

export class DeltaRefused extends Error {
  override readonly name = 'DeltaRefused';
}

const KIND_SHAPE = /^[\p{L}\p{N} ,'’-]{3,80}$/u;

/** The kinds of grounding a provenance line may name — closed at run start from the Blueprint's own lines (R3.1). */
export function groundingKinds(features: readonly FeatureRec[]): Set<string> {
  const kinds = new Set<string>(['answer and reasoning on that row']);
  for (const f of features) {
    for (const r of f.body.requirements) {
      for (const p of r.provenance) {
        // Only resolve's own lines name a kind: `*(Applied …)*` (an add or a human's `*(Added …)*` states a reason there).
        // The kind follows "· depth n — " (a question title may itself carry a dash), up to its "; replaces" or the close.
        if (!/^\s*\*\(Applied\b/.test(p)) continue;
        const m =
          /·\s*depth\s+\d+\s+—\s+(.+?)(?:;\s|\.?\)\*\s*$)/.exec(p) ?? /»[^—«»]*—\s+(.+?)(?:;\s|\.?\)\*\s*$)/.exec(p);
        const k = m?.[1]?.trim();
        // Only a plain phrase is a kind: document text that reads like an instruction is never promoted into the rules.
        if (k && KIND_SHAPE.test(k) && !isDirectionKind(k)) kinds.add(k);
      }
    }
  }
  return kinds;
}

const isDirectionKind = (k: string): boolean => /^direction \d+ on that row, chosen by the answer$/.test(k);

/** Does this marker link this item's own row — by its Notion id, or on the local target by its q-NN key? */
const isRowMarker = (inner: string, row: Item['row']): boolean => {
  const link = markerLink(inner);
  return (
    link.kind === 'question' &&
    (link.id === row.id || link.key === row.id || (row.key !== undefined && link.key === row.key))
  );
};

/** R3.6's gate names requirements, edge cases and Not doing lines — a rewrite of Why or Rabbit holes is not a replacement. */
export const GATED_BLOCKS: ReadonlySet<string> = new Set(['Behaviour', 'Edge cases', 'Not doing']);

/** Words of a line, for pairing a changed line with the one it replaced. */
const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
/** Dice's coefficient over the two lines' words: 1 for the same words, 0 for none shared. */
const similarity = (a: string, b: string): number => {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
};

/** Build the new block from the writer's delta. Throws DeltaRefused naming the cap it breaks. */
/**
 * Another write seam's provenance and marker rule (add.md A4: a source segment, not a question row, is what a line cites;
 * route 8 removes the markers the source settles). Without one, the resolve seam's rules apply.
 */
export interface Seam {
  provenance: (change?: { replaces?: string; removes?: string }) => string;
  removes: (markerInner: string) => boolean;
}

export function assemble(o: {
  item: Item;
  feature: FeatureRec;
  out: Extract<WriterOutput, { output: 'delta' }>;
  date: string;
  kinds: Set<string>;
  seam?: Seam;
}): Assembled {
  const { item, out } = o;
  if (o.seam) return assembleBlock(o, o.seam.provenance, o.seam.removes);
  // The one direction label a row can carry names the direction ITS answer chose — only a pointer has one (R3.1).
  const n = item.reading.kind === 'pointer' ? item.reading.n : null;
  const chosen = n === null ? null : `direction ${n} on that row, chosen by the answer`;
  if (isDirectionKind(out.groundingKind) && out.groundingKind !== chosen) {
    throw new DeltaRefused(
      chosen
        ? `the answer chose direction ${n}; its label is "${chosen}", never "${out.groundingKind}" (R3.1)`
        : `"${out.groundingKind}" names a direction, and this answer points at none — its kind comes from the run's closed set (R3.1)`,
    );
  }
  if (!o.kinds.has(out.groundingKind) && !isDirectionKind(out.groundingKind)) {
    throw new DeltaRefused(
      `grounding kind "${out.groundingKind}" is not in this run's closed set (${[...o.kinds].join(' · ')}) — a writer never composes a new one (R3.1)`,
    );
  }
  if (item.reading.kind === 'pointer' && !isDirectionKind(out.groundingKind) && item.reading.extra === '') {
    throw new DeltaRefused(
      `a bare pointer at direction ${item.reading.n} carries the kind "direction ${item.reading.n} on that row, chosen by the answer" (R3.1)`,
    );
  }
  const prov = (change?: { replaces?: string; removes?: string }): string =>
    provenanceLine({
      date: o.date,
      question: item.row.question,
      rowId: item.row.id,
      depth: item.depth,
      kind: out.groundingKind,
      ...(change ?? {}),
    });
  return assembleBlock(o, prov, (inner) => out.removesMarker && isRowMarker(inner, item.row));
}

/** The block assembly both seams share: numbering, pairing, markers and provenance, one named block per write. */
function assembleBlock(
  o: { item: Item; feature: FeatureRec; out: Extract<WriterOutput, { output: 'delta' }> },
  prov: (change?: { replaces?: string; removes?: string }) => string,
  removable: (markerInner: string) => boolean,
): Assembled {
  const { feature: f, out } = o;
  const b = f.body.blocks.find((x) => x.known === out.block);
  if (!b)
    throw new DeltaRefused(`«${f.name}» has no ${out.block} block — a delta never adds a named block (R3.1's caps)`);
  const touched: string[] = [];
  const replaced: Assembled['replaced'] = [];
  const markersRemoved: string[] = [];
  /** A line with this row's own markers taken out where the delta removes them (route 1: one act with the write). */
  const unmark = (line: string): string => {
    let next = line;
    for (const m of findMarkers(line)) {
      if (!removable(m.inner)) continue;
      next = next.replace(m.raw, '');
      markersRemoved.push(m.raw);
    }
    return next === line ? line : next.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '');
  };
  const refuseLine = (l: string, what: string): void => {
    if (/[\r\n]/.test(l)) throw new DeltaRefused(`${what} is one line — no line break inside it (R3.1's caps)`);
  };

  if (out.block === 'Behaviour') {
    if (!out.changes?.length) throw new DeltaRefused('a Behaviour delta carries at least one requirement change');
    if (out.lines) throw new DeltaRefused("a Behaviour delta changes requirements, never the block's raw lines");
    const frs = out.changes.map((c) => c.fr).filter((x): x is number => x !== null);
    if (new Set(frs).size !== frs.length)
      throw new DeltaRefused('each requirement is changed once per delta — one sentence, one provenance line (R3.1)');
    const lines = [...b.lines];
    const nFr = (k: number): number => lines.findIndex((l) => FR_LINE.exec(l)?.[1] === String(k));
    let next = f.body.requirements.reduce((m, r) => Math.max(m, r.n), 0);
    const seeding = !f.body.requirements.some((r) => !r.withdrawn);
    for (const c of out.changes) {
      refuseLine(c.text, 'a requirement');
      if (/^\s*\**FR-\d+/i.test(c.text) || /\bFR-\d+[a-z]\b/.test(c.text))
        throw new DeltaRefused("no variant label and no number in the text — bp numbers requirements (R3.1's caps)");
      if (/^\s*#/.test(c.text)) throw new DeltaRefused("no heading inside a block (R3.1's caps)");
      const text = stripMarkers(c.text);
      if (c.fr === null) {
        next += 1;
        // Insert after the last requirement and its provenance lines.
        let at = lines.length;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (FR_LINE.test(lines[i] ?? '')) {
            at = i + 1;
            while (at < lines.length && PROV.test(lines[at] ?? '')) at++;
            break;
          }
        }
        if (seeding && lines.every((l) => !l.trim())) at = 0;
        lines.splice(at, 0, `FR-${next} — ${text}`, prov());
        touched.push(`FR-${next}${seeding ? ' (seed)' : ''}`);
        continue;
      }
      const idx = nFr(c.fr);
      const req = f.body.requirements.find((r) => r.n === c.fr);
      if (idx < 0 || !req) throw new DeltaRefused(`FR-${c.fr} does not exist on «${f.name}»`);
      if (req.withdrawn)
        throw new DeltaRefused(`FR-${c.fr} is a tombstone — a withdrawn requirement is never rewritten (doc-shape §8)`);
      const oldLine = lines[idx] ?? '';
      const oldText = stripMarkers(FR_LINE.exec(oldLine)?.[2] ?? '');
      // Every marker on the line is carried to the new sentence, except this row's own where the delta removes it.
      const keep = findMarkers(oldLine).filter((m) => !removable(m.inner));
      for (const m of findMarkers(oldLine)) if (removable(m.inner)) markersRemoved.push(m.raw);
      // Additive: the old sentence survives inside the new one (its closing punctuation aside) — nothing is replaced.
      const additive = clean(text).includes(clean(oldText).replace(/[.;:!]+$/, ''));
      if (!additive) replaced.push({ target: `FR-${c.fr}`, old: oldText, new: text });
      lines[idx] = `FR-${c.fr} — ${text}${keep.length ? ` ${keep.map((m) => m.raw).join(' ')}` : ''}`;
      let at = idx + 1;
      while (at < lines.length && PROV.test(lines[at] ?? '')) at++;
      lines.splice(at, 0, prov(additive ? undefined : { replaces: oldText }));
      touched.push(`FR-${c.fr}`);
    }
    // This row's marker is removed from the block wherever it stands, not only on a rewritten line.
    const behaviour = [`## ${b.name}`, ...lines.map(unmark)].join('\n');
    const why = f.body.blocks.find((x) => x.known === 'Why');
    const whyEmpty = !!why && why.lines.every((l) => !l.trim());
    if (out.why !== undefined && !(seeding && whyEmpty))
      throw new DeltaRefused('`why` is written only by a seed, and only into an empty Why block (R3.3)');
    if (seeding && whyEmpty && why) {
      // A seed is `## Why` plus FR-1 (R3.3): one write over the two adjacent blocks, read back as one.
      if (out.why === undefined || !out.why.trim())
        throw new DeltaRefused('a seed writes the Why paragraph too, derived from the answer — return `why` (R3.3)');
      refuseLine(out.why, 'the Why paragraph');
      if (why.end !== b.start)
        throw new DeltaRefused('the Why and Behaviour blocks are not adjacent — a seed writes them as one span');
      const trailing = /\n*$/.exec(why.raw)?.[0] ?? '';
      const newWhy = `## ${why.name}\n${stripMarkers(out.why)}\n${prov()}${trailing}`;
      touched.push('Why (seed)');
      return {
        block: why.name,
        through: b.name,
        before: `${why.raw}\n${b.raw}`,
        after: `${newWhy}\n${behaviour}`,
        touched,
        replaced,
        replaces: false,
        markersRemoved,
      };
    }
    return {
      block: b.name,
      before: b.raw,
      after: behaviour,
      touched,
      replaced,
      replaces: replaced.length > 0,
      markersRemoved,
    };
  }

  // Any other block: its full new lines. Each new or changed line gets its own provenance line; a changed line is paired
  // with the old line it replaced by content, never by position; markers and older provenance travel with their line.
  if (!out.lines) throw new DeltaRefused(`a ${out.block} delta carries the block's new lines`);
  if (out.changes) throw new DeltaRefused(`requirement changes belong to Behaviour, not ${out.block}`);
  if (out.why !== undefined) throw new DeltaRefused('`why` is for a seed; a Why delta carries its lines');
  for (const l of out.lines) {
    refuseLine(l, `a ${out.block} line`);
    if (/^\s*#/.test(l)) throw new DeltaRefused("no heading inside a block (R3.1's caps)");
    if (FR_LINE.test(l)) throw new DeltaRefused('numbered requirements live in Behaviour');
    if (PROV.test(l)) throw new DeltaRefused('bp writes provenance lines; the writer does not');
  }
  interface Unit {
    line: string;
    provs: string[];
    used: boolean;
  }
  const units: Unit[] = [];
  const lead: string[] = []; // provenance lines above the block's first line (rare; kept in place)
  for (const l of b.lines) {
    if (!l.trim()) continue;
    const last = units[units.length - 1];
    if (PROV.test(l)) (last ? last.provs : lead).push(l);
    else units.push({ line: l, provs: [], used: false });
  }
  const bare = (l: string): string => clean(stripMarkers(l));
  const plan: { text: string; unit: Unit | null; changed: boolean }[] = out.lines.map((l) => ({
    text: stripMarkers(l) || l.trim(),
    unit: null,
    changed: true,
  }));
  // First the lines that did not change (their markers aside), then the best textual match for each changed line.
  for (const p of plan) {
    if (!p.text) continue;
    const u = units.find((x) => !x.used && bare(x.line) === clean(p.text));
    if (u) {
      u.used = true;
      p.unit = u;
      p.changed = false;
    }
  }
  for (const p of plan) {
    if (!p.text || p.unit) continue;
    let best: Unit | null = null;
    let score = 0.4;
    for (const u of units.filter((x) => !x.used)) {
      const sc = similarity(bare(u.line), p.text);
      if (sc >= score) {
        best = u;
        score = sc;
      }
    }
    if (best) {
      best.used = true;
      p.unit = best;
    }
  }
  const body: string[] = [...lead];
  const emittedAfter = new Map<Unit, number>();
  for (const p of plan) {
    if (!p.text) {
      body.push('');
      continue;
    }
    if (p.unit && !p.changed) {
      body.push(unmark(p.unit.line), ...p.unit.provs);
      emittedAfter.set(p.unit, body.length);
      continue;
    }
    const carried = p.unit ? findMarkers(p.unit.line).filter((m) => !removable(m.inner)) : [];
    if (p.unit) for (const m of findMarkers(p.unit.line)) if (removable(m.inner)) markersRemoved.push(m.raw);
    const old = p.unit ? bare(p.unit.line) : null;
    const additive = old !== null && clean(p.text).includes(old.replace(/[.;:!]+$/, ''));
    if (old !== null && !additive) replaced.push({ target: `${out.block} line`, old, new: p.text });
    body.push(
      `${p.text}${carried.length ? ` ${carried.map((m) => m.raw).join(' ')}` : ''}`,
      ...(p.unit?.provs ?? []),
      prov(old !== null && !additive ? { replaces: old } : undefined),
    );
    if (p.unit) emittedAfter.set(p.unit, body.length);
    touched.push(`${out.block} line`);
  }
  // A line the delta removed outright is quoted on a provenance line where it stood (R3.2's supersession) — unless it
  // carries another row's marker, which a delta never drops.
  const removedUnits = units.filter((u) => !u.used);
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (!u || u.used) continue;
    const others = findMarkers(u.line).filter((m) => !removable(m.inner));
    if (others.length)
      throw new DeltaRefused(
        `the delta removes a ${out.block} line carrying another question's marker — a delta never drops another row's marker`,
      );
    for (const m of findMarkers(u.line)) markersRemoved.push(m.raw);
    replaced.push({ target: `${out.block} line`, old: bare(u.line), new: '' });
    let at = lead.length;
    for (let j = i - 1; j >= 0; j--) {
      const prev = units[j];
      const pos = prev ? emittedAfter.get(prev) : undefined;
      if (pos !== undefined) {
        at = pos;
        break;
      }
    }
    body.splice(at, 0, prov({ removes: bare(u.line) }));
    for (const [k, v] of emittedAfter) if (v >= at) emittedAfter.set(k, v + 1);
  }
  if (removedUnits.length) touched.push(`${out.block} line removed`);
  const after = [`## ${b.name}`, ...body].join('\n');
  return {
    block: b.name,
    before: b.raw,
    after,
    touched,
    replaced,
    replaces: GATED_BLOCKS.has(out.block) && replaced.length > 0,
    markersRemoved,
  };
}

/** R2.5 on the write path: a delta carrying a barred class is refused, never silently rewritten (doc-shape §6). */
export function contentCheck(text: string, barred: readonly string[]): string[] {
  return scan(text, barred);
}

// ---- R3.3 — six outcomes -----------------------------------------------------------------------------------------------

export type Outcome =
  | { kind: 'Clean' | 'Superseded' | 'Unverified'; after: string }
  | { kind: 'Patched'; after: string }
  | { kind: 'Kept'; objection: string }
  | { kind: 'Flagged'; objection: string; retry: boolean }
  | { kind: 'repair-check'; reason: string };

/** A quoted side of a Kept objection — or, where it carries a barred class, the class alone (resolve.md R3.6). */
const side = (text: string, barred: readonly string[]): string => {
  const classes = scan(text, barred);
  return classes.length ? `(withheld: ${classes.join(', ')})` : `"${text.slice(0, 200)}"`;
};

/** R3.6 then R3.3: the soft gate runs first and independently of the verdict; then the verdicts roll up. */
export function outcome(o: {
  assembled: Pick<Assembled, 'after' | 'replaced' | 'replaces' | 'touched'>;
  check: CheckerOutput | null;
  mode: 'force' | 'soft';
  writerRetried: boolean;
  checkerRepaired: boolean;
  feature: FeatureRec;
  barred?: readonly string[];
}): Outcome {
  const a = o.assembled;
  const barred = o.barred ?? [];
  if (o.mode === 'soft' && a.replaces) {
    const quoted = a.replaced.map(
      (r) =>
        `${r.target}: the document says ${side(r.old, barred)}; the answer says ${r.new ? side(r.new, barred) : '(nothing — it removes the line)'}`,
    );
    return {
      kind: 'Kept',
      objection: `soft mode: the answer would replace existing text — ${quoted.join(' · ')}. Nothing was written; set the row back to Answered and run resolve in the default mode to apply it`,
    };
  }
  if (!o.check) return { kind: 'Unverified', after: a.after };
  // One verdict for each requirement the delta touched, and none for a requirement it did not (R3.2).
  const touchedFr = new Set(a.touched.map((t) => /^FR-(\d+)/.exec(t)?.[1]).filter((x): x is string => !!x));
  const verdictFr = new Set(
    o.check.verdicts.map((v) => /\bFR-(\d+)\b/.exec(v.target)?.[1]).filter((x): x is string => !!x),
  );
  // A verdict on a requirement the delta did not touch is context (a Flagged one is an objection all the same); a touched
  // requirement with no verdict is unchecked, and unchecked is never Clean.
  const missing = [...touchedFr].filter((x) => !verdictFr.has(x));
  if (missing.length) {
    const why = `no verdict for ${missing.map((x) => `FR-${x}`).join(', ')}`;
    return o.checkerRepaired
      ? { kind: 'Flagged', objection: `the check returned ${why}`, retry: false }
      : { kind: 'repair-check', reason: `${why} — one verdict per requirement the delta touched (R3.2)` };
  }
  const flagged = o.check.verdicts.filter((v) => v.verdict === 'Flagged');
  if (flagged.length) {
    return {
      kind: 'Flagged',
      objection: flagged.map((v) => `${v.target}: ${v.inconsistency}`).join(' · '),
      retry: !o.writerRetried,
    };
  }
  const patches = o.check.verdicts.filter((v) => v.verdict === 'Patched');
  if (patches.length) {
    let after = a.after;
    for (const p of patches) {
      if (!p.patch)
        return o.checkerRepaired
          ? { kind: 'Flagged', objection: `${p.target}: a Patched verdict carried no patch`, retry: false }
          : { kind: 'repair-check', reason: `${p.target}: Patched without a patch` };
      if (!touchedFr.has(String(p.patch.fr))) {
        return o.checkerRepaired
          ? {
              kind: 'Flagged',
              objection: `${p.target}: the patch changes FR-${p.patch.fr}, which the delta did not touch`,
              retry: false,
            }
          : {
              kind: 'repair-check',
              reason: `the patch changes FR-${p.patch.fr}, which the delta did not touch — a patch completes the delta, never another requirement (R3.3)`,
            };
      }
      // The anchor is an excerpt of the requirement as it stands in the body — never of the proposal (R3.3); so a patch
      // only ever adds inside an existing requirement.
      const req = o.feature.body.requirements.find((r) => r.n === p.patch?.fr);
      if (!req || !req.text.includes(p.patch.anchor)) {
        return o.checkerRepaired
          ? {
              kind: 'Flagged',
              objection: `${p.target}: the patch's anchor is not an excerpt of FR-${p.patch.fr} as it stands`,
              retry: false,
            }
          : {
              kind: 'repair-check',
              reason: `the anchor "${p.patch.anchor}" is not in FR-${p.patch.fr} of the body as it stands — anchor in the body, never in the proposal (R3.3)`,
            };
      }
      const re = new RegExp(`^(FR-${p.patch.fr} — .*?${escapeRe(p.patch.anchor)})`, 'm');
      if (!re.test(after))
        return {
          kind: 'Flagged',
          objection: `${p.target}: the patch's anchor is not in the delta's FR-${p.patch.fr}`,
          retry: false,
        };
      if (/[\r\n]/.test(p.patch.addition))
        return { kind: 'Flagged', objection: `${p.target}: the patch's addition breaks the line`, retry: false };
      // A replacer function: `$&`, `$'` and friends in the addition are text, never replacement patterns.
      const addition = clean(stripMarkers(p.patch.addition));
      after = after.replace(re, (_m, head: string) => `${head} ${addition}`);
    }
    return { kind: 'Patched', after };
  }
  if (o.check.verdicts.some((v) => v.verdict === 'Superseded') || a.replaces)
    return { kind: 'Superseded', after: a.after };
  return { kind: 'Clean', after: a.after };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
