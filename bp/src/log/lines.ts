import { usage } from '../core/errors.ts';
import type { ParsedEntry } from './parse.ts';

// Lines whose content is arithmetic or a roll-up are composed by code, never by the model (SKILL.md rule 7: every count
// is counted fresh; R5: COUNTS carry their addends, HASHES repeat the item lines character for character).

export interface CountGroup {
  label: string;
  parts: { name: string; n: number }[];
}

/** `question rows 48 = Applied 48 · Open 0` — the total is computed here, so it always equals its addends. */
export function formatCountGroup(g: CountGroup): string {
  if (!g.label.trim()) throw usage('a COUNTS group needs a label');
  if (!g.parts.length) throw usage(`COUNTS group "${g.label}" has no addends — a bare total is not allowed (R5)`);
  for (const p of g.parts) {
    if (!Number.isInteger(p.n) || p.n < 0) throw usage(`COUNTS addend "${p.name}" must be a non-negative integer`);
    if (/[·;=]/.test(p.name) || /[·;=]/.test(g.label)) throw usage('COUNTS labels cannot contain "·", ";" or "="');
  }
  const total = g.parts.reduce((a, p) => a + p.n, 0);
  return `${g.label.trim()} ${total} = ${g.parts.map((p) => `${p.name.trim()} ${p.n}`).join(' · ')}`;
}

export function formatCounts(groups: readonly CountGroup[]): string {
  return groups.map(formatCountGroup).join('; ');
}

/** Parse `name=3, other=5` into addends. */
export function parseParts(spec: string): CountGroup['parts'] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.+?)\s*=\s*(\d+)$/.exec(s);
      if (!m?.[1] || m[2] === undefined) throw usage(`COUNTS part "${s}" is not name=number`);
      return { name: m[1], n: Number(m[2]) };
    });
}

/** An addend's number: `features 5/7/8/4` counts as 5+7+8+4 (R5's own sample writes per-feature counts that way). */
function addendValue(part: string): number | undefined {
  const m = /(\d+(?:\s*\/\s*\d+)*)\s*$/.exec(part.trim());
  if (!m?.[1]) return undefined;
  return m[1].split('/').reduce((a, n) => a + Number(n.trim()), 0);
}

export interface CountCheck {
  mismatches: string[];
  /** Groups that state a number with no addends — R5: "each carrying its addends, not a bare total". */
  bare: string[];
}

/**
 * Check a COUNTS line. Groups are separated by `;`. A group is `label N = a x · b y` (bp's shape) or `a x · b y = N` (the
 * total written last, as older samples did); an addend may carry slash-joined numbers. A group with neither shape is a
 * bare total.
 */
export function checkCounts(text: string): CountCheck {
  const out: CountCheck = { mismatches: [], bare: [] };
  for (const raw of text.split(';')) {
    const group = raw.trim();
    if (!group) continue;
    const eq = group.indexOf('=');
    if (eq < 0) {
      if (/\d/.test(group)) out.bare.push(group);
      continue;
    }
    const left = group.slice(0, eq).trim();
    const right = group.slice(eq + 1).trim();
    const leftTotal = /^(.*?)\s+(\d+)$/.exec(left);
    let total: number | undefined;
    let parts: string[];
    let label: string;
    if (leftTotal?.[2] !== undefined && !left.includes('·')) {
      total = Number(leftTotal[2]);
      label = (leftTotal[1] ?? '').trim();
      parts = right.split('·');
    } else if (/^\d+$/.test(right)) {
      total = Number(right);
      label = 'total';
      parts = left.split('·');
    } else continue;
    const values = parts.map(addendValue);
    if (values.some((v) => v === undefined)) continue;
    const sum = values.reduce<number>((a, v) => a + (v ?? 0), 0);
    if (sum !== total) out.mismatches.push(`${label}: total ${total} but addends sum to ${sum}`);
  }
  return out;
}

/** Back-compat name used by validate and status. */
export const countMismatches = (text: string): string[] => checkCounts(text).mismatches;

const BODY_RE = /\bbody\s+([0-9a-f]{12})\b/g;
const NAME_RE = /«([^«»]{1,200})»(\s*`[^`]{1,80}`)?/g;

/**
 * Body hashes an entry's item lines carry, keyed by the feature each belongs to; last wins. A `body <hash>` belongs to the
 * feature named with its page id since the previous hash, else the one named nearest before it — never the question's
 * own title (a «title» followed by its row id: 32 hex, or a local `q-NN` key), and never a feature a clause says was
 * left unchanged ("«A» and «B» unchanged").
 */
export function itemHashes(entry: ParsedEntry): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of entry.lines) {
    if (l.kind !== 'item') continue;
    let from = 0;
    for (const b of l.text.matchAll(BODY_RE)) {
      const at = b.index ?? 0;
      const span = l.text.slice(from, at);
      from = at + b[0].length;
      const names = [...span.matchAll(NAME_RE)].filter((m) => {
        const id = (m[2] ?? '').trim().replace(/`/g, '');
        if (/^[0-9a-f]{32}$/.test(id) || /^q-\d+$/.test(id)) return false; // the question row
        const seg = span.slice(m.index ?? 0).split(' · ')[0] ?? '';
        return !/\bunchanged\b/.test(seg);
      });
      // A feature named with its page id is the one written; otherwise the feature named nearest before the hash.
      const name = (names.find((m) => /`[0-9a-f]{8}-/.test(m[2] ?? '')) ?? names[names.length - 1])?.[1];
      if (name && b[1]) out.set(name, b[1]);
    }
  }
  return out;
}

/** The HASHES roll-up for an entry: `«Feature» 0123456789ab · …`, in the order the features were first written. */
export function formatHashesRollup(entry: ParsedEntry): string {
  const hashes = itemHashes(entry);
  if (!hashes.size) throw usage('no item line in this entry carries a body hash — there is nothing to roll up');
  return [...hashes].map(([f, h]) => `«${f}» ${h}`).join(' · ');
}

export interface Funnel {
  drafted: number;
  defaults: number;
  fixes: number;
  slots: number;
  questions: number;
  discarded: number;
}

/** The funnel line; drafted must equal the sum of its outcomes (challenge.md Q4, Q6). */
export function formatFunnel(f: Funnel): string {
  const out = f.defaults + f.fixes + f.slots + f.questions + f.discarded;
  if (out !== f.drafted) throw usage(`funnel does not add up: ${f.drafted} drafted but outcomes sum to ${out}`);
  return `${f.drafted} drafted → ${f.defaults} routed default · ${f.fixes} routed fix · ${f.slots} routed slot · ${f.questions} written as questions · ${f.discarded} discarded`;
}

/** Read a funnel line back: its drafted and discarded counts, where written in bp's (or v37's) shape. */
export function readFunnel(text: string): { drafted: number; discarded: number; outcomes: number } | null {
  const drafted = /(\d+)\s+drafted\b/.exec(text) ?? /\bdrafted\s+(\d+)/.exec(text);
  const discarded = /(\d+)\s+discarded\b/.exec(text);
  if (!drafted?.[1] || !discarded?.[1]) return null;
  const arrow = text.indexOf('→');
  const tail = arrow >= 0 ? text.slice(arrow + 1) : text;
  // Each top-level outcome is a ` · ` segment opening with its count; asides in parentheses are not outcomes.
  let flat = tail;
  for (let i = 0; i < 4 && /\([^()]*\)/.test(flat); i++) flat = flat.replace(/\([^()]*\)/g, '');
  const outcomes = flat
    .split(' · ')
    // "2 by the cold read" details a count already given; "1 transcription not written" is an outcome of its own.
    .map((seg) => /^\s*(\d+)\s+(?!(?:by|at|in|from|of|on|via|per)\b)\p{L}/u.exec(seg)?.[1])
    .reduce((a, n) => a + (n ? Number(n) : 0), 0);
  return { drafted: Number(drafted[1]), discarded: Number(discarded[1]), outcomes };
}
