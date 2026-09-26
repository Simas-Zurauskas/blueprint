// Text rules that are mechanical in the skill and so belong in code.

/**
 * SKILL.md rule 6(d): collapse runs of spaces, newlines and tabs to one space on both sides, then compare. Carriage
 * returns count as newline bytes. Nothing else is folded — no case, no punctuation, no escapes — so a match is exact
 * modulo whitespace and a mismatch is reported, never guessed around.
 */
export function normaliseWhitespace(s: string): string {
  return s.replace(/[ \t\n\r]+/g, ' ').trim();
}

/** True when `quote` occurs in `haystack` under rule 6(d)'s normalisation. An empty quote never matches. */
export function quoteFound(haystack: string, quote: string): boolean {
  const q = normaliseWhitespace(quote);
  if (q.length === 0) return false;
  return normaliseWhitespace(haystack).includes(q);
}

/** How many times `quote` occurs, non-overlapping, under the same normalisation. */
export function quoteCount(haystack: string, quote: string): number {
  const q = normaliseWhitespace(quote);
  if (q.length === 0) return 0;
  const h = normaliseWhitespace(haystack);
  let n = 0;
  let at = h.indexOf(q);
  while (at >= 0) {
    n += 1;
    at = h.indexOf(q, at + q.length);
  }
  return n;
}

/**
 * The marker test. Never match on the literal `[NEEDS` — Notion escapes the bracket on the round trip, and a literal
 * match finds zero markers on a document full of them (notion-mechanics §3, status C5). The anchor is the words
 * `NEEDS CLARIFICATION`; the extent is found by bracket depth, counting `[`/`\[` as opening and `]`/`\]` as closing, so a
 * markdown link inside the marker (`→ Question: [q-04](…)`) does not end it early. A marker never spans lines.
 */
const MARKER_WORDS = 'NEEDS CLARIFICATION';

export interface MarkerMatch {
  /** The whole marker as it stands in the text, opening bracket (escaped or not) included when present. */
  raw: string;
  /** The text after `NEEDS CLARIFICATION:` up to the closing bracket, trimmed. */
  inner: string;
  /** Character offset of `raw`. */
  index: number;
  /** False when the line ended before the brackets balanced — reported by status C5 as a malformed marker. */
  terminated: boolean;
}

export function findMarkers(text: string): MarkerMatch[] {
  const out: MarkerMatch[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(MARKER_WORDS, from);
    if (at < 0) break;
    let start = at;
    let depth = 0;
    if (text[at - 1] === '[') {
      start = text[at - 2] === '\\' ? at - 2 : at - 1;
      depth = 1;
    }
    // A marker whose opening bracket is missing ends only at an unmatched closing bracket, never at a link's own.
    const base = depth;
    let i = at + MARKER_WORDS.length;
    let end = -1;
    while (i < text.length && text[i] !== '\n') {
      const c = text[i];
      const escaped = c === '\\' && (text[i + 1] === '[' || text[i + 1] === ']');
      const ch = escaped ? text[i + 1] : c;
      if (ch === '[') depth += 1;
      if (ch === ']') {
        depth -= 1;
        if (depth < base || (base === 1 && depth === 0)) {
          end = i + (escaped ? 2 : 1);
          break;
        }
      }
      i += escaped ? 2 : 1;
    }
    const terminated = end >= 0;
    const stop = terminated ? end : i;
    const raw = text.slice(start, stop);
    let inner = text.slice(at + MARKER_WORDS.length, terminated ? stop - (text[stop - 2] === '\\' ? 2 : 1) : stop);
    inner = inner.replace(/^:/, '').trim();
    out.push({ raw, inner, index: start, terminated });
    from = stop > at ? stop : at + MARKER_WORDS.length;
  }
  return out;
}

/** Lines of a text, `\n`-split after normalising line endings. */
export function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}
