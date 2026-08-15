# Spec — where the Blueprint is stored

The Blueprint's shape ([`doc-shape.md`](doc-shape.md)) and its two databases
([`databases.md`](databases.md)) say nothing about where any of it lives. **Two targets are implemented:
Notion and a local markdown folder.** Notion is the default and the one to prefer. Every run resolves its
target first and speaks to it only through the contract below.

## 1. The contract — nine operations

Everything any run does is one of these. A run that needs something not on this list is describing a
feature this skill does not have; say so rather than improvising a tenth.

| # | Operation | Contract |
|---|---|---|
| 1 | **resolve target** | Given the workspace, return the target kind and its address, or ask a human once and record it |
| 2 | **create structure** | Create the two databases with every property and **every option verbatim**, the four views, and the run log. Idempotent: an existing structure is reused, never clobbered, and differences are printed as a checklist |
| 3 | **read entity** | Fetch one feature or question **whole** — properties and body — and **prepend the read-out line** (§4) before handing it to any sub-agent |
| 4 | **list by status** | Return every row matching a filter, **with an explicit completeness signal.** A truncated read is never returned as a complete one |
| 5 | **write one named block** | Replace exactly one named block of one entity. Never more than one block per call, never a wholesale replace of a page that has children |
| 6 | **write property** | Set one property value **and read it back to confirm it landed.** A write that silently did nothing is worse than one that failed loudly |
| 7 | **append to the run log** | Append-only, newest first, never rewritten, never summarised away |
| 8 | **append to the change log** | One human-readable entry per sitting on a locked Blueprint ([`../lock.md`](../lock.md) L4). Append-only, newest first, never rewritten |
| 9 | **fetch-and-diff before writing** | Re-read the exact block immediately before overwriting it, and compare against what was read at the start of the item |

### Operation 9 is the one that must never be skipped

**An edit this run did not make always wins** — a human's, or another run's. Fetch and diff **immediately
before** overwriting, not only after the push. Any difference is somebody else's: report the conflict,
write nothing, and leave the other author's text alone. The test needs no author metadata, because this
run made no change between reading and writing. Conflict detection at write time beat a git-worktree
multi-agent baseline by **+18.7 on Commit0-Lite** (*STORM*).

**A "section" is one numbered requirement, or the named block a change sits in** — nothing coarser. If a
whole page counts as the unit, one edit anywhere freezes everything on it.

## 2. The Notion target — the default

Address: the **page ID** of a human-created overview page inside a project teamspace. Never a title, never
a URL. Everything about how to talk to Notion — which tool for which job, the property-write read-back, the
child-deletion trap, the marker bracket escape, relation and query truncation, rate limits, the failure
playbook — lives in [`notion-mechanics.md`](notion-mechanics.md) and is not repeated here.

Three things about this target a run must know before it starts:

- **A human creates the teamspace and the overview page, and attaches the connection.** A run cannot
  address a teamspace at all, so it needs a page ID from a person before it can do anything.
- **Writes go over the connection first**, read back to confirm; REST with a token is the fallback.
  **The token is per-project** (v12): the working folder's `target.md` names the environment variable to
  read — `token_env: NOTION_TOKEN_ACME` — defaulting to `NOTION_TOKEN` where unset. An agency running
  many client workspaces off one global token is one paste away from writing client A's answers into
  client B's workspace; the variable name in `target.md` is not a secret, the token in the environment
  is, and neither is ever echoed or written anywhere.
  **A missing token is not a halt.** With neither path working, finish every read and print the pending
  writes as a checklist a human applies by hand.
- **Everything is keyed by ID.** Titles get edited and URLs change when a page moves.

## 3. The local-markdown target

Address: a folder a human names. Nothing else is needed — no account, no token, no connection. This is
the right target for a project that has no Notion yet, for a hand-off somebody wants as files, and for
rehearsing a run without touching a live workspace.

```
<blueprint-dir>/
  README.md              the overview — the same blocks and caps as doc-shape.md §3
  features/
    01-browse-the-menu.md
    02-checkout.md       one file per feature: front matter, then the body
  questions.md           one section per question, in Status order
  run-log.md             append-only, newest entry at the top
  changelog.md           starts at the lock — what changed and why, newest first
  internal/              the working folder (§5) — the skill's cache, not part of the document
```

**A feature file** carries its properties as YAML front matter and its body below, exactly as
[`doc-shape.md`](doc-shape.md) §5 defines it:

```markdown
---
name: Checkout
what_it_does: A customer pays for the order in their basket and gets a confirmation.
area: Ordering
questions: [q-04, q-07]
created: 2026-08-04
---

## Why
…
```

**A question** is one `###` section in `questions.md`, keyed by a stable `q-NN` that is never reused:

```markdown
### q-04 · Can a customer change a pickup slot after paying?
- **Status:** Open
- **Owner:**
- **Touches:** Checkout
- **Why asked:** The deck says slots are "flexible"; no source says whether that survives payment.
- **Created:** 2026-08-04

**Answer & why:** _(unanswered)_
```

Mapping the contract onto files:

- **A "named block"** (operation 5) is a `##` heading and everything under it, up to the next `##`. A
  numbered requirement is addressed as a line within `## Behaviour`. Writing one block rewrites the file
  with exactly that block's content replaced — nothing else on the file may differ.
- **"Read it back"** (operation 6) means re-read the file after writing and confirm the value.
- **"Completeness signal"** (operation 4) is trivially satisfied: a directory read is complete or it
  errored. Never report a partial read as complete anyway.
- **"Fetch and diff"** (operation 9) compares the block's current text against the text read when the item
  started. A file edited by a human in between wins, exactly as on Notion.
- **The four views do not exist here.** Their filters become sections of the reports instead, and the
  overview's `⟳` headings become short generated lists — the one place a local Blueprint is written by a
  run without a per-block prompt, because a list of links is not prose and rewriting it invents nothing.
  It is regenerated whole, and a human who types under a `⟳` heading loses it — the heading says so.

**Ordering is deterministic** — features by their numeric prefix, questions by `q-NN`, log newest-first —
or every run looks like a change. **Never interpolate a timestamp into content** that is not a dated
provenance line: a "last synced" line re-hashes every file on every run and turns a no-op into a rewrite.

### The local target's own hazards (v12 — this list did not exist, and every mechanics
hazard lived in [`notion-mechanics.md`](notion-mechanics.md), so choosing files silently dropped the
entire failure catalogue)

- **A sync client is a concurrent writer.** Dropbox/iCloud/Drive can deliver half-written files,
  conflict copies (`questions (Ana's conflicted copy).md`), or resurrect a deleted file. Treat a
  conflict copy exactly as rule 3 treats a foreign edit: report, never merge silently.
- **Write atomically**: temp file + rename, never truncate-in-place — a crash mid-write on the real
  file is the local equivalent of the half-written page nothing can read back.
- **Case-insensitive filesystems** (macOS default, Windows): `Checkout.md` and `checkout.md` are one
  file; slugs must be case-unique or collisions overwrite silently.
- **No version history unless git is there.** Where the folder is a repo, commit after each run's
  write-back with the run id as the message — that is the local analogue of the append-only run log's
  provenance. Where it is not, say so in the read-out line: nothing here can prove an edit's author.
- **Line endings and encoding**: write UTF-8 with `\n`; a CRLF editor pass makes every anchor
  comparison miss exactly like Notion's silent-skip trap.
- **The read-back rule survives the target swap**: after every write, re-read the file and compare —
  disks and sync clients fail quieter than APIs.

## 4. The read-out line — every read path prepends it

A feature's identity lives in its properties, and a body read as text carries none of them. So anything
reading a row out — a sub-agent brief, a build packet, an export — **prepends one line before the body**:

```
«Checkout» · Ordering
```

`title · Area`, in that order, ahead of `## Why`. A projection assembled at read time, never
typed into a body and never written back. Context@5 rose from 33.33% with no metadata to 63.33% with it,
separability from Cohen's *d* 0.450 to 2.25 (Yousuf et al., ECIR 2026). Without the prefix every consumer
of a body is in the 33% condition.

## 5. The working folder is a rebuildable cache

**This section is the single home of where the working folder lives.** Every run file says "the working
folder" and resolves it here:

| Target | The working folder |
|---|---|
| **Local markdown folder** | **`<blueprint-dir>/internal/`** — inside the Blueprint, so a project holds one directory, not two siblings |
| **Notion** | **`.blueprint/` in the workspace** — there is no local Blueprint folder to nest into, and a hidden folder is right for a cache that stands alone |

It holds:

```
<working-folder>/
  README.md              two paragraphs saying what this folder is and is not — written at creation,
                         because "internal" sits beside files people read
  target.md              the target kind and its address — the one thing not reconstructible
  mapping.md             entity IDs, parents, child order, a content hash per entity
  sources/<run-id>/      the source record: every ingested source, verbatim
  runs/<run-id>.md       what a run proposed and what became of each proposal
```

- **Nothing secret, no token, ever.** Outside this folder the skill never writes into a code repo.
- **Keep it out of version control either way** — `sources/` holds material *verbatim*, which is exactly
  the specifics the content rule keeps out of the Blueprint. On a local target the entry is
  `<blueprint-dir>/internal/`; on Notion it is `.blueprint/`. A human who deliberately commits the
  rendered Blueprint itself commits `internal/` only by choosing to.
- **Everything except the target address is reconstructible** from the target itself. Delete the folder
  and the next run rebuilds it.
- **Therefore no check may treat it as the record of anything that must survive.** In particular
  **locked-ness is never read from here** — it is derived from the target's own run log
  ([`../lock.md`](../lock.md) L3). A marker kept in a rebuildable cache disappears on another machine,
  and the next change to a settled document goes unrecorded.
- **If the cache and the target disagree, the target is right.**
- **A sibling `.blueprint/` beside a local-target Blueprint is the earlier layout of this skill.** Treat
  finding one as a rename, not a fork: move it to `<blueprint-dir>/internal/`, move the ignore entry
  with it, note the move in the run log, and say that you did. Never read from both — two working
  folders is exactly the two-places state this section exists to prevent.

## 6. Anything else

**A target that is not one of the two above halts and asks.** A run may not invent an adapter — write to a
Google Doc, a Confluence space, a wiki — by analogy, because every rule above about read-back,
truncation, conflict detection and child preservation is specific to a platform's failure modes, and an
adapter written by guessing has none of them.

What to say: *I can store this in Notion or as markdown files in a folder you name. For anywhere else,
tell me and I will say what it would take — I will not improvise it, because the safety rules in this
skill are specific to how each platform fails.*

## 7. Orphans and foreign children

Pages or files under the Blueprint that no longer correspond to anything expected. **Surface them; never
delete one automatically.** Offer three choices: remove it, leave it, or *it is a rename* — a rename
repoints the mapping at the existing entity so its history and comments survive.

**Foreign children** — things a human put under the overview that this skill did not create — are
re-discovered every run, kept on every content write, never deleted, never persisted into the mapping.
They are not ours; we just have to not destroy them.
