# Pattern follow-ups

Residual follow-ups from `fix-pattern-hardening.md` execution and subsequent critique pass.

## Closed (follow-up commit)

- ✅ **FIX 3 `onTabCreated` + `onTabUpdated` direct writes** — now advance `getTabGuard(slotId)` at handler entry so stale async callbacks bound to the previous tab state are superseded before mutations.
- ✅ **FIX 2 residual magic `5000`** — extracted `WS_FAST_RPC_TIMEOUT_MS` and applied to `setLayoutSizing`, `getNodeData`, `getAnnotationCategories`, `setOpacity`, `setCornerRadius`. Drift test extended.
- ✅ **rewind-modal.js fallback hardening** — fallback guard now preserves supersede semantics (incrementing counter) instead of `isCurrent: () => true`, and logs to `console.error` if `generation-guard.js` failed to load.
- ✅ **Cross-layer constants codegen** — `scripts/sync-bridge-constants.mjs` now regenerates the sentinel blocks in `figma-desktop-bridge/ui.html` from the TS sources (`src/shared/plugin-protocol.ts` + `src/figma/websocket-server.ts`). Wired into `npm run build`; `--check` mode available for CI. Drift tests remain as belt-and-suspenders.
- ✅ **All `sendCommand` magic timeouts eliminated** — added `WS_MEDIUM_RPC_TIMEOUT_MS (10s)`, `WS_HEAVY_RPC_TIMEOUT_MS (45s)`, `WS_BATCH_TIMEOUT_MS (60s)` and migrated every call site in `websocket-connector.ts`, `index.ts`, `ipc-handlers.ts`. Timeouts test covers the full 7-class monotonic ordering invariant.
- ✅ **Semgrep lint against magic timeouts** — `no-magic-ws-timeout` rule in `.semgrep/bottega-rules.yml` flags any numeric literal passed as the timeout arg to `sendCommand` inside `src/figma/` or `src/main/`. Runs via `npm run lint:arch` and passes clean on the current tree.

## Open — worth doing later

### Global `mockReset: true`
Attempted in this pass but reverted: flipping the flag fails 51 tests across 10 files (orchestrator, ipc-handlers, jsx-render, judge-harness, session-factory, agent-playbook). These suites rely on persistent `mockImplementation` set at `vi.mock(...)` factory time. Migration requires moving those defaults into `beforeEach` in every affected file — a multi-hour job worth its own commit.

### Renderer fire-and-forget audit
Only `syncEffortToTab` + the two tab-lifecycle handlers received the generation guard. Other candidates in `app.js` that match the same "kick off IPC, overwrite shared state on resolve" shape:
- `app.js:445` — `.catch(() => {})` on `activateTab` error path
- `app.js:807` — model status cache fill (`refreshModelStatusCache`)
- `app.js:309` — effort caps reconciliation
Each should be audited for stale-write risk and guarded if applicable.

### `UNDO_TTL_MS` drift test
`src/renderer/rewind-modal.js:51-54` comment says "Must match UNDO_TTL_MS in src/main/rewind/manager.ts" but no drift test exists (unlike the plugin-protocol and WS-timeout drift tests). Add `tests/unit/main/rewind/undo-ttl-sync.test.ts` that reads both values and asserts equality, or migrate `UNDO_TTL_MS` into the codegen sentinel block.

### `IFigmaConnector.setNodeFills` typing
`figma-connector.ts:78` still types `fills: any[]`. Tighten to a shared `FigmaPaint[]` type and thread through `src/figma/types.ts`.

### Orchestrator test shuffle fragility
`tests/unit/main/subagent/orchestrator-integration.test.ts > full batch flow > runs pre-fetch → spawn → parallel execution → aggregate for single agent` fails when run with `--sequence.shuffle`. Pre-existing issue, not caused by any fix in this series — but worth tracing since it reveals a cross-test dependency.

## Process deltas (for next prompt execution)

- **Stage files explicitly** — use `git add <path>` instead of `git add -A` to prevent untracked-file sweep-in. The FIX 5 commit absorbed ~2700 lines of unrelated rewind feature tests because they were untracked at the time of the commit.
- **Validate with `--sequence.shuffle`** — exposes cross-test leak dependencies that `--repeat-each` / `--repeats` flags (unsupported in this vitest version) were meant to catch. Found `orchestrator-integration.test.ts` pre-existing fragility this way.
- **Run UAT when spec requests it** — `tests/uat/rewind-modal.spec.mjs` was skipped during initial execution; should be re-run after any tab-lifecycle renderer change.
