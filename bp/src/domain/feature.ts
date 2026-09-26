import { findMarkers, lines as splitLines, type MarkerMatch } from '../core/text.ts';
import { FEATURE_BLOCKS, type FeatureBlock } from './vocab.ts';

// The feature row body (doc-shape.md §5), parsed as a *view over the raw text*: every element keeps the exact line range
// it came from, so a later write replaces one block's exact text and nothing else can change (the round-trip law in
// DESIGN.md §3.1 holds by construction — bp never re-serialises a body it only read).

export interface Block {
  /** The heading text after `## `. */
  name: string;
  /** Which of the five named blocks this is, or null for a heading doc-shape does not define. */
  known: FeatureBlock | null;
  /** 0-based line index of the heading, and one past the block's last line. */
  start: number;
  end: number;
  /** The block's lines after the heading. */
  lines: string[];
  /** The block exactly as written, heading included. */
  raw: string;
}

export interface Requirement {
  n: number;
  /** The requirement sentence after `FR-n —`. */
  text: string;
  /** A tombstone: `FR-4 — *withdrawn 2026-08-04, replaced by FR-7. No behaviour here.*` (doc-shape §8). */
  withdrawn: boolean;
  /** Provenance lines (`*(Applied … )*`) directly beneath it. */
  provenance: string[];
  /** 0-based line index within the whole body. */
  line: number;
  /** `· depth n` from its newest provenance line; absent means depth 1 to every reader (doc-shape §5). */
  depth: number;
}

export interface LabelledLine {
  kind: 'default' | 'slot' | 'fix';
  text: string;
  line: number;
  block: string;
  /** For a default: ratified, or awaiting ratification. */
  ratified?: boolean;
  /** For a default or fix: the run id in its tag. */
  runId?: string;
  /** For a content slot: who the line says supplies it. */
  suppliedBy?: string;
}

export interface BodyMarker extends MarkerMatch {
  block: string;
  /** The requirement the marker sits on, where it sits on an FR line. */
  fr?: number;
  line: number;
  link: MarkerLink;
}

export type MarkerLink =
  /** A row named by a Notion id (in a URL, a mention or bare) or a local `q-NN` key. */
  | { kind: 'question'; id?: string; key?: string }
  | { kind: 'carried'; detail: string }
  | { kind: 'default'; runId: string; n: number | null }
  | { kind: 'pending' }
  /** Link text that names no single row — "asked 2026-09-08, see this row's Questions" (an early form). */
  | { kind: 'unresolved'; text: string }
  | { kind: 'none' };

export interface ParsedBody {
  /** Text before the first `## ` heading (should be empty; carried, never dropped). */
  preamble: string[];
  blocks: Block[];
  requirements: Requirement[];
  /** Behaviour lines that are neither an FR, a provenance line nor a labelled line — load-bearing unnumbered text (C11). */
  unnumbered: { text: string; line: number }[];
  labelled: LabelledLine[];
  markers: BodyMarker[];
  notDoing: { text: string; line: number; hasBecause: boolean; hasRevisit: boolean }[];
  /** doc-shape §5's five blocks that are absent. */
  missing: FeatureBlock[];
  /** Headings doc-shape does not define — kept, reported, never rewritten. */
  foreign: string[];
}

const FR_RE = /^\s*(?:[-*]\s+)?\**FR-(\d+)\**\s*(?:[—–-]|:)\s*(.*)$/;
const PROVENANCE_RE = /^\s*\*\(.*\)\*\s*$/;
const DEPTH_RE = /·\s*depth\s+(\d+)/;
const DEFAULT_RE =
  /^\s*(?:[-*]\s+)?Default \((standard practice|adopted from [^)]*?)\s*[—–-]\s*(ratify on review|ratified [^)]*)\)\s*:?\s*(.*)$/;
const SLOT_RE = /^\s*(?:[-*]\s+)?Content slot\s*[—–-]\s*client-supplied:\s*(.*)$/;

const ID_RE = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i;

/** Read a marker's link (doc-shape §9): `→ Question: <link to the row>`, `→ Question: carried …`, `→ Default: ledger <run> #n`. */
export function markerLink(inner: string): MarkerLink {
  const arrow = /→\s*(Question|Default)\s*:\s*(.*)$/.exec(inner);
  if (!arrow?.[1]) return { kind: 'none' };
  const target = (arrow[2] ?? '').trim();
  if (arrow[1] === 'Default') {
    const m = /ledger\s+([\w-]+)(?:\s*#\s*(\d+))?/.exec(target);
    return m?.[1] ? { kind: 'default', runId: m[1], n: m[2] ? Number(m[2]) : null } : { kind: 'none' };
  }
  if (/^carried\b/.test(target)) return { kind: 'carried', detail: target.replace(/^carried\s*/, '') };
  if (/^pending\b/.test(target)) return { kind: 'pending' };
  const id = ID_RE.exec(target)?.[1];
  if (id) return { kind: 'question', id: id.replace(/-/g, '').toLowerCase() };
  const key = /\b(q-\d+)\b/.exec(target)?.[1];
  if (key) return { kind: 'question', key };
  return target ? { kind: 'unresolved', text: target } : { kind: 'none' };
}

function knownBlock(name: string): FeatureBlock | null {
  return (FEATURE_BLOCKS as readonly string[]).includes(name) ? (name as FeatureBlock) : null; // checked by includes
}

/** doc-shape §5's tombstone: `FR-4 — *withdrawn 2026-08-04, replaced by FR-7. No behaviour here.*` — lower-case, italic, dated. */
const TOMBSTONE_RE = /^[*_]withdrawn\b|^withdrawn \d{4}-\d{2}-\d{2}\b/;

export function parseBody(content: string): ParsedBody {
  const all = splitLines(content.replace(/^\uFEFF/, ''));
  const blocks: Block[] = [];
  let firstHeading = all.length;
  let fence = false;
  for (let i = 0; i < all.length; i++) {
    // A `## ` line inside a code fence is code, not a block heading.
    if (/^\s*```/.test(all[i] ?? '')) fence = !fence;
    if (fence) continue;
    const m = /^## +(.+?)\s*$/.exec(all[i] ?? '');
    if (!m?.[1]) continue;
    if (firstHeading === all.length) firstHeading = i;
    const prev = blocks[blocks.length - 1];
    if (prev) {
      prev.end = i;
      prev.lines = all.slice(prev.start + 1, i);
      prev.raw = all.slice(prev.start, i).join('\n');
    }
    blocks.push({ name: m[1], known: knownBlock(m[1]), start: i, end: all.length, lines: [], raw: '' });
  }
  const last = blocks[blocks.length - 1];
  if (last) {
    last.lines = all.slice(last.start + 1);
    last.raw = all.slice(last.start).join('\n');
  }

  const requirements: Requirement[] = [];
  const unnumbered: ParsedBody['unnumbered'] = [];
  const labelled: LabelledLine[] = [];
  const markers: BodyMarker[] = [];
  const notDoing: ParsedBody['notDoing'] = [];

  for (const b of blocks) {
    let lastFr: Requirement | undefined;
    b.lines.forEach((text, k) => {
      const line = b.start + 1 + k;
      const fr = b.known === 'Behaviour' ? FR_RE.exec(text) : null;
      const onFr = fr?.[1] ? Number(fr[1]) : undefined;
      for (const m of findMarkers(text)) {
        markers.push({
          ...m,
          block: b.name,
          line,
          link: markerLink(m.inner),
          ...(onFr !== undefined ? { fr: onFr } : lastFr && PROVENANCE_RE.test(text) ? { fr: lastFr.n } : {}),
        });
      }
      const def = DEFAULT_RE.exec(text);
      if (def) {
        const tag = /\(run ([0-9a-f]{6})\b/.exec(text) ?? /\brun ([0-9a-f]{6})\b/.exec(text);
        labelled.push({
          kind: 'default',
          text: text.trim(),
          line,
          block: b.name,
          ratified: /^ratified/.test(def[2] ?? ''),
          ...(tag?.[1] ? { runId: tag[1] } : {}),
        });
        return;
      }
      const slot = SLOT_RE.exec(text);
      if (slot) {
        const by = /\bsupplied by\s+([^.·(]+?)\s*(?:[.·(]|$)/i.exec(slot[1] ?? '');
        labelled.push({
          kind: 'slot',
          text: text.trim(),
          line,
          block: b.name,
          ...(by?.[1] ? { suppliedBy: by[1].trim() } : {}),
        });
        return;
      }
      if (b.known === 'Behaviour') {
        if (fr?.[1]) {
          const body = fr[2] ?? '';
          lastFr = {
            n: Number(fr[1]),
            text: body.trim(),
            withdrawn: TOMBSTONE_RE.test(body.trim()),
            provenance: [],
            line,
            depth: 1,
          };
          requirements.push(lastFr);
          return;
        }
        if (PROVENANCE_RE.test(text) && lastFr) {
          lastFr.provenance.push(text.trim());
          const d = DEPTH_RE.exec(text);
          if (d?.[1]) lastFr.depth = Number(d[1]);
          return;
        }
        if (text.trim()) unnumbered.push({ text: text.trim(), line });
      }
      if (b.known === 'Not doing' && text.trim() && !PROVENANCE_RE.test(text)) {
        const t = text.trim();
        notDoing.push({ text: t, line, hasBecause: /\bbecause\b/i.test(t), hasRevisit: /\brevisit if\b/i.test(t) });
      }
    });
  }

  const present = new Set(blocks.map((b) => b.known).filter((k): k is FeatureBlock => k !== null));
  return {
    preamble: all.slice(0, firstHeading),
    blocks,
    requirements,
    unnumbered,
    labelled,
    markers,
    notDoing,
    missing: FEATURE_BLOCKS.filter((b) => !present.has(b)),
    foreign: blocks.filter((b) => b.known === null).map((b) => b.name),
  };
}

/** A live (not withdrawn) numbered requirement exists — the "fully written" test's second half (databases §4). */
export const hasNumberedRequirement = (b: ParsedBody): boolean => b.requirements.some((r) => !r.withdrawn);

/** The next free requirement number: never a reused one, never a renumbering (doc-shape §8). */
export const nextFreeFr = (b: ParsedBody): number => b.requirements.reduce((m, r) => Math.max(m, r.n), 0) + 1;
