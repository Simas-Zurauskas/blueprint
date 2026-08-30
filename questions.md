# Run — questions

**Grill the Blueprint**: adversarial passes over the whole document write **questions** for what it cannot
answer yet; a human answers them, rejects them, or carries them into a client packet — in the UI at their
own pace, or at a review sitting they ask for. **The run never interrogates by default: it writes every
survivor, prints the report, and stops.** Answering the questions is what solidifies the document — a
gray area a builder would have filled in silently becomes a decision somebody actually made.

Run on demand — *"grill this spec"*, *"what should we be asking?"* — and automatically at the end of
[`init.md`](init.md) I7 and [`add.md`](add.md) A5. Either way it is these six phases, in this order.
The battery costs what completeness costs, and **an embedding run does not get to skip it or put it
off** — v16 removed the deferral branch on both embedding paths at the owner's direction, because a
run that writes material and stops before its questions exist leaves markers `carried` with nothing
coming for them ([`status.md`](status.md) C5 would name them forever).

**A written question is a question.** It lands at `Status = Open` the moment it passes Q4's admission
gate — no approval state, no per-row approval *(v13; see [`SKILL.md`](SKILL.md) rule 5 for why the step
was retired and what replaced it)*. **What a run still never does is send it:** the client packet is a
batch a human assembles and puts to whoever answers (Q6), never the `Open` view piped outward. Writing a
question is a run's act; asking a client is not.

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
back into the pipeline with one word. One diagnostic belongs to the report, never to any pass: **a feature exceeding roughly one open
question is a routing check, not thoroughness** — the Q6 report names which channel leaked; legal- and
compliance-heavy features legitimately exceed it.

**Why the gate is strict, and why a person still assembles the packet.** A generated question that lands straight in the open-questions list
acquires the authority of one somebody asked — which is exactly why the gate that admits it is strict,
and why the packet that carries it to a client is assembled by a person. One number, stated correctly:
**the best agent on the nearest benchmark finds 44.4% of real gaps.** That is a **recall** figure and it
supports exactly one conclusion — **an empty question list is never evidence the Blueprint is complete.**
*(Its source was never recorded in these files; as of v19 it is carried as unverified and no rule rests
on it — [`SKILL.md`](SKILL.md)'s citation paragraph.)*
It was previously cited here to argue that most of what this phase produces is noise; that is a
*precision* claim, it does not follow from a recall measurement, and it has been withdrawn (v13).

## What this document is and is not — read this before generating anything

Every question this run writes costs a person real attention, so the bar is what the **document**
needs, not what is interesting about the product.

**What the Blueprint is.** A specification of what the product does: its features, their numbered
failable requirements, their edge cases, what it deliberately will not do, and who it is for. A
delivery team builds and tests from it.

**What it is not, and these are discards rather than questions.** Business strategy, mission and
goals, the business model, the client's own internal processes and operating policies, and *"under
what conditions would we reconsider this"*. Those are real questions; they belong to a different
document and a different conversation. **ISO/IEC/IEEE 29148:2018 puts them in a different document
by name** — business purpose, mission and goals, business model, business processes and business
operational policies are **business-requirements** content, while system and software requirements
are where a spec like this one lives. *(Read from the standard's published section structure; its
clause bodies are paywalled, so treat the mapping as a reading of the partition rather than as the
standard's own wording. Note also that "PRD" has no standard definition — this file makes no claim
resting on one.)*

**The one test, and it is the gate's plain-language form.** *If no answer to this question would
change any requirement statement in this document, it is not a question for this run.* That is
29148's **Necessary** characteristic inverted, and it is where two literatures converge: the agent
work reaches the same filter from the other side — ask only where the answer changes what you would
do (*Active Task Disambiguation*, ICLR 2025, arXiv:2502.04485).

**Why a bar exists at all, and what is not known.** Success rate is **non-monotonic in clarification
budget** — it peaks at an intermediate budget and then declines; *"beyond budget 16, interaction
steps rise to 25.1 with no commensurate success-rate gains"* and *"excessive clarification introduces
context pollution and redundant interactions"* (ICML 2026, arXiv:2606.03135). Structured gating on
information gain, net of a redundancy cost, gave **7–39% higher coverage with 1.5–2.7× fewer
questions** (arXiv:2511.08798). Low-quality questions are not free even when good ones sit beside
them: hiding them improved reader performance, satisfaction and time (Zou et al., *Information
Processing & Management* 60(2):103176, 2023, n=89). And the finding that indicts this run's own
design most directly: **prompting a model to judge ambiguity biases it toward over-predicting
ambiguity** (arXiv:2605.25284) — five adversarial passes told to hunt for gaps is exactly that
configuration, so the gate is load-bearing rather than decorative. *That last one is an unvenued
preprint and is cited as suggestive.* **Not known, and not papered over: no source gives a number for
how many questions is too many for a specification, and there is no formal convergence result for
iterative elicitation at all.** The re-gate below therefore fires on evidence of a routing failure
rather than on a chosen number, because no source supports a number (v30).

Specs obeyed, not restated: [`spec/doc-shape.md`](spec/doc-shape.md) ·
[`spec/databases.md`](spec/databases.md) · [`spec/targets.md`](spec/targets.md) ·
[`spec/run-progress.md`](spec/run-progress.md) ·
[`spec/prd-scope.md`](spec/prd-scope.md).

**Run the six pre-flight checks in [`SKILL.md`](SKILL.md) first.**

---

### Progress

Print the standard progress block ([`spec/run-progress.md`](spec/run-progress.md)) at run start, at
every phase boundary, and at every sitting boundary. Counts are re-derived from the current state
each time, never carried forward.

Task list: `Q1` reconcile · `Q2` grill · `Q3` deduplicate · `Q4` dispose and write · `Q5` sitting, on request · `Q6` dispositions, log, report.

---

**The closed set of blocking stops this command may make.** Anything else is a `DEVIATIONS` line
([`resolve.md`](resolve.md) R5), not a stop.

**One, and it is the same whether this run is standalone or embedded in `init` I7 or `add` A5:**
Q5's review sitting, which exists only because a human asked for one and ends the moment they stop
answering. **Nothing in Q5 or in the offer conditions on how this run was invoked**, and on the
local-markdown target the offer is the only review route there is — so an embedding command inherits
this stop and says so in its own list. Q6 step 9 **prints** the three batches and does not wait.

---

## Q1 — Reconcile what a human already did

**First, and before anything is generated**, read every question row and take account of what people did
since the last run — in the UI, at their own pace, without this skill.

- `Open → Rejected`: **a human turned it down.** Accept that, and read `Answer & why` for the reason so
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
- `Open → Answered`, moved in the UI with an answer written: **a human answered it at their own pace, in
  their own tool** — the act at its strongest. Accept it: patch any marker waiting on it with the row
  link. Do not chase `Owner`; an empty one is normal ([`spec/databases.md`](spec/databases.md) §2). The row is
  resolve-eligible as it stands ([`spec/databases.md`](spec/databases.md) §4); nothing routes it back
  through `Open`. An `Answered` row with an **empty** `Answer & why` is different — that is a status with
  no answer behind it: report it and leave it, a discrepancy for its human ([`SKILL.md`](SKILL.md) rule 1).
- An `Open` row whose wording a human edited: accept their wording as the question. Never restore the
  original.
- A `Key` value changed by a human (legacy projects only — the flag is retired, Q4): **their move
  wins.** Read, never edited; the run neither derives nor writes `Key` anywhere.
- Anything at `Applied`, `Flagged` or `Closed (not applied)`: not this
  run's business, except as duplicate-detection input at Q3.
- **A ratification or veto given since the last run — this is the executor, and there is no other**
  (v19). A defaults ledger, a fixes batch or a content manifest is put to its human at Q6 step 9, and
  the human answers it **to a run** — in the conversation that closed that run (Q6 step 9 then calls
  this procedure before closing) or to this one, by naming the batch. **A ratification named to a LATER
  run is not executed until that run hands the human a fresh random sample of the named ledger's lines**
  (v21) — read back from `record/run-log.md`, where those lines are already durable — **and has their
  answer**; a ratification arriving in the same conversation keeps the sample Q6 step 9 has just handed
  over. The spot-check is what keeps a batch ratification from being a rubber stamp, and it left no
  trace a later run could see. `ratify <run id>` ratifies all
  three of that run's batches; `ratify <run id> defaults|fixes|slots` names one; `veto <run id> #3 #7`
  names ledger lines (the numbered batch — a fix or a slot is vetoed by quoting its line); `ratify the
  rest` after vetoes.

  **A number a human gives is resolved against what they read, never against what the ledger counts**
  (v30). The report prints the ledger **risk-sorted** (Q6 step 9) while the ledger is numbered in
  **write order**, so *"veto number 5"* names the fifth line **on their screen**, which is routinely
  not ledger line #5. **Before executing any veto or partial ratification, match each number the human
  gave to its ledger line by that line's own content — quoting the sentence they were looking at — and
  record the mapping in the `VETOED`/`RATIFIED` line.** Where a number cannot be matched to exactly one
  line by content, **nothing is executed for that number**; it is named in the report for the human to
  restate. *A measured run mapped a human's "number 5" straight onto ledger #5. Her words named the
  privacy footer link, which was ledger #6; #5 was a concurrency default she had explicitly approved —
  so acting on it would have removed a default she approved and kept one she rejected.*

  There is deliberately no field for it — the schema carries no
  ratification state ([`spec/databases.md`](spec/databases.md) §8) — so a batch nobody has named to a
  run is unratified, however long it has stood, and [`status.md`](status.md) C5 says so. **Per ledger
  line, ratified:** the default is re-labeled `(standard practice — ratified <date>)` in the body, and
  its patched marker is removed citing the ledger line and the `RATIFIED` line
  ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 6), through the serial commit path. **Vetoed:**
  the default sentence is removed, the marker returns to `→ Question: carried`, and the gap is a
  candidate for this run's Q4 that is **never demoted** to a default again. **A vetoed fix** is
  reverted to the quoted old text; a ratified fix stands as written. **A ratified content manifest**
  confirms the slots; a vetoed slot line is removed and its gap becomes a question. Each batch act is
  one `RATIFIED` or `VETOED` line in the entry ([`resolve.md`](resolve.md) R5), carrying the human's
  words verbatim — so a later reader, and C5, can see the act and who made it. **A line the human
  did not name is neither**: it stays labeled, counted and reported.

**A run never reverses a human's move**, and never re-proposes something a human rejected unless new
source material bears on it — in which case it is proposed once, citing the earlier rejection so the
reviewer can see they are being asked twice and why.

**A field a human has set is read, never edited
not even to blank it, and not even where doing so seems to enforce this file's own gate correctly.**
[`SKILL.md`](SKILL.md) rule 1 is the single home of this and bars clearing exactly as much as setting; a
row that looks prematurely moved is reported as a discrepancy and left alone — there is never a reason to
touch what a human wrote to make a row ineligible.

This phase is first because generating before reading it means writing questions somebody already
answered or rejected this morning. **Open the run-log entry here**, before any proposal is written, and close it at
the end ([`SKILL.md`](SKILL.md) pre-flight check 4).

---

## Q2 — The grilling

Over the Blueprint **as it stands now**, not as some earlier run left it. This is not a checklist pass
it is an attack, and it is **the full battery on a first grill — there is no light mode.** On a
re-grill the same battery runs with a narrowed attack surface and a rotation that returns to every
body (below); what never narrows is the brief. A single
whole-document pass per lens is a sampler — the nearest published benchmark's best agent finds 44.4% of
real gaps in one pass (the preamble's figure; an external number, not a measurement of this tool) — and
every re-run to catch its
misses costs a round of answers collected twice; the owner chose completeness over a cheap sampler
(2026-08-07). **Five adversarial lenses, each run as its own pass with its own framing**, because a
reader looking for everything finds the average of it; a reader trying to break one thing finds it. This
phase is the single home of the lenses — [`init.md`](init.md) I2 and [`add.md`](add.md) A2 both point
here and restate nothing.

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
   compensate for.** Per-pass candidate counts are logged and the distribution written to
   `record/runs/<run-id>.md` — the half of the record [`resolve.md`](resolve.md) R5 sends it to — so a
   quota-shaped fingerprint is a visible anomaly rather than an invisible norm.
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
   (2026-08-07, 77 planted defects) measured **a first grill's** full battery at **~86% caught outright, ~97% at least
   detected, zero hallucinated contradictions** — a different yardstick from the preamble's external
   44.4% one-pass recall (planted defects, graded in-house; no single-pass arm was run, so the two are
   not a before/after), and still never a completeness certificate.
3. **One repeat round, budget-stated.** Any pass **two or more of whose candidates survived Q3**
   (v24 — the trigger counted raw emissions until then, which fired it on nearly every pass and made
   the round cost more than a run would pay: **three independent measured cycles each skipped it
   outright**, three runners judging the same mandated step not worth the dispatches. A step every
   competent runner declines is a step priced wrong, not three lapses. Counting survivors fires it
   where a pass is actually productive and makes the round small enough to run.) Note this moves the
   round after Q3 rather than before it; its findings re-enter Q3 for dedup and disposal like any
   other, and a candidate cannot survive twice (v21 — the trigger used to read *"surviving
   Q3"*, which is a phase this round runs before, so runs read it three different ways) — **in
   any disposition — question, default, or fix alike** — is dispatched once more, fresh, **still inside
   Q2; the round's findings join the merge and enter Q3 with the rest.** (Counting only
   written questions would starve the round exactly when the disposition channels are doing their job,
   and the round's measured yield includes real client questions.) **Two rounds is the budget, not a
   completeness claim** — a round finding nothing new means this generator is dry, never that no gaps
   remain.

**Lenses 1–3's attack surface on a re-grill, and only the surface** (v23). A first grill — an `init`, **an
[`add.md`](add.md) A2 delta**, and any body no `GRILL` line has ever named — is the full battery,
unchanged. A2 grills material that is not written yet, so it has no body and no hash; without this
clause the one thing that pass exists to attack would sit outside the attack surface, against its own
guarantee that *"no planned change is ever presented ungrilled"*. On a **re-grill**, lenses 1–3
attack: every body whose current hash differs from the one **the last `GRILL` line recorded for it**
([`resolve.md`](resolve.md) R5) — **not** the newest hash any entry recorded, which is R2.3's
foreign-edit baseline and a different fact: every write command records a post-write hash, so a
`resolve` run that applies six answers leaves those bodies matching it, and a delta taken there would
be empty for exactly the text the answers produced · **plus every body naming a record, state
or actor that the **changed text itself** names** — lens 4's own criterion, computed per body rather
than per `Area`, because a feature two Areas away can share the record that changed. **The changed
text, not the whole changed body** (v23): read the wide way, every feature sharing one domain noun is
pulled in, the narrowed surface comes out identical to the full battery, and the delta saves nothing on
exactly the small coherent documents this skill is for · **plus every body, where the
overview or a ratified design record changed**, since both are briefing inputs to every pass.

**Rotation, not skipping.** A body outside that set is attacked anyway if **no run in the last three
`GRILL` lines names it as `delta` or `rotation`** — a `shared` mark is not an attack for this purpose.
**Where fewer than three `GRILL` lines exist**, the clock has not run and rotation forces nothing; the
first-grill branch has already covered every body once. The battery measures ~86% caught outright, so ~14% is missed per pass and repetition
across runs is that miss's only compensator — the owner chose completeness over a cheap sampler on
2026-08-07, and a body grilled once and never edited would otherwise keep its misses forever.

**The whole-document snapshot stays the brief on every pass.** Only the attack surface narrows. A pass
briefed with the delta alone is *"a pass that cannot see the rest of the document"*, which is the
configuration this phase already records as having minted 94 doc-answered rows.

**Every body attacked by lenses 1–3 is named on this run's `GRILL` line with the hash it carries when
this run finishes with it — the post-write hash, not the one the lenses saw** (v24), written whether or
not anything was written into it. **The pre-write hash was tried and it made the delta vacuous**: this
same run writes defaults, doc-fixes and content slots into the bodies it just attacked, so a pre-write
baseline differs from the next run's reading of **every** body, every time, and a measured cycle
attacked all seven features including two no `resolve` run had ever touched. **Recording the post-write
hash parks nothing**, because the lines this run added to a body are the ones Q4's disposition check has
already re-derived blind — they arrive disposed, not unexamined — **lenses 1–3 and no others**: lens 4,
lens 5 and the absence sweeps are whole-document, so counting them would name every body on every line
and leave the rotation clock permanently vacuous. **And each name says how it got there** — `delta`,
`shared`, or `rotation` — because a body pulled in by the shared-entity clause was read against a
neighbour rather than attacked on its own, and three consecutive `shared` marks must not read as three
attacks and leave it never overdue — the delta, the rotation clock and the
resume all read it, and a grill that yields nothing would otherwise leave no trace that it happened.

**Lens 4, lens 5 and the ten absence sweeps are never scoped** — they are about the whole by
construction, and an absence-sweep candidate has no grounding text and so no depth.

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
4. **A `Not doing` line with no `revisit if:` is one report line, and nothing else**. The `revisit if:` stays **sourced-only and
   optional**: where a source states a reopening condition it is written, where none does the line
   stands without one. No question, no marker, no carried gap. **The run still never invents the
   condition.** A person who wants one adds it; a report line is how they learn it is missing.
5. **A decided exclusion still sitting loose in prose**, which is a `Not doing` line waiting to be
   written, **never a question** — turning a made decision back into a question is how settled things come
   unstuck.

**Why lens 1 leads.** Target ambiguity is the axis that turns a wrong guess into a wrong-*target* action
Wrong Target moves from 9.6% to **75.1%** when the target is unstated (Ji et al.) — and whoever builds
this will not raise the question themselves: baseline agents ask on **24.12%** of underspecified tasks.
The grilling exists to ask it for them, before the guess gets built.

**Every question must name what prompted it.** That sentence goes in `Why asked` and it is not optional:
**and its closing clause carries the row's own depth** (v23) — **`· depth n`, where `n` is the depth Q3
computed for the candidate**, and the values are open rather than a fixed pair: `1` on a question
grounded in original material, `2` on one derived from answer-written text, `3` and beyond on a longer
chain. **A two-value vocabulary would be a defect rather than a shorthand** — Q3's filter tests for
*depth 3 or deeper*, so a scheme that cannot express 3 is a scheme in which the filter never fires on
anything. The next run reads this clause back when the answer to *this* row is written into a body. It is the same closing clause the retired
`Key` left behind, not a sixth mandated element:
a reader meeting the row cold, in a list, with no context, judges it on the strength of its wording
rather than the strength of the gap.

---

## Q3 — Deduplicate, then discard on a stated filter

**Against every existing row, in every status** — including `Rejected` and `Closed (not applied)`. A
second row does not fix a vetting problem, it hides it. Offer a merge instead of a near-twin.

**And against every prior run's `discard` lines, under the same quote discipline** (v23). Dedup against
rows alone cannot see a candidate that was *never written*, so a candidate this run discards is
regenerated, re-dispatched and re-printed under `NOT PROPOSED, AND WHY` on every run for the life of the
project — the complaint surviving in report form rather than row form. A candidate matching a prior
discard is discarded on **the original filter, re-cited and re-tested** — never on the bare fact that a
previous run discarded it, which would make a discard evidence for its own repetition and put a wrong
one beyond a reviewer's reach forever. Cite the run id, quote the recorded candidate, and name the
filter that decided it; where the quote cannot be produced the match is invalid and the candidate
proceeds, exactly as for a row.

**The same four classes this file never discards are exempt from every filter in this phase** — a
contradiction-backed candidate, a client-bound carried-marker transcription, the two project-level
questions, and anything on the always-ask register. **Every filter, not only this one** (v23): the
exemption is general, and its position in this subsection does not scope it. Read narrowly it would
leave a contradiction discardable as a `Duplicate` of the very row whose answer wrote the text it
contradicts, which is the failure this paragraph exists to prevent. A contradiction wrongly discarded once would otherwise be discarded on that
citation on every later run, which is *"silently resolv[ing] a contradiction by not asking"* — the one
thing this skill does not do.

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
| **Already answered** | A requirement, an `Edge cases` line, a `Not doing` line, the NOT-clause **or a `Content slot — client-supplied:` line** (v23 — the slot channel's own output was on no filter's list, so a slot-routed candidate was re-routed and re-slotted every run) answers it — **and you can quote the sentence**. **An unratified `Default (… — ratify on review)` line that adopts the same behaviour counts here too** (v19): the gap is already on a ledger awaiting its human; it is neither a second default nor a question — a duplicate of a disposition already made, not a demotion (Q4's never-demoted clause governs candidates that would become a *new* default). **A candidate that contests the default's behaviour** is not a duplicate: it goes to Q6 step 8 as a veto candidate on that ledger line, never as a second default | Link to the answer, quoting it — for a default, the ledger line |
| **Shown by the ratified design** | A ratified frame on the design-source record plainly shows it, **and following the drawing is safe, lawful and consistent with the document** | **Never a silent discard**: a frame-cited `adopted from design` entry on the defaults ledger, vetoable like any default. A drawing that itself embodies a risk — a child-operable consent control was the measured case — is a fork put to the client, not an adoption |
| **Settled by convention** | [`SKILL.md`](SKILL.md) rule 4's four conditions all hold, each attested, and nothing on the never-defaultable list or the always-ask register is touched | Route to the **DEFAULT** channel (Q4) |
| **Correction, not question** | Existing text is wrong in a way with a mechanically checkable winner (Q4's DOC-FIX admission) | Route to the **DOC-FIX** channel (Q4) |
| **Duplicate** | A question row already asks it, in **any** status — **and you can quote the row's own words** (v21). If the quote cannot be produced the discard is invalid and the candidate is proposed | Point at that row, **quoting it verbatim** |
| **Not a specification question** | The answer changes no requirement statement in this document. Business strategy, mission and goals, the business model, the client's **own internal process or operating policy**, and any *"under what conditions would we reconsider this"* — a different document's content, named in the scope statement above. **Two exemptions, both project-level and both asked once, ever**: *what one or two observable things would tell you this worked* and *who is this for* — [`spec/doc-shape.md`](spec/doc-shape.md) §3 makes both required overview content, so they are specification questions despite sounding strategic | Named in the report under its own heading; no row, no marker |
| **Implementation, not intent** | The answer changes how it is built, not what the feature is — **unless materiality holds**: the choice (M1) alters a promise a user or the client can observe, (M2) sits on a project-specific, **historically expensive failure** this project has named, or (M3) is externally mandated. **And even then it is only a question if the decision must be taken outside the technical department** *(v16, owner's words)*: a choice a designer, a product lead or the client must make is admissible; one the engineers can settle among themselves is theirs, whatever it costs. Where it is admissible the document records the observable constraint in one sentence, never the mechanism; retry counts, teardown ordering, storage housekeeping and their kin are the builders' to decide. **M2 survives this tightening** — a failure this project has named is a standing constraint, not a fresh engineering choice | A `Rabbit holes` line, or nothing |
| **Unanswerable here** | It turns on a party outside this project, or nobody can decide yet | Name it in the report; no row |
| **Client-internal** | The answer changes nothing this delivery team builds — the client's own staffing, internal process, legal operations, marketing plans. Passing Q4's client-only-act test does not save it: the act is theirs, and so is the question | Name it in the report under its own heading; no row, no marker. Where the client genuinely needs prompting, it belongs in the client packet's covering note, not the PRD |
| **Deliverable content, not a decision** | The answer is content the client will produce — a catalog, a scene list, copy, artwork — rather than a decision about behaviour | Route to the **CONTENT SLOT** channel (Q4): the document defines the slot; the content arrives on the content manifest's one batched sign-off, never as per-item questions |
| **Already decided against** | It is a decided exclusion | A `Not doing` line, never a question |
| **Consequence of an open question** (v30) | Its answer is **blocked by a question already standing `Open` or `Answered`-but-unapplied**, so nobody could answer it today whatever they wanted — [`spec/prd-scope.md`](spec/prd-scope.md) §8's rule, which until v30 was written in a spec no phase read back. **Cite the blocking row and quote the sentence in it that does the blocking**; where the quote cannot be produced the discard is invalid and the candidate proceeds, exactly as for `Duplicate`. The candidate is **not lost**: it is a `discard` line the next run's dedup reads, and it regenerates once the blocker is answered — which is when it becomes answerable | Point at the blocking row, **quoting it**. Named in the report under *"waiting on an open question"* |
| **Answered by a principle the client stated** (v30) | A principle already on record decides it, and the candidate merely applies that principle to one more instance — [`spec/prd-scope.md`](spec/prd-scope.md) §5's row, brought into this table because it lived in a spec section Q4 does not import. **Quote the principle and the candidate side by side**; the discard is invalid without the principle's own words. **The exception §5 states holds here:** where the principle is silent on the *posture* — whether the product refuses, warns, or records after the fact — that posture is a live question and this filter does not reach it | Point at the principle, **quoting it**. Where the instance genuinely needs writing down, it is a **DOC-FIX** applying the stated principle, never a question |
| **Derived past the bound** (v23) | **The candidate's disposition would be QUESTION** — a DEFAULT, a DOC-FIX or a CONTENT SLOT is never capped, since each costs one batched ratification rather than a person's attention, and doc-fix class (i) is by construction grounded in answer-written text — **and** it is **depth 3 or deeper** — it is grounded in text an answer wrote, whose own row was itself grounded in text an answer wrote. **Depth is read, never inferred**: from the `· depth n` token the writing channel stamped (Q4), and a candidate grounded in text carrying none is depth 1. **Where a candidate has more than one grounding — the same question found by two passes, or one resting on two lines — its depth is the DEEPEST of them, and every pass reports every grounding it used** (v24). Depth is a property of the candidate, not of whichever pass happened to find it: a measured cycle emitted one question twice, from `FR-5` with no token and from `FR-6` at depth 2, so the same question was depth 1 or depth 3 depending on which return the dedup kept. **A cap that a pass ordering can flip is not a cap**, and taking the deepest is the reading that cannot be gamed by finding a shallower path to the same gap. **Four classes are exempt and are never capped**: a contradiction-backed candidate · a client-bound carried-marker transcription · the two project-level questions Q3 exempts by name · and anything on the always-ask register | A `Rabbit holes` line **carrying the candidate's own depth token** where it names a **build concern — a choice about mechanism the builders own**, the class the `Implementation, not intent` filter names, and never a client commitment such as a price, a duration or a scope line; otherwise a discard like any other, **with its filter and its one-line counter-case**, so the next run's dedup reads it back rather than re-deriving it |

**The dedup also runs in reverse — once per sitting, against the standing `Open` backlog.** Dedup as
stated above only stops *new* candidates duplicating what exists; nothing re-reads the rows already
sitting `Open` against a document that has moved since they were written. After enough resolve runs
the backlog silently fills with questions the current text now answers — measured on 2026-08-14: a
classifier pass over 316 standing rows found 40 fully settled by then-current text, none of which any
report had named. So: sweep every standing `Open` row against the current document under the same
quote discipline, and list each **fully**-settled one in the report under *"Already settled — recommend
closing"*, quoting the text that answers it. **The run closes none of them** — a live question is
machine-set, but the disposal is a human's call, made in the UI or by directive at a sitting
([`SKILL.md`](SKILL.md) rule 1). A partly-settled row is left alone: half an answer is not an answer.

---

## Q4 — Dispose, then write

**Every candidate that survives Q3 is disposed this sitting — no found gap is parked, and no disposition
is silent.** A found gap that lands nowhere is a gap the next run has to find again — the measured cost of
parking is real: on one project the carried backlog grew to ~80 known gaps with no row behind them. But a
found gap written as a question when a channel already holds its answer is review work manufactured out of
nothing — the measured cost of that was 693 rows, 4.8% of which needed a client. So every survivor takes
exactly one of four routes, and the route is decided **before** anything is written:

**Before the two axes, the scope test** (v26). **[`spec/prd-scope.md`](spec/prd-scope.md) is the single
home of what belongs in this document**, and it is read and applied to every candidate before anything
else in this phase. It supplies what no axis here ever did: **the delta test** — two competing answers
must produce two different specification sentences, and no topic is exempt from it however client-owned
or undefaultable — **the five dispositions** a candidate may take, **the materiality floor** set by the
project's own scale, and **the categories with the test that admits or refuses each**. A candidate that
the scope spec disposes as `DECIDE`, `PROPOSE`, `RECORD` or `DROP` does not reach the axes below; only
an `ASK` does. *It exists because a simulation put 36 generated rows to an LLM operator persona
standing in for the client, and the persona kept 9 — the generator had no model of its own subject
matter, so it could not tell a question that changes a requirement from one that merely sounds
important. No human labelled that corpus; it justifies the tests, it certifies no result.*

**The admission gate — what earns a written question. Two axes, both required.** A QUESTION is written only
if its `Why asked` names **(a) the client-only act its answer requires** — committing their money,
calendar, contractual scope, legal or IP posture, or brand voice, or disclosing a fact resident only in
their world, including the meaning of a term they coined — and **(b) what this document cannot say until
it is answered: the named requirement, slot, or acceptance criterion that stays blank**, cited by feature
and sentence. (b) is the build-gating test, satisfied by **any** of: a citable blank · a topic on rule 4's
never-defaultable list (whose blank may be genuinely uncitable — a pricing gate blanks no single
sentence and still gates the build) · a contradiction between sources.

**The never-defaultable branch requires the topic to bear on THIS document, and that is not the same as
being undefaultable** (v23, from a measured run). A pricing gate qualifies because a requirement
somewhere states what a user is charged and cannot be written until somebody sets a figure. A topic
that touches **no requirement this document has or will have — "will have" meaning foreseeable from
source material somebody can point at, never from the candidate's own hypothesis**, or the branch
readmits everything it just excluded — does not qualify, however
undefaultable it is: the candidate must name **the requirement whose pass/fail condition its answer
would change, or the one that cannot be written until it is answered** — the same naming the surveyed
finding demands, asked of the writing side.

**And a register topic is asked once, ever, not once a run.** A project's always-ask register excludes
its topics from **defaulting**; it does not compel a question, and reading it as compulsion is what a
measured run produced — on a berth-booking product for boats it wrote *"does this hold data about a
minor?"* and *"what accessibility standard applies?"*, neither traceable to any source, both mandatory,
both undiscardable. **The register's mandatory entries are asked on the first run at which the topic
clears the gate above, and never again — "can ask" is a condition, not a cadence**, so an entry that
never clears the gate is never asked, exactly as the two project-level questions are; thereafter they are a line in the client
packet's covering note, not a row per run. *A rule that manufactures rows out of its own seed content
is a rule generating review work from nothing, which is the failure this whole phase exists to
prevent — and the register keeps its real job untouched: nothing on it is ever settled by convention.* **A candidate that passes (a) but not (b) is the client's business, not this
document's** — discarded on the client-internal filter, one report line each. **This gate's disposal is
not subject to Q3's exemptions** (v23): those four classes are protected from being *filtered away
before they are disposed*, not from the gate itself, and reading them into this line leaves a register
topic that fails (b) with **no route out at all** — exempt from the only filter that disposes it, and
therefore written, which is the defect this branch was tightened to stop. **A register topic failing (b)
goes to the client packet's covering note**, named in the report, and no row is written. A technical-looking
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

**The re-gate, and what fires it** (v30 — this was a numbered *question budget* until then; what
replaced it and why is below). **No run carries a target for how many rows it may write, and no
candidate is ever discarded for being row number twenty-one.** What a run carries instead is a
**re-gate**: a trigger that **re-gates the whole batch** back through Q4's two axes, nothing
grandfathered, on evidence that the routing has drifted.

**What fires it: Q6's per-feature routing diagnostic** — **a feature carrying more than roughly one
open question**, which that step already names as *"a routing check, not thoroughness"*, together
with the channel it says leaked. Legal- and compliance-heavy features legitimately exceed it and the
report says so. **Fire it per feature, not per document**, because a feature with six open questions
is evidence of a channel failing on that feature, while a document with sixty is evidence of nothing
except a large document.

**Over the trigger, the run re-gates and then:**

- **Discretionary rows that fail the re-gate are discarded** on a named filter with a counter-case.
  This is where re-scrutiny actually removes rows.
- **Undiscardable rows that survive are written**, and the run reports which classes they are. This
  re-gate **never discards a contradiction-backed candidate**, a client-bound carried-marker
  transcription, one of the two project-level questions, or anything on the always-ask register —
  **no threshold before it did either.** A gate that could eat those would silently resolve a
  contradiction by not asking, which is the one thing this skill does not do.

**Overflow is still never parked**: a gap that lands nowhere is a gap the next run has to find again.
It is disposed through the other three channels, or discarded on a named filter, like any discard.

**The funnel line is what makes volume visible, and it is the whole of the volume story** (Q6):
candidates drafted → routed default → routed fix → routed slot → written as questions → discarded.
A silent regression to question-flooding shows on its face there, per run, without a number to breach.

*Why the number went, in one line: it was an absolute 20 rows on a first `init`, and a measured
three-project campaign found it removed nothing in the one run where it engaged and did not engage at
all in the others, while the filters took 145 candidates to 7 in the same run. The full account, the
numbers and what two earlier versions tried first are in `HISTORY.md` under v30. **What remains true
and is why the re-gate stays: the success curve turns over.** No source gives a number for where, so
this file no longer pretends to one and fires re-scrutiny on evidence of a routing failure instead.*

**A sitting is still capped, and that is a different limit doing a different job.** Q5 offers about
ten rows at a time because *"past that people stop reading and start agreeing"* — it paces one
person's attention and **discards nothing**. The client packet is likewise a batch a human assembles.
**Cap the sitting, never the document.**
**The derivative round is bounded.** Text a [`resolve.md`](resolve.md) run wrote **from an answer** is
not re-attacked by the lenses in a **later sitting of that same run** — the answer is minutes old and
a pass over it is a self-critique with no external ground truth, which measurably degrades output
(*LLMs Cannot Self-Correct Reasoning Yet*, ICLR 2024, arXiv:2310.01798). **A later run attacks it
normally**, and the absence sweeps see it in every sitting. The narrow reading is deliberate: the wide
one would make resolve-written text permanently invisible to lenses 2, 4 and 5, and nothing else does
that work.

**That narrow bound stands, and v23 adds the one it does not provide: a bound on *depth*, not on
recency.** The paragraph above stops a run self-critiquing minutes-old text; it deliberately lets a
later run attack it, and it is right to — the first derivative batch is where a real second-order gap
surfaces. What nothing bounded was the **chain**: an answer to a derivative question writes text a third
question is derived from, and so on, which is how a document that is being worked becomes a document
that can never be finished. So: **the lenses attack answer-written text once. A candidate derived from
text that was itself written from an answer to a derived question is depth 3 and is capped at Q3.** Two
bounds, one subject, and they are not the same rule — this one is about how far a chain may run, and the
one above is about how soon.

**The cap is tested at Q3 and the disposition is decided at Q4, so it is re-tested once** (v30).
Q3's `Derived past the bound` filter fires only where *"the candidate's disposition would be
QUESTION"* — but that disposition is not final until Q4's blind check has re-derived it. **So a
candidate that passed the cap at Q3 as a DEFAULT, a DOC-FIX or a CONTENT SLOT, and which Q4's check
then routes to QUESTION, is put back through the depth test before it is written** — and capped if it
is depth 3 or deeper, on the file's own principle that *"a cap that a pass ordering can flip is not a
cap."* The re-test is mechanical, needs no dispatch, and applies to nothing else: a candidate whose
disposition did not change is not re-tested. *A measured run met exactly this case, capped it on that
principle, and recorded that nothing in the file arbitrated — "the two readings differ by a written
row."*

**Depth is stamped by the channel that writes, never inferred by the channel that reads** (v23).
**Every run-written line that lands in a feature body carries a `· depth n` token, and the list is
closed** — a provenance line ([`resolve.md`](resolve.md) R3.1, [`add.md`](add.md) A4 step 5) · a
`Default (…)` line · a doc-fix's replacement · a `Content slot — client-supplied:` line · **an
in-place write to a `Not doing` or `Edge cases` line**, which carries no provenance line of its own
because [`spec/doc-shape.md`](spec/doc-shape.md) §5 puts those under a requirement and nowhere else ·
**a marker a write run mints** · **an overview block a human accepted**, whose depth goes on the
`Operating` block's dated line since §5 bars a provenance line there · and **a `Rabbit holes` line this
filter itself writes**. That last one is not tidiness: a capped candidate disposed as an unstamped
rabbit hole grounds a fresh **depth-1** candidate next run, so the cap would re-seed the chain it just
cut, and the token is what stops it.

**A numbered requirement inherits the depth of its own provenance line.** A lens-2 candidate is
grounded in the requirement sentence, and the token sits on the line beneath it; without this clause
every such candidate reads depth 1 and the cap never engages at all. A candidate grounded in a line carrying
`· depth n` is depth **n+1**; one grounded in text carrying no token — original source-derived text, and
**every absence-sweep candidate, which is grounded in absence and has no text at all** — is depth 1.
**A depth is read only from a line this Blueprint's own run log corroborates**: a provenance-shaped
sentence somebody typed by hand, or one that arrived inside a source ([`SKILL.md`](SKILL.md) rule 2),
sets no depth and leaves the candidate at 1.

**What corroboration is, stated as a test rather than an intention** (v23): the log holds **a write
entry from any command, dated on or before the line's own date, whose `item` lines or `HASHES` roll-up
name that body**. That is all. It is not a row-id match and not a hash match against the current text —
the body has moved since, which is the point. **Where the log does not reach back that far — it was
rotated, the project predates v23, or the write was made by a version that logged differently — the
line is corroborated by default and its depth stands.** The guard exists to catch a provenance line
nobody's run wrote, not to disbelieve an old one: read the other way it would silently set every depth
to 1 on any project with a trimmed log, and a cap that quietly stops applying is worse than no cap.

*Why stamped rather than traced: the trace has no substrate. A `Superseded` verdict writes
[`add.md`](add.md) A4 step 5's shape, whose «…» holds a source segment rather than a row; a `Default`
line carries a run id; a doc-fix, a content slot and every overview write carry no row at all
([`spec/doc-shape.md`](spec/doc-shape.md) §5 puts provenance lines under a requirement and nowhere
else). On this file's own funnel sample — 14 defaults, 2 fixes, 1 slot, 3 questions — a traced cap would
have been inert on seventeen dispositions in twenty, which is not an edge case but the ordinary run.*

**The DEFAULT channel.** Each candidate the convention or design filters routed here is written into its
feature body as `Default (standard practice — ratify on review): …` — or its design twin,
`Default (adopted from the ratified design, frame N — ratify on review): …` — one labeled sentence
stating the adopted behaviour, tagged with run id and date, through the serial commit path
([`SKILL.md`](SKILL.md) rule 8), never overriding existing text. Every default also lands as **one line
one, and clauses rather than paragraphs** — on the run's **defaults ledger** (run log + report): the
sentence, the grounding, the four attestations ([`SKILL.md`](SKILL.md) rule 4, one clause each), and a
last clause naming what client-owned thing it does not decide. The ledger is **risk-sorted** — anything adjacent to the
always-ask register or irreversible first — and **capped at what one sitting can honestly ratify**;
**and a run does not open a new batch while one stands unratified** (v24): its defaults join the
**oldest standing ledger**, which keeps its run id and grows, so a human ratifies **one list once**
rather than a fresh batch per run. A measured three-cycle campaign reached **63 defaults across nine
batches** and nobody had held a sitting — nine separate acts of ratification is nine reasons to hold
none, and the count of batches is the number that makes the debt unpayable, not the count of lines.
**The report leads with that debt whenever a ledger stands unratified** — its age in sittings, its line
count, and the one sentence that clears it — ahead of the funnel and ahead of the questions, because a
document accumulating unratified machine text is a document drifting away from the human who owns it;
overflow defaults stay written and labeled but head the next sitting's ledger.

**A default that belongs to no single feature has a home, and until v30 it had none** — the channel
writes into a feature body, so a candidate passing rule 4's four conditions but scoped to the whole
product (a date format, a rounding rule, what a soft delete does — exactly the class
[`spec/prd-scope.md`](spec/prd-scope.md) §4 tells this phase to **merge** into one project-level
question) had nowhere legal to go and was discarded on a filter none of which fitted. *"The channel
failed, not the candidate."* **Such a default is written as a dated line in the overview's
`Operating` block** — the same surface that already carries the always-ask register and the ratified
vocabulary line ([`spec/doc-shape.md`](spec/doc-shape.md) §3) — labeled and ledgered identically, and
**through §3's own route: proposed verbatim, accepted by a human, never written silently.** It takes
its ledger line like any other default; what differs is only where the sentence lands.

**The DOC-FIX channel.** Machine-applied only where the winner is mechanically checkable: **(i)**
doc-internal staleness — both quotes doc-side, one demonstrably superseded by a resolve-applied answer on
record; **(ii)** an under-enumeration or stale line amendable from one verbatim quote plus the feature's
own stated behaviour. Exact replacement wording, applied through the serial commit path, every fix listed
in the report for **one explicit batch ratification**. **A doc-vs-design contradiction is never a fix**
it is surfaced as a question with both quotes ([`SKILL.md`](SKILL.md) rule 4's no-ranking clause); where
neither side of any conflict can win mechanically, the candidate converts to a QUESTION through the gate.

**The CONTENT SLOT channel** (v12, generalising the brand-copy clause — the one content class rule 4
already handled this way). Where a gap's answer is **content the client will produce** — a catalog, a
scene list, copy beyond brand voice, artwork, media — the run writes the **slot**, never the ask: one
labeled line in the feature body,
`Content slot — client-supplied: <what> · <shape/format> · <cardinality or bounds> · <who supplies>`,
through the serial commit path, plus one line on the run's **content manifest** (run log + report). The
manifest is put to the client as **one batched sign-off**, exactly as brand copy's final wording is
never one question per item, because a per-item ask converts a delivery checklist into review workload.
A slot may carry neutral **illustrative** examples, labeled as such, where the body needs them to read.
What stays a QUESTION: a decision *about* the content that changes behaviour — whether a category
exists at all, whether content is moderated, who may see it — passes the gate on its own merits.

**The disposition check — the same pre-write dispatch, wider verdict.** The second-model dispatch that
verifies suggested directions ([`SKILL.md`](SKILL.md) rule 6) **re-derives every candidate's
disposition blind** — from the candidate and its grounding alone, never shown the first routing. **What a
divergence does is decided by what the two verdicts are, and this ordering is exact**:
- **Either verdict is QUESTION** → the candidate is written as a question — **the pipeline fails open to
  asking, never to silence** — *unless* the non-question verdict produced the full demotion evidence (a
  verbatim quote, a convention with all four conditions attested, or **a surveyed no-requirement finding**
  below), in which case the evidence wins and the demotion is taken, logged with its quote.

  **The surveyed no-requirement finding — the third evidence class, added v23 because the measured
  complaint came through this bullet.** *"The privacy policy text is unspecified"* is true, is
  client-owned, and is undefaultable, so [`SKILL.md`](SKILL.md) rule 4 bars settling it — and three Q3
  filters name its class (**Deliverable content**, **Client-internal**, **Not a specification
  question**). It was written anyway, because a routing to one of those filters produced neither a quote
  nor four attestations, so this bullet failed open over the top of them. The finding is that gap closed,
  and it is **an obligation on the routing side, in a citable form, not an assertion**:

  > *the router names **the two or three requirements it surveyed**, by feature and number, and states
  > that no answer to this candidate would change any of their **pass/fail conditions** — their existence
  > is not enough, or "FR-9: the app links to a privacy policy" satisfies it.*

  **Producing it is not optional, and that is what makes this a closure rather than a second fail-open**
  (v23). A routing to **Deliverable content**, **Client-internal** or **Not a specification question**
  **must** carry the surveyed list; **a routing to one of those three without one is not a routing**, and
  the run **puts the candidate back to the router once, naming what is missing**.

  **That re-routing is the exit, and it is bounded at one** (v23). The first draft sent the candidate
  *"back through Q4's gate"*, and a measured probe traced where that goes: the gate's own disposal for a
  candidate passing (a) and failing (b) is *discarded on the client-internal filter* — **one of the same
  three filters that requires a survey** — so it could loop, and *"silence from the router can produce
  the exact row v23 was written to prevent."* So: **a second silent routing is not a third attempt.** It
  is recorded as `routing refused — no survey offered`, the candidate is written as a question, **and
  the refusal is named in the report**, because a router that will not say what it surveyed is a fact a
  person should see rather than a row they should be handed silently.

  **The survey is a claim about named requirements, and it is checked as one** (v23). It names them
  **and quotes each one's own sentence**, so the finding stands or falls on text the log carries. A
  probe produced a form-compliant survey whose supporting clause — *"the requirement that the email is
  sent exists"* — named a requirement **that did not exist in the document**, and nothing caught it,
  because [`SKILL.md`](SKILL.md) rule 6(d)'s check is a string match on a quotation and that record
  quoted nothing. With the sentences quoted, 6(d) reaches it unchanged: **a survey citing a requirement
  whose quoted sentence is not found in the document is not evidence**, and the candidate is written. Silence was the original defect — a
  router that routed correctly and said nothing produced no evidence, so this bullet failed open over
  the top of a correct discard — and a closure that still permits silence would reproduce it exactly.

  **The blind side is given the surveyed requirements' own text, not their ids** — it receives *"the
  candidate and its grounding alone"* and can no more evaluate a pass/fail condition it has never seen
  than survey a document it cannot read. An id list would leave it accepting an assertion rather than
  checking a claim, which is the thing this file spends a whole phase refusing to do.

  **And it is given the lever, or handing it the text was decoration** (v23). **A QUESTION verdict from
  a blind side that held the surveyed sentences defeats the finding**, and the candidate is written: it
  read the evidence and disagreed with it, which is a failed check rather than a tie. Without this the
  ordering said the finding *wins* whenever it was produced, and a probe demonstrated the consequence —
  *"the blind side read the surveyed text, disagreed, and the demotion was taken anyway."* **This is the
  one place a non-question verdict does not survive disagreement, and the reason is that it is the one
  place the blind side was given what it needs to judge.** The three undiscardable classes are unaffected: a
  contradiction-backed candidate, a client-bound carried-marker transcription, and the two project-level
  questions are never demoted on this finding, whatever it says.
- **Both verdicts are non-question but differ** (DEFAULT vs DOC-FIX vs CONTENT SLOT): the two agree the
  client is not needed — that agreement stands. Route to **DEFAULT**, the most conservative of the three
  (labeled, ledgered, vetoable), with the disagreement printed on its ledger line.
**Where no second verdict exists, the routing keeps its first routing and is recorded `unverified`**
([`SKILL.md`](SKILL.md) rule 6(a)–(c)) — the token goes on the candidate's own line: its ledger line
for a default, its manifest line for a slot, its batch line for a fix, and the run's report states the
unverified total **on its own line**, in rule 6(c)'s words — *"n items written unverified — no second
dispatch was available."* **Rule 6 says every phase that verifies must carry the token; this is Q4
carrying it** (v20: rule 6 named only [`resolve.md`](resolve.md) R3.3 and [`init.md`](init.md) I6, so
this phase had no outcome vocabulary and a measured run recorded six defaults and sixteen routings with
no verification state at all). Never demoted, regardless of grounding: carried-marker transcriptions of
client-bound gaps, anything the document records as awaiting client sign-off or ratification, and a
gap whose default a human vetoed (Q1). Every
demotion is logged with its grounding quote, and the run-log entry prints the funnel fresh: drafted →
routed default → routed fix → routed slot → written as a question. **The run records the same
cost-and-outcome line resolve's R5 requires** — dispatches · tokens · wall-clock, marked self-reported
in `record/runs/<run-id>.md`, where R5 sends `COST` (v19: not in the entry), beside the funnel counts
in the entry that are recountable.

**Every carried marker with no row behind it is disposed too** — transcription first, then the same gate
and channels as any candidate: the marker already names its entity; a client-bound gap becomes a row whose
`Why asked` cites the marker and the run that minted it, and a convention-settled one becomes a default
with the marker patched to its ledger line, **and a gap whose answer is client-supplied content becomes a
slot whose written line removes the marker** ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 7).
After this phase, `carried` reads zero until the next write run mints more — **and that is a
checkable claim rather than an aspiration, because every disposition this phase can reach now has a
removal route on §9's list** (v30: routes 7 and 8 were added after a measured campaign found six
markers standing at `carried` on a finished run, held by content slots and by source-answered gaps
that no route covered — which made convergence unreachable by construction on any project using the
slot channel, and left the grill re-detecting them at 23% of its candidate pool every run).
**The only markers that legitimately survive this phase are the ones a human's veto or *ask it
better* rejection returned to `carried`**, and they are named.

**The run does not open a review sitting on its own — but it does offer one, once, in its closing
line, and asking is not starting** (v16). The offer is a single sentence — *"want to go through these now,
ten at a time?"* — and **silence declines it**: the run does not wait, does not re-ask, and closes
either way. **On the local-markdown target the offer is not optional courtesy but the only route
there is**, because `Unsent — packet candidates` is a saved view and
[`spec/targets.md`](spec/targets.md) §3 says the four views do not exist on that target. A person reviews
in the `Unsent — packet candidates` tab — on the local target, in the folder's `questions.md`, where
every `Open` section is that tab — at their own pace, and Q1 reconciles every move next run; Q5 runs
only when a person asks to go through the rows together. Where a sitting does run, about ten rows are
offered at a time and no more — past that people stop reading and start agreeing, which is worse than a
shorter list. **Order the list — in the report and at any sitting — marker-backed candidates first** — a
marker is a gap somebody already agreed was a gap, and it is named in every `status` report; that
precedence is never demoted beneath any judgment — **then by how much the answer changes
what gets built, and by whether anyone reachable can actually answer it**: an ordering policy reaches near-ceiling with 3.0 questions against 5.1 unordered. Say the list is
ordered and on what. It is a judgement and it is labelled as one.

**The `Key` checkbox is retired** (v12). It was added 2026-08-07 to triage a write-all backlog — "top
questions or full" against 693 rows — and its criterion, *the document cannot sensibly be built without
the answer*, is now axis (b) of the admission gate itself: every row that exists passes it, so a flag
distinguishing the build-gating rows distinguishes nothing. The compensator for over-generation is gone
because the generation is gated at the cause. **On an existing Blueprint the column simply goes inert**
human-set values are never edited or deleted ([`SKILL.md`](SKILL.md) rule 1), no run reads or writes it
again, and each row's one-line criterion survives as the closing clause of its `Why asked`. **If a future
project ever produces real question volume again, that is the admission gate failing — fix the gate;
do not resurrect the flag.**

**Writing a row and patching its marker are one act.** The marker's `→ Question: carried` becomes the row
link at write time — a written row is a real destination for a marker, and the marker stands, counted
and reported, until the answer is applied. A later rejection removes or keeps the marker by its
reason, exactly as [`spec/doc-shape.md`](spec/doc-shape.md) §9 routes it.

**Each of these goes in its own field, read back after writing** — the placement rule and its reason
live in [`spec/databases.md`](spec/databases.md) §2, and the read-back is
[`spec/targets.md`](spec/targets.md) operation 6; neither is restated here.

Each proposal row: `Question` phrased **as a question**, in one sentence · `Why asked` naming what
prompted it and **whether a marker is already waiting on it**, because that changes what rejecting costs
and, on a contradiction-backed proposal, **carrying both verbatim quotes with both source names**, never
a paraphrase: the reviewer judges the disagreement itself, not the run's summary of it ·
`Touches` set where it is feature-scoped, empty where it is project-level · `Status: Open` ·
**`Owner` left empty** — it is an informal label a human sets when it helps them, never a run's to write
and never a precondition for anything ([`spec/databases.md`](spec/databases.md) §2); a name in `Why asked` prose would be a
content-rule finding ([`spec/doc-shape.md`](spec/doc-shape.md) §6).

**The last gate, and it reads the row's own words back** (v30). **Before a drafted row is written,
re-read the `Why asked` this run has just composed. Where it says, in any words, that the person this
row is going to cannot answer it — *they said to ask somebody else · they do not know · it is not
theirs · it turns on an outside adviser* — the row is not written.** It routes to **RECORD with that
owner named** ([`spec/prd-scope.md`](spec/prd-scope.md) §2's professional-determination test) or to
Q3's **Unanswerable here** filter, and the report names it under *"put to the wrong person"*.

*This gate exists because the tests that would have caught these run on the **candidate**, and
`Why asked` is composed **after** the routing — so the sentence proving the routing wrong is written
after the only gate that could have used it. In a measured campaign **four rows carried, in their own
`Why asked`, the evidence that they should not have been asked, and the clients rejected four of
four** on exactly that ground — one of them quoting the row's own note back: "you have written down in
your own note that I told you, and you have put it in front of me again anyway." The check is
mechanical, costs no dispatch, and is the cheapest gate in this file.*

**It never fires on the three undiscardable classes** — a contradiction-backed row, a client-bound
carried-marker transcription, and the two project-level questions are written whatever their
`Why asked` says, because for those the client not knowing is the point rather than the defect.

---

## Q5 — The review sitting — on request only

**The run never starts this uninvited.** The default is no sitting: rows written, report printed, and the
review done in the `Unsent — packet candidates` tab at the reviewer's own pace — reject
(reason in `Answer & why`), or answer directly (→ `Answered`), each move reconciled by Q1 next run. This
phase runs when a person asks to go through the rows together.

**Then: ask one row at a time, never as a list.** The same seven minutes put as a list produced two of five
accepted and no owners; put one row at a time it produced five of five with a named owner each. *Every
item put to a person as more than one act produces one act.*

```
UNANSWERED (6) — ordered by how much the answer changes.

  1/6  «Can a customer retry a failed payment?»
       why asked: «Checkout» FR-2 says payment succeeds or fails; no source says what
                  happens next, and no edge case covers it
       a marker on «Checkout» is waiting on this — rejecting it decides the marker too
       a[n]swer now · [e]dit · [r]eject · already [d]ecided · [s]kip
```

**Six outcomes, and *answer now* is the one the design turns on**

| Outcome | The row becomes | The marker waiting on it |
|---|---|---|
| **Answer now** | `Status: Answered` — their move, made in the room — with **their words verbatim** in `Answer & why` | patched with the row link; the next `resolve` removes it when the answer is applied |
| **Edit the wording** | stays `Open`, **the human's wording verbatim**, no status change | unchanged |
| **Reject — not a real gap** | `Status: Rejected`, reason in `Answer & why` | **removed**, citing the rejected row ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 4) |
| **Already decided** | `Status: Rejected`, pointing at what answers it | **removed**, citing the requirement or `Not doing` line that answers it |
| **Reject — ask it better** | `Status: Rejected`, reason names the reword expected | **returned to `carried`** (Q6 step 2) — the gap is real, only the wording was wrong |
| **Skip / no answer** | stays `Open`, unanswered | stays `carried`, re-offered next sitting |

**Rejecting requires a reason, and the reason is what decides the marker.** Without that split, rejecting
a badly-worded question either strands its marker forever — reported on that feature
with nothing in any file able to clear it, so the document can never honestly be settled — or silently removes
it, which converts a known unknown into an unknown unknown. Both happened before the reason was asked for.

**Silence is not a decline.** A skipped item is recorded `unanswered` and re-offered next run. One project
produced thirteen silent proposals that a two-outcome review would have suppressed forever, three of which
its owner later wrote out herself, alone. The log carries
`review: 6 offered · 3 answered · 2 rejected · 1 unanswered`; **`unanswered` climbing run over run means
cut the ten to five before adding anything to it.**

**After ten rows, ask exactly one more question: *continue with the next ten now, or stop here?*** A yes
is a fresh round in the same conversation — same rules, same ordering, next ten. A no, or silence,
stops: everything unoffered stays `Open` and unanswered, counted in the report, waiting in the tab. Several rounds
back-to-back in one day is the honest way to clear a drained backlog before a client meeting — and the
one-sitting attention measurements do not cover marathons, which is exactly why continuing is asked,
never assumed.

**A rejection is told what it leaves**, at the review and not in the report afterwards: *"rejecting this
as not a real gap removes the marker on «Checkout» — that gap stops being reported."* Or, for a reword:
*"the marker stays, and «Checkout» keeps carrying an admitted gap until somebody answers this."*

**Answer now closes the gray area in one sitting — with one click deliberately left over.** It is
[`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5 fired at the review: the answer is given out loud, the
run transcribes it **verbatim** and records the row at `Answered` — the human's own move, made in the
room — and the next `resolve` writes it in. **The run never invents the answer and never sets `Answered`
on its own initiative**, whatever seems obvious: transcription of a person's words is the only route,
because the whole provenance design rests on the answer being theirs.

**Writing a question and answering it are different acts by design.** A run's write at the Q4 admission
gate makes a row `Open`, and that is not an approval of anything; only an answer — the human's own, in the
UI or spoken at the review — makes it `Answered`.

---

## Q6 — Dispositions, log, report

1. **Verify every written row's marker was patched at Q4** — a marker still reading `carried` with a row
   written for it is a miss; patch it now, citing the row.
2. **Execute every removal a human's rejection decided** — at a sitting (Q5), or in the UI since the last
   run (Q1) — one at a time, each citing the row that justified it — [`spec/doc-shape.md`](spec/doc-shape.md)
   §9's closing line governs: a removal with no row ID (or, for route 6, no ledger line and `RATIFIED`
   line) is a bug, not a tidy-up. **And before step 3 runs, re-point
   every marker whose row a human rejected *ask it better* back to `→ Question: carried`** (v19) — Q5's
   table and [`spec/doc-shape.md`](spec/doc-shape.md) §9 route 4 say that gap is real, but at this
   moment the marker still reads the row link, and step 3 would sweep it with the rest.
3. **Sweep for markers pointing at a row that reached a terminal state, and remove them
   mechanically, with no review slot.** This is [`spec/doc-shape.md`](spec/doc-shape.md) §9 **route 2**,
   and it is the only marker removal nobody is asked about, because the decision was already theirs when
   they closed the row. A marker pointing at a `Closed (not applied)` or `Rejected` row can never be
   answered, so it blocks for nothing.

   It has a step because [`status.md`](status.md) C5 promises a reader that *the next questions run
   removes it and nobody need do anything* — and a promise with no phase behind it is how a marker sits
   standing forever while every report says it is about to clear. Cite the closed row's
   ID on every removal, and **name each one in the report**: a marker vanishing with no line is a decision
   nobody was told about.

   **A marker pointing at a row that was *deleted* is not this route.** That is broken, and it is
   reported, never quietly removed — the difference is that a closed row still carries a reason and a
   deleted one carries nothing.

4. **Sweep for markers pointing at an `Applied` row — route 1's stragglers.** Removal and write are one
   act at the resolve seam, but a marker on feature A whose answer was applied into feature B is outside
   that act's reach, and a measured drain left sixteen of them each wrongly reported as open.
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
6. **Remove every marker a written content slot now holds** — [`spec/doc-shape.md`](spec/doc-shape.md)
   §9 **route 7**, and this step is its only executor (v30). Q4 wrote the slot; the gap it names is
   no longer an unknown this document carries but a delivery item with an owner, so the marker goes,
   **citing the slot line and its manifest line**. The condition is the slot line being written, not
   the content arriving — route 3's shape exactly. *Without this step `carried` could not read zero
   and the convergence verdict was unreachable on any project using the channel.*

   **A marker a source answered is route 8 and is not this step's** — it is removed by the
   [`add.md`](add.md) run that wrote the source, in the same act, citing the segment and its `item`
   line. Named here so the two are not confused.

7. **Every remaining marker reads one of the three legitimate forms** — `→ Question: <row link>` (a row
   was written for it, step 1), `→ Default: ledger <run id> #<n>, awaiting ratification` (route 6), or
   `→ Question: carried` where neither applies — never `pending`, which names neither state.
8. **Write the row for every answer given out loud** — the review's *answer now* outcome, and any decision
   quoted from a meeting or a message ([`spec/doc-shape.md`](spec/doc-shape.md)
   §9 route 5): the human's words **verbatim** in `Answer & why` (`Owner` is left alone — no run writes it,
   [`spec/databases.md`](spec/databases.md) §2),
   `Status: Answered` where the words were given to the run directly — recorded as the human's own move
   **and equally where a person relays an answer the client gave to a row this document asked**, the
   relayer named (v17). `Status: Open` only for a decision nobody put to this document.
   [`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5 is the single home of that split — **and of the
   verbatim check this step owes before it writes anything**: the words must be findable in the captured
   reply by string match, and words that are not there are not written and no row is moved (v20).
9. **Put the defaults ledger, the fixes batch and the content manifest to their human — one explicit act each, never
   ratification by silence.** The ledger prints risk-sorted (always-ask-adjacent and irreversible items
   first) with each line vetoable by number; the fixes batch prints each replacement beside what it
   replaced. **Before ratifying, the human is handed a small random sample of ledger lines to
   spot-check** — the sample is the honesty probe that keeps a batch act from
   becoming a rubber stamp, and a failed spot-check vetoes the line and doubles the next sample. **Ratifying the defaults batch is the human act that clears each default's patched marker**
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 6); a **veto** converts that line back into a
   marker plus a question through the ordinary gate, and vetoed text is removed in the same sitting. **The two halves of that, reconciled — they read as a
   contradiction and three separate runs said so** (v16). *Put to their human* means **printed, once,
   in the closing report, each line vetoable by number** — that is the explicit act, and the run
   performs it unprompted. It does **not** mean the run waits: silence is not ratification and it is
   not a decline either, so **all three simply wait**, labeled and reported, named by
   [`status.md`](status.md) as they age. **Printing is the run's act; ratifying is the human's**, and
   an unratified default is never silently promoted by time. **Where the answer arrives in this same
   conversation, this run executes it before it closes** — the Q1 procedure, run late: relabel, remove
   or revert per line, one `RATIFIED`/`VETOED` line each (v19: step 8 described the act and named no
   phase that performed it).
10. **Every candidate's disposition is recorded, and every one that is not a question is a line in the log, **and every Q-phase write into a feature body also takes its own `item` line carrying the post-write body hash** (v21)**
   ([`resolve.md`](resolve.md) R5's closed list is the shape).
   A candidate that became a question is carried by its row and counted in the funnel — never re-listed
   line by line, which would put the whole backlog back in the log · a default is its **one**
   ledger line · a slot is its manifest line · a fix is its batch line · a demotion is one line with its
   grounding quote. **A Q3 discard is one line too — its filter and a short quote of the candidate**, so a
   rejection is answerable later without being an open question now; a discard that exists only on the
   sitting's screen is the silent loss the `CON-k` inventory closes for contradictions
   ([`init.md`](init.md) I7). **The one discard that carries more is a `CON-k`-backed one**, which keeps
   both verbatim quotes because the conservation check dereferences them (I7). The counter-case belongs to
   the report. Then the funnel line, fresh: drafted → routed default → routed fix → routed slot → written
   as questions, with per-pass candidate counts and their distribution — numbers, not an account of them.
11. **Regenerate every `⟳` view this sitting touched** ([`spec/doc-shape.md`](spec/doc-shape.md) §3's
   single home) — a fresh count from the rows as they now stand, never the prior view patched forward.
   **And sweep the content rule** over every in-scope field written since the last logged sweep, by a
   human or by a run — [`resolve.md`](resolve.md) R2.5's predicate and field list, which this run's
   `Why asked`, `Suggested directions`, default, fix and slot lines and `Question` titles all fall under
   and over every line this run is about to put into `record/`, the entry and `record/runs/<run-id>.md`
   alike. **The sweep of the record runs before the lines are appended**: a line that cannot survive the
   rule is written as the role, never the specific; a finding in a target field is reported, never
   repaired (§6); and the entry's `SWEEP-NOTE` line carries both ranges so the next sweep starts from
   here (v19: a standalone `questions` run had no sweep step at all).
12. **Report** — every count in it freshly derived at the moment of printing ([`SKILL.md`](SKILL.md)
   rule 7), never carried from an earlier sitting's tally. It opens with the
   **funnel line** — candidates drafted → routed default → routed fix → routed slot → written as
   questions — printed
   fresh every run so a silent regression to question-flooding is visible on its face. **Then the
   convergence line, when all four conditions hold** (v23) — after the funnel, which keeps its fixed
   first position because [`status.md`](status.md) C10 checks it against the discard lines beneath it.
   The four, and all of them: **no feature body changed** since the last grill · **no source was added**
   since it — read as **no `init` or `add` entry standing in `record/run-log.md` newer than the last
   `GRILL` line** (v23; it was the only one of the four with no stated read, and an unstated read is a
   condition each run invents for itself). An `add` handoff is unconditional, so new material must
   never be announced as *"nothing has changed"* · **no candidate survived Q3** from any pass, per-`Area` and
   rotation passes included — a run that wrote three rows out of a rotation pass has not converged ·
   **nothing is outstanding**, meaning no carried marker, no `CON-k`, no unratified batch, **and no
   `Open` or `Answered` row standing** — the line ends *"nothing is waiting on anybody"*, and forty
   unanswered rows are forty people-shaped things waiting. Then:

   > *nothing has changed since run `<id>` grilled this document, and nothing is waiting on anybody.*

   **The run writes that verdict on every run, whether or not the line prints** — the closing clause of
   the entry's `GRILL` line, `converged: yes | no`, and `no` is written as deliberately as `yes` ([`resolve.md`](resolve.md) R5 admits the kind; the funnel's own working
   goes to `record/runs/`, which nothing reads back) — because [`status.md`](status.md) reads it back rather than re-deriving it,
   and re-deriving it would be the prediction that file forbids. A run meeting three of the four names
   the one it missed — **in the report, not the log**, since R5's kinds admit no line for it and none
   is paragraph-shaped. Then the report carries the
   **`DEFAULTS ADOPTED (n) — ratify or veto by number`**, **`FIXES APPLIED (n) — ratify below`** and
   **`CONTENT SLOTS (n) — one batched sign-off`** blocks, the **suggested directions**
   block (below) for the top proposals, and the per-feature routing diagnostic — a feature carrying more
   than about one open question is named with which channel leaked, never used as a generation target
   and **it ends with the client packet — a candidate list, not a send.** The report proposes every
   `Open` row grouped by `Area` (via `Touches`; project-level rows in their own group), so taking
   only one `Area` group is a choice the packet supports without becoming two packets. **A human decides
   what actually goes, and a human sends it** ([`SKILL.md`](SKILL.md) rules 1 and 5): since v13 a run
   writes questions directly to `Open`, so the `Open` view holds machine-written rows a person may not
   have read yet, and piping it to a client unread is the one failure retiring that state could
   have caused. The packet names how many rows it proposes and states plainly that they are the run's
   selection awaiting a person's. Beside it, the honest line: applied answers create new attackable text,
   so expect one smaller derivative batch after these are resolved.

**Suggested directions — decision support on the row, machine-labeled, consumed by no run.** The run
that writes a question row also drafts its `Suggested directions` field
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
document is struck ([`SKILL.md`](SKILL.md) rules 6 and 8). **With no dispatch available the quotations
are still checked, mechanically**: rule 6(d)'s string match on normalised whitespace, one `citation`
line each in the log, a quotation that does not match dropped and the mismatch reported. **The
directions are still written** — it is the unmatched quotation that is withheld, never the whole
field. The field is for the reviewing human only:
no run reads it back, nothing from it is ever copied into `Answer & why`, and an answer that only
points at an option (*"go with 2"*) is an answer that is only a link — [`resolve.md`](resolve.md)
R2.1: it ends `Flagged`, named with the one-line fix. A choice made **in conversation** — at a checkpoint,
or after asking *"suggest directions for q-12"*, which drafts one fresh under the same rules — is
transcribed with the chosen option's content as the human's own move
([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5). *Decided by the owner 2026-08-07, overriding
the report-only recommendation and the schema-minimalism bar with the risks on the table: the owner
reviews in the UI, and guidance nowhere near the review is guidance nobody reads. The
recommendation-collapse citation (82.3→45.5) is answered by the options-with-counter-cases shape, the
verification pass and the standing label — not denied.* The report still prints the top ten.

```
QUESTIONS — «Golden Crumb» · 2026-08-11

FUNNEL     31 candidates drafted → 14 routed default · 2 routed fix · 1 routed slot · 3 written as questions
           (1 transcribed from a carried marker) · 11 discarded on a filter (listed with
           their counter-case). Per-pass counts logged; distribution in record/runs/.
DEFAULTS ADOPTED (14) — ratify or veto by number; risk-sorted, spot-check sample: #3, #11
   1. «Checkout»  Default (standard practice — ratify on review): reset links are
      single-use and expire — does not decide: any legal promise about erasure timing
   2. «Ordering»  Default (adopted from the ratified design, frame 12:400 — ratify on
      review): the basket persists across the payment detour
   … 12 more, each one line, grounding + what it does not decide
FIXES APPLIED (2) — ratify below
   «Loyalty» FR-3 under-enumerated its own list (quote → replacement, applied)
   «Checkout» stale line superseded by the applied answer on q-04 (quote → replacement)
WRITTEN    3 → Open, each naming its client-only act. No sitting asked — they wait in
           the Unsent tab (questions.md on a local folder): answer directly, reject with a
           reason, or carry into a packet.
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

An empty question list is not evidence this Blueprint is complete.

Untouched: every feature body except the 14 default lines, 2 fixes and 15 markers named
above, every other block.
```

---

## Edge cases

| Situation | What the run does |
|---|---|
| Nothing to propose | Say so in two lines. A short report on a well-covered Blueprint is the honest outcome, and the standing caveat above still prints |
| A feature carries more than roughly one open question | The re-gate fires: re-run the gate over the whole batch before writing any of it. What survives is written; what does not is disposed through another channel or discarded on a named filter. **Nothing is parked** — a gap that lands nowhere is one the next run has to find again |
| More than ten real gaps | Every one that passes the gate is written and listed, most important first. A sitting, if asked for, offers ten at a time (Q5). **Nothing found is left undisposed** — written, defaulted, slotted, fixed or discarded on a named filter, and the funnel line prints the split |
| A human already answered or rejected rows in the UI and also wants a sitting | Q1 takes those moves as given; only rows still `Open` and unanswered reach Q5 |
| A human rejects everything | A legitimate outcome. Every marker disposition still runs, and the report says what was left carried |
| A proposal duplicates a rejected row | Not proposed again unless new source material bears on it — then once, citing the rejection |
| A marker names no entity | Reported as broken, never guessed at. *"Is this right?"* is not a marker and cannot be turned into a question honestly |
| Two markers on the same requirement | Both listed; one question may resolve both, and it says so |
