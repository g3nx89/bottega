# Pattern follow-ups

Residual follow-ups from `fix-pattern-hardening.md` execution and subsequent critique pass.

## Closed (follow-up commit)

- ✅ **FIX 3 `onTabCreated` + `onTabUpdated` direct writes** — now advance `getTabGuard(slotId)` at handler entry so stale async callbacks bound to the previous tab state are superseded before mutations.
- ✅ **FIX 2 residual magic `5000`** — extracted `WS_FAST_RPC_TIMEOUT_MS` and applied to `setLayoutSizing`, `getNodeData`, `getAnnotationCategories`, `setOpacity`, `setCornerRadius`. Drift test extended.
- ✅ **rewind-modal.js fallback hardening** — fallback guard now preserves supersede semantics (incrementing counter) instead of `isCurrent: () => true`, and logs to `console.error` if `generation-guard.js` failed to load.

## Open — worth doing later

### Cross-layer constants: build-time single source of truth
Drift tests catch divergence at test time; they don't prevent it. The infrastructure for esbuild `define` is already in `scripts/build.mjs` (used for `__APP_VERSION__`, `BOTTEGA_AGENT_TEST`). A follow-up can pipe `figma-desktop-bridge/ui.html` through a codegen step that injects `PLUGIN_PROTOCOL_VERSION` and the four `WS_*_TIMEOUT_MS` values from the shared module — eliminating the hand-mirrored block in `ui.html` and the drift tests becoming belt-and-suspenders.

### Global `mockReset: true`
FIX 5 applied `.mockReset().mock*Value(default)` pattern in 3 test files. The same anti-pattern exists in ~20 other test files using `vi.clearAllMocks()` on module-scoped spies. Root-cause fix: flip `mockReset: true` in `vitest.config.ts`. Will expose suites that relied on persistent `mockImplementation` across cases — migrate those to set defaults in each `beforeEach`.

### Renderer fire-and-forget audit
Only `syncEffortToTab` received the generation guard directly. Other candidates in `app.js` that match the same "kick off IPC, overwrite shared state on resolve" shape:
- `app.js:445` — `.catch(() => {})` on `activateTab` error path
- `app.js:807` — model status cache fill (`refreshModelStatusCache`)
- `app.js:309` — effort caps reconciliation
Each should be audited for stale-write risk and guarded if applicable.

### `UNDO_TTL_MS` drift test
`src/renderer/rewind-modal.js:51-54` comment says "Must match UNDO_TTL_MS in src/main/rewind/manager.ts" but no drift test exists (unlike the plugin-protocol and WS-timeout drift tests). Add `tests/unit/main/rewind/undo-ttl-sync.test.ts` that reads both values and asserts equality.

### Semgrep lint against magic timeouts
Add a semgrep rule:
```yaml
pattern: $SERVER.sendCommand($METHOD, $PARAMS, $LITERAL)
where:
  - metavariable-regex:
      metavariable: $LITERAL
      regex: '^\d+$'
message: Use a WS_*_TIMEOUT_MS constant from websocket-server.ts
```
Prevents future re-introduction of magic numbers at `sendCommand` call sites.

### `IFigmaConnector.setNodeFills` typing
`figma-connector.ts:78` still types `fills: any[]`. Tighten to a shared `FigmaPaint[]` type and thread through `src/figma/types.ts`.

## Process deltas (for next prompt execution)

- **Stage files explicitly** — use `git add <path>` instead of `git add -A` to prevent untracked-file sweep-in. The FIX 5 commit absorbed ~2700 lines of unrelated rewind feature tests because they were untracked at the time of the commit.
- **Validate with `--sequence.shuffle`** — exposes cross-test leak dependencies that `--repeat-each` / `--repeats` flags (unsupported in this vitest version) were meant to catch. Found `orchestrator-integration.test.ts` pre-existing fragility this way.
- **Run UAT when spec requests it** — `tests/uat/rewind-modal.spec.mjs` was skipped during initial execution; should be re-run after any tab-lifecycle renderer change.
