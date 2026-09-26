import { isRecord } from '../core/schema.ts';

// Parsing what the hosted Notion connector returns (DESIGN.md §5.3). Formats as observed in real v37 transcripts:
//   fetch  → JSON { metadata, title, url, text } where text holds
//            `<page url="…">…<properties>{json}</properties>…<content>\n…\n</content>\n</page>`
//   query  → JSON { results: [ { url, …columns } ], has_more, data_source_ids }
// Rich text in properties uses `<br>` for a newline; relations are arrays of page URLs (on a page) or a JSON-encoded
// string of them (in a query), or null.

/** A Notion id in canonical form: 32 lowercase hex, no hyphens, no URL. */
export function normaliseId(idOrUrl: string): string {
  const hex = idOrUrl.toLowerCase().replace(/-/g, '');
  const m = /([0-9a-f]{32})(?![0-9a-f])/.exec(hex);
  return m?.[1] ?? idOrUrl.trim().toLowerCase();
}

export interface FetchedPage {
  /** The connector reported the content as truncated or carrying blocks it could not render — not a complete read. */
  truncated: boolean;
  url: string;
  id: string;
  properties: Record<string, unknown>;
  /** The page content exactly as returned — escapes such as `\[` kept, because hashes are over the text as returned. */
  content: string;
  /** Child databases the content embeds or links: `<database url=… data-source-url=…>`. */
  databases: { url: string; dataSourceUrl: string | null; inline: boolean; title: string }[];
}

function isTruncated(result: string): boolean {
  const trimmed = result.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return false;
    const unknownBlocks = parsed['unknown_block_count'];
    return parsed['truncated'] === true || (typeof unknownBlocks === 'number' && unknownBlocks > 0);
  } catch {
    return false;
  }
}

/** A connector result's text: the `text` field when the result is the connector's JSON envelope, else the result itself. */
export function connectorText(result: string): string {
  const trimmed = result.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed) && typeof parsed['text'] === 'string') return parsed['text'];
    } catch {
      // not JSON — treat as the text itself
    }
  }
  return result;
}

export function parseFetch(result: string): FetchedPage | null {
  const text = connectorText(result);
  const page = /<page url="([^"]+)"/.exec(text);
  if (!page?.[1]) return null;
  let properties: Record<string, unknown> = {};
  // Anchored on the line structure: a JSON-encoded value cannot hold a raw newline, so "\n</properties>" at the start of
  // a line is the real end even where a value contains the text "</properties>".
  const props =
    /(?:^|\n)<properties>\n([\s\S]*?)\n<\/properties>(?=\n|$)/.exec(text) ??
    /<properties>\n?([\s\S]*?)\n?<\/properties>/.exec(text);
  if (props?.[1]) {
    try {
      const parsed: unknown = JSON.parse(props[1]);
      if (isRecord(parsed)) properties = parsed;
    } catch {
      properties = {};
    }
  }
  // The content tag is searched for only after the properties block: a property value may itself contain '<content>'.
  const afterProps = props ? (props.index ?? 0) + props[0].length : 0;
  const contentStart =
    text.indexOf('\n<content>', afterProps) >= 0
      ? text.indexOf('\n<content>', afterProps) + 1
      : text.indexOf('<content>', afterProps);
  // The content ends at the LAST "</content>" that closes the page: a page's own text may say "</content>", and a result
  // cut off mid-page has no closing pair at all — which is a truncated read, never an empty or partial body read as whole.
  const close = /<\/content>\s*<\/page>\s*$/.exec(text);
  const contentEnd = close ? close.index : -1;
  const cutOff = contentStart >= 0 && contentEnd < 0;
  let content = '';
  if (cutOff) content = text.slice(contentStart + '<content>'.length).replace(/^\n/, '');
  if (contentStart >= 0 && contentEnd > contentStart) {
    content = text.slice(contentStart + '<content>'.length, contentEnd);
    if (content.startsWith('\n')) content = content.slice(1);
    if (content.endsWith('\n')) content = content.slice(0, -1);
  }
  const databases = [...content.matchAll(/<database url="([^"]+)"([^>]*)>([^<]*)<\/database>/g)].map((m) => {
    const attrs = m[2] ?? '';
    return {
      url: m[1] ?? '',
      dataSourceUrl: /data-source-url="([^"]+)"/.exec(attrs)?.[1] ?? null,
      inline: /inline="true"/.test(attrs),
      title: (m[3] ?? '').trim(),
    };
  });
  return {
    truncated: isTruncated(result) || cutOff,
    url: page[1],
    id: normaliseId(page[1]),
    properties,
    content,
    databases,
  };
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  /** True when more rows exist, or when the read reports itself incomplete (notion-mechanics §4's silent-truncation trap). */
  hasMore: boolean;
}

export function parseQuery(result: string): QueryResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['results'])) return null;
  const rows = (parsed['results'] as unknown[]).filter(isRecord);
  const status = parsed['request_status'];
  const incomplete = isRecord(status) && status['type'] === 'incomplete';
  return { rows, hasMore: parsed['has_more'] === true || incomplete };
}

/** `<br>` → newline, for a rich-text property value. */
export function richText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/<br\s*\/?>/g, '\n');
}

/** A relation value in either form (array of URLs, JSON-encoded string, null) → canonical ids. */
export function relationIds(v: unknown): string[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = [v];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string').map(normaliseId);
}

/** notion-mechanics §4: a relation read off a page truncates at 25 references and does not say so. */
export const RELATION_TRUNCATION = 25;
