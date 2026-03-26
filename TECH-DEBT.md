# Tech Debt & Larger Refactors

Tracked items identified during the multi-tab refactor session (2026-03-26).
These require deeper design changes and are deferred to dedicated passes.

## K. SessionSlot encapsulation

IPC handlers directly mutate `slot.isStreaming`, `slot.thinkingLevel`, `slot.modelConfig`,
and `slot.suggester`, bypassing SlotManager. This breaks encapsulation — SlotManager's
invariants (fileKeyIndex, _recreateLocks) can be silently circumvented.

**Fix**: Move mutation methods onto SlotManager (e.g., `setStreaming(slotId, v)`) or make
SessionSlot an opaque class with controlled setters.

**Files**: `src/main/ipc-handlers.ts`, `src/main/slot-manager.ts`

## L. AppState version migration

`AppState.version` is written as `1` and read back, but `load()` only checks
`typeof parsed.version !== 'number'`. Any future schema change will silently
load stale data because there is no version comparison or migration path.

**Fix**: Add `if (parsed.version !== CURRENT_VERSION)` check in `load()` and
either migrate or discard. Document what version 1 guarantees.

**Files**: `src/main/app-state-persistence.ts`

## N. Shared DTO types (SlotInfoDTO / QueuedPromptDTO)

`SlotInfoDTO` in `preload.ts` manually mirrors `SlotInfo` from `slot-manager.ts`,
and `QueuedPromptDTO` mirrors `QueuedPrompt`. Both are maintained independently
with no compile-time enforcement across the contextBridge IPC boundary.

**Fix**: Create `src/shared/types.ts` with the DTO interfaces, imported by both
`slot-manager.ts` and `preload.ts`. Since preload is CJS, the shared file would
also need CJS bundling (already handled by the build).

**Files**: `src/main/preload.ts`, `src/main/slot-manager.ts`

## Q. Dead listener accumulation on model switch

Pi SDK's `subscribe()` has no `unsubscribe()` API. When a model switch replaces
`slot.session`, the old session's listener becomes a no-op via the stale-event
guard, but the closure is never released until the old AgentSession is GC'd.
Bounded by MAX_SLOTS * model_switches_per_session.

**Fix**: Requires Pi SDK to expose an unsubscribe mechanism, or an intermediary
EventEmitter on the slot that can be cheaply re-wired.

**Files**: `src/main/ipc-handlers.ts` (subscribeToSlot)
