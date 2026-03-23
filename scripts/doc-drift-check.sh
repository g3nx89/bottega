#!/usr/bin/env bash
# doc-drift-check.sh — Stop hook that detects documentation drift.
# Checks git diff for changed files and emits targeted reminders
# about CLAUDE.md, system-prompt.ts, and skills that may need updating.
#
# Exit 0 always (advisory, never blocks).

set -euo pipefail

CHANGED=$(git diff --name-only 2>/dev/null || true)
[ -z "$CHANGED" ] && exit 0

HINTS=""

# ── Tools changed → CLAUDE.md tool count, system-prompt.ts, skills ──
TOOL_CHANGES=$(echo "$CHANGED" | grep -c '^src/main/tools/' || true)
if [ "$TOOL_CHANGES" -gt 0 ]; then
  ACTUAL=$(grep -r "name: 'figma_" src/main/tools/ 2>/dev/null | wc -l | tr -d ' ')
  DOCUMENTED=$(sed -n 's/.*Tool Categories (\([0-9]*\) tools).*/\1/p' CLAUDE.md 2>/dev/null)
  DOCUMENTED=${DOCUMENTED:-"?"}
  if [ "$ACTUAL" != "$DOCUMENTED" ]; then
    HINTS="${HINTS}\n⚠️  Tool count mismatch: ${ACTUAL} actual vs ${DOCUMENTED} in CLAUDE.md"
    HINTS="${HINTS}\n   → Update: CLAUDE.md (tool count + categories), system-prompt.ts (tool tables)"
    HINTS="${HINTS}\n   → Update skills: figma-cowork-tools, add-tool (tool file listings)"
  fi
fi

# ── New files in src/main/ → CLAUDE.md architecture tree ──
NEW_MAIN=$(echo "$CHANGED" | grep '^src/main/[^/]*\.ts$' | while read -r f; do
  git diff --diff-filter=A --name-only -- "$f" 2>/dev/null
done || true)
if [ -n "$NEW_MAIN" ]; then
  HINTS="${HINTS}\n⚠️  New main process files added — update CLAUDE.md architecture tree"
  HINTS="${HINTS}\n   → Also update: figma-cowork-architecture skill"
fi

# ── system-prompt.ts changed → skills may reference stale info ──
if echo "$CHANGED" | grep -q '^src/main/system-prompt\.ts$'; then
  HINTS="${HINTS}\n⚠️  system-prompt.ts modified — verify skills still match"
  HINTS="${HINTS}\n   → Check: figma-cowork-tools (promptSnippet docs), figma-cowork-architecture (section 6)"
fi

# ── Compression or image-gen changed → CLAUDE.md patterns ──
if echo "$CHANGED" | grep -q '^src/main/compression/'; then
  HINTS="${HINTS}\n⚠️  Compression modules changed — check CLAUDE.md 'Important Patterns' section"
fi
if echo "$CHANGED" | grep -q '^src/main/image-gen/'; then
  HINTS="${HINTS}\n⚠️  Image-gen modules changed — check CLAUDE.md 'Important Patterns' and 'Key Dependencies'"
fi

# ── Upstream-tracked files changed → UPSTREAM.md ──
if echo "$CHANGED" | grep -q '^src/figma/'; then
  HINTS="${HINTS}\n⚠️  src/figma/ modified — update src/figma/UPSTREAM.md if this diverges from upstream"
fi

# ── Test files added → testing skill tree ──
NEW_TESTS=$(echo "$CHANGED" | grep '^tests/.*\.test\.' | while read -r f; do
  git diff --diff-filter=A --name-only -- "$f" 2>/dev/null
done || true)
if [ -n "$NEW_TESTS" ]; then
  HINTS="${HINTS}\n⚠️  New test files added — update figma-cowork-testing skill test tree"
fi

# ── Output ──
if [ -n "$HINTS" ]; then
  echo ""
  echo "📋 Documentation drift check:"
  echo -e "$HINTS"
  echo ""
fi

exit 0
