import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BpError, EXIT } from '../src/core/errors.ts';
import { FEATURE_BLOCKS } from '../src/domain/vocab.ts';
import {
  RELATION_TRUNCATION,
  normaliseId,
  parseFetch,
  parseQuery,
  relationIds,
  richText,
} from '../src/target/notion.ts';
import {
  canonicalJson,
  latestCall,
  locateTranscripts,
  readAllToolCalls,
  readToolCalls,
  toolMatches,
  type ToolCall,
} from '../src/target/transcript.ts';
import { fetchResult, readFile, run, tempDir, writeFile, writeTranscript, type FakeCall } from './support/index.ts';

// The relay's read side (DESIGN.md §5.2 ingest, §5.3 parsing, §6 hashing) and the two commands built on it:
// `bp hash fetch --page <id> --transcript <path>` and `bp quote check --page <id> --transcript <path>`.
// Every expected value below is hand-derived; the hashes were computed with `shasum -a 256` over a file holding the
// body after applying targets §5's normalisation by hand (see BODY_A / BODY_B).

// ---- fixtures ---------------------------------------------------------------------------------------------------------

const PAGE = '1a2b3c4d5e6f40718293a4b5c6d7e8f9';
const PAGE_HYPHENATED = '1A2B3C4D-5E6F-4071-8293-A4B5C6D7E8F9';
const PAGE_URL = `https://www.notion.so/acme/Checkout-${PAGE}`;
const OTHER = 'aaaabbbbccccddddeeeeffff00001111';
const FETCH = 'mcp__notion__notion-fetch';

/**
 * A feature page body. Trailing spaces on the "slot." line and a trailing tab on the last line exercise the
 * normalisation; the `\[` escapes are Notion's round-trip escapes and must be hashed as returned (targets §5).
 */
const BODY_A = [
  'Lead paragraph above the body is not hashed.',
  '',
  '## Why',
  'Customers need to pay for a pickup slot.   ',
  '\\[NEEDS CLARIFICATION: which payment provider?\\]',
  '',
  '## Behaviour',
  '1. The app charges the card once — café pricing.\t',
].join('\n');
/*
 * BODY_A normalised by hand (from "## Why" to the end, trailing blanks stripped per line, no final newline):
 *   ## Why
 *   Customers need to pay for a pickup slot.
 *   \[NEEDS CLARIFICATION: which payment provider?\]
 *
 *   ## Behaviour
 *   1. The app charges the card once — café pricing.
 * `perl -0pe 's/\n\z//' bodyA.txt | shasum -a 256` →
 */
const BODY_A_SHA256 = '4b9bc4e1a206ca93669b61005e086c934ad272f33e27058fbe5e204d6b8d6d76';
const BODY_A_SHA12 = '4b9bc4e1a206';
/** `printf '%s' '## Behaviour\n1. The app charges the card once — café pricing.' | shasum -a 256`, first 12. */
const BEHAVIOUR_A_SHA12 = 'fb6504ec91bf';

/** A newer revision. `printf '%s' '## Why\nCustomers need to reserve a slot before paying.' | shasum -a 256`. */
const BODY_B = '## Why\nCustomers need to reserve a slot before paying.';
const BODY_B_SHA12 = '13ea89c69a65';

const T1 = '2026-09-25T11:00:01.000Z';
const T2 = '2026-09-25T11:00:02.000Z';
const T3 = '2026-09-25T11:00:03.000Z';

function fetchCall(opts: {
  id: string;
  content: string;
  at: string;
  inputId?: string;
  name?: string;
  props?: Record<string, unknown>;
  tool?: string;
}): FakeCall {
  return {
    id: `toolu_${opts.at.replace(/\D/g, '')}_${opts.id.slice(0, 4)}`,
    name: opts.tool ?? FETCH,
    input: { id: opts.inputId ?? opts.id },
    result: [
      {
        type: 'text',
        text: fetchResult({
          id: opts.id,
          properties: opts.props ?? { Name: opts.name ?? 'Checkout' },
          content: opts.content,
        }),
      },
    ],
    at: opts.at,
  };
}

/** A transcript file under its own temp directory, so `<session>/subagents/` can sit beside it. */
function transcriptAt(calls: FakeCall[], name = 'session.jsonl'): string {
  return writeTranscript(join(tempDir('bp-transcript-'), name), calls);
}

/**
 * Claude Code's layout for one session: `<projects>/<project>/<session-id>.jsonl`, with the session's own folder
 * `<project>/<session-id>/` beside it holding `tool-results/` and `subagents/`. Nothing is written yet.
 */
function sessionFiles(sessionId = 'sess-main-0001'): { projects: string; project: string; dir: string; file: string } {
  const projects = tempDir('bp-projects-');
  const project = join(projects, '-work-proj');
  return { projects, project, dir: join(project, sessionId), file: join(project, `${sessionId}.jsonl`) };
}

/** Raw Claude Code events, for shapes `writeTranscript` does not produce. */
const useEvent = (id: string, name: string, input: unknown, at: string): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
const resultEvent = (id: string, content: unknown, at: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'user',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] },
  });

function onlyCall(calls: readonly ToolCall[]): ToolCall {
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.ok(c);
  return c;
}

/** Walk a parsed JSON value by keys, without unsafe member access. */
function at(v: unknown, ...path: string[]): unknown {
  let cur = v;
  for (const k of path) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Set (or delete, with undefined) process environment variables for the duration of `fn`, then restore them. */
function withProcessEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const isUsage = (err: unknown): boolean => err instanceof BpError && err.code === EXIT.usage;
const byId =
  (id: string) =>
  (input: unknown): boolean =>
    at(input, 'id') === id;

// ---- readToolCalls ------------------------------------------------------------------------------------------------------

void describe('readToolCalls', () => {
  void test('skips malformed and non-message lines and still reads the calls around them', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(
      file,
      [
        'not json at all',
        '{"type":"assistant","timestamp":',
        '[1,2,3]',
        '42',
        JSON.stringify({ type: 'system', message: 'no content array' }),
        JSON.stringify({ type: 'user', message: { content: ['a string block', null, 7] } }),
        '',
        useEvent('toolu_1', FETCH, { id: PAGE }, T1),
        '{broken',
        resultEvent('toolu_1', 'the result', T1),
      ].join('\n'),
    );
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.id, 'toolu_1');
    assert.equal(c.result?.text, 'the result');
  });

  void test('records the call name, input, tool_use timestamp and file', () => {
    const file = transcriptAt([{ id: 'toolu_a', name: FETCH, input: { id: PAGE }, result: 'x', at: T2 }]);
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.name, FETCH);
    assert.deepEqual(c.input, { id: PAGE });
    assert.equal(c.timestamp, T2);
    assert.equal(c.file, file);
  });

  void test('takes a string tool_result content as the result text', () => {
    const file = transcriptAt([
      { id: 'toolu_s', name: FETCH, input: { id: PAGE }, result: 'plain string result', at: T1 },
    ]);
    assert.equal(onlyCall(readToolCalls(file)).result?.text, 'plain string result');
  });

  void test('joins text blocks of a tool_result in order', () => {
    const file = transcriptAt([
      {
        id: 'toolu_b',
        name: FETCH,
        input: { id: PAGE },
        result: [
          { type: 'text', text: '{"text":"<page ' },
          { type: 'text', text: 'url=…">"}' },
        ],
        at: T1,
      },
    ]);
    assert.equal(onlyCall(readToolCalls(file)).result?.text, '{"text":"<page url=…">"}');
  });

  void test('ignores non-text blocks in a tool_result', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(
      file,
      [
        useEvent('toolu_i', FETCH, { id: PAGE }, T1),
        resultEvent(
          'toolu_i',
          [
            { type: 'image', source: { type: 'base64', data: 'AAAA' } },
            { type: 'text', text: 'only this' },
          ],
          T1,
        ),
      ].join('\n'),
    );
    assert.equal(onlyCall(readToolCalls(file)).result?.text, 'only this');
  });

  void test('takes the result timestamp from the tool_result event, not the tool_use event', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(file, [useEvent('toolu_t', FETCH, { id: PAGE }, T1), resultEvent('toolu_t', 'r', T3)].join('\n'));
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.timestamp, T1);
    assert.equal(c.result?.timestamp, T3);
  });

  void test('marks a result flagged is_error as an error', () => {
    const file = transcriptAt([
      { id: 'toolu_e', name: FETCH, input: { id: PAGE }, result: 'object_not_found', isError: true, at: T1 },
    ]);
    assert.equal(onlyCall(readToolCalls(file)).result?.isError, true);
  });

  void test('a result without is_error is not an error', () => {
    const file = transcriptAt([{ id: 'toolu_ok', name: FETCH, input: { id: PAGE }, result: 'fine', at: T1 }]);
    assert.equal(onlyCall(readToolCalls(file)).result?.isError, false);
  });

  void test('follows a "Full output saved to:" pointer into the same session\'s tool-results/', () => {
    const { dir, file } = sessionFiles();
    const saved = writeFile(join(dir, 'tool-results', 'toolu_p.txt'), 'THE FULL OUTPUT');
    writeTranscript(file, [
      {
        id: 'toolu_p',
        name: FETCH,
        input: { id: PAGE },
        result: `Full output saved to: ${saved}\n\nPreview:\nTHE FU`,
        at: T1,
      },
    ]);
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.result?.text, 'THE FULL OUTPUT');
    assert.equal(c.result?.isError, false);
  });

  void test('follows the MCP "exceeds maximum allowed tokens" pointer, and the saved result is not an error', () => {
    // The notice opens with "Error:" but is_error is unset and the file holds the full result (transcript.ts contract).
    const { dir, file } = sessionFiles();
    const saved = writeFile(join(dir, 'tool-results', 'mcp-notion-fetch-1.txt'), 'THE FULL PAGE');
    const notice = `Error: result (61,234 characters) exceeds maximum allowed tokens. Output has been saved to ${saved}.\nUse offset and limit to read it.`;
    writeTranscript(file, [{ id: 'toolu_mcp', name: FETCH, input: { id: PAGE }, result: notice, at: T1 }]);
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.result?.text, 'THE FULL PAGE');
    assert.equal(c.result?.isError, false);
  });

  void test('a pointer whose saved file is gone is an error, never the preview', () => {
    const { dir, file } = sessionFiles();
    const missing = join(dir, 'tool-results', 'missing.txt');
    writeTranscript(file, [
      {
        id: 'toolu_m',
        name: FETCH,
        input: { id: PAGE },
        result: `Full output saved to: ${missing}\n\nPreview:\nTHE FU`,
        at: T1,
      },
    ]);
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.result?.isError, true);
    assert.ok(!(c.result?.text ?? '').includes('THE FU'), c.result?.text);
  });

  void test("a pointer to a file outside the session's tool-results/ is not followed: the text is the result", () => {
    const { file } = sessionFiles();
    const elsewhere = writeFile(join(tempDir(), 'tool-results', 'toolu_x.txt'), "SOMEONE ELSE'S FILE");
    const text = `Full output saved to: ${elsewhere}`;
    writeTranscript(file, [{ id: 'toolu_x', name: FETCH, input: { id: PAGE }, result: text, at: T1 }]);
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.result?.text, text);
    assert.equal(c.result?.isError, false);
  });

  void test("a pointer into another session's tool-results/ in the same project is not followed", () => {
    const { project, file } = sessionFiles();
    const other = writeFile(join(project, 'sess-other-0002', 'tool-results', 'toolu_o.txt'), 'OTHER SESSION');
    const text = `Full output saved to: ${other}`;
    writeTranscript(file, [{ id: 'toolu_o', name: FETCH, input: { id: PAGE }, result: text, at: T1 }]);
    assert.equal(onlyCall(readToolCalls(file)).result?.text, text);
  });

  void test('a result that only mentions the notice part-way through is page text, not a pointer', () => {
    const { dir, file } = sessionFiles();
    const saved = writeFile(join(dir, 'tool-results', 'toolu_q.txt'), 'NOT THIS');
    const text = `The runbook says: Full output saved to: ${saved}`;
    writeTranscript(file, [{ id: 'toolu_q', name: FETCH, input: { id: PAGE }, result: text, at: T1 }]);
    assert.equal(onlyCall(readToolCalls(file)).result?.text, text);
  });

  void test("a subagent's pointer into its parent session's tool-results/ is followed", () => {
    const { dir } = sessionFiles();
    const saved = writeFile(join(dir, 'tool-results', 'toolu_s.txt'), 'SUBAGENT FULL OUTPUT');
    const sub = writeTranscript(join(dir, 'subagents', 'agent-1.jsonl'), [
      { id: 'toolu_s', name: FETCH, input: { id: PAGE }, result: `Full output saved to: ${saved}`, at: T1 },
    ]);
    assert.equal(onlyCall(readToolCalls(sub)).result?.text, 'SUBAGENT FULL OUTPUT');
  });

  void test('reads a result line longer than one read chunk whole', () => {
    // Transcripts are read in chunks; a 1.5 MiB result line spans at least two of them.
    const big = `start ${'x'.repeat(1_572_864)} end`;
    const file = transcriptAt([{ id: 'toolu_big', name: FETCH, input: { id: PAGE }, result: big, at: T1 }]);
    const got = onlyCall(readToolCalls(file)).result?.text ?? '';
    // Compared piecewise so a failure prints a readable diff rather than 1.5 MiB of x.
    assert.deepEqual([got.length, got.slice(0, 8), got.slice(-6)], [big.length, 'start xx', 'xx end']);
    assert.ok(got === big, 'the middle of the line differs');
  });

  void test('a multi-byte character split across a read-chunk boundary is read intact', () => {
    // The em dash is 3 UTF-8 bytes (e2 80 94). Padding places its first byte at offset 1,048,575, so a reader that
    // decodes each 1 MiB (1,048,576-byte) chunk on its own splits it and reads U+FFFD instead.
    const file = join(tempDir(), 's.jsonl');
    const use = useEvent('toolu_u', FETCH, { id: PAGE }, T1);
    const head = `${use}\n${resultEvent('toolu_u', 'MARK', T1).split('MARK')[0] ?? ''}`;
    const pad = 1_048_575 - Buffer.byteLength(head, 'utf8');
    const text = `${'a'.repeat(pad)}— tail`;
    writeFile(file, `${use}\n${resultEvent('toolu_u', text, T1)}\n`);
    assert.equal(Buffer.from(readFile(file), 'utf8').indexOf(Buffer.from('—', 'utf8')), 1_048_575, 'arrangement');
    const got = onlyCall(readToolCalls(file)).result?.text ?? '';
    // Compared around the boundary so a failure prints a readable diff rather than a megabyte of padding.
    assert.equal(got.slice(pad - 2), 'aa— tail');
    assert.equal(got.length, text.length);
  });

  void test('leaves a call whose result never arrived without a result', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(file, useEvent('toolu_n', FETCH, { id: PAGE }, T1));
    assert.equal(onlyCall(readToolCalls(file)).result, undefined);
  });

  void test('ignores a tool_result with no matching tool_use', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(
      file,
      [
        resultEvent('toolu_orphan', 'lost', T1),
        useEvent('toolu_x', FETCH, { id: PAGE }, T2),
        resultEvent('toolu_x', 'kept', T2),
      ].join('\n'),
    );
    const c = onlyCall(readToolCalls(file));
    assert.equal(c.id, 'toolu_x');
    assert.equal(c.result?.text, 'kept');
  });

  void test('returns calls in file order', () => {
    const file = transcriptAt([
      { id: 'toolu_1', name: FETCH, input: { id: PAGE }, result: 'one', at: T3 },
      { id: 'toolu_2', name: FETCH, input: { id: PAGE }, result: 'two', at: T1 },
    ]);
    assert.deepEqual(
      readToolCalls(file).map((c) => c.id),
      ['toolu_1', 'toolu_2'],
    );
  });
});

// ---- locateTranscripts ---------------------------------------------------------------------------------------------------

void describe('locateTranscripts', () => {
  void test('an explicit path is the main transcript and its <session>/subagents/*.jsonl are found', () => {
    const dir = tempDir();
    const main = writeTranscript(join(dir, 'abc.jsonl'), []);
    const a = writeTranscript(join(dir, 'abc', 'subagents', 'agent-b.jsonl'), []);
    const b = writeTranscript(join(dir, 'abc', 'subagents', 'agent-a.jsonl'), []);
    writeFile(join(dir, 'abc', 'subagents', 'notes.txt'), 'not a transcript');
    const set = locateTranscripts({ explicit: main });
    assert.equal(set.main, main);
    assert.deepEqual(set.subagents, [b, a]);
  });

  void test('an explicit path with no subagents folder has no subagent transcripts', () => {
    const main = transcriptAt([]);
    assert.deepEqual(locateTranscripts({ explicit: main }).subagents, []);
  });

  void test('an explicit path that does not exist is a usage error', () => {
    assert.throws(() => locateTranscripts({ explicit: join(tempDir(), 'nope.jsonl') }), isUsage);
  });

  void test('a session id is looked up under every project folder of the projects directory', () => {
    const projects = tempDir('bp-projects-');
    writeTranscript(join(projects, '-a-first', 'other-session.jsonl'), []);
    const main = writeTranscript(join(projects, '-b-second', 'sess-0042.jsonl'), []);
    const sub = writeTranscript(join(projects, '-b-second', 'sess-0042', 'subagents', 'agent-1.jsonl'), []);
    const set = locateTranscripts({ sessionId: 'sess-0042', projectsDir: projects });
    assert.equal(set.main, main);
    assert.deepEqual(set.subagents, [sub]);
  });

  void test('a session id with no transcript under the projects directory is a usage error', () => {
    const projects = tempDir('bp-projects-');
    writeTranscript(join(projects, '-a', 'someone-else.jsonl'), []);
    assert.throws(() => locateTranscripts({ sessionId: 'sess-missing', projectsDir: projects }), isUsage);
  });

  void test('with no explicit path and no session id it is a usage error, whatever the process environment holds', () => {
    const { projects, file } = sessionFiles('sess-proc-0001');
    writeTranscript(file, []);
    withProcessEnv({ CLAUDE_CODE_SESSION_ID: 'sess-proc-0001' }, () => {
      assert.throws(() => locateTranscripts({ projectsDir: projects }), isUsage);
    });
  });

  void test('a real Claude Code session id — a UUID — is accepted', () => {
    const sid = '5b0c9e1a-3f2d-4c7e-9a41-0d8e6f2b1c3a';
    const { projects, file } = sessionFiles(sid);
    writeTranscript(file, []);
    assert.equal(locateTranscripts({ sessionId: sid, projectsDir: projects }).main, file);
  });

  // A session id becomes part of a path; anything but 8–80 word characters and hyphens is refused before any lookup.
  for (const [sid, why] of [
    ['sess-42', 'seven characters, under the minimum of eight'],
    ['../../etc/passwd', 'a path traversal'],
    ['sess/0042', 'a path separator'],
    ['sess 0042', 'a space'],
    ['s'.repeat(81), '81 characters, over the maximum of eighty'],
  ] as const) {
    void test(`a session id with ${why} is a usage error`, () => {
      const projects = tempDir('bp-projects-');
      assert.throws(() => locateTranscripts({ sessionId: sid, projectsDir: projects }), isUsage);
    });
  }

  void test('with a session id but no projects directory it never looks under the home directory', () => {
    // locateTranscripts reads only what its caller passes: the CLI derives projectsDir from the injected HOME. A
    // transcript under the process's own home directory must not be found behind the caller's back.
    const home = tempDir('bp-fakehome-');
    writeTranscript(join(home, '.claude', 'projects', '-work-proj', 'sess-home-0001.jsonl'), []);
    withProcessEnv({ HOME: home }, () => {
      assert.throws(() => locateTranscripts({ sessionId: 'sess-home-0001' }), isUsage);
    });
  });
});

void describe('readAllToolCalls', () => {
  void test('orders calls by instant, not by the text of their timestamps', () => {
    // As strings "…11:00:02.500Z" sorts before "…11:00:02Z" ('.' < 'Z'); as instants 02Z is half a second earlier.
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), [
      { id: 'toolu_later', name: FETCH, input: { id: PAGE }, result: 'x', at: '2026-09-25T11:00:02.500Z' },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-1.jsonl'), [
      { id: 'toolu_earlier', name: FETCH, input: { id: PAGE }, result: 'y', at: '2026-09-25T11:00:02Z' },
    ]);
    assert.deepEqual(
      readAllToolCalls(locateTranscripts({ explicit: main })).map((c) => c.id),
      ['toolu_earlier', 'toolu_later'],
    );
  });

  void test('orders a timestamp written with a UTC offset by the instant it names', () => {
    // 13:00:03+02:00 is 11:00:03Z — after 11:00:02Z, although the string "13:…" sorts after "11:…" either way; and
    // 12:00:01+02:00 is 10:00:01Z — before both, although its text sorts between them.
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), [
      { id: 'toolu_b', name: FETCH, input: { id: PAGE }, result: 'b', at: T2 },
      { id: 'toolu_c', name: FETCH, input: { id: PAGE }, result: 'c', at: '2026-09-25T13:00:03+02:00' },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-1.jsonl'), [
      { id: 'toolu_a', name: FETCH, input: { id: PAGE }, result: 'a', at: '2026-09-25T12:00:01+02:00' },
    ]);
    assert.deepEqual(
      readAllToolCalls(locateTranscripts({ explicit: main })).map((c) => c.id),
      ['toolu_a', 'toolu_b', 'toolu_c'],
    );
  });

  void test('merges the main and subagent transcripts in timestamp order', () => {
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), [
      { id: 'toolu_m1', name: FETCH, input: { id: PAGE }, result: 'm1', at: T1 },
      { id: 'toolu_m3', name: FETCH, input: { id: PAGE }, result: 'm3', at: T3 },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-x.jsonl'), [
      { id: 'toolu_s2', name: FETCH, input: { id: PAGE }, result: 's2', at: T2 },
    ]);
    const calls = readAllToolCalls(locateTranscripts({ explicit: main }));
    assert.deepEqual(
      calls.map((c) => c.id),
      ['toolu_m1', 'toolu_s2', 'toolu_m3'],
    );
  });
});

// ---- toolMatches / latestCall / canonicalJson ------------------------------------------------------------------------------

void describe('toolMatches', () => {
  void test('matches the hosted and the local connector names by suffix', () => {
    assert.equal(toolMatches('mcp__notion__notion-fetch', 'notion-fetch'), true);
    assert.equal(toolMatches('mcp__claude_ai_Notion__notion-fetch', 'notion-fetch'), true);
  });

  void test('matches the bare tool name', () => {
    assert.equal(toolMatches('notion-fetch', 'notion-fetch'), true);
  });

  void test('does not match a tool whose name only starts with the wanted name', () => {
    assert.equal(toolMatches('notion-fetch-other', 'notion-fetch'), false);
    assert.equal(toolMatches('mcp__notion__notion-fetch-other', 'notion-fetch'), false);
  });

  void test('does not match a tool whose last segment only ends with the wanted name', () => {
    assert.equal(toolMatches('mcp__notion__my-notion-fetch', 'notion-fetch'), false);
  });
});

void describe('latestCall', () => {
  const calls = (list: FakeCall[]): ToolCall[] => readAllToolCalls(locateTranscripts({ explicit: transcriptAt(list) }));

  void test('returns the newest matching call', () => {
    const cs = calls([
      { id: 'toolu_old', name: FETCH, input: { id: PAGE }, result: 'old', at: T1 },
      { id: 'toolu_new', name: FETCH, input: { id: PAGE }, result: 'new', at: T2 },
    ]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE))?.id, 'toolu_new');
  });

  void test('picks the newest by timestamp even when a subagent made it', () => {
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), [
      { id: 'toolu_main', name: FETCH, input: { id: PAGE }, result: 'main', at: T3 },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-1.jsonl'), [
      { id: 'toolu_sub', name: FETCH, input: { id: PAGE }, result: 'sub', at: T2 },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-2.jsonl'), [
      { id: 'toolu_sub_old', name: FETCH, input: { id: PAGE }, result: 'sub old', at: T1 },
    ]);
    const cs = readAllToolCalls(locateTranscripts({ explicit: main }));
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE))?.id, 'toolu_main');
  });

  void test('skips a newer call whose input does not match', () => {
    const cs = calls([
      { id: 'toolu_mine', name: FETCH, input: { id: PAGE }, result: 'mine', at: T1 },
      { id: 'toolu_other', name: FETCH, input: { id: OTHER }, result: 'other', at: T2 },
    ]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE))?.id, 'toolu_mine');
  });

  void test('matches both connector names and ignores a longer tool name', () => {
    const cs = calls([
      { id: 'toolu_local', name: 'mcp__notion__notion-fetch', input: { id: PAGE }, result: 'a', at: T1 },
      { id: 'toolu_hosted', name: 'mcp__claude_ai_Notion__notion-fetch', input: { id: PAGE }, result: 'b', at: T2 },
      { id: 'toolu_decoy', name: 'mcp__notion__notion-fetch-other', input: { id: PAGE }, result: 'c', at: T3 },
    ]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE))?.id, 'toolu_hosted');
  });

  void test('never returns a call whose result has not arrived', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFile(file, useEvent('toolu_pending', FETCH, { id: PAGE }, T1));
    assert.equal(latestCall(readToolCalls(file), 'notion-fetch', byId(PAGE)), undefined);
  });

  void test('honours the after filter by excluding calls before it', () => {
    const cs = calls([
      { id: 'toolu_before', name: FETCH, input: { id: PAGE }, result: 'x', at: T1 },
      { id: 'toolu_other_after', name: FETCH, input: { id: OTHER }, result: 'y', at: T3 },
    ]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE), T2), undefined);
  });

  void test('keeps a matching call made after the after filter', () => {
    const cs = calls([{ id: 'toolu_after', name: FETCH, input: { id: PAGE }, result: 'x', at: T3 }]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE), T2)?.id, 'toolu_after');
  });

  void test('picks the newest by instant when the newer call carries milliseconds and the older does not', () => {
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), [
      { id: 'toolu_newer', name: FETCH, input: { id: PAGE }, result: 'n', at: '2026-09-25T11:00:02.500Z' },
    ]);
    writeTranscript(join(dir, 's', 'subagents', 'agent-1.jsonl'), [
      { id: 'toolu_older', name: FETCH, input: { id: PAGE }, result: 'o', at: '2026-09-25T11:00:02Z' },
    ]);
    const cs = readAllToolCalls(locateTranscripts({ explicit: main }));
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE))?.id, 'toolu_newer');
  });

  void test('an after written with a UTC offset excludes a call before the instant it names', () => {
    // 13:00:02+02:00 is 11:00:02Z, so a call at 11:00:01Z is before it.
    const cs = calls([{ id: 'toolu_before', name: FETCH, input: { id: PAGE }, result: 'x', at: T1 }]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE), '2026-09-25T13:00:02+02:00'), undefined);
  });

  void test('an after given without milliseconds still admits a call later in that same second', () => {
    // 11:00:02.500Z is half a second after 11:00:02Z, so it is "no earlier than" the filter (DESIGN.md §5.2).
    const cs = calls([
      { id: 'toolu_late', name: FETCH, input: { id: PAGE }, result: 'x', at: '2026-09-25T11:00:02.500Z' },
    ]);
    assert.equal(latestCall(cs, 'notion-fetch', byId(PAGE), '2026-09-25T11:00:02Z')?.id, 'toolu_late');
  });
});

void describe('canonicalJson', () => {
  void test('sorts object keys at every depth and keeps array order', () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [2, { y: 2, x: 1 }], c: null } }),
      '{"a":{"c":null,"d":[2,{"x":1,"y":2}]},"b":1}',
    );
  });

  void test('renders undefined as null', () => {
    assert.equal(canonicalJson(undefined), 'null');
  });
});

// ---- normaliseId / richText / relationIds ---------------------------------------------------------------------------------

void describe('normaliseId', () => {
  void test('lowercases a hyphenated id and removes the hyphens', () => {
    assert.equal(normaliseId(PAGE_HYPHENATED), PAGE);
  });

  void test('takes the id out of a page URL whose title slug is itself hex letters', () => {
    // "Add-Feed-Cafe-" loses its hyphens to "addfeedcafe", which runs straight into the id as more hex.
    assert.equal(normaliseId(`https://www.notion.so/acme/Add-Feed-Cafe-${PAGE}`), PAGE);
  });

  void test('takes the page id, not the view id, from a URL with ?v=', () => {
    assert.equal(normaliseId(`https://www.notion.so/${PAGE}?v=${OTHER}`), PAGE);
  });

  void test('takes the id out of an app.notion.com URL and a collection URL', () => {
    assert.equal(normaliseId(`https://app.notion.com/p/${PAGE}`), PAGE);
    assert.equal(normaliseId(`collection://${PAGE_HYPHENATED.toLowerCase()}`), PAGE);
  });

  void test('an unhyphenated id is already canonical', () => {
    assert.equal(normaliseId(PAGE), PAGE);
  });
});

void describe('richText', () => {
  void test('turns every <br> form into a newline', () => {
    assert.equal(richText('one<br>two<br/>three<br />four'), 'one\ntwo\nthree\nfour');
  });

  void test('a non-string value is empty text', () => {
    assert.equal(richText(null), '');
    assert.equal(richText(42), '');
  });
});

void describe('relationIds', () => {
  void test('reads a JSON-encoded string of page URLs as canonical ids', () => {
    const encoded = JSON.stringify([`https://www.notion.so/${PAGE}`, `https://www.notion.so/Other-${OTHER}`]);
    assert.deepEqual(relationIds(encoded), [PAGE, OTHER]);
  });

  void test('reads an array of page URLs as canonical ids', () => {
    assert.deepEqual(relationIds([PAGE_URL, `https://app.notion.com/p/${OTHER}`]), [PAGE, OTHER]);
  });

  void test('null is no relation', () => {
    assert.deepEqual(relationIds(null), []);
  });

  void test('an encoded empty array is no relation', () => {
    assert.deepEqual(relationIds('[]'), []);
  });

  void test('a single bare URL that is not JSON is one id', () => {
    assert.deepEqual(relationIds(PAGE_URL), [PAGE]);
  });

  void test('drops non-string entries', () => {
    assert.deepEqual(relationIds([PAGE_URL, 7, null]), [PAGE]);
  });

  void test('keeps every reference past 25 when read from the query side', () => {
    const urls = Array.from(
      { length: 30 },
      (_, i) => `https://www.notion.so/${String(i).padStart(2, '0')}${'0'.repeat(30)}`,
    );
    assert.equal(relationIds(JSON.stringify(urls)).length, 30);
  });

  void test('the page-read truncation limit is 25 references (notion-mechanics §4)', () => {
    assert.equal(RELATION_TRUNCATION, 25);
  });
});

// ---- parseFetch ------------------------------------------------------------------------------------------------------------

void describe('parseFetch', () => {
  void test('reads the page URL, canonical id and properties from the connector JSON', () => {
    const page = parseFetch(
      fetchResult({
        id: PAGE,
        properties: { Name: 'Checkout', Area: 'Ordering', Touches: [PAGE_URL] },
        content: BODY_B,
      }),
    );
    assert.ok(page);
    assert.equal(page.url, `https://app.notion.com/p/${PAGE}`);
    assert.equal(page.id, PAGE);
    assert.deepEqual(page.properties, { Name: 'Checkout', Area: 'Ordering', Touches: [PAGE_URL] });
  });

  void test('keeps the content exactly as returned, escapes included', () => {
    const page = parseFetch(fetchResult({ id: PAGE, properties: {}, content: BODY_A }));
    assert.equal(page?.content, BODY_A);
  });

  void test('trims only the one newline after <content> and the one before </content>', () => {
    // fetchResult wraps as "<content>\n" + content + "\n</content>", so the returned element holds "\n\nA \[x\]\n\n".
    const page = parseFetch(fetchResult({ id: PAGE, properties: {}, content: '\nA \\[x\\]\n' }));
    assert.equal(page?.content, '\nA \\[x\\]\n');
  });

  void test('keeps a literal </content> inside the body', () => {
    const body = '## Why\nThe tag `</content>` closes the body.';
    assert.equal(parseFetch(fetchResult({ id: PAGE, properties: {}, content: body }))?.content, body);
  });

  void test('a property value containing the text <content> does not move the body', () => {
    const page = parseFetch(
      fetchResult({ id: PAGE, properties: { Name: 'Explain the <content> tag' }, content: BODY_B }),
    );
    assert.equal(page?.content, BODY_B);
  });

  void test('reads a result that is the page text itself, not wrapped in JSON', () => {
    const text = at(JSON.parse(fetchResult({ id: PAGE, properties: { Name: 'Checkout' }, content: BODY_B })), 'text');
    assert.equal(typeof text, 'string');
    const page = parseFetch(String(text));
    assert.equal(page?.id, PAGE);
    assert.equal(page?.content, BODY_B);
  });

  void test('malformed properties JSON gives empty properties and still reads the body', () => {
    const text = [
      `<page url="https://app.notion.com/p/${PAGE}">`,
      '<properties>',
      '{"Name": "Checkout",',
      '</properties>',
      '<content>',
      BODY_B,
      '</content>',
      '</page>',
    ].join('\n');
    const page = parseFetch(text);
    assert.ok(page);
    assert.deepEqual(page.properties, {});
    assert.equal(page.content, BODY_B);
  });

  void test('lists the databases the content embeds with their data source, inline flag and title', () => {
    const content = [
      '## Why',
      'Tracked below.',
      '<database url="https://www.notion.so/db-one" inline="true" data-source-url="collection://abc-123">  Questions </database>',
      '<database url="https://www.notion.so/db-two">Linked</database>',
    ].join('\n');
    const page = parseFetch(fetchResult({ id: PAGE, properties: {}, content }));
    assert.deepEqual(page?.databases, [
      { url: 'https://www.notion.so/db-one', dataSourceUrl: 'collection://abc-123', inline: true, title: 'Questions' },
      { url: 'https://www.notion.so/db-two', dataSourceUrl: null, inline: false, title: 'Linked' },
    ]);
  });

  void test('a page with no embedded databases lists none', () => {
    assert.deepEqual(parseFetch(fetchResult({ id: PAGE, properties: {}, content: BODY_B }))?.databases, []);
  });

  void test('returns null for a database fetch', () => {
    const db = JSON.stringify({
      metadata: { type: 'database' },
      text: '<database url="https://www.notion.so/db"><data-source url="collection://x"/></database>',
    });
    assert.equal(parseFetch(db), null);
  });

  void test('returns null for an error message and for empty text', () => {
    assert.equal(parseFetch('Could not find page with ID: 1a2b'), null);
    assert.equal(parseFetch(''), null);
    assert.equal(parseFetch('{"text": 42}'), null);
  });
});

// ---- parseQuery -------------------------------------------------------------------------------------------------------------

void describe('parseQuery', () => {
  const query = (o: Record<string, unknown>): string => JSON.stringify({ data_source_ids: ['x'], ...o });

  void test('returns the result rows', () => {
    const r = parseQuery(query({ results: [{ url: PAGE_URL, Name: 'Checkout' }], has_more: false }));
    assert.deepEqual(r?.rows, [{ url: PAGE_URL, Name: 'Checkout' }]);
  });

  void test('has_more true means the collection is not complete', () => {
    assert.equal(parseQuery(query({ results: [], has_more: true }))?.hasMore, true);
  });

  void test('has_more false means the collection is complete', () => {
    assert.equal(parseQuery(query({ results: [], has_more: false }))?.hasMore, false);
  });

  void test('an incomplete request status is not reported as a complete read', () => {
    // notion-mechanics §4: past 10,000 results has_more goes false and request_status.type is "incomplete" —
    // "incomplete" means the database was not read, not that the tail was empty.
    const r = parseQuery(
      query({ results: [{ url: PAGE_URL }], has_more: false, request_status: { type: 'incomplete' } }),
    );
    assert.ok(r);
    assert.equal(r.hasMore, true);
  });

  void test('relation columns in either form and null read as canonical ids', () => {
    const r = parseQuery(
      query({
        results: [
          { url: PAGE_URL, Touches: JSON.stringify([`https://www.notion.so/${OTHER}`]) },
          { url: `https://www.notion.so/${OTHER}`, Touches: null },
          { url: `https://www.notion.so/${OTHER}`, Touches: [PAGE_URL] },
        ],
        has_more: false,
      }),
    );
    assert.deepEqual(
      r?.rows.map((row) => relationIds(row['Touches'])),
      [[OTHER], [], [PAGE]],
    );
  });

  void test('rich text columns turn <br> into newlines', () => {
    const r = parseQuery(
      query({ results: [{ 'Answer & why': 'Yes.<br>Because the client said so.' }], has_more: false }),
    );
    assert.equal(richText(r?.rows[0]?.['Answer & why']), 'Yes.\nBecause the client said so.');
  });

  void test('returns null for text that is not JSON', () => {
    assert.equal(parseQuery('Error: rate limited'), null);
  });

  void test('returns null for JSON without a results array', () => {
    assert.equal(parseQuery('{"results": "nope", "has_more": false}'), null);
    assert.equal(parseQuery('[]'), null);
  });
});

// ---- bp hash fetch --------------------------------------------------------------------------------------------------------

void describe('bp hash fetch', () => {
  void test('prints the 12-hex body hash of the fetched page, its name and when it was fetched', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.ok);
    assert.equal(r.out, `${BODY_A_SHA12}  «Checkout» fetched ${T1}`);
  });

  void test('hashes the newest fetch of the page', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
      fetchCall({ id: PAGE, content: BODY_B, at: T2 }),
    ]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.ok);
    assert.ok(r.out.startsWith(`${BODY_B_SHA12}  `), r.out);
  });

  void test('ignores a newer fetch of a different page', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
      fetchCall({ id: OTHER, content: BODY_B, at: T2 }),
    ]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('matches a fetch made with a URL id when --page is hyphenated', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, inputId: PAGE_URL, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE_HYPHENATED, '--transcript', t]);
    assert.equal(r.code, EXIT.ok);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('matches a fetch made with a hyphenated id when --page is a URL', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, inputId: PAGE_HYPHENATED, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE_URL, '--transcript', t]);
    assert.equal(r.code, EXIT.ok);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('matches the hosted connector tool name', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1, tool: 'mcp__claude_ai_Notion__notion-fetch' }),
    ]);
    assert.ok(run(['hash', 'fetch', '--page', PAGE, '--transcript', t]).out.startsWith(`${BODY_A_SHA12}  `));
  });

  void test('hashes a body with CRLF line endings the same as with LF', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: BODY_A.replace(/\n/g, '\r\n'), at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test("reads a fetch whose result was persisted to a file in the session's tool-results/", () => {
    const { dir, file } = sessionFiles();
    const saved = writeFile(
      join(dir, 'tool-results', 'mcp-notion-fetch-1.txt'),
      fetchResult({ id: PAGE, properties: { Name: 'Checkout' }, content: BODY_A }),
    );
    const notice = `Error: result (61,234 characters) exceeds maximum allowed tokens. Output has been saved to ${saved}.`;
    const t = writeTranscript(file, [{ id: 'toolu_big', name: FETCH, input: { id: PAGE }, result: notice, at: T1 }]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('is a usage error when the newest fetch was persisted to a file that is gone', () => {
    const { dir, file } = sessionFiles();
    const notice = `Error: result (61,234 characters) exceeds maximum allowed tokens. Output has been saved to ${join(dir, 'tool-results', 'gone.txt')}.`;
    const t = writeTranscript(file, [{ id: 'toolu_gone', name: FETCH, input: { id: PAGE }, result: notice, at: T1 }]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /returned an error/);
  });

  void test('finds a fetch a subagent made', () => {
    const dir = tempDir();
    const main = writeTranscript(join(dir, 's.jsonl'), []);
    writeTranscript(join(dir, 's', 'subagents', 'agent-9.jsonl'), [fetchCall({ id: PAGE, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', main]);
    assert.equal(r.code, EXIT.ok);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('--json carries the full and short body hash, the canonical page id and the fetch time', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, inputId: PAGE_URL, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE_URL, '--transcript', t, '--json']);
    assert.equal(r.code, EXIT.ok);
    const o: unknown = JSON.parse(r.out);
    assert.equal(at(o, 'page'), PAGE);
    assert.equal(at(o, 'body', 'sha256'), BODY_A_SHA256);
    assert.equal(at(o, 'body', 'sha12'), BODY_A_SHA12);
    assert.equal(at(o, 'fetchedAt'), T1);
  });

  void test('--json hashes each feature block that is present and omits the absent ones', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: BODY_A, at: T1 })]);
    const o: unknown = JSON.parse(run(['hash', 'fetch', '--page', PAGE, '--transcript', t, '--json']).out);
    const blocks = at(o, 'blocks');
    assert.equal(at(blocks, 'Behaviour'), BEHAVIOUR_A_SHA12);
    const present = FEATURE_BLOCKS.filter((b) => at(blocks, b) !== undefined);
    assert.deepEqual(present, ['Why', 'Behaviour']);
  });

  void test('exits 1 when the page has no "## Why"', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: '## Behaviour\n1. Something.', at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.findings);
    assert.match(r.out, /no "## Why"/);
  });

  void test('exits 1 when only an older fetch had a "## Why"', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
      fetchCall({ id: PAGE, content: 'Body moved away.', at: T2 }),
    ]);
    assert.equal(run(['hash', 'fetch', '--page', PAGE, '--transcript', t]).code, EXIT.findings);
  });

  void test('--json reports a null body when there is no "## Why"', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: 'No heading here.', at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t, '--json']);
    assert.equal(r.code, EXIT.findings);
    assert.equal(at(JSON.parse(r.out), 'body'), null);
  });

  void test('is a usage error when the transcript has no fetch of the page', () => {
    const t = transcriptAt([fetchCall({ id: OTHER, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /no notion-fetch of/);
  });

  void test('is a usage error when the newest fetch returned an error, even if an older one succeeded', () => {
    const failed: FakeCall = {
      id: 'toolu_err',
      name: FETCH,
      input: { id: PAGE },
      result: 'object_not_found',
      isError: true,
      at: T2,
    };
    const t = transcriptAt([fetchCall({ id: PAGE, content: BODY_A, at: T1 }), failed]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /returned an error/);
  });

  void test('is a usage error when the newest fetch is not a page', () => {
    const notPage: FakeCall = {
      id: 'toolu_db',
      name: FETCH,
      input: { id: PAGE },
      result: '{"metadata":{"type":"database"},"text":"<database url=\\"x\\"></database>"}',
      at: T1,
    };
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', transcriptAt([notPage])]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /not a page fetch/);
  });

  void test('--after excludes a fetch made before it', () => {
    const t = transcriptAt([fetchCall({ id: PAGE, content: BODY_A, at: T1 })]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t, '--after', T2]);
    assert.equal(r.code, EXIT.usage);
  });

  void test('--after keeps the fetch made after it', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
      fetchCall({ id: PAGE, content: BODY_B, at: T3 }),
    ]);
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', t, '--after', T2]);
    assert.ok(r.out.startsWith(`${BODY_B_SHA12}  `), r.out);
  });

  void test('is a usage error when the transcript path does not exist', () => {
    const r = run(['hash', 'fetch', '--page', PAGE, '--transcript', join(tempDir(), 'gone.jsonl')]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /no transcript at/);
  });

  void test('is a usage error without --page', () => {
    const r = run(['hash', 'fetch', '--transcript', transcriptAt([])]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--page is required/);
  });

  void test('finds the transcript from the session id and HOME in the injected environment', () => {
    const home = tempDir('bp-fakehome-');
    writeTranscript(join(home, '.claude', 'projects', '-work-proj', 'sess-env-0001.jsonl'), [
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
    ]);
    const r = run(['hash', 'fetch', '--page', PAGE], { env: { CLAUDE_CODE_SESSION_ID: 'sess-env-0001', HOME: home } });
    assert.equal(r.code, EXIT.ok, r.err);
    assert.ok(r.out.startsWith(`${BODY_A_SHA12}  `), r.out);
  });

  void test('takes the projects directory from the injected HOME, never from the process home directory', () => {
    // The injected env names the session but no HOME; the transcript exists only under the process's home directory.
    const home = tempDir('bp-fakehome-');
    writeTranscript(join(home, '.claude', 'projects', '-work-proj', 'sess-env-0002.jsonl'), [
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
    ]);
    const r = withProcessEnv({ HOME: home, CLAUDE_CODE_SESSION_ID: undefined }, () =>
      run(['hash', 'fetch', '--page', PAGE], { env: { CLAUDE_CODE_SESSION_ID: 'sess-env-0002' } }),
    );
    assert.equal(r.code, EXIT.usage, r.out);
    assert.equal(r.out, '');
  });

  void test('an injected session id that is not a session id finds no transcript and is a usage error', () => {
    const home = tempDir('bp-fakehome-');
    const r = run(['hash', 'fetch', '--page', PAGE], { env: { CLAUDE_CODE_SESSION_ID: '../../x', HOME: home } });
    assert.equal(r.code, EXIT.usage);
  });

  void test('takes the session from the injected environment, never from the process environment', () => {
    // The command context injects env so a run is hermetic (context.ts); a session id present only in the process
    // environment must not lead bp to a transcript. HOME points at a temp dir so nothing real is read.
    const home = tempDir('bp-fakehome-');
    writeTranscript(join(home, '.claude', 'projects', '-work-proj', 'sess-proc.jsonl'), [
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
    ]);
    const r = withProcessEnv({ HOME: home, CLAUDE_CODE_SESSION_ID: 'sess-proc' }, () =>
      run(['hash', 'fetch', '--page', PAGE], { env: { HOME: home } }),
    );
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /CLAUDE_CODE_SESSION_ID is not set/);
  });
});

// ---- bp quote check --page ------------------------------------------------------------------------------------------------

void describe('bp quote check --page', () => {
  const pageTranscript = (props: Record<string, unknown> = { Name: 'Checkout' }): string =>
    transcriptAt([fetchCall({ id: PAGE, content: BODY_A, at: T1, props })]);

  void test('matches a quote across differing whitespace and exits 0', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      'Customers need to pay\n   for a pickup slot.',
    ]);
    assert.equal(r.code, EXIT.ok);
    assert.equal(r.out, 'matched  «Checkout»  "Customers need to pay\n   for a pickup slot."');
  });

  void test('does not fold the \\[ escape: an unescaped bracket quote is not matched and exits 1', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      '[NEEDS CLARIFICATION: which payment provider?]',
    ]);
    assert.equal(r.code, EXIT.findings);
    assert.match(r.out, /^NOT matched {2}«Checkout»/);
  });

  void test('matches the escaped marker as the page returns it', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      '\\[NEEDS CLARIFICATION: which payment provider?\\]',
    ]);
    assert.equal(r.code, EXIT.ok);
  });

  void test('--block limits the search to that block', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      'Customers need to pay',
      '--block',
      'Behaviour',
    ]);
    assert.equal(r.code, EXIT.findings);
  });

  void test('--block finds a quote inside that block', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      'charges the card once',
      '--block',
      'Behaviour',
    ]);
    assert.equal(r.code, EXIT.ok);
    assert.equal(r.out, 'matched  «Checkout» · Behaviour  "charges the card once"');
  });

  void test('a block the page does not have is not matched, with the reason in --json', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript(),
      '--quote',
      'anything',
      '--block',
      'Edge cases',
      '--json',
    ]);
    assert.equal(r.code, EXIT.findings);
    const results = at(JSON.parse(r.out), 'results');
    assert.ok(Array.isArray(results));
    assert.equal(at(results[0], 'matched'), false);
    assert.equal(at(results[0], 'reason'), 'no "## Edge cases" block');
  });

  void test('--json counts the occurrences of a matched quote', () => {
    const r = run(['quote', 'check', '--page', PAGE, '--transcript', pageTranscript(), '--quote', 'the', '--json']);
    const results = at(JSON.parse(r.out), 'results');
    assert.ok(Array.isArray(results));
    // Case is not folded (rule 6(d)), so "The app" does not count: "above the body" and "charges the card" → 2.
    assert.equal(at(results[0], 'count'), 2);
    assert.equal(at(results[0], 'line'), 'citation: matched «Checkout»');
  });

  void test('names a question page by its Question property', () => {
    const r = run([
      'quote',
      'check',
      '--page',
      PAGE,
      '--transcript',
      pageTranscript({ Question: 'Which PSP?' }),
      '--quote',
      'pickup slot',
    ]);
    assert.equal(r.out, 'matched  «Which PSP?»  "pickup slot"');
  });

  void test('names a page with neither Name nor Question by its canonical id', () => {
    const r = run(['quote', 'check', '--page', PAGE_URL, '--transcript', pageTranscript({}), '--quote', 'pickup slot']);
    assert.equal(r.out, `matched  «${PAGE}»  "pickup slot"`);
  });

  void test('checks a batch of page quotes against the newest fetch', () => {
    const t = transcriptAt([
      fetchCall({ id: PAGE, content: BODY_A, at: T1 }),
      fetchCall({ id: PAGE, content: BODY_B, at: T2 }),
    ]);
    const batch = writeFile(
      join(tempDir(), 'batch.json'),
      JSON.stringify([
        { quote: 'reserve a slot', page: PAGE_HYPHENATED },
        { quote: 'pickup slot', page: PAGE, label: 'old text' },
      ]),
    );
    const r = run(['quote', 'check', '--batch', batch, '--transcript', t, '--json']);
    assert.equal(r.code, EXIT.findings);
    const results = at(JSON.parse(r.out), 'results');
    assert.ok(Array.isArray(results));
    assert.deepEqual(
      results.map((x) => at(x, 'matched')),
      [true, false],
    );
  });

  void test('is a usage error when the page was never fetched', () => {
    const r = run(['quote', 'check', '--page', OTHER, '--transcript', pageTranscript(), '--quote', 'pickup slot']);
    assert.equal(r.code, EXIT.usage);
  });
});
