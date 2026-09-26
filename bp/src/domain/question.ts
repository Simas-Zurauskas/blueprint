import type { Status } from './vocab.ts';

// A question row (databases.md §2) and the mechanical readings of its fields: the suggested-directions list, the v34
// pointer grammar (resolve.md R2.1), and the link-only test (status C3). Judgment the grammar cannot settle is returned
// as `undecided`, never guessed.

export interface Question {
  /** Target identity: the Notion page id (canonical), or `q-NN` on the local target. */
  id: string;
  /** The local target's stable key (`q-04`); on Notion, absent. */
  key?: string;
  question: string;
  status: Status | null;
  /** The raw status text when it is not one of the six (a legacy value such as `Proposed`). */
  statusRaw: string;
  owner: string;
  answer: string;
  whyAsked: string;
  directions: string;
  whyFlagged: string;
  /** Feature ids (Notion) or feature names (local) the row touches. */
  touches: string[];
  created: string | null;
  /** Any field the row carries that databases.md §1/§2 does not define (status C9). */
  adHoc: string[];
}

// ---- suggested directions -------------------------------------------------------------------------------------------

export interface Direction {
  n: number;
  /** The decision clause: the direction's text up to its "Why:" — the only part a pointer may dereference (R2.1). */
  decision: string;
  /** `<value>`-style placeholders in the decision clause that a pointer must fill (challenge.md Q4). */
  slots: string[];
  raw: string;
}

/**
 * The decision clause of one direction — never its why or its counter-case (R2.1). Labelled rows cut at `Why:`; the
 * one-line shape challenge.md Q4 prints (`decision — why; counter-case: …`) cuts at the dash that opens the why, a dash
 * right after a requirement id (`FR-2 — …`) being part of the decision.
 */
function decisionClause(raw: string): string {
  const labelled = raw.search(/\s(?:Why|why)\s*:|\s[—–]\s*why\b/);
  if (labelled >= 0) return raw.slice(0, labelled).trim();
  const counter = raw.search(/[;,.]?\s*counter-case\s*:/i);
  if (counter < 0) return raw.trim();
  const head = raw.slice(0, counter);
  for (const m of head.matchAll(/\s[—–]\s/g)) {
    if (!/\bFR-\d+$/.test(head.slice(0, m.index))) return head.slice(0, m.index).trim();
  }
  return head.trim();
}

/** Numbered directions out of the free-text field; an empty list when the text carries none in a readable shape. */
export function parseDirections(text: string): Direction[] {
  const out: Direction[] = [];
  const normal = text.replace(/<br\s*\/?>/g, '\n');
  const parts = normal.split(/\n(?=\s*\**\s*(?:Direction\s+)?\d+[.)]\**\s)/);
  for (const part of parts) {
    const m = /^\s*\**\s*(?:Direction\s+)?(\d+)[.)]\**\s+([\s\S]*)$/.exec(part);
    if (!m?.[1] || m[2] === undefined) continue;
    const raw = m[2].trim();
    const decision = decisionClause(raw);
    out.push({ n: Number(m[1]), decision, slots: [...decision.matchAll(/<[^<>\n]{1,40}>/g)].map((s) => s[0]), raw });
  }
  return out;
}

// ---- the v34 pointer grammar (resolve.md R2.1) ----------------------------------------------------------------------

export type AnswerReading =
  | { kind: 'pointer'; n: number; extra: string; decision: string; slotsFilled: boolean | 'undecided' }
  | { kind: 'bad-pointer'; reason: string }
  | { kind: 'link-only'; reason: string }
  | { kind: 'empty' }
  | { kind: 'prose' };

/** A lead-in word before the number ("answer 1", "go with 2"). "No" is not one: "No 3 — …" is a sentence, not a pointer. */
const LEAD = /^\s*(?:(?:answer|direction|option|go with|pick|choose|number)\s*)?#?\s*(\d{1,2})(?!\d)(.*)$/is;

/**
 * What may follow the number for it to be a whole token — a pointer, not the start of "2.5 seconds", "3:00 pm", "1-2
 * days" or "24/7": the end, a comma, semicolon or colon then a space, a spaced dash, a closing bracket, a full stop then
 * a space, an exclamation mark, a question mark (unsure), or a space then a word.
 */
const WHOLE = /^(?:$|[,;:](?:\s|$)|\s+[—–-]\s|\s*[—–]|\)|\.(?:\s|$)|!|\?|\s)/;

/** One-word answers that decide nothing (R2.1's "a bare double-check") — a closed list, never every single word. */
const NON_DECISION =
  /^(?:double[- ]?check|check|tbd|tbc|tba|maybe|unsure|not sure|later|pending|discuss|ask|idk|dunno|\?+)[.!?]*$/i;

/**
 * Read an `Answer & why`. A pointer names exactly one of the row's numbered directions — "2", "answer 1", "1, but keep it
 * quiet" — and is dereferenced to that direction's decision clause. "1 or 2", "both", "1???" name no single direction;
 * a bare pointer at a direction carrying an unfilled `<value>` slot fails naming the slot. Anything that does not open
 * with a pointer is an ordinary answer (`prose`) — or `link-only` when it is nothing but a link or a reference.
 */
export function readAnswer(answer: string, directions: readonly Direction[]): AnswerReading {
  const a = answer.trim();
  if (!a) return { kind: 'empty' };
  // "both", "either 1 or 2", "all of them" — only when that is the whole answer; "Both the customer and the store …" is a sentence.
  if (
    /^(?:both|either|all|any|all of them|any of them)(?:\s+(?:of\s+them|\d{1,2}(?:\s*(?:,|or|and|&|\/)\s*\d{1,2})*))?[.!?]*$/i.test(
      a,
    )
  ) {
    return { kind: 'bad-pointer', reason: `"${a.slice(0, 40)}" names no single direction` };
  }
  if (NON_DECISION.test(a))
    return {
      kind: 'bad-pointer',
      reason: `"${a.slice(0, 40)}" names no direction and says nothing a writer can carry`,
    };
  const m = LEAD.exec(a);
  const rawRest = m?.[2] ?? '';
  if (m?.[1] !== undefined && WHOLE.test(rawRest)) {
    const n = Number(m[1]);
    const rest = rawRest.trim();
    const d = directions.find((x) => x.n === n);
    // "1, 2" names a second direction; "3, 5 days" fills direction 3's slot — as does a bare "3, 5" where 3 has one.
    const bareSecond = /^,\s*#?\d{1,2}\s*$/.test(rest) && !d?.slots.length;
    const another =
      bareSecond ||
      /^(?:,?\s*(?:or|and|\/|&|\+)\s*(?:direction\s+)?#?\d)|^,\s*#?\d{1,2}\s*(?:[,;/&+]|\b(?:or|and)\b)/i.test(rest);
    const unsure = /^\?/.test(rest);
    const looksLikePointer =
      rest === '' ||
      /^[,.;:—–\-!)]/.test(rest) ||
      /^[A-Z ]+$/.test(rest) ||
      another ||
      unsure ||
      /^(?:but|with|and|plus|please)\b/i.test(rest);
    if (looksLikePointer) {
      if (another) return { kind: 'bad-pointer', reason: `"${a.slice(0, 40)}" names more than one direction` };
      if (unsure) return { kind: 'bad-pointer', reason: `"${a.slice(0, 40)}" is not a decision` };
      if (!directions.length) {
        if (rest === '')
          return {
            kind: 'bad-pointer',
            reason: `the answer points at direction ${n}, and this row's directions could not be read as a numbered list`,
          };
        return { kind: 'prose' };
      }
      if (!d) {
        // "14, as the policy states" is a value, not a pointer; a bare "4" on a row offering 1–3 is a pointer gone wrong.
        if (rest !== '') return { kind: 'prose' };
        return {
          kind: 'bad-pointer',
          reason: `the answer points at direction ${n}; the row offers ${directions.map((x) => x.n).join(', ')}`,
        };
      }
      const extra = rest.replace(/^[,.;:—–\-\s]+/, '').trim();
      if (d.slots.length && !extra)
        return {
          kind: 'bad-pointer',
          reason: `direction ${n} leaves ${d.slots.join(', ')} to be filled, and the pointer supplies no value`,
        };
      return { kind: 'pointer', n, extra, decision: d.decision, slotsFilled: d.slots.length ? 'undecided' : true };
    }
  }
  if (isLinkOnly(a))
    return {
      kind: 'link-only',
      reason: 'the answer is only a link or a reference — nothing in it says what the product does',
    };
  return { kind: 'prose' };
}

const URL_RE = /https?:\/\/\S+/g;

/** Only links, file names, ticket numbers or "see …" references — status C3 / R2.1's "nothing to write down". */
export function isLinkOnly(answer: string): boolean {
  const MD_LINK = /\[[^\]]*\]\([^)]*\)/g;
  const FILE = /\b[\w.-]+\.(?:pdf|docx?|xlsx?|pptx?|md|txt|png|jpe?g|fig)\b/gi;
  const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;
  const HASH_TICKET = /(?:^|\s)#\d+\b/g;
  // The markdown link goes first: a bare-URL pattern would eat its closing parenthesis and leave the label behind.
  const stripped = answer
    .replace(MD_LINK, ' ')
    .replace(new RegExp(URL_RE.source, 'g'), ' ')
    .replace(FILE, ' ')
    .replace(TICKET, ' ')
    .replace(HASH_TICKET, ' ')
    .replace(/\b(?:see|as per|per|in|the|link|doc|document|ticket|attached|above|below|here)\b/gi, ' ')
    .replace(/[\s,.;:()—–-]+/g, '');
  const had = (re: RegExp): boolean => new RegExp(re.source, re.flags.replace('g', '')).test(answer);
  return (had(URL_RE) || had(MD_LINK) || had(FILE) || had(TICKET) || had(HASH_TICKET)) && stripped.length === 0;
}
