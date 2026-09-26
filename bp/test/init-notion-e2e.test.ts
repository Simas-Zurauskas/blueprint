import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, say, SKILL_ROOT, type RunResult } from './support/index.ts';
import { appendCall, FakeNotion } from './support/fake-notion.ts';
import { challengeReply } from './support/challenge-replies.ts';

// `bp init` on a Notion target, end to end through the relay: bp plans every connector call — the read, the two
// databases, the four views, the rows, the overview's one replace and its read-back — a fake Notion answers each into the
// session transcript, and simulated subagents answer the drafter, the grill, the check and the handoff. The clock
// advances between invocations, as it does in a real session.

const SID = 'sess-init-notion-0001';
const OVERVIEW = '0b1b2c3d4e5f40618293a4b5c6d7e8f9';

const NOTES = `Pickup notes
§1 Customers order ahead and collect at the counter.
§2 A customer can cancel an order until the kitchen starts it.
`;

function setup(content: string): {
  ws: string;
  home: string;
  transcript: string;
  projects: string;
  root: string;
  notes: string;
  n: FakeNotion;
} {
  const ws = tempDir('bp-init-notion-');
  const home = join(ws, '.blueprint');
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  const transcript = writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  const root = fakeSkillRoot(41);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  const notes = writeFile(join(tempDir('bp-given-'), 'notes.md'), NOTES);
  const n = new FakeNotion();
  n.pages.set(OVERVIEW, { title: 'Pickup', properties: { title: 'Pickup' }, content });
  return { ws, home, transcript, projects, root, notes, n };
}

interface Waiting {
  status: string;
  stage?: string;
  tasks: { id: string; kind: string; prompt: string }[];
  calls: { tool: string; input: Record<string, unknown> }[];
}

let agents = 0;
function subagent(projects: string, prompt: string, reply: unknown, at: string): void {
  agents += 1;
  writeFile(
    join(projects, 'proj', SID, 'subagents', `agent-in${agents}.jsonl`),
    `${[
      JSON.stringify({ type: 'user', timestamp: at, isSidechain: true, message: { role: 'user', content: prompt } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: {
          role: 'assistant',
          model: 'model-sub',
          content: [
            {
              type: 'tool_use',
              id: `in${agents}`,
              name: 'SubagentHandback',
              input: { message: JSON.stringify(reply) },
            },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}

let clock = Date.parse('2026-09-25T15:00:00Z');

/** Drive init until it stops at I3 or ends: every owed call from the fake Notion, every task from `reply`. */
function drive(
  s: ReturnType<typeof setup>,
  reply: (kind: string, prompt: string) => unknown,
  first: string[],
): { last: RunResult; rounds: Waiting[] } {
  const rounds: Waiting[] = [];
  for (let i = 0; i < 40; i++) {
    clock += 60_000;
    const now = new Date(clock);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    const r = run(['init', '--workspace', s.ws, '--json', ...(i === 0 ? first : [])], {
      skillRoot: s.root,
      workspace: s.ws,
      now: local,
      env: { CLAUDE_CODE_SESSION_ID: SID, HOME: join(s.projects, '..', '..') },
    });
    if (r.code !== EXIT.waiting) return { last: r, rounds };
    const w = JSON.parse(r.out) as Waiting;
    rounds.push(w);
    if (w.stage === 'i3') return { last: r, rounds };
    const at = new Date(now.getTime() + 20_000).toISOString();
    for (const c of w.calls) appendCall(s.transcript, c.tool, c.input, s.n.answer(c.tool, c.input), at);
    for (const t of w.tasks) subagent(s.projects, t.prompt, reply(t.kind, t.prompt), at);
  }
  throw new Error(`init did not stop in 40 rounds: ${JSON.stringify(rounds[rounds.length - 1]).slice(0, 600)}`);
}

const cite = (at: string, quote: string) => ({ source: '01-notes.md', at, quote });
const DRAFT = {
  overview: {
    tldr: 'Customers order ahead and collect. The feature rows are the spec.',
    whatItIs: 'Customers order ahead and collect at the counter.',
    whoFor: ['customers collecting an order at the counter'],
    picture: [],
    links: [],
    cites: [cite('§1', 'Customers order ahead and collect at the counter.')],
  },
  features: [
    {
      name: 'Cancel an order',
      area: 'Ordering',
      whatItDoes: 'A customer calls off an order before it is made.',
      why: 'A customer who changes their mind should not pay for food nobody collects.',
      requirements: [
        {
          text: 'While the kitchen has not started an order, the customer can cancel it.',
          cite: cite('§2', 'A customer can cancel an order until the kitchen starts it.'),
        },
      ],
      edgeCases: [],
      notDoing: [],
      cite: cite('§2', 'A customer can cancel an order until the kitchen starts it.'),
    },
  ],
  contradictions: [],
  gaps: [
    {
      feature: 'Cancel an order',
      block: 'Behaviour',
      entity: 'whether a cancelled order is refunded, «Cancel an order»',
    },
  ],
  inventory: [{ cite: cite('§1', 'Customers order ahead and collect at the counter.'), lands: 'overview' }],
  directives: [],
};

const reply = (kind: string, prompt: string): unknown => {
  if (kind === 'init-drafter') return DRAFT;
  if (kind === 'faithfulness-checker') {
    const brief = readFile(/Read the brief: (\S+)/.exec(prompt)?.[1] ?? '');
    return {
      verdicts: [...brief.matchAll(/^<<<DATA (W\d+) ·/gm)].map((m) => ({ item: m[1], verdict: 'Clean', finding: '' })),
      directives: [],
    };
  }
  return challengeReply(kind, prompt);
};

void describe('bp init on a Notion target, through the relay', () => {
  void test('read, draft, stop, two databases, four views, rows, the overview once, check, challenge, close', () => {
    const s = setup('A note the owner wrote before the run.');
    const target = `https://www.notion.so/Pickup-${OVERVIEW}`;
    const a = drive(s, reply, ['--target', `notion:${target}`, '--source', s.notes]);
    assert.equal(a.last.code, EXIT.waiting, a.last.err + a.last.out);
    assert.equal((JSON.parse(a.last.out) as Waiting).stage, 'i3');
    // Nothing is created before the confirm: the run only read.
    assert.ok(
      s.n.log.every((c) => c.tool === 'notion-fetch'),
      JSON.stringify(s.n.log.map((c) => c.tool)),
    );

    say(s.transcript, 'Go ahead.', new Date(clock).toISOString());
    const ok = writeFile(join(tempDir('bp-reply-'), 'ok.md'), 'Go ahead.');
    const b = drive(s, reply, ['--reply', ok, '--decision', 'confirm']);
    assert.equal(b.last.code, EXIT.ok, b.last.err + b.last.out);

    // I4: two databases under the overview, Features first; Open Questions relates to it two-way.
    const dbs = s.n.log.filter((c) => c.tool === 'notion-create-database');
    assert.deepEqual(
      dbs.map((c) => c.input['title']),
      ['Features', 'Open Questions'],
    );
    assert.match(String(dbs[0]?.input['schema']), /"Area" SELECT\('Ordering':blue\)/);
    assert.match(String(dbs[1]?.input['schema']), /"Touches" RELATION\('[0-9a-f-]{36}', DUAL 'Questions'\)/);
    assert.match(
      String(dbs[1]?.input['schema']),
      /"Status" SELECT\('Open':gray, 'Answered':blue, 'Applied':green, 'Flagged':red, 'Closed \(not applied\)':brown, 'Rejected':default\)/,
    );
    assert.deepEqual(
      s.n.views.map((v) => v.name),
      ['Where things are', 'Unsent — packet candidates', 'Open questions', 'Decision log'],
    );
    // I5: the row, then the overview written once — a replace that re-emits both databases, the owner's note kept.
    const replace = s.n.log.filter((c) => c.input['command'] === 'replace_content');
    assert.equal(replace.length, 1);
    assert.equal(replace[0]?.input['allow_deleting_content'], undefined, 'never allowed to delete a child');
    const overview = s.n.page(OVERVIEW).content;
    assert.match(overview, /^## TL;DR\nCustomers order ahead and collect\. The feature rows are the spec\.$/m);
    assert.match(
      overview,
      /^## ⟳ Where things are\n<database url="[^"]+" inline="false" data-source-url="collection:\/\/[0-9a-f-]+">Features<\/database>$/m,
    );
    assert.match(overview, /^## ⟳ Open questions\n<database [^>]+>Open Questions<\/database>$/m);
    assert.match(overview, /^## Kept from the page as it was\nA note the owner wrote before the run\.$/m);
    assert.match(overview, /- \*\*Always-ask register/);
    const features = s.n.sources.find((d) => d.title === 'Features');
    assert.equal(features?.rows.length, 1);
    const row = s.n.page(features?.rows[0] ?? '');
    assert.equal(row.properties['Name'], 'Cancel an order');
    assert.match(row.content, /^FR-1 — While the kitchen has not started an order, the customer can cancel it\.$/m);
    // I7: every carried marker became a question row at Open — the feature's gap, the overview's missing picture —
    // with the operating-volume question nobody had asked; the markers point at their rows.
    const questions = s.n.sources.find((d) => d.title === 'Open Questions');
    assert.equal(questions?.rows.length, 3);
    assert.ok(questions?.rows.every((id) => s.n.page(id).properties['Status'] === 'Open'));
    // The front door is never patched after its one write: its gap stays carried, a row now asking it.
    assert.match(
      s.n.page(OVERVIEW).content,
      /\[NEEDS CLARIFICATION: the picture of how the product works — no source draws it → Question: carried\]/,
    );
    assert.match(s.n.page(features?.rows[0] ?? '').content, /→ Question: /);
    assert.doesNotMatch(s.n.page(features?.rows[0] ?? '').content, /→ Question: carried/);

    const log = readFile(join(s.home, 'record', 'run-log.md'));
    assert.match(
      log,
      /^- item: «Features» `d0000000-0000-0000-0000-000000000001` · created · 1 Area option\(s\) · read back$/m,
    );
    assert.match(log, /^- item: «overview» `0b1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9` · written once/m);
    assert.match(
      log,
      /^- closing: CLOSED \d{2}:\d{2} · HUMAN-BLOCKED · run totals: 1 feature row\(s\) · 3 question\(s\)/m,
    );
    const out = JSON.parse(b.last.out) as { report: string[] };
    assert.match(out.report.join('\n'), /^Created {4}2 databases · 4 views · 1 feature rows · overview written once$/m);
  });

  void test('a view the API refuses is printed with its filter and the error, and the run goes on', () => {
    const s = setup('');
    s.n.failView = 'Decision log';
    drive(s, reply, ['--target', `notion:${OVERVIEW}`, '--source', s.notes]);
    s.n.failView = '"Rejected"';
    say(s.transcript, 'Yes.', new Date(clock).toISOString());
    const ok = writeFile(join(tempDir('bp-reply-'), 'ok.md'), 'Yes.');
    const b = drive(s, reply, ['--reply', ok, '--decision', 'confirm']);
    assert.equal(b.last.code, EXIT.ok, b.last.err + b.last.out);
    assert.equal(s.n.views.length, 3);
    const out = (JSON.parse(b.last.out) as { report: string[] }).report.join('\n');
    assert.match(
      out,
      /^Views {6}not created — «Decision log» — FILTER "Status" IN \("Applied", "Closed \(not applied\)", "Rejected"\); SORT BY "Created" DESC — Invalid filter/m,
    );
    assert.match(
      readFile(join(s.home, 'record', 'run-log.md')),
      /^- CARRIED-FORWARD: view not created: «Decision log» .* · a human adds it in the UI$/m,
    );
  });

  void test('no connected overview page: halt with the setup checklist, and never create a substitute', () => {
    const s = setup('');
    s.n.pages.clear();
    const r = drive(s, reply, ['--target', `notion:${OVERVIEW}`, '--source', s.notes]);
    assert.equal(r.last.code, EXIT.halt, r.last.err + r.last.out);
    assert.match(r.last.err, /there is no connected overview page — the run never creates a substitute front door/);
    assert.ok(s.n.log.every((c) => c.tool === 'notion-fetch'));
  });

  void test('an overview that already carries the databases is a Blueprint that exists: /blueprint add', () => {
    const s = setup('');
    s.n.sources.push({
      url: 'collection://99999999-9999-4999-8999-999999999999',
      title: 'Features',
      schema: {},
      rows: [],
    });
    s.n.page(OVERVIEW).content =
      '<database url="https://app.notion.com/p/d9999999999999999999999999999999" inline="true" data-source-url="collection://99999999-9999-4999-8999-999999999999">Features</database>';
    const r = drive(s, reply, ['--target', `notion:${OVERVIEW}`, '--source', s.notes]);
    assert.equal(r.last.code, EXIT.halt, r.last.err + r.last.out);
    assert.match(r.last.err, /this Blueprint exists; adding material to it is \/blueprint add/);
  });
});
