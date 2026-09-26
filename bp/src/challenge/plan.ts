import { findMarkers, quoteFound } from '../core/text.ts';
import { redact } from '../checks/content.ts';
import { makeFeature, type Snapshot } from '../snapshot.ts';
import { readFacts, ratified } from '../log/facts.ts';
import type { ParsedLog } from '../log/parse.ts';
import type { BlockWrite, Pages, Prepared, Write } from '../engine/writes.ts';
import type { Candidate, Checked, Disposition, DirectionDraft } from './dispose.ts';
import type { ColdOutcome } from './coldread.ts';

// challenge.md Q4's writes and Q6 step 10's lines. Every candidate's disposition becomes exactly one thing: a question row
// (its carried marker patched to the row in the same act), a labelled default on the standing ledger (its marker patched
// to the ledger line — route 6), a doc-fix on the fixes batch, a content slot on the manifest (its marker removed —
// route 7), a Rabbit holes line carrying the candidate's depth, or a discard line with its filter and its quote.

export type QSpec =
  | { type: 'insert'; block: string; line: string }
  | { type: 'replace'; block: string; old: string; new: string; prov: string }
  | { type: 'marker'; marker: string; to: { row: string } | { text: string } | { remove: string } };

export interface QPlan {
  writes: Write[];
  logs: { kind: string; text: string }[];
  defaults: {
    n: number;
    run: string;
    feature: string;
    line: string;
    grounding: string;
    doesNotDecide: string;
    risk: 'high' | 'normal';
    disagreement?: string;
  }[];
  fixes: { n: number; run: string; feature: string; old: string; new: string }[];
  slots: { n: number; run: string; feature: string; line: string }[];
  discards: { id: string; gap: string; filter: string; quote?: string; counterCase: string; coldRead: boolean }[];
  noChannel: { id: string; gap: string; disposition: string; needs: string }[];
  refused: string[];
  wrongPerson: string[];
  questions: { id: string; title: string; touches: string[]; directions: string; area: string }[];
  funnel: { drafted: number; defaults: number; fixes: number; slots: number; questions: number; discarded: number };
  unverified: number;
}

const stamp = (depth: number): string => `· depth ${depth}`;

/** The oldest standing defaults ledger, which a run's defaults join (Q4, v24) — or this run's own. */
export function ledgerHome(log: ParsedLog | null, runId: string): { run: string; next: number } {
  const facts = log ? readFacts(log) : null;
  const open = (facts?.batches ?? [])
    .filter((b) => b.kind === 'defaults')
    .filter((b) =>
      b.lines.some(
        (l) =>
          !ratified(facts ?? readFacts({ physical: [], preambleEnd: 0, entries: [] }), 'defaults', b.runId, l.n) &&
          !(facts?.acts ?? []).some(
            (a) =>
              a.act === 'VETOED' &&
              a.kind === 'defaults' &&
              a.runId === b.runId &&
              (a.lines === 'all' || a.lines.includes(l.n)),
          ),
      ),
    );
  const oldest = open[open.length - 1];
  return oldest ? { run: oldest.runId, next: Math.max(...oldest.lines.map((l) => l.n)) + 1 } : { run: runId, next: 1 };
}

/** The directions field (databases.md §2): numbered, each quote checked by string match (rule 6(d)) — an unmatched quote
 * is dropped and reported, never the whole field — dated, and closed with the standing line. */
export function directionsText(
  ds: readonly DirectionDraft[],
  s: Snapshot,
  date: string,
  citation: (line: string) => void,
): string {
  const lines = ds.map((d, i) => {
    const kept = d.quotes.filter((q) => {
      const f = s.features.find((x) => x.name === q.feature);
      const ok = !!f && quoteFound(f.content, q.quote);
      citation(
        `${ok ? 'matched' : 'not matched — dropped'} «${q.feature}»${q.fr ? ` FR-${q.fr}` : ''} "${q.quote.slice(0, 80)}"`,
      );
      return ok;
    });
    const cites = kept.map((q) => `«${q.feature}»${q.fr ? ` FR-${q.fr}` : ''} "${q.quote}" (${date})`).join('; ');
    return `${i + 1}. ${d.decision.replace(/\.$/, '')}. Why: ${d.why.replace(/\.$/, '')}${cites ? ` — ${cites}` : ''}. Counter-case: ${d.counter.replace(/\.$/, '')}.`;
  });
  return [
    ...lines,
    `Drafted ${date} · machine-drafted decision support — not a source; answer in your own words, or name one direction by its number.`,
  ].join('\n');
}

export function planQuestions(o: {
  cands: readonly Candidate[];
  first: ReadonlyMap<string, Disposition>;
  checked: ReadonlyMap<string, Checked>;
  cold: ReadonlyMap<string, ColdOutcome>;
  blindDirections: ReadonlyMap<string, { n: number; verdict: 'ok' | 'strike' | 'rewrite'; rewrite?: DirectionDraft }[]>;
  s: Snapshot;
  log: ParsedLog | null;
  runId: string;
  date: string;
  barred: readonly string[];
}): QPlan {
  const { s } = o;
  const p: QPlan = {
    writes: [],
    logs: [],
    defaults: [],
    fixes: [],
    slots: [],
    discards: [],
    noChannel: [],
    refused: [],
    wrongPerson: [],
    questions: [],
    funnel: { drafted: o.cands.length, defaults: 0, fixes: 0, slots: 0, questions: 0, discarded: 0 },
    unverified: 0,
  };
  const safe = (t: string): string => redact(t, o.barred);
  const ledger = ledgerHome(o.log, o.runId);
  let ledgerN = ledger.next;
  let fixN = 1;
  let slotN = 1;
  let k = 0;
  const key = (x: string): string => `${x}-${++k}`;
  const featureId = (name: string | null): string | undefined =>
    name ? s.features.find((f) => f.name === name)?.id : undefined;
  const block = (page: string, label: string, spec: QSpec): BlockWrite => ({
    kind: 'block',
    key: key('q'),
    stage: 'plan',
    plannedAt: '',
    page,
    label,
    spec,
  });
  const discard = (c: Candidate, filter: string, counterCase: string, quote?: string, coldRead = false): void => {
    p.funnel.discarded += 1;
    p.discards.push({ id: c.id, gap: c.gap, filter, counterCase, ...(quote ? { quote } : {}), coldRead });
    p.logs.push({
      kind: 'discard',
      text: safe(
        `${c.id} «${c.gap.slice(0, 120)}» · ${filter}${quote ? ` — "${quote.slice(0, 160)}"` : ''}${coldRead ? ' · cold read' : ''}${c.con ? ` · ${c.con}` : ''}`,
      ),
    });
  };

  for (const c of o.cands) {
    const d = o.first.get(c.id);
    const ch = o.checked.get(c.id);
    if (!d || !ch) continue;
    if (ch.unverified) p.unverified += 1;
    if (ch.final !== d.route && ch.final !== 'question' && d.route === 'question') {
      p.logs.push({
        kind: 'demotion',
        text: safe(
          `${c.id} «${c.gap.slice(0, 120)}» · routing QUESTION · disposition check ${ch.final.toUpperCase()} — ${ch.why}`,
        ),
      });
    }
    const fid = featureId(c.feature);
    switch (ch.final) {
      case 'question': {
        const cold = o.cold.get(c.id);
        if (cold?.action === 'discard' || cold?.action === 'absorbed') {
          discard(c, cold.filter ?? 'Duplicate', `cold read: ${cold.verdict}`, cold.quote, true);
          break;
        }
        const title = cold?.title ?? d.question.title;
        const touches = c.feature && !d.question.touches.length ? [c.feature] : d.question.touches;
        const struck = new Set(
          (o.blindDirections.get(c.id) ?? []).filter((x) => x.verdict === 'strike').map((x) => x.n),
        );
        const rewritten = new Map(
          (o.blindDirections.get(c.id) ?? [])
            .filter((x) => x.verdict === 'rewrite' && x.rewrite)
            .map((x) => [x.n, x.rewrite as DirectionDraft]),
        );
        const dirs = d.question.directions
          .map((x, i) => rewritten.get(i + 1) ?? x)
          .filter((_, i) => !struck.has(i + 1));
        const directions = directionsText(dirs, s, o.date, (line) =>
          p.logs.push({ kind: 'citation', text: safe(line) }),
        );
        const whyAsked = `${d.question.whyAsked.replace(/\s*·\s*depth\s+\d+\s*$/, '').trim()} ${stamp(c.depth)}`;
        const rowKey = key('row');
        for (const t of [title, ...(cold?.splits ?? [])]) {
          p.funnel.questions += 1;
          p.writes.push({
            kind: 'create-question',
            key: t === title ? rowKey : key('row'),
            stage: 'plan',
            plannedAt: '',
            question: t,
            status: 'Open',
            whyAsked,
            directions,
            touches: touches.map((n) => featureId(n) ?? n),
            created: o.date,
          });
          p.questions.push({
            id: c.id,
            title: t,
            touches,
            directions,
            area: s.features.find((f) => f.name === touches[0])?.area ?? 'Project',
          });
        }
        // Writing a row and patching its marker are one act (Q4).
        if (c.marker) {
          const mf = featureId(c.marker.feature);
          if (mf)
            p.writes.push(block(mf, c.marker.feature, { type: 'marker', marker: c.marker.text, to: { row: rowKey } }));
        }
        if (ch.routingRefused)
          p.refused.push(
            `${c.id} «${c.gap.slice(0, 100)}» — routing refused, no survey offered: written as a question`,
          );
        break;
      }
      case 'default': {
        const df = d.default;
        const f = df ? s.features.find((x) => x.name === df.feature) : undefined;
        if (!df || !f) {
          discard(
            c,
            'Settled by convention',
            'the default names no feature it could be written into — a project-scoped default goes through the overview route',
          );
          break;
        }
        const n = ledgerN++;
        p.funnel.defaults += 1;
        const label = df.design
          ? `Default (adopted from the ratified design, frame ${df.design} — ratify on review)`
          : 'Default (standard practice — ratify on review)';
        const line = `${label}: ${df.sentence.replace(/\.$/, '')}. (run ${ledger.run} · ${o.date}) ${stamp(c.depth)}`;
        p.writes.push(block(f.id, f.name, { type: 'insert', block: df.block, line }));
        if (c.marker) {
          const mf = featureId(c.marker.feature);
          if (mf)
            p.writes.push(
              block(mf, c.marker.feature, {
                type: 'marker',
                marker: c.marker.text,
                to: { text: `→ Default: ledger ${ledger.run} #${n}, awaiting ratification` },
              }),
            );
        }
        const disagreement = ch.why.startsWith('the two verdicts differ') ? ch.why : undefined;
        p.defaults.push({
          n,
          run: ledger.run,
          feature: f.name,
          line: safe(line),
          grounding: safe(df.grounding),
          doesNotDecide: safe(df.doesNotDecide),
          risk: df.risk,
          ...(disagreement ? { disagreement } : {}),
        });
        p.logs.push({
          kind: `ledger ${ledger.run} #${n}`,
          text: safe(
            `«${f.name}» ${df.block} · ${label}: ${df.sentence} · grounding: ${df.grounding} · dominant: ${df.attestations.dominant}; low risk: ${df.attestations.lowRisk}; reversible: ${df.attestations.reversible}; not client-owned: ${df.attestations.notClientOwned} · does not decide: ${df.doesNotDecide} · risk: ${df.risk}${ch.unverified ? ' · unverified' : ''}${disagreement ? ` · ${disagreement}` : ''}`,
          ),
        });
        break;
      }
      case 'fix': {
        const fx = d.fix;
        const f = fx ? s.features.find((x) => x.name === fx.feature) : undefined;
        if (!fx || !f) {
          discard(c, 'Correction, not question', 'the fix names no feature');
          break;
        }
        const n = fixN++;
        p.funnel.fixes += 1;
        p.writes.push(
          block(f.id, f.name, {
            type: 'replace',
            block: fx.block,
            old: fx.old,
            new: fx.new,
            prov: `*(Fixed ${o.date} by the challenge run ${o.runId} ${stamp(c.depth)} — class (${fx.klass}); previously: "${fx.old.replace(/"/g, "'")}".)*`,
          }),
        );
        p.fixes.push({ n, run: o.runId, feature: f.name, old: safe(fx.old), new: safe(fx.new) });
        p.logs.push({
          kind: `fix ${o.runId} #${n}`,
          text: safe(
            `«${f.name}» ${fx.block} · "${fx.old}" → "${fx.new}" · class (${fx.klass})${ch.unverified ? ' · unverified' : ''}`,
          ),
        });
        break;
      }
      case 'slot': {
        const sl = d.slot;
        const f = sl ? s.features.find((x) => x.name === sl.feature) : undefined;
        if (!sl || !f) {
          discard(c, 'Deliverable content, not a decision', 'the slot names no feature');
          break;
        }
        const n = slotN++;
        p.funnel.slots += 1;
        const line = `Content slot — client-supplied: ${sl.what} · ${sl.shape} · ${sl.bounds} · supplied by ${sl.supplier} ${stamp(c.depth)}`;
        p.writes.push(block(f.id, f.name, { type: 'insert', block: sl.block, line }));
        if (c.marker) {
          const mf = featureId(c.marker.feature);
          if (mf)
            p.writes.push(
              block(mf, c.marker.feature, {
                type: 'marker',
                marker: c.marker.text,
                to: { remove: `route 7 — the slot line on «${f.name}», manifest ${o.runId} #${n}` },
              }),
            );
        }
        p.slots.push({ n, run: o.runId, feature: f.name, line: safe(line) });
        p.logs.push({
          kind: `manifest ${o.runId} #${n}`,
          text: safe(`«${f.name}» ${sl.block} · ${line}${ch.unverified ? ' · unverified' : ''}`),
        });
        break;
      }
      case 'rabbit-hole': {
        const rh = d.rabbitHole;
        const f = rh
          ? s.features.find((x) => x.name === rh.feature)
          : fid
            ? s.features.find((x) => x.id === fid)
            : undefined;
        // A capped candidate is a discard in the funnel, whatever line it leaves (Q3's Derived past the bound).
        discard(
          c,
          d.filter ?? (ch.why.startsWith('derived past') ? 'Derived past the bound' : 'Implementation, not intent'),
          d.counterCase || ch.why,
        );
        if (f && rh)
          p.writes.push(
            block(f.id, f.name, {
              type: 'insert',
              block: 'Rabbit holes',
              line: `- ${rh.line.replace(/^[-*]\s*/, '')} ${stamp(c.depth)}`,
            }),
          );
        break;
      }
      case 'no-channel':
        p.funnel.discarded += 1;
        p.noChannel.push({
          id: c.id,
          gap: c.gap,
          disposition: d.noChannel?.disposition ?? 'PROPOSE',
          needs: d.noChannel?.needs ?? '',
        });
        p.logs.push({
          kind: 'discard',
          text: safe(
            `${c.id} «${c.gap.slice(0, 120)}» · disposed with no channel — ${d.noChannel?.disposition ?? 'PROPOSE'}`,
          ),
        });
        break;
      case 'discard':
        discard(c, d.filter ?? 'Unanswerable here', d.counterCase, d.evidence[0]?.quote);
        break;
    }
  }
  return p;
}

/** Build a challenge run's write text from the page as it stands (the serial commit path). */
export function prepareQ(s: Snapshot, pages: Pages, local: boolean, w: BlockWrite, current: string): Prepared {
  const spec = w.spec as QSpec;
  const base = s.features.find((x) => x.id === w.page);
  if (!base) return { error: `no feature ${w.page}` };
  const f = makeFeature({ ...base, content: current || base.content });
  if (spec.type === 'marker') {
    const m = f.body.markers.find(
      (x) => x.inner.split('→')[0]?.trim() === spec.marker || x.inner.includes(spec.marker),
    );
    if (!m) return { skip: 'the marker is no longer on the page' };
    const b = f.body.blocks.find((x) => x.name === m.block);
    if (!b) return { error: 'the marker sits outside a block' };
    let replacement: string;
    if ('row' in spec.to) {
      const address = pages.address[spec.to.row];
      if (!address) return { error: 'its row was not created' };
      const link = local ? address : `[${spec.marker.slice(0, 40)}](https://app.notion.com/p/${address})`;
      replacement = m.raw.replace(/→\s*(?:Question|Default)\s*:[^\]]*/, `→ Question: ${link}`);
    } else if ('text' in spec.to) {
      replacement = m.raw.replace(/→\s*(?:Question|Default)\s*:[^\]]*/, spec.to.text);
    } else replacement = '';
    const after = b.raw
      .replace(m.raw, replacement)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n- *\n/g, '\n');
    return { block: b.name, before: b.raw, after };
  }
  const b = f.body.blocks.find((x) => x.known === spec.block);
  if (!b) return { error: `«${f.name}» has no ${spec.block} block` };
  if (spec.type === 'insert') {
    if (b.raw.includes(spec.line)) return { skip: 'the line is already there' };
    const lines = [...b.lines];
    let end = lines.length;
    while (end > 0 && !(lines[end - 1] ?? '').trim()) end--;
    lines.splice(end, 0, spec.line);
    return { block: b.name, before: b.raw, after: [`## ${b.name}`, ...lines].join('\n') };
  }
  const at = b.raw.indexOf(spec.old);
  if (at < 0) return { error: `the text to replace is no longer in ${spec.block}` };
  // An empty replacement removes the whole line, not just its text.
  const end = spec.new === '' && b.raw[at + spec.old.length] === '\n' ? at + spec.old.length + 1 : at + spec.old.length;
  let after = `${b.raw.slice(0, at)}${spec.new}${b.raw.slice(end)}`;
  const lines = after.split('\n');
  const i = spec.prov && spec.new ? lines.findIndex((l) => l.includes(spec.new)) : -1;
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && /^\s*\*\(.*\)\*\s*$/.test(lines[j] ?? '')) j++;
    lines.splice(j, 0, spec.prov);
    after = lines.join('\n');
  }
  return { block: b.name, before: b.raw, after };
}

/** Markers the Q2 standing sweep carries in: each transcribed as a candidate (a CON-k one is contradiction-backed). */
export const markerCount = (s: Snapshot): number => s.features.reduce((n, f) => n + findMarkers(f.content).length, 0);
