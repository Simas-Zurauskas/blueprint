import { findMarkers } from '../core/text.ts';
import { blockText } from '../core/hash.ts';
import { makeFeature, type FeatureRec, type Snapshot } from '../snapshot.ts';
import { scan, redact } from '../checks/content.ts';
import { assemble, DeltaRefused, GATED_BLOCKS, type Assembled, type Seam } from '../resolve/apply.ts';
import type { Item } from '../resolve/plan.ts';
import type { Question } from '../domain/question.ts';
import { proposalText } from '../resolve/project.ts';
import type { BlockWrite, Prepared, Write } from '../engine/writes.ts';
import type { AddDraft, Cite } from './draft.ts';

// add.md A3–A4 — from a checked draft to the statement printed at A3 and the serial queue A4 runs. The mode decides what
// a source-vs-document contradiction does: `force` writes the source's words over the text (quoted on the requirement),
// `soft` writes nothing over existing text and marks both places instead. A contradiction between two sources is marked
// in both modes — no winner exists to pick.

export type Mode = 'force' | 'soft';

export interface Con {
  id: string;
  between: 'sources' | 'source-and-document';
  entity: string;
  a: Cite;
  /** The other side: a second source, or the document text it contradicts. */
  b: { label: string; quote: string };
  feature?: string;
  disposition: string;
}

export interface Plan {
  cons: Con[];
  queue: Write[];
  /** What A3 and the report print, line by line. */
  statement: string[];
  /** Supersessions reported first (A4 step 5's three classes): the requirement, why it is reported first, old and new. */
  reportedFirst: string[];
  newAreas: string[];
  /** Items the draft carried that bp will not write, and why. */
  refused: string[];
}

const label = (c: Cite): string => `${c.source.replace(/^\d+-/, '').replace(/\.[a-z]+$/, '')} ${c.at}`;
const byName = (s: Snapshot, name: string): FeatureRec | undefined =>
  s.features.find((f) => f.name === name) ?? s.features.find((f) => f.name.toLowerCase() === name.toLowerCase());

/** The provenance line add writes (add.md A4 step 5; doc-shape §5): the source segment, never a question row. */
export function addProvenance(o: {
  date: string;
  cite: Cite;
  reason: string;
  replaces?: string;
  removes?: string;
}): string {
  const q = (t: string): string => `"${t.replace(/"/g, "'")}"`;
  const head = o.replaces || o.removes ? 'Superseded' : 'Added';
  const tail = o.replaces ? `previously: ${q(o.replaces)}` : o.removes ? `removed: ${q(o.removes)}` : o.reason;
  return `*(${head} ${o.date} from «${label(o.cite).replace(/[«»]/g, '"')}» · depth 1 — ${tail.replace(/\.$/, '')}.)*`;
}

export const markerText = (entity: string, tail = 'carried'): string =>
  `[NEEDS CLARIFICATION: ${entity.replace(/[[\]]/g, '')} → Question: ${tail}]`;

/** The pseudo-item assemble needs: add cites a source segment, so the row fields are unused. */
const itemFor = (f: FeatureRec): Item => ({
  row: {
    id: '',
    question: '',
    status: 'Answered',
    statusRaw: 'Answered',
    owner: '',
    answer: '',
    whyAsked: '',
    directions: '',
    whyFlagged: '',
    touches: [],
    created: null,
    adHoc: [],
  } satisfies Question,
  reading: { kind: 'prose' },
  path: 'single',
  features: [f],
  markers: [],
  depth: 1,
  seed: false,
});

export interface ChangeSpec {
  type: 'change';
  index: number;
}
export interface MarkerSpec {
  type: 'marker';
  block: string;
  fr: number | null;
  text: string;
}
export type AddSpec = ChangeSpec | MarkerSpec;

export function planAdd(o: {
  draft: AddDraft;
  s: Snapshot;
  mode: Mode;
  runId: string;
  date: string;
  nowIso: string;
  barred: readonly string[];
}): Plan {
  const { draft: d, s, mode } = o;
  const cons: Con[] = [];
  const queue: Write[] = [];
  const statement: string[] = [];
  const reportedFirst: string[] = [];
  const refused: string[] = [];
  const conRef = (id: string): string => `carried (${id} · run-log ${o.date}-add-${o.runId})`;
  const safe = (t: string): string => redact(t, o.barred);
  let keyN = 0;
  const key = (p: string): string => `${p}-${++keyN}`;
  const block = (page: string, lab: string, spec: AddSpec): BlockWrite => ({
    kind: 'block',
    key: key('w'),
    stage: 'plan',
    plannedAt: '',
    page,
    label: lab,
    spec,
  });

  // New features first: a change, a marker or a conflict below may name one.
  const areas = new Set(s.features.map((f) => f.area));
  const newAreas: string[] = [];
  const created = new Map<string, string>();
  for (const n of d.newFeatures) {
    if (!areas.has(n.area) && !newAreas.includes(n.area)) newAreas.push(n.area);
    const k = key('feature');
    created.set(n.name.toLowerCase(), k);
    const prov = addProvenance({ date: o.date, cite: n.cite, reason: 'written from the source' });
    const gaps = d.gaps.filter((g) => g.feature.toLowerCase() === n.name.toLowerCase());
    const gapLines = (b: string): string[] =>
      gaps
        .filter((g) => g.block === b)
        .map((g) => (b === 'Behaviour' ? markerText(g.entity) : `- ${markerText(g.entity)}`));
    const body = [
      '## Why',
      n.why.trim(),
      prov,
      ...gapLines('Why'),
      '## Behaviour',
      ...(n.fr1 ? [`FR-1 — ${n.fr1.trim()}`, prov] : []),
      ...gapLines('Behaviour'),
      '## Edge cases',
      ...gapLines('Edge cases'),
      '## Rabbit holes',
      ...gapLines('Rabbit holes'),
      '## Not doing',
      ...n.notDoing.map((l) => (l.startsWith('- ') ? l : `- ${l}`)),
      ...gapLines('Not doing'),
    ].join('\n');
    queue.push({
      kind: 'create-feature',
      key: k,
      stage: 'plan',
      plannedAt: '',
      name: n.name,
      area: n.area,
      whatItDoes: n.whatItDoes,
      body: `${body}\n`,
      created: o.date,
    });
    statement.push(
      `NEW      «${n.name}» (${n.area}${areas.has(n.area) ? '' : ', a new Area'})${n.fr1 ? ', with FR-1 written from the source' : ' — no source states a first requirement, so none is written'}   ← ${label(n.cite)}`,
    );
  }

  // Changes to existing features: an addition is written in both modes; a supersession only in force.
  const blockOwner = firstDeltaPerBlock(d);
  d.changes.forEach((c, i) => {
    const f = byName(s, c.feature);
    if (!f) return;
    const owner = blockOwner.get(blockKey(c));
    if (owner !== undefined && owner !== i) {
      refused.push(
        `«${f.name}» ${c.delta.block} — not written: change ${owner + 1} already writes this block, and a second delta would replace its lines`,
      );
      return;
    }
    // Is it a replacement? Declared by the drafter, or found by assembling it against the page as it stands.
    let assembled: Assembled;
    try {
      assembled = assemble({
        item: itemFor(f),
        feature: f,
        out: { output: 'delta', ...c.delta },
        date: o.date,
        kinds: new Set(),
        seam: seamFor(c.cite, c.delta.groundingKind, o.date, c.settles ?? []),
      });
    } catch (err) {
      if (!(err instanceof DeltaRefused)) throw err;
      refused.push(`«${f.name}» ${c.delta.block} — not written: ${err.message}`);
      return;
    }
    const loss = undeclaredLoss(c, assembled);
    if (loss) {
      refused.push(`«${f.name}» ${c.delta.block} — not written: ${loss}`);
      return;
    }
    const replaces = c.supersedes !== undefined || (GATED_BLOCKS.has(c.delta.block) && assembled.replaced.length > 0);
    const target = c.supersedes?.target ?? assembled.touched.join(', ');
    if (replaces) {
      const id = `CON-${cons.length + 1}`;
      const old = c.supersedes?.old ?? assembled.replaced.map((r) => r.old).join(' / ');
      if (mode === 'soft') {
        cons.push({
          id,
          between: 'source-and-document',
          entity: `«${f.name}» ${target}`,
          a: c.cite,
          b: { label: `«${f.name}» ${target}`, quote: old },
          feature: f.name,
          disposition: `carried marker on «${f.name}» ${target} — soft mode writes nothing over existing text`,
        });
        queue.push(
          block(f.id, f.name, {
            type: 'marker',
            block: c.delta.block,
            fr: frOf(target),
            text: markerText(`«${f.name}» ${target}: the source and the document disagree (${id})`, conRef(id)),
          }),
        );
        statement.push(
          `MARKED   «${f.name}» ${target} — the source contradicts it; soft mode writes nothing over it (${id})   ← ${label(c.cite)}`,
        );
        return;
      }
      cons.push({
        id,
        between: 'source-and-document',
        entity: `«${f.name}» ${target}`,
        a: c.cite,
        b: { label: `«${f.name}» ${target}`, quote: old },
        feature: f.name,
        disposition: `superseded at A4 step 5 — «${f.name}» ${target}, by ${label(c.cite)}`,
      });
      const handWritten = !f.body.requirements.some((r) => target.includes(`FR-${r.n}`) && r.provenance.length);
      const ratified = /ratified \d{4}-\d{2}-\d{2}/.test(old);
      if (handWritten || ratified)
        reportedFirst.push(
          `«${f.name}» ${target} — ${ratified ? 'a ratified convention default' : 'no run provenance line: somebody wrote it by hand'} · was: "${safe(old).slice(0, 160)}" · now: the source's words (${label(c.cite)})`,
        );
      statement.push(
        `SUPERSEDES «${f.name}» ${target} — ${label(c.cite)} contradicts it; the source wins and the replaced text is quoted on the line (${id})`,
      );
    } else {
      statement.push(
        `CHANGES  «${f.name}» ${assembled.touched.join(', ') || c.delta.block}${c.alsoCandidates?.length ? ` (could also be ${c.alsoCandidates.map((x) => `«${x}»`).join(', ')} — placed here; one word to the next add moves it)` : ''}   ← ${label(c.cite)}`,
      );
    }
    queue.push(block(f.id, f.name, { type: 'change', index: i }));
  });

  // Conflicts between sources: no winner; both places marked, both quotes kept out of record/.
  for (const c of d.conflicts) {
    const id = `CON-${cons.length + 1}`;
    const f = c.feature ? byName(s, c.feature) : undefined;
    const createdKey = c.feature ? created.get(c.feature.toLowerCase()) : undefined;
    cons.push({
      id,
      between: 'sources',
      entity: c.entity,
      a: c.a,
      b: { label: label(c.b), quote: c.b.quote },
      ...(c.feature ? { feature: c.feature } : {}),
      disposition:
        f || createdKey
          ? `carried marker on «${c.feature ?? ''}» — the challenge handoff writes its one question`
          : 'no feature to mark — the challenge handoff writes its one question',
    });
    if (f)
      queue.push(
        block(f.id, f.name, {
          type: 'marker',
          block: c.block ?? 'Behaviour',
          fr: null,
          text: markerText(`${c.entity}: the sources disagree (${id})`, conRef(id)),
        }),
      );
    statement.push(
      `SOURCES DISAGREE ${id} — ${safe(c.entity)} · ${label(c.a)} vs ${label(c.b)} — both places marked, one question, no winner picked`,
    );
  }

  // Gaps on existing features: a marker where the unknown bites.
  for (const g of d.gaps) {
    const f = byName(s, g.feature);
    if (!f) continue; // a new feature's gaps are in its created body
    queue.push(block(f.id, f.name, { type: 'marker', block: g.block, fr: g.fr, text: markerText(g.entity) }));
  }
  if (d.gaps.length)
    statement.push(
      `GAPS     ${d.gaps.length} — become [NEEDS CLARIFICATION] markers; the challenge handoff proposes their questions`,
    );

  // Overview blocks: never written here — a project-level question row carries the block, verbatim, for a person to accept.
  for (const ov of d.overview) {
    const { append } = proposalText({ runId: o.runId, date: o.date, block: ov.block, body: ov.text });
    const quote = scan(ov.cite.quote, o.barred).length
      ? ''
      : ` — "${ov.cite.quote.replace(/\s+/g, ' ').slice(0, 200)}"`;
    queue.push({
      kind: 'create-question',
      key: key('question'),
      stage: 'plan',
      plannedAt: '',
      question: ov.question,
      status: 'Open',
      whyAsked: `${label(ov.cite)} changes the overview's «${ov.block}» block${quote}. The front door is never written without your acceptance: set this row to Answered to accept the proposed block text below as it stands, or write your own under a "## ${ov.block}" line in Answer & why. · depth 1\n\n${append}`,
      touches: [],
      created: o.date,
    });
    statement.push(
      `OVERVIEW «${ov.block}» — drafted into a project-level question row for your words; this run writes no overview block   ← ${label(ov.cite)}`,
    );
  }

  const notUsed = d.inventory.filter((x) => x.lands === 'not-used');
  if (notUsed.length)
    statement.push(
      `NOT USED ${notUsed.map((x) => `${label(x.cite)} (${x.note ?? 'unresolved — nobody has been asked'})`).join(' · ')}`,
    );
  const covered = d.inventory.filter((x) => x.lands === 'already-covered');
  if (covered.length)
    statement.push(
      `ALREADY COVERED ${covered.map((x) => `${label(x.cite)} — ${x.note ?? x.target ?? ''}`).join(' · ')}`,
    );
  if (newAreas.length)
    statement.unshift(
      `NEW AREA ${newAreas.map((a) => `«${a}»`).join(', ')} — named first: Areas are shared vocabulary; one word to the next add renames it`,
    );
  return { cons, queue, statement: statement.map(safe), reportedFirst, newAreas, refused };
}

/**
 * The planner's own refusals, run on a draft before it is accepted (A2): a change `assemble` would refuse — `why` outside a
 * seed, requirement changes outside Behaviour, a tombstone rewritten — goes back to the drafter for its one retry, rather
 * than surfacing only as NOT WRITTEN once the draft is spent (a measured run lost all 69 of its changes that way).
 */
export function deltaProblems(d: AddDraft, s: Snapshot, date: string): string[] {
  const out: string[] = [];
  const blockOwner = firstDeltaPerBlock(d);
  d.changes.forEach((c, i) => {
    const f = byName(s, c.feature);
    if (!f) return; // draftProblems names a feature that does not exist
    const where = `change ${i + 1} («${c.feature}») ${c.delta.block}`;
    const owner = blockOwner.get(blockKey(c));
    if (owner !== undefined && owner !== i) {
      out.push(
        `${where}: change ${owner + 1} already writes this block — give one feature's block one delta, its \`lines\` the block's complete content`,
      );
      return;
    }
    try {
      const a = assemble({
        item: itemFor(f),
        feature: f,
        out: { output: 'delta', ...c.delta },
        date,
        kinds: new Set(),
        seam: seamFor(c.cite, c.delta.groundingKind, date, c.settles ?? []),
      });
      const loss = undeclaredLoss(c, a);
      if (loss) out.push(`${where}: ${loss}`);
    } catch (err) {
      if (!(err instanceof DeltaRefused)) throw err;
      out.push(`${where}: ${err.message}`);
    }
  });
  return out;
}

// A non-Behaviour delta's `lines` are the block's complete new content (resolve/apply.ts): two deltas to one block would
// each replace the other's lines, so only the first is written.
const blockKey = (c: AddDraft['changes'][number]): string =>
  c.delta.block === 'Behaviour' ? '' : `${c.feature.toLowerCase()}\u0000${c.delta.block}`;

function firstDeltaPerBlock(d: AddDraft): Map<string, number> {
  const owner = new Map<string, number>();
  d.changes.forEach((c, i) => {
    const k = blockKey(c);
    if (k && !owner.has(k)) owner.set(k, i);
  });
  return owner;
}

/**
 * What a non-Behaviour delta would take off the page without declaring it (A4 step 5): an existing line its `lines` leave
 * out is removed, and one they reword is replaced. Only a declared supersession — the source contradicting that line — may
 * do either; anything else deletes text no source contradicted (a measured run's plan would have emptied 14 blocks).
 */
function undeclaredLoss(c: AddDraft['changes'][number], a: Assembled): string | null {
  if (c.delta.block === 'Behaviour') return null;
  const norm = (t: string): string =>
    t
      .replace(/\\/g, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*-\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const declared = c.supersedes ? norm(c.supersedes.old) : '';
  const lost = a.replaced.filter((r) => r.old && !(declared && declared.includes(norm(r.old))));
  const first = lost[0];
  if (!first) return null;
  return `leaves out or rewords ${lost.length} existing ${c.delta.block} line${lost.length === 1 ? '' : 's'} it does not declare superseded, first "${first.old.slice(0, 80)}…" — \`lines\` is the block's complete content: repeat every line you keep verbatim, and set \`supersedes\` only for a line the source contradicts`;
}

const frOf = (target: string): number | null => {
  const m = /FR-(\d+)/.exec(target);
  return m?.[1] ? Number(m[1]) : null;
};

function seamFor(cite: Cite, reason: string, date: string, settles: readonly string[]): Seam {
  const norm = (t: string): string => t.replace(/\\/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return {
    provenance: (change) =>
      addProvenance({
        date,
        cite,
        reason,
        ...(change?.replaces ? { replaces: change.replaces } : {}),
        ...(change?.removes ? { removes: change.removes } : {}),
      }),
    // Route 8: a marker this change's material answers goes in the same act — matched on the marker's own text.
    removes: (inner) =>
      settles.some((t) => norm(inner).includes(norm(t)) || norm(t).includes(norm(inner.split('→')[0] ?? ''))),
  };
}

/**
 * Build a queued block write's text from the page as it now stands — so a second write to one feature is assembled on the
 * text the first write left (the serial commit path).
 */
export function prepareAdd(draft: AddDraft, date: string, s: Snapshot, w: BlockWrite, current: string): Prepared {
  const spec = w.spec as AddSpec;
  const base = s.features.find((x) => x.id === w.page);
  if (!base) return { error: `no feature ${w.page}` };
  const f = makeFeature({ ...base, content: current || base.content });
  if (spec.type === 'marker') {
    const b = f.body.blocks.find((x) => x.known === spec.block);
    if (!b) return { error: `«${f.name}» has no ${spec.block} block to mark` };
    const text = spec.text;
    if (findMarkers(b.raw).some((m) => m.raw.replace(/\\/g, '') === text))
      return { skip: 'the marker is already there' };
    const lines = [...b.lines];
    const at =
      spec.fr === null ? -1 : lines.findIndex((l) => new RegExp(`^\\s*(?:[-*]\\s+)?\\**FR-${spec.fr}\\b`).test(l));
    if (at >= 0) lines[at] = `${(lines[at] ?? '').replace(/\s+$/, '')} ${text}`;
    else {
      let end = lines.length;
      while (end > 0 && !(lines[end - 1] ?? '').trim()) end--;
      lines.splice(end, 0, spec.block === 'Behaviour' || spec.block === 'Why' ? text : `- ${text}`);
    }
    return { block: b.name, before: b.raw, after: [`## ${b.name}`, ...lines].join('\n') };
  }
  const c = draft.changes[spec.index];
  if (!c) return { error: 'the change is gone from the draft' };
  try {
    const a = assemble({
      item: itemFor(f),
      feature: f,
      out: { output: 'delta', ...c.delta },
      date,
      kinds: new Set(),
      seam: seamFor(c.cite, c.delta.groundingKind, date, c.settles ?? []),
    });
    return { block: a.block, ...(a.through ? { through: a.through } : {}), before: a.before, after: a.after };
  } catch (err) {
    if (err instanceof DeltaRefused) return { error: err.message };
    throw err;
  }
}

/** The block a change will touch, as the page stands — for the faithfulness brief. */
export const blockOn = (content: string, name: string): string => blockText(content, name) ?? '';
