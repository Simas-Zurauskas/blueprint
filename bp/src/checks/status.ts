import { daysBetween, localDate } from '../core/clock.ts';
import { findMarkers } from '../core/text.ts';
import { hasNumberedRequirement, markerLink } from '../domain/feature.ts';
import { machineLocalPaths } from '../domain/overview.ts';
import type { Question } from '../domain/question.ts';
import { readFacts, ratified, rowIdsIn, sittingsSince, type LogFacts } from '../log/facts.ts';
import type { ParsedLog } from '../log/parse.ts';
import { validateEntry } from '../log/validate.ts';
import { normaliseId } from '../target/notion.ts';
import type { FeatureRec, Snapshot } from '../snapshot.ts';
import { planResolve, queueOf } from '../resolve/plan.ts';
import { contentFindings, redact } from './content.ts';

// status.md S2 — the checks, by code. Each answers "what is wrong with the state", names the thing and the move, and
// invents nothing: an age with no timestamp is "unknown", a check whose input is missing says it could not be computed.
// What only a reader can decide is returned as `residue` for the model (status.md, residue), never guessed here.

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C7' | 'C8' | 'C9' | 'C10' | 'C11';

export interface Line {
  /** `!` could not apply · `x` wrong · `~` waiting or aging. */
  mark: '!' | 'x' | '~';
  text: string;
  /** Every line ends in a move (S3). */
  move: string;
  /** For de-duplication across checks (C7 does not repeat what C1–C5 name). */
  rowId?: string;
  /** Further rows the line names by title (C2's oldest few), for the same de-duplication. */
  rows?: string[];
  /** Printed whatever the five-row cap — the one line a section must end with (C2's Rejected count). */
  pinned?: boolean;
}

export interface Section {
  check: CheckId;
  title: string;
  /** The count printed in the section heading. */
  count: number;
  lines: Line[];
  /** Printed when the check could not be computed (input missing), instead of lines. */
  notComputed?: string;
}

export interface Residue {
  check: CheckId;
  what: string;
  items: number;
}

export interface StatusReport {
  title: string;
  today: string;
  header: string;
  sections: Section[];
  unsettled: string[];
  next: string;
  residue: Residue[];
  clean: boolean;
  incomplete: string[];
}

/** A Created value as an instant: a date-only value (targets §3's local format) is that calendar day where it is read. */
const when = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const age = (fromIso: string | null, today: Date): string => {
  const d = when(fromIso);
  return d ? `${daysBetween(d, today)}d` : 'unknown';
};

const title = (q: Question): string => `«${q.question.length > 70 ? `${q.question.slice(0, 69)}…` : q.question}»`;

const dateOf = (logDate: string): Date => new Date(`${logDate}T12:00:00`);

// ---- C1 — could not apply ---------------------------------------------------------------------------------------------

function c1(s: Snapshot, facts: LogFacts | null, today: Date): Section {
  const flagged = s.questions.filter((q) => q.status === 'Flagged');
  const lines: Line[] = flagged.map((q) => {
    // The newest FLAGGED line naming this row — by id, by q-NN key, or by its (possibly shortened) title.
    const flag = facts?.flags.find(
      (f) =>
        f.rowId === normaliseId(q.id) ||
        f.rowId === q.id ||
        (q.key !== undefined && f.rowId === q.key) ||
        (f.title !== null && titleMatches(f.title, q.question)),
    );
    const objection = flag?.objection ?? q.whyFlagged;
    const differs =
      flag && q.whyFlagged && q.whyFlagged.trim() !== flag.objection.trim()
        ? " · the row's Why flagged differs from the log's FLAGGED line — the log wins"
        : '';
    return {
      mark: '!',
      rowId: q.id,
      text: `${title(q)}   Flagged ${flag ? `${daysBetween(dateOf(flag.date), today)}d` : 'age unknown (no FLAGGED line)'}${differs}${objection ? `\n      ${objection.slice(0, 220)}` : ''}`,
      move: 'fix what the objection names, then set the row back to Answered',
    };
  });
  return {
    check: 'C1',
    title: 'COULD NOT APPLY — a run tried and could not, or soft mode was told not to',
    count: lines.length,
    lines,
  };
}

// ---- C2 — unsent questions ----------------------------------------------------------------------------------------------

function c2(s: Snapshot, today: Date): Section {
  const open = s.questions.filter((q) => q.status === 'Open');
  const answeredButOpen = open.filter((q) => q.answer.trim());
  const waiting = open.filter((q) => !q.answer.trim()).sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
  const lines: Line[] = answeredButOpen.map((q) => ({
    mark: 'x',
    rowId: q.id,
    text: `${title(q)}   Open, but Answer & why is filled in — invisible to every other check`,
    move: 'set it to Answered',
  }));
  if (waiting.length) {
    // The oldest few, each with its Why asked — the only context an Open row carries to someone not in the room.
    // A row past 14 days says so here: C7 does not repeat a row this section names (status.md C7).
    const oldest = waiting.slice(0, 3);
    const about = (q: Question): string => {
      const d = when(q.created);
      const stale =
        d !== null && daysBetween(d, today) > 14 ? ' · past 14 days, nobody has answered or rejected it' : '';
      return `${stale}${q.whyAsked.trim() ? ` · why asked: ${q.whyAsked.trim().replace(/\s+/g, ' ').slice(0, 140)}` : ' · no Why asked'}`;
    };
    const [first, ...more] = oldest;
    lines.push({
      mark: '~',
      text: [
        `${waiting.length} live and unanswered${first ? ` · oldest ${age(first.created, today)} · ${title(first)}${about(first)}` : ''}`,
        ...more.map((q) => `      then ${age(q.created, today)} · ${title(q)}${about(q)}`),
      ].join('\n'),
      move: 'read them in the Unsent tab (questions.md on a local folder) — answer, reject with a reason, or carry into a packet',
      rows: oldest.map((q) => q.id),
    });
  }
  const noWhy = open.filter((q) => !q.whyAsked.trim());
  if (noWhy.length)
    lines.push({
      mark: 'x',
      text: `${noWhy.length} Open row(s) carry no Why asked — they cannot be judged cold: ${noWhy.slice(0, 3).map(title).join(', ')}`,
      move: 'the next challenge run cannot repair a human row; write the gap in Why asked',
    });
  const rejected = s.questions.filter((q) => q.status === 'Rejected').length;
  if (lines.length)
    lines.push({ mark: '~', text: `Rejected so far: ${rejected}`, move: 'nothing to do', pinned: true });
  return { check: 'C2', title: 'UNSENT QUESTIONS — live, unanswered, not yet in a packet', count: open.length, lines };
}

// ---- C3 — will not apply next time (resolve.md R2.1) ------------------------------------------------------------------

function c3(s: Snapshot, log: ParsedLog | null, residue: Residue[]): Section {
  // Exactly what the next resolve's R2 will flag: computed by the same planner, so this screen never predicts a flag the
  // run then does not raise (status.md: never predict what the next run will do).
  const plan = planResolve(s, log);
  // Each objection is "<what is wrong> — <the fix>": the fix is the line's move.
  const lines: Line[] = plan.flags.map((f) => {
    const cut = f.objection.indexOf(' — ');
    const [what, fix] =
      cut > 0 ? [f.objection.slice(0, cut), f.objection.slice(cut + 3)] : [f.objection, MOVE(f.route)];
    return { mark: 'x', rowId: f.row.id, text: `${title(f.row)}   ${what}`, move: fix };
  });
  const undecided = plan.items.filter(
    (i) => i.reading.kind === 'pointer' && i.reading.slotsFilled === 'undecided',
  ).length;
  if (undecided)
    residue.push({
      check: 'C3',
      what: 'pointers at a direction with a <value> slot — whether the extra words fill it',
      items: undecided,
    });
  return {
    check: 'C3',
    title: 'WILL NOT APPLY NEXT TIME — the next resolve ends these Flagged',
    count: lines.length,
    lines,
  };
}

const MOVE = (route: string): string =>
  route === 'R2.3'
    ? 'look at the edit; moving the row back to Answered vouches for it'
    : route === 'R2.4'
      ? 'a human writes the missing block, then sets the row back to Answered'
      : 'name one direction by its number (and fill any <value> it leaves open), write the decision in a sentence, or repoint Touches';

// ---- C4 — state nothing wrote, and state nothing reconciled -----------------------------------------------------------

function c4(s: Snapshot, facts: LogFacts | null): Section {
  if (!facts)
    return {
      check: 'C4',
      title: 'STATE NOTHING WROTE OR RECONCILED',
      count: 0,
      lines: [],
      notComputed: 'no readable run log on this machine — Applied rows nothing wrote could not be checked',
    };
  const lines: Line[] = [];
  const applied = s.questions.filter((q) => q.status === 'Applied');
  for (const cf of facts.carriedForward) {
    if (!/\bverdict|returned after|late\b/i.test(cf.text)) continue;
    for (const q of applied.filter((x) => namesRow(cf.text, x))) {
      lines.push({
        mark: 'x',
        rowId: q.id,
        text: `${title(q)}   Applied, with a late check verdict carried forward (${cf.date}, run ${cf.runId})`,
        move: 'accept the text, or move the row back to Answered',
      });
    }
  }
  const after = facts.crossover;
  for (const q of applied) {
    if (after && q.created && q.created.slice(0, 10) < after) continue;
    const named =
      facts.namedRowIds.has(normaliseId(q.id)) ||
      [q.id, q.key].some((k) => k !== undefined && facts.namedKeys.has(k)) ||
      [...facts.namedTitles].some((t) => titleMatches(t, q.question));
    if (!named)
      lines.push({
        mark: 'x',
        rowId: q.id,
        text: `${title(q)}   Applied, and no run-log entry names it — moved by hand; the document may not say what the row claims`,
        move: 'drag it back to Answered',
      });
  }
  return { check: 'C4', title: 'STATE NOTHING WROTE OR RECONCILED', count: lines.length, lines };
}

/** A log title names a row by its full title, or by R5's shortening — the title cut and closed with an ellipsis. */
const titleMatches = (logged: string, question: string): boolean => {
  if (logged === question) return true;
  const stem = logged.endsWith('…') ? logged.slice(0, -1).trimEnd() : null;
  return stem !== null && stem.length >= 12 && question.startsWith(stem);
};

/** Whether a log line names this row — by its id, its q-NN key, or its title (C4). */
const namesRow = (text: string, q: Question): boolean =>
  rowIdsIn(text).includes(normaliseId(q.id)) ||
  [q.id, q.key].some(
    (k) => k !== undefined && /^q-\d+$/.test(k) && new RegExp(`(?:^|[^\\w-])${k}(?![\\w-])`).test(text),
  ) ||
  [...text.matchAll(/«([^«»]{1,400})»/g)].some((m) => titleMatches(m[1] ?? '', q.question));

// ---- C5 — blocking links -------------------------------------------------------------------------------------------------

function c5(
  s: Snapshot,
  facts: LogFacts | null,
): { section: Section; carried: Map<string, number>; broken: number; awaiting: number; unratifiedBatches: string[] } {
  const lines: Line[] = [];
  const carried = new Map<string, number>();
  let awaiting = 0;
  let broken = 0;
  const all: {
    where: string;
    owner: string;
    inner: string;
    link: FeatureRec['body']['markers'][number]['link'];
    terminated: boolean;
  }[] = [];
  for (const f of s.features)
    for (const m of f.body.markers)
      all.push({
        where: `«${f.name}»${m.fr ? ` FR-${m.fr}` : ` ${m.block}`}`,
        owner: `«${f.name}»`,
        inner: m.inner,
        link: m.link,
        terminated: m.terminated,
      });
  if (s.overview) {
    for (const sec of s.overview.parsed.sections) {
      for (const text of sec.lines) {
        for (const m of findOverviewMarkers(text))
          all.push({
            where: `overview «${sec.heading}»`,
            owner: 'overview',
            inner: m.inner,
            link: m.link,
            terminated: m.terminated,
          });
      }
    }
  }
  for (const m of all) {
    const brokenLine = (why: string, move: string): void => {
      broken += 1;
      lines.push({ mark: 'x', text: `${m.where} marker — ${why}`, move });
    };
    if (!m.terminated) {
      brokenLine('its brackets never close', 'close the marker so it names its row');
      continue;
    }
    switch (m.link.kind) {
      case 'none':
        brokenLine('names no question row', 'point it at its row, or mark it carried');
        break;
      case 'pending':
        brokenLine('reads "→ Question: pending", which names neither state', 'point it at its row, or mark it carried');
        break;
      case 'carried':
        carried.set(m.owner, (carried.get(m.owner) ?? 0) + 1);
        break;
      case 'unresolved':
        brokenLine(
          `names no single row it can be followed to ("${m.link.text.slice(0, 60)}")`,
          'point it at its one question row — the next challenge run does this',
        );
        break;
      case 'question': {
        const link = m.link;
        const q = link.id ? s.questions.find((x) => x.id === link.id) : s.questions.find((x) => x.key === link.key);
        if (!q) {
          brokenLine(
            `its question row ${link.key ?? link.id ?? ''} does not exist — deleted? Broken; nothing clears it`,
            'raise the question again, or a human removes the marker',
          );
          break;
        }
        if (q.status === 'Closed (not applied)' || q.status === 'Rejected')
          brokenLine(`points at a ${q.status} row ${title(q)}`, 'nothing — the next challenge run removes it');
        else if (
          q.status === 'Applied' &&
          !facts?.holds.has(normaliseId(q.id)) &&
          !(q.key !== undefined && facts?.holds.has(q.key))
        ) {
          brokenLine(
            `points at an Applied row ${title(q)} — the answer went in but did not reach this marker`,
            'the next challenge run checks whether the answer settles it and removes it',
          );
        }
        break;
      }
      case 'default': {
        const isRatified = facts ? m.link.n !== null && ratified(facts, 'defaults', m.link.runId, m.link.n) : false;
        if (isRatified)
          brokenLine(
            `cites ledger ${m.link.runId} #${m.link.n ?? '?'}, which is ratified — the marker should have gone with it`,
            'the next challenge run removes it (route 6)',
          );
        else awaiting += 1;
        break;
      }
    }
  }
  if (carried.size) {
    const total = [...carried.values()].reduce((a, b) => a + b, 0);
    lines.push({
      mark: '~',
      text: `${total} carried marker(s) — ${[...carried].map(([w, n]) => `${w} ×${n}`).join(', ')}. No row behind them yet`,
      move: 'they want a challenge sitting, not a repair',
    });
  }
  if (awaiting)
    lines.push({
      mark: '~',
      text: `${awaiting} marker(s) awaiting a defaults ratification`,
      move: 'name the batch to the next challenge run — ratify <run id> [defaults|fixes|slots], or veto <run id> #n',
    });
  if (!facts)
    lines.push({
      mark: '~',
      text: 'deliberate holds and unratified batches could not be read — no run log on this machine',
      move: 'pull record/ from the repository, then run status again',
    });
  const unratifiedBatches: string[] = [];
  if (facts) {
    for (const b of facts.batches) {
      const open = b.lines.filter(
        (l) =>
          !ratified(facts, b.kind, b.runId, l.n) &&
          !facts.acts.some(
            (a) =>
              a.act === 'VETOED' &&
              a.kind === b.kind &&
              a.runId === b.runId &&
              (a.lines === 'all' || a.lines.includes(l.n)),
          ),
      );
      if (!open.length) continue;
      unratifiedBatches.push(`${b.kind} ${b.runId} (${open.length})`);
      if (sittingsSince(facts, b.runId) > 2)
        lines.push({
          mark: 'x',
          text: `${b.kind} batch ${b.runId} — ${open.length} line(s) unratified past two sittings`,
          move: `name it to the next challenge run: ratify ${b.runId} ${b.kind}, or veto ${b.runId} #n`,
        });
    }
  }
  return {
    section: {
      check: 'C5',
      title: `BLOCKING LINKS (${broken} broken, ${[...carried.values()].reduce((a, b) => a + b, 0)} carried)`,
      count: lines.length,
      lines,
    },
    carried,
    broken,
    awaiting,
    unratifiedBatches,
  };
}

const findOverviewMarkers = (text: string) => findMarkers(text).map((m) => ({ ...m, link: markerLink(m.inner) }));

// ---- C7 — stuck and going stale ------------------------------------------------------------------------------------------

function c7(s: Snapshot, today: Date, already: Set<string>): Section {
  const lines: Line[] = [];
  for (const q of s.questions) {
    if (already.has(q.id)) continue;
    if (q.status === 'Answered' && q.answer.trim())
      lines.push({
        mark: '~',
        rowId: q.id,
        text: `${title(q)}   Answered, waiting on a resolve run · created ${age(q.created, today)} ago`,
        move: 'one resolve run writes it in',
      });
    // A status with no answer behind it is not in any queue — a discrepancy for its human (SKILL.md rule 1).
    if (q.status === 'Answered' && !q.answer.trim())
      lines.push({
        mark: 'x',
        rowId: q.id,
        text: `${title(q)}   Answered with an empty Answer & why — no run can apply it`,
        move: 'write the answer and its why, or move it back to Open',
      });
  }
  const open = s.questions.filter((q) => q.status === 'Open' && !q.answer.trim() && !already.has(q.id));
  const stale = open.filter((q) => {
    const d = when(q.created);
    const a = d ? daysBetween(d, today) : null;
    return a !== null && a > 14;
  });
  for (const q of stale)
    lines.push({
      mark: '~',
      rowId: q.id,
      text: `${title(q)}   Open ${age(q.created, today)} · nobody has answered or rejected it`,
      move: 'answer it, reject it with a reason, or put it in a packet',
    });
  return { check: 'C7', title: 'STUCK AND GOING STALE', count: lines.length, lines };
}

// ---- C8 — the front door ---------------------------------------------------------------------------------------------------

function c8(s: Snapshot, opts: { runLogUrl: string | null }, residue: Residue[]): Section {
  const lines: Line[] = [];
  if (!s.overview)
    return { check: 'C8', title: 'THE FRONT DOOR', count: 0, lines: [], notComputed: 'the overview could not be read' };
  const o = s.overview.parsed;
  for (const name of ['Links', 'Operating'] as const) {
    const b = o.block(name);
    if (!b) continue;
    const paths = machineLocalPaths(b.lines.join('\n'));
    if (paths.length)
      lines.push({
        mark: 'x',
        text: `«${name}» carries a machine-local path (${paths.length}) — it opens only on the machine that wrote it`,
        move: 'a human edits it to a web URL, or names the material without a path (doc-shape §3)',
      });
  }
  const operating = o.block('Operating');
  if (operating && opts.runLogUrl && /not yet published|no remote|not published/i.test(operating.lines.join(' '))) {
    lines.push({
      mark: 'x',
      text: '«Operating» says the run record is not yet published, and the repository holding it has a remote',
      move: `a human replaces the line with the link: ${opts.runLogUrl}`,
    });
  }
  const tldr = o.block('TL;DR');
  if (tldr && /\b\d+\s+(?:open\s+)?(?:questions?|features?|rows?|markers?|gaps?)\b/i.test(tldr.lines.join(' '))) {
    lines.push({
      mark: 'x',
      text: 'the TL;DR carries a count — a number goes stale the moment a row moves',
      move: 'a human removes it; counts live in the views',
    });
  }
  for (const sec of o.sections.filter((x) => x.generated)) {
    const typed = sec.lines.filter(
      (l) =>
        l.trim() &&
        !/^<database\b/.test(l.trim()) &&
        !/^[-*]\s+\[.*\]\(.*\)/.test(l.trim()) &&
        !/^_.*_$/.test(l.trim()) &&
        !/^###\s/.test(l.trim()),
    );
    if (typed.length)
      lines.push({
        mark: 'x',
        text: `text typed under «${sec.heading}» (${typed.length} line(s)) — the heading is a view and is regenerated`,
        move: 'move the text to a plain block',
      });
  }
  if (s.target.kind === 'local') {
    const listed = o.sections.find((x) => x.generated && /Where things are/.test(x.heading));
    const count = listed?.lines.filter((l) => /^[-*]\s+\[/.test(l.trim())).length;
    if (listed && count !== undefined && count !== s.features.length)
      lines.push({
        mark: 'x',
        text: `«⟳ Where things are» lists ${count} feature(s); there are ${s.features.length}`,
        move: 'the next write run regenerates it',
      });
  }
  residue.push({
    check: 'C8',
    what: "the overview's prose read against the rows — any sentence the rows contradict",
    items: o.sections.filter((x) => !x.generated).length,
  });
  return { check: 'C8', title: 'THE FRONT DOOR', count: lines.length, lines };
}

// ---- C9 — content the rule bars ------------------------------------------------------------------------------------------

function c9(s: Snapshot, record: { name: string; text: string }[], barredTerms: string[], residue: Residue[]): Section {
  const lines: Line[] = [];
  const findings = contentFindings(s, record, barredTerms);
  for (const f of findings)
    lines.push({
      mark: 'x',
      text: `${f.where} — ${f.cls}`,
      move: 'a human edits it to the role, or records a dated widening in Operating',
    });
  for (const f of s.features)
    if (f.adHoc.length)
      lines.push({
        mark: 'x',
        text: `Features carries a field no spec defines: ${f.adHoc.join(', ')}`,
        move: 'move its content into a governed field; an undefined field is unaudited',
      });
  const qAdHoc = new Set(s.questions.flatMap((q) => q.adHoc));
  if (qAdHoc.size)
    lines.push({
      mark: 'x',
      text: `Open Questions carries a field no spec defines: ${[...qAdHoc].join(', ')}`,
      move: 'move its content into a governed field',
    });
  const fields = s.features.length * 3 + s.questions.length * 4 + record.length;
  residue.push({
    check: 'C9',
    what: 'names in prose — customer, third-party and individual names (code matched only barred terms, prices and contract dates)',
    items: fields,
  });
  const unique = dedupeByText(lines);
  return { check: 'C9', title: 'CONTENT THE RULE BARS', count: unique.length, lines: unique };
}

const dedupeByText = (ls: Line[]): Line[] => ls.filter((l, i) => ls.findIndex((x) => x.text === l.text) === i);

// ---- C10 — run-log arithmetic ---------------------------------------------------------------------------------------------

function c10(s: Snapshot, log: ParsedLog | null): Section {
  if (!log)
    return {
      check: 'C10',
      title: 'RUN-LOG ARITHMETIC',
      count: 0,
      lines: [],
      notComputed: 'no readable run log on this machine — its arithmetic could not be checked',
    };
  const lines: Line[] = [];
  for (const e of log.entries.slice(0, 5)) {
    for (const f of validateEntry(e).filter((x) => x.severity === 'error'))
      lines.push({
        mark: 'x',
        text: `run ${f.runId} l.${f.line}: ${f.message}`,
        move: 'the entry cannot be rewritten; the next entry records the correction',
      });
  }
  const newest = log.entries[0];
  const tally = newest?.lines.find((l) => l.kind === 'COUNTS' && /question rows\s+\d+\s*=/.test(l.text));
  if (tally) {
    const m = /question rows\s+(\d+)\s*=\s*([^;]*)/.exec(tally.text);
    const claimedTotal = m?.[1] ? Number(m[1]) : null;
    if (claimedTotal !== null && claimedTotal !== s.questions.length) {
      lines.push({
        mark: 'x',
        text: `the newest entry (run ${newest?.heading.runId ?? '?'}) counts ${claimedTotal} question rows; the database holds ${s.questions.length}`,
        move: 'a row created or deleted since, or a miscount — the log cannot say which; the next entry records the fresh count',
      });
    }
  }
  return { check: 'C10', title: 'RUN-LOG ARITHMETIC', count: lines.length, lines };
}

// ---- the report ------------------------------------------------------------------------------------------------------------

export function statusReport(opts: {
  snapshot: Snapshot;
  log: ParsedLog | null;
  recordText: { name: string; text: string }[];
  barredTerms: string[];
  today: Date;
  /** The run log's web address, where the record's repository has a remote (doc-shape §3 Operating). */
  runLogUrl: string | null;
  projectTitle: string;
  /** `status full`: C11's dispatched reads are owed (they are the model's, never code's). */
  full?: boolean;
}): StatusReport {
  const { snapshot: s, log, today } = opts;
  const facts = log ? readFacts(log) : null;
  const residue: Residue[] = [];
  const S1 = c1(s, facts, today);
  const S2 = c2(s, today);
  const S3 = c3(s, log, residue);
  const S4 = c4(s, facts);
  const five = c5(s, facts);
  const named = new Set(
    [...S1.lines, ...S3.lines, ...S4.lines, ...S2.lines]
      .flatMap((l) => [l.rowId, ...(l.rows ?? [])])
      .filter((x): x is string => !!x),
  );
  const S7 = c7(s, today, named);
  const S8 = c8(s, { runLogUrl: opts.runLogUrl }, residue);
  const S9 = c9(s, opts.recordText, opts.barredTerms, residue);
  const S10 = c10(s, log);
  // S3's fixed order, worst first.
  const sections = [S9, S1, S4, S10, S3, five.section, S2, S7, S8];
  // What code does not compute is named, never implied covered (status.md S1 step 4).
  residue.push({
    check: 'C1',
    what: '"this one looks fixed" — whether an Answer & why or the named body was edited after the flag (needs last-edited times)',
    items: S1.count,
  });
  residue.push({
    check: 'C2',
    what: 'the pace after a bulk write — answered or rejected since it, beside how many wait',
    items: 1,
  });
  residue.push({ check: 'C8', what: 'the "⟳ Open questions" view recounted against the rows', items: 1 });
  residue.push({
    check: 'C10',
    what: 'SWEEP-NOTE field counts, VERDICTS item counts, Not doing tallies, marker and ledger counts, and each entry against the one before it (code checks COUNTS, the funnel against its discard lines, and HASHES against item lines)',
    items: Math.min(5, log?.entries.length ?? 0),
  });
  if (s.target.kind === 'notion')
    residue.push({
      check: 'C9',
      what: 'question rows whose page body holds Why asked or Suggested directions prose (the placement rule)',
      items: s.questions.length,
    });
  if (opts.full)
    residue.push({
      check: 'C11',
      what: 'can a builder test this — tautological requirements, load-bearing unnumbered text, undefined cross-feature terms (dispatched reads, on `status full` only)',
      items: s.features.length,
    });

  // Only a row with an answer behind it waits on resolve (databases.md §4) — the same queue resolve reads.
  const answered = queueOf(s).length;
  const openUnanswered = s.questions.filter((q) => q.status === 'Open' && !q.answer.trim()).length;
  const lastRun = facts?.lastRun;
  const header = [
    lastRun
      ? `Last run ${lastRun.date} (${daysBetween(dateOf(lastRun.date), today)}d)`
      : 'Last run unknown (no run log on this machine)',
    `${answered} answered and waiting`,
    `${openUnanswered} open, unanswered`,
  ].join(' · ');

  const withMarker = s.features.filter((f) => f.body.markers.length).map((f) => `«${f.name}»`);
  const noFr = s.features.filter((f) => !hasNumberedRequirement(f.body)).map((f) => `«${f.name}»`);
  const slots = s.features.flatMap((f) =>
    f.body.labelled
      .filter((l) => l.kind === 'slot')
      .map((l) => `«${f.name}»${l.suppliedBy ? ` (${l.suppliedBy})` : ''}`),
  );
  const byStatus = (st: string): number => s.questions.filter((q) => q.status === st).length;
  const oldestOpen = s.questions
    .filter((q) => q.status === 'Open' && !q.answer.trim())
    .sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''))[0];
  const unsettled = [
    `${withMarker.length} feature(s) carrying a marker${withMarker.length ? ` — ${withMarker.slice(0, 5).join(', ')}${withMarker.length > 5 ? ` +${withMarker.length - 5} more` : ''}` : ''} (${five.broken} broken, ${[...five.carried.values()].reduce((a, b) => a + b, 0)} carried)`,
    `${byStatus('Open')} Open · ${byStatus('Answered')} Answered, not yet applied · ${byStatus('Flagged')} Flagged`,
    `${noFr.length} feature(s) with no numbered requirement${noFr.length ? ` — ${noFr.slice(0, 5).join(', ')}` : ''}`,
    `${openUnanswered} Open unanswered${oldestOpen ? `, the oldest ${age(oldestOpen.created, today)}` : ''}`,
    `${five.unratifiedBatches.length} batch(es) adopted but unratified${five.unratifiedBatches.length ? ` — ${five.unratifiedBatches.join(', ')}` : ''}`,
    `${slots.length} content slot(s) somebody outside still owes${slots.length ? ` — ${slots.slice(0, 5).join(', ')}` : ''}`,
  ];

  // The NEXT line (status.md Constraints): omit the challenge step only on a read — the newest GRILL line converged
  // and its entry is also the newest write entry.
  const newestGrill = facts?.grills[0];
  const converged = !!newestGrill && newestGrill.converged && newestGrill.entryIndex === 0;
  const needsQuestions =
    !converged || [...five.carried.values()].some((n) => n > 0) || five.unratifiedBatches.length > 0;
  const steps: string[] = [];
  if (S1.count) steps.push(`clear the ${S1.count} flag(s)`);
  if (S9.count) steps.push('edit the barred content to the role');
  if (needsQuestions) steps.push(`run /blueprint challenge${openUnanswered ? ` (${openUnanswered} waiting)` : ''}`);
  if (answered) steps.push(`then /blueprint resolve (${answered})`);
  const next = steps.length ? `NEXT: ${steps.join(', ')}.` : 'NEXT: nothing is waiting on a run.';
  // Clean means nothing to say: no section, and nothing the unsettled block alone carries (a slot owed, a batch waiting,
  // a title that is not yet a spec, a marker).
  const clean =
    sections.every((sec) => sec.lines.length === 0 && !sec.notComputed) &&
    !withMarker.length &&
    !noFr.length &&
    !openUnanswered &&
    !five.unratifiedBatches.length &&
    !slots.length &&
    !byStatus('Answered') &&
    !byStatus('Flagged');
  // Every line that quotes a row or a log line is swept: a report never prints a value the content rule bars.
  const safe = (t: string): string => redact(t, opts.barredTerms);
  return {
    title: opts.projectTitle,
    today: localDate(today),
    header: safe(header),
    sections: sections.map((sec) => ({
      ...sec,
      lines: sec.lines.map((l) => ({ ...l, text: safe(l.text), move: safe(l.move) })),
    })),
    unsettled: unsettled.map(safe),
    next,
    residue,
    clean,
    incomplete: s.incomplete,
  };
}
