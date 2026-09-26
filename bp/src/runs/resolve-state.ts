import { join } from 'node:path';
import { listDir, readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import {
  array,
  boolean,
  integer,
  must,
  nullable,
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

// A resolve run's state between invocations (DESIGN.md §3.2). It lives under `sources/<run-id>/` — durable and never
// committed (targets §5) — because it may carry client text (a writer's delta). The run log stays the record; this file is
// only what lets `bp resolve` pick up where the last invocation stopped.

const anyValue = (): Schema<unknown> => ({
  kind: 'unknown',
  parse: (v: unknown) => ({ ok: true, value: v }),
  json: () => ({}),
});

const TaskRefSchema = object({
  id: string(),
  nonce: string(),
  kind: string(),
  prompt: string(),
  brief: string(),
  issuedAt: string(),
});

const ReceiptSchema = object({
  kind: oneOf(['transcript', 'none'] as const),
  file: optional(string()),
  model: optional(string()),
  agentType: optional(string()),
});

export const ITEM_STAGES = ['writer', 'checker', 'staged', 'push', 'children', 'done'] as const;
export const FINALS = ['Applied', 'Flagged', 'requeued'] as const;

const ItemSchema = object({
  /** single: one feature's write · project: R3.1's project-level path · overview-write: round two of the overview route. */
  kind: optional(oneOf(['single', 'project', 'overview-write'] as const)),
  /** A per-feature write the project writer returned: the project item's row id (its Status is the parent's to write). */
  parent: optional(string()),
  /** The delta the project writer returned for this feature — used once, in place of a writer dispatch. */
  preset: optional(anyValue()),
  /** The overview route: the proposed block and its pin (resolve.md R3.1 round one). */
  proposal: optional(object({ block: string(), text: string(), pin: string() })),
  /** Text appended to the row's Why asked with the status write (round one's proposal). */
  whyAskedAppend: optional(string()),
  rowId: string(),
  question: string(),
  feature: nullable(string()),
  band: integer({ min: 1, max: 3 }),
  stage: oneOf(ITEM_STAGES),
  writer: optional(TaskRefSchema),
  writerOut: optional(anyValue()),
  writerRetried: boolean(),
  writerRepaired: boolean(),
  checker: optional(TaskRefSchema),
  checkerOut: optional(anyValue()),
  checkerRepaired: boolean(),
  writerReceipt: optional(ReceiptSchema),
  checkerReceipt: optional(ReceiptSchema),
  block: optional(string()),
  /** A seed writes `## Why` through `## Behaviour` as one span. */
  through: optional(string()),
  before: optional(string()),
  after: optional(string()),
  touched: optional(array(string())),
  /** What the delta replaced or removed — both texts, for a Kept objection (R3.6). */
  replaced: optional(array(object({ target: string(), old: string(), new: string() }))),
  verdict: optional(string()),
  objection: optional(string()),
  push: optional(anyValue()),
  bodyHash: optional(string()),
  final: optional(oneOf(FINALS)),
  markersRemoved: optional(array(string())),
  logged: boolean(),
  propsDone: boolean(),
  note: optional(string()),
});
export type ItemState = Infer<typeof ItemSchema>;

const PropWriteSchema = object({
  rowId: string(),
  fields: record(string()),
  plannedAt: string(),
  stage: oneOf(['write', 'readback', 'done'] as const),
  ok: optional(boolean()),
  reason: optional(string()),
});
export type PropWrite = Infer<typeof PropWriteSchema>;

export const RUN_STAGES = ['pull', 'plan', 'work', 'migrate', 'props', 'close', 'done'] as const;

export const ResolveStateSchema = object({
  version: integer({ min: 1, max: 1 }),
  runId: string(),
  mode: oneOf(MODES),
  sitting: integer({ min: 1 }),
  stage: oneOf(RUN_STAGES),
  startedAt: string(),
  sittingStartedAt: string(),
  noSecondDispatch: boolean(),
  /** Rows this run has disposed in earlier sittings — one attempt per row per run (R5). */
  disposed: array(string()),
  items: array(ItemSchema),
  props: array(PropWriteSchema),
  /** A feature's body as this run's last commit left it — the next item on the feature is briefed with it (R3). */
  bodies: record(string()),
  rebaselines: array(object({ feature: string(), hash: string() })),
  notes: array(string()),
  /** Per-sitting miss rates, for DEGRADED (R5). */
  missRates: array(object({ sitting: integer({ min: 1 }), items: integer({ min: 0 }), missed: integer({ min: 0 }) })),
  migration: optional(object({ plannedAt: string(), stage: oneOf(['call', 'confirm', 'done'] as const) })),
  report: array(string()),
  dispatches: integer({ min: 0 }),
  /** Random bytes chosen at run start: every task nonce is salted with them, so no nonce can be predicted or reused. */
  salt: optional(string({ pattern: /^[0-9a-f]{16,64}$/ })),
});
export type ResolveState = Infer<typeof ResolveStateSchema>;

export const statePath = (current: string, runId: string): string =>
  join(current, 'sources', runId, 'resolve-state.json');
export const pullPath = (current: string, runId: string, sitting: number): string =>
  join(current, 'cache', 'runs', runId, `pull-s${sitting}.json`);

export function loadState(path: string): ResolveState | undefined {
  const raw = readTextIfExists(path);
  if (raw === undefined) return undefined;
  return must(ResolveStateSchema, parseJson(raw, path), 'resolve run state');
}

export function saveState(path: string, s: ResolveState): void {
  writeTextAtomic(path, `${JSON.stringify(s, null, 2)}\n`);
}

/** Resolve runs this working folder holds that have not finished — the one a bare `bp resolve` continues. */
export function unfinishedRuns(current: string): string[] {
  return listDir(join(current, 'sources')).filter((id) => {
    const s = readTextIfExists(statePath(current, id));
    if (!s) return false;
    try {
      const parsed = ResolveStateSchema.parse(JSON.parse(s));
      return parsed.ok && parsed.value.stage !== 'done';
    } catch {
      return false;
    }
  });
}
