import { randomBytes } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { bool, flag, type Args } from '../core/args.ts';
import { localDate, localTime } from '../core/clock.ts';
import { EXIT, halt, usage, type ExitCode } from '../core/errors.ts';
import { listDir, readTextIfExists } from '../core/fsx.ts';
import type { Ctx } from '../context.ts';
import {
  admitToken,
  appendLine,
  appendRunsLine,
  formatLine,
  openEntry,
  recordPaths,
  routeOf,
  RUN_ID,
} from '../log/entry.ts';
import { formatHashesRollup } from '../log/lines.ts';
import { parseLog } from '../log/parse.ts';
import { preflight, skillVersion } from '../preflight.ts';
import {
  advanceProps,
  closeLines,
  itemLine,
  migrationCall,
  planProps,
  planSitting,
  work,
  type Env,
  type Owed,
} from '../resolve/run.ts';
import { loadState, pullPath, saveState, statePath, unfinishedRuns, type ResolveState } from '../runs/resolve-state.ts';
import { sessionTranscripts } from '../tasks/tasks.ts';
import { rebaselineNote, sourceRebaselines, verifySources } from '../sources.ts';
import { humanWords } from '../engine/human.ts';

/** What a run asks a human before re-baselining a stored source on their word (resolve.md R1). */
const TRUST_ASK = 'Reply "trust it" and I\'ll record your confirmation and treat the file as it is now as correct';
import { readLocal } from '../target/local.ts';
import { loadPull, newPull, savePull, stepPull, toSnapshot } from '../target/relay.ts';
import { canonicalJson, latestCall, readAllToolCalls } from '../target/transcript.ts';
import type { Snapshot } from '../snapshot.ts';

// `bp resolve` — resolve.md end to end. Each invocation advances the run as far as it can and then either prints what is
// owed (model tasks to dispatch, connector calls to make — exit 4) or the run's report (exit 0). The loop the orchestrator
// runs is: `bp resolve` → do what it says → `bp resolve` again.

const COMMAND = 'resolve' as const;

function barredTerms(current: string): string[] {
  const out: string[] = [];
  for (const run of listDir(join(current, 'sources'))) {
    const raw = readTextIfExists(join(current, 'sources', run, 'barred-terms.json'));
    if (!raw) continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
    } catch {
      // unreadable: the sweep still runs its other classes
    }
  }
  return out;
}

function log(
  current: string,
  runId: string,
  kind: string,
  text: string,
  opts: { reconciliation?: boolean } = {},
): void {
  const paths = recordPaths(current);
  const k = admitToken(kind, COMMAND, { computed: true });
  const line = formatLine(kind, text);
  if (routeOf(k, { versionReconciliation: opts.reconciliation === true }) === 'runs')
    appendRunsLine(paths, runId, `resolve · run ${runId}`, line);
  else appendLine(paths, runId, line);
}

function snapshotFor(
  ctx: Ctx,
  args: Args,
  current: string,
  st: ResolveState,
  target: { kind: 'notion' | 'local'; address: string },
): Snapshot | { owed: Owed } {
  if (target.kind === 'local') return readLocal(target.address, ctx.clock.now().toISOString());
  const path = pullPath(current, st.runId, st.sitting);
  let pull = loadPull(path);
  if (!pull) {
    pull = newPull(target.address, st.sittingStartedAt);
    savePull(path, pull);
  }
  if (pull.stage !== 'done' || pull.pending.length) {
    const t = sessionTranscripts(ctx.env, flag(args, 'transcript'));
    if (!t)
      throw usage(
        'the relay needs the session transcript to read Notion results, and none was found',
        'run inside Claude Code, or pass --transcript <path>',
      );
    stepPull(pull, t);
    savePull(path, pull);
    if (pull.stage !== 'done' || pull.pending.length)
      return { owed: { tasks: [], calls: pull.pending.map((p) => ({ tool: p.tool, input: p.input })), waiting: [] } };
  }
  return toSnapshot(pull, st.sittingStartedAt);
}

function printOwed(ctx: Ctx, args: Args, owed: Owed, st: ResolveState): void {
  if (bool(args, 'json')) {
    ctx.out(
      JSON.stringify(
        {
          status: 'waiting',
          run: st.runId,
          sitting: st.sitting,
          stage: st.stage,
          tasks: owed.tasks.map((t) => ({ id: t.id, kind: t.kind, prompt: t.prompt })),
          calls: owed.calls,
          waiting: owed.waiting,
        },
        null,
        2,
      ),
    );
    return;
  }
  const out: string[] = [
    `BLUEPRINT resolve · run ${st.runId} · sitting ${st.sitting} · mode: ${st.mode} · ${st.stage}`,
  ];
  if (owed.calls.length) {
    out.push(
      '',
      `CALLS — make these ${owed.calls.length} Notion connector call(s), at most 3 in flight, each input exactly as written:`,
    );
    owed.calls.forEach((c, i) => out.push(`  ${i + 1}. ${c.tool}  ${JSON.stringify(c.input)}`));
  }
  if (owed.tasks.length) {
    out.push(
      '',
      `DISPATCH — ${owed.tasks.length} task(s). Give each prompt, verbatim, to its own subagent (the Agent tool), in parallel; a checker on a different model from its writer where you can (SKILL.md rule 6). Do not answer them yourself.`,
    );
    for (const t of owed.tasks) out.push('', `--- task ${t.id} (${t.kind}) ---`, t.prompt);
  }
  if (owed.waiting.length)
    out.push('', `WAITING on ${owed.waiting.length} dispatched task(s): ${owed.waiting.join(' · ')}`);
  out.push('', 'Then run `bp resolve` again.');
  ctx.out(out.join('\n'));
}

function report(st: ResolveState): string {
  // One line per row: a project item's per-feature writes are reported under their row.
  const rows = st.items.filter((i) => !i.parent);
  const applied = rows.filter((i) => i.final === 'Applied');
  const flagged = rows.filter((i) => i.final === 'Flagged');
  const requeued = rows.filter((i) => i.final === 'requeued');
  const unverified = applied.filter((i) => i.verdict === 'Unverified').length;
  const out = [
    `BLUEPRINT RESOLVE · run ${st.runId} · mode: ${st.mode} · ${st.sitting} sitting${st.sitting > 1 ? 's' : ''}`,
  ];
  if (unverified) out.push(`${unverified} item(s) written unverified — no second dispatch was available.`);
  if (flagged.length) {
    out.push('', `NEEDS YOU (${flagged.length}) — every one of these is Flagged; nothing is waiting silently`);
    for (const f of flagged) {
      out.push(`  «${f.question}»`, `      ${f.objection ?? ''}`);
      // R4: an overview proposal is printed verbatim, pinned by its hash, for a person to accept.
      if (f.proposal)
        out.push(
          `      proposed block text (pin ${f.proposal.pin}):`,
          ...f.proposal.text.split('\n').map((l) => `        ${l}`),
        );
    }
  }
  if (applied.length) {
    out.push('', `APPLIED (${applied.length})`);
    for (const a of applied)
      out.push(
        `  «${a.question}» — ${a.verdict ?? ''}${a.touched?.length ? ` · ${a.touched.join(', ')}` : ''}${a.note ? ` · ${a.note}` : ''}`,
      );
  }
  if (requeued.length) {
    out.push('', `RE-QUEUED (${requeued.length}) — left at Answered`);
    for (const r of requeued) out.push(`  «${r.question}» — ${r.note ?? ''}`);
  }
  if (st.notes.length) out.push('', 'NOTES', ...st.notes.map((n) => `  ${n}`));
  if (!applied.length && !flagged.length && !requeued.length) out.push('', 'The queue was empty — nothing to apply.');
  return out.join('\n');
}

export function resolveCommand(ctx: Ctx, args: Args): ExitCode {
  const ws = flag(args, 'workspace');
  const workspace = ws ? resolve(ctx.workspace, ws) : ctx.workspace;
  const named = flag(args, 'home');
  const first = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'status',
    clock: ctx.clock,
    ...(named ? { named } : {}),
  });
  const current = first.current;
  const requested = flag(args, 'run');
  if (requested !== undefined && !RUN_ID.test(requested)) throw usage(`"${requested}" is not a run id`);
  const open = unfinishedRuns(current);
  if (!requested && open.length > 1)
    throw usage(`several unfinished resolve runs: ${open.join(', ')} — name one with --run`);
  const runId = requested ?? open[0];
  const p = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'resolve',
    clock: ctx.clock,
    ...(runId ? { runId } : {}),
    ...(named ? { named } : {}),
  });
  if (p.halts.length) throw halt(p.halts.join('\n'));
  if (!p.target) throw halt('Where does this Blueprint live? No target.md was found (pre-flight 1).');
  if (p.current !== p.home)
    throw halt(
      `the working folder is at its pre-v33 location ${p.current} — move it first (targets §5 rename route); bp does not write into the old location`,
    );

  const nowIso = ctx.clock.now().toISOString();
  let st = runId ? loadState(statePath(current, runId)) : undefined;
  if (!st) {
    const id =
      runId ??
      ((): string => {
        for (let i = 0; i < 100; i++) {
          const c = ctx.rand.hex(3);
          if (!listDir(join(current, 'sources')).includes(c)) return c;
        }
        throw usage('could not draw an unused run id');
      })();
    st = {
      version: 1,
      runId: id,
      mode: bool(args, 'soft') ? 'soft' : 'force',
      sitting: 1,
      stage: 'pull',
      startedAt: nowIso,
      sittingStartedAt: nowIso,
      noSecondDispatch: bool(args, 'no-second-dispatch'),
      disposed: [],
      items: [],
      props: [],
      bodies: {},
      rebaselines: [],
      notes: [],
      missRates: [],
      report: [],
      dispatches: 0,
      salt: randomBytes(16).toString('hex'),
    };
  }
  const path = statePath(current, st.runId);
  const target = { kind: p.target.kind, address: p.target.address };
  const logText = readTextIfExists(recordPaths(current).log);
  const env: Env = {
    home: current,
    skillRoot: ctx.skillRoot,
    clock: ctx.clock,
    transcripts: sessionTranscripts(ctx.env, flag(args, 'transcript')),
    targetKind: target.kind,
    ...(target.kind === 'local' ? { docDir: target.address } : {}),
    log: logText === undefined ? null : parseLog(logText),
    barred: barredTerms(current),
  };

  for (let guard = 0; guard < 12; guard++) {
    saveState(path, st);
    if (st.stage === 'done') {
      const text = report(st);
      ctx.out(
        bool(args, 'json')
          ? JSON.stringify({ status: 'done', run: st.runId, items: st.items, notes: st.notes }, null, 2)
          : text,
      );
      return EXIT.ok;
    }
    const snap = snapshotFor(ctx, args, current, st, target);
    if ('owed' in snap) {
      printOwed(ctx, args, snap.owed, st);
      return EXIT.waiting;
    }
    if (snap.legacyBoard)
      throw halt(
        'a Board database sits beneath the overview — the superseded skill built this Blueprint (pre-flight 5)',
      );
    if (snap.incomplete.length) throw halt(`the read is incomplete:\n  ${snap.incomplete.join('\n  ')}`);

    if (st.stage === 'pull') {
      st.stage = 'plan';
      continue;
    }
    if (st.stage === 'plan') {
      const now = ctx.clock.now();
      // R1's capture-integrity check, before anything is written: every stored source against the hash its record states.
      const trusted = flag(args, 'trust-source');
      const words = flag(args, 'trust-words');
      if ((trusted === undefined) !== (words === undefined))
        throw usage(
          "--trust-source and --trust-words go together: the file, and the human's own words vouching for it",
        );
      // A vouch is the human's act: their words, found in a message they sent (DESIGN.md §8).
      const vouch =
        words !== undefined
          ? humanWords(sessionTranscripts(ctx.env, flag(args, 'transcript')), words, 'the vouch')
          : null;
      const integrity = verifySources(current, sourceRebaselines(env.log));
      const mismatches = integrity.filter((f) => f.kind === 'mismatch' && `${f.run}/${f.file}` !== trusted);
      if (mismatches.length) {
        throw halt(
          `the source record was altered after capture — every faithfulness verdict rests on it being what it copied (R1):\n  ${mismatches.map((m) => `sources/${m.run}/${m.file}: recorded ${m.recorded.slice(0, 12)}, now ${m.now?.slice(0, 12) ?? '?'}`).join('\n  ')}`,
          `${TRUST_ASK} — then run bp resolve --trust-source <run>/<file> --trust-words "<their words, verbatim>"`,
        );
      }
      for (const u of integrity.filter((f) => f.kind === 'uncheckable'))
        st.notes.push(`sources/${u.run}: ${u.file} is not on this machine — uncheckable, never a mismatch (R1)`);
      const eligible = snap.questions.filter(
        (q) => q.status === 'Answered' && q.answer.trim() && !st.disposed.includes(q.id),
      ).length;
      openEntry(
        recordPaths(current),
        {
          date: localDate(now),
          time: localTime(now),
          command: COMMAND,
          runId: st.runId,
          version: skillVersion(ctx.skillRoot),
          sitting: st.sitting,
          mode: st.mode,
          extra: `queue ${eligible} eligible`,
        },
        basename(workspace),
      );
      if (p.version.relation === 'older' && !p.version.crossed.length && st.sitting === 1) {
        log(
          current,
          st.runId,
          'check',
          `R1 version — stamped v${String(p.version.stamped)}, VERSION ${p.version.current}: no shape change between them; reconciled`,
          { reconciliation: true },
        );
      }
      const vouched = integrity.find((f) => f.kind === 'mismatch' && `${f.run}/${f.file}` === trusted);
      if (vouched && words !== undefined) {
        log(
          current,
          st.runId,
          'NOTE',
          rebaselineNote({
            date: localDate(now),
            run: vouched.run,
            file: vouched.file,
            ask: TRUST_ASK,
            words,
            hash: vouched.now ?? '',
          }),
        );
        if (vouch) log(current, st.runId, 'NOTE', vouch);
      }
      const { r2Lines } = planSitting(snap, st, env);
      for (const l of r2Lines) log(current, st.runId, 'check', l);
      log(
        current,
        st.runId,
        'independence',
        st.noSecondDispatch
          ? 'independence: could not be performed — no second dispatch available (declared with --no-second-dispatch)'
          : 'writer and checker are separate subagent dispatches; each answer is collected from its own transcript (bp task receipts), models recorded at close',
      );
      st.stage = snap.hasWhyFlagged === false ? 'migrate' : 'work';
      continue;
    }
    if (st.stage === 'migrate') {
      const pull = loadPull(pullPath(current, st.runId, st.sitting));
      const ds = pull?.questionsDs;
      if (!ds) {
        st.notes.push(
          'the Open Questions data source was not found, so the v34 Why flagged property could not be added — the objection lives in the log alone',
        );
        st.stage = 'work';
        continue;
      }
      const call = migrationCall(ds);
      if (!st.migration) st.migration = { plannedAt: ctx.clock.now().toISOString(), stage: 'call' };
      const calls = env.transcripts ? readAllToolCalls(env.transcripts) : [];
      const done = latestCall(
        calls,
        call.tool,
        (input) => canonicalJson(input) === canonicalJson(call.input),
        st.migration.plannedAt,
      );
      if (!done?.result || done.result.isError) {
        // Saved before waiting: the plan's time is what the connector's result must be newer than, on the next invocation.
        saveState(path, st);
        printOwed(ctx, args, { tasks: [], calls: [call], waiting: [] }, st);
        return EXIT.waiting;
      }
      log(
        current,
        st.runId,
        'NOTE',
        "v34 register row crossed: added the Why flagged rich-text property to Open Questions, confirmed by the connector's result; the objection now lives on the row beside its FLAGGED line",
      );
      st.migration.stage = 'done';
      st.stage = 'work';
      continue;
    }
    if (st.stage === 'work') {
      const owed = work(snap, st, env);
      for (const it of st.items) {
        if (it.final && !it.logged) {
          const f = it.feature ? snap.features.find((x) => x.id === it.feature) : undefined;
          log(current, st.runId, 'item', itemLine(it, f?.name));
          it.logged = true;
        }
      }
      if (owed.tasks.length || owed.calls.length || owed.waiting.length) {
        saveState(path, st);
        printOwed(ctx, args, owed, st);
        return EXIT.waiting;
      }
      st.stage = 'props';
      continue;
    }
    if (st.stage === 'props') {
      planProps(st, snap);
      const owed = advanceProps(st, env, snap);
      if (owed.calls.length) {
        saveState(path, st);
        printOwed(ctx, args, owed, st);
        return EXIT.waiting;
      }
      for (const pw of st.props.filter((x) => x.ok === false))
        st.notes.push(
          `the property write on ${pw.rowId} did not land (${pw.reason ?? 'unknown'}) — the next run writes it`,
        );
      st.stage = 'close';
      continue;
    }
    if (st.stage === 'close') {
      const lines = closeLines(st, snap);
      for (const l of lines.log) log(current, st.runId, l.kind, l.text);
      const models = [
        ...new Set(
          st.items
            .flatMap((i) => [
              i.writerReceipt?.model ? `writer ${i.writerReceipt.model}` : '',
              i.checkerReceipt?.model ? `checker ${i.checkerReceipt.model}` : '',
            ])
            .filter(Boolean),
        ),
      ];
      if (models.length)
        log(
          current,
          st.runId,
          'independence',
          `${models.join(', ')} · every answer collected from its own subagent transcript`,
        );
      const entryLog = parseLog(readTextIfExists(recordPaths(current).log) ?? '');
      const entry = entryLog.entries.find((e) => e.heading.runId === st.runId && e.heading.sitting === st.sitting);
      if (entry && entry.lines.some((l) => l.kind === 'item' && /\bbody [0-9a-f]{12}\b/.test(l.text))) {
        const rollup = formatHashesRollup(entry);
        const fresh = st.rebaselines.map((r) => `«${r.feature}» ${r.hash} (computed fresh)`).join(' · ');
        log(current, st.runId, 'HASHES', fresh ? `${rollup} · ${fresh}` : rollup);
      } else if (st.rebaselines.length) {
        log(
          current,
          st.runId,
          'HASHES',
          st.rebaselines.map((r) => `«${r.feature}» ${r.hash} (computed fresh)`).join(' · '),
        );
      }
      const swept = st.items.filter((i) => i.final).length;
      log(
        current,
        st.runId,
        'SWEEP-NOTE',
        `content rule swept this sitting's ${swept} item(s), their deltas and objections, and every line of this entry · 0 findings written (a delta carrying one was refused)`,
      );
      log(
        current,
        st.runId,
        'COST',
        `dispatches ${st.dispatches} · wall-clock from ${st.sittingStartedAt} to ${ctx.clock.now().toISOString()} (self-reported, not recountable)`,
      );
      const disposed = new Set([...st.disposed, ...st.items.filter((i) => i.final).map((i) => i.rowId)]);
      const remaining = snap.questions.filter(
        (q) => q.status === 'Answered' && q.answer.trim() && !disposed.has(q.id),
      ).length;
      const inThisSitting = st.items.filter((i) => i.final).length;
      const now = localTime(ctx.clock.now());
      if (remaining > 0 && inThisSitting > 0) {
        log(
          current,
          st.runId,
          'closing',
          `PAUSED ${now} · sitting ${st.sitting} of a continuing run, ${remaining} rows still queued`,
        );
        st.disposed = [...disposed];
        st.items = [];
        st.props = [];
        st.sitting += 1;
        st.sittingStartedAt = ctx.clock.now().toISOString();
        st.stage = 'pull';
        continue;
      }
      const flagged = st.items.some((i) => i.final === 'Flagged');
      const degraded =
        st.missRates.length >= 2 && st.missRates.slice(-2).every((m) => m.items >= 5 && m.missed * 2 > m.items);
      const reason = degraded ? 'DEGRADED' : flagged || remaining > 0 ? 'HUMAN-BLOCKED' : 'DRAINED';
      const applied = st.items.filter((i) => i.final === 'Applied').length;
      log(
        current,
        st.runId,
        'closing',
        `CLOSED ${now} · ${reason} · run totals: ${applied} applied · ${st.items.filter((i) => i.final === 'Flagged').length} flagged · ${st.sitting} sitting${st.sitting > 1 ? 's' : ''}`,
      );
      st.stage = 'done';
      continue;
    }
  }
  saveState(path, st);
  throw halt('the resolve loop made no progress in twelve steps — this is a bp defect; the run state is saved');
}
