import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { captureSources, isCodeRepository, readManifest, sourceRebaselines, verifySources } from '../src/sources.ts';
import { parseLog } from '../src/log/parse.ts';
import { EXIT } from '../src/core/errors.ts';
import { readFile, run, tempDir, writeFile } from './support/index.ts';

// The source record (init.md I1, add.md A1, spec/targets.md §5) and resolve.md R1's capture-integrity check. Expected hashes
// are computed here with node:crypto over the literal bytes, never by the code under test.

const hex = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

void describe('captureSources', () => {
  void test('a file, a folder and a message-shaped source land numbered, verbatim, each hashed over its stored bytes', () => {
    const home = tempDir('bp-src-');
    const given = tempDir('bp-given-');
    const deck = writeFile(join(given, 'Pitch Deck.md'), '# Deck\nSlots are 15 minutes.\n');
    writeFile(join(given, 'notes', 'a.md'), 'Note A\n');
    writeFile(join(given, 'notes', 'b.txt'), 'Note B\n');
    const got = captureSources({
      home,
      runId: 'a1b2c3',
      command: 'add',
      date: '2026-09-25',
      inputs: [
        { path: deck },
        { path: join(given, 'notes') },
        { text: 'Owner said: slots are 30 minutes.', name: 'owner reply.md' },
      ],
    });
    assert.deepEqual(
      got.map((c) => [c.file, c.sha256]),
      [
        ['01-pitch-deck.md', hex('# Deck\nSlots are 15 minutes.\n')],
        ['02-a.md', hex('Note A\n')],
        ['03-b.txt', hex('Note B\n')],
        ['04-owner-reply.md', hex('Owner said: slots are 30 minutes.')],
      ],
    );
    assert.equal(readFile(join(home, 'sources', 'a1b2c3', '04-owner-reply.md')), 'Owner said: slots are 30 minutes.');
    assert.equal(got[3]?.origin, 'given in conversation, 2026-09-25');
    const manifest = readFile(join(home, 'sources', 'a1b2c3', 'MANIFEST.md'));
    assert.match(manifest, /^# Source record — run a1b2c3 \(add\) · 2026-09-25$/m);
    assert.match(
      manifest,
      new RegExp(
        `^\\| 1 \\| \`01-pitch-deck\\.md\` \\| file: ${deck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| 29 \\| \`${hex('# Deck\nSlots are 15 minutes.\n')}\` \\|$`,
        'm',
      ),
    );
  });

  void test('a binary source is stored byte for byte and hashed over those bytes', () => {
    const home = tempDir('bp-src-');
    const pdf = join(tempDir('bp-given-'), 'deck.pdf');
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80]);
    writeFileSync(pdf, bytes);
    const [c] = captureSources({ home, runId: 'a1b2c3', command: 'init', date: '2026-09-25', inputs: [{ path: pdf }] });
    assert.equal(c?.sha256, hex(bytes));
    assert.deepEqual(verifySources(home), []);
  });

  void test('a second capture in the same run numbers after the first and keeps both in the MANIFEST', () => {
    const home = tempDir('bp-src-');
    captureSources({
      home,
      runId: 'a1b2c3',
      command: 'add',
      date: '2026-09-25',
      inputs: [{ text: 'one', name: 'one.md' }],
    });
    captureSources({
      home,
      runId: 'a1b2c3',
      command: 'add',
      date: '2026-09-25',
      inputs: [{ text: 'two', name: 'two.md' }],
    });
    assert.deepEqual(
      readManifest(join(home, 'sources', 'a1b2c3')).map((c) => c.file),
      ['01-one.md', '02-two.md'],
    );
  });

  void test('a code repository is refused, and the refusal carries the ask for the behaviour in words', () => {
    const repo = tempDir('bp-repo-');
    mkdirSync(join(repo, '.git'));
    assert.equal(isCodeRepository(repo), true);
    assert.throws(
      () =>
        captureSources({
          home: tempDir(),
          runId: 'a1b2c3',
          command: 'add',
          date: '2026-09-25',
          inputs: [{ path: repo }],
        }),
      /code repository — .*describe what it should do, in words/,
    );
  });

  void test('a folder of documents is not a code repository', () => {
    const d = tempDir('bp-docs-');
    writeFile(join(d, 'package.json'), '{}');
    writeFile(join(d, 'notes.md'), 'x');
    assert.equal(isCodeRepository(d), false, 'a manifest file alone, with no source tree, is not a repository');
  });
});

void describe('verifySources — resolve.md R1 capture integrity', () => {
  const seed = (): string => {
    const home = tempDir('bp-src-');
    captureSources({
      home,
      runId: 'a1b2c3',
      command: 'init',
      date: '2026-09-25',
      inputs: [{ text: 'Slots are 15 minutes.', name: 'deck.md' }],
    });
    return home;
  };

  void test('an unaltered record verifies clean', () => {
    assert.deepEqual(verifySources(seed()), []);
  });

  void test('a stored copy altered after capture is a mismatch naming both hashes', () => {
    const home = seed();
    writeFile(join(home, 'sources', 'a1b2c3', '01-deck.md'), 'Slots are 30 minutes.');
    assert.deepEqual(verifySources(home), [
      {
        run: 'a1b2c3',
        file: '01-deck.md',
        kind: 'mismatch',
        recorded: hex('Slots are 15 minutes.'),
        now: hex('Slots are 30 minutes.'),
      },
    ]);
  });

  void test('a logged re-baseline a human vouched for is the baseline', () => {
    const home = seed();
    writeFile(join(home, 'sources', 'a1b2c3', '01-deck.md'), 'Slots are 30 minutes.');
    const log = parseLog(
      `# Run log\n\n---\n\n## 2026-09-25 · 10:00 · resolve · run b2c3d4 · skill v39 · sitting 1\n\n- NOTE: 2026-09-25 capture re-baseline — \`sources/a1b2c3/01-deck.md\` · the run asked: "trust it?" · the owner's words verbatim: "yes" · new baseline sha256 ${hex('Slots are 30 minutes.')}\n`,
    );
    assert.deepEqual(verifySources(home, sourceRebaselines(log)), []);
  });

  void test("an older record's MANIFEST that numbers its sources without naming files is matched by number", () => {
    const home = tempDir('bp-src-');
    const dir = join(home, 'sources', 'c3d4e5');
    writeFile(join(dir, '01-decisions.md'), 'decided');
    writeFile(
      join(dir, 'MANIFEST.md'),
      `| # | Source | Origin | SHA-256 |\n|---|---|---|---|\n| 1 | Task decisions | file: x | ${hex('decided')} |\n`,
    );
    assert.deepEqual(verifySources(home), []);
  });

  void test("bp resolve halts on a mismatch before it writes anything, and a human's words re-baseline it", () => {
    const ws = tempDir('bp-rs-ws-');
    const home = join(ws, '.blueprint');
    const doc = join(ws, 'doc');
    mkdirSync(join(home, 'record'), { recursive: true });
    writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${doc}\n`);
    writeFile(join(doc, 'README.md'), '## TL;DR\nA shop.\n');
    writeFile(
      join(doc, 'features', '01-a.md'),
      '---\nname: A\nwhat_it_does: a\narea: X\nquestions: []\ncreated: 2026-08-04\n---\n\n## Why\nw\n## Behaviour\nFR-1 — x\n## Edge cases\n## Rabbit holes\n## Not doing\n',
    );
    writeFile(join(doc, 'questions.md'), '');
    captureSources({
      home,
      runId: 'a1b2c3',
      command: 'init',
      date: '2026-09-25',
      inputs: [{ text: 'original', name: 'deck.md' }],
    });
    writeFile(join(home, 'sources', 'a1b2c3', '01-deck.md'), 'edited later');
    const r1 = run(['resolve', '--workspace', ws], { workspace: ws });
    assert.equal(r1.code, EXIT.halt, r1.out + r1.err);
    assert.match(r1.err, /sources\/a1b2c3\/01-deck\.md: recorded [0-9a-f]{12}, now [0-9a-f]{12}/);
    assert.throws(() => readFile(join(home, 'record', 'run-log.md')), 'nothing was written: not even the log entry');

    const r2 = run(
      ['resolve', '--workspace', ws, '--trust-source', 'a1b2c3/01-deck.md', '--trust-words', 'yes, trust it'],
      { workspace: ws },
    );
    assert.equal(r2.code, EXIT.ok, r2.out + r2.err);
    const logText = readFile(join(home, 'record', 'run-log.md'));
    assert.match(
      logText,
      new RegExp(
        `^- NOTE: \\d{4}-\\d{2}-\\d{2} capture re-baseline — \`sources/a1b2c3/01-deck\\.md\` · the run asked: .* · the owner's words verbatim: "yes, trust it" · new baseline sha256 ${hex('edited later')}$`,
        'm',
      ),
    );
    // The re-baseline holds for the next run.
    assert.equal(run(['resolve', '--workspace', ws], { workspace: ws }).code, EXIT.ok);
  });
});
