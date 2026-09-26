import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  COMMANDS,
  CORE_KINDS,
  DEVIATION_CLASSES,
  FEATURE_BLOCKS,
  INIT_ADD_KINDS,
  kindsFor,
  LOG_KINDS,
  MODES,
  OVERVIEW_BLOCKS,
  PROGRESS_STATES,
  CHALLENGE_KINDS,
  RUNS_ONLY_KINDS,
  SHAPE_REGISTER,
  STATUSES,
  STOP_REASONS,
  WRITE_COMMANDS,
  type LogKind,
  type RegisterRoute,
} from '../src/domain/vocab.ts';
import { readFile, SKILL_ROOT } from './support/index.ts';

// Drift guards: src/domain/vocab.ts writes every closed list of the skill once, and the skill's prose is the source of
// truth for what each list holds. These tests read the prose at test time (read-only, from the skill root this repo sits
// in) and compare it with the code, so a list edited on one side alone fails here. The oracle is the prose itself, never
// vocab.ts. Where the prose and the code spell an item differently, the normalisation is written by hand below, with its
// reason, and has a guard of its own where that normalisation could go stale.

// ---- reading the prose --------------------------------------------------------------------------------------------------

/** A skill prose file, relative to the skill root. */
const prose = (rel: string): string => readFile(join(SKILL_ROOT, rel));

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * The lines of the section whose heading text matches `heading`, from that heading up to the next heading of the same or
 * a higher level. A `#` line inside a code fence is text, not a heading (doc-shape §5 fences its own `## Why`). Throws
 * when no heading matches, so a renamed heading fails loudly instead of yielding an empty list.
 */
function section(md: string, heading: RegExp): string[] {
  const lines = md.split('\n');
  let inFence = false;
  let start = -1;
  let level = 0;
  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const h = inFence ? null : HEADING.exec(line);
    if (!h) continue;
    const depth = (h[1] ?? '').length;
    if (start < 0) {
      if (heading.test(h[2] ?? '')) [start, level] = [i, depth];
    } else if (depth <= level) {
      return lines.slice(start, i);
    }
  }
  if (start < 0) throw new Error(`no heading matches ${String(heading)}`);
  return lines.slice(start);
}

/** The code fences inside `lines`, each as its inner lines. */
function fences(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (cur) out.push(cur);
      cur = cur ? null : [];
    } else cur?.push(line);
  }
  return out;
}

/** The cells of one markdown table row. A `|` inside a code span, or escaped as `\|`, stays inside its cell. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i] ?? '';
    if (c === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  if (out[0] === '') out.shift();
  if (out.at(-1) === '') out.pop();
  return out;
}

/** A cell's text without bold markers or code-span backticks. */
const plain = (s: string): string => s.replace(/\*\*|`/g, '').trim();

/** Bold spans, in order; a span wrapped across lines reads as one line. */
const bold = (s: string): string[] =>
  [...s.matchAll(/\*\*(.+?)\*\*/gs)].map((m) => (m[1] ?? '').replace(/\s+/g, ' ').trim());

/** Code spans, in order, except a link's text: [`SKILL.md`](SKILL.md) cites a file and names no value. */
const codeSpans = (s: string): string[] =>
  [...s.matchAll(/`([^`]*)`/g)].filter((m) => s[m.index - 1] !== '[').map((m) => m[1] ?? '');

interface Table {
  header: string[];
  rows: string[][];
}

/**
 * The first table at or after the first line matching `anchor`, without its separator row. Throws when there is none,
 * or when its header differs from `header`: a guard must not silently read some other table further down.
 */
function tableAfter(lines: readonly string[], anchor: RegExp, header: readonly string[]): Table {
  const from = lines.findIndex((l) => anchor.test(l));
  if (from < 0) throw new Error(`no line matches ${String(anchor)}`);
  const isRow = (l: string): boolean => l.trimStart().startsWith('|');
  const start = lines.findIndex((l, i) => i >= from && isRow(l));
  if (start < 0) throw new Error(`no table follows ${String(anchor)}`);
  const block: string[][] = [];
  for (const l of lines.slice(start)) {
    if (!isRow(l)) break;
    block.push(cells(l));
  }
  const [head = [], sep = [], ...rows] = block;
  if (sep.length === 0 || !sep.every((c) => /^:?-+:?$/.test(c)))
    throw new Error(`the table after ${String(anchor)} has no separator row`);
  const got = head.map(plain);
  if (JSON.stringify(got) !== JSON.stringify(header)) {
    throw new Error(
      `the table after ${String(anchor)} has header ${JSON.stringify(got)}, expected ${JSON.stringify(header)}`,
    );
  }
  return { header: got, rows };
}

/** The items of a bold `a · b · c` list captured by group 1 of `re`. */
function dotList(text: string, re: RegExp): string[] {
  const m = re.exec(text);
  if (!m) throw new Error(`no match for ${String(re)}`);
  return (m[1] ?? '').split('·').map((s) => s.replace(/\s+/g, ' ').trim());
}

/** Code and prose disagree unless they hold the same members; the code list must not repeat one. */
function assertSameMembers(code: readonly string[], fromProse: readonly string[], what: string): void {
  assert.ok(fromProse.length > 0, `read no ${what} from the prose: the reader no longer finds its source`);
  assert.equal(new Set(code).size, code.length, `the code's ${what} repeat a member: ${code.join(', ')}`);
  const missing = fromProse.filter((p) => !code.includes(p));
  const extra = code.filter((c) => !fromProse.includes(c));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${what}: "missing" is in the prose and not the code, "extra" the reverse`,
  );
}

// ---- the prose's lists ----------------------------------------------------------------------------------------------------

const registerSection = (): string[] => section(prose('SKILL.md'), /^The shape-change register\b/);

/** SKILL.md `### The shape-change register`: one row per version that changed the target's shape. */
function registerRows(): { version: number; what: string }[] {
  const table = tableAfter(registerSection(), /^\| Version \|/, ['Version', "What changed about the target's shape"]);
  return table.rows.map((r) => {
    const m = /^v(\d+)$/.exec(plain(r[0] ?? ''));
    if (!m) throw new Error(`a register row does not open with a version: ${r[0] ?? ''}`);
    return { version: Number(m[1]), what: r[1] ?? '' };
  });
}

/** The register's exclusion line: "Nothing else is on this list, and v17 through v33, v35, … are deliberately not". */
function excludedVersions(): number[] {
  const m = /\*\*Nothing else is on this list, and ([^*]+?) are deliberately not\*\*/.exec(
    registerSection().join('\n'),
  );
  if (!m) throw new Error('the register has no exclusion line');
  const clause = m[1] ?? '';
  const out: number[] = [];
  for (const r of clause.matchAll(/v(\d+) through v(\d+)/g))
    for (let n = Number(r[1]); n <= Number(r[2]); n++) out.push(n);
  for (const s of clause.replace(/v\d+ through v\d+/g, '').matchAll(/v(\d+)/g)) out.push(Number(s[1]));
  return out;
}

/** spec/databases.md §3's status table. */
function proseStatuses(): string[] {
  const lines = section(prose('spec/databases.md'), /^3\. The question lifecycle\b/);
  return tableAfter(lines, /^\| Status \|/, ['Status', 'Means', 'Moved by']).rows.map((r) => plain(r[0] ?? ''));
}

const r5 = (): string[] => section(prose('resolve.md'), /^R5 — /);

/** resolve.md R5's "closed list of stop reasons" table. */
function proseStopReasons(): string[] {
  return tableAfter(r5(), /The closed list of stop reasons/, ['', 'Fires when']).rows.map((r) => plain(r[0] ?? ''));
}

interface KindRow {
  /** The bold names in the first column: one, or two for `**RATIFIED** · **VETOED**`. */
  names: string[];
  /** Marked *(→ `runs/`)*: goes to record/runs/<run-id>.md and not the run log. */
  runsOnly: boolean;
  carries: string;
}

/** resolve.md R5's "closed list of line kinds" table. */
function kindRows(): KindRow[] {
  return tableAfter(r5(), /The closed list of line kinds/, ['Kind', 'What it carries']).rows.map((r) => {
    const first = r[0] ?? '';
    return { names: bold(first), runsOnly: first.includes('(→ `runs/`)'), carries: r[1] ?? '' };
  });
}

/** R5's `group heading` row: layout (the APPLIED / NOT APPLIED / FLAGGED headers), routed to runs/ like any kind. */
const GROUP_HEADING = 'group heading';

/** Every kind R5's line-kinds table names — the group heading included: R5 lists it, so it is a kind. */
const proseCoreKinds = (): string[] => kindRows().flatMap((k) => k.names);

/**
 * R5 names four single-command kinds by the thing the line carries; vocab.ts writes the token that opens the line. By
 * hand: `CON-k` is every `CON-<k>` line (vocab.ts's INIT_ADD_KINDS comment), and the defaults ledger, fixes batch and
 * content manifest open with `ledger`, `fix` and `manifest` (`→ Default: ledger <run id> #<n>`, challenge.md Q6 and
 * spec/doc-shape.md §9 route 6; vocab.ts's CHALLENGE_KINDS comment). Every other name is its own token.
 */
const TOKEN: Readonly<Record<string, LogKind>> = {
  'CON-k': 'CON',
  'defaults ledger': 'ledger',
  'fixes batch': 'fix',
  'content manifest': 'manifest',
};
const token = (name: string): string => TOKEN[name] ?? name;

/** R5's "More belong to single commands." paragraph, split at `questions`:. */
function singleCommandKinds(): { initAdd: string[]; challenge: string[] } {
  const lines = r5();
  const at = lines.findIndex((l) => l.startsWith('More belong to single commands.'));
  if (at < 0) throw new Error('R5 has no "More belong to single commands." paragraph');
  const end = lines.findIndex((l, i) => i > at && l.trim() === '');
  const para = lines.slice(at, end < 0 ? undefined : end).join('\n');
  const split = para.indexOf('`challenge`:');
  if (split < 0) throw new Error('the single-command paragraph names no `challenge`: part');
  return { initAdd: bold(para.slice(0, split)).map(token), challenge: bold(para.slice(split)).map(token) };
}

/** An entry heading in the shape bp writes: `## <date> · <time> · <command> · run <id> · …`. */
const SAMPLE_HEADING = /^## \d{4}-\d\d-\d\d · \d\d:\d\d · /;

/** R5's log samples: the fences after "The samples below are the cap" whose first line is an entry heading. */
function logSamples(): string[][] {
  const lines = r5();
  const at = lines.findIndex((l) => l.includes('The samples below are the cap'));
  if (at < 0) throw new Error('R5 has no samples paragraph');
  return fences(lines.slice(at)).filter((b) => SAMPLE_HEADING.test(b[0] ?? ''));
}

/**
 * The kind of one sample line, in the bullet shape bp writes (`- <kind>: <text>`). The `## ` heading is the entry's
 * heading, not a line of any kind; a blank line and the `…` elision are not lines either.
 */
function sampleKind(line: string): string | null {
  if (line.trim() === '…' || line.trim() === '' || SAMPLE_HEADING.test(line)) return null;
  const m = /^- ([A-Za-z][\w -]*?):(?: |$)/.exec(line);
  if (!m) throw new Error(`a sample line is not a "- <kind>: " bullet: ${line}`);
  return m[1] ?? '';
}

/** The text of every `- closing:` line in R5's samples. */
const sampleClosings = (): string[] =>
  logSamples()
    .flat()
    .flatMap((l) => {
      const m = /^- closing: (.*)$/.exec(l);
      return m ? [m[1] ?? ''] : [];
    });

/** spec/doc-shape.md §5's feature body: the `## ` headings of its fenced template. */
function proseFeatureBlocks(): string[] {
  const [template] = fences(section(prose('spec/doc-shape.md'), /^5\. The feature row body\b/));
  if (!template) throw new Error('doc-shape §5 has no fenced template');
  return template.flatMap((l) => {
    const m = /^## (.+?)\s*$/.exec(l);
    return m ? [m[1] ?? ''] : [];
  });
}

/** spec/doc-shape.md §3's overview table: the first column of every row, as written. */
function overviewRows(): string[] {
  const lines = section(prose('spec/doc-shape.md'), /^3\. The overview page\b/);
  return tableAfter(lines, /^\| Block \|/, ['Block', 'Content', 'Cap']).rows.map((r) => r[0] ?? '');
}

/** SKILL.md `## The five commands`. */
function commandRows(): { command: string; does: string }[] {
  const lines = section(prose('SKILL.md'), /^The five commands\b/);
  return tableAfter(lines, /^\| Command \|/, ['Command', 'Reads', 'What it does']).rows.map((r) => {
    const m = /^\/blueprint (\S+)$/.exec(plain(r[0] ?? ''));
    if (!m) throw new Error(`a command row opens with no /blueprint command: ${r[0] ?? ''}`);
    return { command: m[1] ?? '', does: r[2] ?? '' };
  });
}

/** add.md `## Two modes` (its single home): the modifier of every `/blueprint add <modifier>` invocation. */
function proseModes(): string[] {
  const lines = section(prose('add.md'), /^Two modes\b/);
  const table = tableAfter(lines, /^\| Invocation \|/, ['Invocation', 'What a source-vs-document contradiction does']);
  return table.rows.flatMap((r) =>
    codeSpans(r[0] ?? '').flatMap((s) => {
      const m = /^\/blueprint add (\S+)$/.exec(s);
      return m ? [m[1] ?? ''] : [];
    }),
  );
}

/** spec/run-progress.md §1: "**`done · now · next · blocked · skipped`** are the only five states". */
function proseProgressStates(): string[] {
  const text = section(prose('spec/run-progress.md'), /^1\. The block\b/).join('\n');
  return dotList(text, /\*\*`([^`]+)`\*\* are the only five states/);
}

// ---- the readers themselves, on hand-written markdown -------------------------------------------------------------------

void describe('the prose readers', () => {
  void test('sampleKind reads the kind of a bullet line, including a two-word kind', () => {
    assert.equal(sampleKind('- SWEEP-NOTE: content rule swept rows 1–18'), 'SWEEP-NOTE');
    assert.equal(sampleKind('- group heading: APPLIED'), 'group heading');
  });

  void test('sampleKind reads the entry heading, a blank line and the elision as no line kind', () => {
    assert.deepEqual(
      ['## 2026-08-12 · 09:14 · resolve · run 7f3a2c · skill v38 · sitting 1', '', '…'].map(sampleKind),
      [null, null, null],
    );
  });

  void test('sampleKind throws on a line that is not a bullet, so a sample in another shape fails loudly', () => {
    assert.throws(() => sampleKind('GATE         3 applied, 0 returned'), /not a "- <kind>: " bullet/);
  });

  void test('section throws, naming the heading, when no heading matches', () => {
    assert.throws(() => section('# Title\n## Other\ntext', /^Wanted\b/), /no heading matches \/\^Wanted\\b\//);
  });

  void test('section ends at the next heading of the same level and keeps deeper headings', () => {
    const md = ['## 1. One', 'a', '### sub', 'b', '## 2. Two', 'c'].join('\n');
    assert.deepEqual(section(md, /^1\. One$/), ['## 1. One', 'a', '### sub', 'b']);
  });

  void test('section reads a heading inside a code fence as text', () => {
    const md = ['## 5. Body', '```', '## Why', '```', 'after', '## 6. Next'].join('\n');
    assert.deepEqual(section(md, /^5\. Body$/), ['## 5. Body', '```', '## Why', '```', 'after']);
  });

  void test('section runs to the end of the file when no later heading closes it', () => {
    assert.deepEqual(section('## Last\nx\ny', /^Last$/), ['## Last', 'x', 'y']);
  });

  void test('fences returns the inner lines of each fence in order', () => {
    assert.deepEqual(fences(['a', '```', 'b', 'c', '```', 'd', '```text', 'e', '```']), [['b', 'c'], ['e']]);
  });

  void test('cells splits a row and drops the text outside its outer pipes', () => {
    assert.deepEqual(cells('| a | **b** |'), ['a', '**b**']);
  });

  void test('cells keeps an empty first cell', () => {
    assert.deepEqual(cells('| | Fires when |'), ['', 'Fires when']);
  });

  void test('cells keeps a pipe inside a code span in its own cell', () => {
    assert.deepEqual(cells('| `a | b` | c |'), ['`a | b`', 'c']);
  });

  void test('cells keeps an escaped pipe in its cell', () => {
    assert.deepEqual(cells('| a \\| b | c |'), ['a | b', 'c']);
  });

  void test('bold reads a span that wraps across lines as one line', () => {
    assert.deepEqual(bold('the **content\nmanifest**, one per **demotion**'), ['content manifest', 'demotion']);
  });

  void test('codeSpans skips the text of a markdown link', () => {
    assert.deepEqual(codeSpans('`pipeline-silent` ([`SKILL.md`](SKILL.md) rule 8) · `dispatch-unavailable`'), [
      'pipeline-silent',
      'dispatch-unavailable',
    ]);
  });

  void test('tableAfter reads the rows of the first table after the anchor', () => {
    const lines = [
      'intro',
      'Anchor here',
      '',
      '| K | V |',
      '|---|---|',
      '| a | 1 |',
      '| b | 2 |',
      '',
      '| X | Y |',
      '|---|---|',
      '| z | 9 |',
    ];
    assert.deepEqual(tableAfter(lines, /Anchor/, ['K', 'V']).rows, [
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  void test("tableAfter throws when the table's header is not the one expected", () => {
    const lines = ['Anchor', '| K | V |', '|---|---|', '| a | 1 |'];
    assert.throws(
      () => tableAfter(lines, /Anchor/, ['Kind', 'Value']),
      /has header \["K","V"\], expected \["Kind","Value"\]/,
    );
  });

  void test('tableAfter throws when no table follows the anchor', () => {
    assert.throws(() => tableAfter(['| K |', '|---|', 'Anchor', 'text'], /Anchor/, ['K']), /no table follows/);
  });

  void test('tableAfter throws when the anchor is absent', () => {
    assert.throws(() => tableAfter(['| K |', '|---|'], /Anchor/, ['K']), /no line matches/);
  });

  void test('tableAfter throws when the second row is not a separator', () => {
    assert.throws(() => tableAfter(['Anchor', '| K |', '| a |'], /Anchor/, ['K']), /no separator row/);
  });

  void test('assertSameMembers fails on a code list that repeats a member', () => {
    assert.throws(() => assertSameMembers(['a', 'a'], ['a'], 'items'), /repeat a member/);
  });

  void test('assertSameMembers names the member the code lacks and the one it adds', () => {
    assert.throws(
      () => assertSameMembers(['a', 'c'], ['a', 'b'], 'items'),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.deepEqual(err.actual, { missing: ['b'], extra: ['c'] });
        return true;
      },
    );
  });

  void test('assertSameMembers passes on the same members in another order', () => {
    assert.doesNotThrow(() => assertSameMembers(['b', 'a'], ['a', 'b'], 'items'));
  });

  void test('assertSameMembers fails when nothing was read from the prose', () => {
    assert.throws(() => assertSameMembers(['a'], [], 'items'), /read no items from the prose/);
  });
});

// ---- the drift guards ----------------------------------------------------------------------------------------------------

void describe('SHAPE_REGISTER against SKILL.md "### The shape-change register"', () => {
  void test("lists exactly the register table's versions, in the table's order", () => {
    assert.deepEqual(
      SHAPE_REGISTER.map((r) => r.version),
      registerRows().map((r) => r.version),
    );
  });

  // Hand-read from each register row: the words that name what a run does on crossing it (resolve.md R1).
  const ROUTE_EVIDENCE: Readonly<Record<RegisterRoute, RegExp>> = {
    untouched: /no run touches either/,
    'crossover-note': /one dated crossover line/,
    'add-property': /the run performs the migration itself/,
  };

  for (const entry of SHAPE_REGISTER) {
    void test(`gives v${entry.version} the route its register row describes (${entry.route})`, () => {
      const row = registerRows().find((r) => r.version === entry.version);
      assert.ok(row, `SKILL.md's register has no v${entry.version} row`);
      assert.match(row.what, ROUTE_EVIDENCE[entry.route]);
    });
  }

  void test('lists no version the exclusion line names as changing no shape', () => {
    const excluded = excludedVersions();
    assert.ok(excluded.length > 0, 'read no versions from the exclusion line');
    assert.deepEqual(
      SHAPE_REGISTER.map((r) => r.version).filter((v) => excluded.includes(v)),
      [],
    );
  });

  void test("lists no version newer than the skill's VERSION", () => {
    const current = Number(prose('VERSION').trim());
    assert.ok(Number.isInteger(current), 'VERSION is a bare integer');
    assert.deepEqual(
      SHAPE_REGISTER.map((r) => r.version).filter((v) => v > current),
      [],
    );
  });
});

void describe('STATUSES against spec/databases.md §3', () => {
  void test("equals the lifecycle table's six statuses", () => {
    assertSameMembers(STATUSES, proseStatuses(), 'statuses');
  });
});

void describe('STOP_REASONS against resolve.md R5', () => {
  void test('equals the closed list of stop reasons', () => {
    assertSameMembers(STOP_REASONS, proseStopReasons(), 'stop reasons');
  });

  void test("admits the stop reason every sample's CLOSED line names", () => {
    const named = sampleClosings().flatMap((t) => {
      const m = /^CLOSED \d\d:\d\d · ([A-Z-]+)/.exec(t);
      return m ? [m[1] ?? ''] : [];
    });
    assert.ok(named.length > 0, "read no CLOSED line from R5's samples");
    assert.deepEqual(
      named.filter((r) => !(STOP_REASONS as readonly string[]).includes(r)),
      [],
    );
  });

  void test("no sample's PAUSED line names a stop reason: a paused run has not stopped", () => {
    // R5: "only the last carries CLOSED hh:mm and the stop reason".
    const paused = sampleClosings().filter((t) => t.startsWith('PAUSED'));
    assert.ok(paused.length > 0, "read no PAUSED line from R5's samples");
    for (const t of paused) {
      const words = t.split(/[\s·,]+/);
      assert.deepEqual(
        STOP_REASONS.filter((r) => words.includes(r)),
        [],
        t,
      );
    }
  });

  void test("every sample's closing line is CLOSED or PAUSED", () => {
    const closings = sampleClosings();
    assert.ok(closings.length > 0);
    assert.deepEqual(
      closings.filter((t) => !/^(?:CLOSED|PAUSED)\b/.test(t)),
      [],
    );
  });
});

void describe("the run log's line kinds against resolve.md R5", () => {
  void test("CORE_KINDS equals the line-kinds table's kinds, the group heading included", () => {
    assertSameMembers(CORE_KINDS, proseCoreKinds(), 'core kinds');
  });

  void test('the group heading is the row R5 calls layout, and the table sends it to runs/', () => {
    const row = kindRows().find((k) => k.names.includes(GROUP_HEADING));
    assert.ok(row, 'R5 has no group heading row');
    assert.match(row.carries, /Layout, carrying no fact of its own/);
    assert.equal(row.runsOnly, true);
  });

  void test('RUNS_ONLY_KINDS equals the kinds the table marks (→ runs/)', () => {
    const marked = kindRows()
      .filter((k) => k.runsOnly)
      .flatMap((k) => k.names);
    assertSameMembers([...RUNS_ONLY_KINDS], marked, 'runs-only kinds');
  });

  void test('RUNS_ONLY_KINDS equals the line kinds the split paragraph sends to record/runs/', () => {
    const tableKinds = new Set(proseCoreKinds());
    const sent = dotList(r5().join('\n'), /takes the rest\*\*\s*—\s*\*\*([^*]+)\*\*/).filter((k) => tableKinds.has(k));
    assertSameMembers([...RUNS_ONLY_KINDS], sent, 'kinds sent to runs/');
  });

  void test('the kinds the split paragraph keeps in record/run-log.md are CORE_KINDS less RUNS_ONLY_KINDS', () => {
    const kept = dotList(r5().join('\n'), /keeps only the kinds something reads back\*\*:\s*\*\*([^*]+)\*\*/);
    assertSameMembers(
      CORE_KINDS.filter((k) => !RUNS_ONLY_KINDS.has(k)),
      kept,
      'kinds kept in the run log',
    );
  });

  void test('INIT_ADD_KINDS equals the kinds R5 gives init and add alone', () => {
    assertSameMembers(INIT_ADD_KINDS, singleCommandKinds().initAdd, 'init/add kinds');
  });

  void test('CHALLENGE_KINDS equals the kinds R5 gives questions alone', () => {
    assertSameMembers(CHALLENGE_KINDS, singleCommandKinds().challenge, 'questions kinds');
  });

  void test('LOG_KINDS is every kind R5 names, each once', () => {
    const { initAdd, challenge } = singleCommandKinds();
    assertSameMembers(LOG_KINDS, [...new Set([...proseCoreKinds(), ...initAdd, ...challenge])], 'log kinds');
  });

  void test("every line of R5's samples is a kind a resolve entry admits", () => {
    const used = logSamples()
      .flatMap((b) => b.map(sampleKind))
      .filter((k): k is string => k !== null);
    assert.ok(used.length > 0, "read no lines from R5's samples");
    const admitted: ReadonlySet<string> = kindsFor('resolve');
    assert.deepEqual([...new Set(used.filter((k) => !admitted.has(k)))], []);
  });

  void test("no line of R5's samples is a kind RUNS_ONLY_KINDS keeps out of the log", () => {
    const used = logSamples().flatMap((b) => b.map(sampleKind));
    const runsOnly: ReadonlySet<string> = RUNS_ONLY_KINDS;
    assert.deepEqual([...new Set(used.filter((k) => k !== null && runsOnly.has(k)))], []);
  });

  void test('R5 has two samples, each opening with a heading and then a header line', () => {
    // R5: the first sitting's entry, then "the next sitting opens its own entry under the same run id".
    const samples = logSamples();
    assert.equal(samples.length, 2);
    for (const b of samples) {
      const kinds = b.map(sampleKind).filter((k): k is string => k !== null);
      assert.equal(kinds[0], 'header', b[0]);
      assert.equal(kinds.at(-1), 'closing', b[0]);
    }
  });

  void test('every sample heading carries date · time · command · run id · skill version · sitting, and no state', () => {
    // SKILL.md pre-flight 4 / R5: "Headings carry date · command · run id · version, never a status token".
    const commands = WRITE_COMMANDS.join('|');
    const shape = new RegExp(
      `^## \\d{4}-\\d\\d-\\d\\d · \\d\\d:\\d\\d · (?:${commands}) · run [0-9a-z]{6} · skill v\\d+ · sitting \\d+$`,
    );
    for (const b of logSamples()) {
      const heading = b[0] ?? '';
      assert.match(heading, shape);
      assert.doesNotMatch(heading, /CLOSED|PAUSED|OPEN/);
    }
  });
});

void describe('kindsFor against resolve.md R5 and spec/run-progress.md §1a', () => {
  void test('a resolve entry admits exactly the core kinds', () => {
    assertSameMembers([...kindsFor('resolve')], proseCoreKinds(), 'kinds a resolve entry admits');
  });

  void test("a challenge entry admits the core kinds and questions' own", () => {
    const expected = [...proseCoreKinds(), ...singleCommandKinds().challenge];
    assertSameMembers([...kindsFor('challenge')], [...new Set(expected)], 'kinds a challenge entry admits');
  });

  // run-progress §1a: init I7 and add A5 hand off to a challenge run embedded in their own entry.
  for (const command of ['init', 'add'] as const) {
    void test(`an ${command} entry admits the core kinds, its own and those of the challenge run it embeds`, () => {
      const { initAdd, challenge } = singleCommandKinds();
      const expected = [...proseCoreKinds(), ...initAdd, ...challenge];
      assertSameMembers([...kindsFor(command)], [...new Set(expected)], `kinds an ${command} entry admits`);
    });
  }
});

void describe('DEVIATION_CLASSES against resolve.md R5', () => {
  void test("equals the classes R5's DEVIATIONS row lists", () => {
    const row = kindRows().find((k) => k.names.includes('DEVIATIONS'));
    assert.ok(row, 'R5 has no DEVIATIONS row');
    assertSameMembers(DEVIATION_CLASSES, codeSpans(row.carries), 'deviation classes');
  });
});

void describe('FEATURE_BLOCKS against spec/doc-shape.md §5', () => {
  void test("equals the five ## headings of the feature body's template, in order", () => {
    assert.deepEqual([...FEATURE_BLOCKS], proseFeatureBlocks());
  });
});

void describe('OVERVIEW_BLOCKS against spec/doc-shape.md §3', () => {
  void test("equals the overview table's blocks less the ⟳ views, in page order", () => {
    const blocks = overviewRows()
      .filter((b) => !b.includes('⟳'))
      .map(plain);
    assert.deepEqual([...OVERVIEW_BLOCKS], blocks);
  });
});

void describe('COMMANDS, WRITE_COMMANDS, MODES and PROGRESS_STATES against their single homes', () => {
  void test("COMMANDS equals SKILL.md's command table", () => {
    assertSameMembers(
      COMMANDS,
      commandRows().map((r) => r.command),
      'commands',
    );
  });

  void test('WRITE_COMMANDS equals the commands whose row does not say it writes nothing', () => {
    const writers = commandRows()
      .filter((r) => !/Writes nothing/.test(r.does))
      .map((r) => r.command);
    assertSameMembers(WRITE_COMMANDS, writers, 'write commands');
  });

  void test("MODES equals the modifiers add.md's Two modes table invokes", () => {
    assertSameMembers(MODES, proseModes(), 'modes');
  });

  void test("PROGRESS_STATES equals spec/run-progress.md §1's five states", () => {
    assertSameMembers(PROGRESS_STATES, proseProgressStates(), 'progress states');
  });
});
