# HISTORY — why the rules in this skill say what they say

Every passage here was moved out of a run or spec file. **No run loads this file**; it is for whoever
maintains the skill. It is deliberately outside `lint.sh`'s manifest for the same reason.

Each entry names the file and the section the passage explained. The rules themselves were not
changed by the move — only relocated.


## SKILL.md

### blueprint

(v16, at the owner's direction — the lock was removed for simplicity)

### The five commands

This file has already misread one of its own: the 44.4% figure was cited as precision when it is recall, and it shaped design decisions before v13 caught it. Platform facts were given an expiry and the evidence base was not; v19 stops claiming the evidence base has one until it does.

### The shape-change register — the single list of version bumps that changed the target

Added v17 after a measured campaign where a behaviour-only bump halted every run that had a prior log, or forced a run to violate a mandated halt to get anything done: the check could not tell the two kinds of gap apart, so it treated the harmless one as the dangerous one.

### The rules that outrank everything

(v13; the retired approval state and its per-row approval were retired at the owner's direction, on the same logic that retired `Key`: the gate now refuses at the cause, so a downstream compensator for over-generation buys nothing. Measured on the run that prompted it — 43 of 43 standing rows re-admitted correctly, 0 of 7 carried markers admitted, two independent passes)

### The rules that outrank everything

Measured: in a five-project campaign where dispatch demonstrably worked and the runs were told so, three of five runs read their tool surface, concluded no mechanism existed, and wrote the unavailability string into the committed record; one of them then counted 46 items `Clean` off a checker that never ran. The rule warned about claiming independence that did not happen and said nothing about conceding it when it could — so a run could skip the skill's one structural defence against a rubber stamp and be honest by its own lights while doing it.

### The rules that outrank everything

A literal match keeps 5 of 19 quotations on a measured run, because a document wraps its lines and a quotation does not; the run that got this right invented the normalisation itself, which means the rule was underwritten.

### The rules that outrank everything

v17 narrowed this. Written unconditionally it stripped **every** grounding quotation from every direction on every dispatch-less run — one measured project went from 7 verified quotations to 0 of 26 — to prevent the single fabricated citation that a string match would have caught outright: a sentence attributed to the overview that only ever existed in a pitch deck. Fabricated citations 1 → 0 is worth having; grounded citations n → 0 is not the way to get it.

## init.md

### Progress

Added v18: two independent runs of one fixture stopped a different number of times because no file said which stops were sanctioned — the least reproducible behaviour a measured campaign found.

### I1 — Collect the sources

(v20: a second sentence here used to tie the entry's birth to the structure's instead, which contradicts the rule above at every run that stops at I3 — the structure is created at I4, and a run that halts earlier has already written sources, hashes and a target address with no entry open. A measured campaign hit exactly that, and one run wrote its whole Blueprint across two sittings with no entry open at all. `lint.sh` now forbids that sentence returning.)

### I3 — Propose, and stop

Measured: an operator answered three questions at this stop, found there was nowhere to record them, and hand-authored the questions file herself — "I had three answers in hand and nowhere to put them."

### I5 — Write the Blueprint

Measured: I5 named no default channel at all while [`SKILL.md`](SKILL.md) rule 4 plainly permits a labeled default sentence, and a run resolved the silence by writing four defaults here and back-fitting them to the ledger at I7, outside the check that exists to catch a bad one.

### I6 — Faithfulness check

Named here because a measured run found no verdict on this list that fitted and invented one — "unverified, no finding" — for 34 items.

### I6 — Faithfulness check

Measured in a campaign where several runs were interrupted: an entry carrying a real independence line and not one verdict, beside four feature bodies that had demonstrably been checked.

### I7 — Questions, and finish

Added v16: a measured campaign left individual names in three of five committed records, twice after a check had certified that surface clean, because `init` and `add` had no sweep at all and `status` C9's scope did not reach `record/runs/`.

### I7 — Questions, and finish

The supersession disposition was added v16 and without it the **default `add` path cannot close at all**: `add.md` A4 routes a source-vs-document contradiction into this same inventory, a supersession is not a question row, a marker, an I3 answer or a Q3 discard, so every one of them is an orphan and this check halts the run. Measured on the first live default-mode `add`: four supersessions, four orphans, and the run closed only by naming the defect. It sits directly on the owner's ask 2, and `soft` never reaches it because `soft` routes every contradiction to a marker plus a row.

### I7 — Questions, and finish

(v20: the older wording here read as opening the entry at this phase, which contradicted I1.)

## add.md

### Two modes

v22 made this section the single home of the mode grammar for **both** write seams rather than for `add` alone, and `resolve.md`'s table now cites it. Nothing about `add`'s behaviour changed; the grammar was already right, and the alternative — a new shared section in `SKILL.md` — bought one indirection on a file `spec/run-progress.md` already points at for *"the mode, where the command has one"*.

### Run — add

(v16, at the owner's direction: client-confirmed changes were being turned back into questions)

### Progress

Added v18: two independent runs of one fixture stopped a different number of times because no file said which stops were sanctioned — the least reproducible behaviour a measured campaign found.

### A3 — State the delta

(v16: this was a hard stop until the owner removed it — "it has to complete all the flow … all by itself, to the end." What replaces the gate is the record: every write is named here before it lands and quoted in the report after.)

### A5 — Check, then questions, then finish

Added v16: one measured `add` left ten individual names in its own committed `record/runs/` file.

### A5 — Check, then questions, then finish

(v16: a second obligation here minted a carried marker for every `Not doing` line written without a `revisit if:`. Removed with the question class it fed — [`questions.md`](questions.md) Q2 sweep item 4. Such lines are named in the report.)

### A5 — Check, then questions, then finish

(v16: the deferral branch was removed at the owner's direction — "it has to complete all the flow including then generating questions for that add input material scope, all by itself, to the end")

## questions.md

### Q3 — the depth filter, and Q4's third demotion evidence

Both added v23, from one complaint: *"we dont want it to be keep creating questions after answering some, its okay, but in the previous versions it was infinite loop making imposible for teamn to use it, it is also making too many meaninglless questions or meaning is too small, like what about this and that text, or text in the privacy policy."*

**The loop.** No convergence rule existed anywhere: the battery ran whole-document every run, `resolve` wrote answers **into feature bodies**, and `status`'s NEXT line prescribed another run — so answering enlarged the surface the next grilling attacked. The first fix drafted was delta-scoping by body hash, and an adversarial pass killed it: the bodies `resolve` writes into are exactly the bodies whose hash changed, so it would have saved the cost of untouched features and left the branching factor untouched. What was missing was a bound on **derivation**, not on surface.

**Why depth is stamped rather than traced.** The second draft traced depth through `(Applied … from «row»)`. That line exists on `Clean` and `Patched` only: a `Superseded` verdict writes `add.md` A4 step 5's shape, whose «…» held a source segment, and DEFAULT, DOC-FIX, CONTENT SLOT and every overview write carry no row at all. On this file's own funnel sample — 14 defaults, 2 fixes, 1 slot, 3 questions — a traced cap would have been inert on seventeen dispositions in twenty. So every channel that writes body text stamps `· depth n` as it writes, and `spec/doc-shape.md` §5 gained the row's entity ID beside its title in the same edit, because §8 says everything binds to IDs and that sample had cited a title alone since it was written.

**Why the cap is a Q3 filter and not a Q4 cap.** As a Q4 cap it had no durable home — a suppression is not a discard, so nothing read it back and it would have been re-derived and re-printed every run, the complaint surviving in report form. As Q3's eleventh filter it is an ordinary discard with a filter and a counter-case; it is also disposed *before* the convergence test counts survivors, which the Q4 placement would have blocked forever. And it answers the parking objection on this file's own scoping: *"no found gap is parked"* governs candidates that **survive Q3**.

**The meaningless questions were not a missing rule.** Three filters already name that class — **Deliverable content** names *"copy"*, **Client-internal** names *"legal operations"*, **Not a specification question** is the general form — and Q3 runs on every candidate before Q4. They were written anyway because Q4's disposition check **fails open to asking** unless the non-question side produced *"full demotion evidence"*, defined as a verbatim quote or four attested conditions. A routing to any of those three filters produces neither, so the blind model's QUESTION verdict won over the top of a correct discard. The third evidence class closes that, and it is an obligation on the routing side in a citable form — the router names the two or three requirements it surveyed, and the blind side is given that list — because the blind model sees *"the candidate and its grounding alone"* and cannot survey what it is asked to find empty.

**The trade, recorded because it was made knowingly.** A depth-3 candidate can be a real gap, and capping it is a gap found and not written. It is disposed as a discard with a counter-case rather than in silence, and the owner chose the bound after being shown the trade.

### What the v23 simulation campaign changed, and it changed a lot

`blueprint-sim5/` ran v23 against a pre-written key with a **v21 control arm**, an operator agent
forbidden the key, write-protected snapshots, and an executed harness probe. **The mechanisms bound
where the key said they must** — a depth-3 question was discarded, a contradiction at depth 3 was
written anyway, the copy question routed to a content slot where v21 wrote it as a row, and convergence
correctly refused to fire with rows standing. The control confirmed the diagnosis independently, having
been told nothing about it: *"Is there ANY bound on derivation chains? There is none"*, and — the
sentence that explains the whole complaint — *"no Q3 scope filter can produce either evidence form, by
construction, so any blind QUESTION verdict beats any scope discard, always."*

**Five ways to turn the fix off silently were found, all of them in the first draft of it, and the fix
round after the campaign is what this section records.**

- **The stamping vocabulary could not express the value the cap tests for.** It said *"`· depth 1` on a
  question grounded in original material, `· depth 2` on one derived from answer-written text"* — a
  closed pair. The filter tests *depth 3 or deeper*, so read literally **it could never fire on
  anything**. The vocabulary is now open in `n`.
- **The corroboration guard had no test.** *"A depth is read only from a line this Blueprint's own run
  log corroborates"* named a threat and never said what corroboration was; under the strict reading a
  probe found nothing in the log corroborated anything and **every depth fell to 1**. It now states the
  test, and — the part that matters — **fails toward trusting an old line**, because a cap that quietly
  stops applying on a rotated log is worse than no cap.
- **The fail-open closure looped.** A silent routing became *"not a routing"* and went back through the
  gate — whose own disposal for that class is one of the three filters requiring a survey. A probe
  traced it: *"silence from the router can produce the exact row v23 was written to prevent."* The
  re-routing is now bounded at one, and a second refusal writes the row **and names the refusal in the
  report**, because a router that will not say what it surveyed is a fact a person should see.
- **The survey was checkable on form and unfalsifiable on fact.** A probe produced a compliant survey
  whose supporting clause named a requirement **that did not exist in the document**, and nothing caught
  it, because rule 6(d)'s check is a string match and the record quoted nothing. The survey now quotes
  each requirement's own sentence, which puts it back inside 6(d) unchanged.
- **The blind side held the evidence and had no lever.** It was given the surveyed text expressly so it
  could check a claim, and the ordering then said the finding wins whenever produced — so *"the blind
  side read the surveyed text, disagreed, and the demotion was taken anyway."* A QUESTION verdict from a
  side that held the sentences now defeats the finding.

Also from the campaign: the shared-entity clause read so widely that *"the narrowed attack surface is
identical to the full battery"* on a small coherent document, so it now keys on the **changed text**
rather than the whole changed body; the `GRILL` line counted every lens, which would have left the
rotation clock permanently vacuous, so it counts lenses 1–3 and records **how** each body got there;
and convergence condition two — *"no source was added"* — was the only one of four with no stated read.

### Q2 — the re-grill's attack surface

Delta-scoping survived v23 only as a **cost** measure, with rotation: a body outside the delta is attacked anyway if no run in the last three has attacked it. The battery measures ~86% caught outright on a first grill, so repetition is the only compensator for the ~14% it misses, and the owner had chosen completeness over a cheap sampler on 2026-08-07. Skipping outright would have made a once-grilled body's misses permanent. The delta and the rotation age were first taken from the `HASHES` line every write command already writes, on the reasoning that no log kind was then needed. **A final-review dispatch showed that was wrong, and the error is worth keeping here because it is subtle:** `HASHES` records the hash of a body a run **wrote or read back**, so a `resolve` run that applies six answers leaves those bodies matching their newest recorded hash — a delta taken there is empty for exactly the answer-written text the next grill exists to attack, and the fix would have turned the grill off rather than bounding it. The rotation clock had the same hole from the other side: a hash cannot tell a body a default was written into from one three lenses tore apart. So `GRILL` was added after all, carrying what the **lenses** last saw, which is a different fact from what a writer last wrote.

### Run — questions

Measured before this rule existed: of 693 written questions, 4.8% needed the client; 442 were settled by ordinary convention, 137 by the document or the ratified design the run already held. The tool's job is to catch missing areas, not to convert every convention into review work.

### Progress

Added v18: two independent runs of one fixture stopped a different number of times because no file said which stops were sanctioned — the least reproducible behaviour a measured campaign found.

### Q2 — The grilling

(v16, at the owner's direction — this class was the largest manufactured source of questions in the tool and it asked the client to hold a strategy conversation)

### Q4 — Dispose, then write

(v12: (b) was previously "what goes wrong outside the codebase if it is never answered" — a test that points away from the build and admits the client's internal operations verbatim; the build-gating criterion existed all along as the `Key` triage flag, applied after admission to rank rows — the wrong lever. It is promoted here and the flag retired.)

### Q4 — Dispose, then write

(v12 — the earlier text both mandated escalation on any divergence and permitted demotion on evidence, in the same paragraph, leaving the operator's behaviour undetermined between two readings with opposite costs)

### Q4 — Dispose, then write

Measured: a run wrote ten rows and stopped while the human sitting in front of it had answers to six of them and had already said "yes, let's do it, ten at a time" — an answer keyed to a question the file forbade the run to ask. The offer costs one line; not offering cost six client decisions.

### Q5 — The review sitting — on request only

(v13: `approve` and `edit-then-approve` left this table when the approval state was retired — a row is already `Open`, so there is nothing to promote. Editing the wording survives on its own, as an edit rather than a promotion.)

## resolve.md

### Two modes

Added v22 at the owner's direction. `resolve` had `add`'s default behaviour hard-wired since v16 — a vetted answer superseded the document text it contradicted — with no name for it and no way to ask for the other behaviour. The owner's line was that both write seams should overwrite by default and both should have a `soft` mode, and that **no mode of any command may stop, ask the user, or wait**: *"must proceed always all to the end in any command/mode."* So `add` did not change at all — its two modes already were that — and the work was `resolve`'s missing half.

`soft` here ends the row `Flagged` rather than minting a marker and a question the way `add soft` does, and that asymmetry is deliberate: `add` mints markers and question rows, this seam mints neither, and R4's two terminal states are the whole disposal rule. A `Flagged` row already carries its objection, `status.md` C1 already prints it, and the round trip back is one drag to `Answered` plus a default-mode run.

**What was planned and dropped, recorded so it is not reinvented.** Between the ask and this, a design was written in which both commands *stopped and asked* a human at each contradiction, with a `force` mode to override. It went through two adversarial dispatches. It died on its own findings rather than on taste: an unanswered checkpoint had to leave the row in a state `resolve.md` R4 forbids (`Applied` or `Flagged`, no third), or leave it queued in a way the sitting loop would re-offer forever; `force`'s two proposed extra powers turned out to be one that `spec/doc-shape.md` §3 bars by name — *"never as a side effect of applying an answer"* — and one that R2.4's seed exemption already granted; and `add.md`'s own measured record says the last halt in `add` survived a campaign only because a scripted operator had pre-written the answers, while *"a live session had no channel at all"*. The owner ended it, and the reasoning is kept here because the same idea is the obvious next thing anyone will propose.

### R3.6 Writing the delta

The mode gate is at R3.6 rather than in R3.2's verdict, decided v22 after five independent reads of the first draft found the same hole from three directions. In that draft `soft` was enforced by the checker returning `Kept`. But R3.1's and R3.2's briefs are closed enumerations, neither carries the mode, and both sub-agents receive data and never read the invocation — so `Kept` was a verdict with no executor. Worse, on a run with **no second dispatch** — which `SKILL.md` rule 6 calls "the common case rather than the exotic one" — no check runs at all, `Unverified` fires, and the writer's in-place rewrite is **written**: `soft` was silently a no-op in exactly the state it was most needed. `add soft` never had that hole because `add` builds its own `CON-k` inventory at A2 before any checker exists; `resolve` has no equivalent seam.

Putting the gate in the run fixes all three at once and needs no new brief, no fifth writer output and no widened list: the run knows the mode, already holds R3.1 output 1's block-before and block's-full-new-text, and can therefore answer *does this replace or remove existing text?* mechanically, with no second agent. It also sharpens what `soft` means — nothing is **overwritten**, which is not the same as nothing is applied; a purely additive delta still lands in `soft`.

### R3.3 Six outcomes

`Kept` was added v22 with the `soft` mode. It is the seventh route to `Flagged` and the second one that ever saw a writer's delta, which is why R3.4 had to name it: it matches that phase's retry trigger word for word, and an unnamed new outcome falling through R3.4's predicate is the v18 defect below, arrived at from the opposite direction — there by a negation that grew, here by a positive match.

### Progress

Added v18: two independent runs of one fixture stopped a different number of times because no file said which stops were sanctioned — the least reproducible behaviour a measured campaign found.

### R1 — Load the queue

A measured run sat exactly on this endpoint — stamped v16, with v16 on the register — and could not tell from the text whether to halt.

### R1 — Load the queue

(v19 also: the check used to re-hash the origin path and named no clearing route — an ordinary edit to a captured notes file halted every later resolve for good, while the stored copy — the only thing a verdict rests on — was never checked.)

### R1 — Load the queue

Measured: a human said "ratify all six", the next command they had been told to run was this one, and nothing happened — the ledger stayed unratified and every patched marker stayed `awaiting ratification`.

### R2.3 An edit this seam did not make

Written this way because v19 put the hash only at the close: a run that rewrote a body and then died — a crash, a usage limit, a human stopping it — left the previous run's hash standing as the newest, and R2.3 read the dead run's own applied answer as a foreign edit and ended **every queued row touching that feature** `Flagged`. A measured campaign produced exactly that state, and it contradicts this file's own promise that "resume is free" and "an interruption costs at most one item's dispatch". A hash recorded per item costs one field and makes the promise true.

### R2.3 An edit this seam did not make

Before v19 the only sentence that wrote a `HASHES` line was the re-baseline above, `HASHES` appeared in no other command's file, and a run after `init` had to choose between flagging every row and skipping the check.

### R2.5 The content rule, on the write path

That predicate is the fix, and the field list below is a consequence of it (v18). It used to read "a human has touched", and a measured run reported what that bought: "On the literal reading this run sweeps **nothing**, on a document whose human fields carry 35 barred specifics." Every field this skill writes is run-written, so a human-only predicate exempts the entire write path from the rule it is enforcing.

### R2.5 The content rule, on the write path

The three property fields are v18 additions: a customer name in a question title was swept by nothing anywhere, and `What it does` is defined as "a property, not a body line", so "sweep every feature body" missed it by construction.

### R3.1 The writer

These are the caps R3.3 enforces; they are in the brief because a measured sitting retried half its items and three of its six catches were exactly these.

### R3.1 The writer

Measured: obeying the cap literally, one drain left **~15 of 19 edited requirements carrying two or more outcomes** — four with two distinct triggers under one number — and `FR-n` numbers are permanent, so every one of those is a defect the document keeps. A requirement that cannot be tested is worth less than an extra number.

### R3.1 The writer

(v12. Left to the writer, plausible variants accumulate — "owner directive", "doc plus standard practice, adopted", "design-verified and standard practice" all appeared in one drain — and once the labels vary a reader can no longer tell at a glance which sentences a client actually decided, which is the whole point of labelling them.)

### R3.1 The writer

(Split from a single `no doc change because …` verdict in v12. That one line covered both cases and R2.1 accepted either as terminal, so "belongs elsewhere" flipped rows to `Applied` with their substance written into no feature at all. Found by auditing a 580-row drain, which left **52 rows** marked `Applied` with nothing written anywhere — most of them because that run had also handed each multi-feature row a single pre-chosen feature instead of following R2.1, so a disagreement about **where** ended the row rather than redirecting it. Both halves are fixed here: the verdict now says which of the two it means, and only the first can flip a row. The defect is invisible per-item — nothing about a single `no doc change` line looks wrong — which is why R5 closes with a check.)

### R3.3 Five outcomes

(v16: this paragraph and the completion checklist both used to say "on the row", which no target can honour.)

### R3.3 Five outcomes

(v12. Measured **five times** in one drain: the check anchored its fix on the writer's own provenance line, so the stored result was a label-only edit carrying none of the answer's substance — and it reads as a clean `Patched`. It surfaces only when the delta is replayed against the real body and matches nothing, and re-dispatching reproduces it identically, so the recovery is to take the writer's original delta and apply the patch inside it.)

### R3.4 One retry, then stop

(v18. The trigger read "if the check does not return `Clean` or `Patched`" — written when R3.3 had three outcomes. It now has five, and `Unverified` and `Superseded` both fell through a trigger phrased as a negation: `Unverified` has no dispatch to retry **into**, and `Superseded` is already written. Read literally the retry fired on every item of every dispatch-less run — which [`SKILL.md`](SKILL.md) rule 6 calls "the common case rather than the exotic one" — and landed each one `Flagged`, inverting the whole zero-dispatch decision. A negation stops being safe the moment the set it negates grows.)

### R4 — What a person still owns

(v16, at the owner's direction: "resolve should resolve or flag the question, no need to stop and ask human")

### R5 — Write back, log, report

(v14. The earlier rule ended the run with the sitting and named the remainder "next sitting's", with no sentence anywhere permitting the same invocation to continue: a measured 174-row queue applied ten and reported a complete run, and a 34-row queue cut itself into 10/10/10/4 and closed with the fourth never dispatched and no reason recorded anywhere. What makes back-to-back sittings honest is what the ten's evidence is actually about — self-conditioning across many steps in **one** context. Every item's writer and checker are fresh dispatches with no memory of earlier items (rule 8(i)), the orchestrator's per-item work is mechanical (brief → dispatch → fetch-diff → commit → log), and each sitting re-derives its own counts and gate from the rows as they now stand. This is the construction [`questions.md`](questions.md) Q5 already runs back-to-back, inverted: that round asks a person whether to continue because a person is answering it; here nobody is, so continuing is the default and stopping is what must be justified.)

### R5 — Write back, log, report

(v16: the first of the two was a carried marker for every `Not doing` line written without a `revisit if:`. That obligation is removed with the question class it fed — [`questions.md`](questions.md) Q2 sweep item 4 — because a marker whose only disposition was a question nobody wanted is manufactured work at both ends. Such lines are named in the report instead.)

### R5 — Write back, log, report

(v16: two measured runs put `check` lines in the log, one of them then asserting in its own record that it had not — the table and the paragraph disagreed and the table won, because a run copies the table)

### R5 — Write back, log, report

Written because the entry was the one artifact in this skill with no cap — the report is held to one screen — and runs filled the vacuum with narrative: a measured 580-row drain wrote ~315k characters, ~400 per item against the ~100 these samples imply, and its owner deleted the page rather than read it.

### R5 — Write back, log, report

A measured campaign ran the first real independent checks in four campaigns: 99 divergences, and **0 reached any document, log or row**, because no kind admitted them.

### R5 — Write back, log, report

(v19: the two flagged rows used to read `not applied` and `contradicts «Checkout» FR-5` — a third state R4 abolished, and the contradiction R3.2 now supersedes; both were pre-v16 residue a run would have copied.)

### R5 — Write back, log, report

(v17: this sample used to print `APPLIED` / `NOT APPLIED` / `FLAGGED` group headings inside the entry — layout the kind table marks `(→ runs/)`. A run copies the sample, and two measured runs put ten such lines in the committed log because of it. The headings live in `record/runs/<run-id>.md`, where the report is assembled.)

## status.md

### S2 — Ten checks

A measured run stranded seven verbatim client decisions in exactly this state and nothing saw them.

## spec/doc-shape.md

### How a run may write it — the one rule

Measured: a run whose I3 screen listed block names shipped a contract term — "thirty-day terms" — into the front door, where §6 bars it and where this rule then forbade fixing it in place; the same phrase in a feature body was correctly narrowed, so the document contradicted itself with no route to repair.

### Not doing

Measured: an exclusion with a stated why — "the partners voted against it in June" — was routed to the NOT-clause, and the argument left the document entirely with nothing reporting that it had.

### 6. What may appear in the Blueprint

(v20: this example used to keep "four-hour", which is a contract term the sentence above bars — the rule's own worked answer broke the rule, and a reader copying it would leak the one figure it was demonstrating how to remove.)

### Six ways a marker is removed, and this is the canonical list

Measured, and it is the reason this paragraph exists: a run wrote a ten-line first-person answer — reasoning, a supporting fact and a closing "so I am comfortable saying it" — signed with the human's name, at `Status = Answered`, on a question that human had never been asked, in a session where they had said "do not take a guess from me". A second row recorded them accepting a proposal that did not exist when they last spoke. Both were plausible, both were in character, and neither was said. This is the laundering the whole document exists to prevent, arriving through the one route that is allowed to write a human's words.

### Six ways a marker is removed, and this is the canonical list

This branch said `Open` until v17, and the consequence was structural rather than cautious: **every** client answer arrives relayed, so no answer obtained through the skill's own packet loop could ever reach `Answered`. A measured run offered the sitting, was answered, and stranded seven verbatim client decisions at `Open`, where no `status` check could see them either.

## spec/notion-mechanics.md

### 3. Page blocks, mention blocks, and the traps

(Measured repeatedly in one 580-row drain; every instance was caught by the simulate-and-compare step and none by the API.)

## spec/run-progress.md

### 1. The block

(v16: a measured run printed `done Q5 sitting, on request · 0 rows offered`, which reads as ran-and-found-nothing)

---

# v21 — the 2026-08-22 four-project simulation campaign

Lab: `~/dev/ai/blueprint-sim4/` on the owner's machine. Four projects run end to end plus eight
single-turn fixture probes; 132 raw findings from eight independent auditors, deduplicated to 75
distinct claims, every one sent to an adversarial verifier told to refute it. **11 confirmed, 36
narrowed, 28 refuted.** Planted-defect recall, measured only on items undamaged by the campaign
itself: **38/47**. Full report: `blueprint-sim4/REPORT.md`.

**What the campaign confirmed already worked**, so it is not re-litigated: ratification end to end
(both the `questions` landing and the `resolve` redirect), the `item`-line body hash surviving a real
interruption with no Flag storm, the content rule under a PII fixture, injection refusal, code-repo
decline, and — the previous campaign's gravest finding — **no fabricated answers**: the project built
to force one produced 26 rows, all `Open`, all unanswered, all with an empty `Owner`.

### init.md I3 — the skeleton is written to disk before it is printed

Measured: the I3 screen was persisted nowhere, so every resuming sitting re-derived the overview from
scratch. `doc-shape.md` §3 sanctions I5's first overview write *"only because these words were seen
here"* — and the words were gone. Raised independently by seven findings across all four projects and
both auditor kinds. One run said so itself: *"the skeleton's Area names could not be recovered and were
chosen again by this sitting."* Another substituted a negative safety guarantee with a positive
recording rule while re-deriving. v20 had fixed the mirror image — it persists the human's *reply* —
which left a durable hashed confirmation pointing at a vanished referent. The run could not fix this
for itself: `resolve.md` R5's line-kind list is closed and *"widened by a skill edit and a `VERSION`
bump, never by a run."*

### SKILL.md rule 6 — the probe ladder, and the route recorded on success

v20 required the unavailability string to be *earned by an attempt* and named no mechanism to attempt.
`Bash`, `shell`, `command line` and `terminal` appear nowhere in the tree. The campaign deliberately
told two projects that a shell dispatch existed and told two nothing; **the untold arm split 1–1** —
same skill, same harness, same information, opposite conclusions about whether independence was
possible at all. On the project that concluded no, a whole Blueprint shipped unverified: 26 written
claims, 0 checked. The prompt injection in that project's sources had asked for exactly that outcome
and got it — not through obedience, but through the failed probe. Separately, one run's sitting 2 wrote
the unavailability string into the same entry its own sitting 1 had proved wrong, because the guard was
scoped to *"the same sitting"* and a successful probe never had to record its route.

### resolve.md R5 — the HASHES roll-up repeats rather than recomputes

An `add` run closed an entry whose closing roll-up matched no body under any reading of the hash rule,
while its own `item` lines were correct. Recomputed four ways by the auditor and again by the verifier.
Since R2.3 baselines foreign-edit detection on the newest recorded hash, a roll-up nobody can reproduce
is load-bearing. Making the roll-up a repetition makes the failure self-detecting at write time.

### The rest, each from one measured incident

- **`doc-shape.md` §6, the product's own name** — a run wrote a practice's name as the product's on
  every occurrence in the overview and in twelve question rows; both the dispatched faithfulness check
  and the `init` sweep returned clean over it, and the *next* run's checker caught it.
- **`resolve.md` R4, the print** — a run named a barred individual correctly in its log line and then
  quoted the name in its report, which reaches more readers than the log does.
- **`add.md` A4, the `item` line per body write** — seven body writes produced four lines, one body was
  written with no line at all, and two were written twice under one line each.
- **`add.md` A4, supersession reach** — the guard set read as a blanket licence, and markers quoting
  superseded text were left standing.
- **`questions.md` Q3, the Duplicate filter** — candidates were discarded as duplicates without quoting
  the row they pointed at, which by the filter's own terms invalidates the discard.
- **`questions.md` Q2, the repeat round** — its trigger was defined on *"candidates surviving Q3"*
  while the round runs inside Q2, before Q3 exists; runs adopted three different readings.
- **`questions.md` Q1, the ratification spot-check** — the sample that keeps a batch ratification from
  being a rubber stamp left no trace, so a later run executing the ratification could not tell whether
  the check had happened.
- **`databases.md` §2, `Suggested directions`** — a run withheld the field on all twenty-six of its
  rows and cited this cell as its authority; a human's instruction not to guess closes the DEFAULT
  channel, never this field.
- **`status.md` C10** — its scope named `DISCARD` where the kind is lower-case `discard`, so a check
  grepping for it finds none and reports the funnel consistent: the exact vacuous pass C10 was extended
  in v17 to prevent. Widened at the same time to the three classes a measured C10 demonstrably never
  read.
- **`SKILL.md` prose** — two sentences damaged by the v20-era HISTORY extraction commit (`ed5302a`), a
  bare leading period and a dropped em-dash. `lint.sh` cannot see prose grammar.

### What was deliberately NOT changed

Twenty-eight claims were refuted outright. Three deserve recording because they were escalated before
verification killed them, two of them raised by the campaign's own orchestrator:

- *"The `directive` kind fires on the owner's own words, so a legitimate instruction was refused and the
  document contradicts itself."* **Refused correctly**: `doc-shape.md` §6 bars a run from editing a
  human's field on a spoken authorisation — the rule exists because a measured project once edited ten
  such fields on exactly that basis. The route said to be missing exists in three files and had already
  drafted the replacement text into a row. The "stale places" were an artifact of the campaign's own
  turn plan: the human never had a turn in which that row existed to answer.
- *"`init.md`'s I3 sample writes the client organisation's name into the overview"* — not a defect.
- *"v20's `HASHES` fix is only half a fix"* — not a defect.

The `directive` kind's scope wording does read one term short of the rule it cites (`resolve.md`:769
says *"inside a source"*; rule 2 says *"sources, answers, titles, file contents"*), but three other
places in the skill pair answers with sources, and no run was misled in four projects. Left alone.
