#!/usr/bin/env bash
# Runs the PARRY-reachability report test (tests/reachability-report.test.ts).
# Accepts and discards an optional `--grep <pattern>` pair for CLI
# compatibility with `npm run test:reachability -- --grep PARRY` — Vitest's
# CLI has no Mocha-style --grep flag, and this report only ever targets PARRY
# reachability anyway, so the pattern value itself is informational only.
set -euo pipefail

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --grep)
      shift
      [ $# -gt 0 ] && shift
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done

npx vitest run tests/reachability-report.test.ts --reporter=verbose "${args[@]}"
