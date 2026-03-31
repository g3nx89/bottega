# Bottega Domain Knowledge — Investigation Reference

## Axiom Visibility Gaps

NOT everything is tracked to Axiom. When investigating, know what's invisible:

### Tracked to Axiom (query `bottega-logs`)
- Uncaught exceptions, unhandled rejections, renderer crashes
- Tool calls (success/failure/duration)
- Agent errors (auth, rate_limit, unknown)
- User feedback (sentiment, issueType, details)
- Heartbeat vitals (every 10s)
- Figma connect/disconnect
- Model switch, thinking change, compression profile change (SUCCESS only)
- Prompt metadata (charLength, isFollowUp, contentPreview)
- Context level (token counts, fill percent)
- Compaction events, image generation events

### NOT Tracked to Axiom (invisible in queries)
| What | Where it's logged | Why it matters |
|------|-------------------|----------------|
| Model switch ERRORS | `log.error()` only | Can't see failed model changes |
| Tab creation/removal ERRORS | `log.error()` only | Can't see tab lifecycle failures |
| Suggestion generation FAILURES | `log.warn()` only | Can't see if suggestions broke |
| Queued prompt FAILURES | `log.error()` only | Can't see if queue replay broke |
| OAuth login FAILURES | `log.error()` only | Can't see auth flow issues |
| Diagnostics export FAILURES | `log.error()` only | Can't see export issues |
| Compression profile ERRORS | `log.warn()` only | Only success changes tracked |
| Port conflict at startup | Dialog shown, `app.quit()` | App never launches, no session |
| Agent infra creation ERRORS | `log.error()` only | Graceful degradation, no telemetry |
| Plugin sync ERRORS | `log.warn()` only | Non-fatal, not tracked |

**Investigation implication**: If a user reports "the model didn't switch" or "my tab
disappeared", you won't find it in Axiom. Check local logs at `~/Library/Logs/Bottega/app.log`.

## Tool Timeout Reference

Each tool has specific timeout values. When you see a timeout error in Axiom, match it:

### WebSocket Command Timeouts
| Timeout | Tools / Commands | Notes |
|---------|-----------------|-------|
| 5,000ms | `EXECUTE_CODE` (internal) | Plus 2s WS overhead = 7s total |
| 10,000ms | `BIND_VARIABLE`, annotations, standard mutations | Default WS timeout |
| 15,000ms | Most node operations, component operations | Default WS send timeout |
| 30,000ms | `figma_execute` (configurable), `figma_get_file_data`, `GET_VARIABLES`, component details | Complex operations |
| 45,000ms | `CAPTURE_SCREENSHOT` | Screenshot rendering |
| 60,000ms | `CREATE_FROM_JSX`, `SET_IMAGE_FILL` | Heavy rendering operations |
| 120,000ms | `LINT_DESIGN` | Full design audit |
| 300,000ms | `GET_LOCAL_COMPONENTS` | Library scan (5 min!) |

### Other Timeouts
| Timeout | What | Notes |
|---------|------|-------|
| 10,000ms | Iconify API fetch | Per icon, AbortController |
| 30,000ms | FILE_INFO identification | Pending WS client must identify within 30s |
| 5,000ms | Grace period on disconnect | Reconnection window before state cleanup |

### Matching Timeout to Tool
When you see `"timed out after Xms"` in `usage:tool_error`:
- 60000ms → likely `figma_set_image_fill` or `figma_render_jsx`
- 45000ms → likely `figma_screenshot`
- 30000ms → likely `figma_execute` or `figma_get_file_data`
- 15000ms → standard mutation or component operation
- 10000ms → icon fetch timeout (inside `figma_render_jsx` or `figma_create_icon`)

## Tool Failure Signature Guide

### By Error Message Pattern

| Pattern in errorMessage | Tool(s) | Root Cause | Severity |
|------------------------|---------|------------|----------|
| `Figma API error (403)` | `figma_get_library_components`, `figma_search_components` | Invalid/expired Figma API token | High — blocks library access |
| `Figma API error (429)` | Any discovery tool using REST | Figma API rate limit | Transient — retry |
| `Icon "..." not found on Iconify` | `figma_create_icon`, `figma_render_jsx` | LLM hallucinated icon name | Medium — design intent lost |
| `Invalid icon name "..."` | `figma_create_icon`, `figma_render_jsx` | Wrong format (need "prefix:name") | Low — LLM formatting error |
| `Fetch timeout for icon` | `figma_render_jsx` | Iconify API slow/down (10s timeout) | Transient |
| `WebSocket command ... timed out` | Any tool using WS | Plugin not responding | High — check Figma Desktop |
| `WebSocket server shutting down` | Any tool | App closing during operation | Low — expected during quit |
| `Expected identifier but found` | `figma_render_jsx` | esbuild JSX parse error | Medium — LLM syntax error |
| `not defined` (ReferenceError) | `figma_render_jsx` | Unknown JSX tag in VM sandbox | Medium — LLM used unknown tag |
| `Image generation not configured` | `figma_generate_*`, `figma_edit_image` | No Gemini API key | Config issue |
| `api key not valid` | `figma_generate_*` | Invalid Gemini API key | Config issue |
| `quota exceeded` | `figma_generate_*` | Google Cloud quota hit | Capacity issue |
| `violate content safety` | `figma_generate_*` | Gemini safety filter triggered | Prompt issue |
| `Failed to export node image` | `figma_edit_image`, `figma_restore_image` | Node screenshot export failed | Medium |
| `Object has been destroyed` | N/A (uncaught_exception) | BrowserWindow accessed after destroy | KI-001 |
| `Node not found` | Various manipulation tools | Invalid nodeId | Medium — stale reference |
| `Not a component set` | `figma_arrange_component_set` | Wrong node type | Low |
| `Aborted` | Any tool | User cancelled / agent aborted | Expected |

### By External Dependency

| Dependency | Tools | Failure Modes |
|-----------|-------|---------------|
| **Figma Plugin API** (via WS) | All except REST-based | Timeout, plugin crash, Figma Desktop not running |
| **Figma REST API** | `figma_search_components`, `figma_get_library_components` | 401/403/429, rate limit |
| **Iconify API** | `figma_render_jsx`, `figma_create_icon` | 404, timeout (10s), API down |
| **Gemini API** | `figma_generate_*`, `figma_edit_image` | Auth, quota, safety, 500 |
| **esbuild** | `figma_render_jsx` | JSX syntax errors |

## Agent Error Types

The `usage:agent_error` event has an `errorType` field:

| errorType | Trigger | What it means |
|-----------|---------|---------------|
| `auth` | `err.code === 'EAUTH'` | Provider API key missing or invalid |
| `rate_limit` | `err.status === 429` | Provider rate limited the request |
| `unknown` | All other errors | Catch-all for unexpected failures |

## WebSocket Lifecycle Patterns

### Normal Connection Flow
```
WS connect → FILE_INFO (within 30s) → client registered → active file set
→ commands flow → disconnect → 5s grace → cleanup
```

### Reconnection Pattern
```
WS disconnect → grace timer starts (5s) → reconnect within 5s → state preserved
                                        → no reconnect → state wiped, pending requests rejected
```

### Version Mismatch
```
WS connect → FILE_INFO with old pluginVersion → close(4001) → emit('versionMismatch')
```
Investigation: If `usage:figma_disconnected` has reason containing "version", the user
needs to update the Bottega Bridge plugin.

### Investigating "Figma not responding"
1. Check `usage:figma_connected` / `usage:figma_disconnected` events for the session
2. If no `figma_connected` event exists → plugin never loaded in Figma Desktop
3. If `figma_disconnected` followed quickly by `figma_connected` → reconnection (grace period worked)
4. If multiple disconnects with reason "timeout" → network instability
5. If disconnect reason "version" → plugin version too old

## Compression Context

The active compression profile affects tool result verbosity. When investigating, check
`usage:compression_profile_change` or the settings in `usage:app_launch` to understand context.

| Profile | Mutation Results | Design System | When Used |
|---------|-----------------|---------------|-----------|
| **balanced** | Compressed (~10 tokens) | Compact | Default, 10-30 turns |
| **creative** | Compressed | Compact | 30+ turns, bulk creation |
| **exploration** | Compressed | Full (verbose) | Analysis, audits |
| **minimal** | Full (verbose) | Full | Debugging, <10 turns |

**Why it matters**: If a user reports "the agent lost context", check:
1. `usage:context_level` → `fillPercent` approaching 100%
2. `usage:compaction` events → context was auto-compacted
3. Compression profile → `creative` or `balanced` may have compressed away context the agent needed

## JSX Render Pipeline (3 failure points)

The most complex tool (`figma_render_jsx`) has 3 independent failure stages:

```
Stage 1: Parse JSX (esbuild + VM)
  → Error: "Expected identifier but found..." or ReferenceError
  → Axiom: usage:tool_error with parse error message

Stage 2: Resolve Icons (Iconify API, parallel)
  → Error: "Icon not found" or "Fetch timeout"
  → Behavior: PARTIAL FAILURE OK — failed icons left as-is, tree still renders
  → Axiom: Icon errors may not appear in tool_error if tree partially succeeds

Stage 3: Create in Figma (Plugin API)
  → Error: Plugin timeout or creation error
  → Axiom: usage:tool_error with WS timeout or plugin error
```

**Key**: Stage 2 failures are silent if at least one icon succeeds. The tool reports
success even with missing icons. Look for visual issues in screenshots, not tool errors.

## Renderer Crash Reasons

The `usage:renderer_crash` event has a `reason` field from Electron:

| Reason | What happened | Investigation |
|--------|---------------|---------------|
| `killed` | OS killed the renderer (OOM or SIGTERM) | Check system RAM via heartbeats |
| `crashed` | Renderer segfaulted | Check native crash dumps |
| `oom` | Explicit OOM from V8 | Check processHeapMB trend |
| `abnormal-exit` | Non-zero exit without crash | Check recent tool calls |
| `clean-exit` | Normal exit (unexpected for crash event) | Likely Electron lifecycle issue |
| `launch-failed` | Renderer never started | Electron installation issue |
| `gpu-error` | GPU process crashed | Hardware/driver issue |

For `killed` with exitCode 15 (SIGTERM): macOS OOM killer intervened. Check
`freeRamGB` from heartbeats — if near 0, the system (not Bottega) ran out of memory.
