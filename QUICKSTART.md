# Quickstart — first hour, first sitting

Pointer-only by design: nothing normative lives here, every line points at the rule's single home.
If this file and a run file ever disagree, the run file wins and this file is wrong.

## Before anything

- Confirm no Blueprint already exists for this project — one per project, ever (→ SKILL.md pre-flight 1).
- Know your target: a Notion teamspace page a human made, or a folder (→ spec/targets.md §2–3).
- The one prohibition that catches first-timers: the skill **never reads a code repo** — what the
  product *should* do comes from people, not from what somebody already built (→ SKILL.md "What this
  skill does NOT do").
- Sub-agent dispatches are mandatory for every independent check; know how your harness spawns one
  before starting, or every check will honestly report itself unperformed (→ SKILL.md rule 6).

## First hour — from client material to a draft

1. Gather the material into files; nothing else is needed (→ init.md I1).
2. Say `/blueprint init`. It will capture sources, propose a skeleton, and **stop for your approval**
   before creating anything (→ init.md I3 — the hard stop is yours).
3. Read the NOT-USED list at that stop as carefully as the skeleton — it is where gated commercial
   material gets parked (→ init.md I3).
4. Let it write features, then read the questions it ends with — they are live, and yours to answer,
   reject, or carry into a client packet (→ spec/databases.md §3, `Open`).

## First sitting — questions and answers

5. Read the live questions in the UI at your own pace: answer directly, or reject **with a reason** — the reason
   decides the marker's fate (→ spec/doc-shape.md §9 route 4).
6. Expect few questions: only client-gating build decisions qualify; convention becomes labeled
   defaults you ratify in one batch, content becomes slots on one manifest (→ questions.md Q4).
7. Say `/blueprint resolve` to write vetted answers in. It commits one verified item at a time and
   reads everything back (→ resolve.md R3–R5).
8. Say `/blueprint status` any time — read-only, tells you what to do next (→ status.md).

## What a sitting costs

- A sitting is ten items; a run keeps opening sittings until a named stop reason fires
  (→ resolve.md R5).
- Every write run logs a cost line — dispatches, tokens, wall-clock (→ resolve.md R5).
- A run-log entry is a closed list of line kinds, not prose; explanations go in the report
  (→ resolve.md R5).

## How you know where it stands

9. Nothing ever declares it finished — say `/blueprint status` and its `What is still unsettled`
   block names every gap by row (→ status.md S3).
