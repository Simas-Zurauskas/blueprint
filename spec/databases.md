# Spec — the two databases

**Features** (the row is the spec) and **Open Questions** (one row per question and its answer). Nothing
is shared across projects. Companions: [`doc-shape.md`](doc-shape.md) · [`targets.md`](targets.md) ·
[`notion-mechanics.md`](notion-mechanics.md).

**14 properties, 1 frozen vocabulary, 6 option values.** Every option name below is exact. On the
Notion target an existing select option cannot be renamed over the API, so create them verbatim at setup
— **including options no row uses yet**.

## 1. Features — 5 properties

| Property | Type | Options / notes |
|---|---|---|
| `Name` | title | The feature, named the way people say it out loud |
| `What it does` | rich text | **One line.** A property, not a body line, so every view and read path carries it |
| `Area` | select | Project-defined. Same names as the chapter pages — one vocabulary everywhere |
| `Questions` | relation → Open Questions | Two-way; reverse of `Open Questions.Touches` |
| `Created` | created time | Written by the target at creation, read-only on every write path. Exists so views can sort oldest-first — a saved view cannot address a built-in creation time |

**No status axis at all** (v13). The system this skill replaced carried a machine-written axis recording
whether a running app agreed with the row; a later version carried a human-written `Draft`/`Agreed` one.
Both are gone. A feature row is the spec, and there is no per-feature state to keep in step with
anything.

**There is no sign-off on the document as a whole** (v16 — the lock was removed at the owner's
direction). The only human sign-off is per question: moving a row to `Answered`. **Nothing in this
system blocks anything**, and nothing declares the document finished;
[`../status.md`](../status.md) reports what is still open, every time it is asked.

## 2. Open Questions — 9 properties

| Property | Type | Options / notes |
|---|---|---|
| `Question` | title | Phrased **as a question**, in the words it was asked. "Pickup slots" is not one; "Can a customer change a pickup slot after paying?" is |
| `Owner` | people | **An informal label — who is carrying this one right now.** Set by a human when it is useful to them, left empty when it is not. **Empty is normal and is never a finding** (owner's direction, 2026-08-15): no run writes it, no gate depends on it, and no check reports its absence as a defect |
| `Answer & why` | rich text | The answer **and** its reasoning. Empty = still open. The only place the *why* survives once a page states the *what*. On a `Rejected` or `Closed (not applied)` row it carries the one-line reason instead |
| `Why asked` | rich text | **What prompted this** — the gap, the contradiction, the source segment, the ambiguity. Written by the run that writes the row, and since v13 it is the only context an `Open` row carries to somebody who was not in the room when it was generated — what makes it judgeable before it goes anywhere |
| `Suggested directions` | rich text | **Machine-drafted decision support, written by the run that proposes the row**: 1–3 candidate directions, each with a why grounded in quoted document text and its main counter-case; general practice labeled as such; dated; **independently verified before writing** (a separate dispatch, a different model) — **and where no dispatch exists, every quotation is still checked mechanically by string match on normalised whitespace before it is written, a quotation that does not match being dropped and the mismatch reported. That check covers every machine-written field, `Why asked` included — not this property alone (v18) ([`../SKILL.md`](../SKILL.md) rule 6(d), which is the single home of that check). Read by humans, consumed by no run — never copied into `Answer & why`, never an input to resolve; an answer that only points at it is an answer that is only a link ([`../resolve.md`](../resolve.md) R2.1). Added 2026-08-07 at the owner's ask, overriding the report-only recommendation: the owner reviews in the UI, and guidance nowhere near the review is guidance nobody reads |
| `Key` | checkbox | **Retired (v12) — legacy projects only.** Its criterion — *this question's answer decides the build* — is now axis (b) of the admission gate ([`../questions.md`](../questions.md) Q4), so every row that exists passes it and the flag distinguishes nothing. Not created on new projects. On existing ones the column goes inert: human-set values are read, never edited or deleted ([`../SKILL.md`](../SKILL.md) rule 1), and no run derives, writes, sorts or counts on it again. Each row's one-line criterion survives as the closing clause of `Why asked`. Volume returning is the gate failing — fix the gate, do not resurrect the flag |
| `Touches` | relation → Features | Two-way. Empty = a project-level question |
| `Status` | select | Six values, §3. **`Answered` is the gate, and it is a human's move** (§4) |
| `Created` | created time | As above. Two views sort on it |

**Where `Why asked` and `Suggested directions` are written — the placement rule, and it is
target-specific.** On the **Notion** target both are **properties**: the run writes them to the
property and **never into the page body**. A property write is a different call path that must be
read back to confirm it landed ([`targets.md`](targets.md) operation 6), and a run under load reaches
for the body instead — the body accepts anything, so the write appears to succeed while the
`Unsent — packet candidates` view (§6) shows two empty columns and the row cannot be judged cold.
**On the local-markdown target the named lines in the question's `###` section *are* the fields**
([`targets.md`](targets.md) §3) — `- **Why asked:** …` is correct there and is never a finding.
After writing, the run reads the row back and confirms both fields carry their content and the body
carries neither ([`../status.md`](../status.md) C9 reports any that does).

**`Why asked` exists because questions are read away from the run that wrote them.** A row a person meets
for the first time in a list, with no context, is a row they answer, reject or forward on the strength of
its wording rather than the strength of the gap — and since v13 no approval step stands between the run
that wrote it and the person deciding whether it goes to a client (§3).

## 3. The question lifecycle — six values, one frozen vocabulary

```
(a run writes it) ──> Open ──answer+vet──> Answered ──resolve──> Applied
                        │                      │
                        └──reject──> Rejected  └──> Flagged ──human clears──> Answered
                                               └──> Closed (not applied)
```

**A generated question lands at `Open`** ([`../SKILL.md`](../SKILL.md) rule 5). The per-row
approval step it used to pass through is gone; what replaced it is a boundary further out — the client
packet is assembled and sent by a human ([`../questions.md`](../questions.md) Q6), never "whatever is
`Open`". A human may still answer straight from `Open` in the UI at their own pace; only an `Answered`
row with an **empty** `Answer & why` is a discrepancy.

| Status | Means | Moved by |
|---|---|---|
| **`Open`** | A live question nobody has answered — **this is where a generated question lands**, the moment it passes the Q4 admission gate | **a run**, at admission; or a human, in the UI |
| **`Answered`** | The answer and its reasoning are written. **Resolve-eligible** (§4) | **A human** — in the UI at their own pace, or spoken at a checkpoint with the run transcribing their words **verbatim** and recording the move as theirs ([`doc-shape.md`](doc-shape.md) §9 route 5). **A run never sets it on its own initiative and never invents the answer** |
| **`Applied`** | The answer now lives in the feature documentation | **[`../resolve.md`](../resolve.md) only** |
| **`Flagged`** | **A run is finished with this row and a person is not.** Since v16 it is the one terminal state a run may set, and it covers six routes ([`../resolve.md`](../resolve.md) R4 is the single home): a delta the checker could not derive, or text that tried to steer the run · an edit this seam did not make · a `Touches` or an answer R2.1 cannot use · a feature body that is not a spec · a project-level answer whose home is an overview block, carrying the proposed text · an answer whose home is outside the Blueprint. **Excluded from the queue** (§4), so nothing re-dispatches it. **The objection is not a property** — this schema has no field for it and none is being added; it lives in `record/run-log.md` and [`../status.md`](../status.md) C1 prints it from there, which is why that file is durable and committed ([`targets.md`](targets.md) §5) | **[`../resolve.md`](../resolve.md) only.** A human who resolves it moves the row back to `Answered` |
| **`Closed (not applied)`** | Terminal, part of the record, never applied. **Two ways in.** (a) Answered and vetted, but the answer's home is elsewhere. (b) Nobody will ever answer it — off-topic, duplicative, overtaken by events; then `Answer & why` carries the one-line reason instead of an answer | **A human.** A run may propose (a) and never sets either |
| **`Rejected`** | A human turned the question down — not a real gap, already decided, or badly asked. Terminal. `Answer & why` carries the reason, and **the reason is what decides any marker waiting on it** ([`doc-shape.md`](doc-shape.md) §9 route 4). **Excluded from both live-question views** (§6) and visible only in the **Decision log**, so it never reads as an unresolved product question; [`../status.md`](../status.md) C2 prints the running count | **A human** — in the UI, or at a sitting with the run recording the choice |

**Why a generated question may land at `Open`, and where the human still stands.** Until v13 it landed
at a separate approval state and a person promoted it row by row. That state was retired at the owner's direction
([`../SKILL.md`](../SKILL.md) rule 5): the Q4 admission gate refuses at the cause, so a second filter
downstream caught nothing the gate had not already caught — measured on the run that prompted the change,
43 of 43 standing rows re-admitted correctly and 0 of 7 carried markers admitted, across two independent
passes. What the state actually protected was not the list but the **export**: `Open` rows are what a
client sees. That protection now sits where it belongs — the client packet is a batch a human assembles
and sends (Q6), never the `Open` view piped outward.

**One number this spec used to lean on, corrected.** The line *"the best agent on the nearest benchmark
finds 44.4% of real gaps"* is a **recall** figure — and its source was never recorded, so as of v19 it
is carried as unverified and no rule rests on it ([`../SKILL.md`](../SKILL.md)'s citation paragraph). It was previously used to conclude that "most of what
it produces is noise" — a **precision** claim, which does not follow from a recall measurement, and which
a document whose first rule is that every sentence traces to its source should not have been making.
What 44.4% does support, and all it supports: **an empty question list is never evidence that a Blueprint
is complete.**

**Why `Flagged` is a real state.** Without it, a question a run refused to write stays `Answered`,
with a vetted answer — passing eligibility on every later run, re-dispatching a writer and a
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

**A question is resolve-eligible when all of:** `Status = Answered`; `Answer & why` non-empty.
*(The `Confirmed` select gated resolve until 2026-08-06, when the owner had the field removed — §8.
`Answered` is a human's move, and that move is the sign-off.)*

**Every other status is excluded by name** — `Open`, `Applied`, `Flagged`,
`Closed (not applied)`, `Rejected`. Nothing else is ever consumed: not a comment thread, not a decision
somebody described verbally, not an `Open` row however good it looks.

**A feature is fully written when:** it carries no open marker in its body, and its `Behaviour` block
holds at least one numbered requirement. [`../status.md`](../status.md)'s
`What is still unsettled` block counts these and names every miss. **Nothing blocks on it** — a
feature short of either is a normal, reported state.

**`Answered` is the gate, and it is a human's move.** A run may record it only as a transcription of a
human's own words given at a checkpoint — verbatim, never a paraphrase, never on its own initiative —
so the queue holds only human-sanctioned answers by construction. Neither *who* answered beyond `Owner`
nor *who drafted a row* is recorded anywhere (§8), and no run may claim to know either — the platform
keeps no queryable per-property history ([`notion-mechanics.md`](notion-mechanics.md) §5).

## 5. Who may write what

| Field | Written by | Never written by |
|---|---|---|
| Open Questions `Answer & why` | **a human, always** — except the verbatim transcription at [`doc-shape.md`](doc-shape.md) §9 route 5 | a run writing an answer it invented — that is the laundering this design exists to prevent |
| Open Questions `Status: Open`, at admission | **the run that generated it** (v13) — writing a question is a run's act | — |
| Open Questions `Status: → Rejected` | **a human**, at a sitting or in the UI (a run records the choice, and the reason decides the marker) | a run turning down a question on its own judgement |
| Open Questions `Owner` | **a human** — an informal label for who is carrying it, not an accountability gate and not a precondition for anything (§2) | a run inventing a name |
| Open Questions `Status: → Answered` | **a human** — in the UI; or their spoken answer at a checkpoint transcribed **verbatim** by the run and recorded as their move; **or a person relaying, verbatim and under their own name, an answer the client gave to a question this document asked** ([`doc-shape.md`](doc-shape.md) §9 route 5 is the single home of that branch and of why it moved in v17). The relayer is the human of record | a run on its own initiative, or with an answer no human gave |
| Open Questions `Status: Answered → Applied`, `→ Flagged` | [`../resolve.md`](../resolve.md) only | a human |
| Open Questions `Status: → Closed (not applied)` | a human (a run may propose route (a)) | a run |
| Open Questions `Key` | nobody — retired (§2); a human's legacy value stands, read-only | any run touching it |
| The overview page | a human, **or a run writing a verbatim proposal a human accepted** ([`doc-shape.md`](doc-shape.md) §3) | a run writing it silently or wholesale |
| `Created` | the target, at creation | everyone |

**"Never written by any run" bars clearing a field exactly as much as setting one** — a run that finds
a human-set status already populated does not blank it to force a different
state, even reasoning from a rule it read correctly ([`../SKILL.md`](../SKILL.md) rule 1 is the single home
of this and the incident that made it explicit).

The record of who decided must be untouchable by the thing whose confidence degrades before its competence
does: users given an AI assistant wrote more insecure code *and rated it more secure*, trust 4.0 against
1.5 (Perry et al., ACM CCS 2023).

## 6. Four saved views

Views are how obligations become visible instead of depending on somebody remembering, and they are also
the navigation — every index in this shape is a view.

| Database | View | Type | Filter / grouping |
|---|---|---|---|
| Features | **Where things are** | table | Grouped by `Area`. Columns `Name · What it does · Area`. **Embedded on the overview** |
| Open Questions | **Unsent — packet candidates** | table | `Status` is `Open`, sorted oldest first. Columns `Question · Why asked · Suggested directions · Touches` (the two 2026-08-07 fields belong on this view — it is the screen a human reads before assembling a client packet, Q6). **A database tab only — never embedded** (the owner's 2026-08-06 layout ask). *Replaced the retired approval-queue view when generated questions began landing at `Open`.* |
| Open Questions | **Open questions** | table | `Status` is `Open` or `Answered`, grouped by `Status` — the groups are the collapsible things. **Embedded on the overview, not inside a toggle** |
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
above, creates the four views and embeds two, writes each new row's body skeleton at creation time, and
never edits an option list behind the team's back.

## 8. What this schema deliberately does not have

Reintroducing one needs a better reason than "it would be nice to know".

<!-- legacy-vocab: start -->
- **A third database for work in flight.** The system this skill replaced carried a Board — cards, ship
  notes, a ReadyToFold → Folded lifecycle, and a `Reality` axis (`Matches` · `Out of step`) written by a
  mechanical check against a running app. All of it is gone, deliberately: this Blueprint is built before
  development and it never looks at an app. Work tracking belongs in whatever the team already uses. **A Blueprint carrying a Board database was built by the superseded skill and cannot be read by
  this one** — every command's pre-flight halts on it rather than half-migrating it.
<!-- legacy-vocab: end -->
- **A per-feature agreement axis, and a question-approval state — both removed at v13.** `Intent`
  (`Draft`/`Agreed`) and the `Proposed` status are gone. There is no per-feature sign-off and, since
  v16, no document-level one either; a generated question is live from the moment it passes the
  admission gate. **A marker therefore blocks nothing** — it is an admitted gap,
  counted by [`../status.md`](../status.md) C5 and named in its `What is still unsettled` block.

  **On a Blueprint created before v13** both survive in the schema and **no run touches either** — not
  read, not written, not sorted, not counted, and above all **never deleted**. Deleting a Notion
  property destroys its value for every row at once, which is the largest single act of human-data
  destruction available here; a human's `Agreed` is a decision, and [`../SKILL.md`](../SKILL.md) rule 1
  bars a run from clearing it. Rows still sitting at the old approval status are simply not described by
  this spec any more; a human may set them to `Open` in the UI at any time.

- **A third database for proposals.** A proposal is a question row in a state that no view shows as a
  question. A separate table would be a second thing to keep in step, and approving would become a move
  between tables rather than a change of one field.
- **A database for exclusions.** A thing this product will not do is a **prose line** in the feature
  body's `Not doing` block, or the overview's NOT-clause.
- **`Owner`, `Size` and `Design` on a feature.** `Owner` was empty on every row it was measured on; `Size`
  had one consumer and that consumer is gone; a link belongs in `Why` or the overview's `Links`.
- **A `Confirmed by` people property, recording who confirmed.** Both databases carried one until
  2026-08-05, when the owner had it removed (run `2026-08-05-amend-1`). The *who* behind a confirmation
  is not recorded anywhere, and no run may claim to know it — there is
  no queryable per-property edit history to derive it from
  ([`notion-mechanics.md`](notion-mechanics.md) §5).
- **A `Confirmed` select (`AI generated` · `Human approved`), recording drafting provenance and gating
  resolve.** Both databases carried one until 2026-08-06, when the owner had it removed (run `rsv7a1`):
  `Status = Answered` — a human's move — is the resolve gate, and who drafted a row is not tracked.
  What survives the removal: a run still never sends a client packet it
  assembled, and never records an answer no human gave.
- **Rollups and formulas.** A formula property is not queryable at all — Notion returns it under
  `notAvailableInQuerySql`, so it is display-only and no run may filter or count on it. Everything here
  counts by querying rows, which was already the rule for a softer reason: a number alone cannot name
  *which* rows, and this whole system is built on saying which.
- **Due dates, priorities, risk scores, and any timestamp beyond `Created`.** They turn a two-minute row
  into a form nobody fills in. *A retired carve-out worth keeping as precedent: the `Key` checkbox (§2, 2026-08-07, retired v12) was machine-set at
  creation by stated criteria — nobody fills a form — binary rather than a graded ladder, and needed by
  the write-all design's own volume; a 70-row batch without triage is a list nobody reads. The bar
  otherwise stands: no tiers, no scores, no dates.*
- **Any cross-project database.** Ever.
