# Mock-audit findings — error-path coverage gaps

Output of the audit phase from `fix-mock-factories-hardening.md`. Enumerates
non-trivial error branches in production code that lack dedicated regression
tests, and suggests a test recipe per row.

Scope: transport / REST / WS / retry / rewind / config-invalid paths.
Trivial argument guards are excluded.

Last scan: 2026-04-22.

---

## Area 1 — WebSocket server (`src/figma/websocket-server.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| websocket-server.ts:174 | `wss.on('error')` post-listen runtime error | OS revokes port or socket closes mid-run; Bridge silently disconnects | High | Emit synthetic `error` on started `wss`; assert log + outer `start()` not rejected | No |
| websocket-server.ts:183 | Pending-client identification timeout (`WS_STALL_DETECTION_MS`) | Plugin connects but never sends `FILE_INFO`; hangs silently | Med | Fake-timer advance 30 001 ms on raw WS; assert close(1000) + `_pendingClients` cleared | No |
| websocket-server.ts:538 | `sendCommand` when `ws.readyState !== OPEN` (e.g. `CLOSING`) | Agent fires tool while Bridge tab reloads; cryptic `EINVAL` | High | Force `ws.readyState = CLOSING`; assert reject "No WebSocket client connected" | No |
| websocket-server.ts:568 | `client.ws.send()` throws synchronously | Tool call lost; pending request leaks | High | Spy `send` to throw; assert reject + no leaked pending request map entry | No |
| websocket-server.ts:501 | Grace-period timer → `activeFileKey` falls back to next OPEN client | User has 2 Figma files; first closes — wrong file becomes active | Med | Connect two clients; close first; advance 5 001 ms; assert `getActiveFileKey()` = second | No |
| websocket-server.ts:281 | `DOCUMENT_CHANGE` before `FILE_INFO` (client still pending) | Plugin emits change before handshake; event silently dropped | Low | Send `DOCUMENT_CHANGE` from unidentified client; assert `documentChange` fired with `fileKey: null` | No |

## Area 2 — WebSocket connector (`src/figma/websocket-connector.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| websocket-connector.ts:33 | `initialize()` throws when no client connected | Session starts while Bridge closed | Med | `isClientConnected() === false`; assert rejection message | Partial |
| websocket-connector.ts:90 | `executeCodeViaUI` unwraps `raw.result` when relay wraps response | Plugin response shape drifts; silent `undefined` return | Med | Mock `sendCommand` → `{ success: true }` (no `result`); assert raw wrapper returned, not `undefined` | No |

## Area 3 — Figma REST API (`src/figma/figma-api.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| figma-api.ts:139 | `validateToken` 10 s abort timeout | User on flaky network; UI appears frozen | High | `fetch` hangs; advance 10 001 ms; assert `{ ok: false, error }` within budget | No |
| figma-api.ts:149 | `validateToken`: `response.text()` throws on non-2xx | Figma returns broken response body | Low | `response.ok = false`, `text()` rejects; assert `{ ok: false, error }` | No |
| figma-api.ts:246 | 403 without `"Invalid token"` body — counter NOT incremented | File-level permission error should not disable global client | Med | 3× 403 with "Forbidden" body; assert `apiDisabled === false` | Yes (`figma-api-retry.test.ts:236`) |
| figma-api.ts:177 | `apiDisabled === true` fast-fail path | After 3 invalid-token 403s, next call must fail without `fetch` | High | Exhaust retries; assert no `fetch` call on next `getFile` | Yes |
| figma-api.ts:483 | `getAllVariables`: both local+published reject simultaneously | Network error; agent calls get-variables | Med | Both reject; assert result has `localError` + `publishedError` + empty stubs | No |
| figma-api.ts:302 | `getBranchKey` swallows `getFile` rejection → returns original key | User opens branch URL; REST fails; agent hits main file | Med | `getFile` rejects; assert returned key == input `fileKey` | No |

## Area 4 — Rewind manager (`src/main/rewind/manager.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| rewind/manager.ts:144 | `onSessionStart`: `probeNodeId === null` (no `currentPageId`) | Plugin connects before current page reported; rewind silently disabled | High | `getConnectedFiles()` → `{ currentPageId: undefined }`; assert `disable()` + metric `recordRewindPluginProbeFailed` | No |
| rewind/manager.ts:152 | `onSessionStart`: `getNodeData` times out (`PROBE_TIMEOUT_MS`) | Plugin too slow first time; rewind disabled all session | High | Timing-out connector; advance past timeout; assert `disable()` | No |
| rewind/manager.ts:231 | `onAgentEnd`: `store.append` throws | Disk full / perms; silent checkpoint loss | Med | `store.append` throws; assert warn logged, no uncaught rejection | No |
| rewind/manager.ts:307 | `restoreCheckpoint` outer catch for unexpected errors | Queue/connector unexpected throw during restore | Med | `resolveConnector` throws; assert `failedRestore` result | No |
| rewind/manager.ts:343 | `undoRestore`: `applyCheckpoint` throws | Undo fails mid-way; partially-undone state | Med | Connector throws in `applyCheckpoint`; assert `failedRestore` + warn | No |

## Area 5 — Rewind restore (`src/main/rewind/restore.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| rewind/restore.ts:25 | `executeTouched === true` short-circuit | Checkpoint had `figma_execute`; immediate failure | Med | Covered | Yes |
| rewind/restore.ts:77 | `queue.execute` rejects → counted as `inverse-failed` | Mid-restore queue shutdown | High | Failing queue; assert `skipReasons['inverse-failed']` and no outer throw | No |
| rewind/restore.ts:52 | `inverse-op` + `skipReason` set → skip path | Node gone from doc; mutation silently skipped | Med | `capturePreState` returns `{ kind: 'inverse-op', skipReason: 'node-gone' }`; assert counter + reason | Partial |
| rewind/restore.ts:57 | `dispatchInverse` returns `null` → `inverse-unavailable` | Tool has no inverse registered | Med | Snapshot with `tool: 'figma_clone'`; assert `skipReasons['inverse-unavailable']` | No |

## Area 6 — Slot manager (`src/main/slot-manager.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| slot-manager.ts:119 | `switchSession` fails → falls back to `newSession` | Persisted session corrupt; slot created fresh | Med | Covered | Yes |
| slot-manager.ts:385 | `restoreFromDisk` inner catch: one slot's `createSlot` throws → skip | One saved file bad; rest should still restore | Med | `createFigmaAgentRuntimeForSlot` throws on 2nd call; assert 1 restored, no uncaught | No |
| slot-manager.ts:327 | `priorRuntime.dispose()` rejects → swallowed | Silent resource leak on model switch | Low | `dispose` rejects; assert warn + new `modelConfig` applied | No |

## Area 7 — Compression extension factory (`src/main/compression/extension-factory.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| extension-factory.ts:70 | Outer catch swallows any compression error | Agent silently gets uncompressed result; context spikes | Med | `compressMutationResult` throws; fire `tool_result`; assert handler returns `null` | No |
| extension-factory.ts:37 | `compressMutationResults === false` path (minimal) | User on Minimal profile mid-session | Low | Switch to minimal; fire `tool_result` for mutation; assert no-op return | Partial |

## Area 8 — Compression config (`src/main/compression/compression-config.ts`)

| file:line | Branch | User-visible scenario | Priority | Test suggestion | Existing? |
|---|---|---|---|---|---|
| compression-config.ts:132 | `setProfile` throws on invalid profile | Renderer IPC sends tampered/unknown profile | Med | Covered | Yes |

---

## Totals

- 26 branches surveyed
- 5 already covered
- **21 uncovered** → candidates for commits 3/4/5

## Priority distribution of uncovered rows

- **High (7)**: WS post-listen error, `sendCommand` non-OPEN, `send()` throws, `validateToken` timeout, `apiDisabled` fast-fail (already covered — recount 6), rewind probe null, rewind probe timeout, restore queue rejection
- **Med (11)**: WS stall, active-file fallback, connector `initialize()` no-client, `executeCodeViaUI` unwrap drift, `getAllVariables` both-reject, `getBranchKey` swallow, rewind append throw, restore outer catch, undo rethrow, slot restoreFromDisk partial, compression extension outer catch
- **Low (4)**: `DOCUMENT_CHANGE` pre-handshake, `validateToken` text throw, `priorRuntime.dispose` swallow, minimal no-op path

## Notes on in-flight bugs

No obvious NPE/infinite-retry/silent-swallow smoking guns surfaced during the
scan. The "silent disable" paths in rewind (`manager.ts:144`, `152`) and the
"swallow and continue" patterns in `figma-api.ts:302` and
`extension-factory.ts:70` are **intentional fallbacks** — but they warrant
tests that document the observable behavior, and potentially surface metrics
to detect them in production. No code changes in this session per scope.
