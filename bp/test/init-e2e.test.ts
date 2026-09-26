import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync, readdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fileExists, fakeSkillRoot, say, SKILL_ROOT } from './support/index.ts';
import { challengeReply } from './support/challenge-replies.ts';

// `bp init` end to end on a local folder (init.md I1–I7). The drafter, the grill passes, the faithfulness check and the
// challenge handoff are simulated subagents: each answer is written into a subagent transcript whose first message carries
// the task's nonce. Expected text is hand-written from init.md and doc-shape §3, §5 and §9.

const SID = 'sess-init-e2e-0001';

const DECK = `Golden Crumb — pitch deck
p.1 A pre-order app for a neighbourhood bakery. Regulars order ahead and collect at a chosen slot.
p.2 Customers browse the menu by category. The pickup window is 15 minutes.
p.3 We are not doing delivery — the bakery has no drivers.
`;

const INTERVIEW = `Q1: What is it, and what is it not?
A: Regulars order ahead for collection. It is not a delivery or wholesale service.
Q2: Who is it for?
A: Walk-in regulars, and office managers running a weekly group order.
Q3: Features?
A: Browse the menu, checkout. The pickup window is 30 minutes, I think.
`;

function workspace(): { ws: string; projects: string; deck: string; interview: string; transcript: string } {
  const ws = tempDir('bp-init-ws-');
  const given = tempDir('bp-given-');
  const deck = writeFile(join(given, 'deck.md'), DECK);
  const interview = writeFile(join(given, 'interview.md'), INTERVIEW);
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  const transcript = writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  return { ws, projects, deck, interview, transcript };
}

function skillRoot(): string {
  const root = fakeSkillRoot(41);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return root;
}

interface Waiting {
  status: string;
  stage?: string;
  tasks: { id: string; kind: string; prompt: string }[];
  ask?: string[];
}

let agents = 0;
function answer(projects: string, prompt: string, reply: unknown): void {
  const tag = /bp-task:[\w-]+:[0-9a-f]+/.exec(prompt)?.[0];
  assert.ok(tag, 'the prompt carries a task nonce');
  agents += 1;
  writeFile(
    join(projects, 'proj', SID, 'subagents', `agent-i${agents}.jsonl`),
    `${[
      JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: prompt } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: agents % 2 ? 'model-drafter' : 'model-checker',
          content: [
            { type: 'tool_use', id: `i${agents}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}

const env = (b: { projects: string }) => ({ CLAUDE_CODE_SESSION_ID: SID, HOME: join(b.projects, '..', '..') });
const briefOf = (prompt: string): string => readFile(/Read the brief: (\S+)/.exec(prompt)?.[1] ?? '');

const deck = (at: string, quote: string) => ({ source: '01-deck.md', at, quote });
const iv = (at: string, quote: string) => ({ source: '02-interview.md', at, quote });

const DRAFT = {
  overview: {
    tldr: 'A pre-order app for a neighbourhood bakery. The feature rows are the spec; read those first.',
    whatItIs: 'Regulars order ahead and collect at a chosen slot. It is not a delivery or wholesale service.',
    whoFor: ['walk-in regulars ordering ahead', 'office managers running a weekly group order'],
    picture: ['customer', 'menu', 'checkout', 'pickup slot', 'collect'],
    links: ['The pitch deck and the interview, captured at this run and held outside version control.'],
    cites: [
      deck('p.1', 'A pre-order app for a neighbourhood bakery.'),
      iv('Q1', 'It is not a delivery or wholesale service.'),
    ],
  },
  features: [
    {
      name: 'Browse the menu',
      area: 'Ordering',
      whatItDoes: 'A customer sees what the bakery sells, by category.',
      why: 'Regulars need to see what they can order before they order it.',
      requirements: [
        {
          text: 'When a customer opens the menu, the system lists the items by category.',
          cite: deck('p.2', 'Customers browse the menu by category.'),
        },
      ],
      edgeCases: [],
      notDoing: [],
      cite: iv('Q3', 'Browse the menu, checkout.'),
    },
    {
      name: 'Checkout',
      area: 'Ordering',
      whatItDoes: 'A customer places the order for a pickup slot.',
      why: 'Regulars order ahead and collect at a chosen slot.',
      requirements: [
        {
          text: 'When a customer places an order, the system asks for a pickup slot.',
          cite: deck('p.1', 'Regulars order ahead and collect at a chosen slot.'),
        },
      ],
      edgeCases: [],
      notDoing: [
        {
          text: 'No delivery — because the bakery has no drivers.',
          cite: deck('p.3', 'We are not doing delivery — the bakery has no drivers.'),
        },
      ],
      cite: iv('Q3', 'Browse the menu, checkout.'),
    },
  ],
  contradictions: [
    {
      a: deck('p.2', 'The pickup window is 15 minutes.'),
      b: iv('Q3', 'The pickup window is 30 minutes, I think.'),
      entity: 'how long the pickup window is, «Checkout»',
      feature: 'Checkout',
      block: 'Behaviour',
    },
  ],
  gaps: [
    {
      feature: 'Checkout',
      block: 'Edge cases',
      entity: 'what happens when a customer misses the pickup window, «Checkout»',
    },
  ],
  inventory: [
    { cite: deck('p.1', 'A pre-order app for a neighbourhood bakery.'), lands: 'overview' },
    { cite: deck('p.2', 'Customers browse the menu by category.'), lands: 'feature', target: 'Browse the menu' },
    { cite: deck('p.3', 'We are not doing delivery'), lands: 'not-doing', target: 'Checkout' },
  ],
  directives: [],
};

/** Answer every task a waiting run prints with the given reply function; returns the next result. */
function step(
  b: { projects: string },
  r: { code: number; out: string; err: string },
  reply: (kind: string, prompt: string) => unknown,
): void {
  assert.equal(r.code, EXIT.waiting, r.err + r.out);
  const w = JSON.parse(r.out) as Waiting;
  for (const t of w.tasks) answer(b.projects, t.prompt, reply(t.kind, t.prompt));
}

/** Answer the handoff's tasks (I7) until the run closes. */
function finish(
  b: { projects: string },
  go: () => { code: number; out: string; err: string },
): { code: number; out: string; err: string } {
  for (let i = 0; i < 12; i++) {
    const r = go();
    if (r.code !== EXIT.waiting) return r;
    step(b, r, challengeReply);
  }
  throw new Error('the challenge handoff did not finish');
}

void describe('bp init — a local folder', () => {
  void test('asks where the Blueprint lives before anything, and refuses somewhere else', () => {
    const b = workspace();
    const root = skillRoot();
    const r = run(['init', '--workspace', b.ws, '--source', b.deck], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /Where should this live\? Notion .* or a folder of markdown files/);
    assert.equal(fileExists(join(b.ws, '.blueprint')), false, 'nothing is written before the target is answered');
    const r2 = run(['init', '--workspace', b.ws, '--target', 'confluence:space', '--source', b.deck], {
      skillRoot: root,
      workspace: b.ws,
      env: env(b),
    });
    assert.equal(r2.code, EXIT.usage);
    assert.match(r2.err, /not a target this skill writes to/);
  });

  void test('I1–I7: capture, draft, grill, the one stop, create, write, check, challenge, close', () => {
    const b = workspace();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['init', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const home = join(b.ws, '.blueprint');
    const doc = join(b.ws, 'doc');

    // I1: the target recorded, the ignore file seeded, every source captured verbatim and hashed, the entry open.
    const r1 = go(['--target', 'local:doc', '--source', b.deck, '--text', b.interview, '--text-name', 'interview.md']);
    assert.equal(r1.code, EXIT.waiting, r1.err + r1.out);
    assert.match(readFile(join(home, 'target.md')), new RegExp(`^path: ${doc.replace(/[/.]/g, '\\$&')}$`, 'm'));
    assert.match(readFile(join(home, '.gitignore')), /^sources\/$/m);
    const runId = readdirSync(join(home, 'sources'))[0] ?? '';
    assert.equal(readFile(join(home, 'sources', runId, '01-deck.md')), DECK);
    assert.equal(readFile(join(home, 'sources', runId, '02-interview.md')), INTERVIEW);
    assert.match(
      readFile(join(home, 'sources', runId, 'MANIFEST.md')),
      /\| 2 \| `02-interview\.md` \| given in conversation, \d{4}-\d{2}-\d{2} \| \d+ \| `[0-9a-f]{64}` \|/,
    );
    assert.match(readFile(join(home, 'record', 'run-log.md')), /· init · run [0-9a-f]{6} · skill v41 · sitting 1$/m);
    const w1 = JSON.parse(r1.out) as Waiting;
    assert.deepEqual(
      w1.tasks.map((t) => t.kind),
      ['init-drafter'],
    );
    assert.match(briefOf(w1.tasks[0]?.prompt ?? ''), /<<<DATA source 01-deck\.md/);
    answer(b.projects, w1.tasks[0]?.prompt ?? '', DRAFT);

    // I2: the full grill over the drafted skeleton — one pass per Area, the whole document, the sweeps.
    const r2 = go();
    const w2 = JSON.parse(r2.out) as Waiting;
    assert.deepEqual(
      w2.tasks.map((t) => t.kind),
      ['grill-pass', 'grill-pass', 'grill-pass'],
    );
    step(b, r2, (_kind, prompt) =>
      /P1/.test(briefOf(prompt).slice(0, 400))
        ? {
            candidates: [
              {
                lens: 2,
                feature: 'Checkout',
                gap: 'What happens when the bakery runs out of an item that was ordered?',
                grounding: [{ feature: 'Checkout', block: 'Behaviour', quote: 'the system asks for a pickup slot' }],
                tag: 'question',
              },
            ],
            directives: [],
          }
        : { candidates: [], directives: [] },
    );

    // The finds fold back in: one re-draft told what the grill found.
    const r3 = go();
    const w3 = JSON.parse(r3.out) as Waiting;
    assert.deepEqual(
      w3.tasks.map((t) => t.kind),
      ['init-drafter'],
    );
    assert.match(briefOf(w3.tasks[0]?.prompt ?? ''), /What the grill found/);
    answer(b.projects, w3.tasks[0]?.prompt ?? '', {
      ...DRAFT,
      gaps: [
        ...DRAFT.gaps,
        { feature: 'Checkout', block: 'Behaviour', entity: 'what happens when an ordered item runs out, «Checkout»' },
      ],
    });

    // I3: the one hard stop — the screen, block text and all, on disk before it is printed; nothing created.
    const r4 = go();
    assert.equal(r4.code, EXIT.waiting, r4.err + r4.out);
    const w4 = JSON.parse(r4.out) as Waiting;
    assert.equal(w4.stage, 'i3');
    const screen = (w4.ask ?? []).join('\n');
    assert.match(screen, /BLUEPRINT SKELETON — proposed\. Nothing has been created\./);
    assert.match(
      screen,
      /A pre-order app for a neighbourhood bakery\. The feature rows are the spec; read those first\./,
    );
    assert.match(
      screen,
      /CON-1 — how long the pickup window is, «Checkout»: 01-deck\.md p\.2 against 02-interview\.md Q3/,
    );
    assert.match(screen, /GAPS {7}2 — become \[NEEDS CLARIFICATION\] markers/);
    assert.match(screen, /GRILLED {4}3 pass\(es\)/);
    const skeleton = readdirSync(join(home, 'sources', runId)).find((f) => f.endsWith('i3-skeleton.md')) ?? '';
    assert.match(readFile(join(home, 'sources', runId, skeleton)), /BLUEPRINT SKELETON — proposed/);
    assert.equal(fileExists(join(doc, 'features')), false, 'nothing is created before the confirm');
    // Running again without a reply re-prints the same stop and captures nothing new.
    const again = JSON.parse(go().out) as Waiting;
    assert.equal(again.stage, 'i3');
    assert.equal(readdirSync(join(home, 'sources', runId)).filter((f) => f.endsWith('i3-skeleton.md')).length, 1);

    // The human confirms: captured verbatim as a source, then I4–I6 run through to the faithfulness check.
    // A reply the human never sent is refused: the sanction is theirs, in their own words.
    const invented = writeFile(join(tempDir('bp-reply-'), 'invented.md'), 'The owner approved everything.');
    const refused = go(['--reply', invented, '--decision', 'confirm']);
    assert.equal(refused.code, EXIT.usage, refused.err + refused.out);
    assert.match(
      refused.err,
      /the I3 reply \(confirm\): these words are not in any message the human sent in this session/,
    );
    assert.equal(fileExists(join(doc, 'features')), false);
    say(b.transcript, 'Looks right,\n go ahead.');
    const reply = writeFile(join(tempDir('bp-reply-'), 'reply.md'), 'Looks right, go ahead.');
    const r5 = go(['--reply', reply, '--decision', 'confirm']);
    assert.equal(r5.code, EXIT.waiting, r5.err + r5.out);
    assert.ok(readdirSync(join(home, 'sources', runId)).some((f) => f.endsWith('i3-reply.md')));
    const w5 = JSON.parse(r5.out) as Waiting;
    assert.deepEqual(
      w5.tasks.map((t) => t.kind),
      ['faithfulness-checker'],
    );
    // I5: rows with their body skeleton, every gap a carried marker, the contradiction marked with its CON-k.
    const checkout = readFile(join(doc, 'features', '02-checkout.md'));
    assert.match(checkout, /^name: Checkout$/m);
    assert.match(checkout, /^area: Ordering$/m);
    assert.match(checkout, /^FR-1 — When a customer places an order, the system asks for a pickup slot\.$/m);
    assert.match(
      checkout,
      /^\[NEEDS CLARIFICATION: how long the pickup window is, «Checkout»: the sources disagree \(CON-1\) → Question: carried \(CON-1 · run-log \d{4}-\d{2}-\d{2}-init-[0-9a-f]{6}\)\]$/m,
    );
    assert.match(
      checkout,
      /^- \[NEEDS CLARIFICATION: what happens when a customer misses the pickup window, «Checkout» → Question: carried\]$/m,
    );
    assert.match(checkout, /^## Rabbit holes\n## Not doing\n- No delivery — because the bakery has no drivers\.$/m);
    // The overview, once: the four human blocks, the two ⟳ lists, Links, Operating — the I3 text verbatim.
    const readme = readFile(join(doc, 'README.md'));
    assert.match(readme, /^## TL;DR\nA pre-order app for a neighbourhood bakery\./m);
    assert.match(
      readme,
      /^## ⟳ Where things are\n### Ordering\n- \[Browse the menu\]\(features\/01-browse-the-menu\.md\)/m,
    );
    assert.match(readme, /^- \*\*Always-ask register \(\d{4}-\d{2}-\d{2}\):\*\* minors' data protection/m);
    assert.doesNotMatch(readme, /Owner/);

    // I6: the check narrows one claim; bp applies it in place with its own provenance line.
    const brief = briefOf(w5.tasks[0]?.prompt ?? '');
    const items = [...brief.matchAll(/^<<<DATA (W\d+) · (.*?) · cited:/gm)].map((m) => ({
      id: m[1] ?? '',
      where: m[2] ?? '',
    }));
    assert.deepEqual(
      items.map((i) => i.where),
      ['«Browse the menu» (created)', '«Checkout» (created)', '«overview» (written once)'],
    );
    assert.match(brief, /Looks right, go ahead\./, "the human's reply is in the check's brief");
    answer(b.projects, w5.tasks[0]?.prompt ?? '', {
      verdicts: items.map((it) =>
        it.where.startsWith('«Browse')
          ? {
              item: it.id,
              verdict: 'Patched — narrowed',
              finding: 'the source does not say the menu is listed',
              edit: {
                block: 'Behaviour',
                old: 'the system lists the items by category.',
                new: 'the system shows the items by category.',
              },
            }
          : { item: it.id, verdict: 'Clean', finding: '' },
      ),
      directives: [],
    });

    // I7: the challenge handoff, then the close.
    const r6 = finish(b, go);
    assert.equal(r6.code, EXIT.ok, r6.err + r6.out);
    assert.match(
      readFile(join(doc, 'features', '01-browse-the-menu.md')),
      /^FR-1 — When a customer opens the menu, the system shows the items by category\.\n\*\(Narrowed \d{4}-\d{2}-\d{2} by the faithfulness check · depth 1 — the source does not say the menu is listed\.\)\*$/m,
    );
    const questions = readFile(join(doc, 'questions.md'));
    assert.match(questions, /^### q-01 · /m);
    // The carried markers were routed to rows: the CON-1 marker now points at one.
    assert.match(readFile(join(doc, 'features', '02-checkout.md')), /\(CON-1\) → Question: q-0\d\]/);
    const log = readFile(join(home, 'record', 'run-log.md'));
    assert.match(
      log,
      /^- CON-1: how long the pickup window is, «Checkout» · 01-deck\.md p\.2 vs 02-interview\.md Q3 · quotes at sources\/[0-9a-f]{6}\/contradictions\.md · → q-0\d · routed at this sitting/m,
    );
    assert.match(log, /^- VERDICTS: I6 3 checked · 2 Clean · 1 narrowed · 0 removed · 0 Flagged/m);
    assert.match(log, /^- citation: matched «Checkout» FR-1 ← 01-deck\.md p\.1$/m);
    assert.match(log, /^- GRILL: I2 · full scale over the drafted skeleton · 3 pass\(es\) · 1 find\(s\)/m);
    assert.match(log, /^- COUNTS: features 2 = Ordering 2; markers /m);
    assert.match(log, /^- closing: CLOSED \d{2}:\d{2} · HUMAN-BLOCKED · run totals: 2 feature row\(s\)/m);
    // No client quote in record/: the verbatim spans are in the source record.
    assert.doesNotMatch(log, /30 minutes, I think/);
    assert.match(
      readFile(join(home, 'sources', runId, 'contradictions.md')),
      /The pickup window is 30 minutes, I think\./,
    );
    const out = JSON.parse(r6.out) as { report: string[] };
    assert.match(out.report.join('\n'), /^BLUEPRINT INIT — .* · target: .*doc$/m);
    assert.match(out.report.join('\n'), /^Created {4}2 feature rows · overview written once$/m);
    assert.match(out.report.join('\n'), /^WHAT HAPPENS NEXT/m);
    // status reads what init built without a halt.
    const s = run(['status', '--workspace', b.ws, '--json'], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.notEqual(s.code, EXIT.halt, s.err + s.out);
  });

  void test('an edit at I3 is re-drafted and re-presented once; a contradiction the reply settles closes at I3', () => {
    const b = workspace();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['init', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const home = join(b.ws, '.blueprint');
    const doc = join(home, 'document');
    const r1 = go(['--target', 'local', '--source', b.deck, '--text', b.interview, '--text-name', 'interview.md']);
    step(b, r1, () => DRAFT);
    step(b, go(), () => ({ candidates: [], directives: [] }));
    const w3 = JSON.parse(go().out) as Waiting;
    assert.equal(w3.stage, 'i3');
    say(b.transcript, 'The window is 30 minutes. Drop the menu feature for now.');
    const reply = writeFile(
      join(tempDir('bp-reply-'), 'reply.md'),
      'The window is 30 minutes. Drop the menu feature for now.',
    );
    const r4 = go(['--reply', reply, '--decision', 'edit']);
    const w4 = JSON.parse(r4.out) as Waiting;
    assert.deepEqual(
      w4.tasks.map((t) => t.kind),
      ['init-drafter'],
    );
    const brief = briefOf(w4.tasks[0]?.prompt ?? '');
    assert.match(brief, /The window is 30 minutes\. Drop the menu feature for now\./);
    const replyFile = readdirSync(join(home, 'sources', readdirSync(join(home, 'sources'))[0] ?? '')).find((f) =>
      f.endsWith('i3-reply.md'),
    );
    answer(b.projects, w4.tasks[0]?.prompt ?? '', {
      ...DRAFT,
      features: [
        {
          ...DRAFT.features[1],
          requirements: [
            ...(DRAFT.features[1]?.requirements ?? []),
            {
              text: 'The system holds an order for 30 minutes after its pickup slot begins.',
              cite: { source: replyFile, at: 'reply', quote: 'The window is 30 minutes.' },
            },
          ],
        },
      ],
      settledAtI3: [{ what: 'CON-1', words: 'The window is 30 minutes.' }],
    });
    // Re-presented once, briefly: the screen shows the settled contradiction and the one feature.
    const w5 = JSON.parse(go().out) as Waiting;
    assert.equal(w5.stage, 'i3');
    const screen = (w5.ask ?? []).join('\n');
    assert.match(screen, /FEATURES {3}1 rows/);
    assert.match(
      screen,
      /CON-1 — how long the pickup window is, «Checkout»: settled by your reply \("The window is 30 minutes\."\)/,
    );
    say(b.transcript, 'Yes.');
    const ok = writeFile(join(tempDir('bp-reply-'), 'ok.md'), 'Yes.');
    step(b, go(['--reply', ok, '--decision', 'confirm']), (kind, prompt) =>
      kind === 'faithfulness-checker'
        ? {
            verdicts: [...briefOf(prompt).matchAll(/^<<<DATA (W\d+) ·/gm)].map((m) => ({
              item: m[1],
              verdict: 'Clean',
              finding: '',
            })),
            directives: [],
          }
        : challengeReply(kind, prompt),
    );
    const r = finish(b, go);
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    const checkout = readFile(join(doc, 'features', '01-checkout.md'));
    assert.doesNotMatch(checkout, /CON-1/, 'a contradiction settled at I3 is not marked');
    assert.match(checkout, /^FR-2 — The system holds an order for 30 minutes after its pickup slot begins\.$/m);
    assert.match(
      readFile(join(home, 'record', 'run-log.md')),
      /^- CON-1: .* · closed by the human's answer at I3 \(sources\/[0-9a-f]{6}\/\d{2}-i3-reply\.md\)$/m,
    );
  });

  void test('a declined skeleton is a normal ending: nothing is created, and the source record stays', () => {
    const b = workspace();
    const root = skillRoot();
    const go = (extra: string[] = []) =>
      run(['init', '--workspace', b.ws, '--json', ...extra], { skillRoot: root, workspace: b.ws, env: env(b) });
    const home = join(b.ws, '.blueprint');
    step(b, go(['--target', 'local', '--source', b.deck]), () => ({
      ...DRAFT,
      overview: { ...DRAFT.overview, cites: [DRAFT.overview.cites[0]] },
      features: [],
      contradictions: [],
      gaps: [],
      inventory: [],
    }));
    step(b, go(), () => ({ candidates: [], directives: [] }));
    assert.equal((JSON.parse(go().out) as Waiting).stage, 'i3');
    say(b.transcript, 'No, not yet.');
    const no = writeFile(join(tempDir('bp-reply-'), 'no.md'), 'No, not yet.');
    const r = go(['--reply', no, '--decision', 'decline']);
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    assert.match(r.out, /the skeleton was declined\. Nothing was created\./);
    assert.equal(fileExists(join(home, 'document', 'features')), false);
    assert.match(
      readFile(join(home, 'record', 'run-log.md')),
      /^- closing: CLOSED \d{2}:\d{2} · HUMAN-BLOCKED · run totals: skeleton declined/m,
    );
    const runId = readdirSync(join(home, 'sources'))[0] ?? '';
    assert.equal(readFile(join(home, 'sources', runId, '01-deck.md')), DECK);
  });

  void test('a Blueprint that exists is /blueprint add, not init', () => {
    const b = workspace();
    const root = skillRoot();
    const home = join(b.ws, '.blueprint');
    writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${join(b.ws, 'doc')}\n`);
    writeFile(join(b.ws, 'doc', 'features', '01-x.md'), '---\nname: X\n---\n## Why\n');
    const r = run(['init', '--workspace', b.ws, '--source', b.deck], { skillRoot: root, workspace: b.ws, env: env(b) });
    assert.equal(r.code, EXIT.halt);
    assert.match(r.err, /already holds a Blueprint — adding material to one is \/blueprint add/);
  });
});
