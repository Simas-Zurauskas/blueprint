import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, SKILL_ROOT } from './support/index.ts';

// resolve.md R3.1's project-level path and overview route, end to end on a local Blueprint. Subagents are simulated by
// writing each answer into a subagent transcript whose first message carries the task's nonce. Expected texts are
// hand-written from resolve.md R3.1 (rounds one and two), R4 and doc-shape §3.

const SID = 'sess-project-e2e-0001';

function skillRoot(): string {
  const root = fakeSkillRoot(38);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return root;
}

const feature = (name: string, area: string, fr: string): string => `---
name: ${name}
what_it_does: ${name} for the club.
area: ${area}
questions: []
created: 2026-08-04
---

## Why
Members need it.
## Behaviour
FR-1 — ${fr}
## Edge cases
## Rabbit holes
## Not doing
- No paper forms — because the club is online; revisit if a member asks.
`;

const README = `## TL;DR
A lantern club.
## What this product is
A club that lends lanterns to its members. It is not a shop.
## Operating
- Run record: the Blueprint run log.
`;

const question = (o: {
  status: string;
  answer: string;
  whyAsked?: string;
}): string => `### q-01 · Is the club app only for members?
- **Status:** ${o.status}
- **Owner:**
- **Touches:**
- **Why asked:** ${o.whyAsked ?? 'No source says who may use it. · depth 1'}
- **Created:** 2026-09-20

**Answer & why:** ${o.answer}
`;

function blueprint(q: string): { ws: string; doc: string; home: string; projects: string } {
  const ws = tempDir('bp-proj-ws-');
  const home = join(ws, '.blueprint');
  const doc = join(ws, 'doc');
  mkdirSync(join(home, 'record'), { recursive: true });
  writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${doc}\n`);
  writeFile(join(doc, 'README.md'), README);
  writeFile(
    join(doc, 'features', '01-borrow.md'),
    feature('Borrow a lantern', 'Lending', 'When a member taps Borrow, the system reserves a lantern.'),
  );
  writeFile(
    join(doc, 'features', '02-return.md'),
    feature('Return a lantern', 'Lending', 'When a member returns a lantern, the system frees it.'),
  );
  writeFile(join(doc, 'questions.md'), q);
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  return { ws, doc, home, projects };
}

interface Waiting {
  tasks: { id: string; kind: string; prompt: string }[];
}

let agentN = 0;
function answer(projects: string, prompt: string, reply: unknown): void {
  const tag = /bp-task:[\w-]+:[0-9a-f]+/.exec(prompt)?.[0];
  assert.ok(tag, 'the prompt carries a task nonce');
  agentN += 1;
  const lines = [
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: prompt } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'model-x',
        content: [
          { type: 'tool_use', id: `t${agentN}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
        ],
      },
    }),
  ];
  writeFile(join(projects, 'proj', SID, 'subagents', `agent-p${agentN}.jsonl`), `${lines.join('\n')}\n`);
}

const env = (b: { projects: string }) => ({ CLAUDE_CODE_SESSION_ID: SID, HOME: join(b.projects, '..', '..') });
const CLEAN = (target: string) => ({
  verdicts: [{ target, verdict: 'Clean', inconsistency: '', answerQuote: 'members only' }],
  directives: [],
});

void describe('bp resolve — a project-level row (Touches empty)', () => {
  void test('a footprint of two features: each write is checked and pushed, and the row is Applied once both land', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests, anywhere in the app.' }));
    const root = skillRoot();
    const go = () => run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });

    const w1 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w1.tasks.map((t) => t.kind),
      ['project-writer'],
    );
    assert.match(w1.tasks[0]?.prompt ?? '', /rubrics\/resolve-project-writer\.md/);
    const notDoing = (name: string) => ({
      feature: name,
      delta: {
        block: 'Not doing',
        lines: [
          '- No paper forms — because the club is online; revisit if a member asks.',
          '- No guest access — because the club is for members only.',
        ],
        groundingKind: 'answer and reasoning on that row',
        removesMarker: false,
        directives: [],
      },
    });
    answer(b.projects, w1.tasks[0]?.prompt ?? '', {
      output: 'features',
      writes: [notDoing('Borrow a lantern'), notDoing('Return a lantern')],
      directives: [],
    });

    // Each feature write goes to its own check (the two features are independent, so both are owed at once).
    const w2 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['checker', 'checker'],
    );
    for (const t of w2.tasks) answer(b.projects, t.prompt, CLEAN('Not doing line'));

    const r3 = go();
    assert.equal(r3.code, EXIT.ok, r3.err + r3.out);
    for (const file of ['01-borrow.md', '02-return.md']) {
      const body = readFile(join(b.doc, 'features', file));
      assert.match(
        body,
        /^- No guest access — because the club is for members only\.\n\*\(Applied \d{4}-\d{2}-\d{2} from «Is the club app only for members\?» \*\*`q-01`\*\* · depth 1 — answer and reasoning on that row\.\)\*$/m,
        file,
      );
      assert.match(
        body,
        /^- No paper forms — because the club is online; revisit if a member asks\.$/m,
        `${file}: the unchanged line keeps its place`,
      );
    }
    assert.match(readFile(join(b.doc, 'questions.md')), /- \*\*Status:\*\* Applied/);
    const logText = readFile(join(b.home, 'record', 'run-log.md'));
    assert.match(
      logText,
      /^- item: «Is the club app only for members\?» `q-01` · Clean · «Borrow a lantern» Not doing line · body [0-9a-f]{12}$/m,
    );
    assert.match(
      logText,
      /^- item: «Is the club app only for members\?» `q-01` · Clean · «Return a lantern» Not doing line · body [0-9a-f]{12}$/m,
    );
    assert.match(logText, /^- GATE: 1 applied, 0 returned$/m);
  });

  void test("a write outside the row's Touches is sent back to the writer once, never written", () => {
    const b = blueprint(
      question({ status: 'Answered', answer: 'Members only.' }).replace(
        '- **Touches:**',
        '- **Touches:** Borrow a lantern, Return a lantern',
      ),
    );
    writeFile(
      join(b.doc, 'features', '03-slot.md'),
      feature('Pick a slot', 'Lending', 'When a member picks a slot, the system holds it.'),
    );
    const root = skillRoot();
    const go = () => run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    const w1 = JSON.parse(go().out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', {
      output: 'features',
      writes: [
        {
          feature: 'Pick a slot',
          delta: {
            block: 'Not doing',
            lines: ['- No guests.'],
            groundingKind: 'answer and reasoning on that row',
            removesMarker: false,
            directives: [],
          },
        },
      ],
      directives: [],
    });
    const w2 = JSON.parse(go().out) as Waiting;
    assert.equal(w2.tasks[0]?.kind, 'project-writer');
    assert.match(
      readFile(w2.tasks[0]?.prompt.match(/Read the brief: (\S+)/)?.[1] ?? ''),
      /«Pick a slot» is outside its scope/,
    );
    assert.doesNotMatch(readFile(join(b.doc, 'features', '03-slot.md')), /No guests/);
  });
});

void describe('bp resolve — the overview route (R3.1 rounds one and two)', () => {
  const OPERATING =
    '- Run record: the Blueprint run log.\n- Audience (2026-09-25): members only; no guest access anywhere.';

  function roundOne(b: ReturnType<typeof blueprint>, root: string): string {
    const go = () => run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    const w1 = JSON.parse(go().out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', {
      output: 'overview',
      block: 'Operating',
      text: OPERATING,
      directives: [],
    });
    const w2 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['overview-checker'],
    );
    answer(b.projects, w2.tasks[0]?.prompt ?? '', CLEAN('overview «Operating»'));
    const r = go();
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    return readFile(join(b.home, 'record', 'run-log.md'));
  }

  void test('round one proposes, appends to Why asked, pins, flags — and never writes the front door', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests.' }));
    const logText = roundOne(b, skillRoot());
    assert.equal(readFile(join(b.doc, 'README.md')), README, 'the overview is untouched');
    const q = readFile(join(b.doc, 'questions.md'));
    assert.match(q, /- \*\*Status:\*\* Flagged/);
    // Appended, never replacing: the original Why asked is still there, the proposal after it.
    assert.match(
      q,
      /- \*\*Why asked:\*\* No source says who may use it\. · depth 1\n {2}Proposed block text \(run [0-9a-f]{6}, \d{4}-\d{2}-\d{2} — the overview's «Operating» block as it would read\):\n {2}## Operating\n {2}- Run record: the Blueprint run log\.\n {2}- Audience \(2026-09-25\): members only; no guest access anywhere\.\n/,
    );
    assert.match(
      logText,
      /^- FLAGGED: «Is the club app only for members\?» `q-01` · the front door needs your acceptance: .* · proposal [0-9a-f]{12} · Answer & why hash at flag [0-9a-f]{12}$/m,
    );
  });

  void test('round two: the move back to Answered accepts the pinned proposal, and the block is written', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests.' }));
    const root = skillRoot();
    roundOne(b, root);
    const qPath = join(b.doc, 'questions.md');
    writeFile(qPath, readFile(qPath).replace('- **Status:** Flagged', '- **Status:** Answered'));
    const r = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    assert.equal(
      readFile(join(b.doc, 'README.md')),
      README.replace('- Run record: the Blueprint run log.\n', `${OPERATING}\n`),
    );
    assert.match(readFile(qPath), /- \*\*Status:\*\* Applied/);
    assert.match(
      readFile(qPath),
      /\*\*Answer & why:\*\* Members only — no guests\./,
      "the human's answer is left as they wrote it",
    );
  });

  void test('round two: an answer rewritten with its own block text is a substitution, and that text is written', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests.' }));
    const root = skillRoot();
    roundOne(b, root);
    const qPath = join(b.doc, 'questions.md');
    const mine = 'Mine instead:\n## Operating\n- Run record: the Blueprint run log.\n- Audience: members only.';
    writeFile(
      qPath,
      readFile(qPath)
        .replace('- **Status:** Flagged', '- **Status:** Answered')
        .replace('**Answer & why:** Members only — no guests.', `**Answer & why:** ${mine}`),
    );
    const r = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    assert.match(
      readFile(join(b.doc, 'README.md')),
      /## Operating\n- Run record: the Blueprint run log\.\n- Audience: members only\.\n$/,
    );
  });

  void test('round two: an answer changed with no block text accepts nothing — the row is flagged, the overview untouched', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests.' }));
    const root = skillRoot();
    roundOne(b, root);
    const qPath = join(b.doc, 'questions.md');
    writeFile(
      qPath,
      readFile(qPath)
        .replace('- **Status:** Flagged', '- **Status:** Answered')
        .replace('**Answer & why:** Members only — no guests.', '**Answer & why:** yes, fine'),
    );
    const r = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    assert.equal(readFile(join(b.doc, 'README.md')), README);
    assert.match(
      readFile(qPath),
      /- \*\*Why flagged:\*\* Answer & why changed since the flag but carries no block text/,
    );
  });

  void test('round two: a proposal edited under its pin is proposed again, never written off a hash it cannot match', () => {
    const b = blueprint(question({ status: 'Answered', answer: 'Members only — no guests.' }));
    const root = skillRoot();
    roundOne(b, root);
    const qPath = join(b.doc, 'questions.md');
    writeFile(
      qPath,
      readFile(qPath)
        .replace('- **Status:** Flagged', '- **Status:** Answered')
        .replace('members only; no guest access anywhere.', 'members and their guests.'),
    );
    const r = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.waiting, r.err + r.out);
    assert.deepEqual(
      (JSON.parse(r.out) as Waiting).tasks.map((t) => t.kind),
      ['project-writer'],
    );
    assert.equal(readFile(join(b.doc, 'README.md')), README);
  });
});
