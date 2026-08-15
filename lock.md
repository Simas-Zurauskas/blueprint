# Run — lock

**`/blueprint lock`** marks the Blueprint as settled: the product definition everyone — or just you — is
building from. It is the moment the document stops being a draft.

Locking does not stop the document changing. It changes **how** it changes: after the lock, every change
still goes through the same gates as before — sources, the admission gate, vetted answers, the independent check —
and **every change that lands is recorded in the change log**, so *what moved since we settled this* is
always one page, readable in a minute, with the reason in the words of whoever asked for it.

That is the whole model. No frozen copies, no revision ceremony, no unlock. The document stays live and
current; the change log is the memory.

Specs obeyed, not restated: [`spec/doc-shape.md`](spec/doc-shape.md) ·
[`spec/databases.md`](spec/databases.md) · [`spec/targets.md`](spec/targets.md).

**Run the seven pre-flight checks in [`SKILL.md`](SKILL.md) first** — check 4 reads L3 below, which is the
one definition of what "locked" means.

---

## L1 — The readiness report, and the final grilling

**Always printed, by `lock` and by [`status.md`](status.md) S3, from this one definition.** **Open the
run-log entry before L3 writes anything**, and close it at the end ([`SKILL.md`](SKILL.md) pre-flight
check 5). Six questions, each answered with names and counts, never a score:

| # | What it asks | Why it matters |
|---|---|---|
| 1 | **Which features carry an open `[NEEDS CLARIFICATION]` marker?** | Each is an admitted gap in the text about to be locked — carried and broken counted apart. A marker blocks nothing (v13); it is acknowledged at L2, never passed silently |
| 2 | **Which questions are `Open`, `Answered` or `Flagged`?** | `Open` = nobody has decided. `Answered` = decided but not yet written in — run `/blueprint resolve` first. `Flagged` = a run could not write it honestly and a person has not looked |
| 3 | **Which features' `Behaviour` blocks hold no numbered requirement?** | A feature with no failable requirement is a title, not a spec |
| 4 | **Which `Not doing` lines have no `revisit if:`?** | A refusal with no reopening condition becomes dogma |
| 5 | **How many `Open` questions are unanswered, and how old is the oldest?** | Run-written questions nobody has answered or rejected. Nothing records whether a row has been read or carried into a packet, so this counts the live backlog and infers no read-state (v13 — [`spec/databases.md`](spec/databases.md) §3). Locking over a backlog is allowed, acknowledged at L2 like everything else, never silent |
| 6 | **Which convention defaults are adopted but unratified?** | Labeled machine text nobody has ratified ([`SKILL.md`](SKILL.md) rule 4) — each batch named by run id and line count. Their patched markers are counted like any marker, and locking over them is acknowledged at L2 item by item, never silent |

**Then the final grilling.** Before anything is locked, run the adversarial battery of
[`questions.md`](questions.md) Q2 — the lenses live there and are not restated here — over the whole
document, one last time. A document about to become the thing people build from deserves one full attempt
to break it. What the grilling finds becomes live questions through the ordinary gate, or is acknowledged at
L2 with everything else; **an empty grilling result is not evidence the document is complete**, and the
report says so. **Every discard and every "already decided" or "duplicate" citation this pass produces
answers to [`questions.md`](questions.md) Q3's quote-must-answer rule exactly as any other sitting does —
there is no final-grilling exception, and a citation that cannot quote the sentence it claims answers the
gap is not a discard, it is a candidate that gets proposed.**

**Match markers on `NEEDS CLARIFICATION` without the leading bracket**
([`spec/notion-mechanics.md`](spec/notion-mechanics.md) §3) — a literal `[NEEDS` match reports a clean
bill of health on a document full of markers, and this is the report that decides whether a definition
is settled.

**Readiness is never a percentage and never a verdict.** *"78% ready"* is a number nobody can act on, and
it invites locking on the strength of a figure rather than on the strength of named lists. Every line
names rows.

**Nothing here blocks a lock.** A document can have every one of these open and still be right to lock —
a definition settled with nine open questions is a normal, honest artifact, and much better than one
where the questions were quietly closed to make a report look clean. What L2 requires is that you see
each one and say so.

---

## L2 — Acknowledge, item by item

**Locking over an unsettled item is allowed. Locking over one silently is not.**

Print the readiness report and the grilling result, then ask **one act at a time** for each category that
is non-empty — not as a list, because every item put to a person as more than one act produces one act.

**Every individual qualifying row gets its own numbered item — never grouped behind a count, and never
pre-judged in prose beside another item's choice.** Two `Answered`-but-not-applied questions are two
numbered items, each with its own `[r]esolve first · [i]nclude anyway · [h]old`, even where one is older
or more familiar than the other. A run once gave one such question its full numbered choice and folded a
second, newer one into an unnumbered aside describing it as "downstream mechanics" — its stale value then
shipped with no marker warning a reader it had been superseded, and no choice was ever actually put to the
human for it. **A row this category names is either given its own numbered choice, or the category is not
yet fully enumerated** — a count with examples is not the same act as asking about every row the count
contains.

```
LOCK «Golden Crumb» — nothing is written yet.

  1/4  2 features carry an open [NEEDS CLARIFICATION] marker: «Refunds» · «Loyalty tiers»
       Locking includes them. The gaps stay named in the document, and whoever builds
       from it knows exactly what was never settled.
       [i]nclude · [h]old the lock so somebody can answer them

  2/4  4 open questions, 2 of them owned by Ana
       Locking does not close them. They stay open in the document — which is honest,
       and is what a builder needs to know not to guess at.
       [i]nclude · [h]old

  3/4  1 question is Answered but not applied: «Can a customer retry a failed payment?»
       This one is worth holding for: the decision exists and the spec does not say it.
       Run /blueprint resolve first and it is in the document you lock.
       [r]esolve first (recommended) · [i]nclude anyway · [h]old

  4/4  The final grilling found 2 new gaps (written as live questions, unanswered).
       Locking now means they are next sitting's questions, inside a locked document.
       [l]ock anyway · [h]old and review them first
```

**Each item carries its counter-case in one line**, because a recommendation a reader accepts without
reading is the failure mode here: people given a confident wrong suggestion collapse from 82.3% to 45.5%
correct at any experience level, and *information rather than recommendation* is the named mitigator.

**A hold is a normal ending.** Nothing is written, the readiness report stands, and the run says what to
do next.

**Every acknowledgement is recorded in the log by name** — *"2 features with open markers included,
acknowledged by Ana, 2026-08-14"*. When you are the only human on the project, that name is yours, and it
still matters: it is the record that a person read it, not that a ceremony happened.

---

## L3 — Lock it

**Regenerate every `⟳` view from the rows as they now stand** ([`spec/doc-shape.md`](spec/doc-shape.md)
§3's single home) before writing anything else — the lock is the moment the front door most needs to be
right, since it is what a reader now trusts as settled.

Append the `LOCKED` entry to the run log, every count in it freshly recomputed at this moment
([`SKILL.md`](SKILL.md) rule 7, never carried forward from L1's earlier read). That entry is what makes
the lock real:

```
2026-08-14 16:20 · lock · run 4d1e9a · skill v2
LOCKED — 10 features · 9 questions (4 Open, 5 Applied)
GRILLED    full battery run · 2 new questions written to Open, unanswered
ACKNOWLEDGED  2 features with open markers · 4 open questions · 2 grilling finds — by Ana
CLOSED 16:22
```

Then **create the change log** if it does not exist — a `Change log` child page on Notion, `changelog.md`
on a local folder ([`spec/targets.md`](spec/targets.md) §3) — with its header explaining itself in two
lines: *what changed in this document since it was locked, newest first, each entry carrying the reason
in the words of whoever asked. Never rewritten.*

### What "locked" means — the single definition

**A Blueprint is locked when its run log contains a `LOCKED` entry.** That is the whole test. Every
command's pre-flight reads it here and nothing redefines it elsewhere. There is no unlock and no
re-lock — the change log carries everything that happens afterwards, which is what makes a second lock
meaningless.

**It is derived from the target, never from the working folder**, which is a rebuildable cache
([`spec/targets.md`](spec/targets.md) §5) — a marker kept there vanishes on another machine or after the
cache is rebuilt, and the next change goes unrecorded. The run log travels with the Blueprint, so the
answer travels with it.

**Locked halts nothing.** [`add.md`](add.md), [`resolve.md`](resolve.md) and
[`questions.md`](questions.md) all run normally against a locked Blueprint. What changes is the
obligation below.

---

**The lock's closing act — the handoff set** (v12). Assemble the build packet
([`spec/doc-shape.md`](spec/doc-shape.md)) for **every feature**, at this moment, and put the set where
the delivery team actually works — a `handoff/` folder beside the working folder, or the target's own
space, named in the run-log entry. This is the artifact the whole Blueprint exists to produce, and until
v12 no phase owned producing it: the packet was specified as derive-on-demand and nobody's job, so the
one moment the document was declared done handed the team nothing. Derive-on-demand still holds
afterwards — a packet is regenerated, never edited — but the lock hands over a complete, dated set.
*(The measured absence: a finished 63-feature document whose bodies run 30–51% annotation lines by
count, with no stripped view anywhere for the people the document is for.)*

## L4 — After the lock: the change log

**Every run that writes into a locked Blueprint appends one change-log entry per sitting, as part of its
write-back.** This is an obligation on [`add.md`](add.md) A4–A5, [`resolve.md`](resolve.md) R5 **and any
[`questions.md`](questions.md) Q4 sitting that lands defaults or doc-fixes** — written questions and marker links
alone still owe none — not a separate command, and a write run that ends without its entry has not
finished ([`status.md`](status.md) C7 names the gap).

One entry, four things:

```
## 2026-08-20 · via add · asked by Kate

> "The hall has told us we can have the room until 2pm from September, not 1pm.
>  So that's two more slots per fixer. Worth doing."

- «Book a repair slot» — FR-6 added: sessions run 10:00–14:00, eight slots per fixer
- «Run the session» — FR-4 added: mark a repair as needing a part; person returns next session
```

- **The date, and which run wrote it.**
- **Who asked, and the ask in their own words, verbatim** — not a summary, because six weeks later *"why
  does the document say something different"* is answered by that text and by nothing else. When the
  change is your own idea and nobody asked, the reason in your words fills the same slot.
- **What changed, by feature and requirement number.** Names, not diffs — the document itself carries the
  new text and the dated provenance lines.
- Nothing else. An entry is three to ten lines, and the log stays readable top to bottom.

**The change log is for people; the run log is for runs.** The run log records every mechanical act as
structured one-line facts — hashes, verdicts, counts, and nothing that needs reading twice
([`resolve.md`](resolve.md) R5's closed list is its shape). The change log answers one question — *what
moved since we settled this, and why* — and a reader gets the answer without opening anything else.

**Before the lock, no change-log entries are written.** A draft changes constantly and logging that is
noise; the run log already carries the mechanical record. The change log starts at the lock because that
is the moment changes start needing an explanation.

**It is never rewritten.** Appended newest-first, like the run log. An entry that turns out wrong is
corrected by a newer entry saying so.

---

## Edge cases

| Situation | What the run does |
|---|---|
| `lock` on a Blueprint where nothing is settled | Allowed, after L2. A locked document that is mostly open questions is honest and says so on its face |
| `lock` with an `Answered` question not yet applied | L2 recommends resolving first, with the counter-case. A decision that exists while the spec is silent is the one gap worth holding for |
| `lock` on an already locked Blueprint | Nothing to do. Say so, point at the change log, stop |
| A write run on a locked Blueprint ends without a change-log entry | It has not finished — the entry is part of the write-back. [`status.md`](status.md) C7 names any write the run log records after the lock that no change-log entry explains |
| The change log was edited or rewritten by hand | Report it, never repair it — page or file history is the record, and a rewritten change log is a fact about the project worth surfacing |
| The run log is unreadable | **Halt.** Locked-ness is derived from it, so the run cannot tell what its obligations are. Never assume unlocked |
| A marker is still open at lock | Included, visibly, and acknowledged at L2. Stripping it would make the document read as complete |
| Somebody wants a frozen copy anyway | Page history on Notion, or the file's own version control, at the moment of the lock — the `LOCKED` run-log entry names the date. This skill does not mint snapshot documents; a second copy is a second thing to keep true |
