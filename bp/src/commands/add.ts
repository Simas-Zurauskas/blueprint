import { join, resolve } from 'node:path';
import { bool, flag, flagAll, type Args } from '../core/args.ts';
import { localDate, localTime } from '../core/clock.ts';
import { EXIT, halt, usage, type ExitCode } from '../core/errors.ts';
import { listDir, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { findMarkers } from '../core/text.ts';
import type { Ctx } from '../context.ts';
import { redact, scan } from '../checks/content.ts';
import {
  FaithSchema,
  faithBrief,
  faithProblems,
  narrowingLine,
  verdictLines,
  type Faith,
  type WrittenItem,
} from '../checks/faithfulness.ts';
import { openEntry, recordPaths, RUN_ID } from '../log/entry.ts';
import { formatHashesRollup, itemHashes } from '../log/lines.ts';
import { parseLog } from '../log/parse.ts';
import { preflight, skillVersion } from '../preflight.ts';
import { renderProgress } from '../progress.ts';
import { captureSources, readManifest, REPO_ASK, type Captured, type SourceInput } from '../sources.ts';
import { makeFeature } from '../snapshot.ts';
import { sessionTranscripts } from '../tasks/tasks.ts';
import { readAllToolCalls } from '../target/transcript.ts';
import { AddDraftSchema, draftBrief, draftProblems, sourceTexts, type AddDraft } from '../add/draft.ts';
import { deltaProblems, markerText, planAdd, prepareAdd, type Con, type Mode } from '../add/plan.ts';
import { barredTerms, logLine, printOwed } from '../engine/io.ts';
import { pagesOf, readBlueprint } from '../engine/read.ts';
import {
  emptyOwed,
  loadRunState,
  need,
  newRunState,
  runStatePath,
  saveRunState,
  taskModels,
  unfinishedRunsOf,
  type Owed,
  type RunState,
} from '../engine/state.ts';
import { runWrites, type BlockWrite, type Pages, type Prepared, type Write } from '../engine/writes.ts';
import { newQState, stepChallenge, type QState } from '../challenge/run.ts';

// `bp add` — add.md end to end. A1 captures the new material verbatim and hashes it; A2 is one drafting task; A3 prints
// the delta and does not wait; A4 writes it one named block at a time through the serial commit path; A5 is the
// faithfulness check, the content sweep and the close. Run it, do what it prints, run it again.

const COMMAND = 'add';

interface AddData {
  captured: Captured[];
  draft?: AddDraft;
  plan?: { cons: Con[]; statement: string[]; reportedFirst: string[]; refused: string[]; dropped: string[] };
  pages?: Pages;
  written?: WrittenItem[];
  verdicts?: Faith;
  fixes?: number;
  markersMinted?: number;
  markersRemoved?: string[];
  printedStatement?: boolean;
  /** The embedded challenge run (A5's handoff). */
  q?: QState;
}

const dataOf = (st: RunState): AddData => st.data as unknown as AddData;

function modeOf(args: Args): { mode: Mode; word?: string } {
  const word = flag(args, 'mode');
  if (bool(args, 'soft')) return { mode: 'soft' };
  if (bool(args, 'force') || word === undefined || word === 'force') return { mode: 'force' };
  if (word === 'soft') return { mode: 'soft' };
  // add.md: an unrecognised modifier runs soft — the safe mode — and the header says the word it did not recognise.
  return { mode: 'soft', word };
}

export function addCommand(ctx: Ctx, args: Args): ExitCode {
  const ws = flag(args, 'workspace');
  const workspace = ws ? resolve(ctx.workspace, ws) : ctx.workspace;
  const named = flag(args, 'home');
  // The run's own open entry is not a concurrent run: find the run first, then take pre-flight's verdict with its id.
  const first = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'status',
    clock: ctx.clock,
    ...(named ? { named } : {}),
  });
  const requested = flag(args, 'run');
  if (requested !== undefined && !RUN_ID.test(requested)) throw usage(`"${requested}" is not a run id`);
  const open = unfinishedRunsOf(first.current, 'add');
  if (!requested && open.length > 1)
    throw usage(`several unfinished add runs: ${open.join(', ')} — name one with --run`);
  const runId = requested ?? open[0];
  const p = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'add',
    clock: ctx.clock,
    ...(runId ? { runId } : {}),
    ...(named ? { named } : {}),
  });
  if (p.halts.length) throw halt(p.halts.join('\n'));
  if (!p.target)
    throw halt(
      'Where does this Blueprint live? No target.md was found — a new Blueprint is /blueprint init (add.md edge cases).',
    );
  if (p.current !== p.home)
    throw halt(`the working folder is at its pre-v33 location ${p.current} — move it first (targets §5 rename route)`);
  const home = p.current;
  const nowIso = ctx.clock.now().toISOString();
  const date = localDate(ctx.clock.now());

  const inputs: SourceInput[] = [
    ...flagAll(args, 'source').map((path) => ({ path: resolve(workspace, path) })),
    ...flagAll(args, 'text').map((path, i) => ({
      text: readTextIfExists(resolve(workspace, path)) ?? '',
      name: flagAll(args, 'text-name')[i] ?? `given-in-conversation-${i + 1}.md`,
      origin: `given in conversation, ${date}`,
    })),
  ];
  let loaded = runId ? loadRunState(runStatePath(home, runId)) : undefined;
  if (loaded && inputs.length)
    throw usage(
      `run ${loaded.runId} is still open — sources are given to a new add, never appended to a running one's record (A1)`,
    );
  if (!loaded) {
    if (!inputs.length)
      throw usage(
        'add takes new material: --source <file or folder> and/or --text <file holding what was said in conversation>',
        REPO_ASK,
      );
    const m = modeOf(args);
    const id = ((): string => {
      for (let i = 0; i < 100; i++) {
        const c = ctx.rand.hex(3);
        if (!listDir(join(home, 'sources')).includes(c)) return c;
      }
      throw usage('could not draw an unused run id');
    })();
    loaded = newRunState({
      command: 'add',
      runId: id,
      nowIso,
      mode: m.mode,
      ...(m.word ? { modeWord: m.word } : {}),
      noSecondDispatch: bool(args, 'no-second-dispatch'),
    });
    // A1: capture before interpreting — the source record is written first, then the entry opens.
    const captured = captureSources({ home, runId: id, command: 'add', date, inputs });
    loaded.data = { captured } satisfies AddData;
    openEntry(
      recordPaths(home),
      {
        date,
        time: localTime(ctx.clock.now()),
        command: 'add',
        runId: id,
        version: skillVersion(ctx.skillRoot),
        sitting: 1,
        mode: m.mode,
        extra: `${captured.length} source${captured.length === 1 ? '' : 's'}${m.word ? ` · "${m.word}" is not a modifier` : ''}`,
      },
      workspace.split('/').pop() ?? 'Blueprint',
    );
    loaded.entryOpen = true;
    loaded.stage = 'read';
  }
  const st: RunState = loaded;
  const path = runStatePath(home, st.runId);
  const mode: Mode = st.mode ?? 'force';
  const log = (kind: string, text: string): void => logLine(home, COMMAND, st.runId, kind, text);
  const d = dataOf(st);
  const barred = barredTerms(home);
  const transcripts = sessionTranscripts(ctx.env, flag(args, 'transcript'));
  const target = { kind: p.target.kind, address: p.target.address };
  const phases = (now: string): string =>
    renderProgress({
      command: 'add',
      runId: st.runId,
      sitting: st.sitting,
      mode,
      ...(st.modeWord ? { unknownModifier: st.modeWord.replace(/"/g, '') } : {}),
      phases: [
        { id: 'A1', label: 'collect', state: stageIndex(now) > 0 ? 'done' : 'now' },
        { id: 'A2', label: 'draft the delta', state: stateOf(now, 1) },
        { id: 'A3', label: 'state the delta', state: stateOf(now, 2) },
        { id: 'A4', label: 'write', state: stateOf(now, 3) },
        { id: 'A5', label: 'check, challenge, finish', state: stateOf(now, 4) },
      ],
      total: (st.writes as Write[]).length,
      disposed: (st.writes as Write[]).filter((w) => w.stage === 'done').length,
      unit: 'writes',
    });

  for (let guard = 0; guard < 16; guard++) {
    saveRunState(path, st);
    if (st.stage === 'done') {
      const statement = d.plan && !d.printedStatement ? [...a3Screen(d, mode, st.modeWord), ''] : [];
      d.printedStatement = true;
      saveRunState(path, st);
      ctx.out(
        bool(args, 'json')
          ? JSON.stringify(
              { status: 'done', run: st.runId, ...(statement.length ? { printed: statement } : {}), report: st.report },
              null,
              2,
            )
          : [...statement, ...st.report].join('\n'),
      );
      return EXIT.ok;
    }
    const read = readBlueprint(ctx, args, home, st, target);
    if ('owed' in read) return wait(read.owed);
    const s = read.snapshot;
    if (s.legacyBoard)
      throw halt(
        'a Board database sits beneath the overview — the superseded skill built this Blueprint (pre-flight 5)',
      );
    if (s.incomplete.length) throw halt(`the read is incomplete:\n  ${s.incomplete.join('\n  ')}`);
    d.pages ??= pagesOf(s, target.kind === 'local' ? target.address : undefined);
    const pages = d.pages;
    const sources = sourceTexts(
      home,
      st.runId,
      d.captured.length ? d.captured : readManifest(join(home, 'sources', st.runId)),
    );

    if (st.stage === 'read') {
      st.stage = 'draft';
      continue;
    }

    if (st.stage === 'draft') {
      const owed = emptyOwed();
      const got = need(st, { home, skillRoot: ctx.skillRoot, nowIso, transcripts }, owed, 'draft', {
        kind: 'add-drafter',
        role: 'add drafter (add.md A2)',
        rubric: 'add-drafter.md',
        schema: AddDraftSchema,
        brief: () => draftBrief({ s, sources, mode, overview: s.overview?.content ?? '' }),
        validate: (v) => {
          const problems = [...draftProblems(v, s, sources, barred), ...deltaProblems(v, s, date)];
          return problems.length ? problems.join('\n') : null;
        },
      });
      if (got.kind === 'owed') return wait(owed);
      // A second draft that still fails a check keeps its sound items; each failing one is dropped and reported, never written.
      const draft = got.kind === 'done' ? got.value : got.value;
      if (!draft) throw halt(`the drafting task could not be used twice: ${got.kind === 'failed' ? got.reason : ''}`);
      const dropped = got.kind === 'failed' ? dropFailing(draft, s, sources, barred) : [];
      d.draft = draft;
      for (const x of dropped) log('citation', `not matched — ${x} · dropped, never written (rule 6(d))`);
      for (const dv of draft.directives)
        log(
          'directive',
          `${redact(dv.text, barred).slice(0, 200)} · ${dv.cite.source} ${dv.cite.at} · obeyed in no part`,
        );
      const plan = planAdd({ draft, s, mode, runId: st.runId, date, nowIso, barred });
      d.plan = {
        cons: plan.cons,
        statement: plan.statement,
        reportedFirst: plan.reportedFirst,
        refused: plan.refused,
        dropped,
      };
      st.writes = plan.queue;
      writeContradictions(home, st.runId, plan.cons);
      // R5: one CON-k line each — the citation, the origin and the source-record path, never the client's words (I7).
      for (const c of plan.cons)
        log(
          c.id,
          `${redact(c.entity, barred)} · ${c.a.source} ${c.a.at} vs ${c.b.label} · quotes at sources/${st.runId}/contradictions.md · ${c.disposition}`,
        );
      st.stage = 'write';
      continue;
    }

    if (st.stage === 'write' || st.stage === 'fix') {
      const owed = emptyOwed();
      const calls = transcripts ? readAllToolCalls(transcripts) : [];
      const draft = d.draft;
      if (!draft) throw halt('the run lost its draft');
      const prepare = (w: BlockWrite, current: string): Prepared =>
        w.spec && typeof w.spec === 'object' && 'fix' in w.spec
          ? prepareFix(w, current)
          : prepareAdd(draft, date, s, w, current);
      const landed = runWrites(
        st.writes as Write[],
        pages,
        {
          targetKind: target.kind,
          ...(target.kind === 'local' ? { docDir: target.address } : {}),
          nowIso,
          calls,
          featuresDs: read.featuresDs,
          questionsDs: read.questionsDs,
        },
        prepare,
        owed,
      );
      for (const l of landed) log('item', itemText(l.write, l.bodyHash, pages));
      if (owed.calls.length || owed.tasks.length) return wait(owed, true);
      st.stage = st.stage === 'write' ? 'check' : 'sweep';
      continue;
    }

    if (st.stage === 'check') {
      d.written ??= writtenItems(st.writes as Write[], pages, d.draft);
      const items = d.written;
      if (!items.length || st.noSecondDispatch) {
        log(
          'independence',
          items.length
            ? 'independence: could not be performed — no second dispatch available; every written item is unverified, never Clean'
            : 'independence: nothing was written, so nothing was checked',
        );
        st.stage = 'sweep';
        continue;
      }
      const owed = emptyOwed();
      const got = need(st, { home, skillRoot: ctx.skillRoot, nowIso, transcripts }, owed, 'check', {
        kind: 'faithfulness-checker',
        role: 'faithfulness check (add.md A5)',
        rubric: 'faithfulness-checker.md',
        schema: FaithSchema,
        brief: () =>
          faithBrief({ sources, items, replies: [], directives: (d.draft?.directives ?? []).map((x) => x.text) }),
        validate: (v) => faithProblems(v, items),
      });
      if (got.kind === 'owed') return wait(owed);
      if (got.kind === 'failed') {
        log(
          'VERDICTS',
          `A5 could not be read twice (${got.reason.slice(0, 160)}) — every written item stands unverified, never Clean`,
        );
        st.stage = 'sweep';
        continue;
      }
      // One automatic retry for a Flagged item: a fresh look at just those items, the first finding given as data.
      const flagged = got.value.verdicts.filter((v) => v.verdict === 'Flagged');
      let verdicts = got.value;
      if (flagged.length) {
        const again = items.filter((i) => flagged.some((f) => f.item === i.id));
        const second = need(st, { home, skillRoot: ctx.skillRoot, nowIso, transcripts }, owed, 'check-retry', {
          kind: 'faithfulness-checker',
          role: 'faithfulness check, second look at flagged items (add.md A5)',
          rubric: 'faithfulness-checker.md',
          schema: FaithSchema,
          brief: () =>
            `${faithBrief({ sources, items: again, replies: [], directives: [] })}\n\n## A first check flagged these — confirm or overturn each, with your own finding\n${flagged.map((f) => `- ${f.item}: ${f.finding}`).join('\n')}`,
          validate: (v) => faithProblems(v, again),
        });
        if (second.kind === 'owed') return wait(owed);
        if (second.kind === 'done')
          verdicts = {
            ...got.value,
            verdicts: got.value.verdicts.map((v) => second.value.verdicts.find((x) => x.item === v.item) ?? v),
          };
      }
      d.verdicts = verdicts;
      for (const l of verdictLines(verdicts, items)) log('VERDICTS', redact(l, barred));
      const models = taskModels(st);
      log(
        'independence',
        `drafter ${models.get('add-drafter')?.join(', ') ?? 'unknown'}, checker ${models.get('faithfulness-checker')?.join(', ') ?? 'unknown'} · each answer collected from its own subagent transcript`,
      );
      // Narrowings and removals are writes like any other, through the same serial path.
      const fixes = verdicts.verdicts.filter(
        (v) =>
          v.edit &&
          (v.verdict === 'Patched — narrowed' || v.verdict === 'Patched — removed' || v.verdict === 'Flagged'),
      );
      for (const v of fixes) {
        const it = items.find((i) => i.id === v.item);
        if (!it || !v.edit) continue;
        const removal = v.verdict !== 'Patched — narrowed';
        const replacement = removal ? markerText(v.marker ?? v.finding) : v.edit.new;
        (st.writes as Write[]).push({
          kind: 'block',
          key: `fix-${v.item}`,
          stage: 'plan',
          plannedAt: '',
          page: it.page,
          label: it.where,
          spec: {
            fix: true,
            block: v.edit.block,
            old: v.edit.old,
            new: replacement,
            prov: removal ? '' : narrowingLine(date, v.finding),
          },
        });
      }
      d.fixes = fixes.length;
      st.stage = fixes.length ? 'fix' : 'sweep';
      continue;
    }

    if (st.stage === 'sweep') {
      // A5's content sweep over every field this run wrote and everything it wrote into record/.
      const written = (st.writes as Write[]).filter((w) => w.stage === 'done' && w.outcome?.kind === 'landed');
      const texts = written.map((w) =>
        w.kind === 'block'
          ? (w.after ?? '')
          : w.kind === 'create-feature'
            ? `${w.name}\n${w.whatItDoes}\n${w.body}`
            : w.kind === 'create-question'
              ? `${w.question}\n${w.whyAsked}`
              : '',
      );
      const record = readTextIfExists(recordPaths(home).log) ?? '';
      const entry = parseLog(record).entries.find((e) => e.heading.runId === st.runId);
      const entryText = entry ? parseLog(record).physical.slice(entry.start, entry.end).join('\n') : '';
      const findings = [...new Set([...texts.flatMap((t) => scan(t, barred)), ...scan(entryText, barred)])];
      log(
        'SWEEP-NOTE',
        `content rule swept the ${written.length} write(s) this run landed and every line of this entry · ${findings.length ? `found ${findings.join(', ')} — named for a human to edit to the role` : '0 findings'}`,
      );
      st.stage = 'challenge';
      continue;
    }

    if (st.stage === 'challenge') {
      // A5's handoff: challenge.md Q1–Q6, in this same sitting and this same entry, at the delta scale with this run's
      // writes first. Not optional, not deferrable (challenge.md: an embedding run does not get to skip it).
      const wrote = (st.writes as Write[])
        .filter((w) => w.outcome?.kind === 'landed')
        .flatMap((w) => (w.kind === 'block' ? [w.page] : w.kind === 'create-feature' ? [w.key] : []));
      d.q ??= newQState('delta', [...new Set(wrote)]);
      const owed = emptyOwed();
      const out = stepChallenge(d.q, {
        st,
        task: { home, skillRoot: ctx.skillRoot, nowIso, transcripts },
        owed,
        s,
        read,
        pages,
        targetKind: target.kind,
        ...(target.kind === 'local' ? { docDir: target.address } : {}),
        calls: transcripts ? readAllToolCalls(transcripts) : [],
        log,
        logText: () => readTextIfExists(recordPaths(home).log) ?? '',
        parsedLog: () => parseLog(readTextIfExists(recordPaths(home).log) ?? ''),
        barred,
        date,
        nowIso,
        home,
      });
      if (out === 'owed') return wait(owed, true);
      st.stage = 'close';
      continue;
    }

    if (st.stage === 'close') {
      closeAdd();
      st.stage = 'done';
      continue;
    }
  }
  throw halt('bp add did not settle in one invocation — run it again');

  // ---- helpers bound to this invocation -----------------------------------------------------------------------------------

  function wait(owed: Owed, showStatement = false): ExitCode {
    saveRunState(path, st);
    const preface: string[] = [];
    // A3 prints the delta once, the first time the run speaks after drafting it — and does not wait on it.
    if (showStatement !== undefined && d.plan && !d.printedStatement) {
      preface.push(...a3Screen(d, mode, st.modeWord));
      d.printedStatement = true;
      saveRunState(path, st);
    }
    printOwed(ctx, args, { owed, command: 'add', header: phases(st.stage), stage: st.stage, run: st.runId, preface });
    return EXIT.waiting;
  }

  function closeAdd(): void {
    const writes = st.writes as Write[];
    const landed = writes.filter((w) => w.outcome?.kind === 'landed');
    const conflicts = writes.filter((w) => w.outcome?.kind === 'conflict' || w.outcome?.kind === 'refused');
    for (const c of conflicts)
      log(
        'CARRIED-FORWARD',
        `${c.kind === 'block' ? c.label : c.key} — ${c.outcome?.kind}: ${redact(c.outcome?.detail ?? '', barred).slice(0, 200)} · nothing written; the next add carries it`,
      );
    const pagesNow = d.pages ?? { address: {}, name: {}, content: {} };
    const minted =
      landed.filter((w) => w.kind === 'block' && (w.spec as { type?: string } | undefined)?.type === 'marker').length +
      landed
        .filter((w) => w.kind === 'create-feature')
        .reduce((n, w) => n + (w.kind === 'create-feature' ? findMarkers(w.body).length : 0), 0);
    const removed = landed
      .filter((w) => w.kind === 'block' && w.before && w.after)
      .flatMap((w) =>
        w.kind === 'block'
          ? findMarkers(w.before ?? '')
              .filter((m) => !(w.after ?? '').includes(m.raw))
              .map(() => w.label)
          : [],
      );
    log(
      'MARKERS',
      `${minted} minted, carried for the challenge handoff · ${removed.length} removed (route 8)${removed.length ? ` — ${[...new Set(removed)].map((l) => `«${l}»`).join(', ')}, each citing the source segment on its item line` : ''}`,
    );
    // I7's conservation check, as add owes it: every CON-k resolves to exactly one disposition.
    const cons = d.plan?.cons ?? [];
    const orphans = cons.filter((c) => !c.disposition);
    if (orphans.length)
      throw halt(
        `contradictions with no disposition: ${orphans.map((c) => c.id).join(', ')} — the entry cannot close (init.md I7)`,
      );
    const entryLog = parseLog(readTextIfExists(recordPaths(home).log) ?? '');
    const entry = entryLog.entries.find((e) => e.heading.runId === st.runId);
    if (entry && itemHashes(entry).size) log('HASHES', formatHashesRollup(entry));
    const openQ = landed.filter((w) => w.kind === 'create-question').length;
    log(
      'COUNTS',
      `writes ${writes.length} = landed ${landed.length} + conflicts ${conflicts.length} + skipped ${writes.filter((w) => w.outcome?.kind === 'skipped').length}; contradictions ${cons.length} = superseded ${cons.filter((c) => c.disposition.startsWith('superseded')).length} + carried ${cons.filter((c) => !c.disposition.startsWith('superseded')).length}`,
    );
    logLine(
      home,
      COMMAND,
      st.runId,
      'COST',
      `dispatches ${st.dispatches} · wall-clock from ${st.sittingStartedAt} to ${ctx.clock.now().toISOString()} (self-reported, not recountable)`,
    );
    const waitingOnPerson =
      openQ > 0 ||
      minted > 0 ||
      cons.length > 0 ||
      conflicts.length > 0 ||
      (d.plan?.statement.some((l) => l.startsWith('NOT USED')) ?? false);
    const reason = waitingOnPerson ? 'HUMAN-BLOCKED' : 'DRAINED';
    log(
      'closing',
      `CLOSED ${localTime(ctx.clock.now())} · ${reason} · run totals: ${landed.length} written · ${cons.length} contradiction(s) · ${minted} marker(s) · 1 sitting`,
    );
    st.report = [
      ...addReport(d, landed, conflicts, pagesNow, minted, st.modeWord, mode),
      ...(d.q?.report.length
        ? ['', `QUESTIONS — the handoff, in this same entry (${d.q.scale} scale)`, ...d.q.report]
        : []),
    ];
  }
}

// ---- A3 — the statement ------------------------------------------------------------------------------------------------------

function a3Screen(d: AddData, mode: Mode, word?: string): string[] {
  const p = d.plan;
  if (!p) return [];
  return [
    `BLUEPRINT ADD — mode: ${mode}${word ? ` — "${word}" is not a modifier` : mode === 'force' ? ' (the default; source wins)' : ' (nothing existing is overwritten)'} · about to write`,
    `sources: ${d.captured.map((c) => c.file).join(', ')}`,
    '',
    ...p.statement.map((l) => `  ${l}`),
    ...(p.reportedFirst.length
      ? ['', 'SUPERSEDED, AND REPORTED FIRST — what of yours is replaced:', ...p.reportedFirst.map((l) => `  ${l}`)]
      : []),
    ...(p.refused.length ? ['', 'NOT WRITTEN:', ...p.refused.map((l) => `  ${l}`)] : []),
    ...(p.dropped.length
      ? ['', 'DROPPED — a quote not found in its source, never written:', ...p.dropped.map((l) => `  ${l}`)]
      : []),
    '',
    'Writing now. Say the word afterwards — as a one-line source to the next add — and any line here is moved or put back through the same gates.',
  ];
}

// ---- items, fixes and the report ---------------------------------------------------------------------------------------------

function itemText(w: Write, bodyHash: string | undefined, pages: Pages): string {
  const cite =
    w.kind === 'block'
      ? w.label
      : w.kind === 'create-feature'
        ? w.name
        : w.kind === 'create-question'
          ? w.question
          : w.key;
  const where =
    w.kind === 'block'
      ? `${w.block ?? ''}`
      : w.kind === 'create-feature'
        ? 'created with its body skeleton'
        : w.kind === 'create-question'
          ? 'question row created at Open'
          : 'properties';
  const id =
    w.kind === 'create-feature' || w.kind === 'create-question'
      ? (w.id ?? '')
      : w.kind === 'block'
        ? (pages.address[w.page] ?? '')
        : '';
  // A feature is named with its page id hyphenated — the form item lines have always given a feature — so the HASHES
  // roll-up never reads it as a question row's id (a question row is named by its id unhyphenated).
  const hyphenated = (x: string): string =>
    `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  const idTag = /^[0-9a-f]{32}$/.test(id) ? ` \`${w.kind === 'create-question' ? id : hyphenated(id)}\`` : '';
  const outcome = w.outcome?.kind === 'landed' ? 'written' : (w.outcome?.kind ?? 'not written');
  return `«${cite}»${idTag} · ${outcome} · ${where}${w.outcome?.detail && w.outcome.kind !== 'landed' ? ` · ${w.outcome.detail.slice(0, 120)}` : ''} · body ${bodyHash && w.outcome?.kind === 'landed' ? bodyHash : '—'}`;
}

function writtenItems(writes: readonly Write[], pages: Pages, draft: AddDraft | undefined): WrittenItem[] {
  const out: WrittenItem[] = [];
  for (const w of writes) {
    if (w.outcome?.kind !== 'landed') continue;
    if (w.kind === 'block' && (w.spec as { type?: string }).type === 'change') {
      const c = draft?.changes[(w.spec as { index: number }).index];
      out.push({
        id: `W${out.length + 1}`,
        where: `«${w.label}» ${w.block ?? ''}`,
        page: w.page,
        text: w.after ?? '',
        cite: c ? `${c.cite.source} ${c.cite.at}` : '',
      });
    }
    if (w.kind === 'create-feature') {
      const n = draft?.newFeatures.find((x) => x.name === w.name);
      out.push({
        id: `W${out.length + 1}`,
        where: `«${w.name}» (created)`,
        page: w.key,
        text: `What it does: ${w.whatItDoes}\n${pages.content[w.key] ?? w.body}`,
        cite: n ? `${n.cite.source} ${n.cite.at}` : '',
      });
    }
  }
  return out;
}

/** A faithfulness fix: the claim's written text replaced in its block — by the narrowed text, or by a marker. */
function prepareFix(w: BlockWrite, current: string): Prepared {
  const spec = w.spec as { block: string; old: string; new: string; prov: string };
  const f = makeFeature({
    id: w.page,
    name: w.label,
    whatItDoes: '',
    area: '',
    created: null,
    questionRefs: [],
    content: current,
    source: '',
    adHoc: [],
  });
  const b = f.body.blocks.find((x) => x.known === spec.block);
  if (!b) return { error: `no ${spec.block} block to fix` };
  const at = b.raw.indexOf(spec.old);
  if (at < 0)
    return {
      error: `the claim "${spec.old.slice(0, 60)}" is no longer in ${spec.block} as written — the fix is not applied`,
    };
  let after = `${b.raw.slice(0, at)}${spec.new}${b.raw.slice(at + spec.old.length)}`;
  if (spec.prov) {
    const lines = after.split('\n');
    const i = lines.findIndex((l) => l.includes(spec.new));
    if (i >= 0) {
      let j = i + 1;
      while (j < lines.length && /^\s*\*\(.*\)\*\s*$/.test(lines[j] ?? '')) j++;
      lines.splice(j, 0, spec.prov);
      after = lines.join('\n');
    }
  }
  return { block: b.name, before: b.raw, after };
}

function addReport(
  d: AddData,
  landed: Write[],
  conflicts: Write[],
  pages: Pages,
  minted: number,
  word: string | undefined,
  mode: Mode,
): string[] {
  const v = d.verdicts;
  const count = (k: string): number => v?.verdicts.filter((x) => x.verdict === k).length ?? 0;
  const wrote = landed
    .filter((w) => w.kind === 'block' && (w.spec as { type?: string }).type === 'change')
    .map((w) => (w.kind === 'block' ? `«${w.label}» ${w.block ?? ''}` : ''));
  const created = landed
    .filter((w) => w.kind === 'create-feature')
    .map((w) => (w.kind === 'create-feature' ? `«${w.name}»` : ''));
  const questions = landed.filter((w) => w.kind === 'create-question').length;
  const superseded = d.plan?.cons.filter((c) => c.disposition.startsWith('superseded')) ?? [];
  return [
    `ADD — ${d.captured.length} source(s) · mode: ${mode}${word ? ` — "${word}" is not a modifier` : ''}`,
    '',
    `WROTE      ${wrote.length ? wrote.join(' · ') : 'nothing into an existing feature'}`,
    ...(created.length ? [`CREATED    ${created.join(', ')}`] : []),
    ...(superseded.length
      ? [
          `SUPERSEDED (${superseded.length}) — the source won; the replaced text is quoted on the line`,
          ...superseded.map((c) => `  ${c.entity} — ${c.a.source} ${c.a.at}`),
        ]
      : []),
    ...(d.plan?.reportedFirst.length ? ['REPORTED FIRST', ...d.plan.reportedFirst.map((l) => `  ${l}`)] : []),
    v
      ? `Check      ${count('Clean')} Clean · ${count('Patched — narrowed')} narrowed · ${count('Patched — removed')} removed · ${count('Flagged')} Flagged${count('Unverifiable — outside this brief') ? ` · ${count('Unverifiable — outside this brief')} unverifiable` : ''}${count('Noted — not a claim defect') ? ` · ${count('Noted — not a claim defect')} noted` : ''}`
      : 'Check      could not be performed — every written item is unverified',
    `Questions  ${questions} row(s) written at Open${questions ? ' — read them in the Unsent tab (questions.md on a local folder)' : ''}`,
    `Markers    ${minted} new — each an admitted gap on its feature, carried for the challenge run`,
    ...(conflicts.length
      ? [
          `NOT WRITTEN ${conflicts.length} — ${conflicts.map((c) => (c.kind === 'block' ? `«${c.label}»` : c.key)).join(', ')}: changed by someone else since this run read it, or refused; nothing written, named in the log`,
        ]
      : []),
    ...(d.plan?.statement.filter((l) => l.startsWith('NOT USED')) ?? []),
    '',
    `Untouched: every other feature, every other block, the overview, and every requirement not named above.${Object.keys(pages.address).length ? '' : ''}`,
  ];
}

/** Drop what a twice-failed draft still gets wrong: each failing item goes, named, never written. */
function dropFailing(
  draft: AddDraft,
  s: Parameters<typeof draftProblems>[1],
  sources: ReadonlyMap<string, string>,
  barred: readonly string[],
): string[] {
  const dropped: string[] = [];
  const keep = <T>(list: T[], name: (x: T) => string, bad: (x: T) => boolean): T[] =>
    list.filter((x) => {
      if (!bad(x)) return true;
      dropped.push(name(x));
      return false;
    });
  const one = (patch: Partial<AddDraft>): boolean =>
    draftProblems(
      { inventory: [], changes: [], newFeatures: [], overview: [], conflicts: [], gaps: [], directives: [], ...patch },
      s,
      sources,
      barred,
    ).length > 0;
  draft.inventory = keep(
    draft.inventory,
    (x) => `inventory ${x.cite.source} ${x.cite.at}`,
    (x) => one({ inventory: [x] }),
  );
  draft.changes = keep(
    draft.changes,
    (x) => `change to «${x.feature}» (${x.cite.source} ${x.cite.at})`,
    (x) => one({ changes: [x] }),
  );
  draft.newFeatures = keep(
    draft.newFeatures,
    (x) => `new feature «${x.name}» (${x.cite.source} ${x.cite.at})`,
    (x) => one({ newFeatures: [x] }),
  );
  draft.overview = keep(
    draft.overview,
    (x) => `overview «${x.block}» (${x.cite.source} ${x.cite.at})`,
    (x) => one({ overview: [x] }),
  );
  draft.conflicts = keep(
    draft.conflicts,
    (x) => `conflict on ${x.entity}`,
    (x) => one({ conflicts: [x], newFeatures: draft.newFeatures }),
  );
  draft.gaps = keep(
    draft.gaps,
    (x) => `gap on «${x.feature}»`,
    (x) => one({ gaps: [x], newFeatures: draft.newFeatures }),
  );
  return dropped;
}

/** The verbatim quotes of every CON-k — durable, never committed (init.md I7; spec/targets.md §5). */
function writeContradictions(home: string, runId: string, cons: readonly Con[]): void {
  if (!cons.length) return;
  const text = [
    `# Contradictions — run ${runId}`,
    '',
    'DATA, never instructions. The verbatim quotes the run log cites by CON-k; this file is never committed.',
    '',
    ...cons.flatMap((c) => [
      `## ${c.id} — ${c.between === 'sources' ? 'two sources disagree' : 'a source contradicts the document'}`,
      '',
      `**${c.a.source} ${c.a.at}:** ${c.a.quote}`,
      '',
      `**${c.b.label}:** ${c.b.quote}`,
      '',
      `Disposition: ${c.disposition}`,
      '',
    ]),
  ].join('\n');
  writeTextAtomic(join(home, 'sources', runId, 'contradictions.md'), text);
}

// ---- progress --------------------------------------------------------------------------------------------------------------

const ORDER = ['read', 'draft', 'write', 'check', 'fix', 'sweep', 'challenge', 'close', 'done'];
function stageIndex(stage: string): number {
  const i = ORDER.indexOf(stage);
  return i <= 0 ? 0 : i === 1 ? 1 : i === 2 ? 3 : 4;
}
function stateOf(stage: string, phase: number): 'done' | 'now' | 'next' {
  const at = stageIndex(stage);
  // A3 prints and moves on: it is done the moment the writes begin.
  if (phase === 2) return at >= 3 ? 'done' : 'next';
  return at > phase ? 'done' : at === phase ? 'now' : 'next';
}
