import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BpError, EXIT } from '../src/core/errors.ts';
import { STOP_REASONS } from '../src/domain/vocab.ts';
import { join } from 'node:path';
import { parseLog, type ParsedEntry } from '../src/log/parse.ts';
import {
  checkCounts,
  formatCountGroup,
  formatCounts,
  formatFunnel,
  formatHashesRollup,
  itemHashes,
  parseParts,
  readFunnel,
} from '../src/log/lines.ts';
import { validateEntry, validateLog, type Finding } from '../src/log/validate.ts';
import { SKILL_ROOT, fakeSkillRoot, makeHome, readFile, run } from './support/index.ts';

// Scope: src/log/lines.ts, src/log/validate.ts and `bp log validate`.
// Spec: resolve.md R5 (closed list of kinds, routing, COUNTS/HASHES/closing rules), status.md C10 (run-log arithmetic),
// SKILL.md rule 7 (every count counted fresh), DESIGN.md §4.3 (validation; entries before v38 report `legacy`).
//
// Body hashes in run-log lines are the first 12 hex characters of a SHA-256 (spec/targets.md §5). None of the code under
// test computes a hash — it only compares strings — so the values below are arbitrary 12-hex literals, except H_ABC,
// which is the first 12 hex of the known vector sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.

const H_ABC = 'ba7816bf8f01';
const H1 = '0123456789ab';
const H2 = 'aaaaaaaaaaaa';
const H3 = 'bbbbbbbbbbbb';

// ---- helpers (local to this file) -----------------------------------------------------------------------------------

interface HeadingOpts {
  run?: string;
  sitting?: number;
}

/** A bp-shaped entry heading (DESIGN.md §4.1). `version: null` writes a heading with no `skill v<N>` token. */
function heading(command: string, version: number | null, opts: HeadingOpts = {}): string {
  const v = version === null ? '' : ` · skill v${version}`;
  return `## 2026-09-25 · 14:07 · ${command} · run ${opts.run ?? 'a1b2c3'}${v} · sitting ${opts.sitting ?? 1}`;
}

/** One entry with no preamble: the heading is physical line 1, so body[i] is line i + 2. */
function entryLog(command: string, version: number | null, body: readonly string[], opts: HeadingOpts = {}): string {
  return [heading(command, version, opts), ...body].join('\n');
}

const findingsOf = (text: string): Finding[] => validateLog(parseLog(text));

/** Findings for a single v38 entry of `command` carrying `body`. */
const v38 = (command: string, body: readonly string[]): Finding[] => findingsOf(entryLog(command, 38, body));

function firstEntry(text: string): ParsedEntry {
  const e = parseLog(text).entries[0];
  assert.ok(e, 'the arranged log has at least one entry');
  return e;
}

function single(fs: readonly Finding[]): Finding {
  assert.equal(fs.length, 1, `expected exactly one finding, got ${JSON.stringify(fs)}`);
  const f = fs[0];
  assert.ok(f);
  return f;
}

/** A throws-validator: a BpError with the usage exit code and, optionally, a message matching `re`. */
const usageError =
  (re?: RegExp) =>
  (err: unknown): boolean =>
    err instanceof BpError && err.code === EXIT.usage && (re === undefined || re.test(err.message));

// ---- formatCountGroup -----------------------------------------------------------------------------------------------

void describe('formatCountGroup', () => {
  void test('computes the total from its addends and writes label total = name n · name n', () => {
    const line = formatCountGroup({
      label: 'question rows',
      parts: [
        { name: 'Applied', n: 48 },
        { name: 'Open', n: 0 },
      ],
    });
    // 48 + 0 = 48
    assert.equal(line, 'question rows 48 = Applied 48 · Open 0');
  });

  void test('sums three addends into the total', () => {
    const line = formatCountGroup({
      label: 'markers',
      parts: [
        { name: 'README', n: 4 },
        { name: 'Checkout', n: 5 },
        { name: 'Menu', n: 19 },
      ],
    });
    // 4 + 5 + 19 = 28
    assert.equal(line, 'markers 28 = README 4 · Checkout 5 · Menu 19');
  });

  void test('trims whitespace around the label and addend names', () => {
    const line = formatCountGroup({ label: '  markers ', parts: [{ name: ' README ', n: 4 }] });
    assert.equal(line, 'markers 4 = README 4');
  });

  void test('writes a zero total when every addend is zero', () => {
    assert.equal(formatCountGroup({ label: 'flagged', parts: [{ name: 'resolve', n: 0 }] }), 'flagged 0 = resolve 0');
  });

  void test('refuses a blank label', () => {
    assert.throws(() => formatCountGroup({ label: '   ', parts: [{ name: 'a', n: 1 }] }), usageError(/label/));
  });

  void test('refuses a group with no addends, since R5 forbids a bare total', () => {
    assert.throws(() => formatCountGroup({ label: 'features', parts: [] }), usageError(/no addends/));
  });

  void test('refuses a negative addend', () => {
    assert.throws(
      () => formatCountGroup({ label: 'rows', parts: [{ name: 'Open', n: -1 }] }),
      usageError(/non-negative integer/),
    );
  });

  void test('refuses a fractional or non-finite addend', () => {
    for (const n of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => formatCountGroup({ label: 'rows', parts: [{ name: 'Open', n }] }),
        usageError(/non-negative integer/),
        `n = ${n}`,
      );
    }
  });

  void test('refuses a separator character (·, ; or =) inside an addend name', () => {
    for (const name of ['a · b', 'a;b', 'a=b']) {
      assert.throws(
        () => formatCountGroup({ label: 'rows', parts: [{ name, n: 1 }] }),
        usageError(/cannot contain/),
        name,
      );
    }
  });

  void test('refuses a separator character (·, ; or =) inside the label', () => {
    for (const label of ['rows · all', 'rows;all', 'rows=all']) {
      assert.throws(
        () => formatCountGroup({ label, parts: [{ name: 'Open', n: 1 }] }),
        usageError(/cannot contain/),
        label,
      );
    }
  });
});

// ---- formatCounts ---------------------------------------------------------------------------------------------------

void describe('formatCounts', () => {
  void test('joins several groups with "; "', () => {
    const line = formatCounts([
      {
        label: 'question rows',
        parts: [
          { name: 'Applied', n: 48 },
          { name: 'Open', n: 0 },
        ],
      },
      {
        label: 'markers',
        parts: [
          { name: 'README', n: 4 },
          { name: 'features', n: 24 },
        ],
      },
    ]);
    // 48 + 0 = 48; 4 + 24 = 28
    assert.equal(line, 'question rows 48 = Applied 48 · Open 0; markers 28 = README 4 · features 24');
  });

  void test('refuses the whole line when any one group is invalid', () => {
    assert.throws(
      () =>
        formatCounts([
          { label: 'question rows', parts: [{ name: 'Open', n: 3 }] },
          { label: 'markers', parts: [] },
        ]),
      usageError(/markers/),
    );
  });
});

// ---- parseParts -----------------------------------------------------------------------------------------------------

void describe('parseParts', () => {
  void test('parses comma-separated name=number pairs in order', () => {
    assert.deepEqual(parseParts('Applied=48, Open=0'), [
      { name: 'Applied', n: 48 },
      { name: 'Open', n: 0 },
    ]);
  });

  void test('tolerates whitespace around names, "=" and commas', () => {
    assert.deepEqual(parseParts('  Applied = 48 ,Open=  0 '), [
      { name: 'Applied', n: 48 },
      { name: 'Open', n: 0 },
    ]);
  });

  void test('keeps a multi-word addend name whole', () => {
    assert.deepEqual(parseParts('open markers=3'), [{ name: 'open markers', n: 3 }]);
  });

  void test('skips empty segments between and after commas', () => {
    assert.deepEqual(parseParts('a=1,,b=2,'), [
      { name: 'a', n: 1 },
      { name: 'b', n: 2 },
    ]);
  });

  void test('returns no addends for an empty or blank spec', () => {
    assert.deepEqual(parseParts(''), []);
    assert.deepEqual(parseParts('  ,  '), []);
  });

  void test('reads leading zeros as the decimal number', () => {
    assert.deepEqual(parseParts('a=007'), [{ name: 'a', n: 7 }]);
  });

  void test('refuses a part with no "="', () => {
    assert.throws(() => parseParts('Applied 48'), usageError(/"Applied 48" is not name=number/));
  });

  void test('refuses a part with no name before "="', () => {
    assert.throws(() => parseParts('=3'), usageError(/not name=number/));
  });

  void test('refuses a value that is not a non-negative integer', () => {
    for (const spec of ['a=x', 'a=-1', 'a=1.5', 'a=', 'a=3 rows']) {
      assert.throws(() => parseParts(spec), usageError(/not name=number/), spec);
    }
  });
});

// ---- checkCounts ----------------------------------------------------------------------------------------------------

void describe('checkCounts', () => {
  void test('reads groups separated by ";" and reports only the wrong one', () => {
    // group 1: 48 + 0 = 48; group 2: 1 + 2 = 3, not 5
    assert.deepEqual(checkCounts('question rows 48 = Applied 48 · Open 0; markers 5 = README 1 · features 2'), {
      mismatches: ['markers: total 5 but addends sum to 3'],
      bare: [],
    });
  });

  void test('sums a slash-joined addend as its parts', () => {
    // 4 + (5 + 7 + 8 + 4) = 28
    assert.deepEqual(checkCounts('markers 28 = README 4 · features 5/7/8/4'), { mismatches: [], bare: [] });
  });

  void test('reads a total written last', () => {
    // 13 + 47 + 2 + 26 = 88
    assert.deepEqual(checkCounts('Answered 13 · Applied 47 · Flagged 2 · Open 26 = 88'), { mismatches: [], bare: [] });
  });

  void test('lists a group with a number and no "=" as a bare total', () => {
    assert.deepEqual(checkCounts('question rows 48 = Applied 48 · Open 0; features 12'), {
      mismatches: [],
      bare: ['features 12'],
    });
  });

  void test('ignores empty groups between separators', () => {
    assert.deepEqual(checkCounts('question rows 3 = Open 3;;  ; '), { mismatches: [], bare: [] });
  });
});

// ---- formatFunnel ---------------------------------------------------------------------------------------------------

void describe('formatFunnel', () => {
  void test("writes the five outcomes in challenge.md Q6's order after the drafted count", () => {
    // questions.md's own sample split: 14 + 2 + 1 + 3 + 13 = 33
    const line = formatFunnel({ drafted: 33, defaults: 14, fixes: 2, slots: 1, questions: 3, discarded: 13 });
    assert.equal(
      line,
      '33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded',
    );
  });

  void test('writes an all-zero funnel', () => {
    const line = formatFunnel({ drafted: 0, defaults: 0, fixes: 0, slots: 0, questions: 0, discarded: 0 });
    assert.equal(
      line,
      '0 drafted → 0 routed default · 0 routed fix · 0 routed slot · 0 written as questions · 0 discarded',
    );
  });

  void test('refuses a funnel whose outcomes do not sum to the drafted count', () => {
    // 14 + 2 + 1 + 3 + 12 = 32, not 33
    assert.throws(
      () => formatFunnel({ drafted: 33, defaults: 14, fixes: 2, slots: 1, questions: 3, discarded: 12 }),
      usageError(/33 drafted but outcomes sum to 32/),
    );
  });

  void test('refuses a funnel whose outcomes exceed the drafted count', () => {
    // 1 + 1 + 1 + 1 + 1 = 5, not 4
    assert.throws(
      () => formatFunnel({ drafted: 4, defaults: 1, fixes: 1, slots: 1, questions: 1, discarded: 1 }),
      usageError(/4 drafted but outcomes sum to 5/),
    );
  });
});

// ---- readFunnel -----------------------------------------------------------------------------------------------------

void describe('readFunnel', () => {
  void test("reads drafted, discarded and the outcome sum from bp's own funnel shape", () => {
    const f = readFunnel(
      '33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded',
    );
    assert.deepEqual(f, { drafted: 33, discarded: 13, outcomes: 33 });
  });

  void test('sums outcomes that do not add up to drafted as written', () => {
    // 2 + 1 + 0 + 3 + 2 = 8
    const f = readFunnel(
      '10 drafted → 2 routed default · 1 routed fix · 0 routed slot · 3 written as questions · 2 discarded',
    );
    assert.deepEqual(f, { drafted: 10, discarded: 2, outcomes: 8 });
  });

  void test('ignores a detail suffix that carries no outcome word', () => {
    const f = readFunnel(
      '33 drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded · 2 by the cold read',
    );
    assert.deepEqual(f, { drafted: 33, discarded: 13, outcomes: 33 });
  });

  void test('reads an all-zero funnel', () => {
    const f = readFunnel(
      '0 drafted → 0 routed default · 0 routed fix · 0 routed slot · 0 written as questions · 0 discarded',
    );
    assert.deepEqual(f, { drafted: 0, discarded: 0, outcomes: 0 });
  });

  void test('returns null for a line with no drafted count', () => {
    assert.equal(readFunnel('14 routed default · 13 discarded'), null);
  });

  void test('returns null for a line with no discarded count', () => {
    assert.equal(readFunnel('33 drafted → 14 routed default · 19 written as questions'), null);
  });

  void test('finds "N drafted" anywhere in the line, not only at its start', () => {
    // 4 + 2 + 0 + 3 + 3 = 12
    const f = readFunnel(
      'scale delta · 12 drafted → 4 routed default · 2 routed fix · 0 routed slot · 3 written as questions · 3 discarded',
    );
    assert.deepEqual(f, { drafted: 12, discarded: 3, outcomes: 12 });
  });

  void test('returns null for the report wording "33 candidates drafted", where no count stands directly before "drafted"', () => {
    // questions.md:1232 is the REPORT's funnel line, not a log line: the log's funnel is composed by `bp log funnel`
    // (SKILL.md:63, rule 1) in the "N drafted → …" shape, and a funnel bp cannot read is a finding, never a guess.
    const f = readFunnel(
      '33 candidates drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions (1 transcribed from a carried marker) · 13 discarded on a filter (2 by the cold read)',
    );
    assert.equal(f, null);
  });
});

// ---- itemHashes -----------------------------------------------------------------------------------------------------

void describe('itemHashes', () => {
  void test('keys each body hash by the feature named nearest before it', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [
        `- item: «Can a customer retry a failed payment?» · Clean · «Checkout» FR-2, FR-5 · body ${H_ABC}`,
      ]),
    );
    assert.deepEqual([...itemHashes(entry)], [['Checkout', H_ABC]]);
  });

  void test('lets the last item line for a feature win', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [
        `- item: «q-01» · Patched · «Checkout» FR-2 · body ${H1}`,
        `- item: «q-02» · Patched · «Checkout» FR-3 · body ${H2}`,
      ]),
    );
    assert.equal(itemHashes(entry).get('Checkout'), H2);
  });

  void test('reads every feature-hash pair on one item line', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [`- item: «q-07» · Patched · «Checkout» FR-2 body ${H1} · «Menu» FR-4 body ${H2}`]),
    );
    assert.deepEqual(
      [...itemHashes(entry)],
      [
        ['Checkout', H1],
        ['Menu', H2],
      ],
    );
  });

  void test('ignores an item line that recorded no body hash', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, ['- item: «q-04» · Flagged · — · R2.1: answer is only a link · body —']),
    );
    assert.equal(itemHashes(entry).size, 0);
  });

  void test('ignores a feature-and-body pair on a line that is not an item line', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [
        `- NOTE: re-baselined «Checkout» body ${H1}`,
        `- FLAGGED: «Menu» objection text body ${H2}`,
      ]),
    );
    assert.equal(itemHashes(entry).size, 0);
  });

  void test('ignores a body value that is abbreviated or not lower-case hex', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [
        '- item: «q-01» · Clean · «Checkout» FR-2 · body 9f2c…41d',
        '- item: «q-02» · Clean · «Menu» FR-4 · body 0123456789AB',
      ]),
    );
    assert.equal(itemHashes(entry).size, 0);
  });

  void test('reads hashes from legacy column-format item lines', () => {
    const entry = firstEntry(
      entryLog('resolve', 21, [
        `item         «Can a customer retry a failed…»   Clean      3afc…b75  «Checkout» FR-2, FR-5      body ${H3}`,
      ]),
    );
    assert.deepEqual([...itemHashes(entry)], [['Checkout', H3]]);
  });
});

// ---- formatHashesRollup ---------------------------------------------------------------------------------------------

void describe('formatHashesRollup', () => {
  void test('repeats a single item hash as «Feature» hash', () => {
    const entry = firstEntry(entryLog('resolve', 38, [`- item: «q-01» · Clean · «Checkout» FR-2 · body ${H_ABC}`]));
    assert.equal(formatHashesRollup(entry), `«Checkout» ${H_ABC}`);
  });

  void test("keeps features in first-written order while carrying each feature's last hash", () => {
    const entry = firstEntry(
      entryLog('resolve', 38, [
        `- item: «q-01» · Patched · «Checkout» FR-2 · body ${H1}`,
        `- item: «q-02» · Patched · «Menu» FR-4 · body ${H2}`,
        `- item: «q-03» · Patched · «Checkout» FR-3 · body ${H3}`,
      ]),
    );
    assert.equal(formatHashesRollup(entry), `«Checkout» ${H3} · «Menu» ${H2}`);
  });

  void test('refuses an entry whose item lines carry no body hash', () => {
    const entry = firstEntry(
      entryLog('resolve', 38, ['- item: «q-04» · Flagged · — · body —', '- NOTE: nothing hashed']),
    );
    assert.throws(() => formatHashesRollup(entry), usageError(/nothing to roll up/));
  });
});

// ---- validateEntry / validateLog ------------------------------------------------------------------------------------

void describe('validate: a well-formed entry', () => {
  void test('a v38 challenge entry whose every line obeys R5 and C10 yields no findings', () => {
    const findings = v38('challenge', [
      '- header: date 2026-09-25 · time 14:07 · command challenge · run a1b2c3 · version 38 · sitting 1',
      '- independence: writer model-a, checker model-b, cold read: not dispatched',
      `- item: «Checkout» FR-2 · body ${H_ABC}`,
      '- discard: «Checkout» duplicate of FR-2',
      '- discard: cold read · «Menu» not a specification question',
      // 1 + 1 + 0 + 1 + 2 = 5 drafted; 2 discarded = the 2 discard lines above
      '- funnel: 5 drafted → 1 routed default · 1 routed fix · 0 routed slot · 1 written as questions · 2 discarded',
      '- COUNTS: question rows 3 = Open 3',
      `- HASHES: «Checkout» ${H_ABC}`,
      '- closing: CLOSED 14:30 · HUMAN-BLOCKED',
    ]);
    assert.deepEqual(findings, []);
  });

  void test('blank lines, separators and fences inside an entry are not lines of the entry', () => {
    const findings = v38('resolve', ['', '---', '```', '- NOTE: a deferral', '```', '']);
    assert.deepEqual(findings, []);
  });

  void test('an indented continuation joins the line above it rather than standing as a line with no kind', () => {
    const findings = v38('resolve', ['- NOTE: a destructive act, the ask verbatim', '  "delete the old overview"']);
    assert.deepEqual(findings, []);
  });
});

void describe('validate: severity by the entry’s skill version (DESIGN.md §4.3)', () => {
  void test('a finding in a v38 entry is an error', () => {
    const f = single(findingsOf(entryLog('resolve', 38, ['Stray explanation of the verdict.'])));
    assert.equal(f.severity, 'error');
  });

  void test('a finding in a v37 entry is legacy', () => {
    const f = single(findingsOf(entryLog('resolve', 37, ['Stray explanation of the verdict.'])));
    assert.equal(f.severity, 'legacy');
  });

  void test('a finding in an entry whose heading names no skill version is legacy', () => {
    const f = single(findingsOf(entryLog('resolve', null, ['Stray explanation of the verdict.'])));
    assert.equal(f.severity, 'legacy');
  });

  void test('a finding carries the run id, the sitting and the 1-based physical line', () => {
    const text = entryLog('resolve', 40, ['- NOTE: fine', 'Stray explanation of the verdict.'], {
      run: 'ff00aa',
      sitting: 2,
    });
    const f = single(findingsOf(text));
    assert.deepEqual(
      { runId: f.runId, sitting: f.sitting, line: f.line, severity: f.severity },
      { runId: 'ff00aa', sitting: 2, line: 3, severity: 'error' },
    );
  });
});

void describe('validate: every line has a kind on R5’s closed list', () => {
  void test('a prose line with no kind is reported', () => {
    const f = single(v38('resolve', ['- NOTE: fine', 'The writer patched FR-2 because the answer was clear.']));
    assert.equal(f.line, 3);
    assert.match(f.message, /no kind/);
  });

  void test('a bullet with a kind not on the closed list is reported', () => {
    const f = single(v38('resolve', ['- SUMMARY: six items, all fine']));
    assert.equal(f.line, 2);
    assert.match(f.message, /"SUMMARY" is not on R5's closed list/);
  });

  void test('a kind written in different case from the closed list is reported', () => {
    const f = single(v38('resolve', ['- note: a deferral']));
    assert.match(f.message, /"note" differs in case from the closed list's "NOTE"/);
  });

  void test('a group heading written into the log is reported as belonging in record/runs/', () => {
    // resolve.md:900 and :917 route group heading to record/runs/<run-id>.md; DESIGN.md §4.3: "every line sits in the
    // file its routing names".
    const f = single(v38('resolve', ['- group heading: APPLIED']));
    assert.equal(f.line, 2);
    assert.match(f.message, /record\/runs\//);
  });

  void test('a bare CON line, with no -k number, is reported as off the closed list', () => {
    // resolve.md:933 lists CON-k lines; `CON` alone names no contradiction.
    const f = single(v38('init', ['- CON: notes.md §2 vs call.md §4']));
    assert.match(f.message, /"CON" is not on R5's closed list/);
  });
});

void describe('validate: kinds a command admits (resolve.md R5, "More belong to single commands")', () => {
  void test('a funnel line in a resolve entry is reported as not admitted', () => {
    const f = single(
      v38('resolve', [
        '- funnel: 0 drafted → 0 routed default · 0 routed fix · 0 routed slot · 0 written as questions · 0 discarded',
      ]),
    );
    assert.match(f.message, /"funnel" is not a kind a resolve entry admits/);
  });

  void test('a GRILL line in a resolve entry is reported as not admitted', () => {
    const f = single(v38('resolve', ['- GRILL: delta · 2 bodies attacked · converged: no']));
    assert.match(f.message, /"GRILL" is not a kind a resolve entry admits/);
  });

  void test('a discard line in a resolve entry is reported as not admitted', () => {
    const f = single(v38('resolve', ['- discard: «Menu» not a specification question']));
    assert.match(f.message, /"discard" is not a kind a resolve entry admits/);
  });

  void test('a CON-k line in a challenge entry is reported as not admitted', () => {
    const f = single(v38('challenge', ['- CON-3: «Checkout» vs «Menu» · sources/a1b2c3/contradictions.md']));
    assert.match(f.message, /"CON" is not a kind a challenge entry admits/);
  });

  void test('a VERDICTS line in a challenge entry is reported as not admitted', () => {
    const f = single(v38('challenge', ['- VERDICTS: Clean 4']));
    assert.match(f.message, /"VERDICTS" is not a kind a challenge entry admits/);
  });

  void test("an init entry admits CON-k, VERDICTS, discard and the challenge run's own kinds", () => {
    const findings = v38('init', [
      '- CON-2: «Checkout» vs «Menu» · sources/a1b2c3/contradictions.md',
      '- VERDICTS: Clean 4',
      '- discard: «Menu» client-internal',
      '- ledger a2d011 #1: «Checkout» default · standard practice',
      '- GRILL: full · 3 bodies attacked · converged: no',
    ]);
    assert.deepEqual(findings, []);
  });

  void test('an entry for a command that does not write is reported at its heading', () => {
    // status.md reads everything and writes nothing (resolve.md:745), so a status entry is not a write command's.
    const f = single(v38('status', ['- NOTE: a stray line']));
    assert.equal(f.line, 1);
    assert.match(f.message, /"status" is not a write command/);
  });
});

void describe('validate: routing — check, DEVIATIONS and COST belong in record/runs/ (R5)', () => {
  void test('a check line in the log is reported', () => {
    const f = single(v38('resolve', ['- check: R2.1 queue loaded · 18 rows eligible']));
    assert.match(f.message, /record\/runs\//);
  });

  void test("R1's version-reconciliation check stays in the log without a finding", () => {
    const findings = v38('resolve', [
      '- check: R1 version reconciliation · log v37 → skill v38 · no register entry crossed',
    ]);
    assert.deepEqual(findings, []);
  });

  void test('a DEVIATIONS line in the log is reported', () => {
    const f = single(v38('resolve', ['- DEVIATIONS: brief-violation · item 3']));
    assert.match(f.message, /"DEVIATIONS" belongs in record\/runs\//);
  });

  void test('a COST line in the log is reported', () => {
    const f = single(
      v38('resolve', ['- COST: 12 dispatches · ~400k tokens · 41 min (self-reported, not recountable)']),
    );
    assert.match(f.message, /"COST" belongs in record\/runs\//);
  });
});

void describe('validate: COUNTS carry addends that sum to their total (R5, rule 7, C10)', () => {
  void test('a total that agrees with its addends yields no finding', () => {
    assert.deepEqual(v38('resolve', ['- COUNTS: question rows 48 = Applied 48 · Open 0']), []);
  });

  void test('a total that disagrees with its addends is reported with both numbers', () => {
    // 1 + 2 = 3, not 5
    const f = single(v38('resolve', ['- COUNTS: markers 5 = README 1 · features 2']));
    assert.equal(f.line, 2);
    assert.match(f.message, /markers: total 5 but addends sum to 3/);
  });

  void test('among several "; "-separated groups only the wrong one is reported', () => {
    // group 1: 48 + 0 = 48 (right); group 2: 1 + 2 = 3, not 5 (wrong)
    const f = single(
      v38('resolve', ['- COUNTS: question rows 48 = Applied 48 · Open 0; markers 5 = README 1 · features 2']),
    );
    assert.match(f.message, /markers: total 5 but addends sum to 3/);
  });

  void test('each wrong group on one COUNTS line is its own finding', () => {
    // group 1: 40 + 0 = 40, not 48; group 2: 1 + 2 = 3, not 5
    const findings = v38('resolve', [
      '- COUNTS: question rows 48 = Applied 40 · Open 0; markers 5 = README 1 · features 2',
    ]);
    assert.equal(findings.length, 2);
    assert.match(findings[0]?.message ?? '', /question rows: total 48 but addends sum to 40/);
    assert.match(findings[1]?.message ?? '', /markers: total 5 but addends sum to 3/);
  });

  void test("R5's own COUNTS example, with a slash-listed addend, is consistent and yields no finding", () => {
    // resolve.md:923: `markers 28 = README 4 · features 5/7/8/4` — 4 + (5 + 7 + 8 + 4) = 4 + 24 = 28.
    assert.deepEqual(v38('resolve', ['- COUNTS: markers 28 = README 4 · features 5/7/8/4']), []);
  });

  void test('a slash-listed addend whose parts do not reach the total is reported', () => {
    // 4 + (5 + 7 + 8 + 4) = 28, not 30
    const f = single(v38('resolve', ['- COUNTS: markers 30 = README 4 · features 5/7/8/4']));
    assert.match(f.message, /markers: total 30 but addends sum to 28/);
  });

  void test("R5's sample COUNTS line is consistent and yields no finding", () => {
    // resolve.md:975: `question rows 88 = Answered 13 · Applied 47 · Flagged 2 · Open 26` — 13 + 47 + 2 + 26 = 88.
    assert.deepEqual(
      v38('resolve', ['- COUNTS: question rows 88 = Answered 13 · Applied 47 · Flagged 2 · Open 26']),
      [],
    );
  });

  void test('a group with its total written last is consistent and yields no finding', () => {
    // The shape older entries wrote: 13 + 47 + 2 + 26 = 88.
    assert.deepEqual(v38('resolve', ['- COUNTS: Answered 13 · Applied 47 · Flagged 2 · Open 26 = 88']), []);
  });

  void test('a group with its total written last that disagrees with its addends is reported', () => {
    // 13 + 47 = 60, not 61
    const f = single(v38('resolve', ['- COUNTS: Answered 13 · Applied 47 = 61']));
    assert.match(f.message, /total 61 but addends sum to 60/);
  });

  void test('a bare total with no addends is reported', () => {
    // resolve.md:923: COUNTS carry "each carrying its addends, not a bare total" (v21).
    const f = single(v38('resolve', ['- COUNTS: features 12']));
    assert.match(f.message, /bare total/);
  });

  void test('a bare total among well-formed groups is reported on its own', () => {
    // group 1: 48 + 0 = 48 (right); group 2 states 12 with no addends
    const f = single(v38('resolve', ['- COUNTS: question rows 48 = Applied 48 · Open 0; features 12']));
    assert.match(f.message, /"features 12" is a bare total/);
  });

  void test('a bare total in an entry written before v38 is no finding at all', () => {
    // The bare-total rule is checked on entries bp wrote (skill >= 38); an older entry is read under the rules of its day.
    assert.deepEqual(findingsOf(entryLog('resolve', 37, ['- COUNTS: features 12'])), []);
  });

  void test('a COUNTS group that states no number is not a bare total', () => {
    assert.deepEqual(v38('resolve', ['- COUNTS: none this sitting']), []);
  });

  void test('a COUNTS line composed by formatCounts passes validation', () => {
    const counts = formatCounts([
      {
        label: 'question rows',
        parts: [
          { name: 'Applied', n: 47 },
          { name: 'Open', n: 26 },
        ],
      },
      {
        label: 'markers',
        parts: [
          { name: 'README', n: 4 },
          { name: 'features', n: 24 },
        ],
      },
    ]);
    assert.deepEqual(v38('resolve', [`- COUNTS: ${counts}`]), []);
  });
});

void describe('validate: HASHES repeat the item lines character for character (R5)', () => {
  void test('a roll-up equal to the item line yields no finding', () => {
    assert.deepEqual(
      v38('resolve', [`- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`, `- HASHES: «Checkout» ${H1}`]),
      [],
    );
  });

  void test('a roll-up value that disagrees with the item line is reported with both values', () => {
    const f = single(
      v38('resolve', [`- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`, `- HASHES: «Checkout» ${H2}`]),
    );
    assert.equal(f.line, 3);
    assert.match(f.message, new RegExp(`«Checkout» ${H2} disagrees with the item line's ${H1}`));
  });

  void test("the roll-up is compared with the feature's last item line, so the earlier hash is a disagreement", () => {
    const f = single(
      v38('resolve', [
        `- item: «q-01» · Patched · «Checkout» FR-2 · body ${H1}`,
        `- item: «q-02» · Patched · «Checkout» FR-3 · body ${H2}`,
        `- HASHES: «Checkout» ${H1}`,
      ]),
    );
    assert.match(f.message, new RegExp(`disagrees with the item line's ${H2}`));
  });

  void test("the roll-up carrying the feature's last item hash yields no finding", () => {
    const findings = v38('resolve', [
      `- item: «q-01» · Patched · «Checkout» FR-2 · body ${H1}`,
      `- item: «q-02» · Patched · «Checkout» FR-3 · body ${H2}`,
      `- HASHES: «Checkout» ${H2}`,
    ]);
    assert.deepEqual(findings, []);
  });

  void test('a roll-up naming a feature no item line carries is reported', () => {
    const f = single(
      v38('resolve', [
        `- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`,
        `- HASHES: «Checkout» ${H1} · «Menu» ${H2}`,
      ]),
    );
    assert.equal(f.line, 3);
    assert.match(f.message, /«Menu»/);
    assert.match(f.message, /no item line/);
  });

  void test('a value marked "(computed fresh)" for a body no item line carries yields no finding', () => {
    // resolve.md:924: "A hash for a body no item line carried is computed fresh … and marked as such."
    assert.deepEqual(
      v38('resolve', [
        `- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`,
        `- HASHES: «Checkout» ${H1} · «Menu» ${H2} (computed fresh)`,
      ]),
      [],
    );
  });

  void test('a value marked "(computed fresh)" that disagrees with an item line is still reported', () => {
    // resolve.md:924: "A roll-up value that disagrees with an item line in the same entry may not be written."
    const f = single(
      v38('resolve', [
        `- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`,
        `- HASHES: «Checkout» ${H2} (computed fresh)`,
      ]),
    );
    assert.match(f.message, new RegExp(`«Checkout» ${H2} disagrees with the item line's ${H1}`));
  });

  void test("an item line in another entry does not vouch for this entry's roll-up", () => {
    // Newest first: entry 1 (lines 1–2) carries the roll-up, entry 2 (lines 3–4) carries the item.
    const text = [
      heading('resolve', 38, { sitting: 2 }),
      `- HASHES: «Checkout» ${H1}`,
      heading('resolve', 38, { sitting: 1 }),
      `- item: «q-01» · Clean · «Checkout» FR-2 · body ${H1}`,
    ].join('\n');
    const f = single(findingsOf(text));
    assert.deepEqual({ line: f.line, sitting: f.sitting }, { line: 2, sitting: 2 });
    assert.match(f.message, /«Checkout»/);
  });

  void test('a roll-up composed by formatHashesRollup passes validation', () => {
    const body = [
      `- item: «q-01» · Patched · «Checkout» FR-2 · body ${H1}`,
      `- item: «q-02» · Patched · «Menu» FR-4 · body ${H2}`,
      `- item: «q-03» · Patched · «Checkout» FR-3 · body ${H3}`,
    ];
    const rollup = formatHashesRollup(firstEntry(entryLog('resolve', 38, body)));
    assert.deepEqual(v38('resolve', [...body, `- HASHES: ${rollup}`]), []);
  });
});

void describe('validate: the funnel against its outcomes and the discard lines (status.md C10)', () => {
  void test('a funnel whose outcomes do not sum to drafted is reported', () => {
    // 2 + 1 + 0 + 3 + 2 = 8, not 10; 2 discarded matches the 2 discard lines
    const f = single(
      v38('challenge', [
        '- discard: «A» client-internal',
        '- discard: «B» not a specification question',
        '- funnel: 10 drafted → 2 routed default · 1 routed fix · 0 routed slot · 3 written as questions · 2 discarded',
      ]),
    );
    assert.equal(f.line, 4);
    assert.match(f.message, /10 drafted but outcomes sum to 8/);
  });

  void test('a funnel claiming more discards than the entry has discard lines is reported', () => {
    // v17's measured defect (status.md:80): the funnel claims 2 discards over 1 recorded. 0+0+0+1+2 = 3 drafted.
    const f = single(
      v38('challenge', [
        '- discard: «A» client-internal',
        '- funnel: 3 drafted → 0 routed default · 0 routed fix · 0 routed slot · 1 written as questions · 2 discarded',
      ]),
    );
    assert.equal(f.line, 3);
    assert.match(f.message, /claims 2 discarded; the entry carries 1 discard lines/);
  });

  void test('a funnel claiming fewer discards than the entry has discard lines is reported', () => {
    // 0+0+0+1+1 = 2 drafted; 1 discarded claimed over 3 discard lines
    const f = single(
      v38('challenge', [
        '- funnel: 2 drafted → 0 routed default · 0 routed fix · 0 routed slot · 1 written as questions · 1 discarded',
        '- discard: «A» client-internal',
        '- discard: «B» not a specification question',
        '- discard: cold read · «C» already answered by FR-3',
      ]),
    );
    assert.match(f.message, /claims 1 discarded; the entry carries 3 discard lines/);
  });

  void test('a funnel wrong on both counts yields both findings', () => {
    // 0+0+0+0+3 = 3, not 5; 3 discarded over 0 discard lines
    const findings = v38('challenge', [
      '- funnel: 5 drafted → 0 routed default · 0 routed fix · 0 routed slot · 0 written as questions · 3 discarded',
    ]);
    assert.equal(findings.length, 2);
  });

  void test('a funnel composed by formatFunnel, over as many discard lines as it claims, passes validation', () => {
    const funnel = formatFunnel({ drafted: 4, defaults: 1, fixes: 0, slots: 0, questions: 1, discarded: 2 });
    assert.deepEqual(
      v38('challenge', ['- discard: «A» client-internal', '- discard: «B» out of scope', `- funnel: ${funnel}`]),
      [],
    );
  });

  void test('a FUNNEL written in upper case is reported as a case mismatch', () => {
    // status.md:80 — the kind is lower-case on R5's closed list.
    const f = single(
      v38('challenge', [
        '- FUNNEL: 1 drafted → 0 routed default · 0 routed fix · 0 routed slot · 1 written as questions · 0 discarded',
      ]),
    );
    assert.match(f.message, /"FUNNEL" differs in case from the closed list's "funnel"/);
  });

  void test("a funnel in the report's wording, in a v38 entry, is reported as unreadable rather than passed", () => {
    // questions.md:1232 is the report's funnel ("33 candidates drafted → …"); a v38 log line is bp's shape. A funnel bp
    // cannot read is a finding (status.md:50: never present a check as clean because its input was missing).
    const f = single(
      v38('challenge', [
        '- discard: «A» client-internal',
        '- funnel: 33 candidates drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions · 13 discarded on a filter',
      ]),
    );
    assert.equal(f.line, 3);
    assert.match(f.message, /cannot read/);
  });

  void test('an unreadable funnel in an entry written before v38 is no finding', () => {
    assert.deepEqual(
      findingsOf(entryLog('questions', 37, ['- funnel: most candidates were discarded on a filter'])),
      [],
    );
  });
});

void describe('validate: the closing line names a stop reason from R5’s closed list', () => {
  void test('every stop reason on the closed list is accepted', () => {
    for (const reason of STOP_REASONS) {
      assert.deepEqual(v38('resolve', [`- closing: CLOSED 14:30 · ${reason}`]), [], reason);
    }
  });

  void test("R5's sample closing line, with run totals after the reason, is accepted", () => {
    // resolve.md:994
    const findings = v38('resolve', [
      '- closing: CLOSED 13:20 · HUMAN-BLOCKED · run totals: 14 applied, 1 returned by a sitting gate, 0 by the sweep · 2 flagged · 3 sittings',
    ]);
    assert.deepEqual(findings, []);
  });

  void test('a CLOSED line with no stop reason is reported', () => {
    const f = single(v38('resolve', ['- closing: CLOSED 14:30']));
    assert.equal(f.line, 2);
    assert.match(f.message, /stop reason/);
  });

  void test('a bare CLOSED line with no stop reason is reported', () => {
    const f = single(v38('resolve', ['CLOSED 14:30']));
    assert.match(f.message, /stop reason/);
  });

  void test('a CLOSED line whose reason is not on the closed list is reported', () => {
    const f = single(v38('resolve', ['- closing: CLOSED 14:30 · FINISHED']));
    assert.match(f.message, /stop reason/);
  });

  void test('a stop reason written in lower case is reported', () => {
    const f = single(v38('resolve', ['- closing: CLOSED 14:30 · drained']));
    assert.match(f.message, /stop reason/);
  });

  void test('a PAUSED line needs no stop reason', () => {
    // resolve.md:784 — a sitting that is not the last closes PAUSED; only the last carries the reason.
    assert.deepEqual(v38('resolve', ['- closing: PAUSED — sitting 1 of a continuing run, 12 rows still queued']), []);
  });

  void test("R5's sample PAUSED line, in the shape bp writes, is accepted", () => {
    // resolve.md:976
    assert.deepEqual(
      v38('resolve', ['- closing: PAUSED 10:02 · sitting 1 of a continuing run, 12 rows still queued']),
      [],
    );
  });

  void test('a PAUSED line naming a stop reason is reported', () => {
    // resolve.md:784–785: "only the last carries CLOSED hh:mm and the stop reason."
    const f = single(v38('resolve', ['- closing: PAUSED 10:02 · DRAINED · sitting 1 of a continuing run']));
    assert.equal(f.line, 2);
    assert.match(f.message, /PAUSED line names the stop reason DRAINED/);
  });

  void test("a human's bare CLOSED (crashed) line is accepted", () => {
    // resolve.md:874 — the one hand-written exception.
    assert.deepEqual(v38('resolve', ['- NOTE: a deferral', 'CLOSED (crashed)']), []);
  });

  void test('CLOSED (crashed) written as a closing bullet is accepted', () => {
    assert.deepEqual(v38('resolve', ['- closing: CLOSED (crashed)']), []);
  });

  void test("CLOSED (crashed) hand-written as a markdown list item is accepted as the human's closing", () => {
    // resolve.md:874/91 — a human writes `CLOSED (crashed)` under the dead entry by hand; parse.ts's entryState already
    // reads `- CLOSED …` as closing this entry, so validation calling it "a line with no kind" contradicts it.
    assert.deepEqual(v38('resolve', ['- NOTE: a deferral', '- CLOSED (crashed)']), []);
  });

  void test('a closing line that is neither CLOSED nor PAUSED is reported', () => {
    // resolve.md:932 — closing carries "`CLOSED hh:mm` with the stop reason, or `PAUSED …`"; :879 "never neither".
    const f = single(v38('resolve', ['- closing: finished for today']));
    assert.match(f.message, /CLOSED hh:mm or PAUSED/);
  });
});

void describe('validate: resolve.md R5 samples', () => {
  /** R5's sample entries, read from the prose: every ``` block whose first line is a `## 2026-08-12 · ` heading. */
  const samples = (): string[] =>
    [...readFile(join(SKILL_ROOT, 'resolve.md')).matchAll(/^```\n([\s\S]*?)^```$/gm)]
      .map((m) => m[1] ?? '')
      .filter((b) => b.startsWith('## 2026-08-12 · '));

  void test('the first sample, "the cap" a run copies, validates with no finding', () => {
    const first = samples()[0];
    assert.ok(first !== undefined, 'resolve.md prints a first sample');
    assert.deepEqual(findingsOf(first), []);
  });

  void test("the second sample's only finding is its elision line; its CLOSED line names a listed reason", () => {
    const second = samples()[1];
    assert.ok(second !== undefined, 'resolve.md prints a second sample');
    const elision = second.split('\n').indexOf('…') + 1;
    const findings = findingsOf(second);
    assert.deepEqual(
      findings.map((f) => f.line),
      [elision],
    );
    assert.match(single(findings).message, /no kind/);
  });
});

void describe('validateLog', () => {
  const twoRuns = [
    heading('resolve', 38, { run: 'bbbbbb' }), // 1
    'Stray explanation in run b.', // 2
    '', // 3
    '---', // 4
    '', // 5
    heading('questions', 38, { run: 'aaaaaa' }), // 6
    'Stray explanation in run a.', // 7
  ].join('\n');

  void test('validates every entry, in file order', () => {
    const findings = validateLog(parseLog(twoRuns));
    assert.deepEqual(
      findings.map((f) => [f.runId, f.line]),
      [
        ['bbbbbb', 2],
        ['aaaaaa', 7],
      ],
    );
  });

  void test('restricts validation to one run id when asked', () => {
    const findings = validateLog(parseLog(twoRuns), { runId: 'aaaaaa' });
    assert.deepEqual(
      findings.map((f) => [f.runId, f.line]),
      [['aaaaaa', 7]],
    );
  });

  void test('ignores preamble lines above the first entry', () => {
    const text = [
      '# Run log — «Test» Blueprint',
      '',
      'Append-only, newest entry first.',
      '',
      '---',
      '',
      heading('resolve', 38),
      '- NOTE: a deferral',
    ].join('\n');
    assert.deepEqual(validateLog(parseLog(text)), []);
  });

  void test('validateEntry reports nothing for an entry with a heading only', () => {
    assert.deepEqual(validateEntry(firstEntry(heading('add', 38))), []);
  });
});

// ---- bp log validate ------------------------------------------------------------------------------------------------

void describe('bp log validate', () => {
  const PREAMBLE = [
    '# Run log — «Test» Blueprint',
    '',
    'Append-only, newest entry first. Never rewritten, never summarised away.',
    '',
    '---',
    '',
  ];
  // With PREAMBLE, the first entry's heading is physical line 7 and its body starts at line 8.
  const log = (...lines: string[]): string => `${[...PREAMBLE, ...lines].join('\n')}\n`;

  void test('a clean log exits 0 and reports no errors', () => {
    const home = makeHome({
      log: log(heading('resolve', 38), '- NOTE: a deferral', '- closing: CLOSED 14:30 · DRAINED'),
    });
    const r = run(['log', 'validate', '--home', home]);
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, /^0 error\(s\)$/m);
  });

  void test('an error exits 1 and prints it with its run id and line number', () => {
    const home = makeHome({
      log: log(heading('resolve', 38), '- NOTE: a deferral', '- COUNTS: markers 5 = README 1 · features 2'),
    });
    const r = run(['log', 'validate', '--home', home]);
    assert.equal(r.code, EXIT.findings);
    assert.match(r.out, /^x run a1b2c3 l\.9: COUNTS: markers: total 5 but addends sum to 3$/m);
    assert.match(r.out, /^1 error\(s\)$/m);
  });

  void test('legacy findings alone exit 0, are hidden, and are counted in the summary', () => {
    const home = makeHome({ log: log(heading('resolve', 37), 'Stray explanation of the verdict.') });
    const r = run(['log', 'validate', '--home', home]);
    assert.equal(r.code, EXIT.ok);
    assert.doesNotMatch(r.out, /Stray explanation/);
    assert.match(r.out, /0 error\(s\), 1 legacy finding\(s\)/);
  });

  void test('--all prints legacy findings marked "~"', () => {
    const home = makeHome({ log: log(heading('resolve', 37), 'Stray explanation of the verdict.') });
    const r = run(['log', 'validate', '--home', home, '--all']);
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, /^~ run a1b2c3 l\.8: a line with no kind/m);
  });

  void test('--json reports error and legacy counts and lists only errors', () => {
    const home = makeHome({
      log: log(
        heading('resolve', 38, { run: 'bbbbbb' }), // 7
        '- DEVIATIONS: brief-violation · item 3', // 8
        '', // 9
        '---', // 10
        '', // 11
        heading('resolve', 37, { run: 'aaaaaa' }), // 12
        'Stray explanation of the verdict.', // 13
      ),
    });
    const r = run(['log', 'validate', '--home', home, '--json']);
    assert.equal(r.code, EXIT.findings);
    const parsed: unknown = JSON.parse(r.out);
    assert.ok(parsed !== null && typeof parsed === 'object');
    const { errors, legacy, findings } = parsed as { errors: unknown; legacy: unknown; findings: unknown };
    assert.equal(errors, 1);
    assert.equal(legacy, 1);
    assert.ok(Array.isArray(findings));
    assert.deepEqual(
      findings.map((f: { runId: string; line: number; severity: string }) => [f.runId, f.line, f.severity]),
      [['bbbbbb', 8, 'error']],
    );
  });

  void test('--json --all lists legacy findings too', () => {
    const home = makeHome({ log: log(heading('resolve', 37), 'Stray explanation of the verdict.') });
    const r = run(['log', 'validate', '--home', home, '--json', '--all']);
    const parsed = JSON.parse(r.out) as {
      errors: number;
      legacy: number;
      findings: { line: number; severity: string }[];
    };
    assert.deepEqual(
      { errors: parsed.errors, legacy: parsed.legacy, findings: parsed.findings.map((f) => [f.line, f.severity]) },
      { errors: 0, legacy: 1, findings: [[8, 'legacy']] },
    );
  });

  void test('--run validates only that run', () => {
    const home = makeHome({
      log: log(
        heading('resolve', 38, { run: 'bbbbbb' }), // 7
        'Stray explanation in run b.', // 8
        '', // 9
        heading('resolve', 38, { run: 'aaaaaa' }), // 10
        '- NOTE: a deferral', // 11
      ),
    });
    const r = run(['log', 'validate', '--home', home, '--run', 'aaaaaa']);
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, /^0 error\(s\)$/m);
  });

  void test('with no run log it is a usage error', () => {
    const home = makeHome();
    const r = run(['log', 'validate', '--home', home]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /no run log to validate/);
  });

  void test('a challenge entry written entirely through bp validates clean', () => {
    const home = makeHome();
    const opts = { skillRoot: fakeSkillRoot(38) };
    const bp = (...argv: string[]): void => {
      const r = run(['log', ...argv, '--home', home], opts);
      assert.equal(r.code, EXIT.ok, `bp log ${argv.join(' ')} → ${r.err}`);
    };
    bp('open', '--command', 'challenge', '--run', 'a1b2c3', '--title', 'Test');
    bp(
      'add',
      '--run',
      'a1b2c3',
      '--kind',
      'independence',
      '--text',
      'writer model-a, checker model-b, cold read: not dispatched',
    );
    bp('add', '--run', 'a1b2c3', '--kind', 'item', '--text', `«Checkout» FR-2 · body ${H_ABC}`);
    bp('add', '--run', 'a1b2c3', '--kind', 'discard', '--text', '«Menu» not a specification question');
    bp(
      'funnel',
      '--run',
      'a1b2c3',
      '--drafted',
      '3',
      '--defaults',
      '1',
      '--fixes',
      '0',
      '--slots',
      '0',
      '--questions',
      '1',
      '--discarded',
      '1',
    );
    bp('counts', '--run', 'a1b2c3', '--group', 'question rows: Open=1, Applied=47');
    bp('hashes', '--run', 'a1b2c3');
    bp('close', '--run', 'a1b2c3', '--reason', 'HUMAN-BLOCKED');
    const r = run(['log', 'validate', '--home', home], opts);
    assert.equal(r.code, EXIT.ok, r.out);
    assert.match(r.out, /^0 error\(s\)$/m);
  });
});

// ---- legacy shapes the real logs carry (review wave 2) -----------------------------------------------------------------

void describe('itemHashes and readFunnel on legacy prose shapes', () => {
  void test('a hash belongs to the feature named with its page id, not a feature a clause says was left unchanged', () => {
    const entry = firstEntry(
      entryLog('resolve', 34, [
        `- item: «Must the club show its rules…» \`0a0a0a0a0b0b0c0c0d0d0e0e0e0e0e0e\` · Clean · «Borrow a lantern» \`1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e\` FR-4 appended · «Return a lantern» and «Pick a slot» unchanged, nothing contradicted · body ${H_ABC}`,
      ]),
    );
    assert.deepEqual([...itemHashes(entry)], [['Borrow a lantern', H_ABC]]);
  });

  void test("a feature named inside the verdict's aside is not the one written", () => {
    const entry = firstEntry(
      entryLog('resolve', 34, [
        `- item: «How long is a slot held…» \`0a0a0a0a0b0b0c0c0d0d0e0e0e0e0e0e\` · Clean (after one retry — the first draft's «Return a lantern» half overreached) · «Pick a slot» \`1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e\` FR-2 · body ${H_ABC}`,
      ]),
    );
    assert.deepEqual([...itemHashes(entry)], [['Pick a slot', H_ABC]]);
  });

  void test('an outcome of its own counts; a detail of a count already given does not; asides never do', () => {
    // 3 + 2 + 1 + 1 + 12 + 1 = 20
    const f = readFunnel(
      "20 drafted (17 grill candidates) → 3 routed default · 2 routed fix · 1 routed slot · 1 written as a question (transcribed, 1 of 2) · 12 discarded (12 at Q3) · 1 transcription not written on the owner's direction",
    );
    assert.deepEqual(f, { drafted: 20, discarded: 12, outcomes: 20 });
  });
});

void describe('the funnel against its discard lines counts demotions that ended discarded', () => {
  void test("a demotion whose disposition check ended DISCARD is one of the funnel's discards; one to a default is not", () => {
    // challenge.md Q4: the funnel's `discarded` term takes a demotion to DISCARD with no new term.
    const entry = firstEntry(
      entryLog('questions', 38, [
        '- discard: A1 «Is a lantern lent in the rain?» · already answered — «Borrow a lantern» FR-2 "Lanterns are lent in any weather."',
        '- demotion: A2 «May a guest borrow?» · routing DEFAULT · disposition check DISCARD, already answered by «Borrow a lantern» FR-1 "Members borrow."',
        '- demotion: A3 «How long is a slot held?» · routing QUESTION · disposition check DEFAULT, one dominant convention',
        '- funnel: 3 drafted → 1 routed default · 0 routed fix · 0 routed slot · 0 written as questions · 2 discarded',
      ]),
    );
    assert.deepEqual(
      validateEntry(entry).filter((f) => /funnel/.test(f.message)),
      [],
    );
  });
});
