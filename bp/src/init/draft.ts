import { array, nullable, object, oneOf, optional, string, type Infer } from '../core/schema.ts';
import { quoteFound } from '../core/text.ts';
import { FEATURE_BLOCKS, type FeatureBlock } from '../domain/vocab.ts';
import { scan } from '../checks/content.ts';
import { data } from '../tasks/tasks.ts';
import { makeFeature, type FeatureRec, type Snapshot } from '../snapshot.ts';

// init.md I2–I3 — the skeleton. One drafting task reads the whole source record and returns the overview's human blocks,
// the features with every requirement cited, the exclusions, the contradictions (numbered CON-k by bp) and the gaps; bp
// checks every quote against its source and renders the one screen the human confirms at I3 — the block text itself,
// never only the names (doc-shape §3's first-write carve-out attaches to these words).

const Cite = object({
  source: string({ min: 1, max: 120 }),
  at: string({ min: 1, max: 80 }),
  quote: string({ min: 1, max: 800 }),
});
export type InitCite = Infer<typeof Cite>;

export const InitDraftSchema = object({
  overview: object({
    tldr: string({ min: 1, max: 600 }),
    /** One paragraph ending in a one-sentence NOT-clause naming the kind of thing the product refuses. */
    whatItIs: string({ min: 1, max: 1500 }),
    /** One line per real user kind — never "users" — and an optional closing `Not for:` line. */
    whoFor: array(string({ min: 1, max: 300 }), { min: 1, max: 4 }),
    /** The picture's nodes, in order (≤ 9). */
    picture: array(string({ min: 1, max: 60 }), { max: 9 }),
    /** Material a reader can open, or material named (never a path). */
    links: array(string({ max: 300 }), { max: 8 }),
    cites: array(Cite, { max: 12 }),
  }),
  features: array(
    object({
      name: string({ min: 1, max: 120 }),
      area: string({ min: 1, max: 60 }),
      whatItDoes: string({ min: 1, max: 300 }),
      why: string({ min: 1, max: 1500 }),
      requirements: array(object({ text: string({ min: 1, max: 1200 }), cite: Cite }), { max: 30 }),
      edgeCases: array(object({ text: string({ min: 1, max: 600 }), cite: Cite }), { max: 20 }),
      notDoing: array(object({ text: string({ min: 1, max: 400 }), cite: Cite }), { max: 12 }),
      cite: Cite,
    }),
    { max: 80 },
  ),
  /** Two sources disagree, or one with itself — listed, never dissolved; bp numbers them CON-1… */
  contradictions: array(
    object({
      a: Cite,
      b: Cite,
      entity: string({ min: 1, max: 300 }),
      feature: nullable(string({ max: 120 })),
      block: optional(oneOf(FEATURE_BLOCKS)),
      reading: optional(string({ max: 400 })),
    }),
    { max: 40 },
  ),
  /** What a row will need and no source supplies — a marker naming the entity, where the unknown bites. */
  gaps: array(
    object({
      feature: nullable(string({ max: 120 })),
      block: oneOf([...FEATURE_BLOCKS, 'overview'] as const),
      entity: string({ min: 1, max: 300 }),
    }),
    { max: 80 },
  ),
  /** Every meaningful segment's destination; "not used" asked of a named person, never composed. */
  inventory: array(
    object({
      cite: Cite,
      lands: oneOf(['feature', 'not-doing', 'overview', 'not-used'] as const),
      target: optional(string({ max: 200 })),
      note: optional(string({ max: 400 })),
    }),
    { max: 500 },
  ),
  directives: array(object({ cite: Cite, text: string({ max: 400 }) }), { max: 40 }),
  /** After an I3 reply that answered something on the screen: the CON-k or gap it settled, in the human's words. */
  settledAtI3: optional(
    array(object({ what: string({ min: 1, max: 300 }), words: string({ min: 1, max: 800 }) }), { max: 40 }),
  ),
});
export type InitDraft = Infer<typeof InitDraftSchema>;

export function initDraftProblems(
  d: InitDraft,
  sources: ReadonlyMap<string, string>,
  barred: readonly string[],
): string | null {
  const out: string[] = [];
  const cite = (c: InitCite, where: string): void => {
    const t = sources.get(c.source);
    if (t === undefined) out.push(`${where}: no captured source is named "${c.source}"`);
    else if (!quoteFound(t, c.quote)) out.push(`${where}: "${c.quote.slice(0, 60)}…" is not in ${c.source} verbatim`);
  };
  d.overview.cites.forEach((c, i) => cite(c, `overview cite ${i + 1}`));
  const names = new Set<string>();
  d.features.forEach((f, i) => {
    const where = `feature ${i + 1} («${f.name}»)`;
    if (names.has(f.name.toLowerCase())) out.push(`${where}: two features share this name`);
    names.add(f.name.toLowerCase());
    cite(f.cite, where);
    f.requirements.forEach((r, k) => cite(r.cite, `${where} FR-${k + 1}`));
    f.edgeCases.forEach((r, k) => cite(r.cite, `${where} edge case ${k + 1}`));
    f.notDoing.forEach((r, k) => cite(r.cite, `${where} Not doing ${k + 1}`));
    const leaks = scan(
      [
        f.name,
        f.whatItDoes,
        f.why,
        ...f.requirements.map((r) => r.text),
        ...f.edgeCases.map((r) => r.text),
        ...f.notDoing.map((r) => r.text),
      ].join('\n'),
      barred,
    );
    if (leaks.length)
      out.push(`${where}: the text carries ${leaks.join(' and ')} — write the role, never the specific`);
  });
  const ovLeaks = scan(
    [d.overview.tldr, d.overview.whatItIs, ...d.overview.whoFor, ...d.overview.links].join('\n'),
    barred,
  );
  if (ovLeaks.length) out.push(`the overview carries ${ovLeaks.join(' and ')} — write the role, never the specific`);
  if (d.overview.links.some((l) => PATH_RE.test(l)))
    out.push('Links carries a machine-local path — name the material, or link what a reader can open (doc-shape §3)');
  d.contradictions.forEach((c, i) => {
    cite(c.a, `contradiction ${i + 1}, side a`);
    cite(c.b, `contradiction ${i + 1}, side b`);
    if (c.feature && !names.has(c.feature.toLowerCase()))
      out.push(`contradiction ${i + 1}: no drafted feature is named «${c.feature}»`);
  });
  d.gaps.forEach((g, i) => {
    if (g.feature && !names.has(g.feature.toLowerCase()))
      out.push(`gap ${i + 1}: no drafted feature is named «${g.feature}»`);
  });
  d.inventory.forEach((x, i) => cite(x.cite, `inventory ${i + 1}`));
  return out.length ? out.join('\n') : null;
}

/**
 * What a twice-failed draft still gets wrong is dropped item by item and reported at I3, never written (rule 6(d)): an
 * item whose quote is not in its source, a second feature of the same name, a Links line that is a machine-local path.
 * A gap or a contradiction naming a feature the draft does not have becomes project-level. What is left — the content
 * rule — the caller refuses to write.
 */
export function dropUncited(d: InitDraft, sources: ReadonlyMap<string, string>): string[] {
  const dropped: string[] = [];
  const ok = (c: InitCite): boolean => {
    const t = sources.get(c.source);
    return t !== undefined && quoteFound(t, c.quote);
  };
  const keep = <T>(list: T[], good: (x: T) => boolean, name: (x: T) => string): T[] =>
    list.filter((x) => {
      if (good(x)) return true;
      dropped.push(name(x));
      return false;
    });
  d.overview.cites = keep(d.overview.cites, ok, (c) => `an overview citation (${c.source} ${c.at})`);
  d.overview.links = keep(
    d.overview.links,
    (l) => !PATH_RE.test(l),
    (l) => `a Links line that is a machine-local path ("${l.slice(0, 60)}")`,
  );
  const names = new Set<string>();
  d.features = keep(
    d.features,
    (f) => ok(f.cite) && !names.has(f.name.toLowerCase()) && Boolean(names.add(f.name.toLowerCase())),
    (f) => `feature «${f.name}» (${f.cite.source} ${f.cite.at})`,
  );
  for (const f of d.features) {
    f.requirements = keep(
      f.requirements,
      (r) => ok(r.cite),
      (r) => `«${f.name}» requirement "${r.text.slice(0, 60)}" (${r.cite.source} ${r.cite.at})`,
    );
    f.edgeCases = keep(
      f.edgeCases,
      (r) => ok(r.cite),
      (r) => `«${f.name}» edge case "${r.text.slice(0, 60)}" (${r.cite.source} ${r.cite.at})`,
    );
    f.notDoing = keep(
      f.notDoing,
      (r) => ok(r.cite),
      (r) => `«${f.name}» Not doing "${r.text.slice(0, 60)}" (${r.cite.source} ${r.cite.at})`,
    );
  }
  d.contradictions = keep(
    d.contradictions,
    (c) => ok(c.a) && ok(c.b),
    (c) => `contradiction on ${c.entity} (${c.a.source} ${c.a.at} vs ${c.b.source} ${c.b.at})`,
  );
  d.inventory = keep(
    d.inventory,
    (x) => ok(x.cite),
    (x) => `inventory segment ${x.cite.source} ${x.cite.at}`,
  );
  for (const c of d.contradictions) if (c.feature && !names.has(c.feature.toLowerCase())) c.feature = null;
  for (const g of d.gaps) if (g.feature && !names.has(g.feature.toLowerCase())) g.feature = null;
  return dropped;
}

const PATH_RE = /(^|\s)(\/|~\/|\.\.?\/|[A-Za-z]:\\|file:\/\/)|\b(sources|record|cache|\.blueprint)\//;

export function initDraftBrief(o: {
  sources: ReadonlyMap<string, string>;
  existingOverview: string;
  reply?: string;
  previous?: InitDraft;
  grillFinds?: string[];
}): string {
  return [
    '# Init — draft the skeleton (init.md I2)',
    '',
    ...[...o.sources].map(([file, text]) => data(`source ${file}`, text)),
    data(
      'the overview page as it stands (a human may have written on it: never clobbered)',
      o.existingOverview || '(empty)',
    ),
    ...(o.grillFinds?.length
      ? [
          '',
          '## What the grill found in your previous draft — each is a gap or a contradiction to list',
          data('grill finds', o.grillFinds.join('\n')),
        ]
      : []),
    ...(o.previous && o.reply
      ? [
          '',
          "## The human's reply at the stop — apply exactly what it asks; list what it answered in settledAtI3, in their words",
          data('your previous draft', JSON.stringify(o.previous)),
          data("the human's reply, verbatim", o.reply),
        ]
      : []),
  ].join('\n');
}

const conMarker = (id: string, entity: string, runId: string, date: string): string =>
  `[NEEDS CLARIFICATION: ${entity.replace(/[[\]]/g, '')}: the sources disagree (${id}) → Question: carried (${id} · run-log ${date}-init-${runId})]`;
const gapMarker = (entity: string): string =>
  `[NEEDS CLARIFICATION: ${entity.replace(/[[\]]/g, '')} → Question: carried]`;

export interface Con {
  id: string;
  entity: string;
  a: InitCite;
  b: InitCite;
  feature: string | null;
  block: FeatureBlock;
  reading?: string;
}

/**
 * Number the contradictions CON-1… — once. A re-draft after an I3 edit keeps every earlier number and every earlier
 * contradiction (the same pair of quotes is the same CON-k), and numbers only what is new: I7's conservation check counts
 * what I2 found, and a contradiction that vanished between drafts is exactly the defect the numbering makes impossible.
 */
export function numberCons(d: InitDraft, prior: readonly Con[] = []): Con[] {
  const key = (a: InitCite, b: InitCite): string => [a.source, a.quote, b.source, b.quote].join('\u0000');
  const out = [...prior];
  for (const c of d.contradictions) {
    const next = {
      entity: c.entity,
      a: c.a,
      b: c.b,
      feature: c.feature,
      block: c.block ?? 'Behaviour',
      ...(c.reading ? { reading: c.reading } : {}),
    };
    const i = out.findIndex((x) => key(x.a, x.b) === key(c.a, c.b) || key(x.a, x.b) === key(c.b, c.a));
    const was = out[i];
    if (was) out[i] = { ...next, id: was.id };
    else out.push({ ...next, id: `CON-${out.length + 1}` });
  }
  return out;
}

/** The CON-k the human's I3 reply settled, by the drafter's own record of it (settledAtI3 names the id). */
export function settledCons(d: InitDraft, cons: readonly Con[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cons) {
    const hit = d.settledAtI3?.find((x) => new RegExp(`\\b${c.id}\\b`).test(x.what));
    if (hit) out.set(c.id, hit.words);
  }
  return out;
}

/** Where a contradiction's marker sits: its feature's block, or — a project-level one, or one whose feature an edit cut —
 * the overview's product paragraph. */
const homeOf = (c: Con, d: InitDraft): string | null => {
  const f = c.feature?.toLowerCase();
  return f && d.features.some((x) => x.name.toLowerCase() === f) ? f : null;
};

/** A feature's body at creation (doc-shape §5): the five blocks, every requirement numbered, every gap a carried marker. */
export function bodyOf(
  f: InitDraft['features'][number],
  d: InitDraft,
  cons: readonly Con[],
  runId: string,
  date: string,
): string {
  const lower = f.name.toLowerCase();
  const gaps = (b: string): string[] =>
    d.gaps.filter((g) => g.feature?.toLowerCase() === lower && g.block === b).map((g) => gapMarker(g.entity));
  const settled = settledCons(d, cons);
  const conflicts = (b: string): string[] =>
    cons
      .filter((c) => !settled.has(c.id) && homeOf(c, d) === lower && c.block === b)
      .map((c) => conMarker(c.id, c.entity, runId, date));
  const bullet = (l: string): string => (l.startsWith('- ') ? l : `- ${l}`);
  return [
    '## Why',
    f.why.trim(),
    ...gaps('Why'),
    '## Behaviour',
    ...f.requirements.map((r, i) => `FR-${i + 1} — ${r.text.trim()}`),
    ...gaps('Behaviour'),
    ...conflicts('Behaviour'),
    '## Edge cases',
    ...f.edgeCases.map((e) => bullet(e.text.trim())),
    ...gaps('Edge cases').map(bullet),
    ...conflicts('Edge cases').map(bullet),
    '## Rabbit holes',
    ...gaps('Rabbit holes').map(bullet),
    '## Not doing',
    ...f.notDoing.map((n) => bullet(n.text.trim())),
    ...gaps('Not doing').map(bullet),
    ...conflicts('Not doing').map(bullet),
    '',
  ].join('\n');
}

/** The overview's human blocks as they will be written (doc-shape §3), with the two ⟳ headings the views sit under. */
export function overviewBlocks(
  d: InitDraft,
  o: { cons: readonly Con[]; runLog: string | null; register: string; date: string; runId: string },
): { heading: string; body: string }[] {
  const settled = settledCons(d, o.cons);
  const names = new Set(d.features.map((f) => f.name.toLowerCase()));
  const overviewGaps = [
    ...d.gaps
      .filter((g) => g.block === 'overview' || !g.feature || !names.has(g.feature.toLowerCase()))
      .map((g) => gapMarker(g.entity)),
    ...o.cons
      .filter((c) => !settled.has(c.id) && homeOf(c, d) === null)
      .map((c) => conMarker(c.id, c.entity, o.runId, o.date)),
  ];
  const mermaid = d.overview.picture.length
    ? [
        '```mermaid',
        'flowchart LR',
        ...d.overview.picture
          .slice(0, 9)
          .map((n, i, all) =>
            i < all.length - 1
              ? `  n${i}["${n.replace(/"/g, "'")}"] --> n${i + 1}["${(all[i + 1] ?? '').replace(/"/g, "'")}"]`
              : '',
          )
          .filter(Boolean),
        '```',
      ].join('\n')
    : gapMarker('the picture of how the product works — no source draws it');
  return [
    { heading: 'TL;DR', body: d.overview.tldr.trim() },
    { heading: 'What this product is', body: [d.overview.whatItIs.trim(), ...overviewGaps].join('\n') },
    { heading: "Who it's for", body: d.overview.whoFor.map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n') },
    { heading: 'How it works, in one picture', body: mermaid },
    {
      heading: 'Links',
      body: d.overview.links.length
        ? d.overview.links.map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n')
        : '- Source material captured at this run and held outside version control.',
    },
    {
      heading: 'Operating',
      body: [
        o.runLog
          ? `- Run record: [the Blueprint run log](${o.runLog})`
          : '- Run record: not yet published — the working folder is in no repository a reader can open.',
        `- **Always-ask register (${o.date}):** ${o.register}`,
      ].join('\n'),
    },
  ];
}

/** The I3 screen — the block text itself, every feature and its source, every contradiction, the gaps, the unused. */
export function skeletonScreen(
  d: InitDraft,
  o: { cons: readonly Con[]; target: string; grilled: number; blocks: { heading: string; body: string }[] },
): string[] {
  const areas = new Map<string, number>();
  for (const f of d.features) areas.set(f.area, (areas.get(f.area) ?? 0) + 1);
  const notUsed = d.inventory.filter((x) => x.lands === 'not-used');
  const exclusions = d.features.flatMap((f) => f.notDoing.map((n) => `«${f.name}»: ${n.text}`));
  return [
    'BLUEPRINT SKELETON — proposed. Nothing has been created.',
    `target: ${o.target}`,
    '',
    'OVERVIEW — the human blocks, verbatim as they will be written:',
    ...o.blocks
      .filter((b) => b.heading !== 'Operating')
      .flatMap((b) => [`  ${b.heading.toUpperCase()}`, ...b.body.split('\n').map((l) => `    ${l}`)]),
    `AREAS      ${[...areas].map(([a, n]) => `${a} (${n})`).join(' · ') || '(none)'}`,
    `FEATURES   ${d.features.length} rows`,
    ...d.features.map(
      (f) =>
        `    ${f.area} · ${f.name} — ${f.whatItDoes}   ← ${f.cite.source} ${f.cite.at} · ${f.requirements.length} requirement(s)`,
    ),
    `NOT DOING  ${exclusions.length} line(s)${exclusions.length ? ` — ${exclusions.join(' · ')}` : ' — no source says what this product will not do: the question is asked again'}`,
    `CONTRADICTIONS  ${o.cons.length ? '' : 'none'}`,
    ...o.cons.map((c) =>
      settledCons(d, o.cons).has(c.id)
        ? `    ${c.id} — ${c.entity}: settled by your reply ("${(settledCons(d, o.cons).get(c.id) ?? '').slice(0, 120)}")`
        : `    ${c.id} — ${c.entity}: ${c.a.source} ${c.a.at} against ${c.b.source} ${c.b.at}. Both places marked; one blocking question proposed.${c.reading ? ` Reads as reconcilable: ${c.reading} — your answer here accepts or reopens it.` : ''}`,
    ),
    `GAPS       ${d.gaps.length} — become [NEEDS CLARIFICATION] markers + proposed questions`,
    `GRILLED    ${o.grilled} pass(es) run over this skeleton before you see it`,
    `NOT USED   ${notUsed.length ? notUsed.map((x) => `${x.cite.source} ${x.cite.at} (${x.note ?? 'unresolved — nobody has been asked'})`).join(' · ') : 'nothing'}`,
    '',
    'Confirm, edit any line, or decline. Nothing is created until you answer.',
  ];
}

/** The drafted skeleton as a snapshot, so the full grill can attack it before anyone sees it (I2). */
export function skeletonSnapshot(d: InitDraft, cons: readonly Con[], runId: string, date: string): Snapshot {
  const features: FeatureRec[] = d.features.map((f, i) =>
    makeFeature({
      id: `skeleton-${i + 1}`,
      name: f.name,
      whatItDoes: f.whatItDoes,
      area: f.area,
      created: date,
      questionRefs: [],
      content: bodyOf(f, d, cons, runId, date),
      source: '',
      adHoc: [],
    }),
  );
  return {
    target: { kind: 'local', address: '' },
    readAt: date,
    overview: null,
    features,
    questions: [],
    incomplete: [],
    legacyBoard: false,
    hasWhyFlagged: null,
  };
}
