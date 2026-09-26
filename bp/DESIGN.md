# `bp` — design

`bp` is the blueprint skill's executor. It is a TypeScript CLI, run by Node with type stripping and no build step. It owns
everything mechanical in a blueprint run:

- reading and writing the target;
- hashing, counting, ordering and validating;
- the run log;
- planning the model tasks.

The model keeps prose and judgment, and returns them as typed JSON that `bp` validates before anything is staged. A human
keeps every act the rules reserve for a person. **The redesign changes who executes a step, never who decides.**

This file is the specification `bp` is built and reviewed against. The skill's run files (`../*.md`) and specs
(`../spec/*.md`) remain the source of truth for *what* the rules are. This file says *how* `bp` carries them out.

---

## 1. Constraints

| # | Constraint | Why |
|---|---|---|
| C1 | **Zero runtime dependencies.** Only the Node standard library. Dev tools (typescript, eslint, prettier) are devDependencies | The skill is invoked from a git clone in arbitrary sessions; an `npm install` before first use is a failure mode |
| C2 | **Node ≥ 22.6 with `--experimental-strip-types`**; source is erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces or parameter properties. Relative imports carry `.ts` | No build step, no generated output to drift |
| C3 | **`bp` never calls an LLM and never calls the network.** Notion I/O on a machine with no token goes through the relay (§5): `bp` plans the exact connector calls, the model makes them, and `bp` reads the results back out of the session transcript | The hosted Notion connector is OAuth-only; `bp` cannot authenticate to it, and a token is not available on the owner's machines |
| C4 | **The target stays canonical.** `bp` works on a per-run snapshot and pushes staged changes through operation 8 (fetch, diff, write, read back, then log). Nothing new is committed | The adversarial review of the first design (research REPORT §9) |
| C5 | **Every existing Blueprint keeps working**: v15–v37 run logs parse; v37 body hashes stay comparable (the relay hashes the same connector text v37 hashed); legacy free-text directions are never rewritten | Backward compatibility with repperoni, elf, adored-pages |
| C6 | **Deterministic output.** Same inputs produce the same bytes. The clock and randomness are injected | Testable, diffable, no timestamp churn (targets §3) |
| C7 | **Strict types** at the eng-rulebook-lean floor, plus `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit` | House rules |
| C8 | **Every trust boundary is parsed by one in-house schema module** (`src/core/schema.ts`), and static types are derived from the schemas. Boundaries: CLI args, JSON files, transcript lines, connector results, model task results | type-safety §5, with no runtime dependency (C1) |

---

## 2. Module map

```
bp/
  bp                      shell wrapper: exec node --experimental-strip-types --no-warnings src/bin.ts "$@"
  src/
    cli.ts                argument parsing, command table, --json, exit codes
    context.ts            the injected world: workspace, skill root, clock, randomness, environment, out/err
    core/                 args · schema · errors · clock · rand · fsx (atomic write) · hash · text
    domain/               vocab (every closed list, once) · feature · question · overview
    log/                  lines (kinds, formatting, HASHES roll-up) · parse (tolerant, v15–v40) ·
                          entry (open/append/close, routing, the lock, the ignore seed) · validate · facts
    target/               local (markdown folder) · notion (fetch parse) · relay (the read pull) · push (block writes)
                          · create (row creation, local files) · transcript (tool calls, human turns)
    home.ts               <home> resolution (targets §5 order), target.md, pre-v33 locations
    preflight.ts          SKILL.md's six pre-flight checks, R1's version classification against the register
    snapshot.ts           the Snapshot every command reads; feature and overview parsing
    sources.ts            the source record: capture, MANIFEST, capture-integrity re-derivation, re-baselines
    progress.ts           the progress block (run-progress §1)
    checks/               status C1–C10 · content rule · faithfulness (I6 / A5)
    render/               the PRD for reading (md · txt · json · html · packet) · the status screen
    tasks/                task briefs, prompts and receipts; the session's transcripts
    engine/               the shared run engine — state (need), writes (the serial queue), read, io, human (§8)
    resolve/              R1–R5: plan, apply (the delta's assembly), project-level path, run
    add/                  A2's draft and its checks, A4's plan
    challenge/            Q1 acts · Q2 grill · Q3 dispose and blind check · Q4 cold read and plan · the run
    init/                 I2's draft, the I3 screen, I4's structure
    runs/                 resolve's run state
    commands/             status · render · log · basic (hash, quote, runid, progress, preflight) · resolve · add ·
                          challenge · init
  test/                   node:test suites; support/ (factories, fake Notion); private/ (gitignored real fixtures)
```

---

## 3. Data shapes

### 3.1 Snapshot (`cache/snapshot/<run-id>/snapshot.json`, or a temp directory for `status`)

- `overview`: blocks by name (`tldr · whatItIs · whoFor · picture · links · operating`), plus raw text and hash.
- `features[]`: `{ id, name, whatItDoes, area, created, questionIds[], body: FeatureBody, bodyHash, raw }`.
- `questions[]`: `{ id, key (q-NN on local, page id on Notion), question, status, owner, answer, whyAsked,
  directions: Directions, whyFlagged, touches[], created, legacyKey? }`.
- `complete`: a boolean per collection, plus the reason when false (for example `has_more`, a truncated relation, a missing
  fetch).
- `readAt`, `target`, and a `source` per entity: the call id or file path it was read from.

`FeatureBody` parses doc-shape §5 exactly:
- `why`;
- `behaviour`: an `FR-n` list with provenance lines attached, and tombstones;
- `edgeCases`, `rabbitHoles`, `notDoing`;
- markers (anywhere): `NEEDS CLARIFICATION`, with an optional leading backslash and bracket;
- `defaults`, `fixes`, `slots`: the labelled lines doc-shape §5 and §9 define;
- `unparsed[]`: anything the parser has no slot for, carried through untouched and re-emitted in place.

**Round-trip law:** `serialise(parse(x)) === x` for every body `bp` can parse. A body that violates it is not rewritten;
the write refuses, and the item goes down R2.4.

### 3.2 Run state (`sources/<run-id>/run-state.json`; resolve's own at `resolve-state.json`)

`sources/` is durable and never committed (targets §5). State may therefore reference client text by path.

- `runId`, `command`, `mode`, `sitting`, `stage`, `startedAt`, `sittingStartedAt`;
- `tasks`: every dispatch by key — its id, nonce, brief, attempts, the answer once collected, its receipt and model;
- `writes`: the serial write queue, each write with its stage, planned call and outcome;
- `data`: the command's own state (the draft, the plan, the embedded challenge run, the pages as last written);
- `report`, `notes`, `entryOpen`.

A run is resumed by running its command again: `bp` reloads this file, re-reads the transcript, and advances as far as
the results in hand allow. An unfinished run is found by its state file; `--run <id>` names one where several are open.

### 3.3 Tasks

`cache/runs/<run-id>/briefs/<task-id>.md` holds the frozen brief (SKILL rule 8(i)). A run command that owes a task prints
it — `{ id, kind, prompt }` under `--json` — and the prompt is complete, ready to pass to the Agent tool.

**The prompt always carries:**
- the rubric's path and the brief's path, and the instruction to read nothing else and write nothing;
- rule 2's standing untrusted-data line, with the material in explicit delimiters;
- the nonce `bp-task:<id>:<nonce>`, salted per run and unique per dispatch;
- the exact JSON Schema of the answer.

**The answer is collected, never retyped.** When the command is run again, `bp` reads the session's subagent
transcripts, takes the one whose first user message carries the nonce and which began after the task was issued, and
parses its final answer against the schema. That is the receipt — the result came from a separate dispatch (rule 6) —
and it records the subagent's model. **Two answers for one nonce that differ** are ambiguous and neither is used. An answer
that fails its schema or its content check (a quote not found, a name that does not exist) is sent back **once** with the
problems named; a second failure fails the task, keeping the last value for the phase to use item by item.

## 4. The run log

### 4.1 What is written

- **The run log stays `record/run-log.md`**: committed, append-only, newest entry first, never re-rendered.
- **Entry heading:** `## YYYY-MM-DD · HH:MM · <command> · run <id> · skill v<N> · sitting <n>`.
- **Separator:** a line `---` between entries.
- **Every line is `- <kind>: <text>`** — the canonical format, and the one repperoni's v37 log uses.
- **`bp` inserts a new entry directly under the file's preamble.** It appends a line inside the open entry, before that
  entry's closing separator.
- **After every write, `bp` verifies that every byte outside the entry it touched is unchanged.** It writes to a temp file
  and renames.
- **Kinds are R5's closed list** (`src/log/lines.ts`):
  - `check`, `group-heading`, `DEVIATIONS` and `COST` route to `runs/<id>.md`, except R1's version-reconciliation `check`;
  - a kind not on the list for the command is refused.

### 4.2 What is read (tolerant parse)

- **Both line formats:** `- kind: text` (v37) and `KIND   text` (column format), including indented continuation lines.
- **Headings** with and without `·` between date and time.
- **The preamble**, plus crossover `NOTE`s.
- **Entry state** is the last dated line, per SKILL pre-flight check 4: `closing: CLOSED hh:mm`, `PAUSED`, or open.

### 4.3 Validation (`bp log validate`)

- every line's kind is on the closed list, and every line sits in the file its routing names;
- `COUNTS` totals equal their addends where written as `n = a · b · c` or `label n = x a · y b`;
- `HASHES` values equal this entry's `item` hashes, character for character;
- the `funnel` drafted count equals the sum of its outcomes, and `discarded` equals the number of `discard` lines;
- a `closing` reason is on R5's stop-reason list, or is a legacy free-text closing;
- no `check` in the log except the reconciliation exception.

**On legacy entries (before v38), validation reports findings as `legacy`, never as errors.**

---

## 5. Notion I/O without a token: the relay

### 5.1 Plans

When `bp` needs Notion, the run command prints the calls it owes — `calls: [{ tool, input }]` under `--json`, a numbered
`CALLS` list otherwise — and exits 4. **The orchestrator makes exactly these calls**, with at most three in flight
(notion-mechanics §4), passing each `input` verbatim, then runs the command again.

**The connector tools used, and their input shapes, as observed in real transcripts and the connector's own schema:**

| Tool | Input |
|---|---|
| `notion-fetch` | `{ id }` |
| `notion-query-data-sources` | `{ data: { data_source_urls: [url], query: "<SQL>" } }` |
| `notion-update-page` | `{ page_id, command: "update_content", allow_async: false, content_updates: [{ old_str, new_str }] }` |
| `notion-update-page` | `{ page_id, command: "update_properties", allow_async: false, properties: {…} }` |
| `notion-update-page` | `{ page_id, command: "replace_content", allow_async: false, new_str }` — init's one overview write; **never** `allow_deleting_content`, so a child the new text does not name fails the call rather than vanishing |
| `notion-create-pages` | `{ parent: { type: "data_source_id", data_source_id }, allow_async: false, pages: [{ properties, content? }] }` |
| `notion-update-data-source` | `{ data_source_id, statements }` — the v34 migration |
| `notion-create-database` | `{ parent: { page_id }, title, schema: "CREATE TABLE (…)" }` — init I4 |
| `notion-create-view` | `{ database_id, data_source_id, name, type: "table", configure: "<view DSL>" }` — init I4 |

### 5.2 Ingest

**Where the run command reads:** the session transcript at `~/.claude/projects/*/<CLAUDE_CODE_SESSION_ID>.jsonl`, plus that
session's `subagents/*.jsonl`.

**What it matches:** each planned call, against the **newest** `tool_use` with the identical tool name and a
deep-equal input, timestamped after the plan was issued. It takes that call's `tool_result`:
- the text blocks are joined;
- a `persisted-output` pointer is followed to its file;
- a result marked `is_error` is an error.

**What it records**, per call:
- the result text;
- its SHA-256;
- where it was found.

**A planned call with no matching result** is printed again as owed. The run does not advance, and nothing is guessed. A
write is read the same way: its result carries the page id, and the read-back is its own planned call. A call whose
result is an error is made again — except the overview page itself refusing, which halts.

**`--transcript <path>`** names the session transcript where `CLAUDE_CODE_SESSION_ID` and `HOME` do not find it.

### 5.3 Parsing connector output

- **A page fetch** is JSON with a `text` field holding `<page …>`. From it `bp` takes:
  - `<properties>{json}</properties>`, where rich text uses `<br>` for newlines and relations are arrays of page URLs;
  - `<content>…</content>`: the body exactly as returned, `\[` escapes included.
- **A data-source query** returns `{ results: [ … ], has_more }`:
  - relation columns are JSON-encoded strings or `null`;
  - `has_more: true` means the collection is **not** complete.
- **Page IDs** are normalised: hyphens and URL prefixes removed, lowercase.
- **Relations read off a page** carry the 25-reference truncation (notion-mechanics §4). `bp` never trusts one:
  - it reads `Touches`/`Questions` from the query side;
  - it marks the relation incomplete when an array reaches 25.

### 5.4 Writes

`bp` computes every write exactly: `old_str` is copied verbatim from the latest fetched content, and `new_str` is the
serialised block. The rules:

1. **One named block per call.**
2. **`old_str` must occur exactly once** in the fetched content, and the edits in one call must not overlap. This is
   checked by simulating the edits against the fetched text (notion-mechanics §3).
3. **The expected post-write content hash is recorded.**
4. **A read-back `io` step follows.** On ingest, the post-write hash must equal the expected one, or the item is reported
   and nothing is logged as written.
5. **Property writes** use `update_properties` and are read back by query.

---

## 6. Hashing (targets §5, exactly)

- **Algorithm:** SHA-256 over UTF-8. The full hex is stored in snapshots and state; the first 12 hex characters go in log
  lines.
- **Feature body:** from the `## Why` line to the end of the content, as the target returns it. Line endings become `\n`,
  trailing whitespace is stripped on every line, and the read-out line is never included.
- **Block:** the same rule over the block (heading line included) up to the next `## ` heading.
- **Property:** its text as returned, with the same normalisation.
- **Source file:** its bytes exactly as captured.

**Compatibility gate.** A test replays real v37 transcripts, kept in private fixtures. It recomputes the body hash of
pages fetched after a v37 `item` line recorded one, and asserts they are equal. If they are not, `bp` records a re-baseline
through R2.3's vouch, never silently.

---

## 7. Commands

| Kind | Commands |
|---|---|
| Mechanical acts | `bp hash` · `bp quote check` · `bp log open\|add\|counts\|hashes\|funnel\|close\|state\|validate` · `bp runid` · `bp progress` · `bp preflight` · `bp version` |
| Reading | `bp status [--full] [--fresh] [--deep]` · `bp render --format md\|txt\|json\|html [--feature] [--packet] [--questions]` |
| Runs — run it, do what it prints, run it again | `bp init` · `bp resolve [--soft]` · `bp add [--soft]` · `bp challenge [--full]` |

**Every command supports `--json`.** Exit codes:

| Code | Means |
|---|---|
| 0 | ok |
| 1 | findings (a check failed) |
| 2 | usage |
| 3 | halt (a pre-flight or safety stop) |
| 4 | waiting (Notion calls, subagent tasks, or a human's answer are owed) |

---

## 8. What stays with the model, and with a human

- **Model (G/BE, rubric-driven):**
  - grill lenses and sweeps;
  - disposition against prd-scope;
  - cold read;
  - directions;
  - resolve writer and checker;
  - faithfulness;
  - the content-rule name sweep;
  - the C8 prose read;
  - C11.

  Each is a task with a JSON Schema. A quote that does not match its source sends the task back once; what still fails is dropped
  item by item and reported, never written.
- **Human:**
  - moving a row to `Answered`, `Rejected` or `Closed (not applied)`;
  - ratifying and vetoing;
  - the I3 confirm;
  - accepting an overview proposal;
  - sending a packet;
  - the R2.3 vouch.

  `bp` records these only from the human's words, passed on the command that needs them: `bp init --reply <file>
  --decision confirm|edit|decline` (the I3 stop), `bp challenge --act "<words>"` and `--sample-answer "<words>"` (Q1),
  `bp resolve --trust-source <run>/<file> --trust-words "<words>"` (R1's vouch). **Each checks the words verbatim against
  a message the human sent in the session transcript** — never a tool result, a subagent's thread, a meta message or a
  harness reminder (`src/engine/human.ts`) — and refuses words it cannot find. The log carries a receipt: where the
  words were found and their hash, never the words themselves where they may carry client material. With no transcript
  to read, the words are recorded as given and the receipt says they are unverified.

---

## 9. Testing

- `node --test` with the built-in runner: no runner dependency.
- **Suites:**
  - one per module;
  - golden files for rendered output (reviewed, never bulk-updated);
  - integration tests that run whole commands against a synthetic local Blueprint in a temp directory, and against
    synthetic relay transcripts.
- **Oracles are hand-derived** (testing §5.1). Fixtures come from factories in `test/support/`.
- `test/private/` (gitignored) holds fixtures lifted from real Blueprints. It is skipped when absent, so `npm test` passes
  offline on a fresh clone.
- **Gates**, the four CI names (tooling §3):
  - `typecheck`: `tsc --noEmit`;
  - `lint`: eslint with `recommendedTypeChecked` plus the lean fragment;
  - `format:check`: prettier;
  - `test`.
- **The skill-level gate** (`../check.sh`) runs `lint.sh` in both locales plus the four `bp` gates.
