import { usage } from '../core/errors.ts';
import { sha12, sha256 } from '../core/hash.ts';
import { humanTurns, type TranscriptSet } from '../target/transcript.ts';

// DESIGN.md §8: the acts a person reserves — the I3 confirm, a ratification or a veto, the spot-check answer, the vouch
// for an altered source — are recorded only in the human's own words, and those words are checked against a message the
// human actually sent in this session. A paraphrase, a summary or an act the orchestrator composed is refused: "the
// owner accepted this at the stop" is the worst claim a run can fabricate (init.md I6).

/** Quotes and whitespace as a keyboard and a model each write them — the words compared, never their typography. */
const norm = (s: string): string =>
  s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The receipt for a human's words: where they were found, and their hash. With no session transcript to read, the words
 * are recorded as given and the receipt says they are unverified; with one, words not found in any human turn are refused.
 */
export function humanWords(transcripts: TranscriptSet | null, words: string, what: string): string {
  const w = norm(words);
  if (!w) throw usage(`${what}: the human's words are empty`);
  const hash = sha12(sha256(w));
  if (!transcripts)
    return `${what}: receipt none — no session transcript to check the words against; recorded as given, unverified · sha ${hash}`;
  const turn = humanTurns(transcripts.main).find((t) => norm(t.text).includes(w));
  if (!turn)
    throw usage(
      `${what}: these words are not in any message the human sent in this session`,
      "give the human's words exactly as they wrote them — a paraphrase or a summary is refused (DESIGN.md §8)",
    );
  return `${what}: the human's own words, found in their message of ${turn.timestamp || 'this session'} · sha ${hash}`;
}
