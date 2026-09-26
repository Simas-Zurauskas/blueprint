import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../src/core/errors.ts';
import { OVERVIEW_BLOCKS } from '../src/domain/vocab.ts';
import { readable } from '../src/render/prd.ts';
import { fileExists, readFile, run, tempDir, writeFile, NOW_ISO, type RunResult } from './support/index.ts';

// `bp render` (src/render/prd.ts, src/commands/render.ts) against a synthetic LOCAL Blueprint in a temp workspace:
// `<ws>/.blueprint/target.md` says `kind: local` and names the document folder (spec/targets.md §3, §5). The build
// packet follows spec/doc-shape.md §10; the read-out line spec/targets.md §4; question liveness spec/databases.md §3, §6.
// Every expected value is copied out of the fixture text below or derived from it by hand.

// ---- fixture ----------------------------------------------------------------------------------------------------------

const TITLE = 'Pickup';

/** The overview's NOT-clause — the closing sentence of `What this product is` (doc-shape §3). */
const NOT_CLAUSE = 'It is not a delivery service, and it never holds stock for walk-in sales.';

const MERMAID = ['```mermaid', 'graph TD', '  A["Customer<br>orders"] --> B["Bakery<br>prepares"]', '```'].join('\n');

const README = [
  '# Pickup',
  '',
  '## TL;DR',
  'A pickup-ordering tool for a small bakery. Read What this product is first.',
  '',
  '## What this product is',
  'Customers of a small bakery queue at the counter for orders they could have placed ahead, and no one takes payment before the slot.',
  'This product lets them order and pay online, then collect at a chosen slot.',
  NOT_CLAUSE,
  '',
  "## Who it's for",
  '- Regular customer — orders ahead to skip the queue.',
  '',
  '## How it works, in one picture',
  MERMAID,
  '',
  '## ⟳ Where things are',
  '- Menu: Browse the menu',
  '- Ordering: Checkout, Pick a slot',
  '',
  '## ⟳ Open questions',
  '- Open: q-04, q-06',
  '',
  '## Links',
  '- Design file: https://www.figma.com/file/abc',
  '',
  '## Operating',
  '- Run record: not yet published.',
  '',
].join('\n');

const WHAT_IT_DOES = 'A customer pays for the order in their basket and gets a confirmation.';
const WHY = 'Customers queue at the counter to pay. The bakery wants payment taken before the slot.';
const FR1 = 'FR-1 — When a customer confirms the basket, the system takes payment before it books the slot.';
const PROVENANCE =
  '*(Applied 2026-08-04 from «Is payment taken before the slot is booked?» `q-02` · depth 1 — answer and reasoning on that row.)*';
/** FR-2 as the target stores it (the marker's brackets escaped, as on a Notion round trip), and as a reader sees it. */
const FR2_STORED =
  'FR-2 — When payment fails, the system keeps the basket and shows the failure. \\[NEEDS CLARIFICATION: FR-2 of «Checkout» — how many retries are allowed? → Question: carried\\]';
const MARKER_READABLE = '[NEEDS CLARIFICATION: FR-2 of «Checkout» — how many retries are allowed? → Question: carried]';
const FR2_READABLE = `FR-2 — When payment fails, the system keeps the basket and shows the failure. ${MARKER_READABLE}`;
const EDGE = '- Empty basket: the confirm button is disabled.';
const RABBIT = '- Card storage: never store card numbers; the payment provider holds them.';
const NOT_DOING = '- No cash on collection — because the bakery cannot reconcile it; revisit if a customer asks.';

const CHECKOUT = [
  '---',
  'name: Checkout',
  `what_it_does: ${WHAT_IT_DOES}`,
  'area: Ordering',
  'questions: [q-02, q-04, q-05, q-07]',
  'created: 2026-08-04',
  '---',
  '',
  '## Why',
  WHY,
  '',
  '## Behaviour',
  FR1,
  PROVENANCE,
  FR2_STORED,
  '',
  '## Edge cases',
  EDGE,
  '',
  '## Rabbit holes',
  RABBIT,
  '',
  '## Not doing',
  NOT_DOING,
  '',
].join('\n');

const BROWSE = [
  '---',
  'name: Browse the menu',
  'what_it_does: A customer sees what the bakery sells today.',
  'area: Menu',
  'questions: [q-06]',
  'created: 2026-08-02',
  '---',
  '',
  '## Why',
  'Customers ask at the counter what is left.',
  '',
  '## Behaviour',
  "FR-1 — When a customer opens the menu, the system lists today's items.",
  '',
].join('\n');

const SLOT = [
  '---',
  'name: Pick a slot',
  'what_it_does: A customer chooses when to collect.',
  'area: Ordering',
  'questions: []',
  'created: 2026-08-03',
  '---',
  '',
  '## Why',
  'The counter gets crowded at lunch.',
  '',
  '## Behaviour',
  'FR-1 — When a customer picks a slot, the system holds it for them.',
  '',
  '## Not doing',
  '- No recurring slots — because nobody asked; revisit if regulars ask.',
  '',
].join('\n');

const Q = {
  q02: 'Is payment taken before the slot is booked?',
  q04: 'Can a customer change a pickup slot after paying?',
  q05: 'Which card brands does checkout accept?',
  q06: 'Can a customer browse the menu without an account?',
  q07: 'Should checkout offer a gift message?',
  q08: 'What is the product called?',
} as const;

const QUESTIONS = [
  '# Open questions',
  '',
  `### q-02 · ${Q.q02}`,
  '- **Status:** Applied',
  '- **Owner:**',
  '- **Touches:** Checkout',
  '- **Why asked:** The deck says "pay later" in one place and "prepaid" in another.',
  '- **Created:** 2026-08-01',
  '',
  '**Answer & why:** Up front — the bakery loses money on unpaid orders.',
  '',
  `### q-04 · ${Q.q04}`,
  '- **Status:** Open',
  '- **Owner:**',
  '- **Touches:** Checkout',
  '- **Why asked:** The deck says slots are "flexible"; no source says whether that survives payment.',
  '- **Suggested directions:**',
  '  1. Allow one change up to two hours before the slot. Why: the deck calls slots "flexible".',
  '  2. No changes once paid. Why: simpler for the counter.',
  '- **Created:** 2026-08-04',
  '',
  '**Answer & why:** _(unanswered)_',
  '',
  `### q-05 · ${Q.q05}`,
  '- **Status:** Answered',
  '- **Owner:**',
  '- **Touches:** Checkout',
  '- **Why asked:** The notes name a payment provider but no card brands.',
  '- **Created:** 2026-08-05',
  '',
  "**Answer & why:** Visa and Mastercard — the provider's defaults.",
  '',
  `### q-06 · ${Q.q06}`,
  '- **Status:** Open',
  '- **Owner:**',
  '- **Touches:** Browse the menu',
  '- **Why asked:** The deck shows a sign-in screen before the menu.',
  '- **Created:** 2026-08-06',
  '',
  '**Answer & why:** _(unanswered)_',
  '',
  `### q-07 · ${Q.q07}`,
  '- **Status:** Rejected',
  '- **Owner:**',
  '- **Touches:** Checkout',
  '- **Why asked:** A sticky note mentions gifts.',
  '- **Created:** 2026-08-07',
  '',
  '**Answer & why:** Not a real gap — nobody asked for gifts.',
  '',
  `### q-08 · ${Q.q08}`,
  '- **Status:** Closed (not applied)',
  '- **Owner:**',
  '- **Touches:**',
  '- **Why asked:** No source names the product.',
  '- **Created:** 2026-08-08',
  '',
  '**Answer & why:** Overtaken by events — the client named it.',
  '',
].join('\n');

interface Doc {
  readme: string;
  features: Record<string, string>;
  questions: string;
}

const DOC: Doc = {
  readme: README,
  features: { '01-browse-the-menu.md': BROWSE, '02-checkout.md': CHECKOUT, '03-pick-a-slot.md': SLOT },
  questions: QUESTIONS,
};

/** A workspace whose `.blueprint/target.md` points at a local document folder holding `doc`. */
function workspace(doc: Doc = DOC, opts: { reverse?: boolean } = {}): { ws: string; docDir: string } {
  const ws = tempDir('bp-render-');
  const docDir = join(ws, 'pickup-doc');
  writeFile(join(ws, '.blueprint', 'target.md'), `kind: local\npath: ${docDir}\n`);
  const files: [string, string][] = [
    [join(docDir, 'README.md'), doc.readme],
    ...Object.entries(doc.features).map(([f, t]): [string, string] => [join(docDir, 'features', f), t]),
    [join(docDir, 'questions.md'), doc.questions],
  ];
  for (const [p, t] of opts.reverse ? [...files].reverse() : files) writeFile(p, t);
  return { ws, docDir };
}

interface RenderOpts {
  /** The clock, local time (default NOW_ISO). */
  now?: string;
  /** The --title flag (default TITLE, so a temp workspace's random name never reaches the output). */
  title?: string;
}

const render = (ws: string, args: string[], o: RenderOpts = {}): RunResult =>
  run(['render', '--title', o.title ?? TITLE, ...args], { workspace: ws, ...(o.now ? { now: o.now } : {}) });

/** A successful render's stdout; fails the test with the stderr otherwise. */
function rendered(ws: string, args: string[], o: RenderOpts = {}): string {
  const r = render(ws, args, o);
  assert.equal(r.code, EXIT.ok, r.err);
  return r.out;
}

const PACKET_HEADINGS = [
  'WHAT THIS PRODUCT IS NOT',
  'NOT DOING, HERE',
  'BUILD THIS',
  'NOT DECIDED',
  'CALLS ALREADY MADE',
  'CONTEXT',
] as const;

/** The non-blank lines under one of the packet's six headings (doc-shape §10), up to the next heading. */
function packetSection(packet: string, heading: (typeof PACKET_HEADINGS)[number]): string[] {
  const lines = packet.split('\n');
  const start = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(start >= 0, `the packet has no ${heading} section:\n${packet}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => PACKET_HEADINGS.some((h) => l.startsWith(h)));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim() !== '');
}

/** The `### ` titles under a markdown `## heading`, up to the next `## ` heading. */
function h3Under(md: string, heading: string): string[] {
  const lines = md.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
}

/** Every file under a directory with its bytes — to prove a command wrote nothing. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    const p = join(dir, rel);
    out[rel] = statSync(p).isDirectory() ? '<dir>' : readFile(p);
  }
  return out;
}

// ---- readable() -------------------------------------------------------------------------------------------------------

void describe('readable', () => {
  void test("unescapes the target's escaped marker brackets", () => {
    assert.equal(
      readable('\\[NEEDS CLARIFICATION: which provider? → Question: carried\\]'),
      '[NEEDS CLARIFICATION: which provider? → Question: carried]',
    );
  });

  void test('unescapes escaped emphasis, heading, code and angle characters', () => {
    assert.equal(readable('a \\* b \\_ c \\# d \\` e \\< f \\>'), 'a * b _ c # d ` e < f >');
  });

  void test('turns each <br> form into a line break', () => {
    assert.equal(readable('one<br>two<br/>three<br />four'), 'one\ntwo\nthree\nfour');
  });

  void test('leaves a mermaid fence exactly as written, <br> labels included', () => {
    assert.equal(readable(MERMAID), MERMAID);
  });

  void test('leaves escapes inside a code fence as written', () => {
    const fence = '```\n\\[NEEDS CLARIFICATION: literal\\]\n```';
    assert.equal(readable(fence), fence);
  });

  void test('rewrites the text around a fence and keeps the fence itself', () => {
    assert.equal(
      readable('a<br>b\n```\nc<br>d \\[x\\]\n```\ne<br>f \\[y\\]'),
      'a\nb\n```\nc<br>d \\[x\\]\n```\ne\nf [y]',
    );
  });

  void test('a Notion page mention reads as its title and URL', () => {
    assert.equal(
      readable('See <mention-page url="https://app.notion.com/p/abc">Checkout</mention-page>.'),
      'See Checkout (https://app.notion.com/p/abc).',
    );
  });

  void test('a self-closing page mention reads as its URL', () => {
    assert.equal(
      readable('See <mention-page url="https://app.notion.com/p/abc"/>.'),
      'See https://app.notion.com/p/abc.',
    );
  });

  void test('an embedded database tag is dropped with its line break', () => {
    assert.equal(readable('<database url="collection://1" inline="true">Features</database>\nNext line'), 'Next line');
  });

  void test('plain text comes back unchanged', () => {
    assert.equal(
      readable('FR-1 — When a customer pays, the system confirms.'),
      'FR-1 — When a customer pays, the system confirms.',
    );
  });
});

// ---- md ---------------------------------------------------------------------------------------------------------------

void describe('bp render --format md (the default)', () => {
  void test('the page opens with the title and carries each human overview block as a section', () => {
    const md = rendered(workspace().ws, []);
    assert.equal(md.split('\n')[0], '# Pickup — product definition');
    const headings = md.split('\n').filter((l) => /^## /.test(l));
    for (const b of OVERVIEW_BLOCKS) assert.ok(headings.includes(`## ${b}`), `missing ## ${b}`);
  });

  void test('the mermaid picture comes through byte for byte, <br> labels included', () => {
    assert.ok(rendered(workspace().ws, []).includes(MERMAID));
  });

  void test("each feature's section carries the read-out line ahead of its body (targets §4)", () => {
    const md = rendered(workspace().ws, []);
    const at = md.indexOf('«Checkout» · Ordering');
    assert.ok(at >= 0);
    assert.ok(at < md.indexOf(WHY), 'the read-out line precedes the Why text');
  });

  void test('escaped marker brackets are unescaped for the reader', () => {
    const md = rendered(workspace().ws, []);
    assert.ok(md.includes(FR2_READABLE));
    assert.ok(!md.includes('\\['));
  });

  void test('the reading view strips provenance italics unless --provenance is given', () => {
    const { ws } = workspace();
    assert.ok(!rendered(ws, []).includes(PROVENANCE));
    assert.ok(rendered(ws, ['--provenance']).includes(PROVENANCE));
  });

  void test('the header counts the live questions: Open and Answered, never a decided row (databases §6)', () => {
    // q-04 Open, q-05 Answered, q-06 Open → 3; q-02 Applied, q-07 Rejected, q-08 Closed are decided.
    assert.match(rendered(workspace().ws, []), /\b3 questions still open\b/);
  });

  void test('the assembled date is the local calendar date of the read, in the page and the packet', () => {
    // A clock just past local midnight (east of UTC) or just before it (west) puts the UTC date on another day; the
    // printed date must still be the reader's own, 2026-09-25 (src/core/clock.ts: UTC is never printed into content).
    const offset = new Date(NOW_ISO).getTimezoneOffset();
    const now = offset < 0 ? '2026-09-25T00:30:00' : offset > 0 ? '2026-09-25T23:30:00' : NOW_ISO;
    const { ws } = workspace();
    assert.match(rendered(ws, [], { now }), /Assembled from the Blueprint on 2026-09-25\b/);
    assert.match(rendered(ws, ['--packet', 'Checkout'], { now }), /assembled 2026-09-25 from the Blueprint/);
  });
});

void describe('bp render --feature', () => {
  void test('renders that one feature and no other', () => {
    const md = rendered(workspace().ws, ['--feature', 'Checkout']);
    assert.equal(md.split('\n')[0], '# Checkout');
    assert.ok(md.includes(FR1));
    assert.ok(!md.includes('Browse the menu'));
    assert.ok(!md.includes('Pick a slot'));
    assert.ok(!md.includes(NOT_CLAUSE), 'no overview in a one-feature render');
  });

  void test('carries the read-out line «title» · Area ahead of ## Why (targets §4)', () => {
    const md = rendered(workspace().ws, ['--feature', 'Checkout']);
    const at = md.indexOf('«Checkout» · Ordering');
    assert.ok(at >= 0);
    assert.ok(at < md.indexOf('## Why'));
  });

  void test('lists the live questions touching the feature and none of its decided ones', () => {
    const md = rendered(workspace().ws, ['--feature', 'Checkout']);
    assert.ok(md.includes(Q.q04));
    assert.ok(md.includes(Q.q05));
    for (const decided of [Q.q02, Q.q07]) assert.ok(!md.includes(decided), decided);
    assert.ok(!md.includes(Q.q06), 'a question touching another feature');
  });

  void test('an unknown feature is a usage error naming the features there are', () => {
    const r = render(workspace().ws, ['--feature', 'Refunds']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /Refunds/);
    assert.match(r.err, /Checkout/);
    assert.equal(r.out, '');
  });
});

void describe('bp render --questions', () => {
  void test('open (the default) lists the live questions — Open and Answered — oldest first', () => {
    assert.deepEqual(h3Under(rendered(workspace().ws, []), 'Open questions'), [Q.q04, Q.q05, Q.q06]);
  });

  void test('open is the same as giving no --questions', () => {
    const { ws } = workspace();
    assert.equal(rendered(ws, ['--questions', 'open']), rendered(ws, []));
  });

  void test('all lists every question, decided ones included, oldest first', () => {
    assert.deepEqual(h3Under(rendered(workspace().ws, ['--questions', 'all']), 'Questions and decisions'), [
      Q.q02,
      Q.q04,
      Q.q05,
      Q.q06,
      Q.q07,
      Q.q08,
    ]);
  });

  void test("all carries a decided row's answer", () => {
    assert.ok(rendered(workspace().ws, ['--questions', 'all']).includes('Not a real gap — nobody asked for gifts.'));
  });

  void test("an Open row's suggested directions are shown", () => {
    const md = rendered(workspace().ws, []);
    assert.ok(md.includes('1. Allow one change up to two hours before the slot.'));
  });

  void test('none leaves the questions section out', () => {
    const md = rendered(workspace().ws, ['--questions', 'none']);
    assert.ok(!md.split('\n').includes('## Open questions'));
    assert.ok(!md.split('\n').includes('## Questions and decisions'));
    assert.ok(!md.includes('Why asked'));
  });

  void test('a value outside open|all|none is a usage error', () => {
    assert.equal(render(workspace().ws, ['--questions', 'some']).code, EXIT.usage);
  });
});

// ---- txt / json / html ------------------------------------------------------------------------------------------------

void describe('bp render --format txt', () => {
  void test('no markdown heading or bold marks survive', () => {
    const txt = rendered(workspace().ws, ['--format', 'txt']);
    assert.ok(!txt.split('\n').some((l) => /^#{1,6}\s/.test(l)), 'a # heading line');
    assert.ok(!txt.includes('**'));
  });

  void test('a heading becomes upper case over an = rule of its length', () => {
    const txt = rendered(workspace().ws, ['--format', 'txt', '--feature', 'Checkout']);
    assert.ok(txt.startsWith('CHECKOUT\n========\n'));
    assert.ok(txt.includes('\nWHY\n===\n'));
  });

  void test('the requirement text comes through', () => {
    assert.ok(rendered(workspace().ws, ['--format', 'txt']).includes(FR1));
  });
});

interface JsonRender {
  title: string;
  overview: Record<string, string> | null;
  features: {
    id: string;
    name: string;
    area: string;
    whatItDoes: string;
    requirements: { n: number; text: string; withdrawn: boolean; depth: number }[];
    markers: { block: string; fr: number | null; text: string }[];
    openQuestions: string[];
  }[];
  questions: { id: string; question: string; status: string }[];
  decided: number;
}

const json = (ws: string, args: string[] = []): JsonRender =>
  JSON.parse(rendered(ws, ['--format', 'json', ...args])) as JsonRender;

void describe('bp render --format json', () => {
  void test('carries the title and the human overview blocks, never a ⟳ list', () => {
    const j = json(workspace().ws);
    assert.equal(j.title, TITLE);
    assert.deepEqual(Object.keys(j.overview ?? {}), [...OVERVIEW_BLOCKS]);
  });

  void test('lists features by area, then name', () => {
    assert.deepEqual(
      json(workspace().ws).features.map((f) => [f.area, f.name]),
      [
        ['Menu', 'Browse the menu'],
        ['Ordering', 'Checkout'],
        ['Ordering', 'Pick a slot'],
      ],
    );
  });

  void test("a feature carries its numbered requirements, readable, with each one's depth", () => {
    const checkout = json(workspace().ws).features.find((f) => f.name === 'Checkout');
    assert.deepEqual(checkout?.requirements, [
      { n: 1, text: FR1.replace('FR-1 — ', ''), withdrawn: false, depth: 1 },
      { n: 2, text: FR2_READABLE.replace('FR-2 — ', ''), withdrawn: false, depth: 1 },
    ]);
  });

  void test('a feature carries its markers, with the block and requirement each sits on', () => {
    const checkout = json(workspace().ws).features.find((f) => f.name === 'Checkout');
    assert.deepEqual(checkout?.markers, [
      { block: 'Behaviour', fr: 2, text: 'FR-2 of «Checkout» — how many retries are allowed? → Question: carried' },
    ]);
  });

  void test('a feature lists the live questions touching it', () => {
    const checkout = json(workspace().ws).features.find((f) => f.name === 'Checkout');
    assert.deepEqual(checkout?.openQuestions, ['q-04', 'q-05']);
  });

  void test('questions default to the live ones', () => {
    assert.deepEqual(
      json(workspace().ws).questions.map((q) => q.id),
      ['q-04', 'q-05', 'q-06'],
    );
  });

  void test('--questions all lists every question', () => {
    assert.deepEqual(
      json(workspace().ws, ['--questions', 'all']).questions.map((q) => q.id),
      ['q-02', 'q-04', 'q-05', 'q-06', 'q-07', 'q-08'],
    );
  });

  void test('decided counts Applied, Rejected and Closed (not applied) rows (databases §6 Decision log)', () => {
    assert.equal(json(workspace().ws).decided, 3);
  });

  void test('--feature narrows the features to that one', () => {
    assert.deepEqual(
      json(workspace().ws, ['--feature', 'Checkout']).features.map((f) => f.name),
      ['Checkout'],
    );
  });
});

// ---- html, and its safety ---------------------------------------------------------------------------------------------

interface Tag {
  name: string;
  attrs: Map<string, string>;
}

/** Start and end tags as an HTML tokenizer reads them: name, then attributes (quoted, unquoted or bare) up to `>`. */
function tagsOf(html: string): Tag[] {
  const out: Tag[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    let i = m.index + m[0].length;
    const attrs = new Map<string, string>();
    const ws = (): void => {
      while (/\s/.test(html[i] ?? '')) i += 1;
    };
    for (;;) {
      ws();
      if (i >= html.length) break;
      if (html[i] === '>') {
        i += 1;
        break;
      }
      if (html[i] === '/') {
        i += 1;
        continue;
      }
      const name = /^[^\s"'>/=]+/.exec(html.slice(i))?.[0] ?? html[i] ?? '';
      i += name.length;
      ws();
      let value = '';
      if (html[i] === '=') {
        i += 1;
        ws();
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          value = html.slice(i + 1, end < 0 ? html.length : end);
          i = end < 0 ? html.length : end + 1;
        } else {
          value = /^[^\s>]*/.exec(html.slice(i))?.[0] ?? '';
          i += value.length;
        }
      }
      attrs.set(name.toLowerCase(), value);
    }
    out.push({ name: (m[1] ?? '').toLowerCase(), attrs });
    re.lastIndex = i;
  }
  return out;
}

/** The only elements and attributes the page template and the markdown converter ever emit. */
const SAFE_TAGS = new Set([
  'html',
  'head',
  'meta',
  'title',
  'style',
  'body',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'li',
  'blockquote',
  'strong',
  'em',
  'code',
  'pre',
  'a',
]);
const SAFE_ATTRS = new Set(['lang', 'charset', 'name', 'content', 'href']);

const HOSTILE_README = [
  '# Evil',
  '',
  '## TL;DR',
  '<script>alert(1)</script> and <img src=x onerror=alert(2)>',
  '',
  '## What this product is',
  'It is not \\<script\\>alert(3)\\</script\\> a delivery service.',
  '',
  '## Links',
  '- [click me](javascript:alert(4))',
  '- [quoted](https://example.com/"onmouseover="alert(5))',
  '- <a href="javascript:alert(6)">raw anchor</a>',
  '- <mention-page url="javascript:alert(7)">Evil page</mention-page>',
  '',
].join('\n');

const HOSTILE_FEATURE = [
  '---',
  'name: <b onmouseover=alert(8)>Checkout</b>',
  'what_it_does: <iframe src="javascript:alert(9)"></iframe>',
  'area: <svg onload=alert(10)>',
  'questions: []',
  '---',
  '',
  '## Why',
  '**<script>alert(11)</script>** and *<img src=x onerror=alert(12)>* and `<script>alert(13)</script>`',
  '',
  '## Behaviour',
  'FR-1 — When a customer pays, the system shows <style>body{display:none}</style> nothing.',
  '',
  '## Edge cases',
  '```',
  '</code></pre><script>alert(14)</script>',
  '```',
  '',
].join('\n');

const HOSTILE_QUESTIONS = [
  '### q-01 · <script>alert(15)</script>?',
  '- **Status:** Open',
  '- **Touches:** <b onmouseover=alert(8)>Checkout</b>',
  '- **Why asked:** "><script>alert(16)</script>',
  '- **Created:** 2026-08-01',
  '',
  '**Answer & why:** _(unanswered)_',
  '',
].join('\n');

const hostileHtml = (): string =>
  rendered(
    workspace({ readme: HOSTILE_README, features: { '01-evil.md': HOSTILE_FEATURE }, questions: HOSTILE_QUESTIONS }).ws,
    ['--format', 'html'],
    { title: '</title><script>alert(17)</script>' },
  );

void describe('bp render --format html', () => {
  void test('is a complete page titled for the product', () => {
    const html = rendered(workspace().ws, ['--format', 'html']);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.endsWith('</html>'));
    assert.ok(html.includes('<title>Pickup — product definition</title>'));
    assert.ok(html.includes('<h1>Pickup — product definition</h1>'));
  });

  void test('the mermaid fence is preformatted text, its <br> kept as literal characters', () => {
    const html = rendered(workspace().ws, ['--format', 'html']);
    assert.ok(html.includes('A[&quot;Customer&lt;br&gt;orders&quot;] --&gt; B[&quot;Bakery&lt;br&gt;prepares&quot;]'));
  });

  void test('a web link in the text becomes an anchor', () => {
    const doc = {
      ...DOC,
      readme: README.replace(
        '- Design file: https://www.figma.com/file/abc',
        '- [Design file](https://www.figma.com/file/abc)',
      ),
    };
    assert.ok(
      rendered(workspace(doc).ws, ['--format', 'html']).includes(
        '<a href="https://www.figma.com/file/abc">Design file</a>',
      ),
    );
  });

  void test('SAFETY: no <script> element comes out of document text or the title', () => {
    assert.ok(!/<script/i.test(hostileHtml()));
  });

  void test('SAFETY: every element is one the page itself uses, and the template holds the only <style>', () => {
    const tags = tagsOf(hostileHtml());
    const foreign = tags.filter((t) => !SAFE_TAGS.has(t.name)).map((t) => t.name);
    assert.deepEqual(foreign, []);
    assert.equal(tags.filter((t) => t.name === 'style').length, 2, 'one <style> and its </style>');
  });

  void test('SAFETY: no attribute comes from document text — no event handler, nothing outside the template set', () => {
    const attrs = tagsOf(hostileHtml()).flatMap((t) => [...t.attrs.keys()]);
    assert.deepEqual(
      attrs.filter((a) => !SAFE_ATTRS.has(a)),
      [],
    );
  });

  void test('SAFETY: every link target is a web URL — a javascript: URL is never a link', () => {
    const hrefs = tagsOf(hostileHtml()).flatMap((t) => (t.attrs.has('href') ? [t.attrs.get('href') ?? ''] : []));
    assert.deepEqual(
      hrefs.filter((h) => !/^https?:\/\//i.test(h)),
      [],
    );
  });

  void test('SAFETY: hostile text is shown escaped, not silently dropped', () => {
    const html = hostileHtml();
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
    assert.ok(html.includes('&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(14)&lt;/script&gt;'));
  });
});

// ---- the build packet (doc-shape §10) ---------------------------------------------------------------------------------

void describe('bp render --packet (doc-shape §10)', () => {
  const packet = (doc: Doc = DOC, name = 'Checkout'): string => rendered(workspace(doc).ws, ['--packet', name]);

  void test('opens with the feature and carries the six sections in the spec order', () => {
    const p = packet();
    assert.match(p.split('\n')[0] ?? '', /^BUILD PACKET — «Checkout»/);
    const at = PACKET_HEADINGS.map((h) => p.split('\n').findIndex((l) => l.startsWith(h)));
    assert.ok(
      at.every((i) => i >= 0),
      `every section present: ${at.join(',')}`,
    );
    assert.deepEqual(
      [...at].sort((a, b) => a - b),
      at,
    );
  });

  void test('carries the read-out line «title» · Area (targets §4: a build packet prepends it)', () => {
    assert.ok(packet().includes('«Checkout» · Ordering'));
  });

  void test("WHAT THIS PRODUCT IS NOT is the overview's NOT-clause, verbatim", () => {
    assert.deepEqual(packetSection(packet(), 'WHAT THIS PRODUCT IS NOT'), [NOT_CLAUSE]);
  });

  void test('the NOT-clause is found when it wraps over two source lines', () => {
    const doc = {
      ...DOC,
      readme: README.replace(NOT_CLAUSE, 'It is not a delivery service,\nand it never holds stock for walk-in sales.'),
    };
    assert.deepEqual(packetSection(packet(doc), 'WHAT THIS PRODUCT IS NOT'), [NOT_CLAUSE]);
  });

  void test('a marker on the block after the NOT-clause is not taken into it', () => {
    // doc-shape §3: a product-level unknown is a marker on the block where it bites — here, on the NOT-clause's block.
    const marker = '\\[NEEDS CLARIFICATION: is catering for events in scope or not? → Question: q-09\\]';
    const doc = { ...DOC, readme: README.replace(NOT_CLAUSE, `${NOT_CLAUSE}\n${marker}`) };
    assert.deepEqual(packetSection(packet(doc), 'WHAT THIS PRODUCT IS NOT'), [NOT_CLAUSE]);
  });

  void test("NOT DOING, HERE is the feature's Not doing lines, each with its why", () => {
    assert.deepEqual(packetSection(packet(), 'NOT DOING, HERE'), [NOT_DOING]);
  });

  void test('BUILD THIS is the numbered requirements with the provenance italics stripped', () => {
    assert.deepEqual(packetSection(packet(), 'BUILD THIS'), [FR1, FR2_READABLE]);
  });

  void test('NOT DECIDED lists every live question touching the feature, and its markers', () => {
    const lines = packetSection(packet(), 'NOT DECIDED');
    assert.ok(
      lines.some((l) => l.includes(Q.q04)),
      'q-04 (Open)',
    );
    assert.ok(
      lines.some((l) => l.includes(Q.q05)),
      'q-05 (Answered)',
    );
    assert.ok(
      lines.some((l) => l.includes(MARKER_READABLE)),
      'the FR-2 marker',
    );
  });

  void test("NOT DECIDED leaves out decided questions and other features' questions", () => {
    const text = packetSection(packet(), 'NOT DECIDED').join('\n');
    for (const q of [Q.q02, Q.q07, Q.q08, Q.q06]) assert.ok(!text.includes(q), q);
  });

  void test('NOT DECIDED says so when nothing open bears on the feature, rather than being blank', () => {
    const lines = packetSection(packet(DOC, 'Pick a slot'), 'NOT DECIDED');
    assert.equal(lines.length, 1);
    assert.ok(!lines.some((l) => l.includes(Q.q04) || l.includes(Q.q06)));
  });

  void test('CALLS ALREADY MADE is the Rabbit holes block', () => {
    assert.deepEqual(packetSection(packet(), 'CALLS ALREADY MADE'), [RABBIT]);
  });

  void test('CONTEXT is What it does, then Why, verbatim', () => {
    assert.deepEqual(packetSection(packet(), 'CONTEXT'), [WHAT_IT_DOES, WHY]);
  });

  void test('the packet never carries a provenance line', () => {
    assert.ok(!packet().includes('*(Applied'));
  });

  void test('an unknown feature is a usage error', () => {
    const r = render(workspace().ws, ['--packet', 'Refunds']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /Refunds/);
  });
});

// ---- --out --------------------------------------------------------------------------------------------------------------

void describe('bp render --out', () => {
  void test('writes the render to a file outside the working folder, the same bytes stdout carries', () => {
    const { ws } = workspace();
    const dest = join(tempDir('bp-out-'), 'pickup.html');
    const r = render(ws, ['--format', 'html', '--out', dest]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.ok(r.out.includes(dest));
    assert.equal(readFile(dest), `${rendered(ws, ['--format', 'html'])}\n`);
  });

  void test('a relative --out resolves against the workspace', () => {
    const { ws } = workspace();
    assert.equal(render(ws, ['--out', 'exports/pickup.md']).code, EXIT.ok);
    assert.ok(readFile(join(ws, 'exports', 'pickup.md')).startsWith('# Pickup — product definition\n'));
  });

  void test('refuses a path inside the working folder, and writes nothing', () => {
    const { ws } = workspace();
    const r = render(ws, ['--out', '.blueprint/record/pickup.md']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /working folder/);
    assert.equal(fileExists(join(ws, '.blueprint', 'record', 'pickup.md')), false);
  });

  void test('refuses an absolute path inside the working folder', () => {
    const { ws } = workspace();
    const dest = join(ws, '.blueprint', 'pickup.md');
    assert.equal(render(ws, ['--out', dest]).code, EXIT.usage);
    assert.equal(fileExists(dest), false);
  });

  void test('a sibling folder whose name merely starts with the working folder name is outside it', () => {
    const { ws } = workspace();
    const r = render(ws, ['--out', '.blueprint-export/pickup.md']);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.ok(fileExists(join(ws, '.blueprint-export', 'pickup.md')));
  });

  void test('a packet can be written out too', () => {
    const { ws } = workspace();
    const dest = join(tempDir('bp-out-'), 'checkout-packet.txt');
    assert.equal(render(ws, ['--packet', 'Checkout', '--out', dest]).code, EXIT.ok);
    assert.ok(readFile(dest).startsWith('BUILD PACKET — «Checkout»'));
  });
});

// ---- determinism and read-only ------------------------------------------------------------------------------------------

void describe('bp render is deterministic and read-only', () => {
  void test('the same Blueprint renders the same bytes, in every format and the packet', () => {
    const { ws } = workspace();
    for (const args of [
      [],
      ['--format', 'txt'],
      ['--format', 'json'],
      ['--format', 'html'],
      ['--packet', 'Checkout'],
    ]) {
      assert.equal(rendered(ws, args), rendered(ws, args), args.join(' ') || 'md');
    }
  });

  void test('the order the files were written in makes no difference', () => {
    const a = workspace(DOC).ws;
    const b = workspace(DOC, { reverse: true }).ws;
    for (const args of [[], ['--format', 'json']])
      assert.equal(rendered(a, args), rendered(b, args), args.join(' ') || 'md');
  });

  void test('render writes nothing in the workspace without --out', () => {
    const { ws } = workspace();
    const before = tree(ws);
    for (const args of [[], ['--format', 'html'], ['--packet', 'Checkout']]) rendered(ws, args);
    assert.deepEqual(tree(ws), before);
  });
});

// ---- refusals -----------------------------------------------------------------------------------------------------------

void describe('bp render refusals', () => {
  void test('a partial read is not rendered: a missing questions.md halts, naming it', () => {
    const { ws, docDir } = workspace();
    rmSync(join(docDir, 'questions.md'));
    const r = render(ws, []);
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /questions\.md/);
    assert.equal(r.out, '');
  });

  void test('no target.md halts', () => {
    const r = render(tempDir('bp-empty-'), []);
    assert.equal(r.code, EXIT.halt);
    assert.equal(r.out, '');
  });

  void test('an unknown --format is a usage error', () => {
    const r = render(workspace().ws, ['--format', 'pdf']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /md, txt, json, html/);
  });
});
