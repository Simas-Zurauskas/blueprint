#!/bin/bash
# lint.sh — cross-reference and vocabulary lint for the blueprint skill files.
#
# Eleven checks (the header said "Seven" until v19, while 1–10 were listed and 11 implemented):
#   1  every manifest file exists            (--wip: report and skip, still exit 0)
#   2  every In / An / Qn / Rn / Ln / Cn / Sn reference resolves to a definition
#   3  every relative markdown link resolves on disk
#   4  no superseded vocabulary outside a <!-- legacy-vocab --> block
#   5  the frozen vocabularies are each defined exactly once, and no superseded
#      status literal appears anywhere outside an exemption block
#   6  VERSION is a bare integer
#   7  QUICKSTART.md is pointer-only: every bullet carries a (→ …) pointer, and no
#      normative word ("never"/"always"/"must") appears OUTSIDE a bullet — a rule in a
#      bullet is at least pointed at its home; a rule in a bare paragraph is not.
#      (Until v16 the comment here claimed a per-LINE normative check that the code
#      never implemented, and that no real QUICKSTART could pass: a bullet's pointer
#      routinely sits on a later line than its prose. What is implemented is what is
#      described. It does not catch a rule smuggled into a bullet with a pointer —
#      say so rather than let a reader think it does.)
#   8  REQUIRED assertions — a named regex that MUST match a named file
#   9  FORBIDDEN assertions — a named regex that must NOT match a named file. This is
#      the one that catches superseded behaviour text surviving an edit
#  10  SINGLE HOME — a phrase that must appear in exactly N manifest files.
#      READ THIS BEFORE ADDING A ROW. It counts FILES CONTAINING A LITERAL SUBSTRING. So:
#        - it detects a sentence DUPLICATED VERBATIM into a second file;
#        - it does NOT detect a fact restated in different words, which is the commoner drift;
#        - it tolerates the same sentence ten times inside one file.
#      Rows with want=1 are single-home enforcement. Rows with want>1 are a DUPLICATION CENSUS:
#      the fact is deliberately in N files (SKILL.md rule 6 MANDATES that resolve.md R3.3 and
#      init.md I6 each name `unverified`, so want=1 there would delete text another rule requires),
#      and the row's job is to make an unnoticed N+1 fail. Do not read a want>1 row as enforcement.
#      Measured before claimed: every N here was counted off the tree, never assumed.
#  11  SHAPE REGISTER — VERSION has a register row in SKILL.md or is named in the exclusion line.
#
# NEVER put a MULTIBYTE character in an assertion regex, and never use . to stand in for one:
# `.` matches one BYTE under LC_ALL=C, so a regex spanning a 3-byte character (a curly quote, an
# em dash, a math symbol) matches under UTF-8 and fails under C. Anchor on the ASCII either side.
# Caught twice in this file's history; the dual-locale run in the task workflow is what finds it.
#
# NEVER put a backslash-backtick in an assertion regex: GNU grep reads it as the
# start-of-buffer anchor while BSD/macOS grep reads it as a literal backtick, so the
# same row passes here and fails (or matches nothing) on Linux. Use . for a backtick.
#
# Checks 8-10 read three ⋮-delimited tables. The delimiter is multibyte, so the parse
# uses ${var%%⋮*} parameter expansion, NEVER `IFS=⋮ read`: under LC_ALL=C an IFS split
# breaks the character into bytes, the regex column comes out EMPTY, and `grep -qE ""`
# then matches every line — every REQUIRED assertion passes and every FORBIDDEN one
# fails, silently, while ASSERTIONS prints green. The self-test below is what stops a
# future edit reintroducing that.
#
# Run it — and get LINT PASS — before bumping VERSION.
#
# Why check 4 has a block-delimited exemption rather than a file exemption: four
# places must name the superseded system on purpose (the lineage note, the
# "deliberately does not have" list, and the two legacy-Blueprint halts). A
# file-level exemption would have let anything drift into those files unnoticed.
set -u
cd "$(dirname "$0")"
fail=0
wip=0
[ "${1:-}" = "--wip" ] && wip=1

MANIFEST="SKILL.md README.md QUICKSTART.md init.md add.md questions.md resolve.md status.md \
spec/doc-shape.md spec/databases.md spec/targets.md spec/notion-mechanics.md spec/run-progress.md"

# Swept for vocabulary (checks 4 and 5) but not cross-referenced or link-checked:
# the explainer is a reading of the files, not one of them, and it drifts exactly as easily.
EXTRA_SWEEP="blueprint-explained.html"

# ---------------------------------------------------------------- 1. manifest
PRESENT=""
missing=0
for f in $MANIFEST; do
  if [ -f "$f" ]; then PRESENT="$PRESENT $f"; else
    missing=$((missing + 1))
    [ $wip -eq 0 ] && { echo "MISSING manifest file: $f"; fail=1; }
  fi
done

# strip legacy-vocab blocks from a file before any vocabulary sweep.
# Keeps the ORIGINAL line number on every surviving line, so a reported hit
# points at the real line rather than at its position in the stripped text.
strip_legacy() {
  awk '/<!-- legacy-vocab: start -->/{skip=1} !skip{print NR": "$0} /<!-- legacy-vocab: end -->/{skip=0}' "$1"
}

# ------------------------------------------------- 2. cross-reference targets
# Definitions: phase headings in the file that owns each prefix, plus status checks.
def_of() {  # $1 = file, $2 = prefix letter
  [ -f "$1" ] || return 0
  grep -hoE "^#{2,3} $2[0-9]+(\.[0-9]+)?" "$1" | grep -oE "$2[0-9]+(\.[0-9]+)?" | sort -u
}
I_DEF=$(def_of init.md I)
A_DEF=$(def_of add.md A)
Q_DEF=$(def_of questions.md Q)
R_DEF=$(def_of resolve.md R)
L_DEF=$(def_of lock.md L)
S_DEF=$(def_of status.md S)
C_DEF=$( [ -f status.md ] && grep -hoE '^\| \*\*C[0-9]+\*\*' status.md | grep -oE 'C[0-9]+' | sort -u )

if [ -n "$PRESENT" ]; then
  REFS=$(for f in $PRESENT; do strip_legacy "$f"; done \
    | grep -hoE '\b[IAQRLCS][0-9]+(\.[0-9]+)?\b' | sort -u)
  for r in $REFS; do
    p=$(echo "$r" | cut -c1)
    case "$p" in
      I) SET="$I_DEF" ;; A) SET="$A_DEF" ;; Q) SET="$Q_DEF" ;; R) SET="$R_DEF" ;;
      L) SET="$L_DEF" ;; C) SET="$C_DEF" ;; S) SET="$S_DEF" ;;
    esac
    if ! echo "$SET" | grep -qx "$r"; then
      # a reference into a file that is not written yet is a WIP notice, not a failure
      case "$p" in
        I) OWNER=init.md ;; A) OWNER=add.md ;; Q) OWNER=questions.md ;; R) OWNER=resolve.md ;;
        L) OWNER="a run file (the L prefix is retired — lock.md was removed in v16)" ;; C|S) OWNER=status.md ;;
      esac
      if [ $wip -eq 1 ] && [ ! -f "$OWNER" ]; then continue; fi
      echo "DANGLING reference: $r (nothing in $OWNER defines it)"
      grep -nE "\b${r}\b" $PRESENT | sed "s/^/    /" | head -4
      fail=1
    fi
  done
fi

# --------------------------------------------------------- 3. relative links
for f in $PRESENT; do
  dir=$(dirname "$f")
  for link in $(grep -oE '\]\([^)]+\)' "$f" | sed 's/^](//; s/)$//' | grep -vE '^(https?:|#|mailto:)'); do
    target=$(echo "$link" | sed 's/#.*$//')
    [ -z "$target" ] && continue
    if [ ! -e "$dir/$target" ]; then
      # tolerate links to not-yet-written manifest files while building
      base=$(cd "$dir" && printf '%s\n' "$target")
      if [ $wip -eq 1 ] && echo "$MANIFEST" | tr ' ' '\n' | grep -qx "$(basename "$target")" ; then continue; fi
      if [ $wip -eq 1 ] && echo "$MANIFEST" | tr ' ' '\n' | grep -q "/$(basename "$target")$" ; then continue; fi
      echo "DANGLING link in $f: $link"
      fail=1
    fi
  done
done

# ----------------------------------------------------- 4. superseded vocabulary
# The maintenance system this skill replaced. None of it may appear in prose.
BANNED='Reality|Ship note|ReadyToFold|Backlog|\bfold\b|\bBoard\b|Sketch|Closed \(no fold\)|Matches|Out of step|Dropped'
SWEPT="$PRESENT"
for x in $EXTRA_SWEEP; do [ -f "$x" ] && SWEPT="$SWEPT $x"; done
for f in $SWEPT; do
  hits=$(strip_legacy "$f" | grep -E "$BANNED")
  if [ -n "$hits" ]; then
    echo "SUPERSEDED VOCABULARY in $f:"
    echo "$hits" | sed 's/^/    /' | head -6
    fail=1
  fi
done
EXEMPT=$(grep -l 'legacy-vocab: start' $SWEPT 2>/dev/null | wc -l | tr -d ' ')
for f in $SWEPT; do
  s=$(grep -c 'legacy-vocab: start' "$f")
  e=$(grep -c 'legacy-vocab: end' "$f")
  [ "$s" = "$e" ] || { echo "UNBALANCED legacy-vocab block in $f ($s start, $e end)"; fail=1; }
done

# ------------------------------------------------------- 5. frozen vocabulary
if [ -f spec/databases.md ]; then
  # Each of the 6 Status values is defined EXACTLY ONCE, as a definition row in §3's table
  # ("| **`Value`** | ..."). Counting anywhere-in-the-file would pass a second, drifting
  # definition row, which is the failure this check exists to catch.
  for v in 'Open' 'Answered' 'Applied' 'Flagged' 'Closed (not applied)' 'Rejected'; do
    n=$(grep -cE "^\| \*\*\`$(printf '%s' "$v" | sed 's/[()]/\\&/g')\`\*\*" spec/databases.md)
    [ "$n" -ne 1 ] && { echo "FROZEN VOCABULARY: \`$v\` has $n definition rows in spec/databases.md (want exactly 1)"; fail=1; }
  done
  # a closed list of literals from the superseded schema — decidable, unlike "every other use"
  SUPERSEDED='Sketch|ReadyToFold|Closed \(no fold\)|Matches|Out of step|Backlog|In progress|Dropped'
  for f in $SWEPT; do
    hits=$(strip_legacy "$f" | grep -E "$SUPERSEDED")
    [ -n "$hits" ] && { echo "SUPERSEDED STATUS LITERAL in $f:"; echo "$hits" | sed 's/^/    /' | head -4; fail=1; }
  done
fi

# ------------------------------------------------------------------ 6. VERSION
if [ -f VERSION ]; then
  grep -qE '^[0-9]+$' VERSION || { echo "VERSION is not a bare integer"; fail=1; }
else
  echo "MISSING VERSION"; fail=1
fi

# --- check 7: QUICKSTART is pointer-only -------------------------------------
if [ -f QUICKSTART.md ]; then
  bad7=$(awk 'function flush(){if(inb && buf !~ /\(→/) print start": "substr(buf,1,70)"…"}
    /^(- |[0-9]+\. )/{flush(); inb=1; start=NR; buf=$0; next}
    /^(#|$)/{flush(); inb=0; next}
    {if(inb) buf=buf" "$0}
    END{flush()}' QUICKSTART.md || true)
  if [ -n "$bad7" ]; then
    echo "QUICKSTART.md bullet(s) without a (→ pointer):"; echo "$bad7"; fail=1
  fi
  # normative words outside any bullet: a rule in a bare paragraph points nowhere
  # POSIX ERE has no word boundary and macOS awk has no \y — bracket the word by hand.
  norm7=$(awk '/^(- |[0-9]+\. )/{inb=1} /^(#|$)/{inb=0}
    { if (!inb && $0 !~ /^(#|$)/ && $0 ~ /(^|[^A-Za-z])(never|Never|always|Always|must|Must)([^A-Za-z]|$)/) print NR": "substr($0,1,70) }' QUICKSTART.md || true)
  if [ -n "$norm7" ]; then
    echo "QUICKSTART.md normative word outside a bullet (it may not be a rule's home):"
    echo "$norm7" | sed 's/^/    /'; fail=1
  fi
fi



# ============ check 11 — the shape-change register accounts for VERSION ============
# resolve.md R1 now RECONCILES across a version gap that crosses no register entry, so the
# register's completeness is a safety property, not documentation. A bump that neither adds
# its row nor is named in the exclusion line leaves R1 reconciling across a shape change it
# cannot see. Check 8 can only prove the register EXISTS; this proves it mentions this version.
if [ -f VERSION ] && [ -f SKILL.md ]; then
  v=$(cat VERSION)
  if grep -q "shape-change register" SKILL.md; then
    if grep -qE "^\| \*\*v${v}\*\* \|" SKILL.md; then
      : # this version has its own register row
    elif grep -qE "v${v}( and v[0-9]+)? (are|is) deliberately not|and v${v} are deliberately not" SKILL.md; then
      : # this version is named in the exclusion line
    else
      echo "SHAPE REGISTER: VERSION is $v but SKILL.md's shape-change register neither lists v$v"
      echo "    nor names it in the exclusion line. resolve.md R1 reconciles across unlisted gaps,"
      echo "    so an unaccounted bump is a silent fail-open. Add the row, or name it as excluded."
      fail=1
    fi
  fi
fi

# ================= checks 8, 9, 10 — requirement assertions ==================
# Each row: file ⋮ regex ⋮ name.  Parsed with parameter expansion (see header).

REQUIRED='SKILL.md⋮^## The rules that outrank everything⋮skill-has-rules
resolve.md⋮^## R4⋮resolve-has-R4
questions.md⋮^## Q4⋮questions-has-Q4
spec/databases.md⋮the placement rule, and it is⋮databases-placement-rule
spec/run-progress.md⋮single home of the progress block⋮progress-spec-exists
init.md⋮^Task list: ⋮progress-list-in-init
add.md⋮^Task list: ⋮progress-list-in-add
questions.md⋮^Task list: ⋮progress-list-in-questions
resolve.md⋮^Task list: ⋮progress-list-in-resolve
status.md⋮^Task list: ⋮progress-list-in-status
resolve.md⋮Applied. or .Flagged., and there is no third⋮resolve-two-terminal-states
resolve.md⋮^## R4 — What a person still owns⋮resolve-r4-is-a-report
resolve.md⋮never waits for anybody⋮resolve-never-waits
add.md⋮the incoming source wins⋮add-source-supersedes
add.md⋮`/blueprint add soft`⋮add-soft-mode
add.md⋮force. is the default⋮add-force-is-default
add.md⋮governs both write seams that have modes⋮modes-govern-both-seams
add.md⋮says the word it did not recognise⋮modes-name-the-bad-modifier
questions.md⋮Derived past the bound⋮q3-depth-filter
questions.md⋮Depth is stamped by the channel that writes⋮depth-is-stamped-not-traced
questions.md⋮surveyed no-requirement finding⋮q4-third-demotion-evidence
questions.md⋮is not a routing⋮q4-demotion-is-mandatory
questions.md⋮Rotation, not skipping⋮regrill-rotates-not-skips
questions.md⋮whole-document snapshot stays the brief⋮regrill-keeps-the-brief
questions.md⋮full battery on a first grill⋮battery-scoped-to-first-grill
questions.md⋮converged: yes⋮convergence-verdict-is-written
questions.md⋮depth 3 or deeper⋮q3-depth-threshold
questions.md⋮never capped, since each costs one⋮q3-depth-spares-cheap-channels
questions.md⋮inherits the depth of its own provenance line⋮requirement-inherits-depth
questions.md⋮no run in the last three⋮rotation-clock-is-three-runs
questions.md⋮never discards are exempt from every filter in this phase⋮q3-exemptions-are-general
questions.md⋮.Open. or .Answered. row standing⋮convergence-counts-standing-rows
questions.md⋮A two-value vocabulary would be a defect⋮depth-vocabulary-is-open
questions.md⋮What corroboration is, stated as a test⋮depth-corroboration-has-a-test
questions.md⋮and no others.*lens 4⋮grill-names-lenses-1-3-only
questions.md⋮text, not the whole changed body⋮shared-entity-is-the-changed-text
questions.md⋮That re-routing is the exit, and it is bounded at one⋮routing-refusal-is-bounded
questions.md⋮quotes each one.s own sentence⋮survey-quotes-are-checkable
questions.md⋮defeats the finding⋮blind-side-has-a-lever
questions.md⋮entry standing in .record/run-log.md. newer⋮convergence-source-condition-has-a-read
resolve.md⋮own kind and the one thing that reads it back⋮grill-kind-exists
status.md⋮newest write entry of any command⋮status-convergence-not-stale
resolve.md⋮carries the row.s derivation depth⋮resolve-stamps-depth
add.md⋮the line carries .*depth n⋮add-supersession-carries-depth
spec/doc-shape.md⋮the derivation depth⋮docshape-provenance-carries-depth
status.md⋮omits its questions step on a read⋮status-reads-convergence-verdict
SKILL.md⋮full battery on a first grill⋮skill-battery-scoped
add.md⋮two sources disagree|source contradicts itself⋮add-source-vs-source-still-a-question
add.md⋮operation 8⋮add-keeps-operation-8
add.md⋮Superseded⋮add-supersession-provenance
add.md⋮not optional and it is not deferrable⋮add-handoff-unconditional
resolve.md⋮supersedes it, quoting⋮resolve-supersedes
resolve.md⋮`/blueprint resolve soft`⋮resolve-soft-mode
resolve.md⋮Neither mode stops⋮resolve-modes-never-stop
resolve.md⋮The seven things that end⋮resolve-seven-flag-routes
spec/databases.md⋮it covers seven routes⋮databases-seven-flag-routes
resolve.md⋮R4.s seven routes⋮resolve-seven-routes-one-attempt
resolve.md⋮### R3.3 Six outcomes⋮resolve-six-outcomes-heading
README.md⋮`resolve soft` flags that row⋮readme-names-resolve-soft
status.md⋮supersession in the default mode⋮status-supersession-mode-conditional
blueprint-explained.html⋮<code>resolve soft</code>⋮html-names-resolve-soft
resolve.md⋮is still never retried: R3.3.s .Kept.⋮resolve-soft-flag-not-retried
questions.md⋮document is and is not⋮questions-scope-statement
questions.md⋮Not a specification question⋮questions-not-a-spec-filter
questions.md⋮outside the technical department⋮questions-technical-department
questions.md⋮change any requirement statement⋮questions-necessity-test
questions.md⋮question budget⋮questions-budget
questions.md⋮never discards a contradiction-backed⋮questions-budget-exemptions
questions.md⋮Two explicit exemptions|Two exemptions, both project-level⋮questions-lens5-exempt
questions.md⋮historically expensive failure⋮questions-keeps-M2
questions.md⋮never evidence⋮questions-empty-list-caveat
spec/databases.md⋮never into the page body⋮fields-notion-property
spec/databases.md⋮section \*are\* the fields⋮fields-local-target-scoped
status.md⋮carries .Why asked:. prose⋮fields-status-check
spec/targets.md⋮  record/⋮working-folder-record
spec/targets.md⋮  cache/⋮working-folder-cache
spec/targets.md⋮never deleted, never rebuilt⋮record-is-durable
spec/targets.md⋮record/run-log.md⋮run-log-is-local
resolve.md⋮keeps only the kinds something reads back⋮independence-kind-kept
SKILL.md⋮## Before any run — six checks⋮preflight-six-checks
status.md⋮What is still unsettled⋮status-owns-readiness
status.md⋮since v16, everything under .record/.⋮c9-sweeps-the-record
resolve.md⋮overview route⋮resolve-overview-route-terminates
resolve.md⋮flag fires once, not forever⋮r23-rebaselines-the-hash
resolve.md⋮without it the seed path is unreachable⋮r24-exempts-seed-eligible
SKILL.md⋮One bounded exception, added v16⋮rule3-bounded-exception
SKILL.md⋮It does not govern a source against the document⋮rule4-source-vs-document
questions.md⋮one written question per feature⋮questions-budget-has-a-number
spec/targets.md⋮Never ignore the whole folder⋮targets-ignore-rule-correct
SKILL.md⋮Zero dispatches available⋮d1-zero-dispatch-defined
resolve.md⋮^\| `Unverified`⋮d1-resolve-unverified-outcome
init.md⋮Unverified — no second dispatch available⋮d1-init-unverified-verdict
init.md⋮superseded at \[`add.md`\]\(add.md\) A4 step 4⋮d2-conservation-has-supersession
init.md⋮Sweep the content rule over every field⋮d7-init-sweeps-record
add.md⋮everything this run wrote into .record/.⋮d7-add-sweeps-record
questions.md⋮it does offer one, once⋮d4-offers-the-sitting
init.md⋮the run does not wait for the answer⋮d3-because-is-async
questions.md⋮Printing is the run.s act; ratifying is the human.s⋮d14-ratification-reconciled
resolve.md⋮§5.s tests win over the cap⋮d5-split-wins-over-cap
spec/run-progress.md⋮whose task list governs⋮d6-embedded-run-rule
spec/run-progress.md⋮skipped⋮d16-skipped-state
resolve.md⋮The objection does not go on the row⋮d11-objection-home
spec/doc-shape.md⋮One carve-out, and it is the first write only⋮d9-first-overview-write
SKILL.md⋮shape-change register⋮v17-shape-register
resolve.md⋮narrower than⋮f1-r34-flagged-retries
resolve.md⋮outputs 2 and 3 are never⋮f1-outputs-excluded
resolve.md⋮is not R3.4.s$⋮f1-anchor-case-disambiguated
SKILL.md⋮run-progress⋮f10-five-specs-skill
init.md⋮notion-mechanics.md\) . \[.spec/run-progress|run-progress.md\)\.$⋮f10-five-specs-init
resolve.md⋮notion-mechanics.md\) . \[.spec/run-progress|run-progress.md\)\.$⋮f10-five-specs-resolve
questions.md⋮notion-mechanics.md\) . \[.spec/run-progress|run-progress.md\)\.$⋮f10-five-specs-questions
status.md⋮numbers skip one between⋮f12-c6-documented
resolve.md⋮by a human or by a run⋮f2-sweep-predicate-resolve
add.md⋮in-scope field written since the last logged sweep, by a human or⋮f2-sweep-predicate-add
status.md⋮by a human or by a run⋮f2-sweep-predicate-status
resolve.md⋮refused — never silently rewritten⋮f2-refuse-not-rewrite
resolve.md⋮R5, when the entry closes⋮f2-first-run-window
resolve.md⋮Swept at one point⋮f2-single-sweep-point
SKILL.md⋮every machine-written field⋮f3-6d-every-field
spec/databases.md⋮every machine-written field⋮f3-databases-mirrors-6d
resolve.md⋮a check verdict that arrived after its item was written⋮f4-late-verdict-route
status.md⋮unreconciled late verdict⋮f4-status-c4-case
questions.md⋮re-gates the whole⋮f5-budget-denominator
init.md⋮closed set of blocking stops⋮f6-stops-init
add.md⋮closed set of blocking stops⋮f6-stops-add
questions.md⋮closed set of blocking stops⋮f6-stops-questions
resolve.md⋮closed set of blocking stops⋮f6-stops-resolve
README.md⋮n=1⋮f17-lab-numbers-carry-provenance
SKILL.md⋮re-verified before a run relies on it⋮f16-citation-expiry
init.md⋮available but not dispatched⋮f11-i6-orphan-states
resolve.md⋮crosses no version on that register⋮v17-version-gate-reconciles
spec/doc-shape.md⋮A relayed client answer is also .Answered.⋮v17-relayed-answer-arbitrated
status.md⋮whose .Answer & why. is NOT empty⋮v17-status-sees-answered-open
SKILL.md⋮verified. here is a string match, not a dispatch⋮v17-citation-string-match
resolve.md⋮record/runs/<run-id>.md. alike⋮v17-sweep-covers-runs
status.md⋮FUNNEL. line against the .discard. lines⋮v17-c10-checks-funnel
resolve.md⋮stamped < n⋮v18-crosses-defined
resolve.md⋮^\| \*\*citation\*\*⋮v18-citation-kind-exists
SKILL.md⋮no bump without a register decision⋮v18-bump-obliges-register
SKILL.md⋮matching on normalised whitespace⋮v18-citation-whitespace
spec/databases.md⋮checked mechanically by string match⋮v18-directions-field-matches-rule6d
init.md⋮i3-skeleton.md. before printing it⋮v21-i3-screen-persisted
spec/targets.md⋮i3-skeleton.md⋮v21-i3-skeleton-in-layout
spec/doc-shape.md⋮this carve-out does not apply⋮v21-carveout-needs-stored-text
SKILL.md⋮Try three rungs before⋮v21-dispatch-ladder
SKILL.md⋮succeeded via⋮v21-probe-records-route
SKILL.md⋮or from an earlier sitting of the same run⋮v21-probe-guard-crosses-sittings
resolve.md⋮repeats, character for character⋮v21-hashes-rollup-repeats
resolve.md⋮The content rule binds every line of this print⋮v21-r4-print-bound
resolve.md⋮each carrying its addends⋮v21-counts-show-addends
spec/doc-shape.md⋮name of the product being described is not exempt⋮v21-product-name-not-exempt
init.md⋮no defaults-ledger line and no marker is never⋮v21-uncited-fr-not-clean
add.md⋮One per body write, not one per feature⋮v21-item-line-per-body-write
add.md⋮restatement is superseded with it⋮v21-supersession-reaches-restatements
questions.md⋮you can quote the row.s own words⋮v21-duplicate-needs-quote
questions.md⋮counted as it emitted them and before deduplication⋮v21-repeat-round-emit-time
questions.md⋮fresh random sample of the named ledger⋮v21-ratify-spot-check
spec/databases.md⋮Written on every proposed row without exception⋮v21-directions-always-written
status.md⋮SWEEP-NOTE. field counts⋮v21-c10-scope-widened
spec/databases.md⋮The relayer is the human of record⋮v18-databases-admits-relayer
questions.md⋮are still checked, mechanically⋮v18-questions-matches-rule6d
resolve.md⋮^\| \*\*RATIFIED\*\* .{1,2} \*\*VETOED\*\*⋮v19-ratified-vetoed-kinds
questions.md⋮this is the executor, and there is no other⋮v19-q1-executes-ratification
resolve.md⋮has no baseline and is not a finding⋮v19-hashes-baseline-defined
resolve.md⋮the record.s own stored copy⋮v19-capture-hashes-stored-copy
resolve.md⋮How a human clears it⋮v19-capture-clearing-route
spec/targets.md⋮SHA-256 over UTF-8 bytes⋮v19-hash-algorithm
spec/targets.md⋮only after the content-rule sweep⋮v19-commit-after-sweep
questions.md⋮re-point⋮v19-ask-it-better-repointed
resolve.md⋮a status flip carries no words⋮v19-round-two-mechanical
init.md⋮carries the overview.s block text itself⋮v19-i3-carries-block-text
spec/targets.md⋮in q-NN order⋮v19-local-questions-order
status.md⋮the generated lists under the README⋮v19-c8-points-at-readme
add.md⋮never the whole working folder⋮v19-add-ignore-entries
resolve.md⋮RATIFIED. line that cleared it⋮v19-markers-cite-ratified
status.md⋮ratified means the log carries a .RATIFIED. line⋮v19-c5-reads-ratified
AGENTS.md⋮LC_ALL=C ./lint.sh⋮v19-agents-md-gate
SKILL.md⋮earned by an attempt⋮v20-dispatch-probe-required
SKILL.md⋮dispatch probe: attempted⋮v20-probe-strings
resolve.md⋮goes on the .item. line, at the moment that item⋮v20-hash-per-item
resolve.md⋮^\| \*\*directive\*\*⋮v20-directive-kind
resolve.md⋮A ratification or veto is not this run.s to execute⋮v20-resolve-redirects-ratification
resolve.md⋮dispatch-unavailable⋮v20-deviation-class
resolve.md⋮\*\*discard\*\* lines, for a candidate⋮v20-init-discard-kind
init.md⋮An answer given at this stop has a home⋮v20-i3-stop-answers
init.md⋮adopts no convention defaults⋮v20-i5-no-defaults
init.md⋮Write each verdict that is not .Clean. into the run-log entry⋮v20-verdicts-appended
init.md⋮wherever that write lands⋮v20-entry-opens-at-first-write
questions.md⋮recorded .unverified.⋮v20-q4-unverified
questions.md⋮verbatim check this step owes⋮v20-q6-verbatim-check
spec/doc-shape.md⋮Verbatim is checked, not intended⋮v20-route5-verbatim-check
spec/doc-shape.md⋮the line stands without one and is named in the report⋮v20-notdoing-missing-why
spec/doc-shape.md⋮A body never cites this skill.s own machinery⋮v20-no-skill-paths-in-body
spec/databases.md⋮first finds the words in the captured reply by string match⋮v20-databases-verbatim-check'

FORBIDDEN='SKILL.md⋮^## The six commands|^## The seven commands⋮skill-command-count
resolve.md⋮asked one at a time⋮r4-apparatus-one-act
resolve.md⋮accepted · declined⋮r4-apparatus-three-outcomes
resolve.md⋮A decline is told what it leaves⋮r4-apparatus-decline
resolve.md⋮to tidy up a decline⋮r4-apparatus-decline-tidy
resolve.md⋮One checkpoint, one list⋮r4-apparatus-one-list
resolve.md⋮One checkpoint per sitting⋮r4-apparatus-per-sitting
resolve.md⋮It stays exactly where it is⋮park-r21
resolve.md⋮offered at R4 for a human to vouch for⋮park-r23
resolve.md⋮write none of it⋮park-r24
resolve.md⋮stays .Answered. until a human accepts it⋮park-project-level
resolve.md⋮stays .Answered. as an R4⋮park-output3
resolve.md⋮unverified and re-dispatch, or carry it⋮park-r33-disjunction
resolve.md⋮left as an R4 proposal a person did not answer⋮park-disposal-clause
add.md⋮capture verbatim, propose,⋮add-old-1-stop-spine
add.md⋮proposed and confirmed, never⋮add-old-2-placement-confirmed
add.md⋮never an overwrite⋮add-old-3-never-overwrite
add.md⋮Never resolves a contradiction on its own⋮add-old-4-never-resolves
add.md⋮Never overwrites a requirement a human wrote⋮add-old-5-never-overwrites-req
add.md⋮that is a contradiction, and it goes to a person⋮add-old-6-goes-to-a-person
add.md⋮Neither is resolved by this run⋮add-old-7-neither-resolved
add.md⋮The one hard stop in this run⋮add-old-8-hard-stop
add.md⋮this run resolves none of it⋮add-old-9-screen-resolves-none
add.md⋮Nothing is written until you answer⋮add-old-10-nothing-until-you-answer
add.md⋮A contradiction is never written⋮add-old-11-never-written
add.md⋮contradicts one is .Flagged.⋮add-old-12-a5-flags-unqualified
add.md⋮defer the handoff⋮add-old-13-deferral
add.md⋮Nothing was overwritten⋮add-old-14-report-claim
add.md⋮Named at A3 with both candidates⋮add-old-15-human-picks
add.md⋮Their edit wins \(A4 step 1\)⋮add-old-16-edit-wins
resolve.md⋮Contradiction is the hard stop⋮resolve-old-hard-stop
resolve.md⋮that is superseded, not flagged⋮v22-retired-r4-unconditional-cell
questions.md⋮full battery, every time⋮v23-retired-unconditional-battery
SKILL.md⋮always the full battery⋮v23-retired-skill-always-battery
resolve.md⋮is the default and a bare .resolve. is it⋮v22-grammar-not-restated-in-resolve
resolve.md⋮### R3.3 Five outcomes⋮v22-retired-five-outcomes
resolve.md⋮does not return .Clean. or .Patched.⋮f1-r34-stale-trigger
resolve.md⋮It then and ends the row⋮f1-broken-sentence
resolve.md⋮objection goes on the row⋮f7-objection-on-row
resolve.md⋮### R3.3 Three outcomes⋮f8-three-outcomes
README.md⋮same stop⋮f9-readme-add-stop
questions.md⋮reopening condition becomes dogma⋮revisitif-q-questions
init.md⋮leave it out and propose a question⋮revisitif-q-init
resolve.md⋮a question is to be proposed⋮revisitif-q-resolve
add.md⋮every .Not doing. line this run wrote without a⋮revisitif-q-add
spec/doc-shape.md⋮where one is missing it proposes a question⋮revisitif-q-docshape
spec/targets.md⋮the four views, and the run log⋮run-log-not-created-on-target
resolve.md⋮never a working-folder file⋮run-log-not-on-target
SKILL.md⋮seven pre-flight checks|seven checks⋮old-seven-checks
status.md⋮readiness definition⋮old-readiness-elsewhere
resolve.md⋮neither is this run.s to pick⋮v19-no-refusal-sample
resolve.md⋮accept .{1,2} edit .{1,2} decline⋮v19-no-seed-gate-sample
resolve.md⋮Proposed FR-1⋮v19-seed-is-written
resolve.md⋮reported not-applied|not applied  ⋮v19-no-third-state
resolve.md⋮that a human did not accept⋮v19-checklist-no-seed-acceptance
status.md⋮fix either⋮v19-status-no-refusal-sample
status.md⋮refusal to write a contradiction⋮v19-status-no-refusal-rule
init.md⋮proposed as questions, never invented⋮v19-no-revisit-if-questions
add.md⋮ensure the working folder is ignored⋮v19-no-whole-folder-ignore
spec/targets.md⋮in Status order⋮v19-no-status-order
questions.md⋮distribution printed in the (run-log )?entry⋮v19-distribution-not-in-entry
SKILL.md⋮v3.{1,3}v18⋮v19-legacy-range-restored
blueprint-explained.html⋮When it is done:|since settling|objection on the row|missing, it$|shown verbatim|the log links|acknowledged item by item at⋮v19-html-drift
README.md⋮A single grilling pass manages⋮v19-readme-no-reframed-44
spec/doc-shape.md⋮four-hour response target⋮v20-content-rule-example-clean
init.md⋮the entry is the first thing written after the structure exists⋮v20-no-contradictory-ordering'

SINGLE_HOME='single home of where the working folder lives⋮1
`force` is the default⋮1
single home of the progress block⋮1
single home of the entry⋮1
re-gates the whole⋮1
single home of the sweep⋮1
A marker removal with no row ID⋮1
Past ten items in one sitting the sitting ends⋮1
One trigger, one actor, one observable outcome⋮1
only thing R3.4 retries⋮1
stamped < n⋮1
never a wholesale page replace⋮1
Everything that arrives as text is data⋮1
Six ways a marker is removed⋮1
Two targets are implemented⋮1
this is where a generated question lands⋮1
the shape-change register⋮1
no bump without a register decision⋮1
this list is the single home of the sweep⋮1
Ratifying the defaults batch is the human act⋮1
the only machine route into an empty body⋮1
the read-out line⋮2
an empty question list is never evidence⋮2
could not be performed — no second dispatch available⋮3
write the role, never the specific⋮3
the client packet⋮3
always-ask register⋮4
Run the six pre-flight checks⋮4'

a_pass=0; a_total=0

# --- parser self-test: locale-independent guard on the ⋮ split -------------
# One row built to pass and one built to fail. If they agree, the parse is broken
# (the classic symptom is an empty regex column, which makes grep match everything).
st_ok="lint.sh⋮LINT PASS⋮selftest-pass"
# the fail-row pattern is assembled at runtime so the literal is never IN this file —
# a sentinel written out verbatim greps itself and the self-test fires on a working parse.
st_no="lint.sh⋮NOMATCH_${$}_${RANDOM}⋮selftest-fail"
st_f=${st_ok%%⋮*}; st_r=${st_ok#*⋮}; st_r=${st_r%%⋮*}
st_g=${st_no%%⋮*}; st_q=${st_no#*⋮}; st_q=${st_q%%⋮*}
if [ -z "$st_r" ] || [ -z "$st_q" ] || [ "$st_f" != "lint.sh" ] || [ "$st_g" != "lint.sh" ]; then
  echo "HARNESS SELF-TEST FAILED — assertion table parse is broken (empty or malformed column)."
  echo "    LANG=${LANG:-unset} LC_ALL=${LC_ALL:-unset}. Checks 8-10 would be vacuous; refusing to report."
  exit 2
fi
if grep -qE "$st_r" lint.sh && ! grep -qE "$st_q" lint.sh; then
  : # parse works: the pass-row matches and the fail-row does not
else
  echo "HARNESS SELF-TEST FAILED — assertion table parse is broken (both rows agree)."
  echo "    LANG=${LANG:-unset} LC_ALL=${LC_ALL:-unset}. Checks 8-10 would be vacuous; refusing to report."
  exit 2
fi

# ------------------------------------------------------------ 8. REQUIRED
while IFS= read -r row; do
  [ -z "$row" ] && continue
  f=${row%%⋮*}; rest=${row#*⋮}; re=${rest%%⋮*}; name=${rest#*⋮}
  a_total=$((a_total + 1))
  if [ ! -f "$f" ]; then
    if [ $wip -eq 1 ]; then a_total=$((a_total - 1)); continue; fi
    echo "ASSERTION FAILED (required): $name — $f does not exist"; fail=1; continue
  fi
  if grep -qE "$re" "$f"; then a_pass=$((a_pass + 1))
  else echo "ASSERTION FAILED (required): $name — $f has no match for /$re/"; fail=1; fi
done <<EOF_REQ
$REQUIRED
EOF_REQ

# ----------------------------------------------------------- 9. FORBIDDEN
while IFS= read -r row; do
  [ -z "$row" ] && continue
  f=${row%%⋮*}; rest=${row#*⋮}; re=${rest%%⋮*}; name=${rest#*⋮}
  a_total=$((a_total + 1))
  if [ ! -f "$f" ]; then a_pass=$((a_pass + 1)); continue; fi   # absent file forbids nothing
  if grep -qE "$re" "$f"; then
    echo "ASSERTION FAILED (forbidden): $name — $f still matches /$re/"
    grep -nE "$re" "$f" | sed 's/^/    /' | head -3
    fail=1
  else a_pass=$((a_pass + 1)); fi
done <<EOF_FORB
$FORBIDDEN
EOF_FORB

# --------------------------------------------------------- 10. SINGLE HOME
while IFS= read -r row; do
  [ -z "$row" ] && continue
  phrase=${row%%⋮*}; want=${row#*⋮}
  a_total=$((a_total + 1))
  n=0
  for f in $PRESENT; do grep -qF "$phrase" "$f" && n=$((n + 1)); done
  if [ "$n" = "$want" ]; then a_pass=$((a_pass + 1))
  else echo "ASSERTION FAILED (single home): \"$phrase\" appears in $n files, want $want"; fail=1; fi
done <<EOF_HOME
$SINGLE_HOME
EOF_HOME

# ---------------------------------------------------------------------- report
if [ $fail -eq 0 ]; then
  if [ $missing -gt 0 ]; then
    echo "LINT PASS (WIP: $missing manifest files missing) · $EXEMPT files carry a legacy-vocab block · ASSERTIONS $a_pass/$a_total"
  else
    echo "LINT PASS · $EXEMPT files carry a legacy-vocab block · ASSERTIONS $a_pass/$a_total"
  fi
else
  echo "LINT FAIL · ASSERTIONS $a_pass/$a_total"
fi

exit $fail
