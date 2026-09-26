import { usage } from './core/errors.ts';
import { array, integer, object, oneOf, optional, string, type Infer } from './core/schema.ts';
import { MODES, PROGRESS_STATES } from './domain/vocab.ts';

// spec/run-progress.md — the progress block. Five parts, no sixth; five states; exactly one `now` (or a `blocked` in
// its place) while a run is live; the rule-off line's three numbers must add up. Rendering is code so the arithmetic
// is computed, never typed (rule 7).

export const ProgressSchema = object({
  command: string({ min: 1 }),
  runId: string({ min: 1 }),
  sitting: integer({ min: 1 }),
  mode: optional(oneOf(MODES)),
  /** A modifier word the run did not recognise, printed on the header beside the mode it fell back to (add.md). */
  unknownModifier: optional(string({ min: 1, max: 40 })),
  /** An embedded run's own list, printed under the outer header (run-progress §1a). */
  embeddedIn: optional(string()),
  phases: array(
    object({
      state: oneOf(PROGRESS_STATES),
      id: string({ min: 1 }),
      label: string({ min: 1 }),
      note: optional(string()),
    }),
    { min: 1 },
  ),
  total: integer({ min: 0 }),
  disposed: integer({ min: 0 }),
  unit: optional(string()),
});
export type Progress = Infer<typeof ProgressSchema>;

const ORDER: Record<string, number> = { done: 0, skipped: 0, now: 1, blocked: 1, next: 2 };
const MODED = new Set(['add', 'resolve']);

export function renderProgress(p: Progress): string {
  for (const ph of p.phases) {
    for (const [name, v] of [
      ['id', ph.id],
      ['label', ph.label],
      ['note', ph.note ?? ''],
    ] as const) {
      if (/[\r\n]/.test(v))
        throw usage(`a progress line's ${name} is one line — "${v.slice(0, 30)}" carries a newline`);
    }
    if (ph.state === 'blocked' && !ph.note?.trim())
      throw usage(
        `a blocked line names what is in the way, on the same line (run-progress §1) — ${ph.id} names nothing`,
      );
  }
  // The header is the outer run's (run-progress §1a): an embedded block carries its mode, or none where it has none.
  const outer = p.embeddedIn ?? p.command;
  if (MODED.has(outer) && !p.mode)
    throw usage(`${outer} has a mode, and the header prints it — force or soft (run-progress §1)`);
  if (p.mode && !MODED.has(outer)) throw usage(`${outer} has no mode; only add and resolve carry one`);
  if (p.unknownModifier !== undefined && (!p.mode || /[\r\n"]/.test(p.unknownModifier)))
    throw usage('an unrecognised modifier is printed beside the mode the run fell back to, one word, no quotes');
  const live = p.phases.filter((ph) => ph.state === 'now' || ph.state === 'blocked');
  const finished = p.phases.every((ph) => ph.state === 'done' || ph.state === 'skipped');
  if (!finished && live.length !== 1) {
    throw usage(
      `a live progress block has exactly one "now" or "blocked" line — this one has ${live.length} (run-progress §1)`,
    );
  }
  if (p.disposed > p.total)
    throw usage(`disposed (${p.disposed}) exceeds total (${p.total}) — the rule-off line cannot add up`);
  // Phases are listed in run order: finished phases, then the one live phase, then the ones not started.
  for (let i = 1; i < p.phases.length; i++) {
    const a = ORDER[p.phases[i - 1]?.state ?? 'done'] ?? 0;
    const b = ORDER[p.phases[i]?.state ?? 'done'] ?? 0;
    if (b < a)
      throw usage(
        `"${p.phases[i]?.state ?? ''}" ${p.phases[i]?.id ?? ''} follows "${p.phases[i - 1]?.state ?? ''}" — phases are listed in run order (run-progress §1)`,
      );
  }
  const header = [
    `BLUEPRINT ${p.embeddedIn ? `${p.embeddedIn} → ` : ''}${p.command}`,
    `run ${p.runId}`,
    `sitting ${p.sitting}`,
    ...(p.mode ? [`mode: ${p.mode}${p.unknownModifier ? ` — "${p.unknownModifier}" is not a modifier` : ''}`] : []),
  ].join(' · ');
  // run-progress §1's sample: the state in a column of 7 (one space after the two 7-letter states), the note 5 spaces
  // past the longest id-and-label.
  const labelWidth = Math.max(...p.phases.map((ph) => `${ph.id} ${ph.label}`.length)) + 5;
  const rows = p.phases
    .filter((ph) => !finished || ph.state === 'done' || ph.state === 'skipped')
    .map((ph) => {
      const state = ph.state.length >= 7 ? `${ph.state} ` : ph.state.padEnd(7);
      const head = `  ${state}${`${ph.id} ${ph.label}`.padEnd(labelWidth)}`;
      return ph.note && ph.state !== 'next' ? `${head}${ph.note}` : head.trimEnd();
    });
  const unit = p.unit ?? 'queued';
  const rule = `  ————   ${p.total} ${unit} · ${p.disposed} disposed · ${p.total - p.disposed} to go`;
  return [header, ...rows, rule].join('\n');
}
