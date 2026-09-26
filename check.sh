#!/bin/sh
# check.sh — every gate this skill has, in one command (AGENTS.md). Exits non-zero on the first failure.
set -e
cd "$(dirname "$0")"
./lint.sh
LC_ALL=C ./lint.sh
cd bp
[ -d node_modules ] || npm ci --silent
npm run --silent typecheck
npm run --silent lint
npm run --silent format:check
npm test --silent
echo "CHECK PASS"
