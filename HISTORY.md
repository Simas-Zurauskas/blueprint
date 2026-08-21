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
