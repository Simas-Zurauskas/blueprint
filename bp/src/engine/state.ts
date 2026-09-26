import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { listDir, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { sha12, sha256 } from '../core/hash.ts';
import {
  array,
  boolean,
  integer,
  must,
  object,
  oneOf,
  optional,
  parseJson,
  record,
  string,
  type Infer,
  type Schema,
} from '../core/schema.ts';
import { MODES } from '../domain/vocab.ts';
import { recordPaths } from '../log/entry.ts';
import { entryState, parseLog } from '../log/parse.ts';
import type { Collected, TaskSpec } from '../tasks/tasks.ts';
import { collect, nonceFor, writeTask } from '../tasks/tasks.ts';
import type { TranscriptSet } from '../target/transcript.ts';

// The run state shared by add, challenge and init (DESIGN.md §3.2): where a run is, the tasks it has dispatched and what
// came back, the serial write queue, and each command's own working data. It lives under `sources/<run-id>/` — durable,
// never committed — because it carries client text. The run log stays the record; this is only what lets a command pick
// up where the last invocation stopped.

export const anyValue = (): Schema<unknown> => ({
  kind: 'unknown',
  parse: (v: unknown) => ({ ok: true, value: v }),
  json: () => ({}),
});

const TaskRecordSchema = object({
  id: string(),
  nonce: string(),
  kind: string(),
  prompt: string(),
  brief: string(),
  issuedAt: string(),
  attempt: integer({ min: 1 }),
  state: oneOf(['owed', 'done', 'failed'] as const),
  answer: optional(anyValue()),
  model: optional(string()),
  receipt: optional(oneOf(['transcript', 'none'] as const)),
  reason: optional(string()),
});
export type TaskRecord = Infer<typeof TaskRecordSchema>;

export const ENGINE_COMMANDS = ['add', 'challenge', 'init'] as const;

export const RunStateSchema = object({
  version: integer({ min: 1, max: 1 }),
  command: oneOf(ENGINE_COMMANDS),
  runId: string({ pattern: /^[0-9a-f]{6}$/ }),
  mode: optional(oneOf(MODES)),
  /** A modifier word the run did not recognise — printed on the header beside the mode it fell back to (add.md). */
  modeWord: optional(string()),
  /** The command that embeds this run (init or add → challenge), for the progress header (run-progress §1a). */
  embeddedIn: optional(string()),
  sitting: integer({ min: 1 }),
  stage: string(),
  startedAt: string(),
  sittingStartedAt: string(),
  salt: string({ pattern: /^[0-9a-f]{16,64}$/ }),
  dispatches: integer({ min: 0 }),
  noSecondDispatch: boolean(),
  entryOpen: boolean(),
  tasks: record(TaskRecordSchema),
  writes: array(anyValue()),
  data: record(anyValue()),
  notes: array(string()),
  report: array(string()),
});
export type RunState = Infer<typeof RunStateSchema>;

export const runStatePath = (home: string, runId: string): string => join(home, 'sources', runId, 'run-state.json');

export function newRunState(o: {
  command: RunState['command'];
  runId: string;
  nowIso: string;
  mode?: RunState['mode'];
  modeWord?: string;
  noSecondDispatch: boolean;
  embeddedIn?: string;
}): RunState {
  return {
    version: 1,
    command: o.command,
    runId: o.runId,
    ...(o.mode ? { mode: o.mode } : {}),
    ...(o.modeWord ? { modeWord: o.modeWord } : {}),
    ...(o.embeddedIn ? { embeddedIn: o.embeddedIn } : {}),
    sitting: 1,
    stage: 'start',
    startedAt: o.nowIso,
    sittingStartedAt: o.nowIso,
    salt: randomBytes(16).toString('hex'),
    dispatches: 0,
    noSecondDispatch: o.noSecondDispatch,
    entryOpen: false,
    tasks: {},
    writes: [],
    data: {},
    notes: [],
    report: [],
  };
}

export function loadRunState(path: string): RunState | undefined {
  const raw = readTextIfExists(path);
  return raw === undefined ? undefined : must(RunStateSchema, parseJson(raw, path), 'run state');
}

export function saveRunState(path: string, st: RunState): void {
  writeTextAtomic(path, `${JSON.stringify(st, null, 2)}\n`);
}

/**
 * Unfinished runs of one command in this working folder — the one a bare invocation continues. The log is the durable
 * record of a run's state (SKILL.md pre-flight 4): a run with a CLOSED entry is finished, whatever its state file says —
 * a run stopped with `bp log close` never reaches the stage that marks its state file done.
 */
export function unfinishedRunsOf(home: string, command: RunState['command']): string[] {
  const log = readTextIfExists(recordPaths(home).log);
  const closed = new Set(
    log === undefined
      ? []
      : parseLog(log)
          .entries.filter((e) => entryState(e) === 'closed')
          .map((e) => e.heading.runId),
  );
  return listDir(join(home, 'sources')).filter((id) => {
    if (closed.has(id)) return false;
    const raw = readTextIfExists(runStatePath(home, id));
    if (!raw) return false;
    try {
      const r = RunStateSchema.parse(JSON.parse(raw));
      return r.ok && r.value.command === command && r.value.stage !== 'done';
    } catch {
      return false;
    }
  });
}

// ---- tasks ------------------------------------------------------------------------------------------------------------------

export interface TaskOwed extends TaskSpec {
  issuedAt: string;
}

export interface Owed {
  tasks: TaskOwed[];
  calls: { tool: string; input: Record<string, unknown> }[];
  waiting: string[];
}

export const emptyOwed = (): Owed => ({ tasks: [], calls: [], waiting: [] });

export interface TaskEnv {
  home: string;
  skillRoot: string;
  nowIso: string;
  transcripts: TranscriptSet | null;
}

export type Need<T> =
  | { kind: 'done'; value: T; model?: string; receipt: 'transcript' | 'none' }
  /** Failed twice. Where the second answer parsed and only its content was refused, it is kept: the caller may use its sound parts. */
  | { kind: 'failed'; reason: string; value?: T }
  | { kind: 'owed' };

/**
 * One judgment task by its logical key: dispatched once (a unique id, brief and nonce per dispatch), collected from the
 * subagent's own transcript, repaired once when its answer cannot be read, then failed. `done` answers are kept in the
 * state, so a resumed run never re-dispatches a task it already has.
 */
export function need<T>(
  st: RunState,
  env: TaskEnv,
  owed: Owed,
  key: string,
  spec: {
    kind: string;
    role: string;
    rubric: string;
    schema: Schema<T>;
    brief: () => string;
    /** A check of the answer's content the schema cannot make (a quote that must be found, a name that must exist): a
     * problem named here sends the task back once, then fails it. */
    validate?: (value: T) => string | null;
  },
): Need<T> {
  const rec = st.tasks[key];
  if (rec?.state === 'done') {
    const parsed = spec.schema.parse(rec.answer);
    if (parsed.ok)
      return {
        kind: 'done',
        value: parsed.value,
        ...(rec.model ? { model: rec.model } : {}),
        receipt: rec.receipt ?? 'none',
      };
  }
  if (rec?.state === 'failed') {
    const kept = rec.answer === undefined ? null : spec.schema.parse(rec.answer);
    return { kind: 'failed', reason: rec.reason ?? 'the task failed', ...(kept?.ok ? { value: kept.value } : {}) };
  }
  const issue = (attempt: number, extra?: string): void => {
    const id = `d${String(st.dispatches + 1).padStart(3, '0')}-${spec.kind}-${sha12(sha256(key)).slice(0, 6)}-a${attempt}`;
    const t = writeTask({
      home: env.home,
      runId: st.runId,
      id,
      kind: spec.kind,
      role: spec.role,
      rubric: join(env.skillRoot, 'rubrics', spec.rubric),
      brief: extra
        ? `${spec.brief()}\n\n## Your previous answer could not be used — fix exactly this\n${extra}`
        : spec.brief(),
      schema: spec.schema,
      nonce: nonceFor(st.runId, id, st.salt),
    });
    st.dispatches += 1;
    st.tasks[key] = {
      id: t.id,
      nonce: t.nonce,
      kind: spec.kind,
      prompt: t.prompt,
      brief: t.brief,
      issuedAt: env.nowIso,
      attempt,
      state: 'owed',
    };
    owed.tasks.push({ ...t, issuedAt: env.nowIso });
  };
  if (!rec) {
    issue(1);
    return { kind: 'owed' };
  }
  const got: Collected<T> = collect({ task: rec, schema: spec.schema, transcripts: env.transcripts });
  if (got.ok) {
    const problem = spec.validate?.(got.value) ?? null;
    if (problem) {
      if (rec.attempt >= 2) {
        st.tasks[key] = {
          ...rec,
          state: 'failed',
          reason: problem,
          answer: got.value,
          receipt: got.receipt.kind,
          ...(got.receipt.model ? { model: got.receipt.model } : {}),
        };
        return { kind: 'failed', reason: problem, value: got.value };
      }
      issue(rec.attempt + 1, problem);
      return { kind: 'owed' };
    }
    st.tasks[key] = {
      ...rec,
      state: 'done',
      answer: got.value,
      receipt: got.receipt.kind,
      ...(got.receipt.model ? { model: got.receipt.model } : {}),
    };
    return {
      kind: 'done',
      value: got.value,
      ...(got.receipt.model ? { model: got.receipt.model } : {}),
      receipt: got.receipt.kind,
    };
  }
  if (got.reason === 'not-found') {
    owed.waiting.push(`${spec.kind} (task ${rec.id})`);
    return { kind: 'owed' };
  }
  const problem =
    got.reason === 'invalid'
      ? `your JSON did not match the schema: ${(got.issues ?? []).map((i) => `${i.path} ${i.message}`).join('; ')}`
      : got.reason === 'ambiguous'
        ? 'two different answers came back for this task — answer once, with one JSON object'
        : 'your answer carried no JSON object';
  if (rec.attempt >= 2) {
    st.tasks[key] = { ...rec, state: 'failed', reason: problem };
    return { kind: 'failed', reason: problem };
  }
  issue(rec.attempt + 1, problem);
  return { kind: 'owed' };
}

/** The models that answered this run's tasks, for the independence line. */
export function taskModels(st: RunState): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of Object.values(st.tasks))
    if (t.model) out.set(t.kind, [...new Set([...(out.get(t.kind) ?? []), t.model])]);
  return out;
}
