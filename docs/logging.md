# Logging & Diagnostics

## Section 1 — Architecture

```
App (pino) ──┬── stdout (pino-pretty, info+)     ← local development
             ├── file (JSON, debug+)              ← ~/Library/Logs/Bottega/app.log
             └── Axiom (@axiomhq/pino, info+)     ← remote, opt-in
                    │
                    ├── sid: "s_a1b2c3d4"          ← mixin on every log
                    ├── usage:app_launch            ← system + settings (once)
                    ├── usage:heartbeat (every 10s) ← live vitals
                    ├── usage:* events              ← user interactions
                    └── normal logs (info/warn/err) ← existing app logs
```

- **Axiom dataset**: `bottega-logs`
- **Local retention**: 30 days — `cleanOldLogs()` runs at startup and removes log files older than 30 days
- **Heartbeat interval**: every 10 seconds; forced inline on errors and crashes to capture vitals at the moment of failure
- **Session UID (`sid`)**: generated once per app launch (e.g. `s_a1b2c3d4`), injected into every log record via a pino mixin when diagnostics are enabled
- **Config file**: `~/.bottega/diagnostics.json`
- **Opt-in**: diagnostics are off by default and must be explicitly enabled by the user


## Section 2 — Event Schema

All `usage:*` events are emitted to Axiom when diagnostics are enabled. Each event includes the `sid` mixin automatically.

### Lifecycle

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:app_launch` | `system.anonymousId`, `system.appVersion`, `system.electronVersion`, `system.nodeVersion`, `system.os`, `system.osRelease`, `system.arch`, `system.cpuModel`, `system.cpuCores`, `system.totalRamGB`, `system.diskTotalGB`, `system.locale`, `system.timezone`, settings snapshot, `startupMs`, `isFirstLaunchAfterUpdate` | Once per launch | First event of every session; provides full system context for later correlation |
| `usage:session_start` | `model.provider`, `model.modelId`, `contextSize` | Per agent session | Emitted when the user starts a new agent conversation |
| `usage:session_end` | `durationMs`, `totalToolCalls`, `tokensInput`, `tokensOutput`, `tokensSaved`, `compactionTriggered` | Per agent session | Emitted when the agent session completes or is cancelled |
| `usage:app_quit` | `uptimeSeconds`, `sessionsCompleted`, vitals (inline) | Once per quit | Includes a final vitals snapshot taken at quit time |
| `usage:heartbeat` | `freeRamGB`, `diskFreeGB`, `processRssMB`, `processHeapMB`, `eventLoopLagMs`, `figmaWsConnected`, `rendererResponsive`, `uptimeSeconds` | Every 10 seconds | Primary signal for health monitoring and memory leak detection |

### Agent Interaction

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:prompt` | `charLength`, `isFollowUp` | Per user prompt | `isFollowUp` is true when the user is continuing an existing session |
| `usage:tool_call` | `toolName`, `category`, `success`, `durationMs` | Per tool call | Covers all 34 tools; `category` maps to core/discovery/components/manipulation/tokens/jsx-render/image-gen |
| `usage:tool_error` | `toolName`, `errorMessage` (redacted), `errorCode` | On tool failure | `errorMessage` has API keys and tokens stripped before emission |
| `usage:agent_error` | `errorType`, `message` (redacted) | On agent failure | Covers Pi SDK-level errors (e.g. context overflow, API errors) |
| `usage:compaction` | `tokensBefore`, `tokensAfter`, `tokensSaved` | On compaction | Emitted whenever the compression layer triggers a context compaction |

### Settings Changes

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:model_switch` | `before.provider`, `before.modelId`, `after.provider`, `after.modelId` | On model change | Emitted when the user changes the active model in Settings |
| `usage:thinking_change` | `before`, `after` | On thinking level change | Tracks changes to the thinking/reasoning budget setting |
| `usage:compression_profile_change` | `before`, `after` | On profile change | Emitted when the active compression profile is switched |

### Figma

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:figma_connected` | `fileKeyHash` (SHA-256 truncated to 12 chars), `connectTimeMs` | On connect | File key is hashed before emission; never sent in plaintext |
| `usage:figma_disconnected` | `reason`, `connectionDurationMs` | On disconnect | Includes the disconnect reason (e.g. plugin closed, network error) |
| `usage:figma_plugin_installed` | `success` | On install | Emitted when the user runs the plugin setup flow in Settings |

### Image Generation

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:image_gen` | `imageType`, `model`, `success`, `durationMs` | Per generation | `imageType` maps to generate/edit/restore/icon/pattern/story/diagram |

### Suggestions

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:suggestions_generated` | `count`, `durationMs` | Per generation | Emitted after each agent turn when the prompt suggester completes |
| `usage:suggestion_clicked` | `suggestionIndex` | Per click | `suggestionIndex` is 0-based; used to measure which positions get clicked |

### Errors

All error events include an inline vitals snapshot at the time of the error.

| Event | Fields | Frequency | Notes |
|---|---|---|---|
| `usage:uncaught_exception` | `errorName`, `errorMessage` (redacted), `stack` (redacted), vitals | On exception | Captured by `process.on('uncaughtException')` in main process |
| `usage:unhandled_rejection` | `errorName`, `errorCode`, `errorMessage` (redacted), vitals | On rejection | Captured by `process.on('unhandledRejection')` |
| `usage:renderer_crash` | `reason`, `exitCode`, vitals | On crash | Emitted when Electron fires the `render-process-gone` event |


## Section 3 — Axiom Queries (APL)

The following queries are ready to use against the `bottega-logs` dataset.

### Debugging Crashes

```apl
// All crashes in last 24h
['bottega-logs']
| where event startswith "usage:uncaught" or event startswith "usage:unhandled" or event == "usage:renderer_crash"
| sort by _time desc

// Full context of a specific crash (system + settings + recent vitals)
['bottega-logs']
| where sid == "s_XXXXX"
| where event in ("usage:app_launch", "usage:heartbeat", "usage:uncaught_exception")
| sort by _time

// Vitals in the 60s before a crash
['bottega-logs']
| where sid == "s_XXXXX" and event == "usage:heartbeat"
| where _time between (datetime("2026-03-24T10:14:00Z") .. datetime("2026-03-24T10:15:00Z"))
| project _time, freeRamGB, processRssMB, processHeapMB, eventLoopLagMs
| sort by _time
```

### Tool Error Analysis

```apl
// Most failing tools in last 7 days
['bottega-logs']
| where event == "usage:tool_error"
| summarize errorCount = count() by toolName
| sort by errorCount desc

// Timeline of errors for a specific tool
['bottega-logs']
| where event == "usage:tool_error" and toolName == "figma_render_jsx"
| project _time, errorMessage, sid
| sort by _time desc
```

### Usage Analytics

```apl
// Most used tools by category
['bottega-logs']
| where event == "usage:tool_call"
| summarize callCount = count(), avgDurationMs = avg(durationMs), errorRate = countif(success == false) / count() * 100
  by toolName, category
| sort by callCount desc

// Average sessions per day
['bottega-logs']
| where event == "usage:session_end"
| extend day = format_datetime(_time, "yyyy-MM-dd")
| summarize sessions = count(), avgDurationMin = avg(durationMs) / 60000, avgToolCalls = avg(totalToolCalls)
  by day
| sort by day

// Model distribution
['bottega-logs']
| where event == "usage:session_start"
| summarize count() by ['model.provider'], ['model.modelId']
| sort by count_ desc

// Daily active users
['bottega-logs']
| where event == "usage:app_launch"
| extend day = format_datetime(_time, "yyyy-MM-dd")
| summarize dau = dcount(['system.anonymousId']) by day
| sort by day
```

### Performance

```apl
// Sessions with event loop lag > 100ms
['bottega-logs']
| where event == "usage:heartbeat" and eventLoopLagMs > 100
| summarize maxLag = max(eventLoopLagMs), avgLag = avg(eventLoopLagMs) by sid
| sort by maxLag desc

// Process RAM trend over time
['bottega-logs']
| where event == "usage:heartbeat"
| summarize avgRssMB = avg(processRssMB), maxRssMB = max(processRssMB) by bin(_time, 1h)
| sort by _time

// Frequent Figma disconnections
['bottega-logs']
| where event == "usage:figma_disconnected"
| summarize disconnects = count() by sid
| where disconnects > 3
| sort by disconnects desc
```

### Suggestions

```apl
// Suggestion click rate
['bottega-logs']
| where event in ("usage:suggestions_generated", "usage:suggestion_clicked")
| summarize generated = countif(event == "usage:suggestions_generated"),
            clicked = countif(event == "usage:suggestion_clicked")
| extend clickRate = clicked * 100.0 / generated

// Which suggestion positions get clicked most
['bottega-logs']
| where event == "usage:suggestion_clicked"
| summarize count() by suggestionIndex
| sort by count_ desc
```

### Image Generation

```apl
// Usage and success rate by image type
['bottega-logs']
| where event == "usage:image_gen"
| summarize total = count(), failed = countif(success == false), avgDurationMs = avg(durationMs)
  by imageType
| extend errorRate = failed * 100.0 / total
| sort by total desc
```


## Section 4 — Event Correlation Guide

The `sid` field (session UID) is the primary key for correlating events within a single app launch. All events from the same launch share the same `sid`, making it straightforward to reconstruct a timeline.

**"User says the app froze"**

Search for `usage:renderer_crash` or `usage:heartbeat` records where `rendererResponsive == false`. Once you find a matching `sid`, pull all events for that session ordered by `_time` to reconstruct what the user was doing leading up to the freeze. Heartbeats every 10 seconds give you a continuous vitals trail.

**"Tool X fails for some users but not others"**

Filter `usage:tool_error` by `toolName` to get the affected `sid` values. Then join against `usage:app_launch` for those same `sid` values to inspect the `system.*` fields — OS version, CPU architecture, RAM, and Electron version are all present. This lets you identify whether the failure correlates with a specific platform or system configuration.

**"Suspected memory leak"**

Chart `processHeapMB` from `usage:heartbeat` records, grouped by `sid`, ordered by `uptimeSeconds`. A session with a memory leak will show a monotonically increasing heap line. Comparing multiple sessions side by side reveals whether the growth is consistent (systematic leak) or session-specific (triggered by a particular action). Correlate with `usage:tool_call` counts in the same window to identify which tools run before the heap climbs.


## Section 5 — Configuration

**Environment variables**

- `BOTTEGA_AXIOM_TOKEN` — write-only Axiom ingest token. Set this in the environment before launching the app to enable remote logging. This token should have ingest-only permissions.
- `BOTTEGA_AXIOM_DATASET` — Axiom dataset name. Defaults to `bottega-logs` if not set.

**In-app toggle**

Diagnostics can be enabled or disabled in **Settings > Diagnostics**. A restart is required for changes to take effect, as the pino transport is configured at startup.

**Local log export**

Diagnostics can be exported via **Settings > Diagnostics > Export Logs**. This produces a `.zip` archive containing: `logs/app.log` (main log file), rotated log files, `crashes/` (native crash dumps), `metrics/` (compression metrics JSONL), and `system-info.json` (snapshot of app version, OS, CPU, RAM, disk, uptime). Files larger than 50 MB are excluded. The archive can be shared directly for support purposes.

**Retention**

- Local: 30 days. `cleanOldLogs()` runs at each startup and deletes rotated log files older than 30 days.
- Remote (Axiom): configurable on the Axiom dashboard. The default dataset retention is set at the Axiom project level and is independent of the local policy.


## Section 6 — Privacy

- **Opt-in only**: diagnostics are disabled by default. No data is sent until the user explicitly enables the setting.
- **Anonymous ID**: the `anonymousId` is a UUID generated locally and stored in `~/.bottega/diagnostics.json`. It is not linked to any account, email address, or identity.
- **Redacted fields**: any field whose key matches `apiKey`, `key`, `token`, or `authorization` is replaced with `[REDACTED]` before the log record is emitted.
- **Home directory paths**: absolute paths containing the user's home directory are replaced with `~/` so that usernames are not present in log records.
- **Figma file keys**: file keys are never sent in plaintext. They are hashed with SHA-256 and truncated to 12 characters before inclusion in any event.
- **Error messages**: `errorMessage` and `stack` fields in error events are scrubbed to remove API keys and Bearer tokens before emission.
- **No user content**: user prompts, file contents, Figma node names, and tool parameters that may contain user data are never included in any `usage:*` event.
