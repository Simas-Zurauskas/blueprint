# blueprint

Turn whatever you have — your own app idea, a pile of notes, a client's documents, a call transcript —
into a **product definition good enough to build from**, before any code is written.

It produces one document per project, called **the Blueprint**:

- an **overview** — what this product is, who it's for, what success would look like, and what it
  deliberately will *not* do;
- one **feature row per feature** — the row *is* the spec: why it exists, numbered requirements that can
  each fail, edge cases, and its own "not doing" lines;
- an **open questions list** — everything nobody has decided yet, said out loud instead of guessed at.

The tool's one rule: **it never guesses.** Every sentence traces to something you actually said, or it
becomes a question with your name on it. Gray areas are where builders silently make the wrong call —
this tool exists to find them and make you decide.

---

## What it's for

- **You have an app idea** and want a solid, extendable spec before you (or a coding agent) build it.
- **A team or client project** needs its scattered notes turned into one agreed definition.
- **You want the document interrogated** — every draft is adversarially grilled to surface the questions
  you didn't know to ask. Answering them is what makes the spec solid.

Not for: tracking development, reading code, or documenting what has already been built. It records
*intent only*, and it never looks at a running app.

---

## How to use it

### 1 · `/blueprint init` — start

Hand it whatever exists: files, notes, a transcript — or nothing, and it interviews you (three questions:
what is this and what is it *not*; who is it for; which features do you already know you want — plus
short follow-ups like who it's *not* for and what would tell you it worked).

It drafts a skeleton, **grills it** with five adversarial lenses (a builder forbidden from guessing, a
hostile tester, the first week of real life, cross-feature collisions, and a reconciliation of every
feature against who the product is actually for), shows you everything it found, and **stops**. Nothing
is created until you confirm.

It also asks where to store the result: **Notion** or **a local folder of markdown files**. Local needs
zero setup — right for speccing an idea tonight.

### 2 · Review the proposed questions — at your own pace

Every gap the grilling finds becomes a **proposal** — not a real question until you say so. **The run
never interrogates you: it writes everything it found, prints the report, and stops.** You review in the
`Proposed — needs review` tab whenever suits: approve, reject (say why), or just write the answer
directly — the next run picks up every move. Each row arrives triaged — a **Key** checkbox marks the
questions whose answers decide the build (contradiction-backed, or unbuildable without an answer), so
you can take just the Key rows to a client when time is short — and carries **suggested directions**:
machine-drafted options with their trade-offs, grounded in your own document, verified by a second
model before writing, and always labeled *not a source — your answer in your own words is what counts*.

Prefer going through them together? Ask for a review sitting and they come one at a time, ten per round:

```
[a]pprove · a[n]swer now · [e]dit · [r]eject · already [d]ecided · [s]kip
```

**Answer now** is the fast path there: answer on the spot in your own words — the run records the row at
`Answered` as your move, done in the room. Rejections keep their reason and never come back as noise.

### 3 · Answer the questions you kept

In Notion or the files, at your own pace: write the answer **and why**, then
set `Status = Answered` — that move is your sign-off, and resolve consumes only rows a human moved
there. Nothing a machine drafted enters the spec until
a person has signed it — that is the whole safety model.

### 4 · `/blueprint resolve` — write the answers in

Each vetted answer is written into the feature it touches by one agent and checked by a second,
independent one. Anything that can't be written honestly (say, an answer that contradicts an existing
requirement) is flagged with the objection and waits for you.

### 5 · Agree the features

Set `Intent = Agreed` on each feature that is right, with your name. No run ever does this. A feature
with an open `[NEEDS CLARIFICATION]` marker can't be agreed — that marker is the only thing in the whole
system that blocks anything.

### 6 · `/blueprint lock` — settle it

One readiness report, one final grilling, and you acknowledge each unsettled item on the record. Then the
Blueprint is locked.

### 7 · Keep extending it — every change is logged

Locking halts nothing. New thinking, new material → `/blueprint add`. Grill it again → `/blueprint
questions`. Apply new answers → `/blueprint resolve`. The difference after the lock: every change to the
spec lands as one entry in the **change log** — the date, what changed, and the ask in the words of
whoever asked. *"Why does the doc say something different now?"* is always answerable from one page.

---

## The commands

| Command | What it does | Writes? |
|---|---|---|
| `/blueprint init` | Sources or interview → grilled skeleton → your confirm → the Blueprint | After your confirm |
| `/blueprint add` | New material or ideas into existing/new features, same stop | After your confirm |
| `/blueprint questions` | The full grilling battery — every found question written, triaged and given guidance | Proposals + their guidance |
| `/blueprint resolve` | Write vetted answers into the feature specs | The answers |
| `/blueprint lock` | Readiness + final grilling + your acknowledgment → locked | The lock + change log |
| `/blueprint status` | One screen: what's flagged, what's waiting on you, ready to lock? | **Never** |

`status` is always safe to run. When lost, run it — every line ends with what to do next.

---

## What only you can do

The tool drafts; you decide. It will never: approve its own proposals, record an answer no human gave,
set `Intent = Agreed`, write your name, or invent an answer to anything. **Working alone?** All of this
collapses naturally — you're the owner and the approver everywhere. It isn't ceremony; it's the record
that a person actually read the thing, which matters just as much when that person is you in three
months.

---

## Honest limits

- The full grilling battery, measured in a five-project lab against 77 planted defects, caught **~86%
  outright and detected ~97%** — with zero hallucinated contradictions. (A single grilling pass manages
  ~44%; that's why the battery is the only mode that ships.) Still: an empty proposal list never means
  the spec is complete.
- Between runs it has no eyes. Decisions made in meetings or chats reach the document only when you put
  them in as a source or an answer.
- Reviewing proposals costs real attention — the run writes everything down and leaves the pace to you;
  a sitting, if you ask for one, offers ~10 at a time.

---

**Want the full picture?** Open [`blueprint-explained.html`](blueprint-explained.html) — the readable
deep-dive. The run files (`init.md`, `add.md`, `questions.md`, `resolve.md`, `lock.md`, `status.md`) and
`spec/` are the source of truth for how every run behaves.
