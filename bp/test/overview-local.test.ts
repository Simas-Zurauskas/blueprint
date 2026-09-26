import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { EXIT, BpError } from '../src/core/errors.ts';
import { machineLocalPaths, parseOverview } from '../src/domain/overview.ts';
import { OVERVIEW_BLOCKS } from '../src/domain/vocab.ts';
import { parseQuestionsFile, readFeatureFile, readLocal, splitFrontMatter, yamlList } from '../src/target/local.ts';
import { tempDir, writeFile } from './support/index.ts';

// The overview page's parse and the v37 machine-local-path rule (spec/doc-shape.md §3, the `Links` and `Operating` rows;
// HISTORY.md v37 holds the live page that prompted it), and the local-markdown target's reader (spec/targets.md §3).
// Every expected value is read off the spec's own samples or derived by hand from the fixture text.

// ---- fixtures ---------------------------------------------------------------------------------------------------------

/** A README.md overview with all six human blocks, the two `⟳` generated lists, a title and a `###` sub-heading. */
const OVERVIEW = [
  '# Pickup',
  '',
  '## TL;DR',
  'A pickup-ordering tool for a small bakery. Read What this product is first.',
  '',
  '## What this product is',
  'Customers queue at the counter for orders they could have placed ahead.',
  'It is not a delivery service.',
  '',
  "## Who it's for",
  '- Regular customer — orders ahead to skip the queue.',
  '### An aside',
  'Still part of the audience block.',
  '',
  '## How it works, in one picture',
  '```mermaid',
  'graph TD',
  '  A["Customer<br>orders"] --> B["Bakery"]',
  '```',
  '',
  '## ⟳ Where things are',
  '- Ordering: Checkout',
  '',
  '## ⟳ Open questions',
  '- q-04',
  '',
  '## Links',
  '- Design file: https://www.figma.com/file/abc',
  '',
  '## Operating',
  '- Run record: not yet published.',
].join('\n');

/** The feature file sample from spec/targets.md §3, with a body under it. */
const CHECKOUT_FILE = [
  '---',
  'name: Checkout',
  'what_it_does: A customer pays for the order in their basket and gets a confirmation.',
  'area: Ordering',
  'questions: [q-04, q-07]',
  'created: 2026-08-04',
  '---',
  '',
  '## Why',
  'Customers queue to pay.',
  '',
  '## Behaviour',
  'FR-1 — When a customer confirms the basket, the system takes payment.',
  '',
  '',
].join('\n');

/** The question sample from spec/targets.md §3, verbatim. */
const Q04 = [
  '### q-04 · Can a customer change a pickup slot after paying?',
  '- **Status:** Open',
  '- **Owner:**',
  '- **Touches:** Checkout',
  '- **Why asked:** The deck says slots are "flexible"; no source says whether that survives payment.',
  '- **Created:** 2026-08-04',
  '',
  '**Answer & why:** _(unanswered)_',
].join('\n');

// ---- parseOverview ----------------------------------------------------------------------------------------------------

void describe('parseOverview', () => {
  void test('splits the page into one section per ## heading, in page order, ignoring the # title', () => {
    const p = parseOverview(OVERVIEW);
    assert.deepEqual(
      p.sections.map((s) => s.heading),
      [
        'TL;DR',
        'What this product is',
        "Who it's for",
        'How it works, in one picture',
        '⟳ Where things are',
        '⟳ Open questions',
        'Links',
        'Operating',
      ],
    );
  });

  void test('recognises each of the six human blocks doc-shape §3 names', () => {
    const p = parseOverview(OVERVIEW);
    for (const name of OVERVIEW_BLOCKS) assert.equal(p.block(name)?.heading, name, name);
  });

  void test('marks a ⟳ heading as generated and a plain heading as human prose', () => {
    const p = parseOverview(OVERVIEW);
    const generated = p.sections.filter((s) => s.generated).map((s) => s.heading);
    assert.deepEqual(generated, ['⟳ Where things are', '⟳ Open questions']);
  });

  void test('a section holds every line up to the next ## heading, ### sub-headings included', () => {
    const p = parseOverview(OVERVIEW);
    assert.deepEqual(p.block("Who it's for")?.lines, [
      '- Regular customer — orders ahead to skip the queue.',
      '### An aside',
      'Still part of the audience block.',
      '',
    ]);
  });

  void test('the last section runs to the end of the page', () => {
    const p = parseOverview(OVERVIEW);
    assert.deepEqual(p.block('Operating')?.lines, ['- Run record: not yet published.']);
  });

  void test('a heading doc-shape §3 does not define is kept with no known block', () => {
    const p = parseOverview('## Roadmap\nlater\n## TL;DR\nnow');
    assert.equal(p.sections[0]?.heading, 'Roadmap');
    assert.equal(p.sections[0]?.known, null);
  });

  void test('block() never returns a ⟳ section, even one whose name matches a human block', () => {
    const p = parseOverview('## ⟳ Links\n- generated\n');
    assert.equal(p.block('Links'), undefined);
  });

  void test('CRLF line endings read the same as LF', () => {
    const p = parseOverview('## TL;DR\r\nA line.\r\n## Links\r\n- https://example.com/x\r\n');
    assert.deepEqual(p.block('TL;DR')?.lines, ['A line.']);
    assert.equal(p.block('Links')?.heading, 'Links');
  });

  void test('a page with no ## heading has no sections', () => {
    assert.deepEqual(parseOverview('# Just a title\n\nSome prose.').sections, []);
  });
});

// ---- machineLocalPaths ------------------------------------------------------------------------------------------------

void describe('machineLocalPaths (doc-shape §3 Links and Operating: never a machine-local path)', () => {
  void test('a web URL is not a machine-local path', () => {
    assert.deepEqual(machineLocalPaths('- Design file: https://www.figma.com/file/abc/Pickup?node-id=1-2'), []);
  });

  void test("the run record's web URL is correct even though it ends in record/run-log.md", () => {
    // doc-shape §3 Operating: `https://github.com/<owner>/<repo>/blob/<branch>/<home's path>/record/run-log.md`.
    const line = '- Run record: [run log](https://github.com/acme/wiki-pickup/blob/main/blueprint/record/run-log.md)';
    assert.deepEqual(machineLocalPaths(line), []);
  });

  void test('a Notion page link is not a machine-local path', () => {
    assert.deepEqual(machineLocalPaths('- Chapter: https://app.notion.com/p/1a2b3c4d5e6f40718293a4b5c6d7e8f9'), []);
  });

  void test('slashes in ordinary prose are not paths', () => {
    assert.deepEqual(machineLocalPaths('Support runs 24/7 on iOS/Android, and/or the web.'), []);
  });

  void test('the v37 live Links line: a .blueprint/sources/<run-id>/ path is found', () => {
    // HISTORY.md v37, "What the live page showed".
    const found = machineLocalPaths(
      'Source material, captured verbatim and hashed: `.blueprint/sources/8c1f4a/` in this workspace',
    );
    assert.deepEqual(found, ['.blueprint/sources/8c1f4a/']);
  });

  void test('the v37 live Links line: a bare workspace folder (`DATA/`) is found', () => {
    // doc-shape §3 Links: "a filesystem path in any form, relative or absolute: a workspace folder, …";
    // HISTORY.md v37: the live line read "…in this workspace, from `DATA/`".
    assert.deepEqual(machineLocalPaths('Client deck and notes, from `DATA/`'), ['DATA/']);
  });

  void test('the v37 live Operating line: a path prefixed with the wiki folder name is found', () => {
    const found = machineLocalPaths(
      '**Run record:** `wiki-cyclical-tasks/blueprint/record/run-log.md`, committed to the `wiki-cyclical-tasks` repository.',
    );
    assert.deepEqual(found, ['wiki-cyclical-tasks/blueprint/record/run-log.md']);
  });

  void test('a sources/ path on its own is found', () => {
    assert.deepEqual(machineLocalPaths('Held in sources/8c1f4a/deck.pdf'), ['sources/8c1f4a/deck.pdf']);
  });

  void test('a record/ path on its own is found', () => {
    assert.deepEqual(machineLocalPaths('Run record: record/run-log.md'), ['record/run-log.md']);
  });

  void test('an absolute home-directory path is found', () => {
    assert.deepEqual(machineLocalPaths('Deck: /Users/ana/Documents/pickup-deck.pdf'), [
      '/Users/ana/Documents/pickup-deck.pdf',
    ]);
  });

  void test('a ~/ path is found', () => {
    assert.deepEqual(machineLocalPaths('Notes in ~/notes/pickup.md'), ['~/notes/pickup.md']);
  });

  void test('a ./ relative path is found', () => {
    assert.deepEqual(machineLocalPaths('See (./design/flows.fig)'), ['./design/flows.fig']);
  });

  void test('a ../ relative path is found', () => {
    assert.deepEqual(machineLocalPaths('Brief at ../client/brief.docx'), ['../client/brief.docx']);
  });

  void test('a Windows drive path is found', () => {
    assert.deepEqual(machineLocalPaths('Deck: C:\\Users\\ana\\deck.pdf'), ['C:\\Users\\ana\\deck.pdf']);
  });

  void test('an absolute path on a mounted volume is found', () => {
    // "a filesystem path in any form, relative or absolute" — a macOS volume path opens on one machine only.
    assert.deepEqual(machineLocalPaths('Deck: /Volumes/ClientShare/pickup-deck.pdf'), [
      '/Volumes/ClientShare/pickup-deck.pdf',
    ]);
  });

  void test('a file:// URL is a machine-local path, not a web URL', () => {
    // doc-shape §3 Links: "only what a reader of the target can open: a web URL or a target page"; HISTORY.md v37:
    // a file-path URL is "a machine-local path by another name".
    assert.equal(machineLocalPaths('Deck: file:///Users/ana/Documents/pickup-deck.pdf').length, 1);
  });

  void test('each distinct path is reported once, in order of first appearance', () => {
    const found = machineLocalPaths('`sources/a/` then ~/x/y and again `sources/a/`');
    assert.equal(found.length, 2);
    assert.deepEqual(new Set(found), new Set(['sources/a/', '~/x/y']));
  });
});

// ---- splitFrontMatter / yamlList --------------------------------------------------------------------------------------

void describe('splitFrontMatter', () => {
  void test('reads each key: value line of the front matter and returns the body below it', () => {
    const fm = splitFrontMatter('---\nname: Checkout\narea: Ordering\n---\n\n## Why\nBecause.\n');
    assert.deepEqual(
      [...fm.fields.entries()],
      [
        ['name', 'Checkout'],
        ['area', 'Ordering'],
      ],
    );
    assert.equal(fm.body, '## Why\nBecause.\n');
  });

  void test('a value holding a colon keeps everything after the first one', () => {
    const fm = splitFrontMatter('---\nwhat_it_does: Pays: then confirms.\n---\n');
    assert.equal(fm.fields.get('what_it_does'), 'Pays: then confirms.');
  });

  void test('a file with no front matter is all body and no fields', () => {
    const fm = splitFrontMatter('## Why\nBecause.\n');
    assert.equal(fm.fields.size, 0);
    assert.equal(fm.body, '## Why\nBecause.\n');
  });

  void test('CRLF front matter reads the same as LF (targets §3: a CRLF editor pass)', () => {
    const fm = splitFrontMatter('---\r\nname: Checkout\r\n---\r\n## Why\r\nBecause.\r\n');
    assert.equal(fm.fields.get('name'), 'Checkout');
    assert.equal(fm.body, '## Why\nBecause.\n');
  });

  void test('an empty value is kept as the empty string', () => {
    const fm = splitFrontMatter('---\narea:\n---\n');
    assert.equal(fm.fields.get('area'), '');
  });
});

void describe('yamlList', () => {
  void test('a flow list reads as its items (targets §3 `questions: [q-04, q-07]`)', () => {
    assert.deepEqual(yamlList('[q-04, q-07]'), ['q-04', 'q-07']);
  });

  void test('an empty flow list reads as no items', () => {
    assert.deepEqual(yamlList('[]'), []);
  });

  void test('an empty value reads as no items', () => {
    assert.deepEqual(yamlList(''), []);
  });

  void test('quoted items are unquoted', () => {
    assert.deepEqual(yamlList(`["q-04", 'q-07']`), ['q-04', 'q-07']);
  });

  void test('a bare comma-separated value reads as its items', () => {
    assert.deepEqual(yamlList('q-04, q-07'), ['q-04', 'q-07']);
  });
});

// ---- readFeatureFile --------------------------------------------------------------------------------------------------

void describe('readFeatureFile (targets §3 feature file)', () => {
  const dir = tempDir('bp-feature-');

  void test('maps the five front-matter properties onto the feature', () => {
    const path = writeFile(join(dir, '02-checkout.md'), CHECKOUT_FILE);
    const f = readFeatureFile(path, '02-checkout.md');
    assert.equal(f.name, 'Checkout');
    assert.equal(f.whatItDoes, 'A customer pays for the order in their basket and gets a confirmation.');
    assert.equal(f.area, 'Ordering');
    assert.deepEqual(f.questionRefs, ['q-04', 'q-07']);
    assert.equal(f.created, '2026-08-04');
  });

  void test('the feature id is the file name without .md, and the source is the path read', () => {
    const path = writeFile(join(dir, '02-checkout.md'), CHECKOUT_FILE);
    const f = readFeatureFile(path, '02-checkout.md');
    assert.equal(f.id, '02-checkout');
    assert.equal(f.source, path);
  });

  void test('the content is the body below the front matter, starting at ## Why, trailing newlines dropped', () => {
    const path = writeFile(join(dir, '02-checkout.md'), CHECKOUT_FILE);
    const f = readFeatureFile(path, '02-checkout.md');
    assert.equal(
      f.content,
      '## Why\nCustomers queue to pay.\n\n## Behaviour\nFR-1 — When a customer confirms the basket, the system takes payment.',
    );
  });

  void test('the body is parsed: its numbered requirement is read', () => {
    const path = writeFile(join(dir, '02-checkout.md'), CHECKOUT_FILE);
    const f = readFeatureFile(path, '02-checkout.md');
    assert.deepEqual(
      f.body.requirements.map((r) => [r.n, r.text]),
      [[1, 'When a customer confirms the basket, the system takes payment.']],
    );
  });

  void test('quoted front-matter values are unquoted', () => {
    const path = writeFile(
      join(dir, '03-q.md'),
      `---\nname: "Pick a slot"\nwhat_it_does: 'Choose a time.'\narea: "Ordering"\n---\n## Why\nx\n`,
    );
    const f = readFeatureFile(path, '03-q.md');
    assert.deepEqual([f.name, f.whatItDoes, f.area], ['Pick a slot', 'Choose a time.', 'Ordering']);
  });

  void test('a feature with no created line has created null', () => {
    const path = writeFile(
      join(dir, '04-n.md'),
      '---\nname: N\nwhat_it_does: W\narea: A\nquestions: []\n---\n## Why\nx\n',
    );
    assert.equal(readFeatureFile(path, '04-n.md').created, null);
  });

  void test('a front-matter key outside the five properties is reported as ad hoc (doc-shape §6: no field outside the lists)', () => {
    const path = writeFile(
      join(dir, '05-a.md'),
      '---\nname: N\napproved: yes\nwhat_it_does: W\narea: A\nverified_by: Ana\n---\n## Why\nx\n',
    );
    assert.deepEqual(readFeatureFile(path, '05-a.md').adHoc, ['approved', 'verified_by']);
  });

  void test('the five defined properties are never reported as ad hoc', () => {
    const path = writeFile(join(dir, '02-checkout.md'), CHECKOUT_FILE);
    assert.deepEqual(readFeatureFile(path, '02-checkout.md').adHoc, []);
  });

  void test('a missing feature file is a usage error naming the path', () => {
    const missing = join(dir, '99-missing.md');
    assert.throws(
      () => readFeatureFile(missing, '99-missing.md'),
      (err: unknown) => err instanceof BpError && err.code === EXIT.usage && err.message.includes(missing),
    );
  });
});

// ---- parseQuestionsFile -----------------------------------------------------------------------------------------------

void describe('parseQuestionsFile (targets §3 questions.md)', () => {
  void test("reads the spec's own sample question field by field", () => {
    const [q] = parseQuestionsFile(Q04);
    assert.ok(q);
    assert.equal(q.id, 'q-04');
    assert.equal(q.key, 'q-04');
    assert.equal(q.question, 'Can a customer change a pickup slot after paying?');
    assert.equal(q.status, 'Open');
    assert.equal(q.statusRaw, 'Open');
    assert.equal(q.owner, '');
    assert.deepEqual(q.touches, ['Checkout']);
    assert.equal(q.whyAsked, 'The deck says slots are "flexible"; no source says whether that survives payment.');
    assert.equal(q.created, '2026-08-04');
    assert.deepEqual(q.adHoc, []);
  });

  void test('_(unanswered)_ reads as an empty answer', () => {
    assert.equal(parseQuestionsFile(Q04)[0]?.answer, '');
  });

  void test('a written answer is read, every line up to the next question', () => {
    const text = [
      '### q-02 · Is payment taken up front?',
      '- **Status:** Applied',
      '',
      '**Answer & why:** Up front.',
      'No-shows cost the bakery money.',
      '',
      '### q-03 · Next?',
      '- **Status:** Open',
    ].join('\n');
    assert.equal(parseQuestionsFile(text)[0]?.answer, 'Up front.\nNo-shows cost the bakery money.');
  });

  void test('questions are returned in file order, never re-sorted by Status', () => {
    const text = [
      '### q-01 · A?',
      '- **Status:** Applied',
      '',
      '### q-02 · B?',
      '- **Status:** Open',
      '',
      '### q-03 · C?',
      '- **Status:** Answered',
    ].join('\n');
    assert.deepEqual(
      parseQuestionsFile(text).map((q) => q.key),
      ['q-01', 'q-02', 'q-03'],
    );
  });

  void test('text before the first question section is not a question', () => {
    assert.equal(parseQuestionsFile(`# Open questions\n\nIntro prose.\n\n${Q04}`).length, 1);
  });

  void test('a status outside the six keeps its raw text and reads as no status', () => {
    const [q] = parseQuestionsFile('### q-09 · Old?\n- **Status:** Proposed\n');
    assert.equal(q?.status, null);
    assert.equal(q?.statusRaw, 'Proposed');
  });

  void test('Touches names several features, comma- or ·-separated, «» quotes stripped', () => {
    const [q] = parseQuestionsFile(
      '### q-05 · Both?\n- **Status:** Open\n- **Touches:** «Checkout» · «Pick a slot», Browse the menu\n',
    );
    assert.deepEqual(q?.touches, ['Checkout', 'Pick a slot', 'Browse the menu']);
  });

  void test('an empty Touches is a project-level question with no features', () => {
    const [q] = parseQuestionsFile('### q-06 · Name?\n- **Status:** Open\n- **Touches:**\n');
    assert.deepEqual(q?.touches, []);
  });

  void test('a field continues over the following lines until the next field', () => {
    const text = [
      '### q-07 · Slot?',
      '- **Status:** Open',
      '- **Suggested directions:**',
      '  1. Allow one change. Why: fewer calls.',
      '  2. No changes. Why: simpler.',
      '- **Created:** 2026-08-04',
    ].join('\n');
    const [q] = parseQuestionsFile(text);
    assert.equal(q?.directions, '1. Allow one change. Why: fewer calls.\n2. No changes. Why: simpler.');
    assert.equal(q?.created, '2026-08-04');
  });

  void test('the Why flagged line is read as the field (databases §2: a `- **Why flagged:** …` line on the local target)', () => {
    const [q] = parseQuestionsFile(
      '### q-08 · X?\n- **Status:** Flagged\n- **Why flagged:** The answer contradicts FR-2.\n',
    );
    assert.equal(q?.status, 'Flagged');
    assert.equal(q?.whyFlagged, 'The answer contradicts FR-2.');
  });

  void test('a field outside the defined list is reported as ad hoc', () => {
    const [q] = parseQuestionsFile('### q-10 · X?\n- **Status:** Open\n- **Approved:** yes\n- **Verified by:** Ana\n');
    assert.deepEqual(q?.adHoc, ['Approved', 'Verified by']);
  });

  void test('the legacy Key field is defined, not ad hoc (databases §2: retired, read on legacy projects)', () => {
    const [q] = parseQuestionsFile('### q-11 · X?\n- **Status:** Open\n- **Key:** yes\n');
    assert.deepEqual(q?.adHoc, []);
  });

  void test('a question with no Created line has created null', () => {
    assert.equal(parseQuestionsFile('### q-12 · X?\n- **Status:** Open\n')[0]?.created, null);
  });

  void test('an empty file has no questions', () => {
    assert.deepEqual(parseQuestionsFile(''), []);
  });
});

// ---- readLocal --------------------------------------------------------------------------------------------------------

const feature = (name: string, area = 'Ordering'): string =>
  `---\nname: ${name}\nwhat_it_does: Does ${name}.\narea: ${area}\nquestions: []\ncreated: 2026-08-04\n---\n\n## Why\nx\n`;

function localBlueprint(
  opts: { readme?: boolean; features?: Record<string, string> | null; questions?: string | null } = {},
): string {
  const dir = join(tempDir('bp-local-'), 'document');
  if (opts.readme !== false) writeFile(join(dir, 'README.md'), OVERVIEW);
  if (opts.features !== null) {
    for (const [file, text] of Object.entries(
      opts.features ?? { '01-browse-the-menu.md': feature('Browse the menu', 'Menu'), '02-checkout.md': CHECKOUT_FILE },
    )) {
      writeFile(join(dir, 'features', file), text);
    }
  }
  if (opts.questions !== null) writeFile(join(dir, 'questions.md'), opts.questions ?? `# Open questions\n\n${Q04}\n`);
  return dir;
}

void describe('readLocal (targets §3 layout)', () => {
  const READ_AT = '2026-09-25T11:07:00.000Z';

  void test('a complete folder reads as complete, addressed by its folder', () => {
    const dir = localBlueprint();
    const s = readLocal(dir, READ_AT);
    assert.deepEqual(s.incomplete, []);
    assert.deepEqual(s.target, { kind: 'local', address: dir });
    assert.equal(s.readAt, READ_AT);
  });

  void test('README.md is the overview', () => {
    const s = readLocal(localBlueprint(), READ_AT);
    assert.equal(s.overview?.id, 'README.md');
    assert.equal(s.overview?.content, OVERVIEW);
    assert.equal(
      s.overview?.parsed.block('TL;DR')?.lines[0],
      'A pickup-ordering tool for a small bakery. Read What this product is first.',
    );
  });

  void test('every features/*.md file is one feature', () => {
    const s = readLocal(localBlueprint(), READ_AT);
    assert.deepEqual(
      s.features.map((f) => f.name),
      ['Browse the menu', 'Checkout'],
    );
  });

  void test('a non-markdown file in features/ is not a feature', () => {
    const dir = localBlueprint({
      features: { '01-a.md': feature('A'), 'notes.txt': 'not a feature', '.DS_Store': '' },
    });
    assert.deepEqual(
      readLocal(dir, READ_AT).features.map((f) => f.id),
      ['01-a'],
    );
  });

  void test('features are ordered by their numeric prefix (targets §3: ordering is deterministic)', () => {
    const dir = localBlueprint({
      features: { '100-c.md': feature('C'), '09-a.md': feature('A'), '99-d.md': feature('D'), '10-b.md': feature('B') },
    });
    assert.deepEqual(
      readLocal(dir, READ_AT).features.map((f) => f.id),
      ['09-a', '10-b', '99-d', '100-c'],
    );
  });

  void test('questions.md is read into questions', () => {
    const s = readLocal(localBlueprint(), READ_AT);
    assert.deepEqual(
      s.questions.map((q) => [q.key, q.status]),
      [['q-04', 'Open']],
    );
  });

  void test('a missing README.md makes the read incomplete, naming the file, with no overview', () => {
    const dir = localBlueprint({ readme: false });
    const s = readLocal(dir, READ_AT);
    assert.equal(s.overview, null);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]?.includes(join(dir, 'README.md')));
  });

  void test('a missing features/ folder makes the read incomplete, naming the folder', () => {
    const dir = localBlueprint({ features: null });
    const s = readLocal(dir, READ_AT);
    assert.deepEqual(s.features, []);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]?.includes(join(dir, 'features')));
  });

  void test('a missing questions.md makes the read incomplete, naming the file, with no questions', () => {
    const dir = localBlueprint({ questions: null });
    const s = readLocal(dir, READ_AT);
    assert.deepEqual(s.questions, []);
    assert.equal(s.incomplete.length, 1);
    assert.ok(s.incomplete[0]?.includes(join(dir, 'questions.md')));
  });

  void test('an empty features/ folder is a complete read of a day-1 Blueprint (doc-shape: zero features is valid)', () => {
    const dir = localBlueprint({ features: {} });
    writeFile(join(dir, 'features', '.keep'), '');
    const s = readLocal(dir, READ_AT);
    assert.deepEqual(s.incomplete, []);
    assert.deepEqual(s.features, []);
  });

  void test('a local read never reports a legacy Board', () => {
    assert.equal(readLocal(localBlueprint(), READ_AT).legacyBoard, false);
  });
});
