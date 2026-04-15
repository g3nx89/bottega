# Auth & Model Handling — Implementation Plan

**Status**: draft · **Target version**: 0.14.1 (Sprint A hotfix) → 0.15.0 (Sprint B+C+D)
**Owner**: TBD · **Last updated**: 2026-04-14

## Problem statement

Three distinct failure modes observed in production telemetry (user `BTG-33F4-A89B`):

1. `gpt-5.4-mini` (sdkProvider=`openai`) → renderer shows *"No credentials configured"* because user has `auth.openai.type=none` (no API key) but UI groups `openai` API-key and `openai-codex` OAuth under a single account card.
2. `gpt-5.3-codex` (sdkProvider=`openai-codex`) → server returns empty stream (0 tokens, ~1s latency, no error logged). After logout+login the same empty-stream pattern persists. Renderer shows *"credentials expired"* via a generic fallback.
3. `claude-sonnet-4-6` (sdkProvider=`anthropic`) → server returns empty stream silently. Zero diagnostics. Same OAuth works for 100 turns on dev account → likely account-tier gating.

Secondary issue: Figma PAT `safeStorage.decryptString()` fails after version upgrade (`figma-auth-store.ts:67`) and the token is silently treated as absent.

Root failure: **Pi SDK stream errors are swallowed**. `src/main/session-events.ts:444` detects empty-turn and pushes `MSG_EMPTY_TURN_WARNING` but does not capture HTTP status, error body, provider, or modelId. No `usage:llm_stream_error` event exists. Diagnosis requires guessing.

## Guiding principles

1. **Observability first** — instrument every error path before changing UX. Sprint A is strictly prerequisite.
2. **No silent failures** — every auth/model failure surfaces an actionable error to the user AND a structured log event to Axiom.
3. **Migration safety** — every change to persistence layers ships with a backward-compatible read path. Breaking users on upgrade is worse than the bug we fix.
4. **Progressive disclosure** — renderer changes disambiguate without overwhelming. Existing users keep their mental model; new information slots in.
5. **Every fix ships with tests** — unit + playbook (if it touches agent flow) + e2e (if it touches UI). No exceptions.

## Shared contracts

### New event names (usage-tracker additions)

| Event | Payload | Emit site |
|---|---|---|
| `usage:llm_stream_error` | `{provider, modelId, httpStatus?, errorCode?, errorBody?, durationMs, promptId, slotId}` | agent stream wrapper |
| `usage:empty_response` | `{provider, modelId, reason: 'suspected_auth'\|'unknown', durationMs, promptId, slotId}` | session-events handleAgentEnd |
| `usage:auth_invalidated` | `{provider, previousType, currentType, userInitiated: boolean}` | index.ts at app_launch |
| `usage:model_auth_mismatch` | `{modelId, sdkProvider, authType, attemptedAction}` | model-switch / pre-send |
| `usage:keychain_status` | `{available, probeOk, reason?}` | startup-guards |
| `usage:auth_migration` | `{provider, fromVersion, toVersion, result: 'ok'\|'failed', reason?}` | auth-store-migration |
| `usage:model_probe` | `{provider, modelId, result: 'ok'\|'unauthorized'\|'forbidden'\|'not_found'\|'rate_limit'\|'error', durationMs, cacheHit}` | model-probe |
| `usage:model_switch` *(extended)* | `{before, after, reason: 'user'\|'auto_fallback'\|'restore'}` | ipc-handlers-auth |

### New IPC channels

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `figma:token_lost` | main→renderer | `{}` | Banner trigger when safeStorage decrypt fails |
| `auth:probe-model` | renderer→main | `(provider, modelId) → ProbeResult` | Test a single model's availability |
| `auth:test-connection` | renderer→main | `(provider) → {ok, error?, models: string[]}` | Settings "Test connection" button |
| `auth:get-model-status` | renderer→main | `() → Record<modelId, 'ok'\|'unauthorized'\|...>` | Decorate model picker dots |
| `app:post-upgrade-state` | renderer→main | `() → {previousVersion, currentVersion, authDelta}` | Post-upgrade wizard |
| `auth:dismiss-banner` | renderer→main | `(bannerId) → void` | Session-scoped banner dismissal |

### Renderer message constants (new / replacing `MSG_EMPTY_TURN_WARNING`)

```ts
// src/main/messages.ts
export const MSG_ERR_UNAUTHORIZED = 'Session expired. Open Settings and re-login to [provider].';
export const MSG_ERR_FORBIDDEN = 'Model [modelId] is not available on your [provider] plan.';
export const MSG_ERR_NOT_FOUND = 'Model [modelId] not recognized by [provider]. Try another model.';
export const MSG_ERR_RATE_LIMIT = 'Rate limit hit. Wait [seconds]s and retry.';
export const MSG_ERR_PROVIDER_UNAVAILABLE = '[provider] is currently unavailable. Retry in a moment.';
export const MSG_ERR_STREAM_EMPTY = 'The model returned an empty response. Try another model or check credentials.';
```

## Sprint A — Observability MVP

**Goal**: stop flying blind. Ship as 0.14.1 hotfix after 48h bake.
**Exit criteria**: ≥95% of observed empty-turn events in production carry actionable `httpStatus` + `provider`. Auth transitions between launches produce at least one `usage:auth_invalidated` event when regression occurs.

### F1 — LLM stream error interceptor

**Effort**: 3h · **Priority**: P0 (blocker)

**Context**
Pi SDK's `session.prompt()` returns a Promise that resolves after the turn ends. Internal streaming errors (401 from Anthropic, 403 model not available, 429 rate limit, 5xx upstream) may be swallowed before resolution if the SDK's stream-closure logic treats them as benign. We need a guaranteed capture point.

**Design**
Wrap every `session.prompt()` call in a higher-order helper that:
1. Records `Date.now()` at start.
2. `.catch()` with error classification: `httpStatus` extracted from known error shapes (`err.status`, `err.code`, nested `err.response.status`, or string scraping).
3. Emits `usage:llm_stream_error` with provider + modelId snapshot.
4. Rethrows so existing error-handling paths still fire.

Additional capture: subscribe to `auto_retry_start` / `auto_retry_end` events and suppress `llm_stream_error` during auto-retry windows (Pi SDK may retry internally).

**Files**

| File | Action | Notes |
|---|---|---|
| `src/main/agent.ts` | New: `wrapPromptWithErrorCapture(session, usageTracker, modelConfig)` helper | Exported for session-events and ipc-handlers |
| `src/main/session-events.ts` | Replace direct `session.prompt()` calls (lines ~451, ~467) with wrapper | 2 call sites |
| `src/main/ipc-handlers.ts` | Replace direct `session.prompt()` call in `agent:prompt` handler | 1 call site |
| `src/main/usage-tracker.ts` | Add `trackLlmStreamError(payload)` method | Mirrors `trackAgentError` pattern |

**Acceptance criteria**
- Every rejected `session.prompt()` produces exactly one `usage:llm_stream_error` event.
- Payload fields: `provider`, `modelId`, `httpStatus` (number or null), `errorCode` (string or null), `errorBody` (truncated 500 chars, redacted), `durationMs`, `promptId`, `slotId`.
- Errors during `auto_retry_start`/`_end` window are NOT duplicated.
- `AbortError` (user cancel) is NOT logged as stream error; emits `usage:prompt_cancelled` instead.
- Rethrow preserves original error — existing `ipc-handlers.ts:360-373` auth detection still works.

**Tests**

Unit (`tests/unit/main/agent-prompt-wrapper.test.ts`):
- Mock `session.prompt` → throws `{status: 401}`. Wrapper emits `llm_stream_error` with httpStatus=401.
- Mock throws `{code: 'ECONNRESET'}`. Payload has `errorCode='ECONNRESET'`, `httpStatus=null`.
- Mock throws `new AbortError()`. No `llm_stream_error`; emits `prompt_cancelled`.
- Nested `err.response.status=403`. Extracted to top-level `httpStatus=403`.
- Error body >500 chars → truncated.
- Sensitive patterns in errorBody redacted via `redactMessage()`.

Playbook (`tests/unit/main/agent-playbook-errors.test.ts`):
- Scenario "stream_401": scripted streamFn throws 401 → assert `events.hasEvent('usage:llm_stream_error')` + agent error path fires.
- Scenario "stream_403": same for 403 with `errorCode='model_not_available'`.
- Scenario "stream_429" with `retry-after: 5` in body → assertion includes `retryAfter=5`.
- Scenario "stream_empty_no_error": streamFn closes with no chunks, no error → ensures wrapper does NOT emit `llm_stream_error` (F2 handles this instead).

E2E (no new — existing suite still green).

---

### F2 — Empty-turn log enrichment

**Effort**: 30m · **Priority**: P0

**Context**
`src/main/session-events.ts:444` already detects `responseLength === 0 && toolNames.length === 0`. It shows a warning to the user but does not log. Must emit a structured event so we can query empty-response rates per model.

**Design**
Inside the existing `if` block (line 444), call `usageTracker.trackEmptyResponse()`. Enrich the condition with a reason heuristic: if an `llm_stream_error` was emitted for the same `promptId` in this turn (tracked via a turn-scoped Map), skip empty-response (already logged). Else classify as `'suspected_auth'` if turn duration <2s, else `'unknown'`.

**Files**

| File | Action |
|---|---|
| `src/main/session-events.ts` | Inject tracking, call `trackEmptyResponse()` |
| `src/main/usage-tracker.ts` | Add `trackEmptyResponse({provider, modelId, reason, durationMs, promptId, slotId})` |

**Acceptance criteria**
- Every empty turn (0 chars, 0 tools) produces exactly one `usage:empty_response` OR one `usage:llm_stream_error` (never both).
- Field `reason` populated with one of the enum values.

**Tests**

Unit (`tests/unit/main/empty-response-detection.test.ts`):
- Simulate turn_end with responseLength=0, toolNames=[] → `trackEmptyResponse` called with `reason='suspected_auth'` (duration <2s).
- Duration >2s → `reason='unknown'`.
- Prior `llm_stream_error` in same turn → `trackEmptyResponse` NOT called.

Playbook:
- Add `empty_turn_with_prior_error` and `empty_turn_no_error` scenarios to agent-playbook-errors.

---

### F3 — Auth transition detector

**Effort**: 2h · **Priority**: P0

**Context**
User's `auth.openai.type` went from `oauth` at 11:39 to `none` at 12:13 without an explicit logout in logs. Root cause unknown (upgrade? token refresh failure?). We need to detect transitions between app launches.

**Design**
Persist a snapshot `~/.bottega/last-auth-snapshot.json`:
```ts
interface AuthSnapshot {
  version: 1;
  capturedAt: string;   // ISO
  appVersion: string;
  providers: Record<string, 'none' | 'api_key' | 'oauth'>;
}
```

At app_launch:
1. Read previous snapshot (null if absent).
2. Capture current snapshot from `authStorage.get(provider)` loops.
3. For each provider, if `previous != current` AND transition is regression (`oauth→none`, `api_key→none`, `oauth→api_key`), emit `usage:auth_invalidated`.
4. Include `userInitiated: boolean` — set true if within last 5 minutes a `auth:logout` IPC call fired (persist timestamp to snapshot).
5. Write new snapshot atomically.

**Files**

| File | Action |
|---|---|
| `src/main/auth-snapshot.ts` | **New**: `readSnapshot()`, `writeSnapshot()`, `diffSnapshots()` |
| `src/main/index.ts` | Call snapshot diff at launch after infra init |
| `src/main/ipc-handlers-auth.ts` | Touch logout timestamp in snapshot on `auth:logout` |
| `src/main/usage-tracker.ts` | Add `trackAuthInvalidated({provider, previousType, currentType, userInitiated})` |

**Acceptance criteria**
- First launch with no prior snapshot: creates snapshot, emits nothing.
- Launch after explicit logout via UI: no `auth_invalidated` event (userInitiated detected).
- Launch after silent token loss: `auth_invalidated` emitted once per provider.
- Progression (`none→oauth`) does NOT fire invalidated — only regressions.

**Tests**

Unit (`tests/unit/main/auth-snapshot.test.ts`):
- `diffSnapshots(null, current)` → no events.
- `diffSnapshots({...anthropic:'oauth'}, {...anthropic:'none'})` → `{provider:'anthropic', previousType:'oauth', currentType:'none'}`.
- `userInitiated` set when logout timestamp within 5min.
- File I/O: atomic write, chmod 0600.
- Corrupt JSON → treated as missing, warn logged.

E2E (`tests/e2e/auth-transition.spec.ts`):
- Launch app → logout Anthropic → quit → restart → assert no `auth_invalidated` event (via capture of logs).
- Launch → manually delete auth file → restart → assert event.

---

### F4 — Model/auth mismatch logger

**Effort**: 1h · **Priority**: P0

**Context**
When user switches to a model whose required auth slot is empty, we currently allow the send and fail server-side. We want a log event BEFORE the failing API call.

**Design**
In `ipc-handlers-auth.ts` `auth:switch-model` handler, after resolving `AVAILABLE_MODELS.find(...)`, check `authStorage.get(sdkProvider)?.type`. If `null` or `none`, emit `usage:model_auth_mismatch` and still allow the switch (UX gating comes in F10/F12).

Additionally in `agent:prompt` handler, pre-send check does the same — catches case where user had auth when switching, then lost it.

**Files**

| File | Action |
|---|---|
| `src/main/ipc-handlers-auth.ts` | Add mismatch check in `auth:switch-model` |
| `src/main/ipc-handlers.ts` | Add mismatch check before `session.prompt()` in `agent:prompt` |
| `src/main/usage-tracker.ts` | Add `trackModelAuthMismatch(payload)` |

**Acceptance criteria**
- Model switch to `gpt-5.4-mini` with `auth.openai.type=none` emits mismatch with `attemptedAction='switch'`.
- Send on same config emits mismatch with `attemptedAction='send'`.
- No false positives for properly authed provider.

**Tests**

Unit (`tests/unit/main/model-auth-mismatch.test.ts`):
- Mock authStorage returning null for `openai` → switch model → assert mismatch event.
- Same for `'api_key'` to `openai-codex` which needs `oauth`.

Playbook: not needed (no streaming involved).

---

### F6 — Keychain probe at launch

**Effort**: 1.5h · **Priority**: P1

**Context**
`safeStorage.isEncryptionAvailable()` returning false means all token storage is plaintext with 0600 perms. If Keychain corrupts or encryption keys rotate (macOS keychain reset after OS upgrade), stored tokens silently become undecryptable.

**Design**
At startup, after Electron `app.whenReady()`:
1. Check `safeStorage.isEncryptionAvailable()`.
2. If true, attempt round-trip: `safeStorage.encryptString('probe')` → `safeStorage.decryptString(...)` → assert equals `'probe'`.
3. Emit `usage:keychain_status {available, probeOk, reason}`.
4. If `probeOk === false` and we have any stored tokens on disk with `encrypted: true`, emit renderer banner "Keychain encryption changed — some credentials may need re-entry".

**Files**

| File | Action |
|---|---|
| `src/main/startup-guards.ts` | Add `runKeychainProbe()` |
| `src/main/index.ts` | Call probe after app ready |
| `src/main/usage-tracker.ts` | Add `trackKeychainStatus(payload)` |
| `src/renderer/app.js` | Banner UI for `keychain:unavailable` IPC |

**Acceptance criteria**
- Normal macOS run: `available=true, probeOk=true`.
- Keychain locked (simulated): `probeOk=false` → banner displayed.
- Linux/headless CI: `available=false` → logged once, no banner (expected).

**Tests**

Unit (`tests/unit/main/keychain-probe.test.ts`):
- Mock safeStorage `isEncryptionAvailable=true`, encrypt+decrypt round-trip OK → `probeOk=true`.
- Mock `decryptString` throws → `probeOk=false`, reason captured.
- Mock `isEncryptionAvailable=false` → `available=false, probeOk=null`.

E2E: skipped (requires real Electron keychain access).

---

## Sprint B — Token migration & persistence

**Goal**: eliminate silent token loss on upgrades. Ship with next version bump.
**Exit criteria**: zero reports of "lost login after update"; keychain decrypt failures surface actionable banners.

### F5 — Versioned auth store with migration

**Effort**: 1d · **Priority**: P1

**Context**
Pi SDK's `AuthStorage` writes a file; its internal schema is opaque to Bottega. We cannot change the SDK format, but we CAN version a sibling file that tracks Bottega's expectations and detect corruption.

**Design**
Introduce `~/.bottega/auth-meta.json`:
```ts
interface AuthMeta {
  version: 1;
  bottegaVersion: string;   // last version that wrote this
  providers: Record<string, {
    savedAt: string;
    sdkProvider: string;
    kind: 'oauth' | 'api_key';
    checksum: string;       // hash of stored token, lets us detect silent changes
  }>;
}
```

At launch:
1. Read meta. If missing, initialize from current state (lazy migration).
2. For each meta entry, cross-check with `authStorage.get(provider)`. If SDK has it but meta doesn't → add to meta. If meta has it but SDK returns null → emit `usage:auth_migration {result:'failed', reason:'sdk_missing'}` and remove meta entry.
3. On every `auth:set-key` / OAuth login success, update meta.

Keychain migration: if `keychain_status.probeOk=false`, attempt re-encrypt of existing tokens. Since we don't have the plaintext (can't decrypt), we can't re-encrypt — we DELETE the stored token and surface `auth_migration_failed` → user re-authenticates.

**Files**

| File | Action |
|---|---|
| `src/main/auth-meta.ts` | **New**: read/write/validate |
| `src/main/index.ts` | Call migration at launch (after keychain probe) |
| `src/main/ipc-handlers-auth.ts` | Write meta on auth changes |

**Acceptance criteria**
- Fresh install: meta created after first auth action.
- Upgrade from 0.13.0: meta created on first 0.15.0 launch; no events emitted (nothing lost).
- Simulated keychain reset: tokens cleared, `auth_migration` failed events emitted, banner shown.

**Tests**

Unit (`tests/unit/main/auth-meta.test.ts`):
- Initial state (no meta file) → creates meta matching authStorage.
- Meta + SDK consistent → no events.
- Meta has provider, SDK returns null → failed migration + meta entry removed.
- Corrupt meta JSON → warn + treat as missing.

E2E (`tests/e2e/upgrade-migration.spec.ts`):
- Pre-populate `~/.bottega/` with 0.13.0 auth state → launch 0.14.1 → assert meta created, no banners, auth still functional.

---

### F7 — Codex OAuth proactive refresh

**Effort**: 1d · **Priority**: P1

**Context**
`openai-codex` uses Pi SDK's Codex CLI integration. Tokens expire silently; Pi SDK's `safeReloadAuth()` only re-reads disk, not refresh the token against the API. After logout+login in user's reproduction, the refresh still didn't produce a working token — needs investigation (possibly SDK-side bug).

**Design**
At app_launch, after auth meta reconciliation:
1. For each OAuth provider with token age >12h (tracked in meta `savedAt`), trigger `authStorage.refresh(oauthId)` if Pi SDK exposes it, else manually re-validate via a trivial API call.
2. For `openai-codex`, if token is present but refresh fails with 401, clear token (`authStorage.remove`) and emit renderer banner "Codex login expired — re-login".
3. Rate-limit: per-provider mutex, max 1 refresh per 5min, exponential backoff on 429.

**Files**

| File | Action |
|---|---|
| `src/main/auth-refresh.ts` | **New**: per-provider refresh orchestrator with mutex |
| `src/main/index.ts` | Call at launch |
| `src/main/ipc-handlers-auth.ts` | Optional: `auth:force-refresh` channel for Settings "Refresh" button |
| `src/renderer/settings.js` | Refresh button + banner |

**Acceptance criteria**
- Fresh OAuth token (<12h old): no refresh attempted.
- Old valid token: refresh succeeds, token rewritten to disk, meta updated.
- Old expired token: refresh fails 401 → cleared, banner shown, `auth_invalidated {reason:'refresh_failed'}` logged.
- Concurrent refreshes (same provider): mutex ensures one at a time.

**Tests**

Unit (`tests/unit/main/auth-refresh.test.ts`):
- Mock Pi SDK refresh succeed → token updated, meta savedAt refreshed.
- Mock refresh throws 401 → token cleared, banner IPC emitted.
- Mutex: 2 concurrent calls for same provider → only 1 actual refresh.
- Rate-limit: second call within 5min → skipped with reason `'recent_refresh'`.

Playbook: not applicable.

E2E: skipped (requires real OAuth endpoints).

---

### F8 — Figma PAT decrypt-failure banner

**Effort**: 1.5h · **Priority**: P1

**Context**
`src/main/figma-auth-store.ts:67` logs warn and returns null. Renderer never learns.

**Design**
Modify `getToken()` to signal decrypt failure via a one-shot event. Use a separate getter to keep `getToken()` pure:

```ts
getTokenWithStatus(): { token: string | null; decryptFailed: boolean }
```

In `ipc-handlers-figma-auth.ts`, when loader path detects `decryptFailed`, emit `figma:token_lost` IPC. Renderer displays persistent banner in `app.js`:

> ⚠️ Figma PAT no longer readable (Keychain changed). [Re-enter token] [Dismiss]

Dismiss persists for current session only via `auth:dismiss-banner`.

**Files**

| File | Action |
|---|---|
| `src/main/figma-auth-store.ts` | Add `getTokenWithStatus()` |
| `src/main/ipc-handlers-figma-auth.ts` | Emit `figma:token_lost` + track dismissal |
| `src/renderer/app.js` | Banner component |
| `src/renderer/styles.css` | Banner styles |

**Acceptance criteria**
- Corrupt encrypted file → banner appears once on launch.
- Dismiss → banner hidden until next launch.
- Re-enter token via banner → banner removed, token saved, `figma-auth:status-changed` fires normally.

**Tests**

Unit (`tests/unit/main/figma-auth-banner.test.ts`):
- `getTokenWithStatus` with valid encrypted → `decryptFailed=false`.
- Mock `safeStorage.decryptString` throws → `decryptFailed=true`.

E2E (`tests/e2e/figma-token-lost-banner.spec.ts`):
- Seed `figma-auth.json` with invalid ciphertext → launch app → banner visible → click "Re-enter" → modal opens.

---

### F21 — Post-upgrade wizard

**Effort**: 1d · **Priority**: P2

**Context**
On first launch after version bump, some auth may be invalidated (F3 detects). A proactive wizard is better than discovering failures one by one.

**Design**
Track `lastKnownAppVersion` in app-state file. On launch, if `currentVersion !== lastKnownAppVersion`:
1. Run auth snapshot diff (F3).
2. Run keychain probe (F6).
3. If any auth lost OR keychain reset, show modal "Update check-in":
   - List of providers: status per provider with badges.
   - "Re-enter" button next to any degraded provider (opens respective flow).
   - "Dismiss for now" (can be reopened from Settings).
4. Update `lastKnownAppVersion`.

**Files**

| File | Action |
|---|---|
| `src/main/app-state-persistence.ts` | Extend state with `lastKnownAppVersion` |
| `src/main/index.ts` | Detect version change, send IPC trigger |
| `src/renderer/post-upgrade-modal.js` | **New**: modal UI |
| `src/renderer/index.html` | Modal markup stub |

**Acceptance criteria**
- Same version relaunch: no modal.
- Version change, all auth intact: no modal (silent success).
- Version change, Anthropic lost: modal with red Anthropic row.
- User clicks Re-enter → OAuth flow starts → on success, modal refreshes status.

**Tests**

Unit: snapshot/version comparison logic in app-state.

E2E (`tests/e2e/post-upgrade-wizard.spec.ts`):
- Seed state with older version + missing Anthropic token → launch → modal visible.
- Click dismiss → modal closes, subsequent relaunch within same version: no modal.

---

## Sprint C — Model selector gating

**Goal**: make impossible model choices impossible; make constrained ones obvious.
**Exit criteria**: rate of `usage:model_auth_mismatch` on `attemptedAction='send'` drops 90% vs Sprint A baseline.

### F9 — Per-model auth status decoration

**Effort**: 3h · **Priority**: P1

**Design**
Extend model picker rendering with a status dot per model:
- 🟢 Green: probe OK or auth present for sdkProvider
- 🟡 Yellow: auth present but not yet probed / probe stale
- 🔴 Red: auth missing OR last probe returned 401/403/404

Data source: `auth:get-model-status` returns `Record<modelId, 'ok'|'unauthorized'|'forbidden'|'not_found'|'unknown'>`. Call on settings render + on `auth:status-changed` push.

**Files**

| File | Action |
|---|---|
| `src/renderer/settings.js` | Decorate model picker rows |
| `src/renderer/styles.css` | Status dot styles |
| `src/main/ipc-handlers-auth.ts` | Implement `auth:get-model-status` |

**Acceptance criteria**
- Model with `auth=none`: red dot + tooltip "Sign in to [provider]".
- Model with `auth=oauth` and no probe: yellow.
- Model with successful probe: green.

**Tests**

Unit (renderer, `tests/unit/renderer/model-picker.test.ts`):
- Render with mixed statuses → correct dots present.
- Accessibility: dot has aria-label matching status.

E2E (`tests/e2e/model-picker-status.spec.ts`):
- Launch without any OpenAI auth → open picker → all OpenAI models red.

---

### F10 — Disabled state + inline hints

**Effort**: 3h · **Priority**: P1

**Design**
Red-dot models are click-disabled. Click shows inline hint:

> GPT-5.4 Mini richiede OpenAI API key. [Open Settings → OpenAI](action)

Action button deep-links to Settings with OpenAI card pre-expanded.

**Files**

| File | Action |
|---|---|
| `src/renderer/settings.js` | Click handler for disabled rows |
| `src/renderer/app.js` | Deep-link to Settings section |

**Acceptance criteria**
- Clicking red model does NOT trigger switch.
- Hint shown inline within picker.
- "Open Settings" opens the right card.

**Tests**

E2E: click disabled model → verify settings opens → card expanded.

---

### F11 — Capability probe + cache

**Effort**: 1d · **Priority**: P1

**Design**
New module `src/main/model-probe.ts`:

```ts
interface ProbeResult {
  status: 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limit' | 'error';
  httpStatus?: number;
  errorBody?: string;
  probedAt: string;
  ttlSeconds: number;   // 3600 default
}

class ModelProbe {
  constructor(authStorage, logger);
  probe(sdkProvider, modelId): Promise<ProbeResult>;
  getCached(sdkProvider, modelId, authHash): ProbeResult | null;
}
```

Probe sends `POST /v1/messages` (or provider equivalent) with minimal payload. Cache key `${sdkProvider}:${modelId}:${authHash}` where authHash is sha256 of token (to invalidate on relogin). TTL 1h.

Triggers:
- App launch: probe default model of each provider with auth set.
- Model switch: probe target model before recreating session.
- Settings "Test connection": forced probe.

Emit `usage:model_probe` for every probe (cacheHit or fresh).

**Files**

| File | Action |
|---|---|
| `src/main/model-probe.ts` | **New** |
| `src/main/agent.ts` | Expose probe via AgentInfra |
| `src/main/ipc-handlers-auth.ts` | `auth:probe-model` handler |
| `src/main/index.ts` | Probe defaults at launch |

**Acceptance criteria**
- Probe for valid combo: `status='ok'` within 2s.
- 401 response: `status='unauthorized'`.
- Invalid model ID: `status='not_found'`.
- Cache hit within TTL: no network call, cacheHit=true.
- Auth change (hash diff): cache miss.

**Tests**

Unit (`tests/unit/main/model-probe.test.ts`):
- Mock fetch returns 200 → `status='ok'`.
- Mock fetch returns 401 → `'unauthorized'`.
- Mock fetch returns 403 with `'model'` in body → `'forbidden'`.
- Cache: second call within TTL skips fetch.
- Cache: auth hash changes → refetch.
- Abort: probe timeout 10s → `status='error', errorCode='timeout'`.

E2E: seed auth, launch → verify probe events emitted in logs.

---

### F12 — Pre-send validation gate

**Effort**: 2h · **Priority**: P1

**Design**
In renderer `app.js` send handler, before calling `window.api.prompt`, check `window.api.getModelStatus()` for current model. If red, block send and show inline toast with F10's hint.

Main side (`ipc-handlers.ts` `agent:prompt`) also enforces: runs a lightweight check (cache lookup only, no probe) and rejects with a friendly error if probe cached as red.

**Files**

| File | Action |
|---|---|
| `src/renderer/app.js` | Gate + toast |
| `src/main/ipc-handlers.ts` | Second gate + emit `usage:send_blocked` |
| `src/main/usage-tracker.ts` | Add `trackSendBlocked(reason)` |

**Acceptance criteria**
- Send attempt on red model: prompt NOT sent, toast visible.
- Send attempt on green/yellow: normal flow.

**Tests**

Playbook: scenario where cached probe is red → `prompt` IPC returns rejection synchronously.

E2E: launch with bad OpenAI auth, switch to gpt-5.4-mini, type message, hit send → no prompt fired.

---

### F17 — Auto-fallback to last-known-good

**Effort**: 3h · **Priority**: P2

**Design**
In app-state, persist `lastKnownGoodModel: Record<provider, modelId>` (updated on each successful turn_end). At launch, if current-model probe returns non-ok AND a last-good exists for same provider, auto-switch and log `usage:model_switch {reason:'auto_fallback'}` + show one-time banner "Modello [X] non disponibile, tornato a [Y]".

**Files**

| File | Action |
|---|---|
| `src/main/app-state-persistence.ts` | Extend state |
| `src/main/agent.ts` | Update state on each successful turn_end |
| `src/main/index.ts` | Fallback logic at launch |
| `src/renderer/app.js` | Fallback banner |

**Acceptance**
- Currently-selected model fails probe, last-good exists → auto-switch + banner.
- No last-good: no switch, user sees red dot and must choose manually.

**Tests**

Unit: fallback decision matrix.

E2E: seed bad-auth + valid last-good → launch → verify banner + new model selected.

---

### F18 — `usage:model_switch` reason field

**Effort**: 30m · **Priority**: P2

**Design**
Add optional `reason: 'user' | 'auto_fallback' | 'restore'` to the event.

**Files**

| File | Action |
|---|---|
| `src/main/usage-tracker.ts` | Extend `trackModelSwitch` signature |
| `src/main/ipc-handlers-auth.ts` | Pass `'user'` explicitly |
| `src/main/index.ts` | Pass `'restore'` / `'auto_fallback'` |

**Tests**

Unit: each caller produces correct reason.

---

## Sprint D — Error messaging & UI polish

**Goal**: every error the user sees is actionable. Every Settings page tells the truth about what works.
**Exit criteria**: support tickets about "silent no response" drop to near zero.

### F13 — Error-body-aware messages

**Effort**: 3h · **Priority**: P1

**Design**
Replace `MSG_EMPTY_TURN_WARNING` routing in `session-events.ts`:

```ts
function messageForError(status: number | null, provider: string, modelId: string): string {
  switch (status) {
    case 401: return MSG_ERR_UNAUTHORIZED.replace('[provider]', provider);
    case 403: return MSG_ERR_FORBIDDEN.replace('[modelId]', modelId);
    case 404: return MSG_ERR_NOT_FOUND.replace('[modelId]', modelId).replace('[provider]', provider);
    case 429: return MSG_ERR_RATE_LIMIT.replace('[seconds]', retryAfterFromHeaders);
    default: if (status && status >= 500) return MSG_ERR_PROVIDER_UNAVAILABLE.replace('[provider]', provider);
             return MSG_ERR_STREAM_EMPTY;
  }
}
```

Consume `usage:llm_stream_error` payload within the same turn.

**Files**

| File | Action |
|---|---|
| `src/main/messages.ts` | New constants |
| `src/main/session-events.ts` | Route by status |

**Tests**

Unit: each status → correct message.

Playbook: scenario with 401 → renderer receives matching message.

---

### F14 — Retry button on recoverable errors

**Effort**: 2h · **Priority**: P2

**Design**
When error is 429 or 5xx, renderer shows a "Retry" button below the error card. Clicking re-sends the last user prompt (stored in session memory).

**Files**

| File | Action |
|---|---|
| `src/renderer/app.js` | Retry button + resend logic |

**Tests**

E2E: mock 429 → retry visible → click → prompt re-sent.

---

### F15 — Diagnostics "Recent errors" panel

**Effort**: 3h · **Priority**: P2

**Design**
Settings → Diagnostics → new section showing last 10 `llm_stream_error` + `empty_response` events (from in-memory ring buffer on main). Each row: timestamp, provider, modelId, status, message. "Copy" button copies JSON.

**Files**

| File | Action |
|---|---|
| `src/main/diagnostics.ts` | Ring buffer |
| `src/main/ipc-handlers.ts` | `diagnostics:get-recent-errors` |
| `src/renderer/settings.js` | UI rendering |

**Tests**

Unit: ring buffer behavior (10 max, FIFO).

E2E: trigger errors → open settings → verify listed.

---

### F19 — "Test connection" button

**Effort**: 2h · **Priority**: P2

**Design**
Each provider account card in Settings gets a "Test connection" button. Click calls `auth:test-connection` which runs F11 probe on default model + returns details. Shows inline ✓ / ✗ with error detail.

**Files**

| File | Action |
|---|---|
| `src/renderer/settings.js` | Button + result display |
| `src/main/ipc-handlers-auth.ts` | `auth:test-connection` handler |

**Tests**

E2E: click Test → assert result matches seeded probe response.

---

### F20 — Split OpenAI card

**Effort**: 3h · **Priority**: P2

**Design**
Replace single "OpenAI" card with two rows under an "OpenAI" section:
- **OpenAI API Key** (sdkProvider=`openai`) — fields: API key input.
- **ChatGPT (Codex)** (sdkProvider=`openai-codex`) — fields: OAuth login/logout.

`OAUTH_PROVIDER_INFO` extended with two entries. Backward-compat: `auth:get-auth-status` returns both keys.

**Files**

| File | Action |
|---|---|
| `src/main/agent.ts` | Add `openai-codex` to `OAUTH_PROVIDER_INFO` |
| `src/main/ipc-handlers-auth.ts` | Return both groups |
| `src/renderer/index.html` | Markup for two rows |
| `src/renderer/settings.js` | Render two rows |

**Tests**

E2E: open settings → verify two rows visible, each with its own login flow.

Migration test: user with existing OpenAI OAuth sees ChatGPT row as "connected" after upgrade.

---

## Cross-cutting test strategy

### Test file inventory (new)

```
tests/unit/main/
  agent-prompt-wrapper.test.ts          F1
  empty-response-detection.test.ts      F2
  auth-snapshot.test.ts                 F3
  model-auth-mismatch.test.ts           F4
  keychain-probe.test.ts                F6
  auth-meta.test.ts                     F5
  auth-refresh.test.ts                  F7
  figma-auth-banner.test.ts             F8
  model-probe.test.ts                   F11
  error-message-routing.test.ts         F13
  diagnostics-ring-buffer.test.ts       F15

tests/unit/main/agent-playbook-errors.test.ts    F1/F2/F13 (extended)

tests/unit/renderer/
  model-picker.test.ts                  F9/F10

tests/e2e/
  auth-transition.spec.ts               F3
  upgrade-migration.spec.ts             F5
  figma-token-lost-banner.spec.ts       F8
  post-upgrade-wizard.spec.ts           F21
  model-picker-status.spec.ts           F9
  model-picker-disabled.spec.ts         F10
  pre-send-gate.spec.ts                 F12
  auto-fallback-banner.spec.ts          F17
  error-retry.spec.ts                   F14
  diagnostics-panel.spec.ts             F15
  test-connection.spec.ts               F19
  openai-split-card.spec.ts             F20
```

### Playbook harness extensions

Add helpers to `tests/helpers/playbook.ts`:

```ts
export function streamThrows(httpStatus: number, body?: string): StreamFn
export function streamEmpty(): StreamFn  // closes with no chunks
export function streamAborted(): StreamFn
```

Mock authStorage helper in `tests/helpers/mock-auth-storage.ts`:

```ts
export function createMockAuthStorage(config: Record<string, 'none' | 'api_key' | 'oauth'>): AuthStorage
```

Mock model-probe with cached results in `tests/helpers/mock-model-probe.ts`.

### Coverage thresholds

New code must hit ≥85% line coverage, ≥75% branch coverage. Enforce via `npm run test:coverage` gate in CI.

## Rollout strategy

1. **Sprint A hotfix (0.14.1)**: merge F1-F4, F6. Ship 48h bake internally, then public. Monitor new events.
2. **Wait 5-7 days**. Analyze `usage:llm_stream_error` and `usage:auth_invalidated` distributions. Adjust Sprint B/C priorities if telemetry reveals unexpected patterns (e.g., 429 dominates → bump F14 up).
3. **Sprint B (0.15.0-alpha)**: F5, F7, F8, F21. Test with staged rollout (10% → 50% → 100%).
4. **Sprint C (0.15.0-beta)**: F9-F12, F17, F18.
5. **Sprint D (0.15.0)**: F13-F15, F19, F20.

### Feature flags

Add `~/.bottega/flags.json`:
```json
{
  "modelProbe": true,
  "preSendGate": true,
  "autoFallback": false
}
```

F12 and F17 stay behind flags for 1 week post-release to allow rollback without shipping a new binary.

### Telemetry dashboards

Build Axiom dashboards (via `building-dashboards` skill):

1. **Auth health**: `usage:auth_invalidated` rate by provider, `usage:keychain_status.probeOk` distribution, `usage:auth_migration` failure rate.
2. **Stream errors**: `usage:llm_stream_error` by (provider, modelId, httpStatus), empty_response by reason, P95 durationMs.
3. **Model probe**: `usage:model_probe` cacheHit rate, status distribution, per-model availability.

## Open questions / needs input

- **Claude 4.6 account gating**: user with 100% empty-response rate on `claude-sonnet-4-6` while dev succeeds suggests account tier. Does Anthropic Pro plan include 4.6? If not, we need to surface this specifically (F13 + F20 partial). Requires Anthropic docs check or support contact.
- **Pi SDK refresh surface**: does `AuthStorage` expose a `.refresh(provider)` method? F7 design assumes yes or a substitute. If no, we may need to patch Pi SDK or talk to maintainers.
- **Codex CLI lifecycle**: who owns the `openai-codex` token refresh today? If Codex CLI itself handles it, F7 overlaps. Investigation ticket needed before starting Sprint B.

## Estimated timeline (solo dev)

| Sprint | Dev days | Calendar days |
|---|---|---|
| A | 2 | 2 |
| B | 4 | 4 |
| C | 2.5 | 3 |
| D | 2 | 2 |
| **Total** | **10.5** | **11** |

Parallelizable with 2 devs: ~6 calendar days.
