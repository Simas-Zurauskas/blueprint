import { join } from 'node:path';
import { readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import type { Rand } from '../core/rand.ts';
import { actBatches, readFacts, type Batch } from '../log/facts.ts';
import type { ParsedLog } from '../log/parse.ts';
import type { Snapshot } from '../snapshot.ts';
import type { BlockWrite } from '../engine/writes.ts';
import type { QSpec } from './plan.ts';

// challenge.md Q1 — the executor of a ratification or a veto, and there is no other. A batch act a human names — to this
// run, in their own words — relabels, removes or reverts per ledger line, one RATIFIED or VETOED line each carrying the
// words verbatim. A ratification named to a later run waits for a fresh random sample of the batch's lines and the
// human's answer to it (the spot-check). A number a human gives is resolved against the screen they read, by content.

export interface Act {
  act: 'RATIFIED' | 'VETOED';
  kind: Batch['kind'];
  runId: string;
  lines: number[] | 'all';
}

export function parseAct(words: string): Act[] {
  const act: Act['act'] = /\bveto/i.test(words) ? 'VETOED' : 'RATIFIED';
  return actBatches(words).map((b) => ({ act, ...b }));
}

/** The screen a run printed a batch on: screen number → ledger line, kept so a later veto resolves by content. */
export interface ScreenLine {
  screen: number;
  kind: Batch['kind'];
  run: string;
  n: number;
  text: string;
}

export const screenPath = (home: string, runId: string): string => join(home, 'sources', runId, 'ledger-screen.json');

export function saveScreen(home: string, runId: string, lines: readonly ScreenLine[]): void {
  writeTextAtomic(screenPath(home, runId), `${JSON.stringify(lines, null, 2)}\n`);
}

function loadScreen(home: string, runId: string): ScreenLine[] | null {
  const raw = readTextIfExists(screenPath(home, runId));
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as ScreenLine[]) : null; // written by saveScreen above
  } catch {
    return null;
  }
}

export interface ActPlan {
  /** Ledger lines to act on, resolved. */
  lines: {
    act: Act['act'];
    kind: Batch['kind'];
    run: string;
    n: number;
    text: string;
    screen?: number;
    shownText?: string;
  }[];
  /** Numbers that matched no line by content: nothing executed, named for the human to restate. */
  unmatched: string[];
  /** A ratification named to a later run needs a spot-check first: the sample to hand over. */
  sample?: { run: string; kind: Batch['kind']; lines: { n: number; text: string }[] };
}

/** Resolve an act against the log's batches (and the screen the numbers came from). */
export function resolveAct(o: {
  acts: readonly Act[];
  log: ParsedLog;
  home: string;
  thisRun: string;
  rand: Rand;
  sampled: boolean;
}): ActPlan {
  const facts = readFacts(o.log);
  const out: ActPlan = { lines: [], unmatched: [] };
  for (const a of o.acts) {
    const batch = facts.batches.find((b) => b.kind === a.kind && b.runId === a.runId);
    if (!batch) {
      out.unmatched.push(`no ${a.kind} batch ${a.runId} in the log`);
      continue;
    }
    if (a.lines === 'all') {
      for (const l of batch.lines) out.lines.push({ act: a.act, kind: a.kind, run: a.runId, n: l.n, text: l.text });
    } else {
      const screen = loadScreen(o.home, a.runId);
      for (const num of a.lines) {
        // The number is the one on the human's screen: map it to its line by that line's own content.
        const shown = screen?.find((x) => x.screen === num && x.kind === a.kind && x.run === a.runId);
        const line = shown
          ? batch.lines.find((l) => l.n === shown.n && l.text.includes(shown.text.slice(0, 40)))
          : screen
            ? undefined
            : null;
        if (line === undefined) {
          out.unmatched.push(`${a.kind} ${a.runId} #${num} — matches no line on the screen by content; restate it`);
          continue;
        }
        if (line === null) {
          out.unmatched.push(
            `${a.kind} ${a.runId} #${num} — the screen it was read from is not on this machine, so the number cannot be matched by content; restate it by quoting the line`,
          );
          continue;
        }
        // The mapping is recorded with the sentence the human was looking at — the screen's own line (Q1, v30).
        out.lines.push({
          act: a.act,
          kind: a.kind,
          run: a.runId,
          n: line.n,
          text: line.text,
          screen: num,
          ...(shown ? { shownText: shown.text } : {}),
        });
      }
    }
    // A ratification named to a later run is not executed until that run hands over a fresh sample and has the answer.
    if (a.act === 'RATIFIED' && a.runId !== o.thisRun && !o.sampled && !out.sample) {
      const pool = [...batch.lines];
      const pick: { n: number; text: string }[] = [];
      for (let i = 0; i < Math.min(2, pool.length); i++)
        pick.push(...pool.splice(Math.floor(o.rand.next() * pool.length), 1));
      out.sample = { run: a.runId, kind: a.kind, lines: pick };
    }
  }
  return out;
}

/** The body writes an act owes, per ledger line (Q1): relabel, remove, or revert — and the marker each clears or returns. */
export function actWrites(plan: ActPlan, s: Snapshot, date: string): BlockWrite[] {
  const writes: BlockWrite[] = [];
  let k = 0;
  for (const l of plan.lines) {
    const featureName = /«([^«»]+)»/.exec(l.text)?.[1];
    const f = s.features.find((x) => x.name === featureName);
    if (!f) continue;
    const block = (spec: QSpec): void => {
      writes.push({ kind: 'block', key: `act-${++k}`, stage: 'plan', plannedAt: '', page: f.id, label: f.name, spec });
    };
    if (l.kind === 'defaults') {
      const sentence = /Default \([^)]*\):\s*(.+?)(?: · grounding:|$)/.exec(l.text)?.[1]?.trim() ?? '';
      const bodyLine = f.content
        .split('\n')
        .find((x) => x.includes('ratify on review') && sentence && x.includes(sentence.slice(0, 40)));
      if (!bodyLine) continue;
      const blockName = f.body.blocks.find((b) => b.raw.includes(bodyLine))?.name ?? 'Behaviour';
      if (l.act === 'RATIFIED') {
        block({
          type: 'replace',
          block: blockName,
          old: bodyLine,
          new: bodyLine
            .replace(/— ratify on review\)/, `— ratified ${date})`)
            .replace(/ratify on review\)/, `ratified ${date})`),
          prov: '',
        });
        block({
          type: 'marker',
          marker: `ledger ${l.run} #${l.n}`,
          to: { remove: `route 6 — ledger ${l.run} #${l.n}, ratified` },
        });
      } else {
        block({ type: 'replace', block: blockName, old: bodyLine, new: '', prov: '' });
        block({ type: 'marker', marker: `ledger ${l.run} #${l.n}`, to: { text: '→ Question: carried' } });
      }
    }
    if (l.kind === 'fixes' && l.act === 'VETOED') {
      const m = /"(.+)" → "(.+)"/.exec(l.text);
      if (m?.[1] && m[2]) {
        const blockName = f.body.blocks.find((b) => b.raw.includes(m[2] ?? ''))?.name ?? 'Behaviour';
        block({
          type: 'replace',
          block: blockName,
          old: m[2],
          new: m[1],
          prov: `*(Reverted ${date} — fix ${l.run} #${l.n} vetoed.)*`,
        });
      }
    }
    if (l.kind === 'slots' && l.act === 'VETOED') {
      const line = f.content
        .split('\n')
        .find((x) => x.startsWith('Content slot — client-supplied:') && l.text.includes(x.slice(33, 80)));
      if (line)
        block({
          type: 'replace',
          block: f.body.blocks.find((b) => b.raw.includes(line))?.name ?? 'Behaviour',
          old: line,
          new: '',
          prov: '',
        });
    }
  }
  return writes;
}
