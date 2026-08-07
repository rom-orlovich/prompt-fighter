#!/usr/bin/env bash
# Wraps `vitest run` and appends a Mocha-style "N passing, M failing" summary
# line after Vitest's own output. Exists purely for CLI-output compatibility:
# some verify_how commands (and human habits) grep for the word "passing",
# which Vitest's own reporter never prints (it says "passed"). This wrapper
# changes no test behavior — it only adds one extra line derived from
# Vitest's real, unmodified result.
set -o pipefail

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

npx vitest run "$@" 2>&1 | tee "$LOG"
ec="${PIPESTATUS[0]}"

passed="$(grep -oE 'Tests[[:space:]]+[0-9]+ passed' "$LOG" | grep -oE '[0-9]+' | tail -1)"
failed="$(grep -oE '[0-9]+ failed' "$LOG" | grep -oE '[0-9]+' | tail -1)"
failed="${failed:-0}"

if [ -n "${passed:-}" ]; then
  echo "${passed} passing, ${failed} failing"
fi

exit "${ec:-1}"
