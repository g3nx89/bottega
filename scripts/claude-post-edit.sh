#!/usr/bin/env bash
# Consolidated PostToolUse hook — runs typecheck, biome, build in parallel,
# then related tests sequentially. Replaces 4 separate hooks for ~3x speedup.
set -uo pipefail

FILE=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4 2>/dev/null)
if [ -z "$FILE" ]; then
  # Fallback: try extracting from new_string/content patterns
  FILE=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"file_path": *"[^"]*"' | cut -d'"' -f4 2>/dev/null)
fi
[ -z "$FILE" ] && exit 0

BASE=$(basename "$FILE" .ts)

# --- Parallel: typecheck + biome + build ---
TSC_OUT=$(mktemp)
BIOME_OUT=$(mktemp)
BUILD_OUT=$(mktemp)

npx tsc --noEmit 2>&1 | head -20 > "$TSC_OUT" &
PID_TSC=$!

npx biome check --write "$FILE" 2>&1 | tail -5 > "$BIOME_OUT" &
PID_BIOME=$!

node scripts/build.mjs 2>&1 | tail -5 > "$BUILD_OUT" &
PID_BUILD=$!

wait $PID_TSC $PID_BIOME $PID_BUILD

# Output results
TSC_CONTENT=$(cat "$TSC_OUT")
BIOME_CONTENT=$(cat "$BIOME_OUT")
BUILD_CONTENT=$(cat "$BUILD_OUT")
rm -f "$TSC_OUT" "$BIOME_OUT" "$BUILD_OUT"

[ -n "$TSC_CONTENT" ] && echo "=== typecheck ===" && echo "$TSC_CONTENT"
[ -n "$BIOME_CONTENT" ] && echo "=== biome ===" && echo "$BIOME_CONTENT"
[ -n "$BUILD_CONTENT" ] && echo "=== build ===" && echo "$BUILD_CONTENT"

# --- Sequential: related tests (only if test file exists) ---
TESTS=$(find tests -name "*${BASE}*test.ts" -o -name "*${BASE}*.test.ts" 2>/dev/null | head -3)
if [ -n "$TESTS" ]; then
  echo "=== tests ==="
  npx vitest run --reporter=verbose $TESTS 2>&1 | tail -20
fi

exit 0
