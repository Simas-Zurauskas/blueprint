import { lines as splitLines } from '../core/text.ts';
import { OVERVIEW_BLOCKS, type OverviewBlock } from './vocab.ts';

// The overview page (doc-shape.md §3): capped human blocks, and `⟳` views (Notion) or `⟳` generated lists (local).

export interface OverviewSection {
  heading: string;
  known: OverviewBlock | null;
  generated: boolean;
  lines: string[];
  start: number;
  end: number;
}

export interface ParsedOverview {
  sections: OverviewSection[];
  block(name: OverviewBlock): OverviewSection | undefined;
}

const known = (h: string): OverviewBlock | null => {
  const clean = h.replace(/^⟳\s*/, '').trim();
  return (OVERVIEW_BLOCKS as readonly string[]).includes(clean) ? (clean as OverviewBlock) : null; // checked by includes
};

export function parseOverview(content: string): ParsedOverview {
  const all = splitLines(content);
  const sections: OverviewSection[] = [];
  all.forEach((line, i) => {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m?.[1]) return;
    const prev = sections[sections.length - 1];
    if (prev) {
      prev.end = i;
      prev.lines = all.slice(prev.start + 1, i);
    }
    sections.push({
      heading: m[1],
      known: known(m[1]),
      generated: m[1].startsWith('⟳'),
      lines: [],
      start: i,
      end: all.length,
    });
  });
  const last = sections[sections.length - 1];
  if (last) last.lines = all.slice(last.start + 1);
  return { sections, block: (name) => sections.find((s) => s.known === name && !s.generated) };
}

/**
 * A machine-local path in `Links` or `Operating` (doc-shape §3, v37; status C8): a filesystem path in any form, relative
 * or absolute, or a working-folder path — anything that opens only on the machine that wrote it.
 */
export function machineLocalPaths(text: string): string[] {
  const out = new Set<string>();
  // Web URLs are what Links should carry; a file:// URL is a machine-local path by another name (HISTORY v37).
  const withoutUrls = text.replace(/https?:\/\/\S+/g, ' ');
  for (const raw of withoutUrls.split(/[\s()`"'<>[\]]+/)) {
    const token = raw.replace(/^[*_]+|[*_,;:!?]+$/g, '').replace(/\.$/, '');
    if (token && isLocalPath(token)) out.add(token);
  }
  return [...out];
}

function isLocalPath(t: string): boolean {
  if (/^file:\/\//i.test(t)) return true;
  if (/^[A-Za-z]:\\/.test(t)) return true; // a Windows drive
  if (/^(?:~|\.{1,2})\//.test(t)) return true; // home-relative, ./ and ../
  if (!t.includes('/')) return false;
  if (/^\/[^/\s]+\/./.test(t) || /^\/[^/\s]+\.[A-Za-z0-9]{1,5}$/.test(t)) return true; // absolute, any volume
  if (/^(?:\.blueprint|sources|record|cache|wiki-[\w-]+)\//.test(t)) return true; // the working folder's own trees
  // A relative path: a folder named with its trailing slash (`DATA/`), or a path ending in a file name with an extension.
  // Prose slashes — 24/7, iOS/Android, and/or — are neither.
  return /^[\w.-]+\/(?:[\w .-]+\/)*$/.test(t) || /^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,5}$/.test(t);
}
