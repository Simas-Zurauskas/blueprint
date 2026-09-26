import { join, resolve, sep } from 'node:path';
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { exists, isDirectory, listDir, readTextIfExists } from '../core/fsx.ts';
import { usage } from '../core/errors.ts';
import { isRecord } from '../core/schema.ts';

// The session transcript as a read-only data source (DESIGN.md §5.2). Claude Code writes every tool call and its result
// to `~/.claude/projects/<project>/<session-id>.jsonl`, and subagents to `<session-id>/subagents/agent-*.jsonl`. Reading
// a connector's result from here means the model never retypes fetched text to get it to bp — the step every v37 run
// skipped ("copying the whole body back … was judged not worth it").
//
// The transcript format is Claude Code's, not ours: every read is defensive, a malformed line is skipped, and a missing
// transcript is a usage error naming the fallback (`--file`).

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  timestamp: string;
  file: string;
  result?: ToolResult;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  timestamp: string;
}

export interface TranscriptSet {
  main: string;
  subagents: string[];
}

/**
 * Locate the transcripts for a session. `explicit` (a path) wins; otherwise the session id the caller passes — bp never
 * reads the process environment behind its caller's back, so a test's injected environment is the whole environment.
 */
export function locateTranscripts(
  opts: { explicit?: string; sessionId?: string; projectsDir?: string } = {},
): TranscriptSet {
  if (opts.explicit) {
    if (!exists(opts.explicit)) throw usage(`no transcript at ${opts.explicit}`);
    const dir = opts.explicit.replace(/\.jsonl$/, '');
    return { main: opts.explicit, subagents: subagentFiles(dir) };
  }
  const sid = opts.sessionId;
  if (!sid)
    throw usage(
      'no session transcript: CLAUDE_CODE_SESSION_ID is not set',
      'pass --transcript <path>, or save results to files and pass --file',
    );
  if (!/^[\w-]{8,80}$/.test(sid)) throw usage(`"${sid}" is not a session id`);
  // Only the caller's projects directory, derived from the injected HOME — never the process's own home behind its back.
  const projects = opts.projectsDir;
  if (!projects)
    throw usage('no projects directory to find the session transcript in: HOME is not set', 'pass --transcript <path>');
  for (const project of listDir(projects)) {
    const candidate = join(projects, project, `${sid}.jsonl`);
    if (exists(candidate)) return { main: candidate, subagents: subagentFiles(join(projects, project, sid)) };
  }
  throw usage(
    `no transcript for session ${sid} under ${projects}`,
    'pass --transcript <path>, or save results to files and pass --file',
  );
}

function subagentFiles(sessionDir: string): string[] {
  const dir = join(sessionDir, 'subagents');
  if (!isDirectory(dir)) return [];
  return listDir(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f));
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (isRecord(b) && typeof b['text'] === 'string' ? b['text'] : '')).join('');
  }
  return '';
}

// Two shapes Claude Code uses for a result too large to keep inline: `Full output saved to: <path>` (shell output) and
// `Error: result (…) exceeds maximum allowed tokens. Output has been saved to <path>.` (an MCP result — not an error:
// is_error is unset and the file holds the full result). The pointer is honoured only when the WHOLE result is that
// notice (it opens the result) and the path is a tool-results file of the same session — a fetched page whose text
// merely mentions such a phrase is page text, never a pointer.
const PERSISTED_RE =
  /^(?:Error: result \([^)]*\) exceeds maximum allowed tokens\. )?(?:Full output saved to:|Output has been saved to)\s*(\S+?)[.,;]?(?=\s|$)/;

function persistedPath(text: string, file: string): string | null {
  const m = PERSISTED_RE.exec(text.trimStart());
  if (!m?.[1]) return null;
  const sessionDir = file.replace(/\/subagents\/[^/]+$/, '').replace(/\.jsonl$/, '');
  // Normalised before the prefix test (a `..` never climbs out), then checked again through every symlink.
  const root = `${resolve(sessionDir, 'tool-results')}${sep}`;
  const path = resolve(m[1]);
  if (!path.startsWith(root)) return null;
  try {
    const real = realpathSync(path);
    const realRoot = `${realpathSync(resolve(sessionDir, 'tool-results'))}${sep}`;
    return real.startsWith(realRoot) && statSync(real).isFile() ? real : null;
  } catch {
    return path; // gone: the caller records the call as an error, so it is made again
  }
}

/** The connector calls bp reads — the only results whose saved-output pointer is followed. */
const CONSUMED =
  /(?:^|__|-)notion-(?:fetch|query-data-sources|update-page|create-pages|update-data-source|create-database|create-view)$/;

/** Lines of a file, read in chunks so a transcript of any size streams rather than landing in one string. */
function* fileLines(path: string): Generator<string> {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    // A streaming decoder: a multi-byte character split across two chunks is held back and completed, never replaced.
    const decoder = new TextDecoder('utf-8');
    let rest = '';
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) {
        rest += decoder.decode();
        break;
      }
      const chunk = rest + decoder.decode(buf.subarray(0, n), { stream: true });
      const parts = chunk.split('\n');
      rest = parts.pop() ?? '';
      yield* parts;
    }
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}

/** Every tool call in one transcript file, with its result where the result is in the same file. */
export function readToolCalls(file: string): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  const order: string[] = [];
  for (const line of fileLines(file)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    const timestamp = typeof event['timestamp'] === 'string' ? event['timestamp'] : '';
    const message = event['message'];
    if (!isRecord(message) || !Array.isArray(message['content'])) continue;
    for (const block of message['content'] as unknown[]) {
      if (!isRecord(block)) continue;
      if (block['type'] === 'tool_use' && typeof block['id'] === 'string' && typeof block['name'] === 'string') {
        calls.set(block['id'], { id: block['id'], name: block['name'], input: block['input'], timestamp, file });
        order.push(block['id']);
      } else if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
        const call = calls.get(block['tool_use_id']);
        if (!call) continue;
        let text = blockText(block['content']);
        const pointer = CONSUMED.test(call.name) ? persistedPath(text, file) : null;
        let unavailable = false;
        if (pointer) {
          const full = readTextIfExists(pointer);
          if (full === undefined) unavailable = true;
          else text = full;
        }
        // A pointer whose file is gone is not a result: the preview is truncated, and using it would be a confident
        // wrong read. It is recorded as an error so the call is made again.
        call.result = {
          text: unavailable ? `the full result was saved to ${pointer ?? '?'}, which no longer exists` : text,
          isError: unavailable || block['is_error'] === true,
          timestamp,
        };
      }
    }
  }
  return order.map((id) => calls.get(id)).filter((c): c is ToolCall => c !== undefined);
}

/** A message the human sent: a main-thread user turn that is not a tool result, not a subagent's, not injected. */
export interface HumanTurn {
  text: string;
  timestamp: string;
}

/**
 * The human's own turns in the main session transcript (DESIGN.md §8). Tool results, subagent threads (`isSidechain`),
 * meta messages and the harness's `<system-reminder>` blocks are not the human's words and are never read as them.
 */
export function humanTurns(file: string): HumanTurn[] {
  const out: HumanTurn[] = [];
  for (const line of fileLines(file)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event['type'] !== 'user' || event['isSidechain'] === true || event['isMeta'] === true)
      continue;
    const message = event['message'];
    if (!isRecord(message)) continue;
    const content = message['content'];
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      if (content.some((b) => isRecord(b) && b['type'] === 'tool_result')) continue;
      text = content
        .map((b) => (isRecord(b) && b['type'] === 'text' && typeof b['text'] === 'string' ? b['text'] : ''))
        .join('\n');
    }
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    if (text.trim()) out.push({ text, timestamp: typeof event['timestamp'] === 'string' ? event['timestamp'] : '' });
  }
  return out;
}

/** An ISO timestamp as milliseconds; NaN for anything unparseable (never compared as a string: '.500Z' < 'Z'). */
export const instant = (iso: string): number => Date.parse(iso);

export function readAllToolCalls(set: TranscriptSet): ToolCall[] {
  return [set.main, ...set.subagents]
    .flatMap(readToolCalls)
    .sort((a, b) => (instant(a.timestamp) || 0) - (instant(b.timestamp) || 0));
}

/**
 * Canonical JSON with sorted keys, for deep-equality of tool inputs. A string holding a JSON array (a relation value such as
 * `Touches`) compares equal to that array: the connector accepts both, and a relay passing one for the other made the same
 * write, so it must be found — a measured run created a row twice before this.
 */
export function canonicalJson(v: unknown): string {
  if (typeof v === 'string' && v.startsWith('[') && v.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return canonicalJson(parsed);
    } catch {
      // not JSON — compared as the string it is
    }
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** A tool name matches on its suffix, so `mcp__notion__notion-fetch` and `mcp__claude_ai_Notion__notion-fetch` both match. */
export const toolMatches = (name: string, suffix: string): boolean => name === suffix || name.endsWith(`__${suffix}`);

/** The newest call to `tool` whose input satisfies `match`, with a result, optionally no earlier than `after` (ISO). */
export function latestCall(
  calls: readonly ToolCall[],
  tool: string,
  match: (input: unknown) => boolean,
  after?: string,
): ToolCall | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (!c?.result) continue;
    if (after !== undefined) {
      const t = instant(c.timestamp);
      const floor = instant(after);
      if (Number.isNaN(t) || (!Number.isNaN(floor) && t < floor)) continue;
    }
    if (toolMatches(c.name, tool) && match(c.input)) return c;
  }
  return undefined;
}
