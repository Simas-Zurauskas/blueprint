import { hashBody, sha12 } from '../core/hash.ts';
import { redact, scan } from '../checks/content.ts';
import { makeFeature, type Snapshot } from '../snapshot.ts';
import type { ParsedLog } from '../log/parse.ts';
import { readFacts } from '../log/facts.ts';
import type { Read } from '../engine/read.ts';
import { need, type Owed, type RunState, type TaskEnv } from '../engine/state.ts';
import { runWrites, type BlockWrite, type Pages, type Write } from '../engine/writes.ts';
import type { ToolCall } from '../target/transcript.ts';
import { ColdSchema, applyColdReads, coldBrief, type ColdOutcome, type DraftRow } from './coldread.ts';
import {
  BlindSchema,
  DisposerSchema,
  blindBrief,
  decide,
  disposerBrief,
  disposerProblems,
  failsReadBack,
  registerTopics,
  SURVEYED,
  type Blind,
  type Candidate,
  type Checked,
  type Disposition,
} from './dispose.ts';
import {
  GrillPassSchema,
  depthOf,
  grillBrief,
  passProblems,
  planSurface,
  requirementIndex,
  rowsText,
  standingSweep,
  type Surface,
} from './grill.ts';
import { planQuestions, prepareQ, type QPlan, type QSpec } from './plan.ts';
import { saveScreen, type ScreenLine } from './q1.ts';

// challenge.md Q1–Q6 as one resumable machine. It runs standalone (`bp challenge`) or embedded — `add`'s A5 handoff and
// `init`'s I7 — in the embedding run's own entry. Each call advances as far as the facts in hand allow and says what it
// is owed; every judgment is a dispatched task, every checkable thing is checked here.

export interface QState {
  stage:
    'grill' | 'dispose' | 'blind' | 'decide' | 'cold' | 'plan' | 'write' | 'sweep' | 'sweep-write' | 'report' | 'done';
  scale: 'delta' | 'full';
  surface?: Surface;
  cands: Candidate[];
  first: Record<string, Disposition>;
  blind: Record<string, Blind['verdicts'][number]>;
  checked: Record<string, Checked>;
  surveyFailed: string[];
  drafts: DraftRow[];
  cold: Record<string, ColdOutcome>;
  plan?: Omit<QPlan, 'writes'>;
  writes: Write[];
  sweepWrites: Write[];
  /** Writes a batch act owes (Q1), kept until the plan runs them ahead of this run's own. */
  actWrites: Write[];
  wroteThisRun: string[];
  /** Feature ids whose bodies this challenge run wrote — for the GRILL line's post-write hashes. */
  printed: string[];
  report: string[];
  sweepNotes: string[];
  passes: Record<string, number>;
  failedTasks: string[];
}

export const newQState = (scale: 'delta' | 'full', wroteThisRun: string[] = []): QState => ({
  stage: 'grill',
  scale,
  cands: [],
  first: {},
  blind: {},
  checked: {},
  surveyFailed: [],
  drafts: [],
  cold: {},
  writes: [],
  sweepWrites: [],
  actWrites: [],
  wroteThisRun,
  printed: [],
  report: [],
  sweepNotes: [],
  passes: {},
  failedTasks: [],
});

export interface QEnv {
  st: RunState;
  task: TaskEnv;
  owed: Owed;
  s: Snapshot;
  read: Read;
  pages: Pages;
  targetKind: 'notion' | 'local';
  docDir?: string;
  calls: readonly ToolCall[];
  log: (kind: string, text: string) => void;
  logText: () => string;
  parsedLog: () => ParsedLog | null;
  barred: string[];
  date: string;
  nowIso: string;
  home: string;
  /** Writes an act (Q1's ratify/veto) owes, run ahead of this run's own. */
  actWrites?: BlockWrite[];
}

const chunk = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** The current snapshot, with this run's writes applied to its bodies (the next phase reads what the last one wrote). */
function current(s: Snapshot, pages: Pages): Snapshot {
  return {
    ...s,
    features: s.features.map((f) =>
      pages.content[f.id] !== undefined && pages.content[f.id] !== f.content
        ? makeFeature({ ...f, content: pages.content[f.id] ?? f.content })
        : f,
    ),
  };
}

/** Advance the challenge run. 'owed' — the caller prints `e.owed` and waits; 'done' — the report is in `q.report`. */
export function stepChallenge(q: QState, e: QEnv): 'owed' | 'done' {
  if (e.actWrites?.length) q.actWrites.push(...e.actWrites);
  const s = current(e.s, e.pages);
  const index = requirementIndex(s);
  const rows = rowsText(s);
  const register = registerTopics(s);
  for (let guard = 0; guard < 20; guard++) {
    switch (q.stage) {
      case 'grill': {
        q.surface ??= planSurface({
          s,
          log: e.parsedLog(),
          wroteThisRun: q.wroteThisRun,
          scale: q.scale,
          overviewChanged: false,
        });
        const surface = q.surface;
        if (!q.printed.includes('cost')) {
          q.printed.push('cost');
          q.report.push(
            `GRILL — ${surface.scale} scale · ${surface.passes.length} dispatch${surface.passes.length === 1 ? '' : 'es'} · ${surface.attacked.length} bodies attacked${surface.queued.length ? ` · ${surface.queued.length} queued by the cap` : ''} (SKILL.md cost section)`,
          );
        }
        let waiting = false;
        for (const pass of surface.passes) {
          const r = need(e.st, e.task, e.owed, `grill:${pass.id}`, {
            kind: 'grill-pass',
            role: `grill pass ${pass.id} (challenge.md Q2)`,
            rubric: 'grill-pass.md',
            schema: GrillPassSchema,
            brief: () => grillBrief({ pass, s, index, rows, design: null }),
            validate: (v) => passProblems(v, s),
          });
          if (r.kind === 'owed') waiting = true;
          else if (r.kind === 'failed' && !q.failedTasks.includes(pass.id)) q.failedTasks.push(pass.id);
        }
        if (waiting) return 'owed';
        let n = 0;
        const add = (c: Omit<Candidate, 'id'>): void => {
          n += 1;
          q.cands.push({ ...c, id: `C${n}` });
        };
        for (const pass of surface.passes) {
          const r = e.st.tasks[`grill:${pass.id}`];
          const parsed = r?.answer === undefined ? null : GrillPassSchema.parse(r.answer);
          if (!parsed?.ok) continue;
          q.passes[pass.id] = parsed.value.candidates.length;
          for (const c of parsed.value.candidates) {
            // A quote not found drops that grounding (rule 6(d)); a lens candidate left with none is not a candidate.
            const grounding = c.grounding.filter((g) => {
              const f = s.features.find((x) => x.name === g.feature);
              return !!f && f.content.replace(/\s+/g, ' ').includes(g.quote.replace(/\s+/g, ' ').trim());
            });
            if (c.lens !== 0 && !grounding.length) continue;
            add({
              origin: c.lens === 0 ? 'sweep' : 'lens',
              pass: pass.id,
              lens: c.lens,
              ...(c.checklist ? { checklist: c.checklist } : {}),
              feature: c.feature,
              gap: c.gap,
              grounding,
              tag: c.tag,
              ...(c.note ? { note: c.note } : {}),
              depth: depthOf(grounding, s),
              exempt: null,
            });
          }
        }
        // The standing sweep, by code: every carried marker first — a gap somebody already agreed was a gap.
        const sweep = standingSweep(s);
        for (const m of sweep.markers) {
          add({
            origin: m.con ? 'con' : 'marker',
            lens: 0,
            feature: m.feature || null,
            gap: m.text,
            grounding: [],
            tag: 'question',
            depth: 1,
            exempt: m.con ? 'contradiction' : null,
            ...(m.con ? { con: m.con } : {}),
            ...(m.feature ? { marker: { feature: m.feature, text: m.text } } : {}),
          });
        }
        if (!sweep.volumeAsked)
          add({
            origin: 'volume',
            lens: 0,
            feature: null,
            gap: 'What order of magnitude of use should this product expect — how many people and how much activity at peak — and who fixes a wrong outcome by hand?',
            grounding: [],
            tag: 'question',
            depth: 1,
            exempt: 'project-level',
          });
        for (const f of sweep.noRequirement)
          q.sweepNotes.push(`«${f}» — its Behaviour block holds no numbered requirement: a title, not a spec`);
        for (const l of sweep.noRevisit) q.sweepNotes.push(`${l} — no revisit-if (named, never asked about)`);
        q.stage = 'dispose';
        continue;
      }
      case 'dispose': {
        if (!q.cands.length) {
          q.stage = 'plan';
          continue;
        }
        let waiting = false;
        const discards = (e.parsedLog()?.entries ?? [])
          .flatMap((en) =>
            en.lines.filter((l) => l.kind === 'discard').map((l) => `run ${en.heading.runId}: ${l.text}`),
          )
          .slice(0, 200)
          .join('\n');
        const ledger = readFacts(e.parsedLog() ?? { physical: [], preambleEnd: 0, entries: [] })
          .batches.filter((b) => b.kind === 'defaults')
          .flatMap((b) => b.lines.map((l) => `ledger ${b.runId} #${l.n}: ${l.text}`))
          .join('\n');
        chunk(q.cands, 30).forEach((batch, i) => {
          const r = need(e.st, e.task, e.owed, `dispose:${i}`, {
            kind: 'disposer',
            role: 'disposer (challenge.md Q3–Q4)',
            rubric: 'disposer.md',
            schema: DisposerSchema,
            brief: () => disposerBrief({ cands: batch, s, index, rows, discards, ledger, register }),
            validate: (v) => disposerProblems(v, batch, s, e.logText()),
          });
          if (r.kind === 'owed') waiting = true;
          const value = r.kind === 'done' ? r.value : r.kind === 'failed' ? r.value : undefined;
          if (value) for (const d of value.dispositions) if (batch.some((c) => c.id === d.id)) q.first[d.id] = d;
          if (r.kind === 'failed') {
            // A second silent survey is not a third attempt: the candidate is written as a question, and the refusal named.
            for (const d of value?.dispositions ?? [])
              if (d.route === 'discard' && d.filter && SURVEYED.has(d.filter) && !(d.survey && d.survey.length >= 2))
                q.surveyFailed.push(d.id);
          }
        });
        if (waiting) return 'owed';
        q.stage = e.st.noSecondDispatch ? 'decide' : 'blind';
        continue;
      }
      case 'blind': {
        let waiting = false;
        const drafts = new Map(Object.entries(q.first));
        chunk(
          q.cands.filter((c) => q.first[c.id]),
          25,
        ).forEach((batch, i) => {
          const r = need(e.st, e.task, e.owed, `blind:${i}`, {
            kind: 'blind-check',
            role: 'blind disposition check (challenge.md Q4)',
            rubric: 'blind-check.md',
            schema: BlindSchema,
            brief: () => blindBrief({ cands: batch, drafts, s }),
            validate: (v) => {
              const missing = batch.filter((c) => !v.verdicts.some((x) => x.id === c.id)).map((c) => c.id);
              return missing.length ? `no verdict for ${missing.join(', ')}` : null;
            },
          });
          if (r.kind === 'owed') waiting = true;
          const value = r.kind === 'done' ? r.value : r.kind === 'failed' ? r.value : undefined;
          for (const v of value?.verdicts ?? []) q.blind[v.id] = v;
        });
        if (waiting) return 'owed';
        q.stage = 'decide';
        continue;
      }
      case 'decide': {
        for (const c of q.cands) {
          const first = q.first[c.id];
          if (!first) {
            q.checked[c.id] = {
              final: 'question',
              why: 'no disposition came back — written as a question, never parked',
              unverified: true,
            };
            continue;
          }
          // A carried-marker transcription the router finds client-bound is never demoted afterwards.
          const cand = c.origin === 'marker' && first.route === 'question' ? { ...c, exempt: 'marker' as const } : c;
          let ch = decide({
            c: cand,
            first,
            blind: q.blind[c.id] ?? null,
            s,
            logText: e.logText(),
            register,
            failedSurveyTwice: q.surveyFailed.includes(c.id),
          });
          if (ch.final === 'question' && failsReadBack(first.question.whyAsked, cand.exempt)) {
            ch = {
              ...ch,
              final: 'discard',
              why: 'put to the wrong person — its own Why asked says its reader cannot answer it (the read-back gate)',
            };
            q.sweepNotes.push(`${c.id} «${first.question.title}» — put to the wrong person: not written`);
          }
          q.checked[c.id] = ch;
        }
        q.drafts = q.cands
          .filter((c) => q.checked[c.id]?.final === 'question' && c.origin !== 'marker')
          .map((c, i) => {
            const d = q.first[c.id];
            return {
              id: `R${i + 1}`,
              candidate: c.id,
              title: d?.question.title ?? c.gap,
              whyAsked: d?.question.whyAsked ?? '',
              touches: d?.question.touches ?? (c.feature ? [c.feature] : []),
              directions: (d?.question.directions ?? []).map((x, k) => `${k + 1}. ${x.decision}`).join('\n'),
              exempt: c.exempt,
            };
          });
        q.stage = e.st.noSecondDispatch || !q.drafts.length ? 'plan' : 'cold';
        continue;
      }
      case 'cold': {
        let waiting = false;
        const others = q.drafts.map((d) => d.title);
        const outcomes: ColdOutcome[] = [];
        chunk(q.drafts, 10).forEach((batch, i) => {
          const r = need(e.st, e.task, e.owed, `cold:${i}`, {
            kind: 'cold-reader',
            role: 'cold reader (challenge.md Q4)',
            rubric: 'cold-reader.md',
            schema: ColdSchema,
            brief: () => coldBrief({ rows: batch, s, index, standing: rows, ledger: '', others }),
            validate: (v) => {
              const missing = batch.filter((d) => !v.reads.some((x) => x.row === d.id)).map((d) => d.id);
              return missing.length ? `no verdict for ${missing.join(', ')}` : null;
            },
          });
          if (r.kind === 'owed') waiting = true;
          const value = r.kind === 'done' ? r.value : r.kind === 'failed' ? r.value : undefined;
          outcomes.push(...applyColdReads(batch, value?.reads ?? [], s, e.logText()));
        });
        if (waiting) return 'owed';
        for (const o of outcomes) {
          q.cold[o.row.candidate] = o;
          if (o.check) e.log('check', redact(o.check, e.barred));
        }
        q.stage = 'plan';
        continue;
      }
      case 'plan': {
        const plan = planQuestions({
          cands: q.cands,
          first: new Map(Object.entries(q.first)),
          checked: new Map(Object.entries(q.checked)),
          cold: new Map(Object.entries(q.cold)),
          blindDirections: new Map(Object.entries(q.blind).map(([k, v]) => [k, v.directions])),
          s,
          log: e.parsedLog(),
          runId: e.st.runId,
          date: e.date,
          barred: e.barred,
        });
        const { writes, ...rest } = plan;
        q.plan = rest;
        q.writes = [...q.actWrites, ...writes];
        q.stage = 'write';
        continue;
      }
      case 'write': {
        const landed = runWrites(
          q.writes,
          e.pages,
          {
            targetKind: e.targetKind,
            ...(e.docDir ? { docDir: e.docDir } : {}),
            nowIso: e.nowIso,
            calls: e.calls,
            featuresDs: e.read.featuresDs,
            questionsDs: e.read.questionsDs,
          },
          (w, cur) => prepareQ(s, e.pages, e.targetKind === 'local', w, cur),
          e.owed,
        );
        for (const l of landed)
          if (l.write.kind === 'block' && l.write.outcome?.kind === 'landed')
            e.log(
              'item',
              `«${l.write.label}» · written · ${(l.write.spec as QSpec).type === 'marker' ? 'marker patched' : (l.write.block ?? '')} · body ${l.bodyHash ?? '—'}`,
            );
        if (e.owed.calls.length) return 'owed';
        // Q6 step 10's lines, now that what they describe has landed.
        for (const l of q.plan?.logs ?? []) e.log(l.kind, l.text);
        for (const w of q.writes.filter(
          (x) => x.outcome && x.outcome.kind !== 'landed' && x.outcome.kind !== 'skipped',
        ))
          e.log(
            'CARRIED-FORWARD',
            redact(
              `${w.kind === 'block' ? `«${w.label}»` : w.kind === 'create-question' ? `«${w.question}»` : w.key} — not written (${w.outcome?.kind}: ${w.outcome?.detail ?? ''}); the next challenge run carries it`,
              e.barred,
            ).slice(0, 300),
          );
        q.stage = 'sweep';
        continue;
      }
      case 'sweep': {
        // Q6 steps 2–3: a marker pointing at a row a human closed — removed citing the row (route 2); a rejection reading
        // "ask it better" returns its marker to carried first (route 4).
        const now = current(e.s, e.pages);
        let k = 0;
        for (const f of now.features) {
          for (const m of f.body.markers) {
            if (m.link.kind !== 'question') continue;
            const link = m.link;
            const row = now.questions.find((x) => (link.id && x.id === link.id) || (link.key && x.key === link.key));
            if (!row || (row.status !== 'Rejected' && row.status !== 'Closed (not applied)')) continue;
            const better =
              row.status === 'Rejected' && /\b(ask it better|reword|rephrase|badly worded|wording)\b/i.test(row.answer);
            const spec: QSpec = {
              type: 'marker',
              marker: m.inner.split('→')[0]?.trim() ?? m.inner,
              to: better
                ? { text: '→ Question: carried' }
                : { remove: `route 2 — row ${row.key ?? row.id} ${row.status}` },
            };
            q.sweepWrites.push({
              kind: 'block',
              key: `sweep-${++k}`,
              stage: 'plan',
              plannedAt: '',
              page: f.id,
              label: f.name,
              spec,
            });
            q.sweepNotes.push(
              `«${f.name}» marker → ${better ? 'returned to carried (route 4: ask it better)' : `removed (route 2), citing row ${row.key ?? row.id}`}`,
            );
          }
        }
        q.stage = 'sweep-write';
        continue;
      }
      case 'sweep-write': {
        const landed = runWrites(
          q.sweepWrites,
          e.pages,
          {
            targetKind: e.targetKind,
            ...(e.docDir ? { docDir: e.docDir } : {}),
            nowIso: e.nowIso,
            calls: e.calls,
            featuresDs: e.read.featuresDs,
            questionsDs: e.read.questionsDs,
          },
          (w, cur) => prepareQ(s, e.pages, e.targetKind === 'local', w, cur),
          e.owed,
        );
        for (const l of landed)
          if (l.write.kind === 'block' && l.write.outcome?.kind === 'landed')
            e.log('item', `«${l.write.label}» · written · marker swept · body ${l.bodyHash ?? '—'}`);
        if (e.owed.calls.length) return 'owed';
        q.stage = 'report';
        continue;
      }
      case 'report': {
        finish(q, e);
        q.stage = 'done';
        continue;
      }
      case 'done':
        return 'done';
    }
  }
  return 'done';
}

// ---- Q6: the lines and the report ---------------------------------------------------------------------------------------

function finish(q: QState, e: QEnv): void {
  const plan = q.plan;
  const s = current(e.s, e.pages);
  const f = plan?.funnel ?? { drafted: q.cands.length, defaults: 0, fixes: 0, slots: 0, questions: 0, discarded: 0 };
  const perPass = Object.entries(q.passes)
    .map(([p, n]) => `${p} ${n}`)
    .join(' · ');
  e.log(
    'funnel',
    `${f.drafted} drafted${perPass ? ` (${perPass})` : ''} → ${f.defaults} routed default · ${f.fixes} routed fix · ${f.slots} routed slot · ${f.questions} written as questions · ${f.discarded} discarded`,
  );
  // The GRILL line: every body attacked, with the hash it carries now this run has finished with it (v24), and how it got there.
  const surface = q.surface;
  const bodyHash = (id: string): string => {
    const content = e.pages.content[id] ?? s.features.find((x) => x.id === id)?.content ?? '';
    const h = hashBody(content);
    return h ? sha12(h) : '—';
  };
  const named = [
    ...(surface?.attacked ?? []).map((a) => ({ id: a.id, how: a.how })),
    ...(surface?.queued ?? []).map((id) => ({ id, how: 'queued' })),
  ];
  const outstanding =
    s.features.some((x) => x.body.markers.some((m) => m.link.kind === 'carried')) ||
    s.questions.some((x) => x.status === 'Open' || x.status === 'Answered') ||
    (surface?.queued.length ?? 0) > 0;
  const converged = f.drafted === 0 || (f.questions + f.defaults + f.fixes + f.slots === 0 && !outstanding);
  const converge = !outstanding && f.questions + f.defaults + f.fixes + f.slots === 0 && q.wroteThisRun.length === 0;
  e.log(
    'GRILL',
    `${surface?.scale ?? q.scale} · ${surface?.passes.length ?? 0} dispatches · ${named.map((x) => `«${s.features.find((ft) => ft.id === x.id)?.name ?? x.id}» ${bodyHash(x.id)} (${x.how})`).join(' · ') || 'no body attacked'} · converged: ${converge && converged ? 'yes' : 'no'}`,
  );
  const written = plan?.questions.length ?? 0;
  e.log(
    'MARKERS',
    `challenge handoff — ${plan?.questions.filter((x) => q.cands.find((c) => c.id === x.id)?.marker).length ?? 0} patched with their row · ${plan?.defaults.length ?? 0} default line(s) · ${q.sweepNotes.filter((x) => /removed \(route 2\)/.test(x)).length} removed (route 2)`,
  );
  const sweep = [
    ...new Set([
      ...q.writes.flatMap((w) =>
        w.kind === 'block'
          ? scan(w.after ?? '', e.barred)
          : w.kind === 'create-question'
            ? scan(`${w.question}\n${w.whyAsked}\n${w.directions ?? ''}`, e.barred)
            : [],
      ),
    ]),
  ];
  e.log(
    'SWEEP-NOTE',
    `content rule swept this challenge run's ${q.writes.length} write(s) — titles, Why asked, directions, default, fix and slot lines — and its log lines · ${sweep.length ? `found ${sweep.join(', ')} — named for a human to edit to the role` : '0 findings'}`,
  );
  // The screen the ledger is printed on, kept so a later veto's numbers resolve by content (Q1, v30).
  const riskSorted = [...(plan?.defaults ?? [])].sort((a, b) =>
    a.risk === b.risk ? a.n - b.n : a.risk === 'high' ? -1 : 1,
  );
  const screen: ScreenLine[] = riskSorted.map((d, i) => ({
    screen: i + 1,
    kind: 'defaults',
    run: d.run,
    n: d.n,
    text: d.line,
  }));
  if (screen.length) saveScreen(e.home, riskSorted[0]?.run ?? e.st.runId, screen);
  q.report.push(...report(q, e, riskSorted, written, converge && converged));
}

function report(
  q: QState,
  e: QEnv,
  riskSorted: NonNullable<QState['plan']>['defaults'],
  written: number,
  converged: boolean,
): string[] {
  const p = q.plan;
  const f = p?.funnel;
  const out: string[] = [];
  out.push(
    `FUNNEL     ${f ? `${f.drafted} candidates drafted → ${f.defaults} routed default · ${f.fixes} routed fix · ${f.slots} routed slot · ${f.questions} written as questions · ${f.discarded} discarded on a filter` : 'nothing drafted'}`,
  );
  if (q.surface)
    out.push(
      `SCALE      ${q.surface.scale} · ${q.surface.passes.length} dispatch(es)${q.surface.queued.length ? ` · queued: ${q.surface.queued.length} bodies — the next run starts with them` : ''}`,
    );
  if (converged)
    out.push(`nothing has changed since run ${e.st.runId} grilled this document, and nothing is waiting on anybody.`);
  if (p?.unverified) out.push(`${p.unverified} items written unverified — no second dispatch was available.`);
  if (riskSorted.length) {
    out.push(`DEFAULTS ADOPTED (${riskSorted.length}) — ratify or veto by number; risk-sorted`);
    riskSorted.forEach((d, i) =>
      out.push(
        `   ${i + 1}. «${d.feature}»  ${d.line} — does not decide: ${d.doesNotDecide}${d.disagreement ? ` · ${d.disagreement}` : ''}`,
      ),
    );
    out.push(
      `   say "ratify ${riskSorted[0]?.run ?? ''}" or "veto ${riskSorted[0]?.run ?? ''} #n" to the next challenge run`,
    );
  }
  if (p?.fixes.length) {
    out.push(`FIXES APPLIED (${p.fixes.length}) — ratify below`);
    for (const x of p.fixes) out.push(`   «${x.feature}» "${x.old}" → "${x.new}"`);
  }
  if (p?.slots.length) {
    out.push(
      `CONTENT SLOTS (${p.slots.length}) — one batched sign-off; the document defines the slot, the client fills it`,
    );
    for (const x of p.slots) out.push(`   «${x.feature}»  ${x.line}`);
  }
  const cold = Object.values(q.cold);
  if (cold.length) {
    const c = (v: string): number => cold.filter((x) => x.verdict === v).length;
    out.push(
      `COLD READ  ${cold.length} drafted rows read · ${c('stands')} stands · ${c('answered')} answered · ${c('irrelevant')} irrelevant · ${c('simplify')} simplified · ${c('extend')} extended · ${cold.filter((x) => x.action === 'absorbed').length} absorbed`,
    );
    for (const x of cold.filter((y) => y.check)) out.push(`   ${x.check ?? ''}`);
  }
  out.push(
    `WRITTEN    ${written} → Open, each naming its client-only act. No sitting asked — they wait in the Unsent tab (questions.md on a local folder): answer directly, reject with a reason, or carry into a packet.`,
  );
  const top = (p?.questions ?? []).slice(0, 2);
  if (top.length) {
    out.push('SUGGESTED DIRECTIONS — top by ordering');
    for (const x of top)
      out.push(
        `  «${x.title}»`,
        ...x.directions
          .split('\n')
          .slice(0, -1)
          .map((l) => `    ${l}`),
      );
  }
  const byFeature = new Map<string, number>();
  for (const x of p?.questions ?? []) for (const t of x.touches) byFeature.set(t, (byFeature.get(t) ?? 0) + 1);
  const heavy = [...byFeature].filter(([, n]) => n > 1);
  if (heavy.length)
    out.push(
      `ROUTING DIAGNOSTIC  ${heavy.map(([ft, n]) => `«${ft}» carries ${n} new open questions`).join(' · ')} — a routing check, not thoroughness: name the channel that leaked, or the legal weight that justifies it`,
    );
  const groups = new Map<string, string[]>();
  for (const x of p?.questions ?? []) groups.set(x.area, [...(groups.get(x.area) ?? []), x.title]);
  if (groups.size) {
    out.push('WAITING ON ANSWERS — a candidate list for a client packet, not a send; a person decides what goes');
    for (const [area, titles] of groups)
      out.push(
        `  ${area} (${titles.length})  ${titles
          .slice(0, 2)
          .map((t) => `«${t}»`)
          .join(' · ')}${titles.length > 2 ? ` · ${titles.length - 2} more` : ''}`,
      );
    out.push(
      '  Applied answers create new attackable text — expect one smaller derivative batch after these are resolved.',
    );
  }
  if (p?.discards.length) {
    out.push('NOT PROPOSED, AND WHY');
    for (const d of p.discards)
      out.push(
        `  «${d.gap.slice(0, 80)}»  ${d.filter}${d.quote ? ` — "${d.quote.slice(0, 80)}"` : ''}${d.counterCase ? ` · counter-case: ${d.counterCase}` : ''}`,
      );
  }
  if (p?.noChannel.length) {
    out.push(`DISPOSED WITH NO CHANNEL (${p.noChannel.length}) — the document cannot write these; their owner can`);
    for (const d of p.noChannel) out.push(`  «${d.gap.slice(0, 80)}»  ${d.disposition} — ${d.needs}`);
  }
  if (p?.refused.length) out.push('ROUTING REFUSED', ...p.refused.map((x) => `  ${x}`));
  if (q.sweepNotes.length) out.push('SWEEP', ...q.sweepNotes.map((x) => `  ${x}`));
  if (q.failedTasks.length)
    out.push(`PASSES THAT COULD NOT BE READ  ${q.failedTasks.join(', ')} — their bodies are attacked again next run`);
  out.push('', 'An empty question list is not evidence this Blueprint is complete.');
  return out.map((l) => redact(l, e.barred));
}
