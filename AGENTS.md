# Maintaining this skill — read before editing anything here

`SKILL.md` is the consumer entry point; this file is for whoever edits the repo. It is safe to commit
(Claude Code does not auto-load `AGENTS.md`); a committed `CLAUDE.md` would be pulled into every
consumer session, so there is none.

## The gate — every edit, before every commit

1. `./lint.sh` **and** `LC_ALL=C ./lint.sh` — both must print `LINT PASS` with the **same**
   `ASSERTIONS n/n` and exit 0. The second run is not optional: the assertion tables are `⋮`-delimited
   and the `.`-for-multibyte rule in the header exists because a regex that passes under UTF-8 has
   failed under C twice in this file's history.
2. **`VERSION`** is the single integer every run stamps into its log entry. Bump it — there and nowhere
   else — when the files change materially, **and make the register decision in the same edit**:
   either add a row to SKILL.md's shape-change register (the bump changed a property, select option,
   database or file layout on the target) or name the version in that section's exclusion line (it
   changed rules, phases, reports or log-line kinds only). `lint.sh` check 11 fails a bump that did
   neither. `resolve.md` R1 reconciles silently across unlisted versions, so the register being complete
   *is* the safety property.
3. **Commit as one coherent snapshot** — `git add -A` (no intent-to-add, no half-staged deletions) —
   and push. There is no CI; a consumer clones what is pushed, and an uncommitted bump is the
   "lost lineage" case R1 has to be talked through.

## Before touching a directory

| You are editing | Read first |
|---|---|
| any run file (`init.md` … `status.md`) | `SKILL.md` rules 1–8 and pre-flight; the run file end to end; `resolve.md` R5 (log-line kinds — a closed list, widened only here with a bump) |
| `spec/` | the spec's own "single home" claims — every phrase lint's SINGLE_HOME table pins must stay in exactly that many files; restating a rule in different words is the drift lint cannot see |
| a sample screen or log entry | the rule it illustrates — `resolve.md` says "a sample is what a run copies"; v19 found five samples still teaching pre-v16 behaviour that lint could not see |
| `lint.sh` | its header: no multibyte in an assertion regex, no backslash-backtick, never `IFS=⋮ read`; add a FORBIDDEN row for every retired phrase you remove |
| `README.md`, `QUICKSTART.md`, `blueprint-explained.html` | the run file the sentence describes — these are readings of the files and drift silently; QUICKSTART is pointer-only by lint |

## Where the "why" lives

`HISTORY.md` holds the rationale — the version notes and the measured incidents that produced each
rule. It was moved out of the run and spec files so a **run** loads rules only; it is deliberately
outside `lint.sh`'s manifest for the same reason. When you change a rule, put the reason there, not
inline. Inline changelog notes are what made the run files unreadable and what tripped the gate five
times in one session (a note quoting the sentence a FORBIDDEN row bans).

## What lint cannot see (check by hand)

A count restated in prose · a sample contradicting the rule beside it · a citation without an
identifier · a rule whose executor was removed (grep for who *performs* an act, not who names it).
The 2026-08-21 assessment (`~/dev/ai/blueprint-assessment.md` on the owner's machine) is the worked
example of each.
