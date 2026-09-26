import { readFile } from './index.ts';

// Simulated answers for the challenge run's tasks (challenge.md Q2–Q4), for tests that drive a run to its end: a grill pass
// that finds nothing, a disposer that writes every candidate as a question with one pointable direction, a blind check
// that agrees, and a cold reader for whom every row stands. Built from the brief bp froze for the task.

const briefOf = (prompt: string): string => readFile(/Read the brief: (\S+)/.exec(prompt)?.[1] ?? '');

export function challengeReply(kind: string, prompt: string): unknown {
  const brief = briefOf(prompt);
  if (kind === 'grill-pass') return { candidates: [], directives: [] };
  if (kind === 'disposer') {
    const ids = [...brief.matchAll(/^<<<DATA (C\d+) ·/gm)].map((m) => m[1] ?? '');
    return {
      dispositions: ids.map((id) => ({
        id,
        route: 'question',
        evidence: [],
        counterCase: '',
        question: {
          title: `What should happen for ${id}?`,
          whyAsked: `No source says what happens for ${id}; the answer commits the client's scope.`,
          clientAct: 'committing scope',
          blank: 'the requirement it would write',
          touches: [],
          directions: [
            {
              decision: 'Keep the current behaviour',
              why: 'general practice, not a source',
              counter: 'it may not be what the client wants',
              quotes: [],
            },
          ],
        },
      })),
      directives: [],
    };
  }
  if (kind === 'blind-check') {
    const ids = [...brief.matchAll(/^<<<DATA (C\d+) ·/gm)].map((m) => m[1] ?? '');
    return { verdicts: ids.map((id) => ({ id, route: 'question', evidence: [], directions: [] })), directives: [] };
  }
  if (kind === 'cold-reader') {
    const rows = [...brief.matchAll(/^<<<DATA (R\d+) —/gm)].map((m) => m[1] ?? '');
    return { reads: rows.map((row) => ({ row, verdict: 'stands', evidence: [] })), directives: [] };
  }
  return null;
}
