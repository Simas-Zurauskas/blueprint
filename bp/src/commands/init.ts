import { join, resolve } from 'node:path';
import { bool, flag, flagAll, oneOfFlag, type Args } from '../core/args.ts';
import { localDate, localTime } from '../core/clock.ts';
import { EXIT, halt, usage, type ExitCode } from '../core/errors.ts';
import { exists, listDir, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
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
import { markerLink } from '../domain/feature.ts';
import { openEntry, recordPaths, RUN_ID, seedIgnore } from '../log/entry.ts';
import { formatHashesRollup, itemHashes } from '../log/lines.ts';
import { parseLog } from '../log/parse.ts';
import { preflight, skillVersion } from '../preflight.ts';
import { renderProgress } from '../progress.ts';
import { captureSources, REPO_ASK, type Captured, type SourceInput } from '../sources.ts';
import { makeFeature, makeOverview, type Snapshot } from '../snapshot.ts';
import { sessionTranscripts } from '../tasks/tasks.ts';
import { readLocal } from '../target/local.ts';
import { normaliseId, parseFetch } from '../target/notion.ts';
import { CONNECTOR, loadPull, newPull, savePull, stepPull, toSnapshot } from '../target/relay.ts';
import { canonicalJson, latestCall, readAllToolCalls, type ToolCall } from '../target/transcript.ts';
import { runLogWebUrl } from './status.ts';
import { sourceTexts } from '../add/draft.ts';
import { markerText } from '../add/plan.ts';
import { humanWords } from '../engine/human.ts';
import { barredTerms, logLine, printOwed } from '../engine/io.ts';
import { pagesOf, type Read } from '../engine/read.ts';
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
import { GrillPassSchema, grillBrief, planSurface, requirementIndex } from '../challenge/grill.ts';
import { newQState, stepChallenge, type QState } from '../challenge/run.ts';
import { proposalText } from '../resolve/project.ts';
import {
  InitDraftSchema,
  bodyOf,
  dropUncited,
  initDraftBrief,
  initDraftProblems,
  numberCons,
  overviewBlocks,
  settledCons,
  skeletonScreen,
  skeletonSnapshot,
  type Con,
  type InitDraft,
} from '../init/draft.ts';
import {
  VIEWS,
  createdDatabase,
  databaseTags,
  featuresDdl,
  localViews,
  questionsDdl,
  regenerateLocalViews,
} from '../init/structure.ts';

// `bp init` — init.md end to end. I1 settles the target (`--target`), captures every source verbatim and hashed, and opens
// the entry; I2 is one drafting task and the full grill over the draft, its finds folded back in; I3 is the one hard stop
// — the skeleton, block text and all, written to sources/<run-id>/i3-skeleton.md and printed, nothing created until the
// human answers (`--reply <file> --decision confirm|edit|decline`); I4 creates the structure and re-reads it; I5 writes
// the rows, then the overview once; I6 is the faithfulness check; I7 the content sweep, the challenge handoff, the
// contradiction conservation check and the close. Run it, do what it prints, run it again.

const COMMAND = 'init';
const SKELETON = 'i3-skeleton.md';
const REPLY = 'i3-reply.md';
const CREATE_DB = 'notion-create-database';
const CREATE_VIEW = 'notion-create-view';
/** SKILL.md rule 4's two mandatory entries — the register a human widens thereafter. */
const REGISTER = "minors' data protection and child-recording consent · regulatory applicability";

/** One structural connector call by key: planned once, its result read out of the transcript. */
interface Call {
  tool: string;
  input: Record<string, unknown>;
  plannedAt: string;
  done?: boolean;
  result?: string;
  error?: string;
}

interface InitData {
  captured: Captured[];
  /** The overview as it stood at I1 — a human's text is never clobbered. */
  existing?: string;
  draft?: InitDraft;
  cons?: Con[];
  /** What a twice-failed draft still got wrong, dropped item by item and reported at I3. */
  dropped?: string[];
  grilled?: number;
  grillFinds?: string[];
  presented?: number;
  replies: string[];
  structure: Record<string, Call>;
  ids: Record<string, string>;
  viewsFailed: string[];
  pages?: Pages;
  writes?: Write[];
  overview?: { stage: 'fetch' | 'write' | 'readback'; plannedAt: string; content?: string };
  written?: WrittenItem[];
  verdicts?: Faith;
  fixes?: Write[];
  q?: QState;
}

/** The halt when there is no connected overview page (init.md; spec/databases.md §7) — never a substitute front door. */
const SETUP = [
  'there is no connected overview page — the run never creates a substitute front door (init.md; spec/databases.md §7):',
  '  1. a human creates the teamspace',
  '  2. a human creates the overview page in it',
  '  3. a human adds the connection from the page’s ••• menu → Connections',
  'then run /blueprint init again with the page’s URL.',
].join('\n');

const dataOf = (st: RunState): InitData => st.data as unknown as InitData;

/** Stage → the I-phase it belongs to (run-progress §1). */
const PHASE: Record<string, number> = {
  read: 0,
  draft: 1,
  grill: 1,
  regap: 1,
  i3: 2,
  redraft: 2,
  structure: 3,
  verify: 3,
  views: 3,
  rows: 4,
  overview: 4,
  check: 5,
  fix: 5,
  sweep: 6,
  challenge: 6,
  close: 6,
  done: 7,
};

export function initCommand(ctx: Ctx, args: Args): ExitCode {
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
  const home = first.current;
  // targets §5: the ignore file comes before anything else is written into the working folder — sources/ holds client
  // material verbatim, and the repository holding the folder would otherwise commit it on the next `git add -A`.
  let seeded = false;
  // I1's one ask where target.md names none: where should this live? Recorded before anything else.
  const targetArg = flag(args, 'target');
  if (!first.target) {
    if (!targetArg)
      throw usage(
        'Where should this live? Notion — the URL of a page you have created and connected — or a folder of markdown files (init.md I1).',
        'pass the answer as --target notion:<page url or id> or --target local[:<folder>]',
      );
    seeded = seedIgnore(home);
    writeTarget(home, workspace, targetArg);
  } else if (targetArg && !unfinishedRunsOf(home, 'init').length)
    throw usage(
      `${join(home, 'target.md')} already names the target — a Blueprint that exists is /blueprint add, not init`,
    );
  const requested = flag(args, 'run');
  if (requested !== undefined && !RUN_ID.test(requested)) throw usage(`"${requested}" is not a run id`);
  const open = unfinishedRunsOf(home, 'init');
  if (!requested && open.length > 1)
    throw usage(`several unfinished init runs: ${open.join(', ')} — name one with --run`);
  const runId = requested ?? open[0];
  const p = preflight({
    workspace,
    skillRoot: ctx.skillRoot,
    command: 'init',
    clock: ctx.clock,
    ...(runId ? { runId } : {}),
    ...(named ? { named } : {}),
  });
  if (p.halts.length) throw halt(p.halts.join('\n'));
  if (!p.target) throw halt('no target was recorded in target.md');
  const target = { kind: p.target.kind, address: p.target.address };
  const docDir = target.kind === 'local' ? target.address : undefined;
  const nowIso = ctx.clock.now().toISOString();
  const date = localDate(ctx.clock.now());

  const inputs: SourceInput[] = [
    ...flagAll(args, 'source').map((path) => ({ path: resolve(workspace, path) })),
    ...flagAll(args, 'text').map((path, i) => ({
      text: readTextIfExists(resolve(workspace, path)) ?? '',
      name: flagAll(args, 'text-name')[i] ?? `interview-${i + 1}.md`,
      origin: `given in conversation, ${date}`,
    })),
  ];
  let loaded = runId ? loadRunState(runStatePath(home, runId)) : undefined;
  if (loaded && inputs.length)
    throw usage(`run ${loaded.runId} is past I1 — its source record is closed; a new source waits for /blueprint add`);
  if (!loaded) {
    if (!inputs.length)
      throw usage(
        'init takes the sources: --source <file or folder>…, and --text <file> for what was said in conversation — where the source is a person, the interview (init.md I1: three questions) saved to a file',
        REPO_ASK,
      );
    if (docDir && listDir(join(docDir, 'features')).some((f) => f.endsWith('.md')))
      throw halt(`${docDir} already holds a Blueprint — adding material to one is /blueprint add (init.md edge cases)`);
    const id = ((): string => {
      for (let i = 0; i < 100; i++) {
        const c = ctx.rand.hex(3);
        if (!listDir(join(home, 'sources')).includes(c)) return c;
      }
      throw usage('could not draw an unused run id');
    })();
    loaded = newRunState({ command: 'init', runId: id, nowIso, noSecondDispatch: bool(args, 'no-second-dispatch') });
    // I1: capture before interpreting — the source record is the first write, and the entry opens with it.
    seeded = seedIgnore(home) || seeded;
    const captured = captureSources({ home, runId: id, command: 'init', date, inputs });
    loaded.data = {
      captured,
      replies: [],
      structure: {},
      ids: {},
      viewsFailed: [],
    } satisfies InitData;
    openEntry(
      recordPaths(home),
      {
        date,
        time: localTime(ctx.clock.now()),
        command: 'init',
        runId: id,
        version: skillVersion(ctx.skillRoot),
        sitting: 1,
        extra: `${captured.length} source${captured.length === 1 ? '' : 's'} · target ${target.kind}`,
      },
      workspace.split('/').pop() ?? 'Blueprint',
    );
    loaded.entryOpen = true;
    loaded.stage = 'read';
    if (seeded)
      logLine(
        home,
        COMMAND,
        id,
        'NOTE',
        `seeded ${join(home, '.gitignore')} naming sources/ and cache/ — record/ is committed, deliberately`,
      );
  }
  const st: RunState = loaded;
  const path = runStatePath(home, st.runId);
  const d = dataOf(st);
  const barred = barredTerms(home);
  const transcripts = sessionTranscripts(ctx.env, flag(args, 'transcript'));
  const task = { home, skillRoot: ctx.skillRoot, nowIso, transcripts };
  const calls = (): readonly ToolCall[] => (transcripts ? readAllToolCalls(transcripts) : []);
  const log = (kind: string, text: string): void =>
    logLine(home, COMMAND, st.runId, kind, text.replace(/\s+/g, ' ').trim());
  const logText = (): string => readTextIfExists(recordPaths(home).log) ?? '';
  const pending: { tool: string; input: Record<string, unknown> }[] = [];

  // The I3 reply, when this invocation carries one: captured verbatim and hashed before anything acts on it (v20).
  const replyFile = flag(args, 'reply');
  const decision = oneOfFlag(args, 'decision', ['confirm', 'edit', 'decline'] as const);
  if ((replyFile === undefined) !== (decision === undefined))
    throw usage(
      "--reply <file> and --decision confirm|edit|decline go together: the human's words, verbatim, and what they decided",
    );
  if (replyFile && decision) {
    if (st.stage !== 'i3') throw usage(`run ${st.runId} is not waiting at I3 — it is at ${st.stage}`);
    const words = readTextIfExists(resolve(workspace, replyFile));
    if (words === undefined) throw usage(`no reply at ${replyFile}`);
    // The sanction is the human's: their words, found verbatim in a message they sent — never the orchestrator's summary.
    const receipt = humanWords(transcripts, words, `the I3 reply (${decision})`);
    d.captured.push(
      ...captureSources({
        home,
        runId: st.runId,
        command: 'init',
        date,
        inputs: [{ text: words, name: REPLY, origin: `given at the I3 stop, ${date}` }],
      }),
    );
    d.replies.push(words);
    log('NOTE', receipt);
    if (decision === 'decline') {
      // Declining is a normal ending: nothing was created, and the source record survives for the next attempt.
      log(
        'NOTE',
        'the human declined the skeleton at I3 — nothing was created; the source record stays for the next run',
      );
      log(
        'closing',
        `CLOSED ${localTime(ctx.clock.now())} · HUMAN-BLOCKED · run totals: skeleton declined · nothing created · 1 sitting`,
      );
      st.entryOpen = false;
      st.report = [
        'BLUEPRINT INIT — the skeleton was declined. Nothing was created.',
        `The source record stays at sources/${st.runId}/ — the next /blueprint init starts from it.`,
      ];
      st.stage = 'done';
    } else if (decision === 'edit') {
      // Re-drafted with the reply as data, then re-presented once — nobody confirms a skeleton they have not seen.
      delete st.tasks['redraft'];
      st.stage = 'redraft';
    } else st.stage = 'structure';
    saveRunState(path, st);
  }
  // The drafter's sources: everything captured but the screen itself, which is the run's own words, not a source.
  const sources = sourceTexts(
    home,
    st.runId,
    d.captured.filter((c) => c.name !== SKELETON),
  );

  for (let guard = 0; guard < 32; guard++) {
    saveRunState(path, st);
    if (st.stage === 'done') {
      ctx.out(
        bool(args, 'json')
          ? JSON.stringify({ status: 'done', run: st.runId, report: st.report }, null, 2)
          : st.report.join('\n'),
      );
      return EXIT.ok;
    }
    const owed = emptyOwed();

    if (st.stage === 'read') {
      // I1's read of the target: the overview as it stands (never clobbered), and no Blueprint already beneath it.
      if (target.kind === 'notion') {
        const pull = pullOf('read');
        if ('owed' in pull) return wait(pull.owed);
        const s = pull.snapshot;
        if (!s.overview) throw halt(SETUP);
        if (s.features.length || pull.featuresDs)
          throw halt(
            'the overview already carries a Features database — this Blueprint exists; adding material to it is /blueprint add',
          );
        d.ids['overview'] = s.overview.id;
        d.existing = s.overview.content;
      } else d.existing = readTextIfExists(join(target.address, 'README.md')) ?? '';
      st.stage = 'draft';
      continue;
    }

    if (st.stage === 'draft' || st.stage === 'regap' || st.stage === 'redraft') {
      const key = st.stage;
      const previous = d.draft;
      const got = need(st, task, owed, key, {
        kind: 'init-drafter',
        role:
          key === 'draft'
            ? 'init drafter (init.md I2)'
            : key === 'regap'
              ? 'init drafter, folding in the grill (init.md I2)'
              : "init drafter, applying the human's reply (init.md I3)",
        rubric: 'init-drafter.md',
        schema: InitDraftSchema,
        brief: () =>
          initDraftBrief({
            sources,
            existingOverview: d.existing ?? '',
            ...(key !== 'draft' && previous ? { previous } : {}),
            ...(key === 'redraft' ? { reply: d.replies[d.replies.length - 1] ?? '' } : {}),
            ...(key === 'regap' && d.grillFinds?.length ? { grillFinds: d.grillFinds } : {}),
          }),
        validate: (v) => initDraftProblems(v, sources, barred),
      });
      if (got.kind === 'owed') return wait(owed);
      let draft = got.kind === 'done' ? got.value : got.value;
      if (!draft) {
        // Nothing usable twice over: a re-draft keeps the last good skeleton; a first draft cannot go on.
        if (!previous) {
          delete st.tasks[key];
          saveRunState(path, st);
          throw halt(
            `the drafting task could not be used twice: ${got.kind === 'failed' ? got.reason : ''} — run bp init again to re-dispatch it`,
          );
        }
        log('NOTE', `the ${key} could not be used twice — the skeleton stands as last drafted`);
        draft = previous;
      }
      if (got.kind === 'failed') {
        const dropped = dropUncited(draft, sources);
        d.dropped = [...(d.dropped ?? []), ...dropped];
        for (const x of dropped) log('citation', `not matched — ${redact(x, barred)} · dropped, never written`);
        const left = initDraftProblems(draft, sources, barred);
        if (left) {
          delete st.tasks[key];
          saveRunState(path, st);
          throw halt(
            `the draft still carries what the content rule bars after two attempts — nothing is written:\n  ${left.split('\n').join('\n  ')}\nRun bp init again to re-dispatch the drafter.`,
          );
        }
      }
      d.draft = draft;
      // CON-k are numbered once; a re-draft keeps every earlier number (I7 counts what I2 found).
      d.cons = numberCons(draft, key === 'draft' ? [] : (d.cons ?? []));
      if (key === 'draft')
        for (const dv of draft.directives)
          log(
            'directive',
            `${redact(dv.text, barred).slice(0, 200)} · ${dv.cite.source} ${dv.cite.at} · quoted in the report, obeyed in no part`,
          );
      st.stage = key === 'draft' ? 'grill' : 'i3';
      continue;
    }

    if (st.stage === 'grill') {
      // I2: challenge.md Q2 at its full scale over the drafted skeleton, before anybody sees it.
      const draft = need0(d.draft);
      const s = skeletonSnapshot(draft, d.cons ?? [], st.runId, date);
      const surface = planSurface({ s, log: null, wroteThisRun: [], scale: 'full', overviewChanged: false });
      const index = requirementIndex(s);
      let waiting = false;
      const finds: string[] = [];
      for (const pass of surface.passes) {
        const r = need(st, task, owed, `i2-grill:${pass.id}`, {
          kind: 'grill-pass',
          role: `grill pass ${pass.id} over the drafted skeleton (init.md I2)`,
          rubric: 'grill-pass.md',
          schema: GrillPassSchema,
          brief: () => grillBrief({ pass, s, index, rows: '(none — nothing has been created yet)', design: null }),
        });
        if (r.kind === 'owed') waiting = true;
        const v = r.kind === 'done' ? r.value : r.kind === 'failed' ? r.value : undefined;
        for (const c of v?.candidates ?? [])
          finds.push(
            `[${c.tag}] ${c.feature ? `«${c.feature}»` : 'project-level'}: ${c.gap}${c.note ? ` (${c.note})` : ''}`,
          );
      }
      if (waiting) return wait(owed);
      d.grilled = surface.passes.length;
      log(
        'GRILL',
        `I2 · full scale over the drafted skeleton · ${surface.passes.length} pass(es) · ${finds.length} find(s) folded into the lists before I3`,
      );
      // What the grilling finds lands in the lists — one re-draft, told what was found, before the screen.
      if (finds.length) {
        d.grillFinds = finds;
        st.stage = 'regap';
      } else st.stage = 'i3';
      continue;
    }

    if (st.stage === 'i3') {
      // The one hard stop. The screen goes to the source record first — the sanction attaches to these exact words.
      const text = screenLines().join('\n');
      const last = lastSkeleton();
      if (!last || readTextIfExists(join(home, 'sources', st.runId, last.file)) !== text) {
        d.captured.push(
          ...captureSources({
            home,
            runId: st.runId,
            command: 'init',
            date,
            inputs: [{ text, name: SKELETON, origin: `the I3 screen as printed, ${date}` }],
          }),
        );
        d.presented = (d.presented ?? 0) + 1;
      }
      saveRunState(path, st);
      const ask = [
        progress(),
        '',
        text,
        '',
        'Put this screen to the human, verbatim, and wait — nothing is created until they answer. Save their reply, verbatim, to a file; then run one of:',
        '  bp init --reply <file> --decision confirm   — as shown',
        '  bp init --reply <file> --decision edit      — any change, or any answer to a gap or a contradiction on the screen (re-drafted and shown once more)',
        '  bp init --reply <file> --decision decline   — nothing is created; the source record stays',
      ];
      ctx.out(
        bool(args, 'json')
          ? JSON.stringify({ status: 'waiting', run: st.runId, stage: 'i3', ask }, null, 2)
          : ask.join('\n'),
      );
      return EXIT.waiting;
    }

    if (st.stage === 'structure') {
      // I4, per targets operation 2: on a folder, the layout of targets §3; on Notion, the two databases.
      const draft = need0(d.draft);
      if (docDir) {
        if (!exists(join(docDir, 'questions.md'))) writeTextAtomic(join(docDir, 'questions.md'), '');
        log('item', '«questions.md» · created · the Open Questions list, empty');
        st.stage = 'rows';
        continue;
      }
      const overview = d.ids['overview'] ?? target.address;
      const areas = [...new Set(draft.features.map((f) => f.area))];
      const fdb = call('db:features', CREATE_DB, {
        parent: { page_id: overview },
        title: 'Features',
        schema: featuresDdl(areas),
      });
      if (fdb === null) return wait(owed);
      const f = createdDatabase(fdb);
      if (!f) throw halt(`${CREATE_DB} for Features returned no data source id — ${fdb.slice(0, 200)}`);
      d.ids['features:ds'] = f.ds;
      // Open Questions second: its Touches relation names the Features data source (two-way, synced as Questions).
      const qdb = call('db:questions', CREATE_DB, {
        parent: { page_id: overview },
        title: 'Open Questions',
        schema: questionsDdl(f.ds),
      });
      if (qdb === null) return wait(owed);
      const q = createdDatabase(qdb);
      if (!q) throw halt(`${CREATE_DB} for Open Questions returned no data source id — ${qdb.slice(0, 200)}`);
      d.ids['questions:ds'] = q.ds;
      st.stage = 'verify';
      continue;
    }

    if (st.stage === 'verify') {
      // Re-read, and confirm the structure is there and no existing child was lost — verified, never assumed.
      const pull = pullOf('verify');
      if ('owed' in pull) return wait(pull.owed);
      const tags = databaseTags(pull.snapshot.overview?.content ?? '');
      const fTag = tags.find((t) => t.ds === d.ids['features:ds']);
      const qTag = tags.find((t) => t.ds === d.ids['questions:ds']);
      if (!fTag || !qTag || pull.featuresDs !== d.ids['features:ds'] || pull.questionsDs !== d.ids['questions:ds'])
        throw halt(
          'the re-read does not find both new databases beneath the overview — the structure did not land as created; nothing further is written',
        );
      const lost = databaseTags(d.existing ?? '').filter((t) => !tags.some((x) => x.db === t.db));
      if (lost.length)
        throw halt(`a child the overview held before this run is gone: ${lost.map((t) => t.title).join(', ')}`);
      d.ids['features:db'] = fTag.db;
      d.ids['questions:db'] = qTag.db;
      log(
        'item',
        `«Features» \`${hyphenate(fTag.db)}\` · created · ${new Set(need0(d.draft).features.map((x) => x.area)).size} Area option(s) · read back`,
      );
      log(
        'item',
        `«Open Questions» \`${hyphenate(qTag.db)}\` · created · six Status options, Touches two-way to Features · read back`,
      );
      st.stage = 'views';
      continue;
    }

    if (st.stage === 'views') {
      // The four saved views; one that fails is printed with its exact filter and the error, never a halt (I4).
      let waiting = false;
      for (const v of VIEWS) {
        const r = call(
          `view:${v.name}`,
          CREATE_VIEW,
          {
            database_id: d.ids[`${v.db}:db`] ?? '',
            data_source_id: d.ids[`${v.db}:ds`] ?? '',
            name: v.name,
            type: 'table',
            configure: v.configure,
          },
          true,
        );
        if (r === null) waiting = true;
      }
      if (waiting) return wait(owed);
      d.viewsFailed = VIEWS.filter((v) => d.structure[`view:${v.name}`]?.error).map(
        (v) => `«${v.name}» — ${v.configure} — ${d.structure[`view:${v.name}`]?.error ?? ''}`,
      );
      for (const f of d.viewsFailed) log('CARRIED-FORWARD', `view not created: ${f} · a human adds it in the UI`);
      st.stage = 'rows';
      continue;
    }

    if (st.stage === 'rows') {
      // I5: rows first, then the overview — its ⟳ blocks are views of databases that must exist first.
      const draft = need0(d.draft);
      d.pages ??= { address: {}, name: {}, content: {} };
      d.writes ??= draft.features.map(
        (f, i) =>
          ({
            kind: 'create-feature',
            key: `feature-${i + 1}`,
            stage: 'plan',
            plannedAt: '',
            name: f.name,
            area: f.area,
            whatItDoes: f.whatItDoes,
            body: bodyOf(f, draft, d.cons ?? [], st.runId, date),
            created: date,
          }) satisfies Write,
      );
      const landed = runWrites(d.writes, d.pages, writeEnv(), (): Prepared => ({ error: 'I5 writes no blocks' }), owed);
      for (const l of landed) {
        const w = l.write;
        if (w.kind !== 'create-feature') continue;
        const f = draft.features.find((x) => x.name === w.name);
        log(
          'item',
          `«${w.name}»${w.id && /^[0-9a-f]{32}$/.test(w.id) ? ` \`${hyphenate(w.id)}\`` : ''} · ${w.outcome?.kind === 'landed' ? 'written' : (w.outcome?.kind ?? '')} · created with its body skeleton · ${f?.requirements.length ?? 0} requirement(s) · body ${l.bodyHash ?? '—'}`,
        );
        // The citation lines I6's "never Clean without a cited source" test reads (v21): one per requirement.
        f?.requirements.forEach((r, i) =>
          log('citation', `matched «${w.name}» FR-${i + 1} ← ${r.cite.source} ${r.cite.at}`),
        );
      }
      if (owed.calls.length) return wait(owed);
      const failed = d.writes.filter((w) => w.outcome?.kind !== 'landed');
      if (failed.length)
        throw halt(
          `${failed.length} feature row(s) did not land: ${failed.map((w) => (w.kind === 'create-feature' ? `«${w.name}» (${w.outcome?.detail ?? ''})` : w.key)).join(', ')}`,
        );
      st.stage = 'overview';
      continue;
    }

    if (st.stage === 'overview') {
      const blocks = blocksNow();
      // doc-shape §3's first-write carve-out attaches to the words on disk: the skeleton the human confirmed at I3.
      const onDisk = readTextIfExists(join(home, 'sources', st.runId, lastSkeleton()?.file ?? '§')) ?? '';
      const unseen = blocks
        .filter((b) => b.heading !== 'Operating')
        .flatMap((b) => b.body.split('\n').map((l) => l.trim()))
        .filter((l) => l && !onDisk.includes(l));
      if (unseen.length)
        throw halt(
          `the overview text is not the text the human confirmed at I3 ("${unseen[0]?.slice(0, 80) ?? ''}") — the first-write carve-out does not apply`,
        );
      if (docDir) {
        const views = localViews(readLocal(docDir, nowIso));
        const prior = (d.existing ?? '').trim();
        const text = [
          ...blocks.slice(0, 4).map((b) => `## ${b.heading}\n${b.body}`),
          `## ⟳ Where things are\n${views.where}`,
          `## ⟳ Open questions\n${views.open}`,
          ...blocks.slice(4).map((b) => `## ${b.heading}\n${b.body}`),
          ...(prior ? [`## Kept from the page as it was\n${prior}`] : []),
        ].join('\n\n');
        writeTextAtomic(join(docDir, 'README.md'), `${text}\n`);
        log(
          'item',
          '«overview» · written once — the four human blocks, the two ⟳ lists, Links and Operating, as confirmed at I3',
        );
        st.stage = 'check';
        continue;
      }
      if (overviewWrite(blocks) === 'owed') return wait(owed);
      log(
        'item',
        `«overview» \`${hyphenate(d.ids['overview'] ?? '')}\` · written once · every child re-emitted, the two databases under their ⟳ headings · read back`,
      );
      st.stage = 'check';
      continue;
    }

    if (st.stage === 'check') {
      // I6 over everything this run wrote, read back from the target — never the draft that was pushed.
      const built = builtRead();
      if ('owed' in built) return wait(built.owed);
      const s = built.snapshot;
      d.pages = pagesOf(s, docDir);
      const draft = need0(d.draft);
      d.written ??= [
        ...s.features.map((f, i) => {
          const df = draft.features.find((x) => x.name === f.name);
          return {
            id: `W${i + 1}`,
            where: `«${f.name}» (created)`,
            page: f.id,
            text: `What it does: ${f.whatItDoes}\n${f.content}`,
            cite: df ? `${df.cite.source} ${df.cite.at}` : '',
          };
        }),
        ...(s.overview
          ? [
              {
                id: `W${s.features.length + 1}`,
                where: '«overview» (written once)',
                page: 'overview',
                text: blocksNow()
                  .map((b) => `## ${b.heading}\n${b.body}`)
                  .join('\n'),
                cite: draft.overview.cites.map((c) => `${c.source} ${c.at}`).join(', '),
              },
            ]
          : []),
      ];
      const items = d.written;
      if (!items.length || st.noSecondDispatch) {
        log(
          'independence',
          'independence: could not be performed — no second dispatch available; every written item is unverified, never Clean',
        );
        st.stage = 'sweep';
        continue;
      }
      const got = need(st, task, owed, 'check', {
        kind: 'faithfulness-checker',
        role: 'faithfulness check (init.md I6)',
        rubric: 'faithfulness-checker.md',
        schema: FaithSchema,
        brief: () =>
          faithBrief({ sources, items, replies: d.replies, directives: draft.directives.map((x) => x.text) }),
        validate: (v) => faithProblems(v, items),
      });
      if (got.kind === 'owed') return wait(owed);
      if (got.kind === 'failed') {
        log(
          'VERDICTS',
          `I6 could not be read twice (${got.reason.slice(0, 160)}) — every written item stands unverified, never Clean`,
        );
        st.stage = 'sweep';
        continue;
      }
      // One automatic retry per Flagged item: a fresh look, the first finding given as data. Then it goes to the human.
      let verdicts = got.value;
      const flagged = verdicts.verdicts.filter((v) => v.verdict === 'Flagged');
      if (flagged.length) {
        const again = items.filter((i) => flagged.some((f) => f.item === i.id));
        const second = need(st, task, owed, 'check-retry', {
          kind: 'faithfulness-checker',
          role: 'faithfulness check, second look at flagged items (init.md I6)',
          rubric: 'faithfulness-checker.md',
          schema: FaithSchema,
          brief: () =>
            `${faithBrief({ sources, items: again, replies: d.replies, directives: [] })}\n\n## A first check flagged these — confirm or overturn each, with your own finding\n${flagged.map((f) => `- ${f.item}: ${f.finding}`).join('\n')}`,
          validate: (v) => faithProblems(v, again),
        });
        if (second.kind === 'owed') return wait(owed);
        if (second.kind === 'done')
          verdicts = {
            ...verdicts,
            verdicts: verdicts.verdicts.map((v) => second.value.verdicts.find((x) => x.item === v.item) ?? v),
          };
      }
      // v21: a numbered requirement with no cited source segment and no marker is never Clean.
      verdicts = {
        ...verdicts,
        verdicts: verdicts.verdicts.map((v) => {
          const it = items.find((i) => i.id === v.item);
          const f = s.features.find((x) => x.id === it?.page);
          const cited = draft.features.find((x) => x.name === f?.name)?.requirements.length ?? 0;
          const written = f?.body.requirements.filter((r) => !r.withdrawn).length ?? 0;
          return v.verdict === 'Clean' && f && written > cited
            ? {
                ...v,
                verdict: 'Unverifiable — outside this brief' as const,
                finding: `${written - cited} requirement(s) carry no citation line — never counted Clean (v21)`,
              }
            : v;
        }),
      };
      d.verdicts = verdicts;
      for (const l of verdictLines(verdicts, items, 'I6')) log('VERDICTS', redact(l, barred));
      const models = taskModels(st);
      log(
        'independence',
        `writer ${models.get('init-drafter')?.join(', ') ?? 'unknown'}, checker ${models.get('faithfulness-checker')?.join(', ') ?? 'unknown'} · each answer collected from its own subagent transcript`,
      );
      d.fixes = fixWrites(verdicts, items);
      st.stage = d.fixes.length ? 'fix' : 'sweep';
      continue;
    }

    if (st.stage === 'fix') {
      const pages = need0(d.pages);
      const landed = runWrites(d.fixes ?? [], pages, writeEnv(), (w, cur) => prepareFix(w, cur), owed);
      for (const l of landed) {
        const w = l.write;
        const outcome = w.outcome?.kind === 'landed' ? 'written' : (w.outcome?.kind ?? '');
        log(
          'item',
          w.kind === 'block'
            ? `«${w.label}» · ${outcome} · ${w.block ?? ''} · faithfulness fix · body ${l.bodyHash ?? '—'}`
            : w.kind === 'create-question'
              ? `«${w.question}»${w.id ? ` \`${w.id}\`` : ''} · ${outcome} · question row created at Open · an overview block proposal, never an in-place fix`
              : w.key,
        );
      }
      if (owed.calls.length) return wait(owed);
      st.stage = 'sweep';
      continue;
    }

    if (st.stage === 'sweep') {
      // I7's content sweep over every field this run wrote and everything it wrote into record/.
      const built = builtRead();
      if ('owed' in built) return wait(built.owed);
      const pages = d.pages ?? pagesOf(built.snapshot, docDir);
      const texts = [
        ...built.snapshot.features.map((f) => `${f.name}\n${f.whatItDoes}\n${pages.content[f.id] ?? f.content}`),
        pages.content['overview'] ?? '',
      ];
      const parsed = parseLog(logText());
      const entry = parsed.entries.find((e) => e.heading.runId === st.runId);
      const entryText = entry ? parsed.physical.slice(entry.start, entry.end).join('\n') : '';
      const findings = [...new Set([...texts.flatMap((t) => scan(t, barred)), ...scan(entryText, barred)])];
      log(
        'SWEEP-NOTE',
        `content rule swept ${built.snapshot.features.length} feature row(s) (Name, What it does, body), the overview and every line of this entry · ${findings.length ? `found ${findings.join(', ')} — named for a human to edit to the role` : '0 findings'}`,
      );
      const markers = texts.reduce((n, t) => n + findMarkers(t).length, 0);
      log('MARKERS', `${markers} minted at I5 and I6, carried for the challenge handoff · 0 removed`);
      st.stage = 'challenge';
      continue;
    }

    if (st.stage === 'challenge') {
      // I7: the handoff, now, in this same entry — Q2 at its delta scale over the bodies that depart from the skeleton.
      const built = builtRead();
      if ('owed' in built) return wait(built.owed);
      const s = built.snapshot;
      const pages = d.pages ?? pagesOf(s, docDir);
      d.pages = pages;
      const departed = (d.fixes ?? []).flatMap((w) =>
        w.outcome?.kind === 'landed' && w.kind === 'block' ? [w.page] : [],
      );
      d.q ??= newQState('delta', [...new Set(departed)]);
      const read: Read = {
        snapshot: s,
        featuresDs: d.ids['features:ds'] ?? null,
        questionsDs: d.ids['questions:ds'] ?? null,
      };
      const out = stepChallenge(d.q, {
        st,
        task,
        owed,
        s,
        read,
        pages,
        targetKind: target.kind,
        ...(docDir ? { docDir } : {}),
        calls: calls(),
        log,
        logText,
        parsedLog: () => parseLog(logText()),
        barred,
        date,
        nowIso,
        home,
      });
      if (out === 'owed') return wait(owed);
      st.stage = 'close';
      continue;
    }

    if (st.stage === 'close') {
      const built = builtRead();
      if ('owed' in built) return wait(built.owed);
      close(built.snapshot);
      st.stage = 'done';
      continue;
    }
    throw halt(`run ${st.runId} is at a stage init does not know: ${st.stage}`);
  }
  throw halt('bp init did not settle in one invocation — run it again');

  // ---- helpers bound to this invocation -----------------------------------------------------------------------------------

  function wait(owed: Owed): ExitCode {
    owed.calls.push(...pending.splice(0));
    saveRunState(path, st);
    printOwed(ctx, args, { owed, command: 'init', header: progress(), stage: st.stage, run: st.runId });
    return EXIT.waiting;
  }

  function progress(): string {
    const at = PHASE[st.stage] ?? 0;
    const labels = [
      'collect',
      'draft and grill',
      'propose',
      'create structure',
      'write',
      'faithfulness check',
      'challenge and finish',
    ];
    return renderProgress({
      command: 'init',
      runId: st.runId,
      sitting: st.sitting,
      phases: labels.map((label, i) => ({
        id: `I${i + 1}`,
        label,
        state: i < at ? 'done' : i === at ? 'now' : 'next',
      })),
      total: d.draft?.features.length ?? 0,
      disposed: (d.writes ?? []).filter((w) => w.stage === 'done').length,
      unit: 'feature rows',
    });
  }

  function need0<T>(v: T | undefined): T {
    if (v === undefined) throw halt(`run ${st.runId} lost its state at ${st.stage} — its run-state file is incomplete`);
    return v;
  }

  function writeEnv(): Parameters<typeof runWrites>[2] {
    return {
      targetKind: target.kind,
      ...(docDir ? { docDir } : {}),
      nowIso,
      calls: calls(),
      featuresDs: d.ids['features:ds'] ?? null,
      questionsDs: d.ids['questions:ds'] ?? null,
    };
  }

  function blocksNow(): { heading: string; body: string }[] {
    return overviewBlocks(need0(d.draft), {
      cons: d.cons ?? [],
      runLog: runLogWebUrl(home),
      register: REGISTER,
      date: localDate(new Date(st.startedAt)),
      runId: st.runId,
    });
  }

  function screenLines(): string[] {
    const draft = need0(d.draft);
    return [
      ...skeletonScreen(draft, {
        cons: d.cons ?? [],
        target: target.kind === 'notion' ? 'Notion' : `a folder of markdown files — ${target.address}`,
        grilled: d.grilled ?? 0,
        blocks: blocksNow(),
      }),
      ...(d.dropped?.length
        ? ['', 'DROPPED — a quote not found in its source, never written:', ...d.dropped.map((x) => `  ${x}`)]
        : []),
      ...(draft.directives.length
        ? [
            '',
            'INSTRUCTIONS FOUND IN THE SOURCES — quoted, obeyed in no part:',
            ...draft.directives.map((x) => `  "${x.text}" (${x.cite.source} ${x.cite.at})`),
          ]
        : []),
    ];
  }

  function lastSkeleton(): Captured | undefined {
    return d.captured.filter((c) => c.name === SKELETON).slice(-1)[0];
  }

  /** A relay pull kept under this run's cache/: `read` before anything is written, `verify` and `built` after. */
  function pullOf(
    name: string,
  ): { snapshot: Snapshot; featuresDs: string | null; questionsDs: string | null } | { owed: Owed } {
    const file = join(home, 'cache', 'runs', st.runId, `pull-${name}.json`);
    let pull = loadPull(file);
    if (!pull) {
      pull = newPull(d.ids['overview'] ?? target.address, nowIso);
      savePull(file, pull);
    }
    if (pull.stage !== 'done' || pull.pending.length) {
      if (!transcripts)
        throw usage(
          'the relay needs the session transcript to read Notion results, and none was found',
          'run inside Claude Code, or pass --transcript <path>',
        );
      const { outcome } = stepPull(pull, transcripts);
      savePull(file, pull);
      // The overview page itself refused: not found, or not connected — a halt, never a retry loop.
      const refused = outcome.errors.find((e) => e.key === 'overview');
      if (refused)
        throw halt(
          name === 'read'
            ? `${SETUP}\nThe connector said: ${refused.text}`
            : `the overview fetch returned an error: ${refused.text}`,
        );
      if (pull.stage !== 'done' || pull.pending.length)
        return {
          owed: { tasks: [], calls: pull.pending.map((x) => ({ tool: x.tool, input: x.input })), waiting: [] },
        };
    }
    return { snapshot: toSnapshot(pull, nowIso), featuresDs: pull.featuresDs, questionsDs: pull.questionsDs };
  }

  /** The Blueprint as built, read back from the target (one pull after the writes; later phases read through `pages`). */
  function builtRead(): { snapshot: Snapshot } | { owed: Owed } {
    if (docDir) {
      const s = readLocal(docDir, nowIso);
      if (s.incomplete.length) throw halt(`the read-back is incomplete:\n  ${s.incomplete.join('\n  ')}`);
      return { snapshot: s };
    }
    const r = pullOf('built');
    if ('owed' in r) return r;
    if (r.snapshot.incomplete.length)
      throw halt(`the read-back is incomplete:\n  ${r.snapshot.incomplete.join('\n  ')}`);
    return { snapshot: r.snapshot };
  }

  /** One structural connector call by key: planned once, its result read from the transcript. `optional` records an
   * error and moves on (a view); otherwise an error halts. Null while the call is owed. */
  function call(key: string, tool: string, input: Record<string, unknown>, optional = false): string | null {
    const rec = (d.structure[key] ??= { tool, input, plannedAt: nowIso });
    if (rec.done) return rec.result ?? '';
    const c = latestCall(calls(), tool, (x) => canonicalJson(x) === canonicalJson(rec.input), rec.plannedAt);
    if (!c?.result) {
      pending.push({ tool, input: rec.input });
      return null;
    }
    if (c.result.isError && !optional) throw halt(`${tool} returned an error: ${c.result.text.slice(0, 300)}`);
    if (c.result.isError) rec.error = c.result.text.replace(/\s+/g, ' ').slice(0, 200);
    rec.done = true;
    rec.result = c.result.text;
    return rec.result;
  }

  /** The overview's one sanctioned first write (doc-shape §3): fetch, replace re-emitting every child, read back. */
  function overviewWrite(blocks: { heading: string; body: string }[]): 'owed' | 'done' {
    const page = normaliseId(d.ids['overview'] ?? target.address);
    const fetchInput = { id: page };
    d.overview ??= { stage: 'fetch', plannedAt: nowIso };
    const ov = d.overview;
    const fetched = (after: string): string | null => {
      const c = latestCall(
        calls(),
        CONNECTOR.fetch,
        (x) =>
          typeof x === 'object' && x !== null && 'id' in x && typeof x.id === 'string' && normaliseId(x.id) === page,
        after,
      );
      return c?.result && !c.result.isError ? c.result.text : null;
    };
    if (ov.stage === 'fetch') {
      const text = fetched(ov.plannedAt);
      const current = text ? parseFetch(text) : null;
      if (!current) {
        pending.push({ tool: CONNECTOR.fetch, input: fetchInput });
        return 'owed';
      }
      if (current.truncated)
        throw halt('the overview fetch came back truncated — nothing is written over a page not read whole');
      // Every child is re-emitted: the two databases under their ⟳ headings, and everything else the page held kept
      // below, foreign children included — a human's text is never clobbered, and no child is deleted.
      const tags = databaseTags(current.content);
      const fTag = tags.find((t) => t.ds === d.ids['features:ds'])?.tag ?? '';
      const qTag = tags.find((t) => t.ds === d.ids['questions:ds'])?.tag ?? '';
      if (!fTag || !qTag) throw halt('the overview no longer names both databases — nothing is written');
      let kept = current.content;
      for (const t of [fTag, qTag]) kept = kept.replace(t, '');
      kept = kept.replace(/\n{3,}/g, '\n\n').trim();
      ov.content = [
        ...blocks.slice(0, 4).map((b) => `## ${b.heading}\n${b.body}`),
        `## ⟳ Where things are\n${fTag}`,
        `## ⟳ Open questions\n${qTag}`,
        ...blocks.slice(4).map((b) => `## ${b.heading}\n${b.body}`),
        ...(kept ? [`## Kept from the page as it was\n${kept}`] : []),
      ].join('\n\n');
      ov.stage = 'write';
      ov.plannedAt = nowIso;
    }
    // No allow_deleting_content: a child the new text failed to name makes the call fail rather than vanish.
    const replace = { page_id: page, command: 'replace_content', allow_async: false, new_str: ov.content ?? '' };
    if (ov.stage === 'write') {
      const c = latestCall(calls(), CONNECTOR.update, (x) => canonicalJson(x) === canonicalJson(replace), ov.plannedAt);
      if (!c?.result) {
        pending.push({ tool: CONNECTOR.update, input: replace });
        return 'owed';
      }
      if (c.result.isError) throw halt(`the overview write returned an error: ${c.result.text.slice(0, 300)}`);
      ov.stage = 'readback';
      ov.plannedAt = nowIso;
    }
    const back = fetched(ov.plannedAt);
    const landed = back ? parseFetch(back) : null;
    if (!landed) {
      pending.push({ tool: CONNECTOR.fetch, input: fetchInput });
      return 'owed';
    }
    const missing = blocks.filter((b) => !landed.content.includes(`## ${b.heading}`)).map((b) => b.heading);
    const tags = databaseTags(landed.content);
    const lost = databaseTags(d.existing ?? '').filter((t) => !tags.some((x) => x.db === t.db));
    if (missing.length || tags.length < 2 || lost.length)
      throw halt(
        `the overview read-back is missing ${[...missing, ...(tags.length < 2 ? ['a database child'] : []), ...lost.map((t) => t.title)].join(', ')} — nothing further is written; a human looks at the page`,
      );
    return 'done';
  }

  /** I6's verdicts as writes: a narrowing in place (feature bodies only), a removal that leaves a marker, and — on the
   * overview — a proposal row a human accepts, never an in-place fix (doc-shape §3). */
  function fixWrites(verdicts: Faith, items: readonly WrittenItem[]): Write[] {
    const out: Write[] = [];
    const blocks = blocksNow();
    for (const v of verdicts.verdicts) {
      if (
        v.verdict === 'Clean' ||
        v.verdict === 'Unverifiable — outside this brief' ||
        v.verdict === 'Noted — not a claim defect'
      )
        continue;
      const it = items.find((i) => i.id === v.item);
      if (!it) continue;
      const removal = v.verdict !== 'Patched — narrowed';
      const edit = v.edit;
      if (it.page === 'overview') {
        const b = edit ? blocks.find((x) => x.body.includes(edit.old)) : undefined;
        const body =
          b && edit ? b.body.replace(edit.old, removal ? markerText(v.marker ?? v.finding) : edit.new) : null;
        const append = b && body !== null ? proposalText({ runId: st.runId, date, block: b.heading, body }).append : '';
        out.push({
          kind: 'create-question',
          key: `overview-${v.item}`,
          stage: 'plan',
          plannedAt: '',
          question: b
            ? `Should the overview's «${b.heading}» block say only what its source says?`
            : 'The overview says more than its sources — which of its claims stands?',
          status: 'Open',
          whyAsked: `The faithfulness check (${date}) found the overview departs from its source: ${redact(v.finding, barred)} The front door is never fixed in place: set this row to Answered to accept the proposed block text below as it stands, or write your own under a "## ${b?.heading ?? 'block'}" line in Answer & why. · depth 1${append ? `\n\n${append}` : ''}`,
          touches: [],
          created: date,
        });
        continue;
      }
      if (!edit) continue;
      out.push({
        kind: 'block',
        key: `fix-${v.item}`,
        stage: 'plan',
        plannedAt: '',
        page: it.page,
        label: it.where.replace(/^«/, '').replace(/» \(created\)$/, ''),
        spec: {
          block: edit.block,
          old: edit.old,
          new: removal ? markerText(v.marker ?? v.finding) : edit.new,
          prov: removal ? '' : narrowingLine(date, v.finding),
        },
      });
    }
    return out;
  }

  function close(built: Snapshot): void {
    const draft = need0(d.draft);
    const pages = d.pages ?? pagesOf(built, docDir);
    // The Blueprint as it stands now: the read-back with every later write of this run applied.
    const s: Snapshot = {
      ...built,
      features: built.features.map((f) =>
        pages.content[f.id] !== undefined && pages.content[f.id] !== f.content
          ? makeFeature({ ...f, content: pages.content[f.id] ?? f.content })
          : f,
      ),
      overview:
        built.overview && pages.content['overview'] !== undefined
          ? makeOverview(built.overview.id, pages.content['overview'], built.overview.databases)
          : built.overview,
    };
    // I7: regenerate the local ⟳ lists from the rows as they now stand — a check they still match, not a second act.
    if (docDir) {
      const readme = readTextIfExists(join(docDir, 'README.md')) ?? '';
      const next = regenerateLocalViews(readme, readLocal(docDir, nowIso));
      if (next !== null) writeTextAtomic(join(docDir, 'README.md'), next);
    }
    // The conservation check: every CON-k from I2 resolves to exactly one disposition, or the close halts naming it.
    const cons = d.cons ?? [];
    const settled = settledCons(draft, cons);
    const markers = [
      ...s.features.flatMap((f) => findMarkers(f.content).map((m) => ({ where: `«${f.name}»`, inner: m.inner }))),
      ...findMarkers(s.overview?.content ?? '').map((m) => ({ where: 'the overview', inner: m.inner })),
    ];
    const parsed = parseLog(logText());
    const entry = parsed.entries.find((e) => e.heading.runId === st.runId);
    const discards = entry?.lines.filter((l) => l.kind === 'discard').map((l) => l.text) ?? [];
    const reply = d.captured.filter((x) => x.name === REPLY).slice(-1)[0]?.file ?? REPLY;
    const lines: { id: string; text: string }[] = [];
    const orphans: string[] = [];
    for (const c of cons) {
      const re = new RegExp(`\\b${c.id}\\b`);
      const m = markers.find((x) => re.test(x.inner.split('→')[0] ?? ''));
      const link = m ? markerLink(m.inner) : null;
      const disposition = settled.has(c.id)
        ? `closed by the human's answer at I3 (sources/${st.runId}/${reply})`
        : link?.kind === 'question'
          ? `→ ${link.key ?? link.id} · routed at this sitting, ${date}`
          : m
            ? `carried marker on ${m.where} citing ${c.id}, ${date}`
            : discards.some((t) => re.test(t))
              ? `discarded at Q3, ${date}, the quote logged`
              : '';
      if (!disposition) orphans.push(c.id);
      lines.push({
        id: c.id,
        text: `${redact(c.entity, barred)} · ${c.a.source} ${c.a.at} vs ${c.b.source} ${c.b.at} · quotes at sources/${st.runId}/contradictions.md · ${disposition || 'NO DISPOSITION'}`,
      });
    }
    writeContradictions(cons);
    for (const l of lines) log(l.id, l.text);
    if (orphans.length)
      throw halt(
        `${orphans.join(', ')} ${orphans.length === 1 ? 'has' : 'have'} no disposition — the conservation check halts the close (init.md I7); the entry stays open`,
      );
    if (entry && itemHashes(entry).size) log('HASHES', formatHashesRollup(entry));
    const areas = [...new Set(s.features.map((f) => f.area))];
    const linked = markers.filter((m) => markerLink(m.inner).kind === 'question').length;
    const carried = markers.filter((m) => markerLink(m.inner).kind === 'carried').length;
    log(
      'COUNTS',
      `features ${s.features.length} = ${areas.map((a) => `${a} ${s.features.filter((f) => f.area === a).length}`).join(' + ') || '0'}; markers ${markers.length} = linked ${linked} + carried ${carried} + other ${markers.length - linked - carried}; contradictions ${cons.length} = settled at I3 ${settled.size} + open ${cons.length - settled.size}`,
    );
    logLine(
      home,
      COMMAND,
      st.runId,
      'COST',
      `dispatches ${st.dispatches} · wall-clock from ${st.sittingStartedAt} to ${ctx.clock.now().toISOString()} (self-reported, not recountable)`,
    );
    const questions =
      (d.q?.writes ?? []).filter((w) => w.kind === 'create-question' && w.outcome?.kind === 'landed').length +
      (d.fixes ?? []).filter((w) => w.kind === 'create-question' && w.outcome?.kind === 'landed').length;
    const humanBlocked = questions > 0 || markers.length > 0 || cons.length > settled.size || d.viewsFailed.length > 0;
    log(
      'closing',
      `CLOSED ${localTime(ctx.clock.now())} · ${humanBlocked ? 'HUMAN-BLOCKED' : 'DRAINED'} · run totals: ${s.features.length} feature row(s) · ${questions} question(s) · ${markers.length} marker(s) · ${cons.length} contradiction(s) · 1 sitting`,
    );
    st.entryOpen = false;
    const v = d.verdicts?.verdicts ?? [];
    const count = (k: string): number => v.filter((x) => x.verdict === k).length;
    const models = taskModels(st);
    const notDoing = draft.features.reduce((n, f) => n + f.notDoing.length, 0);
    const notUsed = draft.inventory.filter((x) => x.lands === 'not-used');
    const kept = d.captured.filter((c) => c.name !== SKELETON && c.name !== REPLY);
    st.report = [
      `BLUEPRINT INIT — ${workspace.split('/').pop() ?? ''} · ${date} · target: ${target.kind === 'notion' ? 'Notion' : target.address}`,
      '',
      `Created    ${target.kind === 'notion' ? `2 databases · ${VIEWS.length - d.viewsFailed.length} views · ` : ''}${s.features.length} feature rows · overview written once`,
      `Sources    ${kept.length}${notUsed.length ? ` — ${notUsed.length} segment(s) unused (listed at I3)` : ' — all mapped'}`,
      d.verdicts
        ? `Check      ${count('Clean')} Clean · ${count('Patched — narrowed')} narrowed · ${count('Patched — removed')} removed · ${count('Flagged')} Flagged${count('Unverifiable — outside this brief') ? ` · ${count('Unverifiable — outside this brief')} unverifiable` : ''}${count('Noted — not a claim defect') ? ` · ${count('Noted — not a claim defect')} noted` : ''}`
        : 'Check      could not be performed — every written item is unverified, never Clean',
      d.verdicts
        ? `           independence: writer ${models.get('init-drafter')?.join(', ') ?? 'unknown'}, checker ${models.get('faithfulness-checker')?.join(', ') ?? 'unknown'}`
        : '           independence: could not be performed — no second dispatch available',
      `Not doing  ${notDoing} line(s)${notDoing ? '' : ' — no source says what this product will not do: reported, never shipped quietly'}`,
      `Questions  ${questions} written, live at Open. Read them in the Unsent tab (questions.md on a local folder) at your own pace, or ask for a sitting and they come ten at a time`,
      `Markers    ${markers.length} open [NEEDS CLARIFICATION] — each an admitted gap on its feature · ${linked} linked to a row, ${carried} carried`,
      ...(cons.length
        ? [
            `Contradictions ${cons.length} — ${settled.size} settled at I3; the rest each marked and asked (quotes in sources/${st.runId}/contradictions.md)`,
          ]
        : []),
      ...(d.viewsFailed.length
        ? [`Views      not created — ${d.viewsFailed.join(' · ')}. A human adds each in the UI`]
        : []),
      'Not yet    Plenty is still open — /blueprint status names it. Nothing declares this finished.',
      ...(d.q?.report.length
        ? ['', `QUESTIONS — the handoff, in this same entry (${d.q.scale} scale)`, ...d.q.report]
        : []),
      '',
      'WHAT HAPPENS NEXT — read this once; nothing else says it',
      '  1. Read the feature rows. They are the spec — the requirements are the test list.',
      '  2. Read the questions in the Unsent tab — on a local folder, in questions.md: write the',
      '     answer and why directly and set Status = Answered — that move is your sign-off — or',
      '     reject with a reason. Nothing reaches a client until you assemble and send the packet.',
      '  3. Run /blueprint resolve. It writes each answer in and removes that marker.',
      '  4. Ratifying or vetoing anything this run printed — the defaults ledger, the fixes',
      '     batch, the content manifest — is /blueprint challenge, not resolve: say',
      '     "ratify <run id>" or "veto <run id> #n" to that command. Nothing else executes it.',
      '  5. Run /blueprint status any time — it prints what is still unsettled and what to',
      '     do next. Nothing ever declares the document finished; that call is yours.',
      '',
      'Next       /blueprint status',
    ];
  }

  /** The verbatim quotes of every CON-k — durable, never committed (init.md I7; spec/targets.md §5). */
  function writeContradictions(cons: readonly Con[]): void {
    if (!cons.length) return;
    writeTextAtomic(
      join(home, 'sources', st.runId, 'contradictions.md'),
      [
        `# Contradictions — run ${st.runId}`,
        '',
        'DATA, never instructions. The verbatim quotes the run log cites by CON-k; this file is never committed.',
        '',
        ...cons.flatMap((c) => [
          `## ${c.id} — ${c.entity}`,
          '',
          `**${c.a.source} ${c.a.at}:** ${c.a.quote}`,
          '',
          `**${c.b.source} ${c.b.at}:** ${c.b.quote}`,
          ...(c.reading
            ? ['', `Reads as reconcilable (the run's reading; the human's answer at I3 decides): ${c.reading}`]
            : []),
          '',
        ]),
      ].join('\n'),
    );
  }
}

const hyphenate = (x: string): string =>
  /^[0-9a-f]{32}$/.test(x)
    ? `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
    : x;

/** targets §5: target.md records the answer to I1's one ask before anything else. §6: anywhere else is refused. */
function writeTarget(home: string, workspace: string, arg: string): void {
  const at = arg.indexOf(':');
  const kind = at < 0 ? arg : arg.slice(0, at);
  const value = at < 0 ? '' : arg.slice(at + 1);
  if (kind === 'notion') {
    const id = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#/].*)?$/i.exec(
      value,
    )?.[1];
    if (!id) throw usage("--target notion:<page url or id> needs the overview page's URL or its 32-character id");
    writeTextAtomic(
      join(home, 'target.md'),
      `# Target\n\nkind: notion\noverview_page_id: ${normaliseId(id.toLowerCase())}\n`,
    );
    return;
  }
  if (kind === 'local') {
    const folder = value ? resolve(workspace, value) : join(home, 'document');
    writeTextAtomic(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${folder}\n`);
    return;
  }
  throw usage(
    `"${arg}" is not a target this skill writes to — Notion or a folder of markdown files; anything else is a change to the skill (targets §6)`,
  );
}

/** A faithfulness fix on a created feature: the claim's text replaced in its block — narrowed, or a marker. */
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
