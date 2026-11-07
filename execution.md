# Execution reads and cost

## Cost — sized to the change, and said before it is spent

**This section is the single home of what a run may spend** (v36). A run's work grows with what
changed and with the material it read, never with the size of the document it changed. Before the
first dispatch of any phase that dispatches more than one agent, the run prints one plain line — what
is being checked, how many helper agents, and why — with no phase code
([`spec/run-progress.md`](spec/run-progress.md) §4), and it does not go past that line without printing
a new one.

| Run | Grilling ([`questions.md`](questions.md) Q2) | Verification ([`questions.md`](questions.md) Q4, [`init.md`](init.md) I6) |
|---|---|---|
| an `add` handoff, `init`'s closing handoff (I7), and a bare `/blueprint questions` | the delta scale — **at most four dispatches**, one per four bodies attacked; an empty delta dispatches nothing | one disposition-and-directions dispatch per 15 candidates · one cold reader per 10 drafted rows · one faithfulness dispatch per ~40 written items, split by `Area` beyond that — all concurrent under rule 8 |
| `init`'s skeleton grill (I2) | sized to the material — **one pass up to ~1,000 source words; two concurrent passes up to ~4,000** (lenses 1–3 over every body · lenses 4–5 plus the checklists); above that, one per `Area` plus two. Each lens is still framed and worked separately inside its pass | the same |
| `/blueprint questions full` | the full scale — **one dispatch per `Area`, plus two** | the same |
| `/blueprint answer` | none — it grills nothing | author drafts directly · one fresh challenger per up to 10 related drafted answers — concurrent under rule 8 ([`answer.md`](answer.md) W3–W4) |

**Material is counted, not estimated:** the words in this run's source record (init), in its new
sources (add), or in the bodies attacked (questions).

**Over the cap, a run shrinks the work, never the checks, and never silently.** The attack surface is
ranked — bodies this run wrote first, then bodies other runs wrote since the last grill, newest first —
and whatever does not fit is named on the `GRILL` line as `queued`, so the next run starts with it.
`/blueprint questions full` is the only way past the delta cap, and a human asks for it by name — bar the one
charter-delta dispatch a person's widening of the charter authorises ([`spec/charter.md`](spec/charter.md) §7); a run
never infers it.

**Briefs are frozen files, not pasted documents** (rule 8(i)). What every pass needs from the whole
document is written out once — the bodies a pass attacks in full, everything else as
[`questions.md`](questions.md) Q2's requirement index — and each dispatch reads it by path.

**What each command reads, and no more** — after [rules.md](rules.md) — plus [`spec/charter.md`](spec/charter.md) wherever a charter exists (pre-flight check 1) — the orchestrator's context is replayed on every turn,
so an unread section costs nothing and a read one costs every turn after it:

| Command | Reads |
|---|---|
| `init` | [`init.md`](init.md); [`spec/doc-shape.md`](spec/doc-shape.md); [`spec/targets.md`](spec/targets.md) §3 and §5; [`spec/run-progress.md`](spec/run-progress.md); [`questions.md`](questions.md) from the top through Q4 — its preamble and the scope statement Q3's filters cite included — then Q6 and Edge cases (Q5 only when a sitting is asked for); [`spec/prd-scope.md`](spec/prd-scope.md); [`resolve.md`](resolve.md) R1 and R5 only; [`spec/databases.md`](spec/databases.md) and [`spec/notion-mechanics.md`](spec/notion-mechanics.md) only on the Notion target |
| `add` | the same, with [`add.md`](add.md) for [`init.md`](init.md) |
| `questions` | [`questions.md`](questions.md) whole, the specs above, [`resolve.md`](resolve.md) R5 |
| `answer` | [`answer.md`](answer.md); [`resolve.md`](resolve.md) R1 and R5; [`spec/prd-scope.md`](spec/prd-scope.md); [`spec/databases.md`](spec/databases.md) §2–§5; [`spec/doc-shape.md`](spec/doc-shape.md) §5–§6; [`spec/run-progress.md`](spec/run-progress.md); [`spec/targets.md`](spec/targets.md) §5; [`spec/notion-mechanics.md`](spec/notion-mechanics.md) only on the Notion target |
| `resolve` | [`resolve.md`](resolve.md) whole, the specs |
| `charter` | [`charter.md`](charter.md), [`spec/charter.md`](spec/charter.md), [`spec/targets.md`](spec/targets.md) §5 |
| `status` | [`status.md`](status.md), [`spec/targets.md`](spec/targets.md) §5, [`spec/doc-shape.md`](spec/doc-shape.md) §3 and §9, [`spec/run-progress.md`](spec/run-progress.md) for the reply; [`spec/notion-mechanics.md`](spec/notion-mechanics.md) §3 on the Notion target |

A section a phase cites is read when the phase reaches it.

**The orchestrator reads a page once per write.** The read-back of one block is the pre-write fetch of
the next block on the same page when nothing else wrote in between ([`add.md`](add.md) A4 step 1), and
a body's hash comes from the read-back already in hand.

**A pause is ended only by a human.** A run schedules nothing to wake itself — no timer, no loop, no
reminder to continue — and a paused entry resumes when a person says so. (*Never runs on a schedule*,
below, is the same rule seen from the other side.)

