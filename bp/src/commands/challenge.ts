import { join, resolve } from 'node:path';
import { bool, flag, type Args } from '../core/args.ts';
import { localDate, localTime } from '../core/clock.ts';
import { EXIT, halt, usage, type ExitCode } from '../core/errors.ts';
import { listDir, readTextIfExists } from '../core/fsx.ts';
import type { Ctx } from '../context.ts';
import { redact } from '../checks/content.ts';
import { openEntry, recordPaths, RUN_ID } from '../log/entry.ts';
import { formatHashesRollup, itemHashes } from '../log/lines.ts';
import { parseLog } from '../log/parse.ts';
import { preflight, skillVersion } from '../preflight.ts';
import { sessionTranscripts } from '../tasks/tasks.ts';
import { readAllToolCalls } from '../target/transcript.ts';
import { humanWords } from '../engine/human.ts';
import { barredTerms, logLine, printOwed } from '../engine/io.ts';
import { pagesOf, readBlueprint } from '../engine/read.ts';
import {
  emptyOwed,
  loadRunState,
  newRunState,
  runStatePath,
  saveRunState,
  taskModels,
  unfinishedRunsOf,
  type RunState,
} from '../engine/state.ts';
import type { Pages } from '../engine/writes.ts';
import { newQState, stepChallenge, type QState } from '../challenge/run.ts';
import { actWrites, parseAct, resolveAct } from '../challenge/q1.ts';

// `bp challenge` — challenge.md end to end, standalone. Q1 executes a batch act a human names to this run (`--act "<their
// words>"`, and for a batch another run printed, the spot-check: `--sample-answer "<their words>"`); Q2–Q6 are the shared
// machine `add` and `init` embed. Run it, do what it prints, run it again.

const COMMAND = 'challenge';

interface QData {
  q: QState;
  pages?: Pages;
  act?: {
    words: string;
    sample?: { run: string; lines: { n: number; text: string }[] };
    sampleAnswer?: string;
    logged?: boolean;
  };
}

export function challengeCommand(ctx: Ctx, args: Args): ExitCode {
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
  const requested = flag(args, 'run');
  if (requested !== undefined && !RUN_ID.test(requested)) throw usage(`"${requested}" is not a run id`);
  const open = unfinishedRunsOf(first.current, 'challenge');
  if (!requested && open.length > 1)
    throw usage(`several unfinished challenge runs: ${open.join(', ')} — name one with --run`);
  const runId = requested ?? open[0];
  const p = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'challenge',
    clock: ctx.clock,
    ...(runId ? { runId } : {}),
    ...(named ? { named } : {}),
  });
  if (p.halts.length) throw halt(p.halts.join('\n'));
  if (!p.target) throw halt('Where does this Blueprint live? No target.md was found.');
  if (p.current !== p.home)
    throw halt(`the working folder is at its pre-v33 location ${p.current} — move it first (targets §5 rename route)`);
  const home = p.current;
  const nowIso = ctx.clock.now().toISOString();
  const date = localDate(ctx.clock.now());
  let loaded = runId ? loadRunState(runStatePath(home, runId)) : undefined;
  if (!loaded) {
    const id = ((): string => {
      for (let i = 0; i < 100; i++) {
        const c = ctx.rand.hex(3);
        if (!listDir(join(home, 'sources')).includes(c)) return c;
      }
      throw usage('could not draw an unused run id');
    })();
    loaded = newRunState({
      command: 'challenge',
      runId: id,
      nowIso,
      noSecondDispatch: bool(args, 'no-second-dispatch'),
    });
    const words = flag(args, 'act');
    // Q1 executes a person's act only in their own words, found in a message they sent (DESIGN.md §8).
    const actReceipt = words
      ? humanWords(sessionTranscripts(ctx.env, flag(args, 'transcript')), words, 'the act')
      : null;
    loaded.data = {
      q: newQState(bool(args, 'full') ? 'full' : 'delta'),
      ...(words ? { act: { words } } : {}),
    } satisfies QData;
    openEntry(
      recordPaths(home),
      {
        date,
        time: localTime(ctx.clock.now()),
        command: 'challenge',
        runId: id,
        version: skillVersion(ctx.skillRoot),
        sitting: 1,
        extra: bool(args, 'full') ? 'scale full (asked for by name)' : 'scale delta',
      },
      workspace.split('/').pop() ?? 'Blueprint',
    );
    loaded.entryOpen = true;
    loaded.stage = 'run';
    if (actReceipt) logLine(home, COMMAND, id, 'NOTE', actReceipt);
  }
  const st: RunState = loaded;
  const path = runStatePath(home, st.runId);
  const d = st.data as unknown as QData;
  const sampleAnswer = flag(args, 'sample-answer');
  if (sampleAnswer && d.act) {
    const receipt = humanWords(
      sessionTranscripts(ctx.env, flag(args, 'transcript')),
      sampleAnswer,
      'the spot-check answer',
    );
    d.act.sampleAnswer = sampleAnswer;
    logLine(home, COMMAND, st.runId, 'NOTE', receipt);
  }
  const barred = barredTerms(home);
  const transcripts = sessionTranscripts(ctx.env, flag(args, 'transcript'));
  const target = { kind: p.target.kind, address: p.target.address };
  const log = (kind: string, text: string): void => logLine(home, COMMAND, st.runId, kind, text);
  const logText = (): string => readTextIfExists(recordPaths(home).log) ?? '';

  for (let guard = 0; guard < 8; guard++) {
    saveRunState(path, st);
    if (st.stage === 'done') {
      ctx.out(
        bool(args, 'json')
          ? JSON.stringify({ status: 'done', run: st.runId, report: st.report }, null, 2)
          : st.report.join('\n'),
      );
      return EXIT.ok;
    }
    const read = readBlueprint(ctx, args, home, st, target);
    if ('owed' in read) {
      printOwed(ctx, args, {
        owed: read.owed,
        command: 'challenge',
        header: `BLUEPRINT challenge · run ${st.runId} · reading the Blueprint`,
        stage: st.stage,
        run: st.runId,
      });
      return EXIT.waiting;
    }
    const s = read.snapshot;
    if (s.legacyBoard)
      throw halt(
        'a Board database sits beneath the overview — the superseded skill built this Blueprint (pre-flight 5)',
      );
    if (s.incomplete.length) throw halt(`the read is incomplete:\n  ${s.incomplete.join('\n  ')}`);
    d.pages ??= pagesOf(s, target.kind === 'local' ? target.address : undefined);

    // Q1: a batch act named to this run is executed here, and nowhere else.
    let acts: ReturnType<typeof actWrites> = [];
    if (d.act && !d.act.logged) {
      const plan = resolveAct({
        acts: parseAct(d.act.words),
        log: parseLog(logText()),
        home,
        thisRun: st.runId,
        rand: ctx.rand,
        sampled: d.act.sampleAnswer !== undefined,
      });
      if (plan.sample && d.act.sampleAnswer === undefined) {
        d.act.sample = { run: plan.sample.run, lines: plan.sample.lines };
        saveRunState(path, st);
        const ask = [
          `BLUEPRINT challenge · run ${st.runId} · Q1 — a spot-check before a ratification named to a later run`,
          `Hand the human these ${plan.sample.lines.length} lines of ${plan.sample.kind} ${plan.sample.run}, at random, and ask whether each is right:`,
          ...plan.sample.lines.map((l) => `  #${l.n}  ${redact(l.text, barred).slice(0, 240)}`),
          '',
          'Then run `bp challenge --sample-answer "<their words, verbatim>"`.',
        ];
        ctx.out(
          bool(args, 'json') ? JSON.stringify({ status: 'waiting', run: st.runId, ask }, null, 2) : ask.join('\n'),
        );
        return EXIT.waiting;
      }
      for (const u of plan.unmatched) st.notes.push(`not executed: ${u}`);
      acts = actWrites(plan, s, date);
      for (const kindRun of new Set(plan.lines.map((l) => `${l.act}|${l.kind}|${l.run}`))) {
        const [act = 'RATIFIED', kind = '', run = ''] = kindRun.split('|');
        const lines = plan.lines.filter((l) => l.act === act && l.kind === kind && l.run === run);
        log(
          act,
          `${kind === 'defaults' ? 'defaults ledger' : kind === 'fixes' ? 'fixes batch' : 'content manifest'} ${run}, ${lines.map((l) => `#${l.n}${l.screen !== undefined ? ` (screen #${l.screen}: "${redact(l.shownText ?? l.text, barred).slice(0, 80)}")` : ''}`).join(', ')} · "${d.act.words}"${d.act.sampleAnswer !== undefined ? ` · spot-check ${d.act.sample?.lines.map((x) => `#${x.n}`).join(', ') ?? ''} → "${d.act.sampleAnswer}"` : ''}`,
        );
      }
      d.act.logged = true;
    }

    const owed = emptyOwed();
    const outcome = stepChallenge(d.q, {
      st,
      task: { home, skillRoot: ctx.skillRoot, nowIso, transcripts },
      owed,
      s,
      read,
      pages: d.pages,
      targetKind: target.kind,
      ...(target.kind === 'local' ? { docDir: target.address } : {}),
      calls: transcripts ? readAllToolCalls(transcripts) : [],
      log,
      logText,
      parsedLog: () => parseLog(logText()),
      barred,
      date,
      nowIso,
      home,
      ...(acts.length ? { actWrites: acts } : {}),
    });
    if (outcome === 'owed') {
      saveRunState(path, st);
      printOwed(ctx, args, {
        owed,
        command: 'challenge',
        header: `BLUEPRINT challenge · run ${st.runId} · ${d.q.stage}`,
        stage: d.q.stage,
        run: st.runId,
        preface: d.q.report.splice(0),
      });
      saveRunState(path, st);
      return EXIT.waiting;
    }
    // Close: the lines a standalone challenge entry owes after the machine's own.
    const models = taskModels(st);
    log(
      'independence',
      models.size
        ? [...models].map(([k, m]) => `${k} ${m.join(', ')}`).join(' · ') +
            ' · each answer collected from its own subagent transcript'
        : st.noSecondDispatch
          ? 'could not be performed — no second dispatch available'
          : 'nothing was dispatched',
    );
    const entry = parseLog(logText()).entries.find((e) => e.heading.runId === st.runId);
    if (entry && itemHashes(entry).size) log('HASHES', formatHashesRollup(entry));
    logLine(
      home,
      COMMAND,
      st.runId,
      'COST',
      `dispatches ${st.dispatches} · wall-clock from ${st.sittingStartedAt} to ${ctx.clock.now().toISOString()} (self-reported, not recountable)`,
    );
    const waiting =
      (d.q.plan?.questions.length ?? 0) +
        (d.q.plan?.defaults.length ?? 0) +
        (d.q.plan?.fixes.length ?? 0) +
        (d.q.plan?.slots.length ?? 0) >
      0;
    log(
      'closing',
      `CLOSED ${localTime(ctx.clock.now())} · ${waiting ? 'HUMAN-BLOCKED' : 'DRAINED'} · run totals: ${d.q.plan?.funnel.drafted ?? 0} drafted · ${d.q.plan?.questions.length ?? 0} written · 1 sitting`,
    );
    st.report = [
      `QUESTIONS — ${workspace.split('/').pop() ?? ''} · ${date}`,
      '',
      ...d.q.report.splice(0),
      ...st.notes.map((n) => `NOTE  ${n}`),
    ];
    st.stage = 'done';
  }
  throw halt('bp challenge did not settle in one invocation — run it again');
}
