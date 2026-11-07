# Version and target compatibility

**Skill version.** The single integer in `VERSION`. Read it at run start, stamp it into the run log entry,
and bump it — there and nowhere else — when these files change materially. **No bump without `./lint.sh`
printing `LINT PASS`.** **And no bump without a register decision below**: every bump either adds its
row to the shape-change register or is named in that section's exclusion line. A bump that does
neither leaves [`resolve.md`](resolve.md) R1 reconciling across a shape change it cannot see — the
register is what turned a fail-safe gate into a fail-open one, so the list being complete *is* the
safety property.

### The shape-change register — the single list of version bumps that changed the target

A bump changes **behaviour** by default and the target's **shape** only rarely. The distinction is
load-bearing because [`resolve.md`](resolve.md) R1's version check halts on a shape gap and reconciles
silently across a behaviour-only one. **A version not listed here changed no property, no select
option, no database, and no file layout** — a Blueprint written by it is read and written by any later
version identically.

| Version | What changed about the target's shape |
|---|---|
| **v13** | Removed the `Intent` select and the question-approval status. On a Blueprint built before v13 both survive in the schema and no run touches either ([`spec/databases.md`](spec/databases.md) §8) |
| **v16** | **The run log moved off the target into `record/run-log.md`** ([`spec/targets.md`](spec/targets.md) §5), and the change log and its page were removed. A pre-v16 Blueprint keeps its Notion run log where it is — read for history, never rewritten — and new entries go to the local file, with one dated crossover line saying so |
| **v34** | **Added the `Why flagged` rich-text property to Open Questions** ([`spec/databases.md`](spec/databases.md) §2) — the objection `resolve` records when it ends a row `Flagged`, beside the `FLAGGED` log line that stays the durable home. **Additive, and the run performs the migration itself**: on a Blueprint built before v34 the first write run that finds the property absent adds it — one schema change on the Open Questions data source, read back by a fresh schema fetch, one dated `NOTE` line — and proceeds; R1's halt on a crossed row is cleared by that act ([`resolve.md`](resolve.md) R1). Until it exists the objection lives in the log alone, as it did before |

**Nothing else is on this list, and v17 through v33, v35, v36, v37, v46, v47, v56, v57, v58, v59, v60, v61, v62, v63 and v64 are deliberately not** — these changed rules, phases, reports, log-line kinds or working-folder machinery only. No target property, select option, database or file layout changed. The version-by-version reasons remain in [HISTORY.md](HISTORY.md).
