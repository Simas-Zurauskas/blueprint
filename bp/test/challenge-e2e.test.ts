import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
import { EXIT } from '../src/core/errors.ts';
import { run, tempDir, writeFile, readFile, fakeSkillRoot, say, SKILL_ROOT } from './support/index.ts';

// `bp challenge` end to end on a local Blueprint (challenge.md Q1–Q6). Every task is answered by a simulated subagent;
// the expected lines are hand-written from Q4's channels and ordering and Q6's lines.

const SID = 'sess-challenge-e2e-1';

const BORROW = `---
name: Borrow a lantern
what_it_does: A member reserves a lantern.
area: Lending
questions: []
created: 2026-08-04
---

## Why
Members borrow lanterns for evening walks.
## Behaviour
FR-1 — When a member taps Borrow, the system reserves a lantern.
FR-2 — A reserved lantern is held for a pickup window. [NEEDS CLARIFICATION: how long the pickup window lasts, «Borrow a lantern» FR-2 → Question: carried]
## Edge cases
- A member with an overdue lantern cannot borrow.
## Rabbit holes
## Not doing
- No deliveries — because the club has no vans.
`;

const RETURN = `---
name: Return a lantern
what_it_does: A member hands a lantern back.
area: Lending
questions: []
created: 2026-08-04
---

## Why
A returned lantern is free for the next member.
## Behaviour
FR-1 — When a member returns a lantern, the system frees it.
FR-2 — The system emails a receipt. [NEEDS CLARIFICATION: the lantern catalogue each club offers, «Return a lantern» → Question: carried]
## Edge cases
## Rabbit holes
## Not doing
`;

function blueprint(): { ws: string; doc: string; home: string; projects: string } {
  const ws = tempDir('bp-q-ws-');
  const home = join(ws, '.blueprint');
  const doc = join(ws, 'doc');
  mkdirSync(join(home, 'record'), { recursive: true });
  writeFile(join(home, 'target.md'), `# Target\n\nkind: local\npath: ${doc}\n`);
  writeFile(
    join(doc, 'README.md'),
    "## TL;DR\nA lantern club.\n## Operating\n- **Always-ask register (2026-08-04):** minors' data protection, regulatory applicability.\n",
  );
  writeFile(join(doc, 'features', '01-borrow.md'), BORROW);
  writeFile(join(doc, 'features', '02-return.md'), RETURN);
  writeFile(
    join(doc, 'questions.md'),
    '### q-01 · How long is a loan?\n- **Status:** Open\n- **Owner:**\n- **Touches:** Borrow a lantern\n- **Why asked:** No source says. · depth 1\n- **Created:** 2026-09-01\n\n**Answer & why:** _(unanswered)_\n',
  );
  const projects = join(tempDir('bp-home-'), '.claude', 'projects');
  writeFile(join(projects, 'proj', `${SID}.jsonl`), '');
  return { ws, doc, home, projects };
}

function skillRoot(): string {
  const root = fakeSkillRoot(39);
  cpSync(join(SKILL_ROOT, 'rubrics'), join(root, 'rubrics'), { recursive: true });
  return root;
}

interface Waiting {
  tasks: { id: string; kind: string; prompt: string }[];
  ask?: string[];
}

let n = 0;
function answer(projects: string, prompt: string, reply: unknown): void {
  n += 1;
  writeFile(
    join(projects, 'proj', SID, 'subagents', `agent-q${n}.jsonl`),
    `${[
      JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: prompt } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'model-q',
          content: [
            { type: 'tool_use', id: `q${n}`, name: 'SubagentHandback', input: { message: JSON.stringify(reply) } },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}

const brief = (prompt: string): string => readFile(/Read the brief: (\S+)/.exec(prompt)?.[1] ?? '');
const idsIn = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1] ?? '');
const candidateId = (b: string, gap: string): string =>
  new RegExp(`^<<<DATA (C\\d+) ·[^\\n]*\\n${gap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').exec(b)?.[1] ?? '?';

const q = (
  title: string,
  directions = [
    {
      decision: 'Keep the current behaviour',
      why: 'general practice, not a source',
      counter: 'the client may want otherwise',
      quotes: [] as { feature: string; fr: number | null; quote: string }[],
    },
  ],
) => ({
  title,
  whyAsked: `No source decides it; the answer commits the client's scope.`,
  clientAct: 'committing scope',
  blank: 'the requirement it would write',
  touches: [] as string[],
  directions,
});

function reply(kind: string, prompt: string): unknown {
  const b = brief(prompt);
  if (kind === 'grill-pass') {
    if (/^# Grill pass P1\b/m.test(b))
      return {
        candidates: [
          {
            lens: 2,
            feature: 'Borrow a lantern',
            gap: 'Can a member reserve two lanterns at once?',
            grounding: [
              {
                feature: 'Borrow a lantern',
                block: 'Behaviour',
                quote: 'When a member taps Borrow, the system reserves a lantern.',
              },
            ],
            tag: 'question',
          },
          {
            lens: 1,
            feature: 'Return a lantern',
            gap: 'Is the receipt email sent to a member who opted out of email?',
            grounding: [{ feature: 'Return a lantern', block: 'Behaviour', quote: 'The system emails a receipt.' }],
            tag: 'default',
            note: 'transactional emails ignore a marketing opt-out',
          },
        ],
        directives: [],
      };
    if (/^# Grill pass P3\b/m.test(b))
      return {
        candidates: [
          {
            lens: 0,
            checklist: 'account lifecycle',
            feature: null,
            gap: 'How does a member sign out?',
            grounding: [],
            tag: 'question',
          },
        ],
        directives: [],
      };
    return { candidates: [], directives: [] };
  }
  if (kind === 'disposer') {
    const two = candidateId(b, 'Can a member reserve two lanterns at once?');
    const email = candidateId(b, 'Is the receipt email sent to a member who opted out of email?');
    const signOut = candidateId(b, 'How does a member sign out?');
    const window = candidateId(b, 'how long the pickup window lasts, «Borrow a lantern» FR-2');
    const catalogue = candidateId(b, 'the lantern catalogue each club offers, «Return a lantern»');
    const volume = idsIn(b, /^<<<DATA (C\d+) · project-level · volume/gm)[0] ?? '?';
    return {
      dispositions: [
        {
          id: two,
          route: 'question',
          evidence: [],
          counterCase: '',
          question: q(
            'Can a member reserve two lanterns at once, with the answer deciding how many a reservation holds?',
            [
              {
                decision: 'One lantern per member at a time',
                why: 'FR-1 reserves "a lantern"',
                counter: 'a family may want two',
                quotes: [
                  {
                    feature: 'Borrow a lantern',
                    fr: 1,
                    quote: 'When a member taps Borrow, the system reserves a lantern.',
                  },
                ],
              },
              {
                decision: 'Up to <value> lanterns per member',
                why: 'a club may want families served',
                counter: 'fewer lanterns for others',
                quotes: [{ feature: 'Borrow a lantern', fr: 1, quote: 'members may borrow up to three' }],
              },
            ],
          ),
        },
        {
          id: email,
          route: 'default',
          evidence: [],
          counterCase: 'the client may want a receipt only on request',
          question: q('Is the receipt sent to a member who opted out of email?'),
          default: {
            feature: 'Return a lantern',
            block: 'Behaviour',
            sentence: "Receipt emails are sent whatever the member's marketing preference",
            grounding: 'transactional email convention',
            attestations: {
              dominant: 'every mail provider treats receipts as transactional',
              lowRisk: 'a receipt carries no marketing',
              reversible: 'one setting',
              notClientOwned: 'no client commitment',
            },
            doesNotDecide: 'whether receipts are sent at all',
            risk: 'normal',
          },
        },
        {
          id: signOut,
          route: 'discard',
          filter: 'Not a specification question',
          evidence: [],
          survey: [
            {
              feature: 'Borrow a lantern',
              fr: 1,
              sentence: 'When a member taps Borrow, the system reserves a lantern.',
            },
            { feature: 'Return a lantern', fr: 1, sentence: 'When a member returns a lantern, the system frees it.' },
          ],
          counterCase: 'a product with no sign-out is a real gap',
          question: q('How does a member sign out?'),
        },
        {
          id: window,
          route: 'question',
          evidence: [],
          counterCase: '',
          question: q('How long is a reserved lantern held before it is released?'),
        },
        {
          id: catalogue,
          route: 'slot',
          evidence: [],
          counterCase: '',
          question: q('What lanterns does each club offer?'),
          slot: {
            feature: 'Return a lantern',
            block: 'Behaviour',
            what: 'the lantern catalogue',
            shape: 'name + size',
            bounds: '5–40 items',
            supplier: 'the club secretary',
          },
        },
        {
          id: volume,
          route: 'question',
          evidence: [],
          counterCase: '',
          question: {
            ...q('How many members and loans should the club expect at its busiest — the order of magnitude?'),
            touches: [],
          },
        },
      ],
      directives: [],
    };
  }
  if (kind === 'blind-check') {
    const ids = idsIn(b, /^<<<DATA (C\d+) ·/gm);
    const catalogue = candidateId(b, 'the lantern catalogue each club offers, «Return a lantern»');
    return {
      verdicts: ids.map((id) => ({
        id,
        route: id === catalogue ? 'slot' : 'question',
        evidence: [],
        directions: [{ n: 1, verdict: 'ok' }],
      })),
      directives: [],
    };
  }
  if (kind === 'cold-reader') {
    const rows = idsIn(b, /^<<<DATA (R\d+) — the row as it would be written\nQuestion: (?:.*)$/gm);
    const titleOf = (r: string): string =>
      new RegExp(`^<<<DATA ${r} — the row as it would be written\\nQuestion: (.*)$`, 'm').exec(b)?.[1] ?? '';
    return {
      reads: rows.map((row) => {
        const t = titleOf(row);
        if (t.startsWith('Can a member reserve two'))
          return { row, verdict: 'simplify', evidence: [], rewording: 'Can a member reserve two lanterns at once?' };
        if (t.startsWith('How does a member sign out'))
          return {
            row,
            verdict: 'answered',
            evidence: [{ where: '«Borrow a lantern» Behaviour', quote: 'Members sign out from the profile screen.' }],
          };
        if (t.startsWith('How many members'))
          return { row, verdict: 'irrelevant', evidence: [], filter: 'Client-internal' };
        return { row, verdict: 'stands', evidence: [] };
      }),
      directives: [],
    };
  }
  return null;
}

function drive(
  b: ReturnType<typeof blueprint>,
  root: string,
  first: string[],
): { code: number; out: string; err: string } {
  const go = (extra: string[]) =>
    run(['challenge', '--workspace', b.ws, '--json', ...extra], {
      skillRoot: root,
      workspace: b.ws,
      env: { CLAUDE_CODE_SESSION_ID: SID, HOME: join(b.projects, '..', '..') },
    });
  let r = go(first);
  for (let i = 0; i < 12 && r.code === EXIT.waiting; i++) {
    const w = JSON.parse(r.out) as Waiting;
    if (w.ask) return r;
    for (const t of w.tasks) answer(b.projects, t.prompt, reply(t.kind, t.prompt));
    r = go([]);
  }
  return r;
}

void describe('bp challenge — the full battery, every channel', () => {
  void test('grills, disposes, checks blind, reads cold, writes each channel and logs Q6', () => {
    const b = blueprint();
    const root = skillRoot();
    const r = drive(b, root, ['--full']);
    assert.equal(r.code, EXIT.ok, r.err + r.out);

    const questions = readFile(join(b.doc, 'questions.md'));
    // The simplified wording is adopted; Why asked carries the candidate's depth.
    assert.match(questions, /^### q-02 · Can a member reserve two lanterns at once\?$/m);
    // Grounded in FR-1, which carries no depth token: depth 1 (Q4 — text with no token is depth 1).
    assert.match(
      questions,
      /^- \*\*Why asked:\*\* No source decides it; the answer commits the client's scope\. · depth 1$/m,
    );
    // The survey exception: the blind side read the surveyed sentences and said QUESTION — so it is written.
    assert.match(questions, /^### q-0\d · How does a member sign out\?$/m);
    // The marker transcription became a row, and its marker was patched to that row in the same act.
    const window = /^### (q-0\d) · How long is a reserved lantern held before it is released\?$/m.exec(questions)?.[1];
    assert.ok(window);
    assert.match(
      readFile(join(b.doc, 'features', '01-borrow.md')),
      new RegExp(
        `\\[NEEDS CLARIFICATION: how long the pickup window lasts, «Borrow a lantern» FR-2 → Question: ${window}\\]`,
      ),
    );
    // An unmatched quotation in a direction is dropped, never the whole field.
    assert.match(
      questions,
      /1\. One lantern per member at a time\. Why: FR-1 reserves "a lantern" — «Borrow a lantern» FR-1 "When a member taps Borrow, the system reserves a lantern\." \(2026-09-25\)\. Counter-case: a family may want two\./,
    );
    assert.match(
      questions,
      /2\. Up to <value> lanterns per member\. Why: a club may want families served\. Counter-case: fewer lanterns for others\./,
    );

    const ret = readFile(join(b.doc, 'features', '02-return.md'));
    // The default beat the blind QUESTION on its four attestations; it is labelled, dated and depth-stamped.
    assert.match(
      ret,
      /^Default \(standard practice — ratify on review\): Receipt emails are sent whatever the member's marketing preference\. \(run [0-9a-f]{6} · 2026-09-25\) · depth 1$/m,
    );
    // The slot line was written and the marker it holds removed (route 7).
    assert.match(
      ret,
      /^Content slot — client-supplied: the lantern catalogue · name \+ size · 5–40 items · supplied by the club secretary · depth 1$/m,
    );
    assert.doesNotMatch(ret, /NEEDS CLARIFICATION/);

    const logText = readFile(join(b.home, 'record', 'run-log.md'));
    assert.match(
      logText,
      /^- ledger [0-9a-f]{6} #1: «Return a lantern» Behaviour · Default \(standard practice — ratify on review\): /m,
    );
    assert.match(
      logText,
      /^- manifest [0-9a-f]{6} #1: «Return a lantern» Behaviour · Content slot — client-supplied: the lantern catalogue/m,
    );
    assert.match(
      logText,
      /^- citation: not matched — dropped «Borrow a lantern» FR-1 "members may borrow up to three"$/m,
    );
    assert.match(
      logText,
      /^- funnel: 6 drafted \(P1 2 · P2 0 · P3 1\) → 1 routed default · 0 routed fix · 1 routed slot · 4 written as questions · 0 discarded$/m,
    );
    assert.match(
      logText,
      /^- GRILL: full · 3 dispatches · «Borrow a lantern» [0-9a-f]{12} \(delta\) · «Return a lantern» [0-9a-f]{12} \(delta\) · converged: no$/m,
    );
    assert.match(logText, /^- closing: CLOSED \d{2}:\d{2} · HUMAN-BLOCKED · /m);
    // The cold read's rewording and its no-evidence read are check lines in record/runs/, never the log.
    assert.doesNotMatch(logText, /^- check: cold read/m);
  });
});

void describe('bp challenge — Q1, the one executor of a batch act', () => {
  void test('a ratification named to a later run waits for the spot-check; then the default is relabelled ratified', () => {
    const b = blueprint();
    const root = skillRoot();
    assert.equal(drive(b, root, ['--full']).code, EXIT.ok);
    const ledgerRun = /^- ledger ([0-9a-f]{6}) #1:/m.exec(readFile(join(b.home, 'record', 'run-log.md')))?.[1] ?? '';
    // An act the human never said is refused: Q1 executes their words, never the orchestrator's.
    const refused = drive(b, root, ['--act', `ratify ${ledgerRun} defaults`]);
    assert.equal(refused.code, EXIT.usage, refused.err + refused.out);
    assert.match(refused.err, /the act: these words are not in any message the human sent in this session/);
    say(join(b.projects, 'proj', `${SID}.jsonl`), `Please ratify ${ledgerRun} defaults.`);
    const r1 = drive(b, root, ['--act', `ratify ${ledgerRun} defaults`]);
    assert.equal(r1.code, EXIT.waiting, r1.err + r1.out);
    const w = JSON.parse(r1.out) as Waiting;
    assert.ok(
      w.ask?.some((l) => /#1 {2}«Return a lantern» Behaviour · Default/.test(l)),
      JSON.stringify(w.ask),
    );
    say(join(b.projects, 'proj', `${SID}.jsonl`), 'yes, that one is right');
    const r2 = drive(b, root, ['--sample-answer', 'yes, that one is right']);
    assert.equal(r2.code, EXIT.ok, r2.err + r2.out);
    assert.match(
      readFile(join(b.doc, 'features', '02-return.md')),
      /^Default \(standard practice — ratified 2026-09-25\): Receipt emails are sent whatever the member's marketing preference\./m,
    );
    assert.match(
      readFile(join(b.home, 'record', 'run-log.md')),
      new RegExp(
        `^- RATIFIED: defaults ledger ${ledgerRun}, #1 · "ratify ${ledgerRun} defaults" · spot-check #1 → "yes, that one is right"$`,
        'm',
      ),
    );
  });

  void test('a veto by the number on the screen removes that default, the number matched by content', () => {
    const b = blueprint();
    const root = skillRoot();
    assert.equal(drive(b, root, ['--full']).code, EXIT.ok);
    const ledgerRun = /^- ledger ([0-9a-f]{6}) #1:/m.exec(readFile(join(b.home, 'record', 'run-log.md')))?.[1] ?? '';
    say(join(b.projects, 'proj', `${SID}.jsonl`), `veto ${ledgerRun} #1`);
    const r = drive(b, root, ['--act', `veto ${ledgerRun} #1`]);
    assert.equal(r.code, EXIT.ok, r.err + r.out);
    assert.doesNotMatch(readFile(join(b.doc, 'features', '02-return.md')), /Receipt emails are sent/);
    assert.match(
      readFile(join(b.home, 'record', 'run-log.md')),
      new RegExp(
        `^- VETOED: defaults ledger ${ledgerRun}, #1 \\(screen #1: "Default \\(standard practice — ratify on review\\): Receipt email`,
        'm',
      ),
    );
  });
});
