# Run — questions

**Grill the Blueprint**: adversarial passes over the whole document generate question **proposals** from
what it cannot answer yet, and the **gated review** turns the ones a human approves into real questions.
Answering them is what solidifies the document — a gray area a builder would have filled in silently
becomes a decision somebody actually made.

Run on demand — *"grill this spec"*, *"what should we be asking?"* — and automatically at the end of
[`init.md`](init.md) I7 and [`add.md`](add.md) A5, and one final time before a lock
([`lock.md`](lock.md) L1). Either way it is these six phases, in this order.

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

**Run the six pre-flight checks in [`SKILL.md`](SKILL.md) first.** This run works the same on a locked
Blueprint — proposals and marker links are the question layer, not product intent, so they need no
change-log entry ([`lock.md`](lock.md) L4 draws that line).

---

## Q1 — Reconcile what a human already did

**First, and before anything is generated**, read every question row and take account of what people did
since the last run — in the UI, at their own pace, without this skill.

- `Proposed → Open`: **a human approved it.** Accept that. Give it an owner if it has none, by asking.
- `Proposed → Rejected`: **a human rejected it.** Accept that, and read `Answer & why` for the reason so
  Q6 can dispose of any marker that was waiting on it.
- `Proposed`, edited wording: accept the human's wording as the question. Never restore the original.
- Anything at `Open`, `Answered`, `Applied`, `Flagged`, `Closed (not applied)` or `Rejected`: not this
  run's business, except as duplicate-detection input at Q3.

**A run never reverses a human's move**, and never re-proposes something a human rejected unless new
source material bears on it — in which case it is proposed once, citing the earlier rejection so the
reviewer can see they are being asked twice and why.

This phase is first because generating before reading it means proposing questions somebody already
approved this morning. **Open the run-log entry here**, before any proposal is written, and close it at
the end ([`SKILL.md`](SKILL.md) pre-flight check 5).

---

## Q2 — The grilling

Over the Blueprint **as it stands now**, not as some earlier run left it. This is not a checklist pass —
it is an attack. **Four adversarial lenses, each run as its own pass with its own framing**, because a
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

**And the standing sweep, after the lenses** — the mechanical part:

1. **Open markers with no question behind them** — every `→ Question: carried` marker
   ([`spec/doc-shape.md`](spec/doc-shape.md) §9). These are first: a marker is a gap somebody already
   agreed was a gap.
2. **Contradictions** carried in from [`init.md`](init.md) I2 or [`add.md`](add.md) A2 — between two
   sources, or between a source and what the Blueprint says. Each gets **one blocking question** naming
   both sides.
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

| Filter | Discard when | Instead |
|---|---|---|
| **Already answered** | A requirement, an `Edge cases` line, a `Not doing` line or the NOT-clause answers it — **and you can quote the sentence** | Link to the answer, quoting it |
| **Duplicate** | A question row already asks it, in **any** status | Point at that row |
| **Implementation, not intent** | The answer changes how it is built, not what the feature is | A `Rabbit holes` line, or nothing |
| **Unanswerable here** | It turns on a party outside this project, or nobody can decide yet | Name it in the report; no row |
| **Already decided against** | It is a decided exclusion | A `Not doing` line, never a question |

---

## Q4 — Write the proposals

**About ten per sitting, and no more.** Past that people stop reading and start agreeing, which is worse
than a shorter list. **Order them by how much the answer changes what gets built, and by whether the named
owner can actually answer it** — an ordering policy reaches near-ceiling with 3.0 questions against 5.1
unordered, and past the plateau each further question is less answerable rather than more thorough. Say
the list is ordered and on what. It is a judgement and it is labelled as one.

Everything past ten is **carried, not lost**: named as next sitting's in the report, and its marker reads
`→ Question: carried`. **The cap binds what the run offers, never what a person may take** — anyone at the
review can pull a named carried item into this sitting.

Each proposal row: `Question` phrased **as a question**, in one sentence · `Why asked` naming what
prompted it and **whether a marker is already waiting on it**, because that changes what rejecting costs ·
`Touches` set where it is feature-scoped, empty where it is project-level · `Status: Proposed` ·
`Confirmed: AI generated` · `Confirmed by` empty · **`Owner` suggested, not set** — the owner is part of
what the human approves.

---

## Q5 — The review, row by row

**Ask one row at a time, never as a list.** The same seven minutes put as a list produced two of five
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
| **Answer now** | `Status: Answered`, **their words verbatim** in `Answer & why`, their name as `Owner`, `Confirmed: AI generated`, **`Confirmed by` empty** | patched with the row link; the next `resolve` removes it when the answer is applied |
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

**A rejection is told what it leaves**, at the review and not in the report afterwards: *"rejecting this
as not a real gap removes the marker on «Checkout» — that feature can then be agreed."* Or, for a reword:
*"the marker stays and «Checkout» still cannot be agreed until somebody answers this."*

**Answer now closes the gray area in one sitting — with one click deliberately left over.** It is
[`spec/doc-shape.md`](spec/doc-shape.md) §9 route 5 fired at the review: the answer is given out loud, the
run transcribes it verbatim, and the row waits at `Answered` with **`Confirmed by` empty**. The human puts
their name on it — one click in Notion, one line in a file — and the next `resolve` writes it in. **If
they never do, nothing enters the document**, which is the honest failure. The run never fills that field,
whatever was said at the review: the vet is the one act that must survive as a person's own, because the
whole provenance design rests on it.

**An approval never sets `Confirmed = Human approved`.** The row is `AI generated` until a person answers
it and vets their own answer. Approving a *question* and vetting an *answer* are different acts by design.

---

## Q6 — Dispositions, log, report

1. **Patch every marker whose proposal was approved** with the link to its row.
2. **Execute every removal Q5 decided**, one at a time, each citing the row that justified it. **A marker
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
4. **Where Q2 item 9 turned a decided exclusion loose in prose into a `Not doing` line, remove any marker
   that line now answers, citing the line.** This is [`spec/doc-shape.md`](spec/doc-shape.md) §9
   **route 3**, and this step is its only executor. A decision is not an unknown, so a marker raised over
   something a source had already decided is blocking for nothing — but it is removed **because the line
   was written**, never merely because the exclusion was noticed. Where the line has not been written
   yet, the marker stands.
5. **Every remaining marker reads `→ Question: carried`** — never `pending`, which names neither state.
6. **Write the row for every answer given out loud** — the review's *answer now* outcome, and any decision
   quoted from a meeting or a message ([`spec/doc-shape.md`](spec/doc-shape.md)
   §9 route 5): the human's words **verbatim** in `Answer & why`, their name as `Owner`,
   `Status: Answered`, `Confirmed: AI generated`, **`Confirmed by` empty** — they set that themselves, and
   until they do, nothing enters the document.
7. **Log every proposal with its outcome**, including the rejected ones and the reason, so a rejection is
   answerable later without being an open question now.
8. **Report.**

```
QUESTIONS — «Golden Crumb» · 2026-08-11

PROPOSED   6 of 14 candidates · 8 discarded on a filter (listed with their counter-case)
REVIEWED   3 approved (Ana ×2, Tom ×1) · 1 answered now (waiting on Ana's name in
           Confirmed by — then resolve writes it in) · 2 rejected · 1 unanswered, back next sitting
MARKERS    2 patched with their row · 1 removed («Loyalty» — rejected as already decided,
           answered by the Not doing line on point expiry) · 4 still carried
CARRIED    4 markers have no question yet — «Refunds» ×2, «Checkout» ×2. They block
           Intent = Agreed on those features. Next sitting proposes them; nothing is lost.
NOT PROPOSED, AND WHY
  «Should the menu cache?»        implementation, not intent — a Rabbit holes line instead
  «What is the refund window?»    duplicate of q-07, already Open and owned by Tom

An empty proposal list is not evidence this Blueprint is complete.

Untouched: every feature body except the 3 markers named above, every other block.
```

---

## Edge cases

| Situation | What the run does |
|---|---|
| Nothing to propose | Say so in two lines. A short report on a well-covered Blueprint is the honest outcome, and the standing caveat above still prints |
| More than ten real gaps | Ten offered, the rest carried and named. The cap is measured; the completeness rule is not, so the cap wins |
| A human approved rows in the UI and also wants a review | Q1 takes the approvals as given; only rows still at `Proposed` reach Q5 |
| A human rejects everything | A legitimate outcome. Every marker disposition still runs, and the report says what was left carried |
| A proposal duplicates a rejected row | Not proposed again unless new source material bears on it — then once, citing the rejection |
| The Blueprint is locked | Runs normally — proposals and marker links are the question layer, not product intent, so no change-log entry is owed ([`lock.md`](lock.md) L4) |
| A marker names no entity | Reported as broken, never guessed at. *"Is this right?"* is not a marker and cannot be turned into a question honestly |
| Two markers on the same requirement | Both listed; one question may resolve both, and it says so |
