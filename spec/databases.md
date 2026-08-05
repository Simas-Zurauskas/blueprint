# Spec — the two databases

**Features** (the row is the spec) and **Open Questions** (one row per question and its answer). Nothing
is shared across projects. Companions: [`doc-shape.md`](doc-shape.md) · [`targets.md`](targets.md) ·
[`notion-mechanics.md`](notion-mechanics.md).

**17 properties, 3 frozen vocabularies, 11 option values.** Every option name below is exact. On the
Notion target an existing select option cannot be renamed over the API, so create them verbatim at setup
— **including options no row uses yet**.

## 1. Features — 8 properties

| Property | Type | Options / notes |
|---|---|---|
| `Name` | title | The feature, named the way people say it out loud |
| `What it does` | rich text | **One line.** A property, not a body line, so every view and read path carries it |
| `Intent` | select | `Draft` · `Agreed`. **A human writes this. No run ever does** |
| `Area` | select | Project-defined. Same names as the chapter pages — one vocabulary everywhere |
| `Confirmed` | select | `AI generated` · `Human approved`. **A run may write `AI generated` on a row it created. Only a human ever writes `Human approved`** |
| `Confirmed by` | people | Who set `Confirmed = Human approved` or `Intent = Agreed`. **Human only, always** |
| `Questions` | relation → Open Questions | Two-way; reverse of `Open Questions.Touches` |
| `Created` | created time | Written by the target at creation, read-only on every write path. Exists so views can sort oldest-first — a saved view cannot address a built-in creation time |

**One axis, not two.** The system this skill replaced carried a second, machine-written axis recording
whether a running app agreed with the row. There is no running app here and nothing looks at one, so
there is one axis and it is human-written: `Draft` until a person says `Agreed`.

**`Intent = Agreed` is the whole point of the exercise.** It is what a lock counts
([`../lock.md`](../lock.md) L1), and **an open `[NEEDS CLARIFICATION]` marker blocks it**
([`doc-shape.md`](doc-shape.md) §9) — the only thing in this system that blocks anything.

## 2. Open Questions — 9 properties

| Property | Type | Options / notes |
|---|---|---|
| `Question` | title | Phrased **as a question**, in the words it was asked. "Pickup slots" is not one; "Can a customer change a pickup slot after paying?" is |
| `Owner` | people | Exactly one named human. Never "the team". An unowned question is nobody's |
| `Answer & why` | rich text | The answer **and** its reasoning. Empty = still open. The only place the *why* survives once a page states the *what*. On a `Rejected` or `Closed (not applied)` row it carries the one-line reason instead |
| `Why asked` | rich text | **What prompted this** — the gap, the contradiction, the source segment, the ambiguity. Written by the run that proposed it, and it is what makes a `Proposed` row reviewable by somebody who was not in the room when it was generated |
| `Touches` | relation → Features | Two-way. Empty = a project-level question |
| `Status` | select | Seven values, §3 |
| `Confirmed` | select | `AI generated` · `Human approved` |
| `Confirmed by` | people | Who vetted the answer. Human only. **The gate is `Confirmed = Human approved`** (§4) — this records who did it |
| `Created` | created time | As above. Two views sort on it |

**`Why asked` exists because proposals are reviewed away from the run that made them.** A row a person
meets for the first time in a list, with no context, is a row they approve on the strength of its wording
rather than the strength of the gap. The measured failure it guards against is the one below in §3.

## 3. The question lifecycle — seven values, one frozen vocabulary

```
Proposed ──approve──> Open ──answer+vet──> Answered ──resolve──> Applied
   │                                           │
   └──reject──> Rejected                       └──> Flagged ──human clears──> Answered
                                               └──> Closed (not applied)
```

| Status | Means | Moved by |
|---|---|---|
| **`Proposed`** | A run generated it from a gap. **It is not a question yet.** Excluded from every open-questions view and from every queue | a run |
| **`Open`** | A human approved it. Nobody has answered | a human, or a run recording a human's approval at the checkpoint |
| **`Answered`** | The answer and its reasoning are written. **Resolve-eligible only when `Confirmed = Human approved` and `Confirmed by` is set** (§4) | **A human, always — with one exception:** a run transcribing a decision given out loud ([`doc-shape.md`](doc-shape.md) §9 route 5) creates the row at `Answered` with `Confirmed = AI generated` and **`Confirmed by` empty**, which is precisely why §4's gate is the `Confirmed` pair and not the status |
| **`Applied`** | The answer now lives in the feature documentation | **[`../resolve.md`](../resolve.md) only** |
| **`Flagged`** | A run tried to write the answer in and could not do it honestly; the objection is on the row. **Excluded from the queue** | **[`../resolve.md`](../resolve.md) only.** A human who resolves the disagreement moves it back to `Answered` |
| **`Closed (not applied)`** | Terminal, part of the record, never applied. **Two ways in.** (a) Answered and vetted, but the answer's home is elsewhere. (b) Nobody will ever answer it — off-topic, duplicative, overtaken by events; then `Answer & why` carries the one-line reason instead of an answer | **A human.** A run may propose (a) and never sets either |
| **`Rejected`** | A human turned down a proposal at review. Terminal. `Answer & why` carries the reason. **Excluded from both live-question views** (§6) and visible only in the **Decision log**, so it never reads as an unresolved product question; [`../status.md`](../status.md) C2 prints the running count | **A human** at the checkpoint |

**Why `Proposed` is a real state and not just a run's suggestion.** A generated question that lands
straight in the open-questions list acquires the authority of one somebody asked. The list then reads as
the project's real unknowns while containing a machine's guesses about what might be unknown, and the
measured ceiling on that generator is low — **the best agent on the nearest benchmark finds 44.4% of real
gaps**, so most of what it produces is noise and none of it is authoritative. Separating the states costs
one option value and buys a list a person can trust.

**Why `Flagged` is a real state.** Without it, a question a run refused to write stays `Answered`,
`Human approved` and vetted — passing eligibility on every later run, re-dispatching a writer and a
checker to reproduce the same verdict forever, and appearing in no report. It is terminal for runs and
clearable only by a person.

**A bad question has an exit and it is `Closed (not applied)` route (b).** A question that is simply
wrong-headed — asked about the wrong product, already answered by a `Not doing` line, a duplicate of a row
somebody else owns — must be able to end **without an answer**, or the row is `Open` forever on a report
whose rule is that every line ends in a move. **No run ever sets it, and no run proposes it for that
reason** — a run sees only vetted answers, so it has no evidence that a question is a bad question, and
proposing it would be a run recommending that a person's question be dropped on the run's own judgement.

**An answered question is never edited. Changing your mind is a new row.** House practice, costs nothing,
and it makes *why is it like that* a chain you can read. **Raise a row, not a comment** — a resolved
comment is invisible to every check here. **`Applied`, `Rejected` and `Closed (not applied)` rows, sorted
by date, are the project's decision log** — there is no separate register.

## 4. Eligibility

Nothing here is enforced by the platform. Every "required" means *checked by a run's opening checks and
reported by [`../status.md`](../status.md)*.

**A question is resolve-eligible when all of:** `Status = Answered`; **`Confirmed = Human approved`**;
`Answer & why` non-empty; `Confirmed by` non-empty.

**Every other status is excluded by name** — `Proposed`, `Open`, `Applied`, `Flagged`,
`Closed (not applied)`, `Rejected`. Nothing else is ever consumed: not a comment thread, not a decision
somebody described verbally, not a `Proposed` row however good it looks.

**A feature is lock-ready when:** `Intent = Agreed`, `Confirmed by` set, no open marker in its body,
and its `Behaviour` block holds at least one numbered requirement. [`../lock.md`](../lock.md) L1
counts these and names every miss; a human may still lock over them, deliberately and on the record.

**`Confirmed` is the gate, and it is the gate because it is the visible one.** A row a run drafted starts
at `AI generated` and **stays there until a human moves it to `Human approved`** — and nothing is applied
from a row still reading `AI generated`, however good the answer looks and whoever is named in
`Confirmed by`. That is the whole point of the label: *what has a person actually confirmed?* A gate kept
on a field nobody looks at, while the field everybody looks at never changes, is a gate that informs
nobody. `Confirmed by` records **who**; `Confirmed` records **that it happened**, in the column a reader
sees first.

## 5. Who may write what

| Field | Written by | Never written by |
|---|---|---|
| Features `Intent`, `Confirmed by` · Open Questions `Confirmed by` · `Confirmed = Human approved` | **a human, always** | any run, in any circumstance |
| Open Questions `Answer & why` | **a human, always** — except the verbatim transcription at [`doc-shape.md`](doc-shape.md) §9 route 5, which a human then confirms | a run writing an answer it then reads and applies — that is the laundering this design exists to prevent |
| Open Questions `Status: Proposed` | the run that generated it | — |
| Open Questions `Status: → Open`, `→ Rejected` | **a human**, at the checkpoint or in the UI (a run records the choice) | a run choosing for itself |
| Open Questions `Status: → Answered` | **a human, always** — **except** a run performing [`doc-shape.md`](doc-shape.md) §9 route 5, which leaves `Confirmed = AI generated` and `Confirmed by` empty so the row cannot be consumed until a person signs it | a run in any other circumstance, and never with `Confirmed by` filled |
| Open Questions `Status: Answered → Applied`, `→ Flagged` | [`../resolve.md`](../resolve.md) only | a human |
| Open Questions `Status: → Closed (not applied)` | a human (a run may propose route (a)) | a run |
| `Confirmed = AI generated` | whoever creates the row, once | anyone, afterwards |
| `Confirmed: AI generated → Human approved` | **a human, always** — the one sanctioned change to this field | **any run, in any circumstance** |
| The overview page | a human, **or a run writing a verbatim proposal a human accepted** ([`doc-shape.md`](doc-shape.md) §3) | a run writing it silently or wholesale |
| The change log | the write run that made the change, one entry per sitting ([`../lock.md`](../lock.md) L4), each carrying the ask verbatim | anyone rewriting it — append-only, like the run log |
| `Created` | the target, at creation | everyone |

**"Never written by any run" bars clearing a field exactly as much as setting one** — a run that finds
`Confirmed by` or `Confirmed = Human approved` already populated does not blank it to force a different
state, even reasoning from a rule it read correctly ([`../SKILL.md`](../SKILL.md) rule 1 is the single home
of this and the incident that made it explicit).

The record of who decided must be untouchable by the thing whose confidence degrades before its competence
does: users given an AI assistant wrote more insecure code *and rated it more secure*, trust 4.0 against
1.5 (Perry et al., ACM CCS 2023).

## 6. Five saved views

Views are how obligations become visible instead of depending on somebody remembering, and they are also
the navigation — every index in this shape is a view.

| Database | View | Type | Filter / grouping |
|---|---|---|---|
| Features | **Where things are** | table | Grouped by `Area`. Columns `Name · What it does · Intent`. **Embedded on the overview** |
| Features | **Not yet agreed** | table | `Intent` is `Draft`, oldest first. What still needs a person |
| Open Questions | **Proposed — needs review** | table | `Status` is `Proposed`, oldest first. Columns `Question · Why asked · Touches`. **Embedded on the overview** |
| Open Questions | **Open questions** | table | `Status` is `Open` or `Answered`, grouped by `Status`. **Embedded on the overview** |
| Open Questions | **Decision log** | table | `Status` is `Applied`, `Closed (not applied)` or `Rejected`, newest first |

**"Oldest first" means ascending on `Created`** (§1, §2), never on a last-edited time: any edit resets
that — a comment, a property write, a run's own write-back — so a queue sorted on it puts the least
recently *touched* row first, which is a different set of rows and an age that is not the row's.

## 7. Setup — who does what

On the Notion target, **only a human can do these**, and the skill never pretends otherwise:

1. **Create the project teamspace.** The API cannot, and a run cannot even address one.
2. **Create the overview page** inside it. The one ID this skill cannot rediscover.
3. **Add the connection** to that page — the page's **•••** menu.
4. **Optionally** put an internal connection's installation access token in `NOTION_TOKEN` or the OS
   keychain, never in a file in the repo. Writes go over the connection first; the token is the fallback.

On the local-markdown target a human names a folder and that is the whole setup
([`targets.md`](targets.md) §3).

**The run does the rest:** creates the two databases with every property and option exactly as written
above, creates the five views and embeds three, writes each new row's body skeleton at creation time, and
never edits an option list behind the team's back.

## 8. What this schema deliberately does not have

Reintroducing one needs a better reason than "it would be nice to know".

<!-- legacy-vocab: start -->
- **A third database for work in flight.** The system this skill replaced carried a Board — cards, ship
  notes, a ReadyToFold → Folded lifecycle, and a `Reality` axis (`Matches` · `Out of step`) written by a
  mechanical check against a running app. All of it is gone, deliberately: this Blueprint is built before
  development and then locked, and it never looks at an app. Work tracking belongs in whatever the team already
  uses. **A Blueprint carrying a Board database was built by the superseded skill and cannot be read by
  this one** — every command's pre-flight halts on it rather than half-migrating it.
<!-- legacy-vocab: end -->
- **A third database for proposals.** A proposal is a question row in a state that no view shows as a
  question. A separate table would be a second thing to keep in step, and approving would become a move
  between tables rather than a change of one field.
- **A database for exclusions.** A thing this product will not do is a **prose line** in the feature
  body's `Not doing` block, or the overview's NOT-clause.
- **`Owner`, `Size` and `Design` on a feature.** `Owner` was empty on every row it was measured on; `Size`
  had one consumer and that consumer is gone; a link belongs in `Why` or the overview's `Links`.
- **Rollups and formulas.** A formula property is not queryable at all — Notion returns it under
  `notAvailableInQuerySql`, so it is display-only and no run may filter or count on it. Everything here
  counts by querying rows, which was already the rule for a softer reason: a number alone cannot name
  *which* rows, and this whole system is built on saying which.
- **Due dates, priorities, risk scores, and any timestamp beyond `Created`.** They turn a two-minute row
  into a form nobody fills in.
- **Any cross-project database.** Ever.
