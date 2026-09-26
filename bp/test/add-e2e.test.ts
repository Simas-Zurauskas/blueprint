import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, SKILL_ROOT } from './support/index.ts';
import { challengeReply } from './support/challenge-replies.ts';

// `bp add` end to end on a local Blueprint (add.md A1–A5). The drafter and the faithfulness check are simulated subagents:
// each answer is written into a subagent transcript whose first message carries the task's nonce. Expected body text is
// hand-written from add.md A4 and doc-shape §5 and §9.

const SID = 'sess-add-e2e-00001';

const CHECKOUT = `---
name: Checkout
what_it_does: A customer pays for the order and gets a confirmation.
area: Ordering
questions: []
created: 2026-08-04
---

## Why
Customers need to pay without friction.
## Behaviour
FR-1 — When a customer confirms the basket, the system takes payment by card.
FR-2 — After payment the system shows a confirmation. [NEEDS CLARIFICATION: how long the confirmation stays on screen, «Checkout» FR-2 → Question: carried]
## Edge cases
- A failed payment leaves the basket as it was.
## Rabbit holes
## Not doing
- No cash on delivery — because the team cannot reconcile it.
`;

const CALL = `Client call, 2026-09-24
09:05 — The confirmation stays up for five seconds, then the home screen.
12:30 — Actually we take payment when the order is collected, not at the basket.
20:00 — We also need refunds: a manager approves a refund and the money goes back to the card.
31:00 — The overview should say plainly that we never deliver.
`;

function blueprint(): { ws: string; doc: string; home: string; projects: string; call: string } {
  const ws = tempDir('bp-add-ws-');
  const home = join(ws, '.blueprint');
  const doc = join(ws, 'doc');
  mkdirSync(join(home, 'record'), { recursive: true });
  writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${doc}\n`);
  writeFile(
    join(doc, 'README.md'),
    '## TL;DR\nA pickup shop.\n## What this product is\nCustomers order ahead and collect. It is not a delivery service.\n## Operating\n- Run record: the run log.\n',
  );
  writeFile(join(doc, 'features', '01-checkout.md'), CHECKOUT);
  writeFile(join(doc, 'questions.md'), '');
  const call = writeFile(join(tempDir('bp-given-'), 'call.md'), CALL);
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  return { ws, doc, home, projects, call };
}

function skillRoot(): string {
  const root = fakeSkillRoot(39);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return root;
}

interface Waiting {
  status: string;
  tasks: { id: string; kind: string; prompt: string }[];
  printed?: string[];
}

let agents = 0;
function answer(projects: string, prompt: string, reply: unknown): void {
  const tag = /bp-task:[\w-]+:[0-9a-f]+/.exec(prompt)?.[0];
  assert.ok(tag, 'the prompt carries a task nonce');
  agents += 1;
  writeFile(
    join(projects, 'proj', SID, 'subagents', `agent-a${agents}.jsonl`),
    `${[
      JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: prompt } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: agents % 2 ? 'model-drafter' : 'model-checker',
          content: [
            { type: 'tool_use', id: `a${agents}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}

const env = (b: { projects: string }) => ({ CLAUDE_CODE_SESSION_ID: SID, HOME: join(b.projects, '..', '..') });

/** Answer the challenge handoff's tasks (A5) until the run closes; returns the final result. */
function finishHandoff(
  b: { projects: string },
  go: () => { code: number; out: string; err: string },
): { code: number; out: string; err: string } {
  for (let i = 0; i < 12; i++) {
    const r = go();
    if (r.code !== EXIT.waiting) return r;
    const w = JSON.parse(r.out) as Waiting;
    for (const t of w.tasks) answer(b.projects, t.prompt, challengeReply(t.kind, t.prompt));
  }
  throw new Error('the challenge handoff did not finish');
}
const cite = (at: string, quote: string) => ({ source: '01-call.md', at, quote });

const DRAFT = {
  inventory: [
    {
      cite: cite('09:05', 'The confirmation stays up for five seconds, then the home screen.'),
      lands: 'feature',
      target: 'Checkout',
    },
    {
      cite: cite('12:30', 'we take payment when the order is collected, not at the basket.'),
      lands: 'feature',
      target: 'Checkout',
    },
    {
      cite: cite('20:00', 'a manager approves a refund and the money goes back to the card.'),
      lands: 'new-feature',
      target: 'Refunds',
    },
    {
      cite: cite('31:00', 'The overview should say plainly that we never deliver.'),
      lands: 'overview',
      target: 'What this product is',
    },
  ],
  changes: [
    {
      feature: 'Checkout',
      delta: {
        block: 'Behaviour',
        changes: [{ fr: 1, text: 'When a customer collects the order, the system takes payment by card.' }],
        groundingKind: 'the source moves payment to collection',
        removesMarker: false,
        directives: [],
      },
      cite: cite('12:30', 'we take payment when the order is collected, not at the basket.'),
      supersedes: { target: 'FR-1', old: 'When a customer confirms the basket, the system takes payment by card.' },
    },
    {
      feature: 'Checkout',
      delta: {
        block: 'Behaviour',
        changes: [
          { fr: 2, text: 'After payment the system shows a confirmation for five seconds, then the home screen.' },
        ],
        groundingKind: 'the source states how long the confirmation stays',
        removesMarker: false,
        directives: [],
      },
      cite: cite('09:05', 'The confirmation stays up for five seconds, then the home screen.'),
      settles: ['how long the confirmation stays on screen'],
    },
  ],
  newFeatures: [
    {
      name: 'Refunds',
      area: 'Ordering',
      whatItDoes: 'A manager returns a customer’s payment.',
      why: 'A customer who is owed money needs it back.',
      fr1: 'When a manager approves a refund, the system returns the payment to the card.',
      notDoing: [],
      cite: cite('20:00', 'a manager approves a refund and the money goes back to the card.'),
    },
  ],
  overview: [
    {
      block: 'What this product is',
      text: 'Customers order ahead and collect. It never delivers.',
      question: "Should the overview's product paragraph say that it never delivers?",
      cite: cite('31:00', 'The overview should say plainly that we never deliver.'),
    },
  ],
  conflicts: [],
  gaps: [
    {
      feature: 'Refunds',
      block: 'Behaviour',
      fr: null,
      entity: 'how long a refund takes to reach the card, «Refunds»',
    },
  ],
  directives: [],
};

function wItems(briefPath: string): { id: string; where: string }[] {
  return [...readFile(briefPath).matchAll(/^<<<DATA (W\d+) · (.*?) · cited:/gm)].map((m) => ({
    id: m[1] ?? '',
    where: m[2] ?? '',
  }));
}

void describe('bp add — force, the default', () => {
  void test('captures, drafts, states, writes block by block, checks, and closes', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });

    const r1 = go(['--source', b.call]);
    assert.equal(r1.code, EXIT.waiting, r1.err + r1.out);
    const w1 = JSON.parse(r1.out) as Waiting;
    assert.deepEqual(
      w1.tasks.map((t) => t.kind),
      ['add-drafter'],
    );
    // A1: captured verbatim and hashed before anything is interpreted.
    const runs = readdirSync(join(b.home, 'sources'));
    assert.equal(runs.length, 1);
    assert.equal(readFile(join(b.home, 'sources', runs[0] ?? '', '01-call.md')), CALL);
    assert.match(
      readFile(join(b.home, 'sources', runs[0] ?? '', 'MANIFEST.md')),
      /\| 1 \| `01-call\.md` \| file: .*call\.md \| \d+ \| `[0-9a-f]{64}` \|/,
    );

    answer(b.projects, w1.tasks[0]?.prompt ?? '', DRAFT);
    const r2 = go();
    assert.equal(r2.code, EXIT.waiting, r2.err + r2.out);
    const w2 = JSON.parse(r2.out) as Waiting;
    // A3 printed once, and did not wait: the writes are already made.
    assert.ok(
      w2.printed?.some((l) => /^BLUEPRINT ADD — mode: force \(the default; source wins\) · about to write$/.test(l)),
      JSON.stringify(w2.printed),
    );
    assert.ok(w2.printed?.some((l) => /SUPERSEDES «Checkout» FR-1 — call 12:30 contradicts it/.test(l)));
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['faithfulness-checker'],
    );

    const body = readFile(join(b.doc, 'features', '01-checkout.md'));
    // A4 step 5: superseded in place, the number kept, the replaced text quoted on the line.
    assert.match(
      body,
      /^FR-1 — When a customer collects the order, the system takes payment by card\.\n\*\(Superseded \d{4}-\d{2}-\d{2} from «call 12:30» · depth 1 — previously: "When a customer confirms the basket, the system takes payment by card\."\.\)\*$/m,
    );
    // The second write to the same block was built on the first's result; route 8 removed the marker the source answers.
    assert.match(
      body,
      /^FR-2 — After payment the system shows a confirmation for five seconds, then the home screen\.\n\*\(Added \d{4}-\d{2}-\d{2} from «call 09:05» · depth 1 — the source states how long the confirmation stays\.\)\*$/m,
    );
    assert.doesNotMatch(body, /NEEDS CLARIFICATION/);
    // A new feature, with its skeleton, a sourced FR-1, and the gap as a carried marker.
    const refunds = readFile(join(b.doc, 'features', '02-refunds.md'));
    assert.match(refunds, /^name: Refunds$/m);
    assert.match(
      refunds,
      /^FR-1 — When a manager approves a refund, the system returns the payment to the card\.\n\*\(Added .* from «call 20:00» · depth 1 — written from the source\.\)\*\n\[NEEDS CLARIFICATION: how long a refund takes to reach the card, «Refunds» → Question: carried\]$/m,
    );
    // A4 step 6: the overview is never written; its draft is a project-level question row at Open.
    assert.equal(readFile(join(b.doc, 'README.md')).includes('It never delivers'), false);
    const q = readFile(join(b.doc, 'questions.md'));
    assert.match(q, /^### q-01 · Should the overview's product paragraph say that it never delivers\?$/m);
    assert.match(q, /- \*\*Status:\*\* Open/);
    assert.match(q, /^ {2}## What this product is\n {2}Customers order ahead and collect\. It never delivers\.$/m);

    // A5: the check narrows one claim; bp applies it in place with its own provenance line.
    const brief = w2.tasks[0]?.prompt.match(/Read the brief: (\S+)/)?.[1] ?? '';
    const items = wItems(brief);
    assert.deepEqual(
      items.map((i) => i.where),
      ['«Refunds» (created)', '«Checkout» Behaviour', '«Checkout» Behaviour'],
    );
    answer(b.projects, w2.tasks[0]?.prompt ?? '', {
      verdicts: items.map((it, i) =>
        i === 1
          ? {
              item: it.id,
              verdict: 'Patched — narrowed',
              finding: 'the source does not say by card',
              edit: { block: 'Behaviour', old: 'the system takes payment by card.', new: 'the system takes payment.' },
            }
          : { item: it.id, verdict: 'Clean', finding: '' },
      ),
      directives: [],
    });
    const r3 = finishHandoff(b, go);
    assert.equal(r3.code, EXIT.ok, r3.err + r3.out);
    const narrowed = readFile(join(b.doc, 'features', '01-checkout.md'));
    assert.match(
      narrowed,
      /^FR-1 — When a customer collects the order, the system takes payment\.\n\*\(Superseded .*\)\*\n\*\(Narrowed \d{4}-\d{2}-\d{2} by the faithfulness check · depth 1 — the source does not say by card\.\)\*$/m,
    );

    const logText = readFile(join(b.home, 'record', 'run-log.md'));
    assert.match(logText, /^## \d{4}-\d{2}-\d{2} · \d{2}:\d{2} · add · run [0-9a-f]{6} · skill v39 · sitting 1$/m);
    assert.match(logText, /^- header: .* · mode: force$/m);
    assert.match(
      logText,
      /^- CON-1: «Checkout» FR-1 · 01-call\.md 12:30 vs «Checkout» FR-1 · quotes at sources\/[0-9a-f]{6}\/contradictions\.md · superseded at A4 step 5/m,
    );
    assert.match(logText, /^- VERDICTS: A5 \d+ checked · \d+ Clean · 1 narrowed · 0 removed · 0 Flagged/m);
    assert.match(logText, /^- MARKERS: 1 minted, carried for the challenge handoff · 1 removed \(route 8\)/m);
    assert.match(logText, /^- closing: CLOSED \d{2}:\d{2} · HUMAN-BLOCKED · run totals: /m);
    // No client quote in record/: the verbatim spans are in the source record.
    assert.doesNotMatch(logText, /take payment when the order is collected/);
    assert.match(
      readFile(join(b.home, 'sources', runs[0] ?? '', 'contradictions.md')),
      /we take payment when the order is collected/,
    );
  });

  void test('a quote not found in its source is refused: the draft is sent back once, then the item is dropped, never written', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const bad = {
      ...DRAFT,
      overview: [],
      newFeatures: [],
      gaps: [],
      changes: [{ ...DRAFT.changes[1], cite: cite('09:05', 'The confirmation stays up for ten seconds.') }],
    };
    const w1 = JSON.parse(go(['--source', b.call]).out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', bad);
    const w2 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['add-drafter'],
      'sent back once',
    );
    assert.match(
      readFile(w2.tasks[0]?.prompt.match(/Read the brief: (\S+)/)?.[1] ?? ''),
      /the quote "The confirmation stays up for ten seconds\.…" is not in 01-call\.md verbatim/,
    );
    answer(b.projects, w2.tasks[0]?.prompt ?? '', bad);
    const r3 = finishHandoff(b, go);
    assert.equal(r3.code, EXIT.ok, r3.err + r3.out);
    // add wrote nothing; its challenge handoff transcribed the carried marker into a row and patched it (Q4: one act).
    assert.equal(
      readFile(join(b.doc, 'features', '01-checkout.md')),
      CHECKOUT.replace('→ Question: carried]', '→ Question: q-01]'),
    );
    assert.match(readFile(join(b.doc, 'questions.md')), /^### q-01 · /m);
    assert.match(
      readFile(join(b.home, 'record', 'run-log.md')),
      /^- citation: not matched — change to «Checkout» \(01-call\.md 09:05\) · dropped, never written/m,
    );
  });

  void test('a change the planner would refuse is sent back once with the refusal, and the corrected draft is written', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const change = DRAFT.changes[1];
    assert.ok(change);
    const good = { ...DRAFT, overview: [], newFeatures: [], gaps: [], changes: [change] };
    // `why` outside a seed: «Checkout» already has numbered requirements and a Why paragraph (resolve/apply.ts).
    const bad = { ...good, changes: [{ ...change, delta: { ...change.delta, why: 'The source says how long.' } }] };
    const w1 = JSON.parse(go(['--source', b.call]).out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', bad);
    const w2 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['add-drafter'],
      'sent back once, before the draft is spent',
    );
    assert.match(
      readFile(w2.tasks[0]?.prompt.match(/Read the brief: (\S+)/)?.[1] ?? ''),
      /change 1 \(«Checkout»\) Behaviour: `why` is written only by a seed/,
    );
    answer(b.projects, w2.tasks[0]?.prompt ?? '', good);
    const r3 = go();
    assert.equal(r3.code, EXIT.waiting, r3.err + r3.out);
    const w3 = JSON.parse(r3.out) as Waiting;
    assert.ok(!w3.printed?.some((l) => /not written/.test(l)), JSON.stringify(w3.printed));
    assert.match(
      readFile(join(b.doc, 'features', '01-checkout.md')),
      /^FR-2 — After payment the system shows a confirmation for five seconds, then the home screen\.$/m,
    );
  });

  void test('a block delta that leaves out a line it does not supersede, or a second delta to one block, is sent back once', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const kept = '- No cash on delivery — because the team cannot reconcile it.';
    const added = '- No delivery — the product is collection only.';
    const notDoing = (lines: string[]) => ({
      feature: 'Checkout',
      delta: {
        block: 'Not doing',
        lines,
        groundingKind: 'the source rules out delivery',
        removesMarker: false,
        directives: [],
      },
      cite: cite('31:00', 'The overview should say plainly that we never deliver.'),
    });
    const base = { ...DRAFT, overview: [], newFeatures: [], gaps: [] };
    // Only the added line, as if `lines` were an append: the existing exclusion would be deleted.
    const bad = { ...base, changes: [notDoing([added]), notDoing([kept, '- No delivery slots.'])] };
    const w1 = JSON.parse(go(['--source', b.call]).out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', bad);
    const w2 = JSON.parse(go().out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['add-drafter'],
      'sent back once, before anything is written',
    );
    const brief = readFile(w2.tasks[0]?.prompt.match(/Read the brief: (\S+)/)?.[1] ?? '');
    assert.match(
      brief,
      /change 1 \(«Checkout»\) Not doing: leaves out or rewords 1 existing Not doing line it does not declare superseded, first "- No cash on delivery/,
    );
    assert.match(brief, /change 2 \(«Checkout»\) Not doing: change 1 already writes this block/);
    answer(b.projects, w2.tasks[0]?.prompt ?? '', { ...base, changes: [notDoing([kept, added])] });
    const r3 = go();
    assert.equal(r3.code, EXIT.waiting, r3.err + r3.out);
    const w3 = JSON.parse(r3.out) as Waiting;
    assert.ok(!w3.printed?.some((l) => /not written/.test(l)), JSON.stringify(w3.printed));
    const body = readFile(join(b.doc, 'features', '01-checkout.md'));
    assert.ok(body.includes(kept), body);
    assert.ok(body.includes(added), body);

    // The same mistake twice: the second draft is not sent back again, and the delta is reported, never written.
    const c = blueprint();
    const goC = (extra: string[] = []) =>
      run(['add', '--workspace', c.ws, '--json', ...extra], { skillRoot: root, workspace: c.ws, env: env(c) });
    const v1 = JSON.parse(goC(['--source', c.call]).out) as Waiting;
    answer(c.projects, v1.tasks[0]?.prompt ?? '', bad);
    const v2 = JSON.parse(goC().out) as Waiting;
    answer(c.projects, v2.tasks[0]?.prompt ?? '', bad);
    const v3 = JSON.parse(goC().out) as Waiting;
    assert.ok(
      v3.printed?.some((l) =>
        /«Checkout» Not doing — not written: leaves out or rewords 1 existing Not doing line/.test(l),
      ),
      JSON.stringify(v3.printed),
    );
    assert.ok(
      v3.printed?.some((l) => /«Checkout» Not doing — not written: change 1 already writes this block/.test(l)),
      JSON.stringify(v3.printed),
    );
    assert.ok(readFile(join(c.doc, 'features', '01-checkout.md')).includes(kept), 'the exclusion was never deleted');
  });

  void test('a run a human stopped with `bp log close` is finished: new sources start a new run', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(go(['--source', b.call]).code, EXIT.waiting);
    const [first] = readdirSync(join(b.home, 'sources'));
    assert.ok(first);
    const closed = run(
      ['log', 'close', '--home', b.home, '--run', first, '--state', 'CLOSED', '--reason', 'INTERRUPTED'],
      { skillRoot: root, workspace: b.ws, env: env(b) },
    );
    assert.equal(closed.code, EXIT.ok, closed.err + closed.out);
    const again = go(['--source', b.call]);
    assert.equal(again.code, EXIT.waiting, again.err + again.out);
    assert.deepEqual(
      (JSON.parse(again.out) as Waiting).tasks.map((t) => t.kind),
      ['add-drafter'],
    );
    assert.equal(readdirSync(join(b.home, 'sources')).length, 2, 'a second run, its own source record');
  });
});

void describe('bp add — soft', () => {
  void test('a contradiction with the document writes nothing over it: both places are marked, and an addition is still written', () => {
    const b = blueprint();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['add', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const w1 = JSON.parse(go(['--source', b.call, '--mode', 'fource']).out) as Waiting;
    answer(b.projects, w1.tasks[0]?.prompt ?? '', { ...DRAFT, overview: [], newFeatures: [], gaps: [] });
    const r2 = go();
    const w2 = JSON.parse(r2.out) as Waiting;
    // An unrecognised modifier runs soft, and says the word it did not recognise.
    assert.ok(
      w2.printed?.some((l) => l === 'BLUEPRINT ADD — mode: soft — "fource" is not a modifier · about to write'),
      JSON.stringify(w2.printed),
    );
    const body = readFile(join(b.doc, 'features', '01-checkout.md'));
    assert.match(
      body,
      /^FR-1 — When a customer confirms the basket, the system takes payment by card\. \[NEEDS CLARIFICATION: «Checkout» FR-1: the source and the document disagree \(CON-1\) → Question: carried \(CON-1 · run-log \d{4}-\d{2}-\d{2}-add-[0-9a-f]{6}\)\]$/m,
    );
    assert.match(
      body,
      /^FR-2 — After payment the system shows a confirmation for five seconds, then the home screen\.$/m,
      'an addition is not an overwrite',
    );
    assert.match(readFile(join(b.home, 'record', 'run-log.md')), /^- header: .* · mode: soft$/m);
  });
});
