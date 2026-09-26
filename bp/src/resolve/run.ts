import { join } from 'node:path';
import { localDate, type Clock } from '../core/clock.ts';
import { blockText, hashBody, sha12, sha256, SHA12, type Sha12 } from '../core/hash.ts';
import { object, oneOf, optional, string, type Schema } from '../core/schema.ts';
import { quoteFound } from '../core/text.ts';
import { hasNumberedRequirement, nextFreeFr } from '../domain/feature.ts';
import { parseDirections, readAnswer, type Question } from '../domain/question.ts';
import type { ParsedLog } from '../log/parse.ts';
import { makeFeature, touchedFeatures, type FeatureRec, type Snapshot } from '../snapshot.ts';
import type { TaskSpec } from '../tasks/tasks.ts';
import { collect, data, nonceFor, writeTask, type Collected } from '../tasks/tasks.ts';
import type { TranscriptSet, ToolCall } from '../target/transcript.ts';
import { readAllToolCalls, latestCall, canonicalJson } from '../target/transcript.ts';
import {
  advanceWrite,
  fetchCall,
  type PushItemState,
  type StagedBlockWrite,
  type WriteOutcome,
} from '../target/push.ts';
import { writeLocalBlock, setLocalQuestionFields } from '../target/local-write.ts';
import { CONNECTOR } from '../target/relay.ts';
import { normaliseId, parseFetch, richText } from '../target/notion.ts';
import { planResolve, type Item } from './plan.ts';
import { readFacts } from '../log/facts.ts';
import {
  roundOf,
  overviewCheckBrief,
  pinOf,
  projectWriterBrief,
  ProjectWriterSchema,
  proposalObjection,
  proposalText,
  requirementIndex,
  type ProjectWriterOutput,
} from './project.ts';
import {
  assemble,
  CheckerSchema,
  contentCheck,
  DeltaRefused,
  GATED_BLOCKS,
  groundingKinds,
  outcome,
  WriterSchema,
  type WriterOutput,
} from './apply.ts';
import type { ItemState, ResolveState } from '../runs/resolve-state.ts';

// The resolve engine: each call advances the run as far as the facts in hand allow and returns what is owed next — model
// tasks to dispatch, connector calls to make, or nothing (the sitting is ready to close). Every mechanical act of R1–R5 is
// here; every judgment is a task a subagent answers (R3.1 writer, R3.2 check). resolve.md is the rule; this executes it.

export const SITTING_CAP = 10;

export interface Env {
  home: string;
  skillRoot: string;
  clock: Clock;
  transcripts: TranscriptSet | null;
  targetKind: 'notion' | 'local';
  /** Local target only: the document folder. */
  docDir?: string;
  log: ParsedLog | null;
  barred: string[];
}

export interface Owed {
  tasks: TaskSpec[];
  calls: { tool: string; input: Record<string, unknown> }[];
  waiting: string[];
}

const now = (env: Env): string => env.clock.now().toISOString();
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---- planning a sitting ---------------------------------------------------------------------------------------------

/** R5's bands: (1) a single-feature row that resolves an open marker; (2) other single-feature rows; (3) the rest. */
export function bandOf(it: Item): 1 | 2 | 3 {
  if (it.path !== 'single') return 3;
  return it.markers.length ? 1 : 2;
}

/** Plan one sitting: R2's flags are disposed at once; the next ten items (a feature's rows kept together) are taken. */
export function planSitting(s: Snapshot, st: ResolveState, env: Env): { r2Lines: string[] } {
  const plan = planResolve(s, env.log);
  const done = new Set(st.disposed);
  const r2Lines: string[] = [];
  for (const f of plan.flags) {
    if (done.has(f.row.id)) continue;
    st.items.push(
      blankItem(f.row, null, 3, { final: 'Flagged', objection: f.objection, stage: 'done', verdict: f.route }),
    );
    r2Lines.push(`${f.route} · «${short(f.row.question)}» \`${f.row.id}\` · flagged: ${f.objection}`);
  }
  for (const rb of plan.rebaselines) st.rebaselines.push({ feature: rb.feature.name, hash: rb.current });
  const eligible = plan.items
    .filter((i) => !done.has(i.row.id))
    .sort((a, b) => bandOf(a) - bandOf(b) || (a.features[0]?.name ?? '').localeCompare(b.features[0]?.name ?? ''));
  let taken = 0;
  const facts = env.log ? readFacts(env.log) : null;
  for (const it of eligible) {
    if (taken >= SITTING_CAP) break;
    taken += 1;
    if (it.path === 'single') {
      st.items.push(blankItem(it.row, it.features[0]?.id ?? null, bandOf(it), {}));
      continue;
    }
    // R3.1's project-level path (Touches empty, or several features) — and, where a proposal stands, the overview
    // route's round two.
    const round = roundOf(it.row, facts);
    if (round.note) st.notes.push(`«${short(it.row.question)}»: ${round.note}`);
    if (round.kind === 'reflag') {
      st.items.push(
        blankItem(it.row, null, 3, {
          kind: 'project',
          final: 'Flagged',
          objection: round.objection,
          stage: 'done',
          verdict: 'R3.1 overview route',
        }),
      );
      continue;
    }
    if (round.kind === 'accept') {
      st.items.push(
        blankItem(it.row, null, 3, {
          kind: 'overview-write',
          block: round.block,
          proposal: { block: round.block, text: round.text, pin: round.pin },
          verdict: `accepted by ${round.via === 'substitution' ? "the human's own block text" : round.via === 'move' ? 'the move back to Answered' : 'the standing move (pre-v35 flag)'}`,
          stage: 'push',
        }),
      );
      continue;
    }
    st.items.push(blankItem(it.row, null, 3, { kind: 'project' }));
  }
  for (const n of plan.notes) st.notes.push(n);
  r2Lines.unshift(
    `R2 · queue ${plan.queue.length} · ${plan.items.length} pass R2 · ${plan.flags.length} flagged · ${plan.rebaselines.length} body changed outside the seam`,
  );
  return { r2Lines };
}

const short = (q: string): string => (q.length > 70 ? `${q.slice(0, 69)}…` : q);

function blankItem(row: Question, feature: string | null, band: 1 | 2 | 3, over: Partial<ItemState>): ItemState {
  return {
    rowId: row.id,
    question: row.question,
    feature,
    band,
    stage: 'writer',
    writerRetried: false,
    writerRepaired: false,
    checkerRepaired: false,
    logged: false,
    propsDone: false,
    ...over,
  };
}

// ---- briefs -----------------------------------------------------------------------------------------------------------

function operatingLines(s: Snapshot): string {
  const op = s.overview?.parsed.block('Operating');
  return op ? op.lines.join('\n').trim() : '(no Operating block)';
}

function currentFeature(s: Snapshot, st: ResolveState, id: string): FeatureRec | undefined {
  const f = s.features.find((x) => x.id === id);
  if (!f) return undefined;
  const override = st.bodies[id];
  return override === undefined ? f : makeFeature({ ...f, content: override });
}

function writerBrief(o: {
  s: Snapshot;
  st: ResolveState;
  row: Question;
  f: FeatureRec;
  kinds: Set<string>;
  objection?: string;
  repair?: string;
  env: Env;
}): string {
  const reading = readAnswer(o.row.answer, parseDirections(o.row.directions));
  const behaviour = blockText(o.f.content, 'Behaviour') ?? '(no Behaviour block)';
  const notDoing = blockText(o.f.content, 'Not doing') ?? '(no Not doing block)';
  const mine = o.f.body.markers.filter(
    (m) => m.link.kind === 'question' && (m.link.id === o.row.id || m.link.key === o.row.id),
  );
  const parts = [
    '# Writer brief',
    data('the feature this answer is written into — «name» · area', `«${o.f.name}» · ${o.f.area}`),
    '',
    '## The vetted answer',
    data('question', o.row.question),
    data("answer & why — the human's own words", o.row.answer),
  ];
  if (reading.kind === 'pointer')
    parts.push(
      data(
        `the chosen direction ${reading.n}'s decision clause — machine-drafted, chosen by the answer; not the human's words`,
        reading.decision,
      ),
    );
  parts.push(
    '',
    '## The feature as it stands',
    data('What it does', o.f.whatItDoes),
    mine.length
      ? `The marker this answer resolves sits on ${mine.map((m) => (m.fr ? `FR-${m.fr}` : m.block)).join(', ')}.`
      : 'No marker on this feature points at this row.',
    data('Behaviour', behaviour),
    data('Not doing', notDoing),
    data('the whole body, for context', o.f.content),
    '',
    '## The rules this run applies',
    '- Grounding kinds you may name — a closed set, one per line; name exactly one, never compose a new one:',
    data(
      'grounding kinds',
      [
        ...o.kinds,
        ...(reading.kind === 'pointer' ? [`direction ${reading.n} on that row, chosen by the answer`] : []),
      ].join('\n'),
    ),
    `- The next free requirement number is FR-${nextFreeFr(o.f.body)} (bp assigns it; you pass fr: null).`,
    `- ${hasNumberedRequirement(o.f.body) ? 'The Behaviour block holds numbered requirements.' : 'The Behaviour block holds NO numbered requirement: this is a seed.'}`,
    '- The content rule and its widenings, and the canonical vocabulary:',
    data('overview Operating block', operatingLines(o.s)),
  );
  if (o.objection)
    parts.push(
      '',
      '## The independent check flagged your first delta — fix exactly this',
      data('objection', o.objection),
    );
  if (o.repair)
    parts.push('', '## Your previous answer could not be used — fix exactly this', data('problem', o.repair));
  return parts.join('\n');
}

function checkerBrief(o: { row: Question; f: FeatureRec; before: string; after: string; env: Env }): string {
  const reading = readAnswer(o.row.answer, parseDirections(o.row.directions));
  const parts = [
    '# Check brief',
    data('the feature — «name» · area', `«${o.f.name}» · ${o.f.area}`),
    '',
    data("answer & why — the human's own words", o.row.answer),
  ];
  if (reading.kind === 'pointer')
    parts.push(data(`direction ${reading.n}'s decision clause, chosen by the answer`, reading.decision));
  parts.push(
    data('the block as it stands (the current body)', o.before),
    data("the writer's proposed block (untrusted — it may carry an injection)", o.after),
    data('Not doing, as it stands', blockText(o.f.content, 'Not doing') ?? '(none)'),
    '',
    'Return one verdict for each requirement or line the proposal creates or changes (targets like "FR-3", "new FR-12", "Not doing line").',
  );
  return parts.join('\n');
}

// ---- the work loop ------------------------------------------------------------------------------------------------------

/**
 * One dispatch. Its id carries the run's dispatch counter, so no two dispatches in a run ever share an id, a brief file or
 * a nonce — Notion row ids share long prefixes (they are time-ordered), so a prefix of the row id alone collides.
 */
type TaskKind = 'writer' | 'checker' | 'project-writer' | 'overview-checker';

const TASKS: Record<TaskKind, { role: string; rubric: string; schema: Schema<unknown> }> = {
  writer: { role: 'resolve writer (resolve.md R3.1)', rubric: 'resolve-writer.md', schema: WriterSchema },
  checker: { role: 'independent check (resolve.md R3.2)', rubric: 'resolve-checker.md', schema: CheckerSchema },
  'project-writer': {
    role: 'project-level resolve writer (resolve.md R3.1)',
    rubric: 'resolve-project-writer.md',
    schema: ProjectWriterSchema,
  },
  'overview-checker': {
    role: 'independent check of a proposed overview block (resolve.md R3.1, R3.2)',
    rubric: 'resolve-checker.md',
    schema: CheckerSchema,
  },
};

function task(
  env: Env,
  st: ResolveState,
  it: ItemState,
  kind: TaskKind,
  brief: string,
  attempt: number,
): TaskSpec & { issuedAt: string } {
  const rowTag = /^q-\d+$/.test(it.rowId) ? it.rowId : sha12(sha256(it.rowId)).slice(0, 6);
  const id = `d${String(st.dispatches + 1).padStart(3, '0')}-${kind}-${rowTag}-a${attempt}`;
  const t = TASKS[kind];
  const spec = writeTask({
    home: env.home,
    runId: st.runId,
    id,
    kind,
    role: t.role,
    rubric: join(env.skillRoot, 'rubrics', t.rubric),
    brief,
    schema: t.schema,
    nonce: nonceFor(st.runId, id, st.salt ?? st.startedAt),
  });
  st.dispatches += 1;
  return { ...spec, issuedAt: now(env) };
}

const taskRef = (t: TaskSpec & { issuedAt: string }, kind: TaskKind) => ({
  id: t.id,
  nonce: t.nonce,
  kind,
  prompt: t.prompt,
  brief: t.brief,
  issuedAt: t.issuedAt,
});

// ---- the project-level path and the overview route (resolve.md R3.1) --------------------------------------------------------

/** st.bodies' key for the overview's content as this run's last write left it. */
const OVERVIEW_KEY = 'overview';

function stepProject(
  s: Snapshot,
  st: ResolveState,
  env: Env,
  it: ItemState,
  kinds: Set<string>,
  calls: readonly ToolCall[],
  owed: Owed,
): void {
  const row = s.questions.find((q) => q.id === it.rowId);
  if (!row) return flag(it, 'the row is no longer in the Blueprint', 'R2.1');
  const overview = st.bodies[OVERVIEW_KEY] ?? s.overview?.content ?? '';
  if (it.kind === 'overview-write') return stepOverviewWrite(s, st, env, it, overview, calls, owed);
  const current = (f: FeatureRec): FeatureRec => currentFeature(s, st, f.id) ?? f;
  const touched = touchedFeatures(s, row).found.map(current);
  const brief = (extra: { objection?: string; repair?: string } = {}): string =>
    projectWriterBrief({ s, row, touched, index: requirementIndex(s, st.bodies, current), overview, kinds, ...extra });
  const repair = (problem: string): void => {
    if (it.writerRepaired) return flag(it, `the project writer's answer broke a rule twice: ${problem}`, 'R3.1');
    it.writerRepaired = true;
    const t = task(env, st, it, 'project-writer', brief({ repair: problem }), 2);
    it.writer = taskRef(t, 'project-writer');
    owed.tasks.push(t);
  };

  if (it.stage === 'writer') {
    if (!it.writer) {
      const t = task(env, st, it, 'project-writer', brief(), 1);
      it.writer = taskRef(t, 'project-writer');
      owed.tasks.push(t);
      return;
    }
    const got = collect({ task: it.writer, schema: ProjectWriterSchema, transcripts: env.transcripts });
    if (!got.ok) {
      if (got.reason === 'not-found') {
        owed.waiting.push(`project writer for «${short(it.question)}» (task ${it.writer.id})`);
        return;
      }
      return repair(
        got.reason === 'invalid'
          ? `your JSON did not match the schema: ${(got.issues ?? []).map((i) => `${i.path} ${i.message}`).join('; ')}`
          : `your answer was ${got.reason}`,
      );
    }
    it.writerReceipt = got.receipt;
    it.writerOut = got.value;
    const out: ProjectWriterOutput = got.value;
    if (out.output === 'conflict')
      return flag(
        it,
        `conflict — «${out.section}» changed since the run read it; nothing written, the other author's text stands`,
        'R3.1 output 4',
      );
    if (out.output === 'already_carries') {
      const where = out.feature ? s.features.find((x) => x.name === out.feature) : undefined;
      const text = where ? current(where).content : overview;
      if (!quoteFound(text, out.quote))
        return repair(
          `the already_carries quote is not found verbatim in ${where ? `«${where.name}»` : 'the overview'}`,
        );
      it.final = 'Applied';
      it.verdict = 'no change — already carries';
      it.note = `already carries it${where ? ` on «${where.name}»` : ' in the overview'}: "${clean(out.quote).slice(0, 120)}"`;
      it.stage = 'done';
      return;
    }
    if (out.output === 'features') {
      const names = out.writes.map((w) => w.feature);
      const found = names.map(
        (n) => s.features.find((x) => x.name === n) ?? s.features.find((x) => x.name.toLowerCase() === n.toLowerCase()),
      );
      const unknown = names.filter((_, i) => !found[i]);
      if (unknown.length)
        return repair(
          `no feature is named ${unknown.map((n) => `«${n}»`).join(', ')} — name features exactly as the index does`,
        );
      const ids = found.map((f) => f?.id ?? '');
      if (new Set(ids).size !== ids.length)
        return repair('each feature takes one write — put every change to a feature into its one delta');
      const outside = touched.length ? found.filter((f) => f && !touched.some((t) => t.id === f.id)) : [];
      if (outside.length)
        return repair(
          `the row's Touches names ${touched.map((t) => `«${t.name}»`).join(', ')}; ${outside.map((f) => `«${f?.name ?? ''}»`).join(', ')} is outside its scope — describe it, never write it`,
        );
      out.writes.forEach((w, i) => {
        st.items.push(
          blankItem(row, ids[i] ?? null, 3, {
            kind: 'single',
            parent: row.id,
            preset: { output: 'delta', ...w.delta },
            writerReceipt: got.receipt,
          }),
        );
      });
      it.touched = found.map((f) => `«${f?.name ?? ''}»`);
      it.stage = 'children';
      return;
    }
    // The overview route, round one: the block is proposed, checked, pinned, and the row flagged for a person.
    const before = blockText(overview, out.block);
    if (before === undefined)
      return repair(`the overview has no «${out.block}» block — a proposal replaces a block that exists`);
    const trailing = /\n*$/.exec(before)?.[0] ?? '';
    const after = `## ${out.block}\n${out.text.trim()}${trailing}`;
    const leaks = contentCheck(after, env.barred);
    if (leaks.length)
      return flag(
        it,
        `the proposed block carries ${leaks.join(' and ')} — the content rule bars it; write the role, never the specific (doc-shape §6)`,
        'R2.5',
      );
    it.block = out.block;
    it.before = before;
    it.after = after;
    it.stage = 'checker';
  }

  if (it.stage === 'checker') {
    const block = it.block ?? '';
    if (!st.noSecondDispatch) {
      const checkBrief = overviewCheckBrief({ row, block, before: it.before ?? '', after: it.after ?? '' });
      if (!it.checker) {
        const t = task(env, st, it, 'overview-checker', checkBrief, 1);
        it.checker = taskRef(t, 'overview-checker');
        owed.tasks.push(t);
        return;
      }
      const got = collect({ task: it.checker, schema: CheckerSchema, transcripts: env.transcripts });
      if (!got.ok) {
        if (got.reason === 'not-found') {
          owed.waiting.push(`check of the proposal for «${short(it.question)}» (task ${it.checker.id})`);
          return;
        }
        if (it.checkerRepaired) return flag(it, `the check's answer could not be read (${got.reason}) twice`, 'R3.2');
        it.checkerRepaired = true;
        const t = task(
          env,
          st,
          it,
          'overview-checker',
          `${checkBrief}\n\n## Your previous answer could not be used\n${got.reason}`,
          2,
        );
        it.checker = taskRef(t, 'overview-checker');
        owed.tasks.push(t);
        return;
      }
      it.checkerReceipt = got.receipt;
      it.checkerOut = got.value;
      const objections = got.value.verdicts.filter((v) => v.verdict === 'Flagged' || v.verdict === 'Patched');
      if (objections.length) {
        const objection = objections
          .map((v) => `${v.target}: ${v.inconsistency || 'a proposal is never patched'}`)
          .join(' · ');
        if (it.writerRetried) return flag(it, objection, 'Flagged');
        it.writerRetried = true;
        delete it.checker;
        const t = task(env, st, it, 'project-writer', brief({ objection }), 3);
        it.writer = taskRef(t, 'project-writer');
        it.stage = 'writer';
        owed.tasks.push(t);
        return;
      }
    }
    const body = (it.after ?? '').split('\n').slice(1).join('\n');
    const { append, text } = proposalText({ runId: st.runId, date: localDate(env.clock.now()), block, body });
    const pin = pinOf(text);
    it.proposal = { block, text, pin };
    it.whyAskedAppend = append;
    it.touched = [`overview «${block}» (proposed)`];
    return flag(it, proposalObjection(pin, row.answer), 'R3.1 overview route, round one');
  }

  if (it.stage === 'children') {
    const kids = st.items.filter((c) => c.parent === it.rowId);
    if (kids.some((c) => c.stage !== 'done')) return;
    const bad = kids.filter((c) => c.final !== 'Applied');
    const name = (c: ItemState): string => `«${s.features.find((f) => f.id === c.feature)?.name ?? c.feature ?? '?'}»`;
    if (!bad.length) {
      it.final = 'Applied';
      it.verdict = `project-level · ${kids.length} feature write${kids.length === 1 ? '' : 's'}`;
      it.stage = 'done';
      return;
    }
    const good = kids.filter((c) => c.final === 'Applied');
    // Honest about a partial write: what landed stays written and is named; what did not is the objection.
    return flag(
      it,
      `${good.length ? `written into ${good.map(name).join(', ')}; ` : ''}not written into ${bad.map((c) => `${name(c)} (${c.objection ?? c.note ?? c.verdict ?? 'no write'})`).join('; ')}`,
      'project-level',
    );
  }
}

/** Round two: the accepted block text replaces the overview block, under operation 8's discipline (fetch, diff, write, read back). */
function stepOverviewWrite(
  s: Snapshot,
  st: ResolveState,
  env: Env,
  it: ItemState,
  overview: string,
  calls: readonly ToolCall[],
  owed: Owed,
): void {
  const prop = it.proposal;
  if (!prop || !s.overview)
    return flag(it, 'the overview could not be read, so the accepted block was not written', 'R3.1');
  if (!it.push) {
    const before = blockText(overview, prop.block);
    if (before === undefined)
      return flag(
        it,
        `the overview has no «${prop.block}» block to write the accepted text into — a person restores the block, then sets the row back to Answered`,
        'R3.1',
      );
    const trailing = /\n*$/.exec(before)?.[0] ?? '';
    const after = `${prop.text.trim()}${trailing}`;
    const leaks = contentCheck(after, env.barred);
    if (leaks.length)
      return flag(
        it,
        `the accepted block carries ${leaks.join(' and ')} — the content rule binds the front door too; write the role, never the specific (doc-shape §6)`,
        'R2.5',
      );
    it.touched = [`overview «${prop.block}»`];
    if (before.replace(/\s+$/, '') === after.replace(/\s+$/, '')) {
      it.final = 'Applied';
      it.verdict = 'no change — the overview already carries the accepted block';
      it.stage = 'done';
      return;
    }
    it.before = before;
    it.after = after;
    const page = env.targetKind === 'local' ? join(env.docDir ?? s.target.address, 'README.md') : s.overview.id;
    it.push = {
      write: { key: it.rowId, page, label: 'overview', block: prop.block, before, after },
      stage: 'fetch',
      plannedAt: now(env),
    } satisfies PushItemState;
  }
  const p = toPush(it.push);
  if (!p) return flag(it, 'the staged write was lost from the run state', 'R3.6');
  let result: WriteOutcome | undefined;
  if (env.targetKind === 'local') result = writeLocalBlock(p.write.page, p.write.block, p.write.before, p.write.after);
  else {
    const owedCall = advanceWrite(p, calls, now(env));
    it.push = p;
    if (owedCall) {
      owed.calls.push(owedCall.call);
      return;
    }
    result = p.outcome;
  }
  if (!result) return;
  if (result.kind === 'conflict')
    return flag(
      it,
      `conflict — the overview's «${p.write.block}» block changed since the run read it; nothing written, the other author's text stands`,
      'conflict',
    );
  if (result.kind === 'refused') return flag(it, `the write did not land: ${result.reason}`, 'refused');
  st.bodies[OVERVIEW_KEY] = result.content ?? overview.replace(p.write.before, p.write.after);
  it.final = 'Applied';
  it.stage = 'done';
}

/** A stored body hash, re-proven on read: 12 lowercase hex, or 'none'. */
function asHash(v: string | undefined): Sha12 | 'none' {
  return v !== undefined && SHA12.test(v) ? (v as Sha12) : 'none'; // proven by the SHA12 test on the same line
}

const PushSchema = object({
  write: object({
    key: string(),
    page: string(),
    label: string(),
    block: string(),
    through: optional(string()),
    before: string(),
    after: string(),
  }),
  stage: oneOf(['fetch', 'write', 'readback', 'done'] as const),
  plannedAt: string(),
  oldStr: optional(string()),
  newStr: optional(string()),
  expect: optional(string()),
  outcome: optional(
    object({
      kind: oneOf(['landed', 'conflict', 'refused'] as const),
      bodyHash: optional(string()),
      note: optional(string()),
      content: optional(string()),
      current: optional(string()),
      reason: optional(string()),
    }),
  ),
});

function toPush(v: unknown): PushItemState | undefined {
  const r = PushSchema.parse(v);
  if (!r.ok) return undefined;
  const o = r.value.outcome;
  const outcomeV: WriteOutcome | undefined = !o
    ? undefined
    : o.kind === 'landed'
      ? {
          kind: 'landed',
          bodyHash: asHash(o.bodyHash),
          ...(o.note ? { note: o.note } : {}),
          ...(o.content !== undefined ? { content: o.content } : {}),
        }
      : o.kind === 'conflict'
        ? { kind: 'conflict', current: o.current ?? '' }
        : { kind: 'refused', reason: o.reason ?? '' };
  const { through, ...write } = r.value.write;
  return {
    write: { ...write, ...(through !== undefined ? { through } : {}) },
    stage: r.value.stage,
    plannedAt: r.value.plannedAt,
    ...(r.value.oldStr !== undefined ? { oldStr: r.value.oldStr } : {}),
    ...(r.value.newStr !== undefined ? { newStr: r.value.newStr } : {}),
    ...(r.value.expect !== undefined ? { expect: r.value.expect } : {}),
    ...(outcomeV ? { outcome: outcomeV } : {}),
  };
}

const isDone = (it: ItemState): boolean => it.stage === 'done';
const stageOf = (it: ItemState): ItemState['stage'] => it.stage;

/** Advance every item as far as it can go. Returns what is owed. */
export function work(s: Snapshot, st: ResolveState, env: Env): Owed {
  const owed: Owed = { tasks: [], calls: [], waiting: [] };
  const kinds = groundingKinds(s.features);
  const calls: ToolCall[] = env.transcripts ? readAllToolCalls(env.transcripts) : [];
  // Serial within a feature: only the first unfinished item of each feature group is active.
  const active = new Set<string>();
  for (const it of st.items) {
    if (it.stage === 'done' || !it.feature) continue;
    if (active.has(it.feature)) continue;
    active.add(it.feature);
    for (let guard = 0; guard < 8; guard++) {
      const stageBefore = stageOf(it);
      step(s, st, env, it, kinds, calls, owed);
      const stageAfter = stageOf(it); // read through a call: step() mutates the item, which narrowing cannot see
      if (stageAfter === stageBefore || stageAfter === 'done') break;
    }
    if (isDone(it)) active.delete(it.feature); // a finished item frees its feature for the next one
  }
  // A freed feature may have a next item: one more pass picks it up.
  for (const it of st.items) {
    if (it.stage === 'done' || !it.feature || active.has(it.feature)) continue;
    active.add(it.feature);
    step(s, st, env, it, kinds, calls, owed);
  }
  // Project-level rows run serially (R3): one at a time, over the bodies the single-feature items have settled. A row whose
  // writes are still being made by its per-feature children waits for them.
  for (let guard = 0; guard < 4; guard++) {
    const it = st.items.find((x) => (x.kind === 'project' || x.kind === 'overview-write') && x.stage !== 'done');
    if (!it) break;
    const before = `${it.stage}|${st.items.length}`;
    stepProject(s, st, env, it, kinds, calls, owed);
    if (it.stage === 'children' && st.items.some((c) => c.parent === it.rowId && c.stage !== 'done')) {
      // Its children were just created, or are mid-flight: advance them now, serially per feature.
      const busy = new Set<string>();
      for (const c of st.items) {
        if (c.parent !== it.rowId || c.stage === 'done' || !c.feature || busy.has(c.feature)) continue;
        busy.add(c.feature);
        for (let g = 0; g < 8; g++) {
          const b = stageOf(c);
          step(s, st, env, c, kinds, calls, owed);
          const a = stageOf(c);
          if (a === b || a === 'done') break;
        }
      }
      stepProject(s, st, env, it, kinds, calls, owed);
    }
    if (`${it.stage}|${st.items.length}` === before || it.stage !== 'done') break;
  }
  return owed;
}

function flag(it: ItemState, objection: string, verdict: string): void {
  it.final = 'Flagged';
  it.objection = objection;
  it.verdict = verdict;
  it.stage = 'done';
}

function step(
  s: Snapshot,
  st: ResolveState,
  env: Env,
  it: ItemState,
  kinds: Set<string>,
  calls: readonly ToolCall[],
  owed: Owed,
): void {
  const row = s.questions.find((q) => q.id === it.rowId);
  const f = it.feature ? currentFeature(s, st, it.feature) : undefined;
  if (!row || !f) {
    flag(it, 'the row or its feature is no longer in the Blueprint', 'R2.1');
    return;
  }
  if (it.stage === 'writer') {
    // A per-feature write the project writer returned is this item's first delta: no dispatch of its own. A retry after
    // the check flags it goes to the single-feature writer like any other.
    const preset = it.preset !== undefined && !it.writer ? WriterSchema.parse(it.preset) : null;
    delete it.preset;
    if (!preset && !it.writer) {
      const t = task(env, st, it, 'writer', writerBrief({ s, st, row, f, kinds, env }), 1);
      it.writer = { id: t.id, nonce: t.nonce, kind: 'writer', prompt: t.prompt, brief: t.brief, issuedAt: t.issuedAt };
      owed.tasks.push(t);
      return;
    }
    const got: Collected<WriterOutput> = preset
      ? preset.ok
        ? { ok: true, value: preset.value, receipt: it.writerReceipt ?? { kind: 'none' } }
        : { ok: false, reason: 'invalid', issues: preset.issues, receipt: { kind: 'none' } }
      : it.writer
        ? collect({ task: it.writer, schema: WriterSchema, transcripts: env.transcripts })
        : { ok: false, reason: 'not-found', receipt: { kind: 'none' } };
    if (!got.ok) {
      if (got.reason === 'not-found') {
        owed.waiting.push(`writer for «${short(it.question)}» (task ${it.writer?.id ?? '?'})`);
        return;
      }
      if (it.writerRepaired) return flag(it, `the writer's answer could not be read (${got.reason}) twice`, 'R3.1');
      it.writerRepaired = true;
      const problem =
        got.reason === 'no-json'
          ? 'your answer carried no JSON object'
          : `your JSON did not match the schema: ${(got.issues ?? []).map((i) => `${i.path} ${i.message}`).join('; ')}`;
      const t = task(env, st, it, 'writer', writerBrief({ s, st, row, f, kinds, env, repair: problem }), 2);
      it.writer = { id: t.id, nonce: t.nonce, kind: 'writer', prompt: t.prompt, brief: t.brief, issuedAt: t.issuedAt };
      owed.tasks.push(t);
      return;
    }
    it.writerReceipt = got.receipt;
    it.writerOut = got.value;
    const out: WriterOutput = got.value;
    if (out.output === 'conflict')
      return flag(
        it,
        `conflict — «${out.section}» changed since the run read it; nothing written, the other author's text stands`,
        'R3.1 output 4',
      );
    if (out.output === 'belongs_to') {
      it.final = 'requeued';
      it.stage = 'done';
      it.note = `the writer places this answer on «${out.feature}», not «${f.name}» — repoint Touches if so; the row stays Answered`;
      return;
    }
    if (out.output === 'already_carries') {
      if (!quoteFound(f.content, out.quote)) {
        if (it.writerRepaired)
          return flag(
            it,
            'the writer said the body already carries the answer, and its quote is not in the body',
            'R3.1 output 2',
          );
        it.writerRepaired = true;
        const t = task(
          env,
          st,
          it,
          'writer',
          writerBrief({
            s,
            st,
            row,
            f,
            kinds,
            env,
            repair:
              'your already_carries quote is not found in the body verbatim — quote the carrying sentence exactly, or return a delta',
          }),
          2,
        );
        it.writer = {
          id: t.id,
          nonce: t.nonce,
          kind: 'writer',
          prompt: t.prompt,
          brief: t.brief,
          issuedAt: t.issuedAt,
        };
        owed.tasks.push(t);
        return;
      }
      it.final = 'Applied';
      it.verdict = 'no change — already carries';
      it.note = `already carries it: "${clean(out.quote).slice(0, 120)}"`;
      it.stage = 'done';
      return;
    }
    const item: Item = {
      row,
      reading: ((): Item['reading'] => {
        const r = readAnswer(row.answer, parseDirections(row.directions));
        return r.kind === 'pointer' ? r : { kind: 'prose' };
      })(),
      path: 'single',
      features: [f],
      markers: [],
      depth: ((): number => {
        const m = /·\s*depth\s+(\d+)/.exec(row.whyAsked);
        return m?.[1] ? Number(m[1]) : 1;
      })(),
      seed: !hasNumberedRequirement(f.body),
    };
    try {
      const a = assemble({ item, feature: f, out, date: localDate(env.clock.now()), kinds });
      const leaks = contentCheck(a.after, env.barred);
      if (leaks.length)
        return flag(
          it,
          `the delta carries ${leaks.join(' and ')} — the content rule bars it; write the role, never the specific (doc-shape §6)`,
          'R2.5',
        );
      it.block = a.block;
      if (a.through) it.through = a.through;
      else delete it.through;
      it.before = a.before;
      it.after = a.after;
      it.touched = a.touched;
      it.replaced = a.replaced;
      // The markers the write itself removes — never a recount from the old body (the MARKERS line reports these).
      it.markersRemoved = a.markersRemoved;
      it.stage = 'checker';
    } catch (err) {
      if (!(err instanceof DeltaRefused)) throw err;
      if (it.writerRepaired) return flag(it, `the writer's delta broke a rule twice: ${err.message}`, 'R3.1');
      it.writerRepaired = true;
      const t = task(env, st, it, 'writer', writerBrief({ s, st, row, f, kinds, env, repair: err.message }), 2);
      it.writer = { id: t.id, nonce: t.nonce, kind: 'writer', prompt: t.prompt, brief: t.brief, issuedAt: t.issuedAt };
      owed.tasks.push(t);
      return;
    }
  }
  if (it.stage === 'checker') {
    const assembled = {
      block: it.block ?? '',
      before: it.before ?? '',
      after: it.after ?? '',
      touched: it.touched ?? [],
    };
    // R3.6: the soft gate is the run's own act, before any verdict — recomputed from the block texts, and only for the
    // blocks the gate names (requirements, edge cases, Not doing lines).
    const replaces =
      GATED_BLOCKS.has(assembled.block) && !it.through && replacesExisting(assembled.before, assembled.after);
    const replaced = it.replaced?.length
      ? it.replaced
      : [{ target: it.touched?.join(', ') ?? 'block', old: '(the text the delta replaces)', new: '' }];
    const a2 = { ...assembled, replaces, replaced: replaces ? replaced : [] };
    // R3.6: in soft mode the run decides a replacement itself, before and independently of any check — nothing is
    // dispatched for a delta the mode will refuse.
    if (st.mode === 'soft' && replaces) {
      const kept = outcome({
        assembled: a2,
        check: null,
        mode: 'soft',
        writerRetried: it.writerRetried,
        checkerRepaired: it.checkerRepaired,
        feature: f,
        barred: env.barred,
      });
      if (kept.kind === 'Kept') return flag(it, kept.objection, 'Kept');
    }
    let check = null;
    if (!st.noSecondDispatch) {
      if (!it.checker) {
        const t = task(
          env,
          st,
          it,
          'checker',
          checkerBrief({ row, f, before: assembled.before, after: assembled.after, env }),
          1,
        );
        it.checker = {
          id: t.id,
          nonce: t.nonce,
          kind: 'checker',
          prompt: t.prompt,
          brief: t.brief,
          issuedAt: t.issuedAt,
        };
        owed.tasks.push(t);
        return;
      }
      const got = collect({ task: it.checker, schema: CheckerSchema, transcripts: env.transcripts });
      if (!got.ok) {
        if (got.reason === 'not-found') {
          owed.waiting.push(`check for «${short(it.question)}» (task ${it.checker.id})`);
          return;
        }
        if (it.checkerRepaired) return flag(it, `the check's answer could not be read (${got.reason}) twice`, 'R3.2');
        it.checkerRepaired = true;
        const t = task(
          env,
          st,
          it,
          'checker',
          `${checkerBrief({ row, f, before: assembled.before, after: assembled.after, env })}\n\n## Your previous answer could not be used\n${got.reason}`,
          2,
        );
        it.checker = {
          id: t.id,
          nonce: t.nonce,
          kind: 'checker',
          prompt: t.prompt,
          brief: t.brief,
          issuedAt: t.issuedAt,
        };
        owed.tasks.push(t);
        return;
      }
      it.checkerReceipt = got.receipt;
      it.checkerOut = got.value;
      check = got.value;
      if (got.receipt.kind !== 'transcript') check = null; // no receipt: the check cannot be shown to be a separate dispatch (rule 6)
    }
    const o = outcome({
      assembled: a2,
      check,
      mode: st.mode,
      writerRetried: it.writerRetried,
      checkerRepaired: it.checkerRepaired,
      feature: f,
      barred: env.barred,
    });
    if (o.kind === 'Kept') return flag(it, o.objection, 'Kept');
    if (o.kind === 'Flagged') {
      if (o.retry) {
        it.writerRetried = true;
        const t = task(env, st, it, 'writer', writerBrief({ s, st, row, f, kinds, env, objection: o.objection }), 3);
        it.writer = {
          id: t.id,
          nonce: t.nonce,
          kind: 'writer',
          prompt: t.prompt,
          brief: t.brief,
          issuedAt: t.issuedAt,
        };
        delete it.checker;
        it.stage = 'writer';
        owed.tasks.push(t);
        return;
      }
      return flag(it, o.objection, 'Flagged');
    }
    if (o.kind === 'repair-check') {
      it.checkerRepaired = true;
      const t = task(
        env,
        st,
        it,
        'checker',
        `${checkerBrief({ row, f, before: assembled.before, after: assembled.after, env })}\n\n## Your patch could not be applied\n${o.reason}`,
        3,
      );
      it.checker = {
        id: t.id,
        nonce: t.nonce,
        kind: 'checker',
        prompt: t.prompt,
        brief: t.brief,
        issuedAt: t.issuedAt,
      };
      owed.tasks.push(t);
      return;
    }
    // A patch is the checker's text: it passes the content rule like the writer's (R2.5 on the write path).
    const leaks = o.kind === 'Patched' ? contentCheck(o.after, env.barred) : [];
    if (leaks.length)
      return flag(
        it,
        `the check's patch carries ${leaks.join(' and ')} — the content rule bars it (doc-shape §6)`,
        'R2.5',
      );
    it.after = o.after;
    it.verdict = o.kind;
    it.stage = 'push';
    const w: StagedBlockWrite = {
      key: it.rowId,
      page: f.id,
      label: f.name,
      block: it.block ?? '',
      ...(it.through ? { through: it.through } : {}),
      before: it.before ?? '',
      after: o.after,
    };
    it.push = { write: w, stage: 'fetch', plannedAt: now(env) } satisfies PushItemState;
  }
  if (it.stage === 'push') {
    const p = toPush(it.push);
    if (!p) return flag(it, 'the staged write was lost from the run state', 'R3.6');
    let result: WriteOutcome | undefined;
    if (env.targetKind === 'local') {
      result = writeLocalBlock(f.source, p.write.block, p.write.before, p.write.after, p.write.through);
    } else {
      const owedCall = advanceWrite(p, calls, now(env));
      it.push = p;
      if (owedCall) {
        owed.calls.push(owedCall.call);
        return;
      }
      result = p.outcome;
    }
    if (!result) return;
    if (result.kind === 'conflict')
      return flag(
        it,
        `conflict — «${f.name}» ${p.write.block} changed since the run read it; nothing written, the other author's text stands (R3.1 output 4)`,
        'conflict',
      );
    if (result.kind === 'refused') return flag(it, `the write did not land: ${result.reason}`, 'refused');
    it.bodyHash = result.bodyHash;
    // The body as the read-back returned it: the next item on the feature is briefed and planned against it (R3, serial
    // within a group) — never against a local reconstruction the target may have normalised differently.
    st.bodies[f.id] = result.content ?? f.content.replace(p.write.before, p.write.after);
    it.final = 'Applied';
    it.stage = 'done';
  }
}

/** R3.6: does the delta replace or remove existing text in a requirement, an edge case or a Not doing line? */
export function replacesExisting(before: string, after: string): boolean {
  const PROV = /^\s*\*\(.*\)\*\s*$/;
  const strip = (l: string): string =>
    clean(l.replace(/\\?\[?NEEDS CLARIFICATION[^\n]*?\]/g, '')).replace(/[.;:!]+$/, '');
  const oldLines = before
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() && !PROV.test(l))
    .map(strip);
  const newText = after
    .split('\n')
    .slice(1)
    .filter((l) => !PROV.test(l))
    .map(strip)
    .join('\n');
  return oldLines.some((l) => !newText.includes(l));
}

// ---- properties (R5: content first, properties second, read back) --------------------------------------------------------

const updateProps = (page: string, properties: Record<string, string>) => ({
  tool: CONNECTOR.update,
  input: { page_id: normaliseId(page), command: 'update_properties', allow_async: false, properties },
});

export function planProps(st: ResolveState, s: Snapshot): void {
  if (st.props.length) return;
  for (const it of st.items) {
    // A project item's per-feature children have no status of their own: the row's is the parent's to write.
    if (it.parent || it.propsDone || !it.final || it.final === 'requeued') continue;
    const fields: Record<string, string> = { Status: it.final };
    if (s.hasWhyFlagged !== false) fields['Why flagged'] = it.final === 'Flagged' ? (it.objection ?? '') : '';
    // Round one's proposal is appended to Why asked — appended, never replacing what the row already carries (R3.1).
    if (it.whyAskedAppend) {
      const row = s.questions.find((q) => q.id === it.rowId);
      fields['Why asked'] = `${(row?.whyAsked ?? '').replace(/\s+$/, '')}\n\n${it.whyAskedAppend}`;
    }
    st.props.push({ rowId: it.rowId, fields, plannedAt: '', stage: 'write' });
  }
}

export function advanceProps(st: ResolveState, env: Env, s: Snapshot): Owed {
  const owed: Owed = { tasks: [], calls: [], waiting: [] };
  const calls: ToolCall[] = env.transcripts ? readAllToolCalls(env.transcripts) : [];
  for (const p of st.props) {
    if (p.stage === 'done') continue;
    if (!p.plannedAt) p.plannedAt = now(env);
    if (env.targetKind === 'local') {
      const q = s.questions.find((x) => x.id === p.rowId);
      const r =
        q?.key && env.docDir
          ? setLocalQuestionFields(join(env.docDir, 'questions.md'), q.key, p.fields)
          : { ok: false as const, reason: 'no local question section' };
      p.stage = 'done';
      p.ok = r.ok;
      if (!r.ok) p.reason = r.reason;
      continue;
    }
    if (p.stage === 'write') {
      const call = updateProps(p.rowId, p.fields);
      const c = latestCall(
        calls,
        call.tool,
        (input) => canonicalJson(input) === canonicalJson(call.input),
        p.plannedAt,
      );
      if (!c?.result) {
        owed.calls.push(call);
        continue;
      }
      if (c.result.isError) {
        p.stage = 'done';
        p.ok = false;
        p.reason = c.result.text.slice(0, 160);
        continue;
      }
      p.stage = 'readback';
      p.plannedAt = now(env);
    }
    if (p.stage === 'readback') {
      const call = fetchCall(p.rowId);
      const c = latestCall(
        calls,
        call.tool,
        (input) =>
          typeof input === 'object' &&
          input !== null &&
          'id' in input &&
          typeof input.id === 'string' &&
          normaliseId(input.id) === normaliseId(p.rowId),
        p.plannedAt,
      );
      if (!c?.result) {
        owed.calls.push(call);
        continue;
      }
      const page = parseFetch(c.result.text);
      const got = page?.properties ?? {};
      const bad = Object.entries(p.fields).filter(([k, v]) => clean(richText(got[k] ?? '')) !== clean(v));
      p.stage = 'done';
      p.ok = bad.length === 0;
      if (bad.length) p.reason = `did not read back: ${bad.map(([k]) => k).join(', ')}`;
    }
  }
  for (const it of st.items) if (st.props.some((p) => p.rowId === it.rowId && p.stage === 'done')) it.propsDone = true;
  return owed;
}

// ---- the v34 migration: the run performs it (SKILL.md register; resolve.md R1) ------------------------------------------

export function migrationCall(questionsDs: string) {
  return {
    tool: 'notion-update-data-source',
    input: {
      data_source_id: questionsDs.replace(/^collection:\/\//, ''),
      statements: 'ADD COLUMN "Why flagged" RICH_TEXT',
    },
  };
}

// ---- closing a sitting -------------------------------------------------------------------------------------------------

export interface CloseLines {
  log: { kind: string; text: string }[];
  runs: { kind: string; text: string }[];
}

export function closeLines(st: ResolveState, s: Snapshot): CloseLines {
  // Rows, not writes: a project item's per-feature children are counted through their parent.
  const mine = st.items.filter((i) => i.final && !i.parent);
  const applied = mine.filter((i) => i.final === 'Applied');
  const flagged = mine.filter((i) => i.final === 'Flagged');
  const log: CloseLines['log'] = [];
  for (const i of flagged)
    log.push({ kind: 'FLAGGED', text: `«${short(i.question)}» \`${i.rowId}\` · ${i.objection ?? ''}` });
  const removed = st.items
    .filter((i) => i.final === 'Applied')
    .flatMap((i) => (i.markersRemoved ?? []).map(() => `\`${i.rowId}\``));
  log.push({
    kind: 'MARKERS',
    text: `${removed.length} removed${removed.length ? `, rows ${[...new Set(removed)].join(', ')} cited` : ''}`,
  });
  // The reconciliation gate (R5): every row this sitting moved to Applied carries its delta or its quote.
  const carried = (i: ItemState): boolean =>
    /^no change/.test(i.verdict ?? '') ||
    (i.after !== undefined &&
      (st.bodies[i.kind === 'overview-write' ? OVERVIEW_KEY : (i.feature ?? '')] ?? '').includes(
        i.after.split('\n').slice(1).join('\n').trim(),
      ));
  const returned = applied.filter((i) =>
    i.kind === 'project'
      ? st.items.some((c) => c.parent === i.rowId && c.final === 'Applied' && !carried(c))
      : !carried(i),
  );
  for (const r of returned) {
    delete r.final;
    r.note = 'returned by the reconciliation gate — the document does not carry its delta';
  }
  const miss = flagged.length + returned.length;
  log.push({
    kind: 'GATE',
    text: `${applied.length - returned.length} applied, ${returned.length} returned${mine.length >= 5 && miss * 2 > mine.length ? ` · miss rate ${miss} of ${mine.length}` : ''}`,
  });
  st.missRates.push({ sitting: st.sitting, items: mine.length, missed: miss });
  // COUNTS: the statuses as they stand now — the snapshot's, with this sitting's own moves applied (rule 7).
  const status = new Map(s.questions.map((q) => [q.id, q.status ?? q.statusRaw]));
  for (const i of mine) if (i.final && i.final !== 'requeued' && i.propsDone) status.set(i.rowId, i.final);
  const tally = new Map<string, number>();
  for (const v of status.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
  const markers = s.features.reduce(
    (n, f) =>
      n +
      (st.bodies[f.id] !== undefined
        ? makeFeature({ ...f, content: st.bodies[f.id] ?? f.content }).body.markers.length
        : f.body.markers.length),
    0,
  );
  const parts = ['Open', 'Answered', 'Applied', 'Flagged', 'Rejected', 'Closed (not applied)']
    .map((k) => `${k} ${tally.get(k) ?? 0}`)
    .join(' · ');
  log.push({
    kind: 'COUNTS',
    text: `question rows ${status.size} = ${parts}; markers ${markers} = features ${markers}`,
  });
  return { log, runs: [] };
}

/** R5's item line: row · verdict · the feature and the requirements the delta touched · the body's hash, feature named nearest it. */
export function itemLine(i: ItemState, featureName?: string): string {
  const where = [featureName ? `«${featureName}»` : '', i.touched?.length ? i.touched.join(', ') : '']
    .filter(Boolean)
    .join(' ');
  return `«${short(i.question)}» \`${i.rowId}\` · ${i.verdict ?? i.final ?? ''}${where ? ` · ${where}` : ''}${i.bodyHash ? ` · body ${i.bodyHash}` : ''}${i.objection && i.final === 'Flagged' ? ` · ${i.objection.slice(0, 160)}` : ''}`;
}

export const hashOf = (content: string): string => {
  const h = hashBody(content);
  return h ? sha12(h) : 'none';
};
