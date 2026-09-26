import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { fixedClock } from '../../src/core/clock.ts';
import { seededRand } from '../../src/core/rand.ts';
import { makeCtx, type Ctx } from '../../src/context.ts';
import { main } from '../../src/cli.ts';
import type { ExitCode } from '../../src/core/errors.ts';

// Shared test support (testing §6.1): one factory per domain shape, hermetic temp directories wiped after each file,
// an injected clock and seeded randomness (testing §2.4).

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BP_ROOT = join(SKILL_ROOT, 'bp');

const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A fresh temp directory, removed when the test file finishes. */
export function tempDir(prefix = 'bp-test-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

export function writeFile(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

export const readFile = (path: string): string => readFileSync(path, 'utf8');
export const fileExists = (path: string): boolean => existsSync(path);

/** 2026-09-25 14:07 in the machine's local time — tests that print dates build them from this same Date. */
export const NOW_ISO = '2026-09-25T14:07:00';

export interface TestCtx {
  ctx: Ctx;
  out: string[];
  err: string[];
}

export function testCtx(
  opts: {
    workspace?: string;
    skillRoot?: string;
    now?: string;
    seed?: number;
    env?: Record<string, string | undefined>;
  } = {},
): TestCtx {
  const out: string[] = [];
  const err: string[] = [];
  const ctx = makeCtx({
    skillRoot: opts.skillRoot ?? SKILL_ROOT,
    workspace: opts.workspace ?? tempDir(),
    clock: fixedClock(opts.now ?? NOW_ISO),
    rand: seededRand(opts.seed ?? 7),
    env: opts.env ?? {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  });
  return { ctx, out, err };
}

export interface RunResult {
  code: ExitCode;
  out: string;
  err: string;
}

/** Run the CLI in-process, exactly as the `bp` wrapper would, against an injected context. */
export function run(argv: string[], opts: Parameters<typeof testCtx>[0] = {}): RunResult {
  const t = testCtx(opts);
  const code = main(argv, t.ctx);
  return { code, out: t.out.join('\n'), err: t.err.join('\n') };
}

/** A skill root with a VERSION file of our choosing, so version tests do not depend on the real VERSION. */
export function fakeSkillRoot(version: number): string {
  const d = tempDir('bp-skill-');
  writeFile(join(d, 'VERSION'), `${version}\n`);
  return d;
}

/** A working folder (`<home>`) with an optional run log and target.md. */
export function makeHome(opts: { log?: string; target?: string } = {}): string {
  const home = join(tempDir('bp-home-'), 'blueprint');
  mkdirSync(join(home, 'record'), { recursive: true });
  if (opts.log !== undefined) writeFile(join(home, 'record', 'run-log.md'), opts.log);
  if (opts.target !== undefined) writeFile(join(home, 'target.md'), opts.target);
  return home;
}

// ---- synthetic session transcripts (DESIGN.md §5.2) ------------------------------------------------------------------

export interface FakeCall {
  id: string;
  name: string;
  input: unknown;
  /** The tool result content: a string, or text blocks. */
  result: string | { type: 'text'; text: string }[];
  isError?: boolean;
  at: string;
}

/** Write a transcript JSONL in Claude Code's shape: an assistant tool_use event, then a user tool_result event. */
export function writeTranscript(path: string, calls: FakeCall[], noise = true): string {
  const lines: string[] = [];
  if (noise) lines.push('not json at all', JSON.stringify({ type: 'system', message: 'no content array' }));
  for (const c of calls) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: c.at,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }] },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: c.at,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: c.id, content: c.result, ...(c.isError ? { is_error: true } : {}) },
          ],
        },
      }),
    );
  }
  return writeFile(path, `${lines.join('\n')}\n`);
}

/** The connector's fetch result for a page, in the shape observed in real transcripts (DESIGN.md §5.3). */
export function fetchResult(opts: {
  id: string;
  properties: Record<string, unknown>;
  content: string;
  title?: string;
}): string {
  const url = `https://app.notion.com/p/${opts.id}`;
  const text = [
    `Here is the result of "fetch" for the Page with URL ${url} as of 2026-09-25T11:00:00.000Z:`,
    `<page url="${url}">`,
    '<ancestor-path>',
    '<parent-data-source url="collection://00000000-0000-0000-0000-000000000001" name="Features"/>',
    '</ancestor-path>',
    '<properties>',
    JSON.stringify(opts.properties),
    '</properties>',
    '<iconMetadata>null</iconMetadata>',
    '<content>',
    opts.content,
    '</content>',
    '</page>',
  ].join('\n');
  return JSON.stringify({ metadata: { type: 'page' }, title: opts.title ?? 'page', url, text });
}

/** The human says something in the session: one user turn appended to the main transcript (DESIGN.md §8). */
export function say(transcript: string, text: string, at = '2026-09-25T12:00:00.000Z'): void {
  appendFileSync(
    transcript,
    `${JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } })}\n`,
  );
}
