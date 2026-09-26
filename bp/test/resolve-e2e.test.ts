import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, SKILL_ROOT } from './support/index.ts';
import { cpSync } from 'node:fs';

// `bp resolve` end to end on a local Blueprint, with the writer and the check answered by simulated subagents: each
// answer is written into a subagent transcript whose first message carries the task's nonce, exactly as a real
// dispatch leaves it. Expected texts are hand-written from resolve.md R3–R5 and doc-shape §5.

const SID = 'sess-resolve-e2e-0001';

function skillRoot(): string {
  // A copy of the real skill's rubrics beside a VERSION of 38, so the briefs can name rubric files that exist.
  const root = fakeSkillRoot(38);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return root;
}

const FEATURE = `---
name: Checkout
what_it_does: A customer pays for the order in their basket and gets a confirmation.
area: Ordering
questions: [q-01]
created: 2026-08-04
---

## Why
Customers need to pay without friction.
## Behaviour
FR-1 — When a customer confirms the basket, the system takes payment.
FR-2 — After payment the system shows a confirmation. [NEEDS CLARIFICATION: how long the confirmation stays on screen → Question: q-01]
## Edge cases
- A failed payment leaves the basket as it was.
## Rabbit holes
## Not doing
- No cash on delivery — because the team cannot reconcile it; revisit if a partner offers it.
`;

const QUESTIONS = `### q-01 · How long does the confirmation stay on screen?
- **Status:** Answered
- **Owner:**
- **Touches:** Checkout
- **Why asked:** FR-2 names a confirmation and no source says how long it stays. · depth 1
- **Suggested directions:** 1. Five seconds, then the home screen. Why: short. Counter-case: too fast to read.
2. Until the customer taps. Why: control. Counter-case: one more tap.
- **Created:** 2026-09-20

**Answer & why:** 1
`;

function blueprint(): { ws: string; doc: string; home: string; projects: string } {
  const ws = tempDir('bp-resolve-ws-');
  const home = join(ws, '.blueprint');
  const doc = join(ws, 'doc');
  mkdirSync(join(home, 'record'), { recursive: true });
  writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${doc}\n`);
  writeFile(
    join(doc, 'README.md'),
    '## TL;DR\nA shop.\n## Operating\n- **Always-ask register (2026-08-04):** minors, regulatory applicability.\n',
  );
  writeFile(join(doc, 'features', '01-checkout.md'), FEATURE);
  writeFile(join(doc, 'questions.md'), QUESTIONS);
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  return { ws, doc, home, projects };
}

interface Waiting {
  status: string;
  tasks: { id: string; kind: string; prompt: string }[];
}

function answer(projects: string, prompt: string, n: number, reply: unknown): void {
  const tag = /bp-task:[\w-]+:[0-9a-f]+/.exec(prompt)?.[0];
  assert.ok(tag, 'the prompt carries a task nonce');
  const lines = [
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: prompt } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: n % 2 ? 'model-writer' : 'model-checker',
        content: [
          { type: 'tool_use', id: `t${n}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
        ],
      },
    }),
  ];
  writeFile(join(projects, 'proj', SID, 'subagents', `agent-${n}.jsonl`), `${lines.join('\n')}\n`);
}

const env = (b: { projects: string }) => ({ CLAUDE_CODE_SESSION_ID: SID, HOME: join(b.projects, '..', '..') });

void describe('bp resolve on a local Blueprint', () => {
  void test('a pointer answer is written by the writer, checked, applied and logged', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = () => run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });

    const r1 = go();
    assert.equal(r1.code, EXIT.waiting, r1.err);
    const w1 = JSON.parse(r1.out) as Waiting;
    assert.equal(w1.tasks.length, 1);
    assert.equal(w1.tasks[0]?.kind, 'writer');
    assert.match(w1.tasks[0]?.prompt ?? '', /rubrics\/resolve-writer\.md/);

    answer(b.projects, w1.tasks[0]?.prompt ?? '', 1, {
      output: 'delta',
      block: 'Behaviour',
      changes: [
        { fr: 2, text: 'After payment the system shows a confirmation for five seconds, then the home screen.' },
      ],
      groundingKind: 'direction 1 on that row, chosen by the answer',
      removesMarker: true,
      directives: [],
    });
    const r2 = go();
    assert.equal(r2.code, EXIT.waiting, r2.err);
    const w2 = JSON.parse(r2.out) as Waiting;
    assert.equal(w2.tasks[0]?.kind, 'checker');

    answer(b.projects, w2.tasks[0]?.prompt ?? '', 2, {
      verdicts: [{ target: 'FR-2', verdict: 'Clean', inconsistency: '', answerQuote: '1' }],
      directives: [],
    });
    const r3 = go();
    assert.equal(r3.code, EXIT.ok, r3.err + r3.out);

    const body = readFile(join(b.doc, 'features', '01-checkout.md'));
    const today = '2026-09-25';
    assert.ok(
      body.includes(
        // The old sentence survives inside the new one, so the change is additive: no "replaces" clause (R3.2).
        `FR-2 — After payment the system shows a confirmation for five seconds, then the home screen.\n*(Applied ${today} from «How long does the confirmation stay on screen?» **\`q-01\`** · depth 1 — direction 1 on that row, chosen by the answer.)*\n## Edge cases`,
      ),
      body,
    );
    assert.ok(!body.includes('NEEDS CLARIFICATION'), "the row's own marker is removed with the write");
    assert.ok(body.includes('FR-1 — When a customer confirms the basket, the system takes payment.'), 'FR-1 untouched');

    const q = readFile(join(b.doc, 'questions.md'));
    assert.match(q, /- \*\*Status:\*\* Applied/);

    const logText = readFile(join(b.home, 'record', 'run-log.md'));
    assert.match(logText, /^## \d{4}-\d{2}-\d{2} · \d{2}:\d{2} · resolve · run [0-9a-f]{6} · skill v38 · sitting 1$/m);
    assert.match(
      logText,
      /^- item: «How long does the confirmation stay on screen\?» `q-01` · Clean · «Checkout» FR-2 · body [0-9a-f]{12}$/m,
    );
    assert.match(logText, /^- MARKERS: 1 removed, rows `q-01` cited$/m);
    assert.match(logText, /^- GATE: 1 applied, 0 returned$/m);
    assert.match(logText, /^- HASHES: «Checkout» [0-9a-f]{12}$/m);
    assert.match(logText, /^- closing: CLOSED \d{2}:\d{2} · DRAINED · run totals: 1 applied · 0 flagged · 1 sitting$/m);
    // check lines go to runs/, never the log (R5)
    assert.doesNotMatch(logText, /^- check:/m);
    const runs = readdirSync(join(b.home, 'record', 'runs'));
    assert.equal(runs.length, 1);
  });

  void test('a bad pointer is flagged at R2.1 with its fix, and nothing is dispatched', () => {
    const b = blueprint();
    writeFile(join(b.doc, 'questions.md'), QUESTIONS.replace('**Answer & why:** 1', '**Answer & why:** 1 or 2'));
    const r = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: skillRoot(), workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    const q = readFile(join(b.doc, 'questions.md'));
    assert.match(q, /- \*\*Status:\*\* Flagged/);
    assert.match(q, /- \*\*Why flagged:\*\* "1 or 2" names more than one direction/);
    const logText = readFile(join(b.home, 'record', 'run-log.md'));
    assert.match(
      logText,
      /^- FLAGGED: «How long does the confirmation stay on screen\?» `q-01` · "1 or 2" names more than one direction/m,
    );
    assert.match(logText, /· HUMAN-BLOCKED ·/);
  });

  void test('soft mode keeps a superseding answer: nothing is written and the row ends Flagged', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = () =>
      run(['resolve', '--soft', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    const w1 = JSON.parse(go().out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', 1, {
      output: 'delta',
      block: 'Behaviour',
      changes: [{ fr: 2, text: 'After payment the system shows a toast instead.' }],
      groundingKind: 'direction 1 on that row, chosen by the answer',
      removesMarker: true,
      directives: [],
    });
    const r2 = run(['resolve', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    // soft is decided before any check (R3.6): no checker task is dispatched for a replacement
    assert.equal(r2.code, EXIT.ok, r2.err + r2.out);
    const body = readFile(join(b.doc, 'features', '01-checkout.md'));
    assert.equal(body, FEATURE);
    assert.match(readFile(join(b.doc, 'questions.md')), /- \*\*Status:\*\* Flagged/);
  });
});
