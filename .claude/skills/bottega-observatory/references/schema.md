# Bottega Event Schema Reference

Dataset: `bottega-logs` (configurable via `BOTTEGA_AXIOM_DATASET`)

## Universal Fields

Every record includes:
- `_time` — Timestamp
- `sid` — Session UID (`s_` + 8 hex chars), generated once per app launch
- `level` — Pino log level (info/warn/error)
- `msg` — Log message
- `event` — Event type identifier (e.g., `usage:app_launch`)

## Event Taxonomy

### Lifecycle Events

| Event | Key Fields | Notes |
|-------|-----------|-------|
| `usage:app_launch` | `system.anonymousId`, `system.appVersion`, `system.electronVersion`, `system.nodeVersion`, `system.os`, `system.osRelease`, `system.arch`, `system.cpuModel`, `system.cpuCores`, `system.totalRamGB`, `system.diskTotalGB`, `system.locale`, `system.timezone`, settings snapshot, `startupMs`, `isFirstLaunchAfterUpdate` | First event of every session; full system context |
| `usage:session_start` | `model.provider`, `model.modelId`, `contextSize` | Per agent session start |
| `usage:session_end` | `durationMs`, `totalToolCalls`, `tokensInput`, `tokensOutput`, `tokensSaved`, `compactionTriggered` | Per agent session end |
| `usage:app_quit` | `uptimeSeconds`, `sessionsCompleted`, vitals (inline) | Final event of session |
| `usage:heartbeat` | `freeRamGB`, `diskFreeGB`, `processRssMB`, `processHeapMB`, `eventLoopLagMs`, `eventLoopLagP99Ms`, `figmaWsConnected`, `rendererResponsive`, `uptimeSeconds` | Every 10 seconds |

### Agent Interaction Events

All include: `promptId`, `slotId`, `turnIndex`

| Event | Key Fields | Notes |
|-------|-----------|-------|
| `usage:prompt` | `charLength`, `isFollowUp`, `contentPreview` (first 500 chars) | Per user prompt |
| `usage:tool_call` | `toolName`, `category`, `success`, `durationMs`, `screenshotMeta` | Per tool execution |
| `usage:tool_error` | `toolName`, `errorMessage` (redacted), `errorCode` | On tool failure |
| `usage:agent_error` | `errorType`, `message` (redacted) | Pi SDK-level errors |
| `usage:turn_end` | `responseCharLength`, `responseDurationMs`, `toolCallCount`, `toolNames`, `hasAction` | After each agent turn |
| `usage:context_level` | `inputTokens`, `outputTokens`, `totalTokens`, `contextWindow`, `fillPercent`, `modelId` | Per message end |
| `usage:compaction` | `tokensBefore`, `tokensAfter`, `tokensSaved` | When compression triggers |

### Feedback Events

| Event | Key Fields | Notes |
|-------|-----------|-------|
| `usage:feedback` | `sentiment` (positive/negative), `issueType`, `details` (redacted), `promptId`, `slotId`, `turnIndex` | Correlates to `lastCompletedPromptId` |

### Settings Change Events

| Event | Key Fields |
|-------|-----------|
| `usage:model_switch` | `before.provider`, `before.modelId`, `after.provider`, `after.modelId` |
| `usage:thinking_change` | `before`, `after` |
| `usage:compression_profile_change` | `before`, `after` |

### Figma Integration Events

| Event | Key Fields |
|-------|-----------|
| `usage:figma_connected` | `fileKeyHash` (SHA-256 truncated 16 chars), `connectTimeMs` |
| `usage:figma_disconnected` | `reason`, `connectionDurationMs` |
| `usage:figma_plugin_installed` | `success` |

### Image Generation Events

| Event | Key Fields |
|-------|-----------|
| `usage:image_gen` | `imageType` (generate/edit/restore/icon/pattern/story/diagram), `model`, `success`, `durationMs` |

### Suggestion Events

| Event | Key Fields |
|-------|-----------|
| `usage:suggestions_generated` | `count`, `durationMs` |
| `usage:suggestion_clicked` | `suggestionIndex` (0-based) |

### Queue & Multi-Tab Events

| Event | Key Fields |
|-------|-----------|
| `usage:slot_created` | `fileKeyHash`, `automatic` |
| `usage:slot_removed` | `fileKeyHash` |
| `usage:prompt_enqueued` | `queueLength` |
| `usage:prompt_dequeued` | `queueLength` |
| `usage:prompt_queue_edited` | — |
| `usage:prompt_queue_cancelled` | — |
| `usage:app_state_restored` | `slotsCount`, `totalQueuedPrompts` |

### Error & Crash Events

All include inline vitals at crash time.

| Event | Key Fields | Notes |
|-------|-----------|-------|
| `usage:uncaught_exception` | `errorName`, `errorMessage` (redacted), `stack` (redacted), vitals | `process.on('uncaughtException')` |
| `usage:unhandled_rejection` | `errorName`, `errorCode`, `errorMessage` (redacted), vitals | `process.on('unhandledRejection')` |
| `usage:renderer_crash` | `reason`, `exitCode`, vitals | Electron `render-process-gone` |

## Tool Categories

39 tools across 8 categories:

| Category | Tools | Count |
|----------|-------|-------|
| core | `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection` | 4 |
| discovery | `figma_get_file_data`, `figma_search_components`, `figma_get_library_components`, `figma_get_component_details`, `figma_get_component_deep`, `figma_design_system` | 6 |
| components | `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`, `figma_analyze_component_set` | 4 |
| manipulation | `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_set_image_fill`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`, `figma_rename` | 10 |
| tokens | `figma_setup_tokens`, `figma_lint` | 2 |
| annotations | `figma_get_annotations`, `figma_set_annotations`, `figma_get_annotation_categories` | 3 |
| jsx-render | `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable` | 3 |
| image-gen | `figma_generate_image`, `figma_edit_image`, `figma_restore_image`, `figma_generate_icon`, `figma_generate_pattern`, `figma_generate_story`, `figma_generate_diagram` | 7 |

## Correlation Patterns

### Session → Turn → Feedback chain
```
usage:app_launch (sid) → usage:prompt (sid + promptId) → usage:tool_call (promptId) → usage:turn_end (promptId) → usage:feedback (promptId)
```

### Crash context chain
```
usage:app_launch (sid) → usage:heartbeat (sid, every 10s) → usage:uncaught_exception (sid + inline vitals)
```

### Figma lifecycle chain
```
usage:figma_connected (sid) → usage:tool_call (sid + toolName) → usage:figma_disconnected (sid + reason)
```

## Privacy & Redaction

- **No user content**: Prompts, Figma node names, tool parameters are NOT logged
- `contentPreview` in `usage:prompt` contains the first 500 chars (opt-in diagnostic data)
- `errorMessage` and `stack` are scrubbed of API keys, bearer tokens, home directory paths
- `fileKeyHash` is SHA-256 truncated — original Figma file keys are never stored
- Fields matching `apiKey`, `key`, `token`, `authorization` are pino-redacted to `[REDACTED]`
