import { createHash } from 'node:crypto';

// targets.md §5 — one rule for every hash this skill writes. SHA-256 over UTF-8 bytes; full hex in the source record and
// snapshots, the first 12 hex characters in run-log lines.

export type Sha256 = string & { readonly __brand: 'Sha256' };
export type Sha12 = string & { readonly __brand: 'Sha12' };

export function sha256(data: string | Uint8Array): Sha256 {
  // A hex digest of SHA-256 is exactly the branded shape.
  return createHash('sha256').update(data).digest('hex') as Sha256;
}

export function sha12(full: Sha256): Sha12 {
  // The first 12 hex characters of a SHA-256 hex digest are, by definition, a Sha12.
  return full.slice(0, 12) as Sha12;
}

export const SHA12 = /^[0-9a-f]{12}$/;

/** Line endings to `\n`, trailing whitespace stripped on each line. The normalisation every text hash uses. */
export function normaliseForHash(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

/**
 * A feature body as targets §5 defines it: from the `## Why` line to the end, as the target returned it. Returns
 * undefined when there is no `## Why` heading — such a body has no hash under the rule (R2.4 reports it).
 */
export function bodyFromWhy(content: string): string | undefined {
  const text = content.replace(/\r\n?/g, '\n');
  const m = /^## Why[ \t]*$/m.exec(text);
  if (!m) return undefined;
  return text.slice(m.index);
}

export function hashBody(content: string): Sha256 | undefined {
  const body = bodyFromWhy(content);
  if (body === undefined) return undefined;
  return sha256(normaliseForHash(body));
}

/** A named block: its `## ` heading line through to the line before the next `## ` heading. */
export function blockText(content: string, heading: string, through?: string): string | undefined {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  // Headings inside a ``` fence are text, not blocks — the same boundaries parseBody reads (one view over the raw text).
  const headings: number[] = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    else if (!fenced && /^## /.test(l)) headings.push(i);
  });
  const at = (name: string): number =>
    headings.find((i) => (lines[i] ?? '').replace(/[ \t]+$/, '') === `## ${name}`) ?? -1;
  const start = at(heading);
  if (start < 0) return undefined;
  const last = through === undefined ? start : at(through);
  if (last < start) return undefined;
  const end = headings.find((i) => i > last) ?? lines.length;
  return lines.slice(start, end).join('\n');
}

export function hashText(text: string): Sha256 {
  return sha256(normaliseForHash(text));
}
