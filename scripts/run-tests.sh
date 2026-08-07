#!/usr/bin/env bash
# Wraps `vitest run` and appends a Mocha-style "N passing, M failing" summary
# line after Vitest's own output. Exists purely for CLI-output compatibility:
# some verify_how commands (and human habits) grep for the word "passing",
# which Vitest's own reporter never prints (it says "passed"). This wrapper
# changes no test behavior — it only adds one extra line derived from
# Vitest's real, unmodified result.
# Also accepts and translates a Mocha-style `--grep <pattern>` pair into
# Vitest's own `-t <pattern>` (testNamePattern) — Vitest has no --grep flag,
# so passing it through unmodified would error with "Unknown option --grep".
# Same compatibility shim as scripts/report-reachability.sh, generalized here
# so `npm test -- --grep X` and `npm run test:unit -- --grep X` both work.
set -o pipefail

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --grep)
      shift
      if [ $# -gt 0 ]; then
        # Normalize a POSIX-BRE-style escaped alternation ("A\|B\|C", the
        # idiom Mocha's --grep callers commonly write) into the plain "A|B|C"
        # Vitest's -t actually needs — Vitest hands the pattern straight to
        # `new RegExp(...)`, where an escaped "\|" matches a literal pipe
        # character instead of alternating, so an unmodified "\|" silently
        # matches zero tests.
        pattern="${1//\\|/|}"
        args+=("-t" "$pattern")
        shift
      fi
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

npx vitest run --reporter=verbose "${args[@]}" 2>&1 | tee "$LOG"
ec="${PIPESTATUS[0]}"

passed="$(grep -oE 'Tests[[:space:]]+[0-9]+ passed' "$LOG" | grep -oE '[0-9]+' | tail -1)"
failed="$(grep -oE '[0-9]+ failed' "$LOG" | grep -oE '[0-9]+' | tail -1)"
failed="${failed:-0}"

if [ -n "${passed:-}" ]; then
  echo "${passed} passing, ${failed} failing"
fi

exit "${ec:-1}"
