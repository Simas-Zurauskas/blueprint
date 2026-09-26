import { array, integer, nullable, object, oneOf, optional, string, type Infer } from '../core/schema.ts';
import { findMarkers, quoteFound } from '../core/text.ts';
import { FEATURE_BLOCKS } from '../domain/vocab.ts';
import { markerLink } from '../domain/feature.ts';
import type { ParsedLog } from '../log/parse.ts';
import type { FeatureRec, Snapshot } from '../snapshot.ts';
import { data } from '../tasks/tasks.ts';

// challenge.md Q2 — the grilling. bp decides what is attacked (the delta scale by default, sized by SKILL.md's cost
// section; the full battery on init's skeleton or by name), freezes one brief per pass, and runs the standing sweep
// itself. The lenses are the passes' judgment; each returns typed candidates that bp numbers, grounds and ages.

export const ABSENCE_CHECKLISTS = [
  'account lifecycle',
  'data lifecycle',
  'platform matrix and versioning',
  'permissions and roles',
  'money',
  'notifications',
  'legal, privacy and accessibility',
  'empty and first-run states',
  'trust and integrity',
  'timing and commitment windows',
] as const;

export const GrillPassSchema = object({
  candidates: array(
    object({
      /** 1–5, or 0 for an absence-sweep candidate. */
      lens: integer({ min: 0, max: 5 }),
      checklist: optional(oneOf(ABSENCE_CHECKLISTS)),
      /** The feature it bites on, by name — null for a project-level candidate. */
      feature: nullable(string({ max: 200 })),
      /** The gap, phrased as the question it would be. */
      gap: string({ min: 1, max: 600 }),
      /** The text it rests on, verbatim — every grounding used. Empty only for an absence-sweep candidate. */
      grounding: array(
        object({ feature: string({ max: 200 }), block: oneOf(FEATURE_BLOCKS), quote: string({ min: 1, max: 800 }) }),
        { max: 6 },
      ),
      /** How the pass disposed it before emitting (Q2: every pass disposes first). */
      tag: oneOf(['question', 'default', 'fix', 'slot'] as const),
      /** For a default or a fix: the grounding in words — the convention, or the checkable winner. */
      note: optional(string({ max: 600 })),
    }),
    { max: 60 },
  ),
  directives: array(string()),
});
export type GrillPass = Infer<typeof GrillPassSchema>;

export type How = 'delta' | 'shared' | 'rotation' | 'queued';

export interface Pass {
  id: string;
  /** Feature ids attacked in full. */
  bodies: string[];
  lenses: number[];
  sweeps: readonly string[];
  wholeDocument: boolean;
}

export interface Surface {
  scale: 'delta' | 'full';
  attacked: { id: string; how: How }[];
  queued: string[];
  passes: Pass[];
}

/** A GRILL line read back: which bodies it named, how, and the hash each carried (challenge.md Q2, resolve.md R5). */
export interface GrillRecord {
  runId: string;
  entryIndex: number;
  bodies: { name: string; how: How; hash: string | null }[];
  converged: boolean;
}

export function readGrills(log: ParsedLog | null): GrillRecord[] {
  const out: GrillRecord[] = [];
  log?.entries.forEach((e, entryIndex) => {
    for (const l of e.lines) {
      if (l.kind !== 'GRILL') continue;
      const bodies: GrillRecord['bodies'] = [];
      // bp's own shape: «Name» 0123456789ab (delta) · …
      for (const m of l.text.matchAll(/«([^«»]{1,200})»\s+([0-9a-f]{12}|—)\s+\((delta|shared|rotation|queued)\)/g))
        bodies.push({ name: m[1] ?? '', hash: m[2] === '—' ? null : (m[2] ?? null), how: (m[3] ?? 'delta') as How });
      // The v36–v37 prose shape: "— delta: «A», «B» · rotation: «C»".
      if (!bodies.length) {
        for (const seg of l.text.split(/ · | — /)) {
          const head = /^(delta|shared|rotation|queued)\s*:/.exec(seg.trim());
          if (!head?.[1]) continue;
          for (const m of seg.matchAll(/«([^«»]{1,200})»/g))
            bodies.push({ name: m[1] ?? '', hash: null, how: head[1] as How });
        }
      }
      out.push({ runId: e.heading.runId, entryIndex, bodies, converged: /converged:\s*yes\b/i.test(l.text) });
    }
  });
  return out;
}

/**
 * The attack surface (challenge.md Q2): at the delta scale, the bodies this run wrote first, then bodies other runs wrote
 * since the newest GRILL line, bodies whose hash moved from what that line recorded, bodies sharing what the changed
 * bodies name, every body where the overview changed — then the rotation clock; the cap (four dispatches of four bodies)
 * names the rest `queued`. At the full scale every body is attacked, one pass per Area plus the whole-document and sweep
 * passes.
 */
export function planSurface(o: {
  s: Snapshot;
  log: ParsedLog | null;
  wroteThisRun: readonly string[];
  scale: 'delta' | 'full';
  overviewChanged: boolean;
}): Surface {
  const { s } = o;
  const grills = readGrills(o.log);
  if (o.scale === 'full') {
    const areas = [...new Set(s.features.map((f) => f.area || '(no Area)'))];
    const passes: Pass[] = areas.map((a, i) => ({
      id: `P${i + 1}`,
      bodies: s.features.filter((f) => (f.area || '(no Area)') === a).map((f) => f.id),
      lenses: [1, 2, 3],
      sweeps: [],
      wholeDocument: false,
    }));
    passes.push({ id: `P${passes.length + 1}`, bodies: [], lenses: [4, 5], sweeps: [], wholeDocument: true });
    passes.push({
      id: `P${passes.length + 1}`,
      bodies: [],
      lenses: [],
      sweeps: ABSENCE_CHECKLISTS,
      wholeDocument: true,
    });
    return { scale: 'full', attacked: s.features.map((f) => ({ id: f.id, how: 'delta' })), queued: [], passes };
  }
  const newest = grills[0];
  const lastHash = new Map<string, string | null>();
  for (const b of newest?.bodies ?? []) lastHash.set(b.name, b.hash);
  const order: { id: string; how: How }[] = [];
  const add = (id: string, how: How): void => {
    if (!order.some((x) => x.id === id)) order.push({ id, how });
  };
  for (const id of o.wroteThisRun) add(id, 'delta');
  // Bodies an item line names in a write entry newer than the newest GRILL line (entries are newest first).
  const newer = o.log?.entries.slice(0, newest ? newest.entryIndex : o.log.entries.length) ?? [];
  for (const e of newer) {
    for (const l of e.lines) {
      if (l.kind !== 'item') continue;
      for (const m of l.text.matchAll(/«([^«»]{1,200})»/g)) {
        const f = s.features.find((x) => x.name === m[1]);
        if (f) add(f.id, 'delta');
      }
    }
  }
  for (const f of s.features) {
    const h = lastHash.get(f.name);
    if (h && f.hash12 && h !== f.hash12) add(f.id, 'delta');
  }
  // Shared: a body naming a feature the changed text touches — lens 4's criterion, read per body.
  const changedNames = order.map((x) => s.features.find((f) => f.id === x.id)?.name).filter((n): n is string => !!n);
  for (const f of s.features)
    if (changedNames.some((n) => n !== f.name && f.content.includes(`«${n}»`))) add(f.id, 'shared');
  if (o.overviewChanged) for (const f of s.features) add(f.id, 'shared');
  // Rotation: a body no run in the last three GRILL lines attacked (delta or rotation) — only once three exist.
  if (grills.length >= 3) {
    const recent = new Set(
      grills
        .slice(0, 3)
        .flatMap((g) => g.bodies.filter((b) => b.how === 'delta' || b.how === 'rotation').map((b) => b.name)),
    );
    for (const f of s.features) if (!recent.has(f.name)) add(f.id, 'rotation');
  }
  const CAP = 16;
  const attacked = order.slice(0, CAP);
  const queued = order.slice(CAP).map((x) => x.id);
  const passes: Pass[] = [];
  for (let i = 0; i < attacked.length; i += 4) {
    passes.push({
      id: `P${passes.length + 1}`,
      bodies: attacked.slice(i, i + 4).map((x) => x.id),
      lenses: o.overviewChanged ? [1, 2, 3, 4, 5] : [1, 2, 3, 4],
      sweeps: ABSENCE_CHECKLISTS,
      wholeDocument: false,
    });
  }
  return { scale: 'delta', attacked, queued, passes };
}

/** The requirement index (Q2's brief): every feature's name, what it does, numbered requirements, edge-case leads and Not doing lines, provenance stripped. */
export function requirementIndex(s: Snapshot): string {
  return s.features
    .map((f) => {
      const frs = f.body.requirements.filter((r) => !r.withdrawn).map((r) => `  FR-${r.n} — ${r.text}`);
      const edges = (f.body.blocks.find((b) => b.known === 'Edge cases')?.lines ?? [])
        .filter((l) => l.trim() && !/^\s*\*\(.*\)\*\s*$/.test(l))
        .map((l) => `  Edge: ${l.replace(/^[-*]\s*/, '').slice(0, 120)}`);
      const notDoing = f.body.notDoing.map((n) => `  Not doing: ${n.text}`);
      return [`«${f.name}» · ${f.area} — ${f.whatItDoes}`, ...frs, ...edges, ...notDoing].join('\n');
    })
    .join('\n\n');
}

export function grillBrief(o: { pass: Pass; s: Snapshot; index: string; rows: string; design: string | null }): string {
  const bodies = o.pass.bodies.map((id) => o.s.features.find((f) => f.id === id)).filter((f): f is FeatureRec => !!f);
  return [
    `# Grill pass ${o.pass.id} (challenge.md Q2)`,
    '',
    `Lenses to work, one at a time: ${o.pass.lenses.length ? o.pass.lenses.join(', ') : 'none'}.`,
    o.pass.sweeps.length
      ? `Absence sweeps, checklist by checklist${o.pass.wholeDocument ? '' : ', only as far as the changed text touches each'}: ${o.pass.sweeps.join(' · ')}.`
      : 'No absence sweeps in this pass.',
    o.pass.wholeDocument
      ? 'This pass reads the whole document: its candidates attack no body in particular.'
      : `Bodies attacked in full: ${bodies.map((f) => `«${f.name}»`).join(', ')}.`,
    '',
    ...bodies.map((f) => data(`«${f.name}» · ${f.area} — the whole body, attacked`, f.content)),
    data('the requirement index — every other feature, provenance stripped', o.index),
    data('the overview', o.s.overview?.content ?? '(none)'),
    data('standing question rows, every status, with their answers', o.rows),
    o.design
      ? data('the ratified design record', o.design)
      : 'No ratified design record is on file: no design-grounded disposition is available.',
  ].join('\n');
}

export const rowsText = (s: Snapshot): string =>
  s.questions
    .map(
      (q) =>
        `- «${q.question}» — ${q.statusRaw}${q.answer.trim() ? ` — ${q.answer.trim().replace(/\s+/g, ' ').slice(0, 300)}` : ''}`,
    )
    .join('\n') || '(none)';

/** A grill candidate's quotes must be in the bodies they name, verbatim (rule 6(d)); an absence-sweep candidate has none. */
export function passProblems(p: GrillPass, s: Snapshot): string | null {
  const out: string[] = [];
  p.candidates.forEach((c, i) => {
    if (c.lens !== 0 && !c.grounding.length)
      out.push(`candidate ${i + 1}: a lens candidate names the text it rests on`);
    for (const g of c.grounding) {
      const f = s.features.find((x) => x.name === g.feature);
      if (!f) out.push(`candidate ${i + 1}: no feature is named «${g.feature}»`);
      else if (!quoteFound(f.content, g.quote))
        out.push(`candidate ${i + 1}: "${g.quote.slice(0, 50)}…" is not in «${f.name}» verbatim`);
    }
  });
  return out.length ? out.join('\n') : null;
}

/**
 * A candidate's depth (Q3's filter; Q4): the deepest of its groundings — a line under a requirement carrying
 * `· depth n` makes it n+1; text carrying no token, and an absence-sweep candidate, is depth 1.
 */
export function depthOf(grounding: readonly { feature: string; quote: string }[], s: Snapshot): number {
  let depth = 1;
  for (const g of grounding) {
    const f = s.features.find((x) => x.name === g.feature);
    if (!f) continue;
    const at = f.content.indexOf(g.quote.trim().split('\n')[0] ?? '');
    if (at < 0) continue;
    const lineNo = f.content.slice(0, at).split('\n').length - 1;
    const req = [...f.body.requirements].reverse().find((r) => r.line <= lineNo);
    const token = [...(req?.provenance ?? [])]
      .reverse()
      .map((p) => /·\s*depth\s+(\d+)/.exec(p)?.[1])
      .find(Boolean);
    if (req && token) depth = Math.max(depth, Number(token) + 1);
  }
  return depth;
}

/** Q2's standing sweep, by code: carried markers (a CON-k one is contradiction-backed), Behaviour with no requirement,
 * Not doing with no revisit-if (a report line only), and whether the operating-volume question was ever asked. */
export function standingSweep(s: Snapshot): {
  markers: { feature: string; block: string; fr: number | null; text: string; con: string | null }[];
  noRequirement: string[];
  noRevisit: string[];
  volumeAsked: boolean;
} {
  const markers: ReturnType<typeof standingSweep>['markers'] = [];
  for (const f of s.features) {
    for (const m of f.body.markers) {
      if (m.link.kind !== 'carried') continue;
      markers.push({
        feature: f.name,
        block: m.block,
        fr: m.fr ?? null,
        text: m.inner.split('→')[0]?.trim() ?? m.inner,
        con: /\bCON-(\d+)\b/.exec(m.inner)?.[0] ?? null,
      });
    }
  }
  for (const text of s.overview?.parsed.sections.flatMap((x) => x.lines) ?? []) {
    for (const m of findMarkers(text)) {
      if (markerLink(m.inner).kind === 'carried')
        markers.push({
          feature: '',
          block: 'overview',
          fr: null,
          text: m.inner.split('→')[0]?.trim() ?? m.inner,
          con: /\bCON-(\d+)\b/.exec(m.inner)?.[0] ?? null,
        });
    }
  }
  const noRequirement = s.features.filter((f) => !f.body.requirements.some((r) => !r.withdrawn)).map((f) => f.name);
  const noRevisit = s.features.flatMap((f) =>
    f.body.notDoing.filter((n) => !n.hasRevisit).map((n) => `«${f.name}» Not doing: ${n.text.slice(0, 100)}`),
  );
  const volumeAsked = s.questions.some((q) =>
    /\b(operating volume|order of magnitude|how many (people|users|orders|members)|peak (load|volume|usage))\b/i.test(
      `${q.question} ${q.whyAsked}`,
    ),
  );
  return { markers, noRequirement, noRevisit, volumeAsked };
}
