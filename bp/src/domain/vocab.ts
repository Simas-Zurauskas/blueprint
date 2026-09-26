// Every closed list the skill defines, written once (type-safety §6). The prose files are the source of truth for what
// the lists mean; `test/vocab.test.ts` checks these arrays against the prose so the two cannot drift.

export const COMMANDS = ['init', 'add', 'challenge', 'resolve', 'status'] as const;
export type Command = (typeof COMMANDS)[number];
export const WRITE_COMMANDS = ['init', 'add', 'challenge', 'resolve'] as const;
export type WriteCommand = (typeof WRITE_COMMANDS)[number];
/** The command's name before v42 (SKILL.md, below the command table): an invocation, a `--command` value or a run-log
 * heading that uses it means the command it names now. The log is never rewritten, so the old name stays readable. */
const LEGACY_COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([['questions', 'challenge']]);
/** A command name as written, read as the name it has now. */
export const canonicalCommand = (name: string): string => LEGACY_COMMANDS.get(name) ?? name;

/** add.md `## Two modes`: printed as the modifier a human types, never `default` (run-progress §1). */
export const MODES = ['force', 'soft'] as const;
export type Mode = (typeof MODES)[number];

/** databases.md §3 — the frozen vocabulary of six. */
export const STATUSES = ['Open', 'Answered', 'Applied', 'Flagged', 'Closed (not applied)', 'Rejected'] as const;
export type Status = (typeof STATUSES)[number];

/** resolve.md R5 — the closed list of stop reasons. */
export const STOP_REASONS = ['DRAINED', 'HUMAN-BLOCKED', 'DEGRADED', 'TARGET', 'INTERRUPTED'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** doc-shape.md §5 — the feature body's five blocks, in order. */
export const FEATURE_BLOCKS = ['Why', 'Behaviour', 'Edge cases', 'Rabbit holes', 'Not doing'] as const;
export type FeatureBlock = (typeof FEATURE_BLOCKS)[number];

/** doc-shape.md §3 — the overview's human blocks (the two ⟳ views are not blocks a run writes). */
export const OVERVIEW_BLOCKS = [
  'TL;DR',
  'What this product is',
  "Who it's for",
  'How it works, in one picture',
  'Links',
  'Operating',
] as const;
export type OverviewBlock = (typeof OVERVIEW_BLOCKS)[number];

/** run-progress.md §1 — the five states of a progress-block line. */
export const PROGRESS_STATES = ['done', 'now', 'next', 'blocked', 'skipped'] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];

// ---- the run log's closed list of line kinds (resolve.md R5) --------------------------------------------------------

/** Kinds every write command may write. */
export const CORE_KINDS = [
  'header',
  'independence',
  'check',
  'item',
  'FLAGGED',
  'MARKERS',
  'GATE',
  'SWEEP',
  'SWEEP-NOTE',
  'COUNTS',
  'HASHES',
  'directive',
  'RATIFIED',
  'VETOED',
  'citation',
  'CARRIED-FORWARD',
  'DEVIATIONS',
  'NOTE',
  'COST',
  'closing',
  'group heading',
] as const;
/** init and add add these (resolve.md R5, "More belong to single commands"). `CON` stands for every `CON-<k>`. */
export const INIT_ADD_KINDS = ['CON', 'VERDICTS', 'discard'] as const;
/** challenge adds these. `ledger`, `fix` and `manifest` stand for `<kind> <run id> #<n>`. */
export const CHALLENGE_KINDS = ['ledger', 'fix', 'manifest', 'demotion', 'discard', 'funnel', 'GRILL'] as const;

export const LOG_KINDS = [
  ...CORE_KINDS,
  'CON',
  'VERDICTS',
  'discard',
  'ledger',
  'fix',
  'manifest',
  'demotion',
  'funnel',
  'GRILL',
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/** Which kinds a command's entry admits. init and add embed a challenge run (run-progress §1a), so they admit its kinds. */
export function kindsFor(command: WriteCommand): ReadonlySet<LogKind> {
  const set = new Set<LogKind>(CORE_KINDS);
  if (command === 'init' || command === 'add') {
    INIT_ADD_KINDS.forEach((k) => set.add(k));
    CHALLENGE_KINDS.forEach((k) => set.add(k));
  }
  if (command === 'challenge') CHALLENGE_KINDS.forEach((k) => set.add(k));
  return set;
}

/** Kinds that go to `record/runs/<run-id>.md` and not the log — R5's *(→ `runs/`)* column. */
export const RUNS_ONLY_KINDS: ReadonlySet<LogKind> = new Set<LogKind>(['check', 'DEVIATIONS', 'COST', 'group heading']);

/** R5's DEVIATIONS classes. */
export const DEVIATION_CLASSES = [
  'brief-violation',
  'label-normalised',
  'replay-re-anchored',
  'outside-source-discounted',
  'pipeline-silent',
  'dispatch-unavailable',
] as const;

// ---- the shape-change register (SKILL.md) ---------------------------------------------------------------------------

/**
 * Every version bump that changed the target's shape, and the route a run takes across it (resolve.md R1). A version not
 * listed changed no property, option, database or file layout. `test/vocab.test.ts` checks this against SKILL.md's table.
 */
export const SHAPE_REGISTER = [
  {
    version: 13,
    route: 'untouched',
    note: 'Intent select and the approval status survive in the schema; no run touches either',
  },
  {
    version: 16,
    route: 'crossover-note',
    note: 'the run log moved to record/run-log.md; the first local entry opens with a crossover NOTE',
  },
  {
    version: 34,
    route: 'add-property',
    note: 'add the `Why flagged` rich-text property to Open Questions, read back by a fresh schema fetch, one NOTE line',
  },
] as const;
export type RegisterRoute = (typeof SHAPE_REGISTER)[number]['route'];
