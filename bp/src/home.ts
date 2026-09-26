import { join, resolve } from 'node:path';
import { exists, isDirectory, listDir, readTextIfExists } from './core/fsx.ts';
import { halt } from './core/errors.ts';
import { normaliseId } from './target/notion.ts';

// targets.md §5 — the single home of where the working folder lives, and its resolution order.

export type HomeResolution =
  | { kind: 'resolved'; home: string; via: 'named' | 'wiki' | 'standalone'; note?: string }
  | { kind: 'ambiguous'; candidates: string[] };

const isRealWiki = (dir: string): boolean => exists(join(dir, '.internal', 'plan.yaml'));

/** Resolve `<home>` from the workspace, in §5's order. */
export function resolveHome(workspace: string, named?: string): HomeResolution {
  if (named) return { kind: 'resolved', home: resolve(workspace, named), via: 'named' };
  const wikis = listDir(workspace)
    .filter((n) => n.startsWith('wiki-'))
    .map((n) => join(workspace, n))
    .filter(isDirectory);
  if (wikis.length === 1 && wikis[0]) {
    const w = wikis[0];
    return {
      kind: 'resolved',
      home: join(w, 'blueprint'),
      via: 'wiki',
      ...(isRealWiki(w) ? {} : { note: `${w} is not a wiki-system wiki yet (no .internal/plan.yaml)` }),
    };
  }
  if (wikis.length > 1) {
    const marked = wikis.filter(isRealWiki);
    if (marked.length === 1 && marked[0]) return { kind: 'resolved', home: join(marked[0], 'blueprint'), via: 'wiki' };
    if (marked.length > 1) return { kind: 'ambiguous', candidates: marked };
    return {
      kind: 'resolved',
      home: join(workspace, '.blueprint'),
      via: 'standalone',
      note: `several wiki folders and none marked (${wikis.join(', ')}) — fell through to .blueprint/`,
    };
  }
  return { kind: 'resolved', home: join(workspace, '.blueprint'), via: 'standalone' };
}

/**
 * The two pre-v33 locations (§5's rename route): `.blueprint/` in the workspace, and `<blueprint-dir>/internal/` beside a
 * local Blueprint — searched for up to three levels below the workspace, because until the move nothing records where the
 * human put the document.
 */
export function legacyLocations(workspace: string, home: string): string[] {
  const out: string[] = [];
  const dot = join(workspace, '.blueprint');
  if (resolve(dot) !== resolve(home) && exists(join(dot, 'target.md'))) out.push(dot);
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const name of listDir(dir)) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (!isDirectory(p)) continue;
      if (name === 'internal' && exists(join(p, 'target.md')) && resolve(p) !== resolve(home)) out.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(workspace, 1);
  return out;
}

/** Where the record is now: `<home>`, or a pre-v33 location a write run has yet to move (targets §5). */
export function currentHome(
  workspace: string,
  named?: string,
): { home: string; current: string } | { ambiguous: string[] } {
  const res = resolveHome(workspace, named);
  if (res.kind === 'ambiguous') return { ambiguous: res.candidates };
  if (exists(join(res.home, 'target.md'))) return { home: res.home, current: res.home };
  const legacy = legacyLocations(workspace, res.home)[0];
  return { home: res.home, current: legacy ?? res.home };
}

export type TargetKind = 'notion' | 'local';

export interface TargetInfo {
  kind: TargetKind;
  /** Notion: the overview page id (canonical). Local: the document folder, absolute. */
  address: string;
  /** Notion only: the environment variable naming a REST token, when one is configured. */
  tokenEnv?: string;
  raw: string;
}

/**
 * Read `target.md`. Three styles exist in the wild — `key: value` lines (v37), bold-label bullets (v21), and prose — so
 * the parse looks for the facts, not a layout: the kind, then a 32-hex page id or a path.
 */
export function readTarget(home: string): TargetInfo | undefined {
  const raw = readTextIfExists(join(home, 'target.md'));
  if (raw === undefined) return undefined;
  const kindLine = /\bkind\b[^:\n]*:\**\s*`?(notion|local|markdown|local-markdown|folder)\b/i.exec(raw);
  const kindWord = kindLine?.[1]?.toLowerCase();
  const kind: TargetKind | undefined = kindWord === 'notion' ? 'notion' : kindWord ? 'local' : undefined;
  if (!kind)
    throw halt(`${join(home, 'target.md')} names no target kind`, 'it should say `kind: notion` or `kind: local`');
  const tokenEnv = /\btoken_env\s*:\s*`?([A-Z_][A-Z0-9_]*)/.exec(raw)?.[1];
  if (kind === 'notion') {
    const idLine =
      /(?:overview_page_id|page id|address)[^\n]*?([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i.exec(
        raw,
      ) ?? /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i.exec(raw);
    if (!idLine?.[1]) throw halt(`${join(home, 'target.md')} names a Notion target but no overview page id`);
    return { kind, address: normaliseId(idLine[1]), ...(tokenEnv ? { tokenEnv } : {}), raw };
  }
  const path = /\bpath\s*:\**\s*`?([^`\n]+?)`?\s*$/im.exec(raw)?.[1];
  return { kind, address: resolve(home, path ?? 'document'), raw };
}
