import { blockText, hashBody, sha12, type Sha12 } from '../core/hash.ts';
import { readTextIfExists, writeTextAtomic } from '../core/fsx.ts';
import { lstatSync } from 'node:fs';
import { parseQuestionsFile, QUESTION_HEADING, splitFrontMatter } from './local.ts';
import type { WriteOutcome } from './push.ts';

// Writes on the local-markdown target (targets.md §3), under the same operation-8 discipline as Notion: re-read the file
// immediately before writing, compare the block against the text the run read, replace exactly that block, read it back.

const settle = (s: string): string =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');

/** Replace one named block of a feature file. `before` and `after` carry the block's heading line. */
export function writeLocalBlock(
  path: string,
  heading: string,
  before: string,
  after: string,
  through?: string,
): WriteOutcome {
  if (isLink(path))
    return {
      kind: 'refused',
      reason: `${path} is a symbolic link — bp writes only plain files inside the Blueprint's folder`,
    };
  const text = readTextIfExists(path);
  if (text === undefined) return { kind: 'refused', reason: `${path} is gone` };
  // Written back in the file's own line endings: every byte outside the block keeps its form.
  const crlf = /\r\n/.test(text);
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(text.replace(/\r\n?/g, '\n'))?.[0] ?? '';
  const body = text.replace(/\r\n?/g, '\n').slice(fm.length);
  const current = blockText(body, heading, through);
  if (current === undefined || settle(current) !== settle(before))
    return { kind: 'conflict', current: current ?? '(the block is gone)' };
  const at = body.indexOf(current);
  if (at < 0 || body.indexOf(current, at + 1) >= 0)
    return { kind: 'refused', reason: 'the block is not uniquely addressable in the file' };
  const next = `${fm}${body.slice(0, at)}${after}${body.slice(at + current.length)}`;
  writeTextAtomic(path, crlf ? next.replace(/\n/g, '\r\n') : next);
  const back = readTextIfExists(path) ?? '';
  // The body exactly as readLocal reads it (trailing blank lines dropped), so the hash recorded now is the hash the
  // next run computes for the same text.
  const backBody = splitFrontMatter(back).body.replace(/\n+$/, '');
  const landed = blockText(backBody, heading, through);
  if (landed === undefined || settle(landed) !== settle(after))
    return { kind: 'refused', reason: 'the read-back differs from what was written' };
  const h = hashBody(backBody);
  const hash: Sha12 | 'none' = h ? sha12(h) : 'none';
  return { kind: 'landed', bodyHash: hash, content: backBody };
}

/**
 * Set fields of one question section in questions.md (`### q-NN · …`, `- **Field:** value`). A field line that is absent is
 * added after `Status`; an empty value leaves the label with nothing after it, as the target's own shape does. A value of
 * several lines (round one's proposal appended to Why asked) continues on lines indented two spaces, which the reader
 * joins back; a replaced field's own continuation lines go with it.
 */
export function setLocalQuestionFields(
  path: string,
  key: string,
  fields: Record<string, string>,
): { ok: true } | { ok: false; reason: string } {
  if (isLink(path))
    return {
      ok: false,
      reason: `${path} is a symbolic link — bp writes only plain files inside the Blueprint's folder`,
    };
  const text = readTextIfExists(path);
  if (text === undefined) return { ok: false, reason: `${path} is gone` };
  const crlf = /\r\n/.test(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => QUESTION_HEADING.exec(l.replace(/^\uFEFF/, ''))?.[1] === key);
  if (start < 0) return { ok: false, reason: `no section ${key} in ${path}` };
  let end = lines.findIndex((l, i) => i > start && /^###\s+q-\d+/.test(l));
  if (end < 0) end = lines.length;
  const isFieldOrAnswer = (l: string): boolean =>
    /^- \*\*[^*]+?:\*\*/.test(l) || /^\*\*Answer & why:\*\*/.test(l) || /^###\s/.test(l);
  for (const [field, value] of Object.entries(fields)) {
    const re = new RegExp(`^- \\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*`);
    const idx = lines.findIndex((l, i) => i > start && i < end && re.test(l));
    const [first = '', ...more] = value.split(/\r?\n/);
    const block = [
      `- **${field}:**${first ? ` ${first}` : ''}`,
      ...more.filter((l) => l.trim()).map((l) => `  ${l.trim()}`),
    ];
    if (idx >= 0) {
      // The field's own continuation lines end at the next field, the answer, a heading or a blank line.
      let stop = idx + 1;
      while (stop < end && (lines[stop] ?? '').trim() && !isFieldOrAnswer(lines[stop] ?? '')) stop++;
      lines.splice(idx, stop - idx, ...block);
      end += block.length - (stop - idx);
    } else {
      const status = lines.findIndex((l, i) => i > start && i < end && /^- \*\*Status:\*\*/.test(l));
      const at = status >= 0 ? status + 1 : start + 1;
      lines.splice(at, 0, ...block);
      end += block.length;
    }
  }
  const next = lines.join('\n');
  writeTextAtomic(path, crlf ? next.replace(/\n/g, '\r\n') : next);
  // Read back through the reader itself: what bp will read next time is what was written.
  const back = parseQuestionsFile(readTextIfExists(path) ?? '').find((q) => q.key === key);
  if (!back) return { ok: false, reason: `${key} did not read back` };
  const fieldOf = (field: string): string | undefined =>
    field === 'Status'
      ? back.statusRaw
      : field === 'Why asked'
        ? back.whyAsked
        : field === 'Why flagged'
          ? back.whyFlagged
          : field === 'Owner'
            ? back.owner
            : field === 'Suggested directions'
              ? back.directions
              : undefined;
  const norm = (v: string): string =>
    v
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  for (const [field, value] of Object.entries(fields)) {
    const got = fieldOf(field);
    if (got !== undefined && norm(got) !== norm(value)) return { ok: false, reason: `${field} did not read back` };
  }
  return { ok: true };
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
