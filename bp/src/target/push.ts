import { blockText, hashBody, sha12, type Sha12 } from '../core/hash.ts';
import { CONNECTOR } from './relay.ts';
import { parseFetch, normaliseId } from './notion.ts';
import { canonicalJson, latestCall, toolMatches, type ToolCall } from './transcript.ts';
import { isRecord } from '../core/schema.ts';

// The one serial commit path (SKILL.md rule 8(ii); targets.md operation 8): for each staged write, in commit order —
// fetch the block fresh, diff it against the text the run read, write it, read it back, and only then may the caller log
// it. On Notion the fetches and the write go through the relay (DESIGN.md §5.4): bp plans each exact connector call and
// reads its result out of the transcript. A foreign edit between read and write is a conflict: nothing is written.

export interface StagedBlockWrite {
  key: string;
  /** Notion page id (canonical) or the local file path. */
  page: string;
  /** The feature's name, for log lines and reports. */
  label: string;
  /** The heading of the one named block this write replaces (`Behaviour`). */
  block: string;
  /** The last heading of a span of adjacent blocks written as one (a seed's `Why` through `Behaviour`). */
  through?: string;
  /** The block exactly as the run read it — heading line included. */
  before: string;
  /** The block's full new text — heading line included. */
  after: string;
}

export type PushStep =
  | { kind: 'fetch'; call: { tool: string; input: Record<string, unknown> } }
  | { kind: 'write'; call: { tool: string; input: Record<string, unknown> } }
  | { kind: 'readback'; call: { tool: string; input: Record<string, unknown> } };

export type WriteOutcome =
  /** `content` is the page body as the read-back returned it — what the next write on the same page is planned against. */
  | { kind: 'landed'; bodyHash: Sha12 | 'none'; note?: string; content?: string }
  | { kind: 'conflict'; current: string }
  | { kind: 'refused'; reason: string };

export interface PushItemState {
  write: StagedBlockWrite;
  stage: 'fetch' | 'write' | 'readback' | 'done';
  /** ISO time the current stage's call was planned; its result must be newer. */
  plannedAt: string;
  /** The exact strings the planned update carries — computed from the fresh fetch, matched on ingest. */
  oldStr?: string;
  newStr?: string;
  /** The whole page as the edit, simulated on the fresh fetch, should leave it (notion-mechanics §3; DESIGN §5.4 rule 3). */
  expect?: string;
  outcome?: WriteOutcome;
}

export const fetchCall = (page: string) => ({ tool: CONNECTOR.fetch, input: { id: normaliseId(page) } });

export function updateCall(page: string, oldStr: string, newStr: string) {
  return {
    tool: CONNECTOR.update,
    input: {
      page_id: normaliseId(page),
      command: 'update_content',
      allow_async: false,
      content_updates: [{ old_str: oldStr, new_str: newStr }],
    },
  };
}

/** notion-mechanics §3: an update keyed on a string that is not found is skipped silently — so it must occur exactly once. */
export function occurrences(content: string, needle: string): number {
  if (!needle) return 0;
  // Overlapping matches count: `aXa` occurs twice in `aXaXa`, and an edit keyed on it would be ambiguous.
  let k = 0;
  for (let at = content.indexOf(needle); at >= 0; at = content.indexOf(needle, at + 1)) k++;
  return k;
}

/**
 * The smallest edit that turns `before` into `after` inside `content`: the changed line range, widened one line at a
 * time until the old side occurs exactly once in the page. Sending the minimal anchor keeps the model from retyping a
 * whole block into the tool call (the measured 35.6 KB of retyped anchors, research REPORT §2).
 */
export function minimalEdit(
  content: string,
  before: string,
  after: string,
): { oldStr: string; newStr: string } | { error: string } {
  const a = before.split('\n');
  const b = after.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  if (p === a.length && p === b.length) return { error: 'the new text is identical to the old — nothing to write' };
  // A pure insertion or deletion has an empty side: it is anchored on a neighbouring line, so the edit carries the line
  // break with it and never leaves a stray blank line or an empty old_str.
  // The anchor goes on the line before where there is one, else on the line after.
  const bare = a.length - q - p === 0 || b.length - q - p === 0;
  const before1 = bare && p > 0 ? 1 : 0;
  const after1 = bare && p === 0 ? 1 : 0;
  for (let widen = 0; widen <= Math.max(a.length, b.length); widen++) {
    const lo = Math.max(0, p - Math.max(widen, before1));
    const hiA = Math.min(a.length, a.length - q + widen + after1);
    const hiB = Math.min(b.length, b.length - q + widen + after1);
    const oldStr = a.slice(lo, hiA).join('\n');
    const newStr = b.slice(lo, hiB).join('\n');
    if (oldStr.trim() && occurrences(content, oldStr) === 1) return { oldStr, newStr };
  }
  return occurrences(content, before) === 1
    ? { oldStr: before, newStr: after }
    : { error: 'no anchor occurs exactly once in the page' };
}

/** Apply one edit exactly once — the simulation the read-back is compared against. */
export const applyEdit = (content: string, oldStr: string, newStr: string): string => {
  const at = content.indexOf(oldStr);
  return at < 0 ? content : `${content.slice(0, at)}${newStr}${content.slice(at + oldStr.length)}`;
};

const blockOf = (content: string, heading: string, through?: string): string | undefined =>
  blockText(content, heading, through);

/** Normalise for a landed-comparison: line endings, trailing whitespace, one trailing newline. */
const settle = (s: string): string =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');

/** Unescape the connector's markdown escapes, to tell "landed, re-escaped" from "did not land". */
const unescape = (s: string): string => s.replace(/\\([[\]*_`#<>])/g, '$1');

function resultOf(
  calls: readonly ToolCall[],
  call: { tool: string; input: Record<string, unknown> },
  after: string,
): ToolCall | undefined {
  return latestCall(
    calls,
    call.tool,
    (input) =>
      call.tool === CONNECTOR.fetch
        ? isRecord(input) &&
          typeof input['id'] === 'string' &&
          normaliseId(input['id']) === normaliseId(String(call.input['id']))
        : canonicalJson(input) === canonicalJson(call.input),
    after,
  );
}

/**
 * Advance one staged write as far as the transcript allows. Returns the call still owed, or null when the item is done
 * (with `outcome` set).
 */
export function advanceWrite(item: PushItemState, calls: readonly ToolCall[], now: string): PushStep | null {
  const w = item.write;
  for (let guard = 0; guard < 4; guard++) {
    if (item.stage === 'done') return null;
    if (item.stage === 'fetch') {
      const c = resultOf(calls, fetchCall(w.page), item.plannedAt);
      if (!c?.result || c.result.isError) return { kind: 'fetch', call: fetchCall(w.page) };
      const page = parseFetch(c.result.text);
      const problem = !page
        ? 'the fresh fetch did not return a page'
        : page.id !== normaliseId(w.page)
          ? `the fresh fetch returned page ${page.id}, not ${normaliseId(w.page)}`
          : page.truncated
            ? 'the fresh fetch came back truncated — an edit planned on part of a page is never sent'
            : null;
      if (!page || problem) {
        item.stage = 'done';
        item.outcome = { kind: 'refused', reason: problem ?? 'the fresh fetch did not return a page' };
        return null;
      }
      const current = blockOf(page.content, w.block, w.through);
      if (current === undefined || settle(current) !== settle(w.before)) {
        item.stage = 'done';
        item.outcome = { kind: 'conflict', current: current ?? '(the block is gone)' };
        return null;
      }
      const edit = minimalEdit(page.content, current, w.after);
      if ('error' in edit) {
        item.stage = 'done';
        item.outcome = { kind: 'refused', reason: edit.error };
        return null;
      }
      const expect = applyEdit(page.content, edit.oldStr, edit.newStr);
      if (settle(blockOf(expect, w.block, w.through) ?? '') !== settle(w.after)) {
        item.stage = 'done';
        item.outcome = {
          kind: 'refused',
          reason: 'the planned edit, simulated on the fresh page, does not produce the intended block — nothing sent',
        };
        return null;
      }
      item.oldStr = edit.oldStr;
      item.newStr = edit.newStr;
      item.expect = expect;
      item.stage = 'write';
      item.plannedAt = now;
      continue;
    }
    if (item.stage === 'write') {
      const call = updateCall(w.page, item.oldStr ?? w.before, item.newStr ?? w.after);
      const c = resultOf(calls, call, item.plannedAt);
      if (!c?.result) return { kind: 'write', call };
      if (c.result.isError || /"error"|validation_error/i.test(c.result.text.slice(0, 200))) {
        item.stage = 'done';
        item.outcome = { kind: 'refused', reason: `the write returned an error: ${c.result.text.slice(0, 200)}` };
        return null;
      }
      item.stage = 'readback';
      item.plannedAt = now;
      continue;
    }
    // readback
    const c = resultOf(calls, fetchCall(w.page), item.plannedAt);
    if (!c?.result || c.result.isError) return { kind: 'readback', call: fetchCall(w.page) };
    const page = parseFetch(c.result.text);
    const landedBlock = page && page.id === normaliseId(w.page) ? blockOf(page.content, w.block, w.through) : undefined;
    item.stage = 'done';
    if (!page || landedBlock === undefined) {
      item.outcome = {
        kind: 'refused',
        reason: 'the read-back found no such block — the write did not land (notion-mechanics §3: a silent skip)',
      };
      return null;
    }
    const h = hashBody(page.content);
    const hash: Sha12 | 'none' = h ? sha12(h) : 'none';
    const same = (x: string, y: string): 'exact' | 'escapes' | false =>
      settle(x) === settle(y) ? 'exact' : settle(unescape(x)) === settle(unescape(y)) ? 'escapes' : false;
    const block = same(landedBlock, w.after);
    if (!block) {
      item.outcome = {
        kind: 'refused',
        reason: 'the read-back differs from what was written — the write did not land as sent',
      };
      return null;
    }
    // The block landed; the rest of the page must be what the simulation said, or someone else edited it meanwhile and the
    // post-write hash would silently absorb their change as this run's baseline (DESIGN §5.4 rule 4; SKILL.md rule 3).
    if (item.expect !== undefined && !same(page.content, item.expect)) {
      item.outcome = {
        kind: 'conflict',
        current:
          'the block landed, but the page also changed outside it between the fetch and the read-back — another author edited it; not logged as written',
      };
      return null;
    }
    item.outcome = {
      kind: 'landed',
      bodyHash: hash,
      content: page.content,
      ...(block === 'escapes' ? { note: "landed with the connector's escapes" } : {}),
    };
    return null;
  }
  return null;
}

/** Whether a tool call name belongs to the connector (for reports). */
export const isConnector = (name: string): boolean => Object.values(CONNECTOR).some((t) => toolMatches(name, t));
