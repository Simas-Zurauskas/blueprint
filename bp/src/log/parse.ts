import { canonicalCommand, LOG_KINDS, type LogKind } from '../domain/vocab.ts';
import { lines as splitLines } from '../core/text.ts';

// A tolerant reader for every run log this skill has written (v15–v37 and bp's own):
//   - v37:        `## 2026-09-25 · 16:41 · add · run a2d011 · skill v37 · sitting 1` then `- kind: text` bullets
//   - v21 (elf):  `## 2026-08-22 08:54 · resolve · run 4c1e7b · …` then column lines `KIND   text` with indented
//                 continuations
//   - v21 (fenced): the same heading as a plain line inside a ``` fence, column lines, bare `CLOSED hh:mm …`
// A heading's `questions` — the command's name before v42 — reads as `challenge`.
// Reading never rewrites; the log is append-only (SKILL.md, "Never rewrites the run log").

export interface ParsedLine {
  /** The kind token as written (`item`, `fix a2d011 #1`, `CON-3`, `COLD READ`), or null for a line with none. */
  token: string | null;
  /** The closed-list kind the token maps to, or null when it maps to none. */
  kind: LogKind | null;
  /** Written with different case from the closed list (`FUNNEL` for `funnel`) — C10's vacuous-pass trap. */
  caseMismatch: boolean;
  /** The line's text after the kind, continuations joined with a single space. */
  text: string;
  /** 1-based line number of the first physical line. */
  lineNo: number;
  format: 'bullet' | 'column' | 'bare' | 'prose';
}

export interface EntryHeading {
  date: string;
  time: string;
  command: string;
  runId: string;
  version: number | null;
  sitting: number | null;
  /** Everything after `run <id>` — the version, sitting, queue and mode tokens as written. */
  rest: string;
}

export interface ParsedEntry {
  heading: EntryHeading;
  /** 1-based line number of the heading. */
  headingLine: number;
  /** Heading written as a `## ` markdown heading (v37, bp) rather than a plain line. */
  markdownHeading: boolean;
  lines: ParsedLine[];
  /** 0-based index of the first physical line of the entry (the heading) and one past its last line. */
  start: number;
  end: number;
  /**
   * Where the entry's block begins in the file: its heading, or the ``` fence opening just above it on the fenced v21
   * shape. A new entry goes here — never inside an earlier entry's fence.
   */
  blockStart: number;
}

export interface ParsedLog {
  /** Physical lines of the file, `\n`-split. */
  physical: string[];
  /** Index one past the preamble (the first entry's heading line, or the file's end). */
  preambleEnd: number;
  entries: ParsedEntry[];
}

const HEADING_RE =
  /^(?:##\s+)?(\d{4}-\d{2}-\d{2})(?:\s*·)?\s+(\d{1,2}:\d{2})\s+·\s+([a-z][a-z-]*)\s+·\s+run\s+([\w-]+)(.*)$/;

export function parseHeading(line: string): EntryHeading | null {
  const m = HEADING_RE.exec(line.trim());
  if (!m) return null;
  const [, date = '', time = '', command = '', runId = '', rest = ''] = m;
  const version = /\bskill v(\d+)\b/.exec(rest);
  const sitting = /\bsitting (\d+)\b/.exec(rest);
  return {
    date,
    time: time.padStart(5, '0'),
    command: canonicalCommand(command),
    runId,
    version: version?.[1] ? Number(version[1]) : null,
    sitting: sitting?.[1] ? Number(sitting[1]) : null,
    rest: rest.trim(),
  };
}

const LOWER_KINDS = new Map<string, LogKind>(LOG_KINDS.map((k) => [k.toLowerCase(), k]));

/** Map a written token to its closed-list kind. */
export function kindOf(token: string): { kind: LogKind | null; caseMismatch: boolean } {
  if (/^CON-\d+$/i.test(token)) return { kind: 'CON', caseMismatch: !token.startsWith('CON-') };
  if (/^CON$/i.test(token)) return { kind: null, caseMismatch: false };
  if (/^group heading$/i.test(token)) return { kind: 'group heading', caseMismatch: token !== 'group heading' };
  const batch = /^(ledger|fix|manifest)\s+[\w-]+\s+#\d+$/i.exec(token);
  if (batch?.[1]) {
    const k = batch[1].toLowerCase();
    return { kind: k === 'ledger' ? 'ledger' : k === 'fix' ? 'fix' : 'manifest', caseMismatch: batch[1] !== k };
  }
  const exact = (LOG_KINDS as readonly string[]).includes(token);
  if (exact) return { kind: LOWER_KINDS.get(token.toLowerCase()) ?? null, caseMismatch: false };
  const loose = LOWER_KINDS.get(token.toLowerCase());
  return loose ? { kind: loose, caseMismatch: true } : { kind: null, caseMismatch: false };
}

const BULLET_RE = /^- ([A-Za-z][\w-]*(?: [\w#-]+){0,2}?):(?:\s+(.*))?$/;
const COLUMN_RE = /^([A-Za-z][\w-]*(?: [\w#-]+)?)(?::\s+|\s{2,})(.*)$/;
/** A bare closing line — `CLOSED 10:19 · …`, `PAUSED — …`, or a human's hand-written `- CLOSED (crashed)`. */
const BARE_CLOSING_RE = /^(?:- )?(CLOSED|PAUSED)\b(.*)$/;

function classify(line: string): { token: string | null; text: string; format: ParsedLine['format'] } {
  const bare = BARE_CLOSING_RE.exec(line);
  if (bare?.[1] && line.startsWith('- '))
    return { token: 'closing', text: `${bare[1]}${bare[2] ?? ''}`, format: 'bare' };
  const bullet = BULLET_RE.exec(line);
  if (bullet?.[1]) return { token: bullet[1], text: bullet[2] ?? '', format: 'bullet' };
  if (bare?.[1]) return { token: 'closing', text: `${bare[1]}${bare[2] ?? ''}`, format: 'bare' };
  const column = COLUMN_RE.exec(line);
  if (column?.[1] && kindOf(column[1]).kind !== null)
    return { token: column[1], text: column[2] ?? '', format: 'column' };
  return { token: null, text: line.trim(), format: 'prose' };
}

export function parseLog(text: string): ParsedLog {
  const physical = splitLines(text.replace(/^\uFEFF/, ''));
  const entries: ParsedEntry[] = [];
  let current: ParsedEntry | null = null;
  let preambleEnd = physical.length;
  let last: ParsedLine | null = null;
  let openFence: number | null = null;

  const close = (end: number): void => {
    if (current) {
      current.end = end;
      entries.push(current);
    }
  };

  physical.forEach((raw, i) => {
    const trimmed = raw.trim();
    // A heading is never indented: an indented dated line is a continuation of the line above it.
    const heading = /^\s/.test(raw) ? null : parseHeading(raw);
    if (heading) {
      // The fenced v21 shape opens each entry with a fence above its heading (blank lines between allowed): the entry's
      // block starts there. The fence stays open — the entry's own closing fence closes it.
      const fenced = openFence !== null && physical.slice(openFence + 1, i).every((l) => l.trim() === '');
      const blockStart = fenced && openFence !== null ? openFence : i;
      close(blockStart);
      if (entries.length === 0 && current === null) preambleEnd = blockStart;
      current = {
        heading,
        headingLine: i + 1,
        markdownHeading: raw.startsWith('##'),
        lines: [],
        start: i,
        end: i + 1,
        blockStart,
      };
      last = null;
      return;
    }
    if (trimmed.startsWith('```')) {
      openFence = openFence === null ? i : null;
      last = null;
      return;
    }
    if (!current) return;
    if (trimmed === '' || trimmed === '---') {
      last = null;
      return;
    }
    if (/^\s/.test(raw) && last) {
      last.text = `${last.text} ${trimmed}`.trim();
      return;
    }
    const c = classify(raw);
    const mapped = c.token === null ? { kind: null, caseMismatch: false } : kindOf(c.token);
    const parsed: ParsedLine = {
      token: c.token,
      kind: mapped.kind,
      caseMismatch: mapped.caseMismatch,
      text: c.text,
      lineNo: i + 1,
      format: c.format,
    };
    current.lines.push(parsed);
    last = parsed;
  });
  close(physical.length);
  return { physical, preambleEnd, entries };
}

export type EntryState = 'open' | 'closed' | 'paused';

/**
 * SKILL.md pre-flight 4: an entry's state is its last dated line, and only that. The dated lines that decide state are
 * the closing ones — `closing: CLOSED hh:mm`, `closing: PAUSED …`, a bare `CLOSED …`/`PAUSED …`, and a human's hand-written
 * `CLOSED (crashed)`. Headings never carry state.
 */
export function entryState(entry: ParsedEntry): EntryState {
  for (let i = entry.lines.length - 1; i >= 0; i--) {
    const l = entry.lines[i];
    if (!l) continue;
    const t = l.kind === 'closing' ? l.text : l.format === 'prose' ? l.text.replace(/^-\s*/, '') : '';
    if (/^CLOSED\b/.test(t)) return 'closed';
    if (/^PAUSED\b/.test(t)) return 'paused';
  }
  return 'open';
}
