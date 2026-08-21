# Spec — the progress block

**This file is the single home of the progress block**, the standard task list every multi-step run
prints. Companions: [`doc-shape.md`](doc-shape.md) · [`databases.md`](databases.md) ·
[`targets.md`](targets.md) · [`notion-mechanics.md`](notion-mechanics.md).

A run is a long thing that happens to somebody who is not watching every step. Without a task list
the only two states they can see are *"working"* and *"finished"*, and a run that quietly did six of
its nine phases looks exactly like one that did nine.

## 1. The block

Printed at run start, at every phase boundary, and at every sitting boundary. **Every count in it is
re-derived from the current state at the moment of printing** ([`../SKILL.md`](../SKILL.md) rule 7)
never carried forward from the last time the block was printed, which is the whole failure this
skill's rule 7 exists to prevent and it applies here like anywhere else.

```
BLUEPRINT resolve · run 7f3a2c · sitting 2 · mode: default
  done   R1 load the queue          18 eligible
  done   R2 pre-write checks        4 bases hashed · 0 blockers
  now    R3 write, item 7 of 10     4 applied · 1 flagged · 2 superseded
  next   R5 gate, log, report
  ————   18 queued · 11 disposed · 7 to go
```

**Five parts, no sixth.**

| Part | What it carries |
|---|---|
| **header** | command · run id · sitting number · the mode, where the command has one ([`../add.md`](../add.md)) |
| **`done`** | one line per finished phase, with the one number that phase produced |
| **`now`** | exactly one line. Where the phase is per-item, it carries `item n of m` |
| **`next`** | the phases not started. Named, never counted — *"3 phases remain"* tells nobody what is coming |
| **the rule-off line** | the run's own arithmetic: total · disposed · remaining. The three must add up, and a reader checking them is the point |

**`done · now · next · blocked · skipped`** are the only five states. **`blocked`** replaces `now`
when a phase cannot proceed and names what is in the way on the same line. **`skipped`** is for a
phase that legitimately did not run — [`../questions.md`](../questions.md) Q5 without a request is the
standing case — and it exists because writing `done` against a phase that never ran is a lie a reader
cannot detect. There is deliberately no state meaning *started but not finished* — a phase
is running or it is not, and that fifth state is where a run hides that it stopped.

## 1a. An embedded run — whose task list governs

`init` I7 and `add` A5 hand off to [`../questions.md`](../questions.md) Q1–Q6, which declares its own
six-phase list, **inside one phase of the outer run**. Nothing said which list the block should show,
and **all five runs of a measured campaign got ask 4 wrong at exactly this seam** — four different
readings of one sentence: 4 blocks, 1 block, 0 blocks, and one run reprinting `5 phases · 4 done ·
1 to go` six consecutive times while six phases went past.

**The rule, decided:** the **embedded run prints its own block at its own phase boundaries**, and the
outer phase stays `now` throughout. The embedded block carries the outer run's header line plus its own
task list, so a reader can see both — `resolve · run 7f3a2c` on the header, `Q1…Q6` on the list. When
the embedded run finishes, the outer block prints once more with that phase `done`.

**Why this way round:** the embedded `questions` run is the largest phase in `init` and `add` — in one
measured run it disposed 37 candidates, wrote 10 rows, adopted 4 defaults and patched 11 markers, all
of it invisible between `now A5` and `5 done · 0 to go`. A phase that big is not a line; it is a run.

**A finished block** — printed when a run closes — carries `done` lines and the rule-off line only.
`now` and `next` are omitted, because there is neither.

## 2. What it is for, and what the evidence actually supports

A **maintained** plan beats a one-shot plan by about ten points: on WebArena-Lite with a matched
executor, no planner scored 36.97%, a static plan 43.63%, and a plan rewritten after every executor
step 53.94% (*Plan-and-Act*, Erdogan et al., ICML 2025). Removing the global plan costs 8.14% average
success on LegalAgentBench, and 14.06% on its coding split (arXiv:2504.16563). Holding the task list
outside the growing context costs 2.0–8.1% of a run's tokens (arXiv:2608.01964).

**What that evidence is not.** It measures a **maintained plan**, not a display. **No published
ablation of a task-list feature exists** — not one measuring completion rate, not one measuring
dropped steps. So: re-derive the block every time, because that is the part with evidence behind it,
and claim nothing for the printing itself beyond that a person can see where the run is.

The reason this matters here is the failure it is aimed at. On a long-horizon benchmark, **19% of
unresolved runs ended because the agent stopped on its own** while the task was unfinished, and the
authors' summary is that *agents systematically overestimate completion* (arXiv:2607.08964). A run
that prints `next` with two phases still in it cannot report itself finished without the
contradiction being on the screen.

## 3. The rules

1. **Re-derive, never carry forward.** Rule 7, applied here.
2. **Never print `done` against a phase whose verification has not run.** The block is a claim about
   what happened, and a phase that wrote content but has not read it back is `now`, not `done`.
3. **The remaining count is what a run may not lie about.** A run whose rule-off line reads
   `7 to go` and then closes has not finished, and [`../resolve.md`](../resolve.md) R5's closed list
   of stop reasons is where it says which reason let it stop.
4. **One block per print, replacing the last** — it is a status line, not a log. The durable record
   is the run log ([`../resolve.md`](../resolve.md) R5).
5. **It is printed, never written into the Blueprint.** No feature body, no overview block, no
   question row ever carries it.
