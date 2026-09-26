import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fakeSkillRoot, fileExists, makeHome, NOW_ISO, run, tempDir, writeFile } from './support/index.ts';
import { fixedClock } from '../src/core/clock.ts';
import { BpError, EXIT } from '../src/core/errors.ts';
import { SHAPE_REGISTER, WRITE_COMMANDS, type Command } from '../src/domain/vocab.ts';
import { currentHome, legacyLocations, readTarget, resolveHome, type TargetInfo } from '../src/home.ts';
import { classifyVersion, preflight, skillVersion, type Preflight } from '../src/preflight.ts';

// Scope: src/preflight.ts, src/home.ts and `bp preflight`.
// Spec: resolve.md R1 (version check, concurrent run), SKILL.md's shape-change register and pre-flight checks 1, 4, 6,
// spec/targets.md §5 (<home> resolution order, pre-v33 locations) and §3 (the ignore file in force).
// Every expected value below is derived by hand from those rules.

// ---- hermetic git (testing §2.1): no user/system git config, no global excludes file, no repository above tmpdir ----
const gitHome = tempDir('bp-githome-');
writeFile(join(gitHome, 'gitconfig'), '');
process.env['HOME'] = gitHome;
process.env['XDG_CONFIG_HOME'] = gitHome;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';
process.env['GIT_CONFIG_GLOBAL'] = join(gitHome, 'gitconfig');
process.env['GIT_CEILING_DIRECTORIES'] = [tmpdir(), realpathSync(tmpdir())].join(':');

const gitInit = (dir: string): void => {
  execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
};

// ---- arrange helpers ------------------------------------------------------------------------------------------------

/** The skill version every test's skill root carries unless it says otherwise. */
const SKILL = 37;
/** NOW_ISO's local calendar date, and the day before it. */
const TODAY = '2026-09-25';
const YESTERDAY = '2026-09-24';

const PREAMBLE = '# Run log — «Test» Blueprint\n\nAppend-only, newest entry first.\n\n---\n\n';

interface EntrySpec {
  date: string;
  time?: string;
  command?: string;
  runId: string;
  version?: number;
  /** The closing line's text, e.g. `CLOSED 14:00 · DRAINED`; omitted → the entry is still open. */
  closing?: string;
}

/** One v37/bp-style entry, written by hand. */
function entry(e: EntrySpec): string {
  const time = e.time ?? '13:00';
  const command = e.command ?? 'resolve';
  const version = e.version === undefined ? '' : ` · skill v${e.version}`;
  const lines = [
    `## ${e.date} · ${time} · ${command} · run ${e.runId}${version} · sitting 1`,
    '',
    `- header: date ${e.date} · time ${time} · command ${command} · run ${e.runId}`,
    '- NOTE: started',
  ];
  if (e.closing !== undefined) lines.push(`- closing: ${e.closing}`);
  return `${lines.join('\n')}\n\n`;
}

/** A run log, newest entry first. */
const logOf = (...entries: EntrySpec[]): string => PREAMBLE + entries.map(entry).join('');

const NOTION_TARGET = 'kind: notion\noverview_page_id: 3d4c2628-ef95-80e2-9a99-c481e093c7a8\n';

/** A standalone workspace (no wiki folders): <home> is <ws>/.blueprint. */
function standalone(opts: { log?: string; target?: string } = {}): { ws: string; home: string } {
  const ws = tempDir('bp-ws-');
  const home = join(ws, '.blueprint');
  if (opts.target !== undefined) writeFile(join(home, 'target.md'), opts.target);
  if (opts.log !== undefined) writeFile(join(home, 'record', 'run-log.md'), opts.log);
  return { ws, home };
}

function check(
  ws: string,
  command: Command,
  extra: { runId?: string; named?: string; version?: number; now?: string } = {},
): Preflight {
  return preflight({
    workspace: ws,
    skillRoot: fakeSkillRoot(extra.version ?? SKILL),
    command,
    clock: fixedClock(extra.now ?? NOW_ISO),
    ...(extra.runId === undefined ? {} : { runId: extra.runId }),
    ...(extra.named === undefined ? {} : { named: extra.named }),
  });
}

/** A marked wiki-system wiki: `.internal/plan.yaml` (targets §5). */
const markWiki = (dir: string): void => {
  writeFile(join(dir, '.internal', 'plan.yaml'), 'sections: []\n');
};

/** Assert that a thrown value is a bp halt (exit 3) whose message matches. */
function assertHalt(fn: () => unknown, message: RegExp): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof BpError, 'expected a BpError');
    assert.equal(err.code, EXIT.halt);
    assert.match(err.message, message);
    return true;
  });
}

type PreflightJson = Omit<Preflight, 'target'> & { target: Omit<TargetInfo, 'raw'> | null };
const parseJsonOut = (out: string): PreflightJson => JSON.parse(out) as PreflightJson;

// =====================================================================================================================
// resolve.md R1 — classifyVersion: a register version n is crossed when stamped < n ≤ VERSION
// Register versions (SKILL.md table): 13, 16, 34.
// =====================================================================================================================

void describe('classifyVersion (resolve.md R1)', () => {
  const crossedVersions = (stamped: number | null, current: number): number[] =>
    classifyVersion(stamped, current).crossed.map((c) => c.version);

  void test('no stamped version is relation none with nothing crossed (a Blueprint with no log is vacuous)', () => {
    const v = classifyVersion(null, 37);
    assert.equal(v.relation, 'none');
    assert.equal(v.stamped, null);
    assert.equal(v.current, 37);
    assert.deepEqual(v.crossed, []);
  });

  void test('a stamp equal to VERSION is relation equal with nothing crossed', () => {
    const v = classifyVersion(37, 37);
    assert.equal(v.relation, 'equal');
    assert.deepEqual(v.crossed, []);
  });

  void test('a stamp newer than VERSION is relation newer with nothing crossed', () => {
    const v = classifyVersion(38, 37);
    assert.equal(v.relation, 'newer');
    assert.deepEqual(v.crossed, []);
  });

  void test('16 read by 18 is older and crosses no register row (v16 already happened in that Blueprint)', () => {
    const v = classifyVersion(16, 18);
    assert.equal(v.relation, 'older');
    assert.deepEqual(v.crossed, []);
  });

  void test('15 read by 37 crosses v16 and v34', () => {
    assert.deepEqual(crossedVersions(15, 37), [16, 34]);
  });

  void test('12 read by 37 crosses v13, v16 and v34', () => {
    assert.deepEqual(crossedVersions(12, 37), [13, 16, 34]);
  });

  void test('34 read by 37 crosses nothing: the lower endpoint is exclusive', () => {
    assert.equal(classifyVersion(34, 37).relation, 'older');
    assert.deepEqual(crossedVersions(34, 37), []);
  });

  void test('33 read by 34 crosses v34: the upper endpoint is inclusive', () => {
    assert.deepEqual(crossedVersions(33, 34), [34]);
  });

  void test('12 read by 13 crosses exactly v13', () => {
    assert.deepEqual(crossedVersions(12, 13), [13]);
  });

  void test('13 read by 16 crosses v16 but not v13', () => {
    assert.deepEqual(crossedVersions(13, 16), [16]);
  });

  void test('17 read by 33 crosses nothing: no register row lies between', () => {
    assert.deepEqual(crossedVersions(17, 33), []);
  });

  void test('each crossed row carries the route and note its register row names', () => {
    const v = classifyVersion(12, 37);
    for (const c of v.crossed) {
      const row = SHAPE_REGISTER.find((r) => r.version === c.version);
      assert.ok(row, `v${c.version} is a register row`);
      assert.equal(c.route, row.route);
      assert.equal(c.note, row.note);
    }
  });
});

// =====================================================================================================================
// SKILL.md "Skill version" — the single integer in VERSION
// =====================================================================================================================

void describe('skillVersion (SKILL.md "Skill version")', () => {
  const rootWith = (content: string): string => {
    const d = tempDir('bp-skill-');
    writeFile(join(d, 'VERSION'), content);
    return d;
  };

  void test('reads the integer in VERSION with its trailing newline', () => {
    assert.equal(skillVersion(rootWith('37\n')), 37);
  });

  void test('tolerates surrounding whitespace around the integer', () => {
    assert.equal(skillVersion(rootWith('  41 \n')), 41);
  });

  void test('a missing VERSION file throws', () => {
    assert.throws(() => skillVersion(tempDir('bp-skill-')), /VERSION is not a bare integer/);
  });

  void test('a non-integer VERSION throws', () => {
    assert.throws(() => skillVersion(rootWith('v37\n')), /not a bare integer/);
  });

  void test('a fractional VERSION throws', () => {
    assert.throws(() => skillVersion(rootWith('37.5\n')), /not a bare integer/);
  });

  void test('an empty VERSION file throws rather than reading as version 0', () => {
    assert.throws(() => skillVersion(rootWith('\n')), /not a bare integer/);
  });

  void test('a hexadecimal VERSION throws rather than reading as its decimal value', () => {
    assert.throws(() => skillVersion(rootWith('0x25\n')), /not a bare integer/);
  });

  void test('an exponent VERSION throws rather than reading as the number it denotes', () => {
    // Number('1e1') is 10; "the single integer in VERSION" is a run of digits, nothing else.
    assert.throws(() => skillVersion(rootWith('1e1\n')), /not a bare integer/);
  });

  void test('a whitespace-only VERSION throws rather than reading as version 0', () => {
    assert.throws(() => skillVersion(rootWith('   \n\t\n')), /not a bare integer/);
  });
});

// =====================================================================================================================
// targets.md §5 — resolveHome
// =====================================================================================================================

void describe('resolveHome (targets §5 order)', () => {
  void test('a named path wins outright over a wiki folder', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-acme'));
    markWiki(join(ws, 'wiki-acme'));
    assert.deepEqual(resolveHome(ws, 'custom/place'), {
      kind: 'resolved',
      home: join(ws, 'custom', 'place'),
      via: 'named',
    });
  });

  void test('an absolute named path is used as given', () => {
    const ws = tempDir('bp-ws-');
    const elsewhere = join(tempDir('bp-elsewhere-'), 'bp-home');
    assert.deepEqual(resolveHome(ws, elsewhere), { kind: 'resolved', home: elsewhere, via: 'named' });
  });

  void test('exactly one marked wiki folder resolves to <wiki>/blueprint with no note', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    assert.deepEqual(resolveHome(ws), { kind: 'resolved', home: join(ws, 'wiki-acme', 'blueprint'), via: 'wiki' });
  });

  void test('exactly one unmarked wiki folder is still used, with a note that it is not a wiki-system wiki yet', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-acme'));
    const r = resolveHome(ws);
    assert.equal(r.kind, 'resolved');
    if (r.kind !== 'resolved') return;
    assert.equal(r.home, join(ws, 'wiki-acme', 'blueprint'));
    assert.equal(r.via, 'wiki');
    assert.ok(r.note, 'a note is given');
    assert.match(r.note, /not a wiki-system wiki/);
    assert.match(r.note, /\.internal\/plan\.yaml/);
  });

  void test('several wiki folders with exactly one marked resolve to the marked one', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-alpha'));
    markWiki(join(ws, 'wiki-beta'));
    mkdirSync(join(ws, 'wiki-gamma'));
    const r = resolveHome(ws);
    assert.equal(r.kind, 'resolved');
    if (r.kind !== 'resolved') return;
    assert.equal(r.home, join(ws, 'wiki-beta', 'blueprint'));
    assert.equal(r.via, 'wiki');
  });

  void test('two marked wiki folders are ambiguous and name both candidates', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-alpha'));
    markWiki(join(ws, 'wiki-beta'));
    mkdirSync(join(ws, 'wiki-gamma'));
    assert.deepEqual(resolveHome(ws), {
      kind: 'ambiguous',
      candidates: [join(ws, 'wiki-alpha'), join(ws, 'wiki-beta')],
    });
  });

  void test('several unmarked wiki folders fall through to .blueprint/ and name the folders found', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-alpha'));
    mkdirSync(join(ws, 'wiki-beta'));
    const r = resolveHome(ws);
    assert.equal(r.kind, 'resolved');
    if (r.kind !== 'resolved') return;
    assert.equal(r.home, join(ws, '.blueprint'));
    assert.equal(r.via, 'standalone');
    assert.ok(r.note, 'a note is given');
    assert.ok(r.note.includes(join(ws, 'wiki-alpha')), 'names wiki-alpha');
    assert.ok(r.note.includes(join(ws, 'wiki-beta')), 'names wiki-beta');
  });

  void test('a workspace with no wiki folder resolves to standalone .blueprint/ with no note', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'app'));
    assert.deepEqual(resolveHome(ws), { kind: 'resolved', home: join(ws, '.blueprint'), via: 'standalone' });
  });

  void test('a file named wiki-* is not a wiki folder candidate', () => {
    const ws = tempDir('bp-ws-');
    writeFile(join(ws, 'wiki-notes.md'), '# notes\n');
    assert.deepEqual(resolveHome(ws), { kind: 'resolved', home: join(ws, '.blueprint'), via: 'standalone' });
  });

  void test('a directory not starting with wiki- is not a candidate', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'mywiki-acme'));
    markWiki(join(ws, 'wiki'));
    assert.deepEqual(resolveHome(ws), { kind: 'resolved', home: join(ws, '.blueprint'), via: 'standalone' });
  });

  void test('a workspace that does not exist resolves to standalone .blueprint/', () => {
    const ws = join(tempDir('bp-ws-'), 'missing');
    assert.deepEqual(resolveHome(ws), { kind: 'resolved', home: join(ws, '.blueprint'), via: 'standalone' });
  });

  void test('resolution creates nothing on disk', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-acme'));
    resolveHome(ws);
    assert.deepEqual(readdirSync(join(ws, 'wiki-acme')), []);
    assert.equal(fileExists(join(ws, '.blueprint')), false);
  });
});

// =====================================================================================================================
// targets.md §5 — legacyLocations (the two pre-v33 locations)
// =====================================================================================================================

void describe('legacyLocations (targets §5 rename route)', () => {
  void test('a workspace .blueprint/ holding target.md is a pre-v33 location when <home> is elsewhere', () => {
    const ws = tempDir('bp-ws-');
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    assert.deepEqual(legacyLocations(ws, join(ws, 'wiki-acme', 'blueprint')), [join(ws, '.blueprint')]);
  });

  void test('.blueprint/ is not a pre-v33 location when <home> is .blueprint/ itself', () => {
    const ws = tempDir('bp-ws-');
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    assert.deepEqual(legacyLocations(ws, join(ws, '.blueprint')), []);
  });

  void test('a .blueprint/ with no target.md is not a pre-v33 location', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, '.blueprint', 'cache'), { recursive: true });
    assert.deepEqual(legacyLocations(ws, join(ws, 'wiki-acme', 'blueprint')), []);
  });

  void test('<blueprint-dir>/internal/ holding target.md is a pre-v33 location beside a local Blueprint', () => {
    const ws = tempDir('bp-ws-');
    const docDir = join(ws, 'docs', 'blueprint');
    writeFile(join(docDir, 'internal', 'target.md'), 'kind: local\n');
    assert.deepEqual(legacyLocations(ws, join(ws, '.blueprint')), [join(docDir, 'internal')]);
  });

  void test('both pre-v33 locations are listed, .blueprint/ first', () => {
    const ws = tempDir('bp-ws-');
    const docDir = join(ws, 'docs', 'blueprint');
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    writeFile(join(docDir, 'internal', 'target.md'), 'kind: local\n');
    assert.deepEqual(legacyLocations(ws, join(ws, 'wiki-acme', 'blueprint')), [
      join(ws, '.blueprint'),
      join(docDir, 'internal'),
    ]);
  });

  void test('an internal/ folder with no target.md is not a pre-v33 location', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'docs', 'blueprint', 'internal'), { recursive: true });
    assert.deepEqual(legacyLocations(ws, join(ws, '.blueprint')), []);
  });
});

// =====================================================================================================================
// targets.md §5 — currentHome: where the record is *now* ("status … reads the pre-v33 location when <home> holds no
// target.md"; a write run moves it). bp log and bp runid resolve <home> through this, exactly as pre-flight does.
// =====================================================================================================================

void describe('currentHome (targets §5 rename route)', () => {
  void test('a <home> holding no target.md reads the record at the pre-v33 .blueprint/', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    assert.deepEqual(currentHome(ws), { home: join(ws, 'wiki-acme', 'blueprint'), current: join(ws, '.blueprint') });
  });

  void test('a <home> holding its own target.md is read there, never at the pre-v33 location as well', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    const home = join(ws, 'wiki-acme', 'blueprint');
    writeFile(join(home, 'target.md'), NOTION_TARGET);
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    assert.deepEqual(currentHome(ws), { home, current: home });
  });

  void test('with no pre-v33 location the record is at <home>, even before <home> exists', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    const home = join(ws, 'wiki-acme', 'blueprint');
    assert.deepEqual(currentHome(ws), { home, current: home });
  });

  void test('a named <home> wins, and a pre-v33 .blueprint/ is still read while the named one has no target.md', () => {
    const ws = tempDir('bp-ws-');
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    assert.deepEqual(currentHome(ws, 'named-home'), { home: join(ws, 'named-home'), current: join(ws, '.blueprint') });
  });

  void test('two marked wikis are ambiguous, naming both', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-alpha'));
    markWiki(join(ws, 'wiki-beta'));
    assert.deepEqual(currentHome(ws), { ambiguous: [join(ws, 'wiki-alpha'), join(ws, 'wiki-beta')] });
  });
});

// =====================================================================================================================
// targets.md §5 — readTarget: kind and address from the three styles in the wild
// =====================================================================================================================

void describe('readTarget', () => {
  const homeWith = (target: string): string => makeHome({ target });

  void test('a home with no target.md has no target', () => {
    assert.equal(readTarget(makeHome()), undefined);
  });

  void test('v37 key: value style yields the Notion overview id in canonical form', () => {
    const t = readTarget(homeWith(NOTION_TARGET));
    assert.ok(t);
    assert.equal(t.kind, 'notion');
    assert.equal(t.address, '3d4c2628ef9580e29a99c481e093c7a8');
  });

  void test('v21 bold-label style with an "Overview page ID" yields the canonical id', () => {
    const t = readTarget(
      homeWith('- **Kind:** Notion\n- **Overview page ID:** `3b834891-a08c-8072-8d80-d896a0db525a`\n'),
    );
    assert.ok(t);
    assert.equal(t.kind, 'notion');
    assert.equal(t.address, '3b834891a08c80728d80d896a0db525a');
  });

  void test('bold-label style with an "Address (page ID)" yields the unhyphenated id as written', () => {
    const t = readTarget(homeWith('- **Kind:** Notion\n- **Address (page ID):** `3b834891a08c80118148fd63d77b1463`\n'));
    assert.ok(t);
    assert.equal(t.kind, 'notion');
    assert.equal(t.address, '3b834891a08c80118148fd63d77b1463');
  });

  void test('an upper-case page id is lower-cased', () => {
    const t = readTarget(homeWith('kind: notion\noverview_page_id: 3D4C2628-EF95-80E2-9A99-C481E093C7A8\n'));
    assert.equal(t?.address, '3d4c2628ef9580e29a99c481e093c7a8');
  });

  void test('a page id given as a Notion URL yields the bare id', () => {
    const t = readTarget(
      homeWith(
        'kind: notion\noverview_page_id: https://www.notion.so/Acme-Overview-3b834891a08c80118148fd63d77b1463?pvs=4\n',
      ),
    );
    assert.equal(t?.address, '3b834891a08c80118148fd63d77b1463');
  });

  void test('the raw text of target.md is kept', () => {
    const t = readTarget(homeWith(NOTION_TARGET));
    assert.equal(t?.raw, NOTION_TARGET);
  });

  void test('token_env names the environment variable holding the REST token', () => {
    const t = readTarget(homeWith(`${NOTION_TARGET}token_env: NOTION_TOKEN_ACME\n`));
    assert.equal(t?.tokenEnv, 'NOTION_TOKEN_ACME');
  });

  void test('a target.md without token_env carries no tokenEnv', () => {
    const t = readTarget(homeWith(NOTION_TARGET));
    assert.ok(t);
    assert.equal('tokenEnv' in t, false);
  });

  void test('a local target with a relative path resolves it against <home>', () => {
    const home = homeWith('kind: local\npath: ../product-doc\n');
    const t = readTarget(home);
    assert.ok(t);
    assert.equal(t.kind, 'local');
    assert.equal(t.address, join(dirname(home), 'product-doc'));
  });

  void test('a local target with an absolute path keeps it', () => {
    const doc = join(tempDir('bp-doc-'), 'blueprint-doc');
    const t = readTarget(homeWith(`kind: local\npath: ${doc}\n`));
    assert.equal(t?.address, doc);
  });

  void test('a local target in bold-label style reads the backticked path', () => {
    const home = homeWith('- **Kind:** Local\n- **Path:** `../product-doc`\n');
    const t = readTarget(home);
    assert.equal(t?.kind, 'local');
    assert.equal(t?.address, join(dirname(home), 'product-doc'));
  });

  void test('a local target naming no path defaults to <home>/document (targets §3)', () => {
    const home = homeWith('kind: local\n');
    const t = readTarget(home);
    assert.equal(t?.address, join(home, 'document'));
  });

  void test('kind markdown is a local target', () => {
    assert.equal(readTarget(homeWith('kind: markdown\npath: doc\n'))?.kind, 'local');
  });

  void test('a target.md naming no kind halts', () => {
    const home = homeWith('overview_page_id: 3d4c2628-ef95-80e2-9a99-c481e093c7a8\n');
    assertHalt(() => readTarget(home), /names no target kind/);
  });

  void test('a target.md naming an unknown kind halts', () => {
    const home = homeWith('kind: confluence\npath: space/ACME\n');
    assertHalt(() => readTarget(home), /names no target kind/);
  });

  void test('an empty target.md halts', () => {
    assertHalt(() => readTarget(homeWith('')), /names no target kind/);
  });

  void test('a Notion target.md with no page id halts', () => {
    assertHalt(() => readTarget(homeWith('kind: notion\noverview_page_id: TBD\n')), /no overview page id/);
  });
});

// =====================================================================================================================
// preflight — home resolution as pre-flight 1 sees it
// =====================================================================================================================

void describe('preflight: where the working folder is (pre-flight 1, targets §5)', () => {
  void test('a standalone workspace resolves <home> to .blueprint/ and reads its target', () => {
    const { ws, home } = standalone({ target: NOTION_TARGET });
    const p = check(ws, 'status');
    assert.equal(p.home, home);
    assert.equal(p.current, home);
    assert.equal(p.homeVia, 'standalone');
    assert.equal(p.target?.address, '3d4c2628ef9580e29a99c481e093c7a8');
    assert.deepEqual(p.halts, []);
  });

  void test('a single unmarked wiki carries the not-a-wiki-system-wiki note through to homeNote', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-acme'));
    const p = check(ws, 'status');
    assert.equal(p.home, join(ws, 'wiki-acme', 'blueprint'));
    assert.equal(p.homeVia, 'wiki');
    assert.match(p.homeNote ?? '', /not a wiki-system wiki/);
  });

  void test('two marked wikis halt, naming both, and never pick one', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-alpha'));
    markWiki(join(ws, 'wiki-beta'));
    const p = check(ws, 'status');
    assert.equal(p.homeVia, 'ambiguous');
    assert.equal(p.home, '');
    assert.equal(p.halts.length, 1);
    assert.ok(p.halts[0]?.includes(join(ws, 'wiki-alpha')), 'names wiki-alpha');
    assert.ok(p.halts[0]?.includes(join(ws, 'wiki-beta')), 'names wiki-beta');
  });

  void test('a named home wins over a marked wiki', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    const p = check(ws, 'status', { named: 'my-home' });
    assert.equal(p.home, join(ws, 'my-home'));
    assert.equal(p.homeVia, 'named');
  });

  void test('status creates nothing when <home> does not exist yet', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-acme'));
    check(ws, 'status');
    assert.deepEqual(readdirSync(ws), ['wiki-acme']);
    assert.deepEqual(readdirSync(join(ws, 'wiki-acme')), []);
  });

  // SKILL.md pre-flight 1: "then the target from its target.md, or ask the human once and record it". A run that has
  // no target cannot write anything, so the pre-flight stops it until the human has said where the Blueprint lives.
  for (const command of WRITE_COMMANDS.filter((c) => c !== 'init')) {
    void test(`${command} with no target.md anywhere halts: ask the human once where the Blueprint lives`, () => {
      const { ws } = standalone();
      const p = check(ws, command);
      assert.equal(p.target, undefined);
      assert.equal(p.halts.length, 1);
      assert.match(p.halts[0] ?? '', /no target\.md/);
      assert.match(p.halts[0] ?? '', /ask the human once/);
    });
  }

  void test('init with no target.md anywhere does not halt: init I1 settles the target itself (init.md:46, :61)', () => {
    const { ws } = standalone();
    const p = check(ws, 'init');
    assert.equal(p.target, undefined);
    assert.deepEqual(p.halts, []);
  });

  void test('status with no target.md anywhere does not halt: it may ask, but records nothing', () => {
    const { ws } = standalone();
    const p = check(ws, 'status');
    assert.equal(p.target, undefined);
    assert.deepEqual(p.halts, []);
  });

  void test('a write command whose target sits at a pre-v33 location has a target and does not halt on pre-flight 1', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    const p = check(ws, 'resolve');
    assert.equal(p.target?.kind, 'notion');
    assert.deepEqual(p.halts, []);
  });

  void test('a malformed target.md at <home> halts the pre-flight', () => {
    const { ws } = standalone({ target: 'the Blueprint lives somewhere\n' });
    assertHalt(() => check(ws, 'resolve'), /names no target kind/);
  });

  void test('several unmarked wikis fall through to a .blueprint/ holding target.md, read as home, not as legacy', () => {
    const ws = tempDir('bp-ws-');
    mkdirSync(join(ws, 'wiki-alpha'));
    mkdirSync(join(ws, 'wiki-beta'));
    writeFile(join(ws, '.blueprint', 'target.md'), NOTION_TARGET);
    const p = check(ws, 'resolve');
    assert.equal(p.home, join(ws, '.blueprint'));
    assert.equal(p.current, join(ws, '.blueprint'));
    assert.equal(p.homeVia, 'standalone');
    assert.deepEqual(p.legacyAt, []);
    assert.equal(p.target?.kind, 'notion');
  });
});

void describe('preflight: a working folder at a pre-v33 location (targets §5 rename route)', () => {
  /** A workspace with a marked wiki (so <home> is wiki-acme/blueprint, empty) and a pre-v33 .blueprint/. */
  function legacyWorkspace(log?: string): { ws: string; home: string; legacy: string } {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    const legacy = join(ws, '.blueprint');
    writeFile(join(legacy, 'target.md'), NOTION_TARGET);
    if (log !== undefined) writeFile(join(legacy, 'record', 'run-log.md'), log);
    return { ws, home: join(ws, 'wiki-acme', 'blueprint'), legacy };
  }

  void test('status reads the record at the pre-v33 .blueprint/ when <home> holds no target.md', () => {
    const { ws, home, legacy } = legacyWorkspace();
    const p = check(ws, 'status');
    assert.equal(p.home, home);
    assert.equal(p.current, legacy);
    assert.equal(p.homeVia, 'legacy');
    assert.deepEqual(p.legacyAt, [legacy]);
    assert.equal(p.target?.address, '3d4c2628ef9580e29a99c481e093c7a8');
  });

  void test('status says a write run will move the pre-v33 folder', () => {
    const { ws, legacy } = legacyWorkspace();
    const p = check(ws, 'status');
    const note = p.notes.find((n) => n.includes(legacy));
    assert.ok(note, 'a note names the pre-v33 location');
    assert.match(note, /status reads it there/);
    assert.match(note, /write run will move it/);
  });

  void test('status moves nothing and creates nothing', () => {
    const { ws, legacy } = legacyWorkspace();
    check(ws, 'status');
    assert.equal(fileExists(join(legacy, 'target.md')), true);
    assert.equal(fileExists(join(ws, 'wiki-acme', 'blueprint')), false);
  });

  void test('a write command is told it moves the folder to <home> first, naming both paths', () => {
    const { ws, home, legacy } = legacyWorkspace();
    const p = check(ws, 'add');
    const note = p.notes.find((n) => n.includes(legacy));
    assert.ok(note, 'a note names the pre-v33 location');
    assert.ok(note.includes(home), 'the note names <home>');
    assert.match(note, /moves it/);
  });

  void test('the concurrent-run check reads the log at the pre-v33 location', () => {
    const { ws } = legacyWorkspace(logOf({ date: TODAY, runId: 'aaaaaa' }));
    const p = check(ws, 'resolve', { runId: 'bbbbbb' });
    assert.deepEqual(
      p.concurrent.map((c) => c.runId),
      ['aaaaaa'],
    );
    assert.equal(p.halts.length, 1);
  });

  void test('the version check reads the stamp at the pre-v33 location', () => {
    const { ws } = legacyWorkspace(
      logOf({ date: YESTERDAY, runId: 'aaaaaa', version: 30, closing: 'CLOSED 14:00 · DRAINED' }),
    );
    const p = check(ws, 'status');
    assert.equal(p.version.stamped, 30);
    assert.equal(p.version.relation, 'older');
  });

  void test('a <home> with its own target.md is read even when a pre-v33 .blueprint/ also exists (never read from both)', () => {
    const { ws, home, legacy } = legacyWorkspace();
    writeFile(join(home, 'target.md'), 'kind: notion\noverview_page_id: 3b834891a08c80118148fd63d77b1463\n');
    const p = check(ws, 'resolve');
    assert.equal(p.current, home);
    assert.equal(p.homeVia, 'wiki');
    assert.equal(p.target?.address, '3b834891a08c80118148fd63d77b1463');
    assert.deepEqual(p.legacyAt, [legacy]);
  });

  void test('a local target at <home> lists a pre-v33 <blueprint-dir>/internal/ but reads <home>', () => {
    const ws = tempDir('bp-ws-');
    const docDir = join(ws, 'product-doc');
    writeFile(join(ws, '.blueprint', 'target.md'), `kind: local\npath: ${docDir}\n`);
    writeFile(join(docDir, 'internal', 'target.md'), 'kind: local\n');
    const p = check(ws, 'status');
    assert.equal(p.current, join(ws, '.blueprint'));
    assert.equal(p.target?.address, docDir);
    assert.deepEqual(p.legacyAt, [join(docDir, 'internal')]);
  });
});

// =====================================================================================================================
// preflight — pre-flight 4 / R1: is another run already writing?
// =====================================================================================================================

void describe('preflight: concurrent run (pre-flight 4, resolve.md R1)', () => {
  void test('an entry dated today, still open, with another run id halts a write command', () => {
    const { ws } = standalone({
      target: NOTION_TARGET,
      log: logOf({ date: TODAY, time: '13:30', command: 'add', runId: 'a2d011', version: SKILL }),
    });
    const p = check(ws, 'resolve', { runId: 'ffffff' });
    assert.deepEqual(p.concurrent, [{ runId: 'a2d011', date: TODAY, time: '13:30', command: 'add' }]);
    assert.equal(p.halts.length, 1);
    assert.match(p.halts[0] ?? '', /another run is in flight/);
    assert.match(p.halts[0] ?? '', /a2d011/);
  });

  void test('the halt says how a human clears a crashed run: CLOSED (crashed) by hand', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: TODAY, runId: 'a2d011' }) });
    const p = check(ws, 'challenge');
    assert.match(p.halts[0] ?? '', /CLOSED \(crashed\)/);
  });

  void test('every write command halts on an open entry from today', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: TODAY, runId: 'a2d011' }) });
    for (const command of WRITE_COMMANDS) {
      assert.equal(check(ws, command).halts.length, 1, `${command} halts`);
    }
  });

  void test('status reports an open entry from today but does not halt', () => {
    const { ws } = standalone({ log: logOf({ date: TODAY, runId: 'a2d011' }) });
    const p = check(ws, 'status');
    assert.deepEqual(
      p.concurrent.map((c) => c.runId),
      ['a2d011'],
    );
    assert.deepEqual(p.halts, []);
  });

  void test("an open entry from today carrying this run's own id is not another run", () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: TODAY, runId: 'a2d011' }) });
    const p = check(ws, 'resolve', { runId: 'a2d011' });
    assert.deepEqual(p.concurrent, []);
    assert.deepEqual(p.halts, []);
  });

  void test('an open entry dated yesterday is not a concurrent run', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: YESTERDAY, runId: 'a2d011' }) });
    const p = check(ws, 'resolve');
    assert.deepEqual(p.concurrent, []);
    assert.deepEqual(p.halts, []);
  });

  void test('an entry from today closed with CLOSED is not a concurrent run', () => {
    const { ws } = standalone({ log: logOf({ date: TODAY, runId: 'a2d011', closing: 'CLOSED 13:50 · DRAINED' }) });
    assert.deepEqual(check(ws, 'resolve').concurrent, []);
  });

  void test('an entry from today ending PAUSED is not a concurrent run', () => {
    const { ws } = standalone({
      log: logOf({ date: TODAY, runId: 'a2d011', closing: 'PAUSED 13:50 · HUMAN-BLOCKED' }),
    });
    assert.deepEqual(check(ws, 'resolve').concurrent, []);
  });

  void test('a hand-written CLOSED (crashed) line clears a crashed entry', () => {
    const log = `${PREAMBLE}## ${TODAY} · 09:00 · resolve · run a2d011 · skill v37 · sitting 1\n\n- header: date ${TODAY}\n- NOTE: started\nCLOSED (crashed)\n\n`;
    const { ws } = standalone({ log });
    assert.deepEqual(check(ws, 'resolve').concurrent, []);
  });

  void test('"today" is the injected clock\'s local date, not the machine\'s', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: '2031-01-02', runId: 'a2d011' }) });
    assert.equal(check(ws, 'resolve', { now: '2031-01-02T09:00:00' }).halts.length, 1);
    assert.equal(check(ws, 'resolve', { now: NOW_ISO }).halts.length, 0);
  });

  void test('every open entry from today is listed, and closed ones are not', () => {
    const { ws } = standalone({
      target: NOTION_TARGET,
      log: logOf(
        { date: TODAY, time: '13:40', command: 'challenge', runId: 'cccccc' },
        { date: TODAY, time: '12:00', command: 'add', runId: 'bbbbbb', closing: 'CLOSED 12:30 · DRAINED' },
        { date: TODAY, time: '10:00', command: 'resolve', runId: 'aaaaaa' },
      ),
    });
    const p = check(ws, 'resolve');
    assert.deepEqual(
      p.concurrent.map((c) => c.runId),
      ['cccccc', 'aaaaaa'],
    );
    assert.equal(p.halts.length, 1);
    assert.match(p.halts[0] ?? '', /cccccc/);
    assert.match(p.halts[0] ?? '', /aaaaaa/);
  });

  void test('a v21 fenced column-format entry from today with no CLOSED is a concurrent run', () => {
    const log = `${PREAMBLE}\`\`\`\n${TODAY} 08:54 · resolve · run 4c1e7b · skill v21\nITEM   q-04 applied\n\`\`\`\n`;
    const { ws } = standalone({ log });
    assert.deepEqual(
      check(ws, 'resolve').concurrent.map((c) => c.runId),
      ['4c1e7b'],
    );
  });

  void test('a v21 fenced entry from today ending in a bare CLOSED line is not a concurrent run', () => {
    const log = `${PREAMBLE}\`\`\`\n${TODAY} 08:54 · resolve · run 4c1e7b · skill v21\nITEM   q-04 applied\nCLOSED 09:10 drained\n\`\`\`\n`;
    const { ws } = standalone({ log });
    assert.deepEqual(check(ws, 'resolve').concurrent, []);
  });

  void test('a log written with CRLF line endings is read the same', () => {
    const { ws } = standalone({ log: logOf({ date: TODAY, runId: 'a2d011' }).replace(/\n/g, '\r\n') });
    assert.deepEqual(
      check(ws, 'resolve').concurrent.map((c) => c.runId),
      ['a2d011'],
    );
  });
});

// =====================================================================================================================
// preflight — pre-flight 6 / R1: does the skill version match the Blueprint's?
// =====================================================================================================================

void describe('preflight: version check (pre-flight 6, resolve.md R1)', () => {
  const closedEntry = (version: number | undefined, runId = 'aaaaaa'): EntrySpec => ({
    date: YESTERDAY,
    runId,
    ...(version === undefined ? {} : { version }),
    closing: 'CLOSED 14:00 · DRAINED',
  });

  void test('no run log is vacuous: relation none, nothing crossed, no halt', () => {
    const { ws } = standalone({ target: NOTION_TARGET });
    const p = check(ws, 'resolve');
    assert.equal(p.version.stamped, null);
    assert.equal(p.version.relation, 'none');
    assert.deepEqual(p.version.crossed, []);
    assert.deepEqual(p.halts, []);
  });

  void test('a log holding only its preamble is vacuous', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: PREAMBLE });
    const p = check(ws, 'resolve');
    assert.equal(p.version.relation, 'none');
    assert.deepEqual(p.halts, []);
  });

  void test('the stamp is read from the newest (topmost) entry', () => {
    const { ws } = standalone({ log: logOf(closedEntry(36, 'bbbbbb'), closedEntry(30, 'aaaaaa')) });
    assert.equal(check(ws, 'status').version.stamped, 36);
  });

  void test('the skill version is read from the skill root VERSION', () => {
    const { ws } = standalone();
    assert.equal(check(ws, 'status', { version: 41 }).version.current, 41);
  });

  void test('an equal stamp proceeds without a halt', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf(closedEntry(SKILL)) });
    const p = check(ws, 'resolve');
    assert.equal(p.version.relation, 'equal');
    assert.deepEqual(p.halts, []);
  });

  void test('an older stamp crossing v16 and v34 is reported with both rows', () => {
    const { ws } = standalone({ log: logOf(closedEntry(15)) });
    const p = check(ws, 'resolve');
    assert.equal(p.version.relation, 'older');
    assert.deepEqual(
      p.version.crossed.map((c) => c.version),
      [16, 34],
    );
  });

  void test('an older stamp crossing no register row reconciles and proceeds without a halt', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf(closedEntry(35)) });
    const p = check(ws, 'resolve');
    assert.equal(p.version.relation, 'older');
    assert.deepEqual(p.version.crossed, []);
    assert.deepEqual(p.halts, []);
  });

  void test('a newer stamp halts a write command, naming both versions', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf(closedEntry(38)) });
    const p = check(ws, 'resolve');
    assert.equal(p.version.relation, 'newer');
    assert.equal(p.halts.length, 1);
    assert.match(p.halts[0] ?? '', /v38/);
    assert.match(p.halts[0] ?? '', /v37/);
  });

  void test('status reports a newer stamp as newer', () => {
    const { ws } = standalone({ log: logOf(closedEntry(38)) });
    assert.equal(check(ws, 'status').version.relation, 'newer');
  });

  void test('status does not halt on a newer stamp: the check is write commands only (SKILL.md pre-flight 6)', () => {
    const { ws } = standalone({ log: logOf(closedEntry(38)) });
    assert.deepEqual(check(ws, 'status').halts, []);
  });

  void test('a newest entry with no version stamp falls back to the newest entry that has one', () => {
    const { ws } = standalone({ log: logOf(closedEntry(undefined, 'bbbbbb'), closedEntry(33, 'aaaaaa')) });
    assert.equal(check(ws, 'status').version.stamped, 33);
  });

  void test('status reports a newer stamp as a note naming both versions (SKILL.md pre-flight 6: "reads and reports")', () => {
    const { ws } = standalone({ log: logOf(closedEntry(38)) });
    const p = check(ws, 'status');
    const note = p.notes.find((n) => /v38/.test(n) && /v37/.test(n));
    assert.ok(note, `no note names v38 and v37: ${JSON.stringify(p.notes)}`);
  });

  void test('a write run lists every register row the gap crosses as a note, naming each version', () => {
    // R1: 12 read by 37 crosses v13, v16 and v34 (stamped < n ≤ VERSION); each is "checked before doing anything else".
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf(closedEntry(12)) });
    const p = check(ws, 'resolve');
    for (const v of [13, 16, 34]) {
      assert.ok(
        p.notes.some((n) => new RegExp(`crosses v${v}\\b`).test(n)),
        `no note for crossed v${v}: ${JSON.stringify(p.notes)}`,
      );
    }
    assert.equal(p.notes.filter((n) => /crosses v\d+/.test(n)).length, 3);
  });

  void test('a write run whose gap crosses no register row lists no crossing note', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf(closedEntry(35)) });
    assert.deepEqual(
      check(ws, 'add').notes.filter((n) => /crosses v\d+/.test(n)),
      [],
    );
  });
});

// =====================================================================================================================
// preflight — a run log holding dated entries bp cannot read: the pre-flight 4 and 6 checks cannot be made on it
// =====================================================================================================================

void describe('preflight: a run log bp cannot read', () => {
  /** A heading with a date but no `hh:mm · command · run <id>` — not an entry shape any version of the skill wrote. */
  const UNREADABLE = `${PREAMBLE}## ${TODAY} resolve a2d011\n\n- header: date ${TODAY}\n- NOTE: started\n\n`;

  void test('a write command halts: another run in flight cannot be ruled out (pre-flight 4 is write commands only)', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: UNREADABLE });
    const p = check(ws, 'resolve');
    assert.equal(p.halts.length, 1);
    assert.match(p.halts[0] ?? '', /cannot read/);
  });

  void test('status notes it and does not halt', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: UNREADABLE });
    const p = check(ws, 'status');
    assert.deepEqual(p.halts, []);
    assert.ok(
      p.notes.some((n) => /cannot read/.test(n)),
      JSON.stringify(p.notes),
    );
  });

  void test('prose holding no dated line is a preamble, not an unreadable entry', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: '# Run log\n\nNothing has run yet.\n' });
    assert.deepEqual(check(ws, 'resolve').halts, []);
  });
});

// =====================================================================================================================
// preflight — targets §3/§5: is the ignore file in force?
// =====================================================================================================================

void describe('preflight: the ignore file (targets §3, §5)', () => {
  /** A git repository whose root is <home> (a named home), holding a Notion target.md. */
  function repoHome(gitignore?: string): { ws: string; home: string } {
    const ws = tempDir('bp-ws-');
    const home = join(ws, 'blueprint');
    gitInit(home);
    writeFile(join(home, 'target.md'), NOTION_TARGET);
    if (gitignore !== undefined) writeFile(join(home, '.gitignore'), gitignore);
    return { ws, home };
  }

  void test('an ignore file naming sources/ and cache/ is in force when both folders exist', () => {
    const { ws, home } = repoHome('sources/\ncache/\n');
    mkdirSync(join(home, 'sources'));
    mkdirSync(join(home, 'cache'));
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, true);
  });

  void test('an ignore file naming sources/ and cache/ is in force before either folder exists', () => {
    const { ws } = repoHome('sources/\ncache/\n');
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, true, p.ignore.detail);
  });

  void test('a repository with no ignore file is not in force and names both missing entries', () => {
    const { ws } = repoHome();
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, false);
    assert.match(p.ignore.detail, /sources\//);
    assert.match(p.ignore.detail, /cache\//);
  });

  void test('an ignore file naming only sources/ is not in force and names cache/ alone', () => {
    const { ws, home } = repoHome('sources/\n');
    mkdirSync(join(home, 'sources'));
    mkdirSync(join(home, 'cache'));
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.inForce, false);
    assert.match(p.ignore.detail, /not ignored: cache\//);
    assert.doesNotMatch(p.ignore.detail, /sources\//);
  });

  void test('an ignore file naming only cache/ is not in force and names sources/ alone', () => {
    const { ws } = repoHome('cache/\n');
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.inForce, false);
    assert.match(p.ignore.detail, /not ignored: sources\//);
    assert.doesNotMatch(p.ignore.detail, /cache\//);
  });

  void test('an ignore file that also ignores record/ is not in force: record/ is committed (targets §5)', () => {
    const { ws } = repoHome('sources/\ncache/\nrecord/\n');
    const p = check(ws, 'resolve', { named: 'blueprint' });
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, false);
    assert.match(p.ignore.detail, /record\//);
  });

  void test('a repository ignoring the whole working folder is not in force (the v15 rule, targets §5)', () => {
    const ws = tempDir('bp-ws-');
    const wiki = join(ws, 'wiki-acme');
    gitInit(wiki);
    markWiki(wiki);
    writeFile(join(wiki, '.gitignore'), 'blueprint/\n');
    writeFile(join(wiki, 'blueprint', 'target.md'), NOTION_TARGET);
    const p = check(ws, 'resolve');
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, false);
    assert.match(p.ignore.detail, /record\//);
  });

  void test('a working folder inside a wiki repository is checked against the repository it sits in', () => {
    const ws = tempDir('bp-ws-');
    const wiki = join(ws, 'wiki-acme');
    gitInit(wiki);
    markWiki(wiki);
    const home = join(wiki, 'blueprint');
    writeFile(join(home, 'target.md'), NOTION_TARGET);
    writeFile(join(home, '.gitignore'), 'sources/\ncache/\n');
    mkdirSync(join(home, 'sources'));
    mkdirSync(join(home, 'cache'));
    const p = check(ws, 'resolve');
    assert.equal(p.home, home);
    assert.equal(p.ignore.repo, true);
    assert.equal(p.ignore.inForce, true);
  });

  void test('a working folder outside any repository is reported as repo false, in force unknown', () => {
    const { ws } = standalone({ target: NOTION_TARGET });
    const p = check(ws, 'resolve');
    assert.equal(p.ignore.repo, false);
    assert.equal(p.ignore.inForce, null);
    assert.match(p.ignore.detail, /not inside a git repository/);
  });

  void test('a working folder that does not exist yet is reported as such', () => {
    const { ws } = standalone();
    const p = check(ws, 'init');
    assert.equal(p.ignore.repo, false);
    assert.equal(p.ignore.inForce, null);
    assert.match(p.ignore.detail, /does not exist yet/);
  });
});

// =====================================================================================================================
// bp preflight — the command, in-process
// =====================================================================================================================

void describe('bp preflight', () => {
  const opts = (workspace: string, now = NOW_ISO) => ({ workspace, skillRoot: fakeSkillRoot(SKILL), now });

  void test('exits 0 and prints home, target and version for a clean standalone workspace', () => {
    const { ws, home } = standalone({
      target: NOTION_TARGET,
      log: logOf({ date: YESTERDAY, runId: 'aaaaaa', version: SKILL, closing: 'CLOSED 14:00 · DRAINED' }),
    });
    const r = run(['preflight', '--command', 'resolve'], opts(ws));
    assert.equal(r.code, EXIT.ok);
    assert.ok(r.out.includes(`home      ${home} (standalone)`), r.out);
    assert.match(r.out, /target {4}notion 3d4c2628ef9580e29a99c481e093c7a8/);
    assert.match(r.out, /version {3}skill v37 · Blueprint stamped v37 · equal/);
    assert.doesNotMatch(r.out, /HALT/);
  });

  void test('--workspace is resolved against the directory bp was run in', () => {
    const parent = tempDir('bp-parent-');
    mkdirSync(join(parent, 'proj', 'wiki-acme'), { recursive: true });
    markWiki(join(parent, 'proj', 'wiki-acme'));
    const r = run(['preflight', '--command', 'status', '--workspace', 'proj', '--json'], opts(parent));
    assert.equal(r.code, EXIT.ok);
    const j = parseJsonOut(r.out);
    assert.equal(j.workspace, join(parent, 'proj'));
    assert.equal(j.home, join(parent, 'proj', 'wiki-acme', 'blueprint'));
    assert.equal(j.homeVia, 'wiki');
  });

  void test('--home names <home> and wins', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-acme'));
    const r = run(
      ['preflight', '--command', 'status', '--workspace', ws, '--home', 'elsewhere', '--json'],
      opts(tempDir()),
    );
    const j = parseJsonOut(r.out);
    assert.equal(j.home, join(ws, 'elsewhere'));
    assert.equal(j.homeVia, 'named');
  });

  void test('without --command it is a usage error, exit 2: the checks differ by command', () => {
    const { ws } = standalone({ target: NOTION_TARGET });
    const r = run(['preflight', '--workspace', ws], opts(tempDir()));
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--command is required/);
    assert.equal(r.out, '');
  });

  void test('status reports a concurrent run on its open line and exits 0', () => {
    const { ws } = standalone({ log: logOf({ date: TODAY, time: '13:30', command: 'add', runId: 'a2d011' }) });
    const r = run(['preflight', '--command', 'status', '--workspace', ws], opts(tempDir()));
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out, /open {6}add a2d011 2026-09-25 13:30/);
  });

  void test('a write command with a concurrent run exits 3 with a HALT line', () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: TODAY, runId: 'a2d011' }) });
    const r = run(['preflight', '--workspace', ws, '--command', 'resolve', '--run', 'ffffff'], opts(tempDir()));
    assert.equal(r.code, EXIT.halt);
    assert.match(r.out, /HALT {6}another run is in flight/);
  });

  void test("--run naming the open entry's own run id exits 0", () => {
    const { ws } = standalone({ target: NOTION_TARGET, log: logOf({ date: TODAY, runId: 'a2d011' }) });
    const r = run(['preflight', '--workspace', ws, '--command', 'resolve', '--run', 'a2d011'], opts(tempDir()));
    assert.equal(r.code, EXIT.ok);
  });

  void test('a write command with no target.md anywhere exits 3 with a pre-flight 1 HALT line', () => {
    const { ws } = standalone();
    const r = run(['preflight', '--workspace', ws, '--command', 'add'], opts(tempDir()));
    assert.equal(r.code, EXIT.halt);
    assert.match(r.out, /HALT {6}no target\.md — ask the human once/);
  });

  void test('two marked wikis exit 3 naming both', () => {
    const ws = tempDir('bp-ws-');
    markWiki(join(ws, 'wiki-alpha'));
    markWiki(join(ws, 'wiki-beta'));
    const r = run(['preflight', '--command', 'status', '--workspace', ws], opts(tempDir()));
    assert.equal(r.code, EXIT.halt);
    assert.ok(r.out.includes(join(ws, 'wiki-alpha')) && r.out.includes(join(ws, 'wiki-beta')), r.out);
  });

  void test('a newer stamp on a write command exits 3', () => {
    const { ws } = standalone({
      target: NOTION_TARGET,
      log: logOf({ date: YESTERDAY, runId: 'aaaaaa', version: 38, closing: 'CLOSED 14:00 · DRAINED' }),
    });
    const r = run(['preflight', '--workspace', ws, '--command', 'add'], opts(tempDir()));
    assert.equal(r.code, EXIT.halt);
    assert.match(r.out, /HALT .*v38/);
  });

  void test('an older stamp prints the register rows it crosses with their routes', () => {
    const { ws } = standalone({
      target: NOTION_TARGET,
      log: logOf({ date: YESTERDAY, runId: 'aaaaaa', version: 15, closing: 'CLOSED 14:00 · DRAINED' }),
    });
    const r = run(['preflight', '--workspace', ws, '--command', 'resolve'], opts(tempDir()));
    const v16 = SHAPE_REGISTER.find((x) => x.version === 16);
    const v34 = SHAPE_REGISTER.find((x) => x.version === 34);
    assert.ok(v16 && v34);
    assert.ok(r.out.includes(`crosses v16 (${v16.route}), v34 (${v34.route})`), r.out);
  });

  void test('a malformed target.md exits 3 with the reason on stderr', () => {
    const { ws } = standalone({ target: 'somewhere on notion\n' });
    const r = run(['preflight', '--workspace', ws, '--command', 'resolve'], opts(tempDir()));
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /names no target kind/);
  });

  void test('an unknown --command is a usage error, exit 2', () => {
    const r = run(['preflight', '--command', 'deploy'], opts(tempDir()));
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--command must be one of/);
  });

  void test('--json prints the target without its raw text', () => {
    const { ws } = standalone({ target: `${NOTION_TARGET}token_env: NOTION_TOKEN_ACME\n` });
    const r = run(['preflight', '--command', 'status', '--workspace', ws, '--json'], opts(tempDir()));
    const j = parseJsonOut(r.out);
    assert.ok(j.target);
    assert.equal(j.target.kind, 'notion');
    assert.equal(j.target.address, '3d4c2628ef9580e29a99c481e093c7a8');
    assert.equal(j.target.tokenEnv, 'NOTION_TOKEN_ACME');
    assert.equal('raw' in j.target, false);
  });

  void test('--json prints target null when none is recorded', () => {
    const { ws } = standalone();
    const r = run(['preflight', '--command', 'status', '--workspace', ws, '--json'], opts(tempDir()));
    assert.equal(parseJsonOut(r.out).target, null);
  });

  void test('--json carries the version relation and crossed rows', () => {
    const { ws } = standalone({
      log: logOf({ date: YESTERDAY, runId: 'aaaaaa', version: 12, closing: 'CLOSED 14:00 · DRAINED' }),
    });
    const j = parseJsonOut(run(['preflight', '--command', 'status', '--workspace', ws, '--json'], opts(tempDir())).out);
    assert.equal(j.version.stamped, 12);
    assert.equal(j.version.current, SKILL);
    assert.equal(j.version.relation, 'older');
    assert.deepEqual(
      j.version.crossed.map((c) => c.version),
      [13, 16, 34],
    );
  });

  void test('status on a newer stamp exits 0: it reports the mismatch and never halts on it (SKILL.md pre-flight 6)', () => {
    const { ws } = standalone({
      log: logOf({ date: YESTERDAY, runId: 'aaaaaa', version: 38, closing: 'CLOSED 14:00 · DRAINED' }),
    });
    const r = run(['preflight', '--workspace', ws, '--command', 'status'], opts(tempDir()));
    assert.match(r.out, /newer/);
    assert.match(r.out, /note {6}.*v38.*v37/);
    assert.doesNotMatch(r.out, /HALT/);
    assert.equal(r.code, EXIT.ok);
  });

  void test('a flag bp preflight does not take is refused, exit 2, naming it', () => {
    const r = run(['preflight', '--command', 'status', '--page', 'x'], opts(tempDir()));
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown flag --page/);
    assert.equal(r.out, '');
  });

  void test('a VERSION that is not a bare integer fails the pre-flight rather than reading as some number', () => {
    const skillRoot = tempDir('bp-skill-');
    writeFile(join(skillRoot, 'VERSION'), '1e1\n');
    const { ws } = standalone({ target: NOTION_TARGET });
    const r = run(['preflight', '--command', 'status', '--workspace', ws], {
      workspace: tempDir(),
      skillRoot,
      now: NOW_ISO,
    });
    assert.notEqual(r.code, EXIT.ok);
    assert.match(r.err, /not a bare integer/);
  });
});
