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
- `Proposed → Answered`, moved in the UI with an answer written: **a human approved and answered in one
  move** — both acts at their strongest, made at their own pace in their own tool. Accept it: patch any
  marker waiting on it with the row link, and backfill `Owner` by asking if it is empty. The row is
  resolve-eligible as it stands ([`spec/databases.md`](spec/databases.md) §4); nothing routes it back
  through `Open`. An `Answered` row with an **empty** `Answer & why` is different — that is a status with
  no answer behind it: report it and leave it, a discrepancy for its human ([`SKILL.md`](SKILL.md) rule 1).
- `Proposed`, edited wording: accept the human's wording as the question. Never restore the original.
- `Key` set or cleared by a human — detected as a divergence from what the run log records the last run
  wrote: **their move wins.** Accept it, never re-derive over it, name it in the report.
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

**Lens 1 — the builder who must not guess.** Walk each feature as if implementing it tomorrow, forbidden
from deciding anything yourself. Every place you would have to stop and ask — which record, whose data,
what happens on a tie, what the default is, where the number comes from — is a candidate. This is the
lens that finds what a checklist cannot, because it reads the document the way its real consumer will.

**Lens 2 — the hostile tester.** Attack each numbered requirement: try to construct an input, a state or
a sequence the sentence does not decide. **The two-drafts test is the sharpest tool here** — draft both
behaviours a requirement could mean and compare; where the drafts diverge, the divergence itself names
the question. Readings that disagree catch what asking *"is this ambiguous?"* misses, and reasoning
harder does not close that gap.

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
   Area pass briefed with that Area's full feature bodies and the overview's NOT-clause — the focused-brief
   shape the resolve seam already mandates. Lens 4 runs once per Area-pair where two Areas share records
   or actors; lens 5 stays whole-document, once — it is definitionally the front door against everything.
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
3. **One repeat round, budget-stated.** Any pass whose candidates survived Q3 two or more times is
   dispatched once more, fresh. **Two rounds is the budget, not a completeness claim** — a round finding
   nothing new means this generator is dry, never that no gaps remain.

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
holding per discard. **When in doubt, propose:** a false merge silently converts a known unknown into an
unknown unknown, which is the worse failure by this file's own rules — a duplicate costs a reviewer one
`[r]eject`; a false merge costs the project a question nobody will ask again.

| Filter | Discard when | Instead |
|---|---|---|
| **Already answered** | A requirement, an `Edge cases` line, a `Not doing` line or the NOT-clause answers it — **and you can quote the sentence** | Link to the answer, quoting it |
| **Duplicate** | A question row already asks it, in **any** status | Point at that row |
| **Implementation, not intent** | The answer changes how it is built, not what the feature is | A `Rabbit holes` line, or nothing |
| **Unanswerable here** | It turns on a party outside this project, or nobody can decide yet | Name it in the report; no row |
| **Already decided against** | It is a decided exclusion | A `Not doing` line, never a question |

---

## Q4 — Write the proposals

**Every candidate that survives Q3 is written as a `Proposed` row — all of them, this sitting.** The
`Proposed` state is the holding pen this design already built: invisible to every open-questions view and
every queue ([`spec/databases.md`](spec/databases.md) §3), so volume there misleads nobody. A found gap
that is not written is a gap the next run has to find again — and the measured cost of parking is real: on
one project the carried backlog grew to ~80 known gaps with no row behind them while every sitting offered
ten, and no later sitting ever drained it, because fresh finds kept outcompeting the backlog for the ten
slots.

**Every carried marker with no row behind it is written too** — transcription, not generation: the marker
already names its entity; `Why asked` cites the marker and the run that minted it. After this phase,
`carried` reads zero until the next write run mints more.

**The run does not open a review sitting on its own — it writes, reports, and stops.** A person reviews
in the `Proposed — needs review` tab at their own pace, and Q1 reconciles every move next run; Q5 runs
only when a person asks to go through the rows together. Where a sitting does run, about ten rows are
offered at a time and no more — past that people stop reading and start agreeing, which is worse than a
shorter list. **Order the list — in the report and at any sitting — marker-backed candidates first** — a
marker is a gap somebody already agreed was a gap, and it blocks `Intent = Agreed` on its feature; that
precedence is never demoted beneath any judgment — **then `Key` rows, then by how much the answer changes
what gets built and by whether the named owner can actually answer
it**: an ordering policy reaches near-ceiling with 3.0 questions against 5.1 unordered. Say the list is
ordered and on what. It is a judgement and it is labelled as one.

**The `Key` checkbox** ([`spec/databases.md`](spec/databases.md) §2) is set at write time where a stated
criterion holds — the candidate is **contradiction-backed**, or **the document cannot sensibly be built
without the answer** — and the one-line criterion is written as the closing clause of the row's
`Why asked`. Default false hides nothing. **Each questions run re-derives `Key` for `Proposed` rows and
writes only where the current value equals what the run log records the last run wrote** — a divergence
is a human's re-tier, left alone and named in the report. The verification dispatch that checks
suggested directions checks the `Key` assignments of the same batch against their stated criteria; an
assignment whose criterion does not hold is cleared before writing.

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
4. **Where Q2's standing sweep item 5 turned a decided exclusion loose in prose into a `Not doing` line, remove any marker
   that line now answers, citing the line.** This is [`spec/doc-shape.md`](spec/doc-shape.md) §9
   **route 3**, and this step is its only executor. A decision is not an unknown, so a marker raised over
   something a source had already decided is blocking for nothing — but it is removed **because the line
   was written**, never merely because the exclusion was noticed. Where the line has not been written
   yet, the marker stands.
5. **Every remaining marker reads `→ Question: carried`** — never `pending`, which names neither state.
6. **Write the row for every answer given out loud** — the review's *answer now* outcome, and any decision
   quoted from a meeting or a message ([`spec/doc-shape.md`](spec/doc-shape.md)
   §9 route 5): the human's words **verbatim** in `Answer & why`, their name as `Owner`,
   `Status: Answered` where the words were given to the run directly — recorded as the human's own move —
   or `Status: Open` where the decision is second-hand, for its decider to move on themselves
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5).
7. **Log every proposal with its outcome**, including the rejected ones and the reason, so a rejection is
   answerable later without being an open question now. **Every Q3 discard goes into the run-log entry
   too** — filter, verbatim quote and counter-case, not only the sitting's printed report: a report is a
   screen and the log is the record, and a discard that exists only on a screen is the same silent loss
   the `CON-k` inventory closes for contradictions ([`init.md`](init.md) I7).
8. **Regenerate every `⟳` view this sitting touched** ([`spec/doc-shape.md`](spec/doc-shape.md) §3's
   single home) — a fresh count from the rows as they now stand, never the prior view patched forward.
9. **Report** — every count in it freshly derived at the moment of printing ([`SKILL.md`](SKILL.md)
   rule 7), never carried from an earlier sitting's tally, the `Key` tally among them. It carries the
   **suggested directions**
   block (below) for the top proposals, and **it ends with the client packet: every
   `Open` row, grouped by `Area` (via `Touches`; project-level rows in their own group), framed as the
   one batch to take to whoever answers — `Key` rows starred inside their groups**, so taking only the
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
(*"general practice, not a source"*). Dated, and closed with the standing line: *machine-drafted
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

WRITTEN    12 of 14 candidates → Proposed (3 transcribed from carried markers) · 2 discarded
           on a filter (listed with their counter-case)
REVIEW     no sitting asked — all 12 wait in the Proposed tab, listed below most important
           first: approve, reject with a reason, or answer directly there. Or ask for a
           sitting and they come ten at a time.
SUGGESTED DIRECTIONS — top 2 by the same ordering · verified by a second dispatch ·
           written to each row's Suggested directions field, shown here for the top of the list
  «Can a customer retry a failed payment?»
    1. One retry on the same order — FR-2 already isolates payment as its own step
       ("payment succeeds or fails"); counter-case: a retry needs an idempotent order.
    2. No retry; the customer starts over — simplest; counter-case: the basket is lost
       at the moment of highest intent.
    General practice, not a source: payment providers assume idempotency keys either way.
  «Do points expire?» — 2 directions, same shape (elided here)
MARKERS    5 patched with their row · 1 removed («Loyalty» — rejected as already decided,
           answered by the Not doing line on point expiry) · 0 carried
WAITING ON ANSWERS — the whole batch, take it in one go
  Ordering (3)  «Can a customer retry a failed payment?» (Ana) · 2 more
  Loyalty  (2)  «Do points expire?» (Tom) · 1 more
  Project  (1)  «What does success look like in month one?» (Ana)
  Applied answers create new attackable text — expect one smaller derivative batch after
  these are resolved.
NOT PROPOSED, AND WHY
  «Should the menu cache?»        implementation, not intent — a Rabbit holes line instead
  «What is the refund window?»    duplicate of q-07, already Open and owned by Tom

An empty proposal list is not evidence this Blueprint is complete.

Untouched: every feature body except the 6 markers named above, every other block.
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
| The Blueprint is locked | Runs normally — proposals and marker links are the question layer, not product intent, so no change-log entry is owed ([`lock.md`](lock.md) L4) |
| A marker names no entity | Reported as broken, never guessed at. *"Is this right?"* is not a marker and cannot be turned into a question honestly |
| Two markers on the same requirement | Both listed; one question may resolve both, and it says so |
