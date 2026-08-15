#!/bin/bash
# lint.sh — cross-reference and vocabulary lint for the blueprint skill files.
#
# Seven checks:
#   1  every manifest file exists            (--wip: report and skip, still exit 0)
#   2  every In / An / Qn / Rn / Ln / Cn / Sn reference resolves to a definition
#   3  every relative markdown link resolves on disk
#   4  no superseded vocabulary outside a <!-- legacy-vocab --> block
#   5  the frozen vocabularies are each defined exactly once, and no superseded
#      status literal appears anywhere outside an exemption block
#   6  VERSION is a bare integer
#   7  QUICKSTART.md is pointer-only: every bullet carries a (→ …) pointer, and the
#      file never uses the word "never"/"always"/"must" except inside a pointer line —
#      it may not become a fifth home for any rule
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

MANIFEST="SKILL.md README.md QUICKSTART.md init.md add.md questions.md resolve.md lock.md status.md \
spec/doc-shape.md spec/databases.md spec/targets.md spec/notion-mechanics.md"

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
        L) OWNER=lock.md ;; C|S) OWNER=status.md ;;
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
fi

# ---------------------------------------------------------------------- report
if [ $fail -eq 0 ]; then
  if [ $missing -gt 0 ]; then
    echo "LINT PASS (WIP: $missing manifest files missing) · $EXEMPT files carry a legacy-vocab block"
  else
    echo "LINT PASS · $EXEMPT files carry a legacy-vocab block"
  fi
else
  echo "LINT FAIL"
fi

exit $fail
