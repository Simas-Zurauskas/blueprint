import { kindsFor, RUNS_ONLY_KINDS, STOP_REASONS, WRITE_COMMANDS, type WriteCommand } from '../domain/vocab.ts';
import { checkCounts, itemHashes, readFunnel } from './lines.ts';
import type { ParsedEntry, ParsedLog } from './parse.ts';

// `bp log validate` — the checks resolve.md R5 and status.md C10 make of the record, done by code. Entries written before
// bp (skill < 38) are read under the rules of their day: a FORMAT finding on one is `legacy`, never an error. Arithmetic
// is not a format — a count that does not add up was wrong in every version, so it is an error on any entry (C10).

export const FIRST_BP_VERSION = 38;

export interface Finding {
  runId: string;
  sitting: number | null;
  line: number;
  severity: 'error' | 'legacy';
  message: string;
}

const isWriteCommand = (c: string): c is WriteCommand => (WRITE_COMMANDS as readonly string[]).includes(c);

export function validateEntry(entry: ParsedEntry): Finding[] {
  const out: Finding[] = [];
  const legacy = (entry.heading.version ?? 0) < FIRST_BP_VERSION;
  const push = (line: number, message: string, arithmetic = false): void => {
    out.push({
      runId: entry.heading.runId,
      sitting: entry.heading.sitting,
      line,
      severity: legacy && !arithmetic ? 'legacy' : 'error',
      message,
    });
  };
  const command = entry.heading.command;
  const admitted = isWriteCommand(command) ? kindsFor(command) : null;
  if (!admitted) push(entry.headingLine, `"${command}" is not a write command`);

  for (const l of entry.lines) {
    if (l.format === 'prose') {
      push(l.lineNo, `a line with no kind: "${l.text.slice(0, 60)}"`);
      continue;
    }
    if (l.kind === null) {
      push(l.lineNo, `"${l.token ?? ''}" is not on R5's closed list of line kinds`);
      continue;
    }
    if (l.caseMismatch) push(l.lineNo, `"${l.token ?? ''}" differs in case from the closed list's "${l.kind}"`);
    if (admitted && !admitted.has(l.kind)) push(l.lineNo, `"${l.kind}" is not a kind a ${command} entry admits`);
    if (l.kind !== 'check' && RUNS_ONLY_KINDS.has(l.kind))
      push(l.lineNo, `"${l.kind}" belongs in record/runs/, not the log (R5)`);
    if (l.kind === 'check' && !/reconcil/i.test(l.text))
      push(l.lineNo, '"check" belongs in record/runs/, except R1\'s version-reconciliation line (R5)');
    if (l.kind === 'COUNTS') {
      const c = checkCounts(l.text);
      c.mismatches.forEach((m) => push(l.lineNo, `COUNTS: ${m}`, true));
      if (!legacy)
        c.bare.forEach((b) =>
          push(l.lineNo, `COUNTS: "${b.slice(0, 50)}" is a bare total — R5: each count carries its addends`),
        );
    }
    if (l.kind === 'closing') {
      if (!/^(?:CLOSED|PAUSED)\b/.test(l.text))
        push(l.lineNo, 'a closing line reads CLOSED hh:mm or PAUSED …, nothing else (R5)');
      const reason = /^(?:CLOSED|PAUSED)\b[^·]*(?:·\s*([A-Z-]+))?/.exec(l.text)?.[1];
      if (
        /^CLOSED\b/.test(l.text) &&
        !/\(crashed\)/.test(l.text) &&
        (!reason || !(STOP_REASONS as readonly string[]).includes(reason))
      ) {
        push(l.lineNo, `a CLOSED line names no stop reason from R5's closed list (${STOP_REASONS.join(', ')})`);
      }
      if (/^PAUSED\b/.test(l.text) && reason && (STOP_REASONS as readonly string[]).includes(reason)) {
        push(
          l.lineNo,
          `a PAUSED line names the stop reason ${reason} — only the last sitting's CLOSED line carries one (R5)`,
        );
      }
    }
  }

  const hashes = itemHashes(entry);
  for (const l of entry.lines.filter((x) => x.kind === 'HASHES')) {
    for (const m of l.text.matchAll(/«([^»]+)»\s+([0-9a-f]{12})/g)) {
      const [, feature = '', value = ''] = m;
      const fromItems = hashes.get(feature);
      const fresh = new RegExp(
        `«${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}»\\s+${value}\\s*\\((?:computed fresh|fresh|re-baseline)`,
      ).test(l.text);
      if (fromItems === undefined && !fresh)
        push(
          l.lineNo,
          `HASHES names «${feature}», which no item line in this entry carries a hash for — a value computed fresh is marked "(computed fresh)" (R5)`,
        );
      else if (fromItems !== undefined && fromItems !== value)
        push(
          l.lineNo,
          `HASHES «${feature}» ${value} disagrees with the item line's ${fromItems} — the disagreement is the finding (R5)`,
          true,
        );
    }
  }

  // The funnel's `discarded` term counts every candidate that ended discarded: its discard lines, and the demotion
  // lines whose disposition check ended DISCARD (challenge.md Q4 — a demotion to a default is not a discard).
  const discards = entry.lines.filter(
    (l) => l.kind === 'discard' || (l.kind === 'demotion' && /\bDISCARD\b/.test(l.text)),
  ).length;
  for (const l of entry.lines.filter((x) => x.kind === 'funnel')) {
    const f = readFunnel(l.text);
    if (!f) {
      if (!legacy)
        push(l.lineNo, 'a funnel line bp cannot read — it states drafted and discarded counts (challenge.md Q4)');
      continue;
    }
    if (f.outcomes !== f.drafted)
      push(l.lineNo, `funnel: ${f.drafted} drafted but outcomes sum to ${f.outcomes}`, true);
    if (f.discarded !== discards)
      push(
        l.lineNo,
        `funnel claims ${f.discarded} discarded; the entry carries ${discards} discard lines (status C10)`,
        true,
      );
  }
  return out;
}

export function validateLog(log: ParsedLog, opts: { runId?: string } = {}): Finding[] {
  return log.entries.filter((e) => !opts.runId || e.heading.runId === opts.runId).flatMap(validateEntry);
}
