# Run — questions

**Grill the Blueprint**: adversarial passes over the whole document generate question **proposals** from
what it cannot answer yet; a human turns the ones they approve into real questions — in the UI at their
own pace, or at a review sitting they ask for. **The run never interrogates by default: it writes every
survivor, prints the report, and stops.** Answering the questions is what solidifies the document — a
gray area a builder would have filled in silently becomes a decision somebody actually made.

Run on demand — *"grill this spec"*, *"what should we be asking?"* — and automatically at the end of
[`init.md`](init.md) I7 and [`add.md`](add.md) A5, and one final time before a lock
([`lock.md`](lock.md) L1). Either way it is these six phases, in this order. The battery costs what
completeness costs; **an embedding run's owner may defer the handoff to a standalone sitting** — say so,
log the deferral, and the markers that run minted stay visibly `carried` until the sitting happens
([`status.md`](status.md) C5 keeps naming them).

**A proposal is not a question.** It lands at `Status = Proposed`, invisible to every open-questions view,
and becomes real only when a named person approves it one row at a time. **No run ever approves its own
proposal.**

**Every candidate that survives the filters ends in exactly one of four dispositions — and a question is
the rarest of them.** A **QUESTION** is written only for a gap whose answer is an act only the client can
perform AND whose absence leaves a named part of this document unwritable (the Q4 admission gate, both
axes). A gap settled by one dominant convention becomes a **DEFAULT** — written
into the feature body as labeled, vetoable text under [`SKILL.md`](SKILL.md) rule 4's carve-out, listed in
the run's defaults ledger for explicit batch ratification. A gap whose answer is content the client will
produce becomes a **CONTENT SLOT** — the document defines the slot, the content manifest collects the
items for one batched sign-off (Q4). A genuine correction to existing text — stale
wording, an under-counted list, an internal contradiction with a mechanically checkable winner — becomes a
**DOC-FIX**, applied through the serial commit path and ratified as one batch. Everything else is
discarded on a stated filter, and **an engineering discard is a record, not a disappearance**: the
builders'-call discards are grouped under their own report heading so a reviewer can veto any of them
back into the pipeline with one word. *Measured before this rule existed: of 693 written questions, 4.8% needed
the client; 442 were settled by ordinary convention, 137 by the document or the ratified design the run
already held. The tool's job is to catch missing areas, not to convert every convention into review
work.* One diagnostic belongs to the report, never to any pass: **a feature exceeding roughly one open
question is a routing check, not thoroughness** — the Q6 report names which channel leaked; legal- and
compliance-heavy features legitimately exceed it.

**Why the state exists at all.** A generated question that lands straight in the open-questions list
acquires the authority of one somebody asked. The list then reads as the project's real unknowns while
holding a machine's guesses about what might be unknown — and **the best agent on the nearest benchmark
finds 44.4% of real gaps**, so most of what this phase produces is noise and none of it is authoritative.
**An empty proposal list is never evidence the Blueprint is complete.**

Specs obeyed, not restated: [`spec/doc-shape.md`](spec/doc-shape.md) ·
[`spec/databases.md`](spec/databases.md) · [`spec/targets.md`](spec/targets.md).

**Run the seven pre-flight checks in [`SKILL.md`](SKILL.md) first.** This run works the same on a locked
Blueprint — proposals and marker links are the question layer, not product intent, so they need no
change-log entry ([`lock.md`](lock.md) L4 draws that line).

---

## Q1 — Reconcile what a human already did

**First, and before anything is generated**, read every question row and take account of what people did
since the last run — in the UI, at their own pace, without this skill.

- `Proposed → Open`: **a human approved it.** Accept that. Give it an owner if it has none, by asking.
- `Proposed → Rejected`: **a human rejected it.** Accept that, and read `Answer & why` for the reason so
  Q6 can dispose of any marker that was waiting on it.
- `Rejected`, but `Answer & why` reads as a **decisive answer** rather than a rejection reason — a
  **rejected-with-answer discrepancy.** It happens when a machine pass or a hurried reviewer records the
  decision in the rejection field, and the decision then exists nowhere the resolve seam can reach. The
  run never flips it — a human's status stands ([`SKILL.md`](SKILL.md) rule 1) — but it **names every
  such row in the report, quoting the answer-shaped text**, so its human can confirm the rejection or
  move the row to `Answered` themselves. Measured cost of not looking: on 2026-08-14 an owner directive
  revived ten such rows in one sitting — decisions that had sat unreachable behind a `Rejected` status
  since the pass that misfiled them. The report line makes that a routine glance instead of an
  archaeology dig.
- `Proposed → Answered`, moved in the UI with an answer written: **a human approved and answered in one
  move** — both acts at their strongest, made at their own pace in their own tool. Accept it: patch any
  marker waiting on it with the row link, and backfill `Owner` by asking if it is empty. The row is
  resolve-eligible as it stands ([`spec/databases.md`](spec/databases.md) §4); nothing routes it back
  through `Open`. An `Answered` row with an **empty** `Answer & why` is different — that is a status with
  no answer behind it: report it and leave it, a discrepancy for its human ([`SKILL.md`](SKILL.md) rule 1).
- `Proposed`, edited wording: accept the human's wording as the question. Never restore the original.
- A `Key` value changed by a human (legacy projects only — the flag is retired, Q4): **their move
  wins.** Read, never edited; the run neither derives nor writes `Key` anywhere.
- Anything at `Open`, `Answered`, `Applied`, `Flagged`, `Closed (not applied)` or `Rejected`: not this
  run's business, except as duplicate-detection input at Q3.

**A run never reverses a human's move**, and never re-proposes something a human rejected unless new
source material bears on it — in which case it is proposed once, citing the earlier rejection so the
reviewer can see they are being asked twice and why.

**A field a human has set is read, never edited —
not even to blank it, and not even where doing so seems to enforce this file's own gate correctly.**
[`SKILL.md`](SKILL.md) rule 1 is the single home of this and bars clearing exactly as much as setting; a
row that looks prematurely moved is reported as a discrepancy and left alone — there is never a reason to
touch what a human wrote to make a row ineligible.

This phase is first because generating before reading it means proposing questions somebody already
approved this morning. **Open the run-log entry here**, before any proposal is written, and close it at
the end ([`SKILL.md`](SKILL.md) pre-flight check 5).

---

## Q2 — The grilling

Over the Blueprint **as it stands now**, not as some earlier run left it. This is not a checklist pass —
it is an attack, and it is **the full battery, every time — there is no light mode.** A single
whole-document pass per lens is a sampler with a measured sub-50% ceiling, and every re-run to catch its
misses costs a round of answers collected twice; the owner chose completeness over a cheap sampler
(2026-08-07). **Five adversarial lenses, each run as its own pass with its own framing**, because a
reader looking for everything finds the average of it; a reader trying to break one thing finds it. This
phase is the single home of the lenses — [`init.md`](init.md) I2, [`add.md`](add.md) A2 and
[`lock.md`](lock.md) L1 all point here and restate nothing.

**Lens 1 — the builder who must not guess at what the client owns.** Walk each feature as if implementing
it tomorrow, forbidden from silently deciding anything **the client owns** — money, legal posture, brand,
scope, dates, their own facts. Every place you would have to stop and ask *the client* — which record and
whose data where the answer changes what somebody is promised, what happens on a tie where the tie is a
commitment — is a candidate. A place where you would simply follow the trade's convention — a minimum
password length, a generic error message, a retry count — is **not a question**: state the convention and
emit it as a `default` candidate for the DEFAULT channel. This is the lens that finds what a checklist
cannot, because it reads the document the way its real consumer will — and its real consumer is allowed
to know their trade.

**Lens 2 — the hostile tester.** Attack each numbered requirement: try to construct an input, a state or
a sequence the sentence does not decide. **The two-drafts test is the sharpest tool here** — draft both
behaviours a requirement could mean and compare; where the drafts diverge, the divergence itself names
the question. Readings that disagree catch what asking *"is this ambiguous?"* misses, and reasoning
harder does not close that gap. **A constructed case is a candidate only if both halves hold:** the state
is **reachable** under the document and the ratified design as they stand, and a requirement actually
**hangs on** which reading wins. A state the flows cannot produce, or a divergence with no observable
consequence, is discarded on the spot — measured cost of skipping this test: 19 of 80 rejected questions
were unreachable hypotheticals or false premises.

**Lens 3 — the first week of real life.** Data lifecycle (where does it come from, who can see it, when
does it die) · empty, error, slow, offline · permissions and who-may-do-what · anything touching money ·
what exists on day one before there is any data · what happens to in-flight things when something is
cancelled or changed.

**Lens 4 — collisions and boundaries.** Where two features touch the same record or state and neither
says who wins · where a feature's edge touches another feature, a third party, or money, and nothing says
which side of the line it falls · anything the overview's NOT-clause should refuse and does not.

**Lens 5 — who is this for, really.** Reconcile the overview's `Who it's for` block against the features,
in both directions. **A named user kind no feature serves** — walk each kind's line and find the
requirement that delivers the job it hires the product for; none is a candidate. **An actor the
requirements keep naming that `Who it's for` never does** — "the organiser", "a carrier", "staff" doing
things in `Behaviour` blocks while the audience block is silent about them; every such actor is a
candidate. **A job with no requirement behind it, and a feature no named kind wants** — both read as
essence gaps, not feature gaps. **A product paragraph that never says what winning looks like** — no
observable change anywhere that would tell anyone this worked ([`spec/doc-shape.md`](spec/doc-shape.md)
§3) — is a candidate, phrased as *what one or two observable things would tell you this worked?*, never
answered with an invented number. And where the sources named no audience at all, **the audience itself
is the proposal**: ask who this is for, never invent a persona to fill the silence. This lens exists
because a document can hold ten well-grilled features and still not say who the product is for or what
success means — every other lens reads the features, and only this one reads the front door against them.

**The lenses run at two scopes, and absence gets its own passes:**

1. **Per-Area passes.** Lenses 1–3 are dispatched once per `Area` as well as once whole-document, each
   Area pass briefed with that Area's full feature bodies, the overview's NOT-clause, **the whole-document
   snapshot, and the ratified-design survey where one is on record** — a pass that cannot see the rest of
   the document generates candidates the document already answers, and a pass that cannot see the design
   asks for what a drawn screen plainly shows (measured: 94 doc-answered and 50 design-answered rows in
   one backlog, none catchable by the pass that minted them). The design survey enters as a **recorded
   source artifact**: a working-folder source record naming the file, version, capture date and who
   ratified it — cited like any source, frame references and all; with no such record on file, no
   design-grounded disposition is available and nothing pretends otherwise. Lens 4 runs once per
   Area-pair where two Areas share records or actors; lens 5 stays whole-document, once — it is
   definitionally the front door against everything. **Every pass disposes before it emits:** it first
   tries to answer each of its own candidates from its brief — the document, the design record, or one
   dominant convention — and an answered candidate is emitted tagged `default` or `fix` with its
   grounding, not as a question candidate. **An empty pass is a reported success, never a failure to
   compensate for.** Per-pass candidate counts are logged and the distribution printed in the run-log
   entry, so a quota-shaped fingerprint is a visible anomaly rather than an invisible norm.
2. **Absence sweeps — whole-document, checklist-framed.** A pass over existing text can only interrogate
   what is written; these ask the opposite question: *which of these does NO feature cover?* One dispatch
   per checklist: account lifecycle (sign-up · sign-in · sign-out · credential change · deletion) · data
   lifecycle (creation · visibility · export · retention · deletion) · platform matrix and versioning,
   including forced upgrade · permissions and roles, per actor · money, anywhere priced, refunded or
   limited · notifications, including opt-out and quiet failure · legal, privacy and accessibility ·
   empty and first-run states · **trust and integrity** — per claim the product accepts on faith: what a
   bad-faith actor gains by lying to it, and what if anything is checked · **timing and commitment
   windows** — per event the document says happens: how far ahead, how long after, what counts as late.
   The one measured catch of this shape — a product with no sign-out anywhere
   in its document — was found by an improvised sweep of exactly this kind, not by the lenses; and the
   only two outright misses in a five-project measured lab both fell exactly where the last two classes
   now stand — a fakeable one-tap log nobody questioned, and a publish deadline nobody asked. That lab
   (2026-08-07, 77 planted defects) measured the full battery at **~86% caught outright, ~97% at least
   detected, zero hallucinated contradictions** — against the ~44% single-pass ceiling the preamble
   cites, and still never a completeness certificate.
3. **One repeat round, budget-stated.** Any pass that surfaced two or more candidates surviving Q3 **in
   any disposition — question, default, or fix alike** — is dispatched once more, fresh. (Counting only
   written questions would starve the round exactly when the disposition channels are doing their job,
   and the round's measured yield includes real client questions.) **Two rounds is the budget, not a
   completeness claim** — a round finding nothing new means this generator is dry, never that no gaps
   remain.

All passes are read-only over the same snapshot and dispatch concurrently, in waves of no more than ten
([`SKILL.md`](SKILL.md) rule 8); their findings merge before the standing sweep and Q3.

**And the standing sweep, after the lenses** — the mechanical part:

1. **Open markers with no question behind them** — every `→ Question: carried` marker
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9). These are first: a marker is a gap somebody already
   agreed was a gap.
2. **Contradictions** carried in from [`init.md`](init.md) I2 or [`add.md`](add.md) A2 — between two
   sources, or between a source and what the Blueprint says. Each gets **one blocking question** naming
   both sides. Where the marker cites a `CON-k`, **dereference the run-log entry it names and work from
   the verbatim quotes there**, never from the marker's compressed wording alone.
3. **A `Behaviour` block with no numbered requirement**, or a feature whose body is still the empty
   skeleton.
4. **A `Not doing` line with no `revisit if:`** — a refusal without a reopening condition becomes dogma,
   and dogma is what people route around instead of citing. **The run never invents the condition**; it
   proposes a question naming the line.
5. **A decided exclusion still sitting loose in prose**, which is a `Not doing` line waiting to be
   written, **never a question** — turning a made decision back into a question is how settled things come
   unstuck.

**Why lens 1 leads.** Target ambiguity is the axis that turns a wrong guess into a wrong-*target* action —
Wrong Target moves from 9.6% to **75.1%** when the target is unstated (Ji et al.) — and whoever builds
this will not raise the question themselves: baseline agents ask on **24.12%** of underspecified tasks.
The grilling exists to ask it for them, before the guess gets built.

**Every proposal must name what prompted it.** That sentence goes in `Why asked` and it is not optional:
a reviewer meeting the row cold, in a list, with no context, approves on the strength of its wording
rather than the strength of the gap.

---

## Q3 — Deduplicate, then discard on a stated filter

**Against every existing row, in every status** — including `Rejected` and `Closed (not applied)`. A
second row does not fix a vetting problem, it hides it. Offer a merge instead of a near-twin.

**A candidate discarded on none of these filters was discarded on taste.** Every discard is listed in the
report with its filter **and its one-line counter-case**, so a reader can tell a scan from a shrug.

**A discard on the "already answered" filter must quote the text that answers it, verbatim.** Naming the
place is not enough: a discard citing *"already answered, FR-1"* against an `FR-1` that does not contain
the fact is a candidate silently dropped on a citation nobody checked, and it reads on the report exactly
like a good discard. **If the quote cannot be produced, the discard is invalid and the candidate is
proposed.** The same applies to the `Duplicate` filter, which quotes the row it points at.

**At volume — an exhaustive sitting, a backlog drain — dedup runs in batches**, each batch checked
against every existing row and against this run's already-accepted candidates, the quote discipline
holding per discard. **Doubt is priced per filter, not blanket-resolved toward proposing.** Doubt about
**duplication** still proposes — a false merge silently converts a known unknown into an unknown unknown,
and a duplicate costs a reviewer one `[r]eject` while a false merge costs the project a question nobody
will ask again. Doubt about **convention or design** routes to the DEFAULT channel or the design-adoption
ledger line instead — every line there is visible, grounded and vetoable, so nothing is lost by routing
and much is lost by asking: the measured cost of resolving all doubt toward proposing was a 693-row
backlog no human could review.

| Filter | Discard when | Instead |
|---|---|---|
| **Already answered** | A requirement, an `Edge cases` line, a `Not doing` line or the NOT-clause answers it — **and you can quote the sentence** | Link to the answer, quoting it |
| **Shown by the ratified design** | A ratified frame on the design-source record plainly shows it, **and following the drawing is safe, lawful and consistent with the document** | **Never a silent discard**: a frame-cited `adopted from design` entry on the defaults ledger, vetoable like any default. A drawing that itself embodies a risk — a child-operable consent control was the measured case — is a fork put to the client, not an adoption |
| **Settled by convention** | [`SKILL.md`](SKILL.md) rule 4's four conditions all hold, each attested, and nothing on the never-defaultable list or the always-ask register is touched | Route to the **DEFAULT** channel (Q4) |
| **Correction, not question** | Existing text is wrong in a way with a mechanically checkable winner (Q4's DOC-FIX admission) | Route to the **DOC-FIX** channel (Q4) |
| **Duplicate** | A question row already asks it, in **any** status | Point at that row |
| **Implementation, not intent** | The answer changes how it is built, not what the feature is — **unless materiality holds**: the choice (M1) alters a promise a user or the client can observe, (M2) sits on a project-specific, historically expensive failure this project has named, or (M3) is externally mandated. Where materiality holds, the document records the observable constraint in one sentence, never the mechanism; where it does not, retry counts, teardown ordering, storage housekeeping and their kin are the builders' to decide | A `Rabbit holes` line, or nothing |
| **Unanswerable here** | It turns on a party outside this project, or nobody can decide yet | Name it in the report; no row |
| **Client-internal** | The answer changes nothing this delivery team builds — the client's own staffing, internal process, legal operations, marketing plans. Passing Q4's client-only-act test does not save it: the act is theirs, and so is the question | Name it in the report under its own heading; no row, no marker. Where the client genuinely needs prompting, it belongs in the client packet's covering note, not the PRD |
| **Deliverable content, not a decision** | The answer is content the client will produce — a catalog, a scene list, copy, artwork — rather than a decision about behaviour | Route to the **CONTENT SLOT** channel (Q4): the document defines the slot; the content arrives on the content manifest's one batched sign-off, never as per-item questions |
| **Already decided against** | It is a decided exclusion | A `Not doing` line, never a question |

**The dedup also runs in reverse — once per sitting, against the standing `Proposed` backlog.** Dedup as
stated above only stops *new* candidates duplicating what exists; nothing re-reads the rows already
sitting `Proposed` against a document that has moved since they were written. After enough resolve runs
the backlog silently fills with questions the current text now answers — measured on 2026-08-14: a
classifier pass over 316 standing rows found 40 fully settled by then-current text, none of which any
report had named. So: sweep every standing `Proposed` row against the current document under the same
quote discipline, and list each **fully**-settled one in the report under *"Already settled — recommend
closing"*, quoting the text that answers it. **The run closes none of them** — `Proposed` is
machine-set, but the disposal is a human's call, made in the UI or by directive at a sitting
([`SKILL.md`](SKILL.md) rule 1). A partly-settled row is left alone: half an answer is not an answer.

---

## Q4 — Dispose, then write

**Every candidate that survives Q3 is disposed this sitting — no found gap is parked, and no disposition
is silent.** A found gap that lands nowhere is a gap the next run has to find again — the measured cost of
parking is real: on one project the carried backlog grew to ~80 known gaps with no row behind them. But a
found gap written as a question when a channel already holds its answer is review work manufactured out of
nothing — the measured cost of that was 693 rows, 4.8% of which needed a client. So every survivor takes
exactly one of three routes, and the route is decided **before** anything is written:

**The admission gate — what earns a `Proposed` row. Two axes, both required.** A QUESTION is written only
if its `Why asked` names **(a) the client-only act its answer requires** — committing their money,
calendar, contractual scope, legal or IP posture, or brand voice, or disclosing a fact resident only in
their world, including the meaning of a term they coined — and **(b) what this document cannot say until
it is answered: the named requirement, slot, or acceptance criterion that stays blank**, cited by feature
and sentence. (b) is the build-gating test, satisfied by **any** of: a citable blank · a topic on rule 4's
never-defaultable list (whose blank may be genuinely uncitable — a pricing gate blanks no single
sentence and still gates the build) · a contradiction between sources. *(v12: (b) was previously "what
goes wrong outside the codebase if it is never answered" — a test that points away from the build and
admits the client's internal operations verbatim; the build-gating criterion existed all along as the
`Key` triage flag, applied after admission to rank rows — the wrong lever. It is promoted here and the
flag retired.)* **A candidate that passes (a) but not (b) is the client's business, not this
document's** — discarded on the client-internal filter, one report line each. A technical-looking
candidate passes only where its options map to **different client
commitments**; commercially and legally equivalent options are the builders' call. An operational
candidate passes only where the real ask is a **paid commitment beyond the delivery's scope**. A broad
candidate is narrowed to its client-owned atom — and the shed remainder routes to the DEFAULT channel
**only if it independently passes rule 4's four conditions; any part that fails stays inside the written
question.** Two classes bypass the gate entirely, in opposite directions: **contradiction-backed
candidates** always write (both quotes, both source names), and **carried-marker transcriptions whose gap
is client-bound** always write — while a carried marker whose gap the convention test settles routes to
the DEFAULT channel, its marker patched to the ledger line per
[`spec/doc-shape.md`](spec/doc-shape.md) §9 route 6.

**The DEFAULT channel.** Each candidate the convention or design filters routed here is written into its
feature body as `Default (standard practice — ratify on review): …` — or its design twin,
`Default (adopted from the ratified design, frame N — ratify on review): …` — one labeled sentence
stating the adopted behaviour, tagged with run id and date, through the serial commit path
([`SKILL.md`](SKILL.md) rule 8), never overriding existing text. Every default also lands as one line on
the run's **defaults ledger** (run log + report): the sentence, the grounding, the four attestations, and
what client-owned thing it does not decide. The ledger is **risk-sorted** — anything adjacent to the
always-ask register or irreversible first — and **capped at what one sitting can honestly ratify**;
overflow defaults stay written and labeled but head the next sitting's ledger.

**The DOC-FIX channel.** Machine-applied only where the winner is mechanically checkable: **(i)**
doc-internal staleness — both quotes doc-side, one demonstrably superseded by a resolve-applied answer on
record; **(ii)** an under-enumeration or stale line amendable from one verbatim quote plus the feature's
own stated behaviour. Exact replacement wording, applied through the serial commit path, every fix listed
in the report for **one explicit batch ratification**. **A doc-vs-design contradiction is never a fix** —
it is surfaced as a question with both quotes ([`SKILL.md`](SKILL.md) rule 4's no-ranking clause); where
neither side of any conflict can win mechanically, the candidate converts to a QUESTION through the gate.

**The CONTENT SLOT channel** (v12, generalising the brand-copy clause — the one content class rule 4
already handled this way). Where a gap's answer is **content the client will produce** — a catalog, a
scene list, copy beyond brand voice, artwork, media — the run writes the **slot**, never the ask: one
labeled line in the feature body,
`Content slot — client-supplied: <what> · <shape/format> · <cardinality or bounds> · <who supplies>`,
through the serial commit path, plus one line on the run's **content manifest** (run log + report). The
manifest is put to the client as **one batched sign-off**, exactly as brand copy's final wording is —
never one question per item, because a per-item ask converts a delivery checklist into review workload.
A slot may carry neutral **illustrative** examples, labeled as such, where the body needs them to read.
What stays a QUESTION: a decision *about* the content that changes behaviour — whether a category
exists at all, whether content is moderated, who may see it — passes the gate on its own merits.

**The disposition check — the same pre-write dispatch, wider verdict.** The second-model dispatch that
verifies suggested directions ([`SKILL.md`](SKILL.md) rule 6) **re-derives every candidate's
disposition blind** — from the candidate and its grounding alone, never shown the first routing. **What a
divergence does is decided by what the two verdicts are, and this ordering is exact** *(v12 — the earlier
text both mandated escalation on any divergence and permitted demotion on evidence, in the same
paragraph, leaving the operator's behaviour undetermined between two readings with opposite costs)*:
- **Either verdict is QUESTION** → the candidate writes as `Proposed` — **the pipeline fails open to
  asking, never to silence** — *unless* the non-question verdict produced the full demotion evidence (a
  verbatim quote, or a convention with all four conditions attested), in which case the evidence wins and
  the demotion is taken, logged with its quote.
- **Both verdicts are non-question but differ** (DEFAULT vs DOC-FIX vs CONTENT SLOT): the two agree the
  client is not needed — that agreement stands. Route to **DEFAULT**, the most conservative of the three
  (labeled, ledgered, vetoable), with the disagreement printed on its ledger line.
Never demoted, regardless of grounding: carried-marker transcriptions of
client-bound gaps, and anything the document records as awaiting client sign-off or ratification. Every
demotion is logged with its grounding quote, and the run-log entry prints the funnel fresh: drafted →
routed default → routed fix → routed slot → written `Proposed`. **The entry ends with the same
cost-and-outcome line resolve's R5 requires** — dispatches · tokens · wall-clock, marked self-reported,
beside the funnel counts that are recountable.

**Every carried marker with no row behind it is disposed too** — transcription first, then the same gate
and channels as any candidate: the marker already names its entity; a client-bound gap becomes a row whose
`Why asked` cites the marker and the run that minted it, and a convention-settled one becomes a default
with the marker patched to its ledger line. After this phase, `carried` reads zero until the next write
run mints more.

**On a locked Blueprint, defaults and doc-fixes are product-intent writes:** each sitting that lands any
appends its change-log entry per [`lock.md`](lock.md) L4 — proposals and marker links remain the question
layer and still need none.

**The run does not open a review sitting on its own — it writes, reports, and stops.** A person reviews
in the `Proposed — needs review` tab at their own pace, and Q1 reconciles every move next run; Q5 runs
only when a person asks to go through the rows together. Where a sitting does run, about ten rows are
offered at a time and no more — past that people stop reading and start agreeing, which is worse than a
shorter list. **Order the list — in the report and at any sitting — marker-backed candidates first** — a
marker is a gap somebody already agreed was a gap, and it blocks `Intent = Agreed` on its feature; that
precedence is never demoted beneath any judgment — **then by how much the answer changes
what gets built and by whether the named owner can actually answer
it**: an ordering policy reaches near-ceiling with 3.0 questions against 5.1 unordered. Say the list is
ordered and on what. It is a judgement and it is labelled as one.

**The `Key` checkbox is retired** (v12). It was added 2026-08-07 to triage a write-all backlog — "top
questions or full" against 693 rows — and its criterion, *the document cannot sensibly be built without
the answer*, is now axis (b) of the admission gate itself: every row that exists passes it, so a flag
distinguishing the build-gating rows distinguishes nothing. The compensator for over-generation is gone
because the generation is gated at the cause. **On an existing Blueprint the column simply goes inert** —
human-set values are never edited or deleted ([`SKILL.md`](SKILL.md) rule 1), no run reads or writes it
again, and each row's one-line criterion survives as the closing clause of its `Why asked`. **If a future
project ever produces real question volume again, that is the admission gate failing — fix the gate;
do not resurrect the flag.**

**Writing a row and patching its marker are one act.** The marker's `→ Question: carried` becomes the row
link at write time — a `Proposed` row is a real destination for a marker, and the marker goes on blocking
`Intent = Agreed` until the answer is applied. A later rejection removes or keeps the marker by its
reason, exactly as [`spec/doc-shape.md`](spec/doc-shape.md) §9 routes it.

Each proposal row: `Question` phrased **as a question**, in one sentence · `Why asked` naming what
prompted it and **whether a marker is already waiting on it**, because that changes what rejecting costs —
and, on a contradiction-backed proposal, **carrying both verbatim quotes with both source names**, never
a paraphrase: the reviewer judges the disagreement itself, not the run's summary of it ·
`Touches` set where it is feature-scoped, empty where it is project-level · `Status: Proposed` ·
**`Owner` suggested in the report, never written on the row** — a name in `Why asked` prose would be a
content-rule finding ([`spec/doc-shape.md`](spec/doc-shape.md) §6), and the owner is part of what the
human approves.

---

## Q5 — The review sitting — on request only

**The run never starts this uninvited.** The default is no sitting: rows written, report printed, and the
review done in the `Proposed — needs review` tab at the reviewer's own pace — approve (→ `Open`), reject
(reason in `Answer & why`), or answer directly (→ `Answered`), each move reconciled by Q1 next run. This
phase runs when a person asks to go through the rows together.

**Then: ask one row at a time, never as a list.** The same seven minutes put as a list produced two of five
accepted and no owners; put one row at a time it produced five of five with a named owner each. *Every
item put to a person as more than one act produces one act.*

```
PROPOSED (6) — none of these is a question yet. Ordered by how much the answer changes.

  1/6  «Can a customer retry a failed payment?»
       why asked: «Checkout» FR-2 says payment succeeds or fails; no source says what
                  happens next, and no edge case covers it
       a marker on «Checkout» is waiting on this — rejecting it decides the marker too
       suggested owner: Ana
       [a]pprove · a[n]swer now · [e]dit · [r]eject · already [d]ecided · [s]kip
```

**Six outcomes, and the middle three are the ones the design turns on:**

| Outcome | The row becomes | The marker waiting on it |
|---|---|---|
| **Approve** | `Status: Open`, owner named | patched with the row link |
| **Answer now** | `Status: Answered` — their move, made in the room — with **their words verbatim** in `Answer & why` and their name as `Owner` | patched with the row link; the next `resolve` removes it when the answer is applied |
| **Edit, then approve** | `Status: Open`, **the human's wording verbatim** | patched with the row link |
| **Reject — not a real gap** | `Status: Rejected`, reason in `Answer & why` | **removed**, citing the rejected row ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 4) |
| **Already decided** | `Status: Rejected`, pointing at what answers it | **removed**, citing the requirement or `Not doing` line that answers it |
| **Reject — ask it better** | `Status: Rejected`, reason names the reword expected | **stays `carried`** — the gap is real, only the wording was wrong |
| **Skip / no answer** | stays `Proposed` | stays `carried`, re-offered next sitting |

**Rejecting requires a reason, and the reason is what decides the marker.** Without that split, rejecting
a badly-worded proposal either strands its marker forever — blocking `Intent = Agreed` on that feature
with nothing in any file able to clear it, so the document can never honestly be settled — or silently removes
it, which converts a known unknown into an unknown unknown. Both happened before the reason was asked for.

**Silence is not a decline.** A skipped item is recorded `unanswered` and re-offered next run. One project
produced thirteen silent proposals that a two-outcome review would have suppressed forever, three of which
its owner later wrote out herself, alone. The log carries
`review: 6 offered · 3 approved · 2 rejected · 1 unanswered`; **`unanswered` climbing run over run means
cut the ten to five before adding anything to it.**

**After ten rows, ask exactly one more question: *continue with the next ten now, or stop here?*** A yes
is a fresh round in the same conversation — same rules, same ordering, next ten. A no, or silence,
stops: everything unoffered stays `Proposed`, counted in the report, waiting in the tab. Several rounds
back-to-back in one day is the honest way to clear a drained backlog before a client meeting — and the
one-sitting attention measurements do not cover marathons, which is exactly why continuing is asked,
never assumed.

**A rejection is told what it leaves**, at the review and not in the report afterwards: *"rejecting this
as not a real gap removes the marker on «Checkout» — that feature can then be agreed."* Or, for a reword:
*"the marker stays and «Checkout» still cannot be agreed until somebody answers this."*

**Answer now closes the gray area in one sitting — with one click deliberately left over.** It is
[`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5 fired at the review: the answer is given out loud, the
run transcribes it **verbatim** and records the row at `Answered` — the human's own move, made in the
room — and the next `resolve` writes it in. **The run never invents the answer and never sets `Answered`
on its own initiative**, whatever seems obvious: transcription of a person's words is the only route,
because the whole provenance design rests on the answer being theirs.

**Approving a *question* and answering it are different acts by design.** An approval makes a row `Open`;
only an answer — the human's own, in the UI or spoken at the review — makes it `Answered`.

---

## Q6 — Dispositions, log, report

1. **Verify every written row's marker was patched at Q4** — a marker still reading `carried` with a row
   written for it is a miss; patch it now, citing the row.
2. **Execute every removal a human's rejection decided** — at a sitting (Q5), or in the UI since the last
   run (Q1) — one at a time, each citing the row that justified it. **A marker
   removal with no row ID in the log entry is a bug, not a tidy-up.**
3. **Sweep for markers pointing at a row that reached a terminal state, and remove them —
   mechanically, with no review slot.** This is [`spec/doc-shape.md`](spec/doc-shape.md) §9 **route 2**,
   and it is the only marker removal nobody is asked about, because the decision was already theirs when
   they closed the row. A marker pointing at a `Closed (not applied)` or `Rejected` row can never be
   answered, so it blocks for nothing.

   It has a step because [`status.md`](status.md) C5 promises a reader that *the next questions run
   removes it and nobody need do anything* — and a promise with no phase behind it is how a marker sits
   blocking `Intent = Agreed` forever while every report says it is about to clear. Cite the closed row's
   ID on every removal, and **name each one in the report**: a marker vanishing with no line is a decision
   nobody was told about.

   **A marker pointing at a row that was *deleted* is not this route.** That is broken, and it is
   reported, never quietly removed — the difference is that a closed row still carries a reason and a
   deleted one carries nothing.

4. **Sweep for markers pointing at an `Applied` row — route 1's stragglers.** Removal and write are one
   act at the resolve seam, but a marker on feature A whose answer was applied into feature B is outside
   that act's reach, and a measured drain left sixteen of them each wrongly blocking `Intent = Agreed`.
   For each: one dispatch checks whether the applied answer settles what the marker names — settled,
   remove it citing the row; not settled, or the run log records the marker as a **deliberate hold**,
   it stays and is named in the report with the reason. Never removed blind: a deliberate hold is a
   human-visible flag on a real residual concern, and this sweep must not eat it.
5. **Where Q2's standing sweep item 5 turned a decided exclusion loose in prose into a `Not doing` line, remove any marker
   that line now answers, citing the line.** This is [`spec/doc-shape.md`](spec/doc-shape.md) §9
   **route 3**, and this step is its only executor. A decision is not an unknown, so a marker raised over
   something a source had already decided is blocking for nothing — but it is removed **because the line
   was written**, never merely because the exclusion was noticed. Where the line has not been written
   yet, the marker stands.
6. **Every remaining marker reads `→ Question: carried`** — never `pending`, which names neither state.
7. **Write the row for every answer given out loud** — the review's *answer now* outcome, and any decision
   quoted from a meeting or a message ([`spec/doc-shape.md`](spec/doc-shape.md)
   §9 route 5): the human's words **verbatim** in `Answer & why`, their name as `Owner`,
   `Status: Answered` where the words were given to the run directly — recorded as the human's own move —
   or `Status: Open` where the decision is second-hand, for its decider to move on themselves
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5).
8. **Put the defaults ledger and the fixes batch to their human — one explicit act each, never
   ratification by silence.** The ledger prints risk-sorted (always-ask-adjacent and irreversible items
   first) with each line vetoable by number; the fixes batch prints each replacement beside what it
   replaced. **Before ratifying, the human is handed a small random sample of ledger lines with their
   full attestations to spot-check** — the sample is the honesty probe that keeps a batch act from
   becoming a rubber stamp, and a failed spot-check vetoes the line and doubles the next sample. **Ratifying the defaults batch is the human act that clears each default's patched marker**
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 6); a **veto** converts that line back into a
   marker plus a question through the ordinary gate, and vetoed text is removed in the same sitting. No
   sitting asked means both batches simply wait, labeled and blocking, named by
   [`status.md`](status.md) as they age — an unratified default is never silently promoted by time.
9. **Log every candidate with its disposition**, including the rejected ones and the reason, so a
   rejection is answerable later without being an open question now — and the funnel line fresh:
   drafted → default → fix → written `Proposed`, with per-pass candidate counts and their distribution.
   **Every Q3 discard goes into the run-log entry
   too** — filter, verbatim quote and counter-case, not only the sitting's printed report: a report is a
   screen and the log is the record, and a discard that exists only on a screen is the same silent loss
   the `CON-k` inventory closes for contradictions ([`init.md`](init.md) I7).
10. **Regenerate every `⟳` view this sitting touched** ([`spec/doc-shape.md`](spec/doc-shape.md) §3's
   single home) — a fresh count from the rows as they now stand, never the prior view patched forward.
11. **Report** — every count in it freshly derived at the moment of printing ([`SKILL.md`](SKILL.md)
   rule 7), never carried from an earlier sitting's tally. It opens with the
   **funnel line** — candidates drafted → routed default → routed fix → written `Proposed` — printed
   fresh every run so a silent regression to question-flooding is visible on its face, then carries the
   **`DEFAULTS ADOPTED (n) — ratify or veto by number`** and **`FIXES APPLIED (n) — ratify below`**
   blocks, the **suggested directions**
   block (below) for the top proposals, and the per-feature routing diagnostic — a feature carrying more
   than about one open question is named with which channel leaked, never used as a generation target —
   and **it ends with the client packet: every
   `Open` row, grouped by `Area` (via `Touches`; project-level rows in their own group), framed as the
   one batch to take to whoever answers**, so taking only the
   starred sub-batch is a choice the packet supports without becoming two packets — and the honest line
   beside it: applied answers create new
   attackable text, so expect one smaller derivative batch after these are resolved.

**Suggested directions — decision support on the row, machine-labeled, consumed by no run.** The run
that writes a `Proposed` row also drafts its `Suggested directions` field
([`spec/databases.md`](spec/databases.md) §2): 1–3 candidate directions, each one line — the
direction, a why grounded in the document (**quoting the requirement or principle it leans on, with
the requirement's id and the date the quote was taken** — quoted text outlives the text it quotes, and
an undated quote decays invisibly), and
its main counter-case; simplicity and general practice may argue too, **labeled as such**
(*"general practice, not a source"*). (The Q4 disposition check evaluates each **draft** direction before
any row exists — a direction that wholly answers its candidate is the signal the candidate was never a
question; the written field on a surviving row is still consumed by no later run.) Dated, and closed with the standing line: *machine-drafted
decision support — not a source; your answer in your own words is what counts.* **A separate dispatch
on a different model verifies every batch before it is written** — a quote that does not exist in the
document is struck ([`SKILL.md`](SKILL.md) rules 6 and 8). The field is for the reviewing human only:
no run reads it back, nothing from it is ever copied into `Answer & why`, and an answer that only
points at an option (*"go with 2"*) is an answer that is only a link — [`resolve.md`](resolve.md)
R2.1: not applied, named with the one-line fix. A choice made **in conversation** — at a checkpoint,
or after asking *"suggest directions for q-12"*, which drafts one fresh under the same rules — is
transcribed with the chosen option's content as the human's own move
([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5). *Decided by the owner 2026-08-07, overriding
the report-only recommendation and the schema-minimalism bar with the risks on the table: the owner
reviews in the UI, and guidance nowhere near the review is guidance nobody reads. The
recommendation-collapse citation (82.3→45.5) is answered by the options-with-counter-cases shape, the
verification pass and the standing label — not denied.* The report still prints the top ten.

```
QUESTIONS — «Golden Crumb» · 2026-08-11

FUNNEL     31 candidates drafted → 14 routed default · 2 routed fix · 4 written Proposed
           (1 transcribed from a carried marker) · 11 discarded on a filter (listed with
           their counter-case). Per-pass counts logged; distribution printed in the entry.
DEFAULTS ADOPTED (14) — ratify or veto by number; risk-sorted, spot-check sample: #3, #11
   1. «Checkout»  Default (standard practice — ratify on review): reset links are
      single-use and expire — does not decide: any legal promise about erasure timing
   2. «Ordering»  Default (adopted from the ratified design, frame 12:400 — ratify on
      review): the basket persists across the payment detour
   … 12 more, each one line, grounding + what it does not decide
FIXES APPLIED (2) — ratify below
   «Loyalty» FR-3 under-enumerated its own list (quote → replacement, applied)
   «Checkout» stale line superseded by the applied answer on q-04 (quote → replacement)
WRITTEN    4 → Proposed, each naming its client-only act. No sitting asked — they wait in
           the Proposed tab: approve, reject with a reason, or answer directly there.
SUGGESTED DIRECTIONS — top 2 by ordering · verified by the same dispatch that disposed them
  «Can a customer retry a failed payment?»
    1. One retry on the same order — FR-2 already isolates payment as its own step
       ("payment succeeds or fails"); counter-case: a retry needs an idempotent order.
    2. No retry; the customer starts over — simplest; counter-case: the basket is lost
       at the moment of highest intent.
    (Both drafts commit the client's money either way — that is why this wrote as a
    question instead of routing default.)
MARKERS    1 patched with its row · 13 patched to ledger lines (cleared on ratification)
           · 1 removed (route 3, Not doing line written) · 0 carried
ROUTING DIAGNOSTIC  «Checkout» carries 2 open questions — both name distinct client
           commitments; no channel leaked.
WAITING ON ANSWERS — the whole batch, take it in one go
  Ordering (2)  «Can a customer retry a failed payment?» (Ana) · 1 more
  Project  (2)  «What does success look like in month one?» (Ana) · 1 more
  Applied answers create new attackable text — expect one smaller derivative batch after
  these are resolved.
NOT PROPOSED, AND WHY
  «Should the menu cache?»        implementation, not intent, no materiality — a Rabbit
                                  holes line instead
  «What is the refund window?»    duplicate of q-07, already Open and owned by Tom

An empty proposal list is not evidence this Blueprint is complete.

Untouched: every feature body except the 14 default lines, 2 fixes and 15 markers named
above, every other block.
```

---

## Edge cases

| Situation | What the run does |
|---|---|
| Nothing to propose | Say so in two lines. A short report on a well-covered Blueprint is the honest outcome, and the standing caveat above still prints |
| More than ten real gaps | All written as `Proposed` (Q4) and listed in the report, most important first. A sitting, if asked for, offers ten at a time (Q5). Nothing found is left unwritten |
| A human approved rows in the UI and also wants a review | Q1 takes the approvals as given; only rows still at `Proposed` reach Q5 |
| A human rejects everything | A legitimate outcome. Every marker disposition still runs, and the report says what was left carried |
| A proposal duplicates a rejected row | Not proposed again unless new source material bears on it — then once, citing the rejection |
| The Blueprint is locked | Runs normally — proposals and marker links are the question layer, not product intent, so they owe no change-log entry. **Defaults and doc-fixes are product intent**: a sitting that lands any appends one change-log entry ([`lock.md`](lock.md) L4) |
| A marker names no entity | Reported as broken, never guessed at. *"Is this right?"* is not a marker and cannot be turned into a question honestly |
| Two markers on the same requirement | Both listed; one question may resolve both, and it says so |
