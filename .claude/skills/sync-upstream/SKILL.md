---
name: sync-upstream
description: Sync src/figma/ and figma-desktop-bridge/ with their upstream repository (figma-console-mcp). Checks for new commits, diffs changes, applies patches, and updates UPSTREAM.md. Use when the user asks to "sync upstream", "check upstream", "update figma core", or "pull upstream changes".
disable-model-invocation: true
---

# Sync Upstream

Synchronize embedded/forked code with upstream repositories.

> **Note**: Historically the plugin also imported handlers from `dannote/figma-use` (CREATE_FROM_JSX, CREATE_ICON, BIND_VARIABLE). That fork is **no longer monitored** — handlers are now maintained locally as Bottega-specific additions. Do not confuse `figma-use` (legacy repo name) with Figma's `use_figma` API/tool.

## Upstream Sources

| Local Path | Upstream Repo | Tracking File |
|-----------|---------------|---------------|
| `src/figma/` | [southleft/figma-console-mcp](https://github.com/southleft/figma-console-mcp) | `src/figma/UPSTREAM.md` |
| `figma-desktop-bridge/` | [southleft/figma-console-mcp](https://github.com/southleft/figma-console-mcp) (plugin) | `figma-desktop-bridge/UPSTREAM.md` |

## Workflow

### Step 1: Read Current State

Read both UPSTREAM.md files to get the currently tracked commits:
- `src/figma/UPSTREAM.md` — pinned commit for the core library
- `figma-desktop-bridge/UPSTREAM.md` — pinned commit for the figma-console-mcp plugin

### Step 2: Check for New Upstream Commits

For each upstream repo, check what changed since the pinned commit:

```bash
# figma-console-mcp — check for new commits
gh api repos/southleft/figma-console-mcp/commits?per_page=10 --jq '.[].sha[:7] + " " + (.commit.message | split("\n")[0])'
```

Compare the latest commit with the pinned commit in UPSTREAM.md. If they match, report "already up to date" and stop.

### Step 3: Diff Upstream Changes

For each upstream with new commits, fetch and diff the relevant files:

**For src/figma/ (figma-console-mcp core):**
```bash
# Clone upstream to a temp dir and diff relevant files
PINNED_COMMIT=$(grep -oP 'Commit: \K\w+' src/figma/UPSTREAM.md)
TMPDIR=$(mktemp -d)
git clone --depth=50 https://github.com/southleft/figma-console-mcp.git "$TMPDIR/upstream"
cd "$TMPDIR/upstream"

# Diff between pinned commit and HEAD for the files we track
git diff $PINNED_COMMIT..HEAD -- src/websocket-server.ts src/websocket-connector.ts src/figma-connector.ts src/figma-api.ts src/port-discovery.ts src/logger.ts src/config.ts src/types.ts
```

**For figma-desktop-bridge/ (plugin):**
```bash
# Diff plugin files
git diff $PINNED_COMMIT..HEAD -- figma-plugin/code.js figma-plugin/ui.html figma-plugin/manifest.json
```

### Step 4: Present Changes for Review

Show the user:
1. **Summary**: Number of new commits, notable changes (breaking changes, new features, bug fixes)
2. **Diff**: The actual changes that would need to be ported
3. **Conflict risk**: Flag any upstream changes that touch code we've modified locally (the "Modifications" section in UPSTREAM.md)

Ask the user which changes to apply before proceeding.

### Step 5: Apply Changes

For each approved change:
1. Apply the upstream diff to our local files
2. Resolve any conflicts with our local modifications
3. Preserve our custom additions (cloud relay removal, figma-use handlers, etc.)
4. Build and type-check: `npm run build && npx tsc --noEmit`
5. Run related tests: `npm test`

### Step 6: Update UPSTREAM.md

Update both tracking files with:
- New pinned commit hash and version/date
- Updated "Modifications" section if our local changes evolved
- Any new files added from upstream

### Step 7: Verify

1. `npm run build` — esbuild succeeds
2. `npx tsc --noEmit` — no type errors
3. `npm test` — all tests pass
4. Summarize what was synced and what was skipped

## Important Rules

- **NEVER overwrite local modifications blindly.** Our code has intentional divergences (cloud relay removed, figma-use handlers added). Always diff and merge carefully.
- **The PreToolUse hook blocks direct edits to `figma-desktop-bridge/`.** This is intentional — the skill workflow should use this as a safety net, not bypass it. If the hook blocks, it means you're editing upstream-tracked files, which is the correct behavior for a sync operation. Ask the user to temporarily allow the edit.
- **Build after every file change.** The PostToolUse hooks will run tsc and esbuild automatically, but watch for errors.
- **Commit separately.** Upstream syncs should be their own commit with a clear message like `chore: sync figma-console-mcp upstream to <commit>`.
