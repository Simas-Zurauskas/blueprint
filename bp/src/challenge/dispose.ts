import { array, integer, nullable, object, oneOf, optional, string, type Infer } from '../core/schema.ts';
import { quoteFound } from '../core/text.ts';
import { FEATURE_BLOCKS } from '../domain/vocab.ts';
import type { Snapshot } from '../snapshot.ts';
import { data } from '../tasks/tasks.ts';

// challenge.md Q3 and Q4 — every candidate disposed, and the disposition decided before anything is written. The
// disposer's judgment routes each candidate to exactly one channel (a QUESTION only through the two-axis gate); what is
// checkable is bp's: the quote a discard rests on is found where it says, a survey quotes its requirements' own
// sentences, the four undiscardable classes are never demoted, a question derived past the bound is capped, the blind
// check's verdict is applied by Q4's exact ordering, and the read-back gate reads the row's own Why asked.

export const FILTERS = [
  'Already answered',
  'Shown by the ratified design',
  'Settled by convention',
  'Correction, not question',
  'Duplicate',
  'Not a specification question',
  'Implementation, not intent',
  'Unanswerable here',
  'Client-internal',
  'Deliverable content, not a decision',
  'Already decided against',
  'Consequence of an open question',
  'Answered by a principle the client stated',
  'Derived past the bound',
] as const;
export type Filter = (typeof FILTERS)[number];

/** The filters whose discard must quote the text it rests on — or the discard is invalid and the candidate is proposed. */
const QUOTED: ReadonlySet<Filter> = new Set<Filter>([
  'Already answered',
  'Duplicate',
  'Consequence of an open question',
  'Answered by a principle the client stated',
  'Already decided against',
]);
/** The three filters a routing must carry a survey for — the surveyed requirements and their own sentences (Q4, v23). */
export const SURVEYED: ReadonlySet<Filter> = new Set<Filter>([
  'Deliverable content, not a decision',
  'Client-internal',
  'Not a specification question',
]);

const Evidence = object({ where: string({ min: 1, max: 200 }), quote: string({ min: 1, max: 800 }) });
const Survey = object({
  feature: string({ max: 200 }),
  fr: integer({ min: 1 }),
  sentence: string({ min: 1, max: 800 }),
});
const Direction = object({
  /** The decision clause — a behaviour a writer could carry into the feature, any client-owned value left as `<value>`. */
  decision: string({ min: 1, max: 400 }),
  why: string({ min: 1, max: 600 }),
  counter: string({ min: 1, max: 400 }),
  /** The requirement or principle it leans on, quoted with its id — or "general practice, not a source". */
  quotes: array(
    object({ feature: string({ max: 200 }), fr: nullable(integer({ min: 1 })), quote: string({ min: 1, max: 600 }) }),
    { max: 3 },
  ),
});
export type DirectionDraft = Infer<typeof Direction>;

export const ROUTES = ['question', 'default', 'fix', 'slot', 'rabbit-hole', 'discard', 'no-channel'] as const;
export type Route = (typeof ROUTES)[number];

export const DisposerSchema = object({
  dispositions: array(
    object({
      id: string({ min: 1, max: 12 }),
      route: oneOf(ROUTES),
      filter: optional(oneOf(FILTERS)),
      evidence: array(Evidence, { max: 4 }),
      survey: optional(array(Survey, { max: 4 })),
      /** One line: the case for the other disposition, so a reader can tell a scan from a shrug. */
      counterCase: string({ max: 400 }),
      /** Every candidate carries its drafted question and directions — the check judges the directions before any row exists. */
      question: object({
        title: string({ min: 1, max: 300 }),
        /** What prompted it, the client-only act its answer requires, and the requirement or slot it leaves blank. */
        whyAsked: string({ min: 1, max: 1500 }),
        clientAct: string({ max: 300 }),
        blank: string({ max: 300 }),
        touches: array(string({ max: 200 }), { max: 6 }),
        directions: array(Direction, { max: 3 }),
      }),
      default: optional(
        object({
          feature: string({ max: 200 }),
          block: oneOf(FEATURE_BLOCKS),
          sentence: string({ min: 1, max: 600 }),
          grounding: string({ max: 400 }),
          /** rule 4's four conditions, one clause each. */
          attestations: object({
            dominant: string({ min: 1 }),
            lowRisk: string({ min: 1 }),
            reversible: string({ min: 1 }),
            notClientOwned: string({ min: 1 }),
          }),
          doesNotDecide: string({ min: 1, max: 300 }),
          risk: oneOf(['high', 'normal'] as const),
          design: optional(string({ max: 60 })),
        }),
      ),
      fix: optional(
        object({
          feature: string({ max: 200 }),
          block: oneOf(FEATURE_BLOCKS),
          old: string({ min: 1, max: 1200 }),
          new: string({ min: 1, max: 1200 }),
          klass: oneOf(['i', 'ii'] as const),
        }),
      ),
      slot: optional(
        object({
          feature: string({ max: 200 }),
          block: oneOf(FEATURE_BLOCKS),
          what: string({ min: 1 }),
          shape: string({ min: 1 }),
          bounds: string({ min: 1 }),
          supplier: string({ min: 1 }),
        }),
      ),
      rabbitHole: optional(object({ feature: string({ max: 200 }), line: string({ min: 1, max: 600 }) })),
      noChannel: optional(object({ disposition: oneOf(['PROPOSE', 'RECORD'] as const), needs: string({ min: 1 }) })),
    }),
    { max: 60 },
  ),
  directives: array(string()),
});
export type Disposer = Infer<typeof DisposerSchema>;
export type Disposition = Disposer['dispositions'][number];

export const BlindSchema = object({
  verdicts: array(
    object({
      id: string({ min: 1, max: 12 }),
      route: oneOf(['question', 'default', 'fix', 'slot', 'discard'] as const),
      filter: optional(oneOf(FILTERS)),
      evidence: array(Evidence, { max: 4 }),
      /** Per drafted direction: stands, struck (a quote not in the document, or not writable as it stands), or rewritten. */
      directions: array(
        object({
          n: integer({ min: 1, max: 3 }),
          verdict: oneOf(['ok', 'strike', 'rewrite'] as const),
          rewrite: optional(Direction),
        }),
        { max: 3 },
      ),
    }),
    { max: 25 },
  ),
  directives: array(string()),
});
export type Blind = Infer<typeof BlindSchema>;

export type Exempt = 'contradiction' | 'marker' | 'project-level' | 'register' | null;

export interface Candidate {
  id: string;
  origin: 'lens' | 'sweep' | 'marker' | 'con' | 'volume' | 'vetoed' | 'carried-draft';
  pass?: string;
  lens: number;
  checklist?: string;
  feature: string | null;
  gap: string;
  grounding: { feature: string; block: string; quote: string }[];
  tag: 'question' | 'default' | 'fix' | 'slot';
  note?: string;
  depth: number;
  exempt: Exempt;
  con?: string;
  /** The carried marker this candidate transcribes: its feature and its text, patched to the row at write time. */
  marker?: { feature: string; text: string };
}

// ---- where evidence may sit ---------------------------------------------------------------------------------------------

/** A quote found where its `where` says: a feature («Name» and optional block), a question row, a ledger line in the log. */
export function evidenceFound(e: { where: string; quote: string }, s: Snapshot, logText: string): boolean {
  const feature = /«([^«»]+)»/.exec(e.where)?.[1];
  if (/^row\b|question/i.test(e.where))
    return s.questions.some((q) => quoteFound(`${q.question}\n${q.answer}\n${q.whyAsked}`, e.quote));
  if (/ledger|fix|manifest/i.test(e.where)) return quoteFound(logText, e.quote);
  if (feature) {
    const f = s.features.find((x) => x.name === feature);
    return !!f && quoteFound(f.content, e.quote);
  }
  if (/overview|NOT-clause|Operating/i.test(e.where)) return quoteFound(s.overview?.content ?? '', e.quote);
  return s.features.some((f) => quoteFound(f.content, e.quote));
}

/** The always-ask register: the Operating block's dated line naming topics no convention may settle (SKILL.md rule 4). */
export function registerTopics(s: Snapshot): string[] {
  const op = s.overview?.parsed.block('Operating')?.lines.join('\n') ?? '';
  const line = /always-ask register[^:]*:\**\s*([^\n]+)/i.exec(op)?.[1] ?? '';
  return line
    .replace(/[.*]+$/, '')
    .split(/[,;]| and /)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 3);
}

const READBACK_CUES =
  /\b(ask (somebody|someone) else|they (do not|don't) know|not theirs|outside adviser|cannot answer|can't answer|not the right person)\b/i;

export interface Checked {
  final: Route;
  /** Why the ordering landed here — logged with the demotion or the proposal. */
  why: string;
  unverified: boolean;
  /** The router offered no survey twice: written as a question, and named in the report. */
  routingRefused?: boolean;
}

/**
 * What bp checks in the disposer's answer before the blind check (Q3's quote discipline; Q4's survey obligation and the
 * undiscardable classes). A problem names what to fix; the disposer is sent back once.
 */
export function disposerProblems(
  d: Disposer,
  cands: readonly Candidate[],
  s: Snapshot,
  logText: string,
): string | null {
  const ids = new Set(cands.map((c) => c.id));
  const seen = new Set(d.dispositions.map((x) => x.id));
  const out: string[] = [];
  const missing = [...ids].filter((i) => !seen.has(i));
  if (missing.length)
    out.push(`no disposition for ${missing.join(', ')} — every candidate is disposed, none is parked`);
  for (const x of d.dispositions) {
    if (!ids.has(x.id)) out.push(`${x.id} is not a candidate`);
    const c = cands.find((k) => k.id === x.id);
    if (!c) continue;
    if (x.route === 'discard') {
      if (!x.filter) out.push(`${x.id}: a discard names its filter`);
      if (x.filter && QUOTED.has(x.filter) && !x.evidence.some((e) => evidenceFound(e, s, logText)))
        out.push(
          `${x.id}: a discard on "${x.filter}" quotes the text it rests on, verbatim — none of its quotes is found where it says`,
        );
      if (x.filter && SURVEYED.has(x.filter) && !surveyHolds(x.survey, s))
        out.push(
          `${x.id}: a routing to "${x.filter}" names the two or three requirements it surveyed, quoting each one's own sentence`,
        );
      if (!x.counterCase.trim()) out.push(`${x.id}: a discard carries its one-line counter-case`);
    }
    if (x.route === 'default' && !x.default)
      out.push(
        `${x.id}: a default carries its sentence, its grounding, the four attestations and what it does not decide`,
      );
    if (x.route === 'fix' && !x.fix) out.push(`${x.id}: a fix carries the old text and the new`);
    if (x.route === 'fix' && x.fix) {
      const f = s.features.find((k) => k.name === x.fix?.feature);
      if (!f || !quoteFound(f.content, x.fix.old))
        out.push(`${x.id}: the fix's old text is not in «${x.fix.feature}» verbatim`);
    }
    if (x.route === 'slot' && !x.slot) out.push(`${x.id}: a slot carries what, shape, bounds and who supplies it`);
    if (x.route === 'rabbit-hole' && !x.rabbitHole) out.push(`${x.id}: a Rabbit holes line carries its text`);
    if (x.route === 'no-channel' && !x.noChannel)
      out.push(`${x.id}: a disposition with no channel names it and what it needs`);
    if (x.route === 'question' && (!x.question.clientAct.trim() || !x.question.blank.trim()) && !c.exempt)
      out.push(`${x.id}: a question names the client-only act and the blank it leaves (Q4's two axes)`);
    if (!x.question.directions.length) out.push(`${x.id}: every candidate carries its drafted directions (1–3)`);
  }
  return out.length ? out.join('\n') : null;
}

function surveyHolds(survey: Disposition['survey'], s: Snapshot): boolean {
  if (!survey || survey.length < 2) return false;
  return survey.every((q) => {
    const f = s.features.find((k) => k.name === q.feature);
    return !!f && f.body.requirements.some((r) => r.n === q.fr) && quoteFound(f.content, q.sentence);
  });
}

/**
 * Q4's ordering, exactly (challenge.md Q4 "What a divergence does"): either side QUESTION writes a question unless the
 * other produced the full demotion evidence — a verbatim quote, four attestations, or a survey the blind side did not
 * read and disagree with; two different non-question verdicts route to DEFAULT; no second verdict keeps the first,
 * unverified. The four undiscardable classes are never demoted; a question at depth 3 or deeper is capped.
 */
export function decide(o: {
  c: Candidate;
  first: Disposition;
  blind: Blind['verdicts'][number] | null;
  s: Snapshot;
  logText: string;
  register: readonly string[];
  failedSurveyTwice: boolean;
}): Checked {
  const { c, first, blind } = o;
  const evidenced = (
    route: string,
    filter: Filter | undefined,
    ev: readonly { where: string; quote: string }[],
    survey?: Disposition['survey'],
  ): boolean => {
    if (route === 'default') return !!first.default;
    if (route === 'discard' && filter && QUOTED.has(filter)) return ev.some((e) => evidenceFound(e, o.s, o.logText));
    if (route === 'discard' && filter && SURVEYED.has(filter)) return surveyHolds(survey, o.s);
    return route !== 'question';
  };
  const cap = (r: Checked): Checked => {
    if (r.final !== 'question' || c.exempt || c.depth < 3) return r;
    return { ...r, final: 'rabbit-hole', why: `derived past the bound — depth ${c.depth} (Q3); ${r.why}` };
  };
  const touchesRegister = o.register.some((t) => `${c.gap} ${first.default?.sentence ?? ''}`.toLowerCase().includes(t));
  if (c.exempt)
    return {
      final: 'question',
      why: `${c.exempt === 'contradiction' ? 'contradiction-backed' : c.exempt === 'marker' ? 'a carried-marker transcription' : c.exempt === 'project-level' ? 'one of the two project-level questions' : 'on the always-ask register'} — never demoted`,
      unverified: !blind,
    };
  if (o.failedSurveyTwice)
    return cap({
      final: 'question',
      why: 'routing refused — no survey offered',
      unverified: !blind,
      routingRefused: true,
    });
  // Q3: a discard whose quote cannot be produced is invalid, and the candidate is proposed — whatever the other side said.
  if (
    first.route === 'discard' &&
    first.filter &&
    QUOTED.has(first.filter) &&
    !first.evidence.some((e) => evidenceFound(e, o.s, o.logText))
  ) {
    return cap({
      final: 'question',
      why: `the "${first.filter}" discard's quote is not found where it says — invalid, so the candidate is proposed`,
      unverified: !blind,
    });
  }
  if (first.route === 'default' && touchesRegister)
    return cap({ final: 'question', why: 'the always-ask register bars a default on this topic', unverified: !blind });
  if (!blind)
    return cap({
      final: first.route,
      why: 'no second verdict — the first routing stands, unverified',
      unverified: true,
    });
  const a = first.route === 'rabbit-hole' || first.route === 'no-channel' ? 'discard' : first.route;
  const b = blind.route;
  if (a === b) return cap({ final: first.route, why: 'both verdicts agree', unverified: false });
  if (a === 'question' || b === 'question') {
    // The survey exception: a blind QUESTION from a side that held the surveyed sentences defeats the finding.
    if (b === 'question' && first.route === 'discard' && first.filter && SURVEYED.has(first.filter))
      return cap({
        final: 'question',
        why: 'the blind side read the surveyed sentences and disagreed',
        unverified: false,
      });
    if (a !== 'question' && evidenced(first.route, first.filter, first.evidence, first.survey))
      return cap({
        final: first.route,
        why: `demoted on the router's evidence (${first.filter ?? first.route})`,
        unverified: false,
      });
    if (b !== 'question' && evidenced(b, blind.filter, blind.evidence)) {
      // The blind side's demotion needs a draft for its channel — only a discard is fully carried by its evidence.
      if (b === 'discard')
        return {
          final: 'discard',
          why: `demoted on the blind side's evidence (${blind.filter ?? 'discard'})`,
          unverified: false,
        };
    }
    return cap({
      final: 'question',
      why: 'either verdict is QUESTION — the pipeline fails open to asking',
      unverified: false,
    });
  }
  // Both non-question but different: DEFAULT, the most conservative — where a default was drafted.
  if (first.default)
    return cap({
      final: 'default',
      why: `the two verdicts differ (${a} against ${b}) — routed DEFAULT, the disagreement printed on its ledger line`,
      unverified: false,
    });
  return cap({
    final: 'question',
    why: `the two verdicts differ (${a} against ${b}) and no default was drafted — written as a question`,
    unverified: false,
  });
}

/** The read-back gate (Q4, v30): a drafted Why asked saying its own reader cannot answer it is not written. */
export const failsReadBack = (whyAsked: string, exempt: Exempt): boolean => !exempt && READBACK_CUES.test(whyAsked);

export function disposerBrief(o: {
  cands: readonly Candidate[];
  s: Snapshot;
  index: string;
  rows: string;
  discards: string;
  ledger: string;
  register: readonly string[];
}): string {
  return [
    '# Dispose every candidate (challenge.md Q3–Q4)',
    '',
    `Candidates: ${o.cands.length}. Every one ends in exactly one route; a QUESTION only through the two-axis admission gate.`,
    `Always-ask register (no default may settle these): ${o.register.join(' · ') || '(none recorded)'}.`,
    '',
    ...o.cands.map((c) =>
      data(
        `${c.id} · ${c.feature ? `«${c.feature}»` : 'project-level'} · ${c.origin}${c.lens ? ` lens ${c.lens}` : ''}${c.checklist ? ` · ${c.checklist}` : ''} · depth ${c.depth}${c.exempt ? ` · never demoted (${c.exempt})` : ''}${c.con ? ` · ${c.con}` : ''} · tagged ${c.tag}`,
        [
          c.gap,
          ...c.grounding.map((g) => `grounding «${g.feature}» ${g.block}: "${g.quote}"`),
          c.note ? `note: ${c.note}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ),
    '',
    data('the requirement index — every feature', o.index),
    data('every existing question row, any status', o.rows),
    data(
      "prior runs' discard lines — a candidate matching one is discarded on the original filter, re-cited and re-tested",
      o.discards || '(none)',
    ),
    data('the standing defaults ledger', o.ledger || '(none)'),
  ].join('\n');
}

export function blindBrief(o: {
  cands: readonly Candidate[];
  drafts: ReadonlyMap<string, Disposition>;
  s: Snapshot;
}): string {
  return [
    '# Blind disposition check (challenge.md Q4)',
    '',
    "Re-derive each candidate's disposition from the candidate and its grounding alone. You are not told how it was first routed.",
    'Then judge each drafted direction: `ok`, `strike` (a quote not in the document, or a direction a writer could not carry into the feature as it stands), or `rewrite` it pointable.',
    '',
    ...o.cands.map((c) => {
      const d = o.drafts.get(c.id);
      return data(
        `${c.id} · ${c.feature ? `«${c.feature}»` : 'project-level'} · depth ${c.depth}`,
        [
          c.gap,
          ...c.grounding.map((g) => `grounding «${g.feature}» ${g.block}: "${g.quote}"`),
          ...(d?.survey?.map((q) => `surveyed «${q.feature}» FR-${q.fr}: "${q.sentence}"`) ?? []),
          ...(d?.question.directions.map(
            (x, i) => `direction ${i + 1}: ${x.decision} — why: ${x.why} — counter-case: ${x.counter}`,
          ) ?? []),
        ].join('\n'),
      );
    }),
  ].join('\n');
}
