import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, SKILL_ROOT, type RunResult } from './support/index.ts';
import { appendCall, FakeNotion } from './support/fake-notion.ts';

// `bp resolve` on a Notion target, end to end through the relay (DESIGN.md §5): bp plans every connector call, a fake
// Notion answers each one into the session transcript, and simulated subagents answer the writer and the check. The clock
// advances between invocations, as it does in a real session, so a result is always newer than the plan that asked for it.

const SID = 'sess-notion-e2e-0001';
const OVERVIEW = '0a1b2c3d4e5f40618293a4b5c6d7e8f9';
const FEATURES_DS = 'collection://11111111-2222-4333-8444-555555555555';
const QUESTIONS_DS = 'collection://66666666-7777-4888-9999-aaaaaaaaaaaa';
const F1 = 'f1000000000000000000000000000000';
const Q1 = 'e1000000000000000000000000000000';

const BODY = [
  '## Why',
  'Customers pay for a pickup slot.',
  '',
  '## Behaviour',
  'FR-1 — When a customer confirms the basket, the system takes payment.',
  'FR-2 — After payment the system shows a confirmation.',
  '',
  '## Edge cases',
  '- A failed payment leaves the basket as it was.',
  '',
  '## Rabbit holes',
  '',
  '## Not doing',
  '- No cash on delivery — because the team cannot reconcile it; revisit if a partner offers it.',
].join('\n');

function notion(opts: { whyFlagged: boolean }): FakeNotion {
  const n = new FakeNotion();
  n.pages.set(OVERVIEW, {
    title: 'PRD — Pickup',
    properties: { title: 'PRD — Pickup' },
    content: [
      '## TL;DR',
      'Pickup slots, paid ahead.',
      `<database url="https://app.notion.com/p/d1000000000000000000000000000000" inline="true" data-source-url="${FEATURES_DS}">Features</database>`,
      `<database url="https://app.notion.com/p/d2000000000000000000000000000000" inline="true" data-source-url="${QUESTIONS_DS}">Open Questions</database>`,
      '## Operating',
      '- Run record: the Blueprint run log.',
    ].join('\n'),
  });
  n.pages.set(F1, {
    title: 'Checkout',
    properties: {
      Name: 'Checkout',
      Area: 'Payments',
      'What it does': 'Pay for a pickup slot.',
      Created: '2026-09-08 08:35:37Z',
      Questions: JSON.stringify([`https://app.notion.com/${Q1}`]),
    },
    content: BODY,
  });
  n.pages.set(Q1, {
    title: 'How long does the confirmation stay on screen?',
    properties: {
      Question: 'How long does the confirmation stay on screen?',
      Status: 'Answered',
      'Answer & why': 'Five seconds, then the home screen — customers should not wait.',
      'Why asked': 'FR-2 names a confirmation and no source says how long it stays. · depth 1',
      'Suggested directions': null,
      ...(opts.whyFlagged ? { 'Why flagged': null } : {}),
      Touches: JSON.stringify([`https://app.notion.com/${F1}`]),
      Owner: null,
      Created: '2026-09-20 10:00:00Z',
    },
    content: '',
  });
  const text = (name: string) => ({ name, type: 'text' });
  n.sources.push({
    url: FEATURES_DS,
    title: 'Features',
    schema: {
      Name: { name: 'Name', type: 'title' },
      Area: { name: 'Area', type: 'select' },
      'What it does': text('What it does'),
      Created: { name: 'Created', type: 'created_time' },
      Questions: { name: 'Questions', type: 'relation' },
    },
    rows: [F1],
  });
  n.sources.push({
    url: QUESTIONS_DS,
    title: 'Open Questions',
    schema: {
      Question: { name: 'Question', type: 'title' },
      Status: { name: 'Status', type: 'select' },
      'Answer & why': text('Answer & why'),
      'Why asked': text('Why asked'),
      'Suggested directions': text('Suggested directions'),
      ...(opts.whyFlagged ? { 'Why flagged': text('Why flagged') } : {}),
      Touches: { name: 'Touches', type: 'relation' },
      Owner: { name: 'Owner', type: 'person' },
      Created: { name: 'Created', type: 'created_time' },
    },
    rows: [Q1],
  });
  return n;
}

interface Waiting {
  status: string;
  tasks: { id: string; kind: string; prompt: string }[];
  calls: { tool: string; input: Record<string, unknown> }[];
}

function setup(): { ws: string; home: string; transcript: string; projects: string; root: string } {
  const ws = tempDir('bp-notion-ws-');
  const home = join(ws, '.blueprint');
  mkdirSync(join(home, 'record'), { recursive: true });
  writeFile(join(home, 'target.md'), `# Target\n\nkind: notion\noverview_page_id: ${OVERVIEW}\n`);
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  const transcript = writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  const root = fakeSkillRoot(38);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return { ws, home, transcript, projects, root };
}

let agents = 0;
function subagent(projects: string, prompt: string, reply: unknown, at: string): void {
  const tag = /bp-task:[\w-]+:[0-9a-f]+/.exec(prompt)?.[0];
  assert.ok(tag);
  agents += 1;
  writeFile(
    join(projects, 'proj', SID, 'subagents', `agent-n${agents}.jsonl`),
    `${[
      JSON.stringify({ type: 'user', timestamp: at, isSidechain: true, message: { role: 'user', content: prompt } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: {
          role: 'assistant',
          model: 'model-sub',
          content: [
            { type: 'tool_use', id: `h${agents}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}

let clock = Date.parse('2026-09-25T12:00:00Z');

/** Drive bp to the end: answer every owed call from the fake Notion and every task from `reply`, advancing the clock. */
function drive(
  s: ReturnType<typeof setup>,
  n: FakeNotion,
  reply: (kind: string, prompt: string) => unknown,
  args: string[] = [],
  command = 'resolve',
): { last: RunResult; rounds: Waiting[] } {
  const rounds: Waiting[] = [];
  for (let i = 0; i < 40; i++) {
    // Time only moves forward, across drives too: a later run's plan is newer than every call an earlier run made.
    clock += 60_000;
    const now = new Date(clock);
    // run()'s clock takes local wall-clock time; the transcript takes instants.
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    // A first invocation's flags (add's sources) are given once; resolve's flags on every call.
    const r = run([command, '--workspace', s.ws, '--json', ...(i === 0 || command === 'resolve' ? args : [])], {
      skillRoot: s.root,
      workspace: s.ws,
      now: local,
      env: { CLAUDE_CODE_SESSION_ID: SID, HOME: join(s.projects, '..', '..') },
    });
    if (r.code !== EXIT.waiting) return { last: r, rounds };
    const w = JSON.parse(r.out) as Waiting;
    rounds.push(w);
    const at = new Date(now.getTime() + 20_000).toISOString();
    for (const c of w.calls) appendCall(s.transcript, c.tool, c.input, n.answer(c.tool, c.input), at);
    for (const t of w.tasks) subagent(s.projects, t.prompt, reply(t.kind, t.prompt), at);
  }
  throw new Error(
    `bp did not finish in 40 rounds; the last owed: ${JSON.stringify(rounds[rounds.length - 1]).slice(0, 600)}`,
  );
}

const WRITER = {
  output: 'delta',
  block: 'Behaviour',
  changes: [{ fr: 2, text: 'After payment the system shows a confirmation for five seconds, then the home screen.' }],
  groundingKind: 'answer and reasoning on that row',
  removesMarker: false,
  directives: [],
};
const CHECK = {
  verdicts: [
    { target: 'FR-2', verdict: 'Clean', inconsistency: '', answerQuote: 'Five seconds, then the home screen' },
  ],
  directives: [],
};
const reply = (kind: string): unknown => (kind === 'writer' ? WRITER : CHECK);

void describe('bp resolve on a Notion target, through the relay', () => {
  void test('pull, write, check, push (fetch → update → read-back), properties (write → read-back), close', () => {
    const s = setup();
    const n = notion({ whyFlagged: true });
    const { last, rounds } = drive(s, n, reply);
    assert.equal(last.code, EXIT.ok, last.err + last.out);

    // The body carries the answer, with its provenance line, written through one minimal update_content call.
    assert.match(
      n.page(F1).content,
      /^FR-2 — After payment the system shows a confirmation for five seconds, then the home screen\.\n\*\(Applied \d{4}-\d{2}-\d{2} from «How long does the confirmation stay on screen\?» \*\*`e1000000000000000000000000000000`\*\* · depth 1 — answer and reasoning on that row\.\)\*$/m,
    );
    const updates = n.log.filter((c) => c.input['command'] === 'update_content');
    assert.equal(updates.length, 1);
    const edit = (updates[0]?.input['content_updates'] as { old_str: string }[])[0];
    assert.ok(
      edit && !edit.old_str.includes('## Why'),
      'the edit is anchored on the changed lines, never the whole page',
    );
    // The row moved to Applied, Why flagged blank, and both read back.
    assert.equal(n.page(Q1).properties['Status'], 'Applied');
    assert.equal(n.page(Q1).properties['Why flagged'], '');
    // bp never asked for anything but the relay's own calls.
    assert.ok(n.log.every((c) => /notion-(fetch|query-data-sources|update-page)$/.test(c.tool)));
    assert.ok(rounds.length >= 5);

    const logText = readFile(join(s.home, 'record', 'run-log.md'));
    assert.match(
      logText,
      /^- item: «How long does the confirmation stay on screen\?» `e1000000000000000000000000000000` · Clean · «Checkout» FR-2 · body [0-9a-f]{12}$/m,
    );
    assert.match(logText, /^- closing: CLOSED \d{2}:\d{2} · DRAINED · run totals: 1 applied · 0 flagged · 1 sitting$/m);
  });

  void test('a Blueprint without the v34 Why flagged property is migrated by the run, confirmed, then written', () => {
    const s = setup();
    const n = notion({ whyFlagged: false });
    const { last } = drive(s, n, reply);
    assert.equal(last.code, EXIT.ok, last.err + last.out);
    assert.ok(
      n.log.some(
        (c) => c.tool === 'notion-update-data-source' && c.input['statements'] === 'ADD COLUMN "Why flagged" RICH_TEXT',
      ),
    );
    assert.match(
      readFile(join(s.home, 'record', 'run-log.md')),
      /^- NOTE: v34 register row crossed: added the Why flagged rich-text property/m,
    );
    assert.equal(n.page(Q1).properties['Status'], 'Applied');
  });

  void test('a body edited by someone else between the read and the write is a conflict: nothing is written', () => {
    const s = setup();
    const n = notion({ whyFlagged: true });
    let edited = false;
    const { last } = drive(s, n, (kind) => {
      // The moment the check is answered, a human edits FR-2 in the UI — before bp's fresh fetch.
      if (kind === 'checker' && !edited) {
        edited = true;
        n.page(F1).content = n.page(F1).content.replace('shows a confirmation.', 'shows a receipt.');
      }
      return reply(kind);
    });
    assert.equal(last.code, EXIT.ok, last.err + last.out);
    assert.match(
      n.page(F1).content,
      /^FR-2 — After payment the system shows a receipt\.$/m,
      "the other author's text stands",
    );
    assert.equal(n.page(Q1).properties['Status'], 'Flagged');
    assert.match(
      String(n.page(Q1).properties['Why flagged']),
      /^conflict — «Checkout» Behaviour changed since the run read it/,
    );
  });
});

void describe('the overview route on a Notion target', () => {
  void test('round one appends the proposal to Why asked and flags; round two, after the move, writes the overview block', () => {
    const s = setup();
    const n = notion({ whyFlagged: true });
    const q = n.page(Q1);
    q.properties['Touches'] = null;
    q.properties['Question'] = 'Is the app for members only?';
    q.properties['Answer & why'] = 'Members only, no guests.';
    const whyAsked = String(q.properties['Why asked']);
    const proposal = {
      output: 'overview',
      block: 'Operating',
      text: '- Run record: the Blueprint run log.\n- Audience (2026-09-25): members only.',
      directives: [],
    };
    const check = {
      verdicts: [{ target: 'overview «Operating»', verdict: 'Clean', inconsistency: '', answerQuote: 'Members only' }],
      directives: [],
    };
    const one = drive(s, n, (kind) => (kind === 'project-writer' ? proposal : check));
    assert.equal(one.last.code, EXIT.ok, one.last.err + one.last.out);
    assert.equal(q.properties['Status'], 'Flagged');
    assert.ok(
      String(q.properties['Why asked']).startsWith(`${whyAsked}\n\nProposed block text (run `),
      'appended, never replacing',
    );
    assert.doesNotMatch(n.page(OVERVIEW).content, /Audience/);

    q.properties['Status'] = 'Answered'; // the human's move: acceptance of the pinned proposal
    const two = drive(s, n, (kind) =>
      assert.fail(`round two dispatches nothing — the human accepted the proposal (asked for ${kind})`),
    );
    assert.equal(two.last.code, EXIT.ok, two.last.err + two.last.out);
    assert.match(
      n.page(OVERVIEW).content,
      /## Operating\n- Run record: the Blueprint run log\.\n- Audience \(2026-09-25\): members only\.$/,
    );
    assert.equal(q.properties['Status'], 'Applied');
    assert.equal(q.properties['Answer & why'], 'Members only, no guests.');
  });
});

void describe('bp add on a Notion target, through the relay', () => {
  void test('supersedes in place, creates a feature row and a question row, and reads each back', () => {
    const s = setup();
    const n = notion({ whyFlagged: true });
    const source = writeFile(
      join(tempDir('bp-given-'), 'call.md'),
      'Call 09:05 — Payment is taken when the order is collected.\nCall 20:00 — A manager approves a refund and the money goes back to the card.\nCall 31:00 — The overview should say we never deliver.\n',
    );
    const cite = (at: string, quote: string) => ({ source: '01-call.md', at, quote });
    const draft = {
      inventory: [],
      changes: [
        {
          feature: 'Checkout',
          delta: {
            block: 'Behaviour',
            changes: [{ fr: 1, text: 'When a customer collects the order, the system takes payment.' }],
            groundingKind: 'the source moves payment to collection',
            removesMarker: false,
            directives: [],
          },
          cite: cite('09:05', 'Payment is taken when the order is collected.'),
          supersedes: { target: 'FR-1', old: 'When a customer confirms the basket, the system takes payment.' },
        },
      ],
      newFeatures: [
        {
          name: 'Refunds',
          area: 'Payments',
          whatItDoes: 'A manager returns a payment.',
          why: 'A customer owed money needs it back.',
          fr1: 'When a manager approves a refund, the system returns the payment to the card.',
          notDoing: [],
          cite: cite('20:00', 'A manager approves a refund and the money goes back to the card.'),
        },
      ],
      overview: [
        {
          block: 'TL;DR',
          text: 'Pickup slots, paid on collection. Never delivered.',
          question: 'Should the TL;DR say the product never delivers?',
          cite: cite('31:00', 'The overview should say we never deliver.'),
        },
      ],
      conflicts: [],
      gaps: [],
      directives: [],
    };
    const { last } = drive(
      s,
      n,
      (kind, prompt) => {
        if (kind === 'add-drafter') return draft;
        const brief = readFile(prompt.match(/Read the brief: (\S+)/)?.[1] ?? '');
        return {
          verdicts: [...brief.matchAll(/^<<<DATA (W\d+) ·/gm)].map((m) => ({
            item: m[1],
            verdict: 'Clean',
            finding: '',
          })),
          directives: [],
        };
      },
      ['--source', source],
      'add',
    );
    assert.equal(last.code, EXIT.ok, last.err + last.out);
    // The supersession, written by one minimal update_content and read back.
    assert.match(
      n.page(F1).content,
      /^FR-1 — When a customer collects the order, the system takes payment\.\n\*\(Superseded \d{4}-\d{2}-\d{2} from «call 09:05» · depth 1 — previously: "When a customer confirms the basket, the system takes payment\."\.\)\*$/m,
    );
    // The new feature and the question row: one notion-create-pages call each, under their data sources.
    assert.equal(n.log.filter((c) => c.tool === 'notion-create-pages').length, 2);
    const feature = [...n.pages.values()].find((p) => p.title === 'Refunds');
    assert.ok(feature);
    assert.match(
      feature.content,
      /^FR-1 — When a manager approves a refund, the system returns the payment to the card\.$/m,
    );
    const row = [...n.pages.values()].find((p) => p.title === 'Should the TL;DR say the product never delivers?');
    assert.ok(row);
    assert.equal(row.properties['Status'], 'Open');
    assert.equal(row.properties['Touches'], undefined, 'project-level: Touches empty');
    assert.match(
      String(row.properties['Why asked']),
      /Proposed block text \(run [0-9a-f]{6}, [\d-]+ — the overview's «TL;DR» block as it would read\):\n## TL;DR\nPickup slots, paid on collection\. Never delivered\.$/,
    );
    assert.doesNotMatch(n.page(OVERVIEW).content, /Never delivered/);
  });
});
