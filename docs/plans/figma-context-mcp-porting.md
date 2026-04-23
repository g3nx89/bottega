# Figma-Context-MCP porting — future work

Tracks follow-up tasks from the April 2026 analysis of [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) v0.11.0 (26 commits since v0.7.0). Initial port done in commit scope: `HttpError` + `ErrorCategory` (see `src/figma/errors.ts`).

Upstream is MIT licensed (© 2025 Graham Lipsman). Ported files carry a header note with attribution.

## Phase A — Finish #1+#2 follow-up

The error-handling refactor landed the plumbing but the downstream consumers still emit generic errors to logs and UI. Close the loop so the new metadata actually reaches Axiom dashboards and user-visible surfaces.

### A.1 — Tag throw sites in tools/* with ErrorCategory
- **Files**: `src/main/tools/*.ts`, `src/main/tools/plugin-api-linter.ts`
- **Scope**: wrap non-HTTP throws via `tagError(err, { category: '...' })` — categories applicable: `invalid_input` (TypeBox/schema fail, figma_execute linter hard errors), `network` (WS bridge timeout), `internal` (unexpected programmer errors).
- **Test**: extend `errors.test.ts` with `getErrorMeta(thrown).category === 'invalid_input'` assertions on representative tools.

### A.2 — Axiom logger: emit `error_category` as top-level field ✅ DONE
- **File**: `src/figma/logger.ts` — added `errSerializer` pino serializer that merges `getErrorMeta(err)` into the record as `error_category`, `http_status`, `network_code`, `is_retryable`.
- **Remaining**: verify live Axiom dashboard has breakdown widget grouped by `error_category`. Dashboard creation is out of scope here.

### A.3 — Surface `figmaErr` in renderer tool cards
- **Files**: `src/main/safe-send.ts`, `src/main/renderable-messages.ts`, `src/renderer/app.js`
- **Scope**: when a tool execution throws `HttpError` with `figmaErr`, include the short form in the tool card error state so the user sees "Missing scope: library_content:read" instead of a truncated stack.
- **Test**: playbook test that asserts the emitted event payload contains `figmaErr` and `category`.

### A.4 — Category-aware retry policy
- **File**: `src/figma/figma-api.ts::request()`
- **Scope**: use `getErrorMeta(err).is_retryable` rather than the static `RETRYABLE_CODES` set so exotic transient codes from intermediaries can be retryable without editing the code. Skip retry explicitly when `category === 'auth'` even if server returns 5xx during an auth error (rare but observed on Figma).
- **Risk**: loops on mis-tagged non-retryable codes. Keep current set as the authoritative default; meta acts as an override only.

## Phase B — Additional GLips ports (independent scope)

Ranked by ROI. Each is a standalone PR with its own test plan.

### B.1 — Rich text markdown extraction (upstream `759d0e4`)
- **Value**: text nodes preserve `**bold**`, `*italic*`, `~~strike~~`, `[link](url)`, lists. Agent sees structure rather than flattened characters string.
- **Adapter required**: GLips operates on `FigmaDocumentNode` from `@figma/rest-api-spec`; Bottega receives WS-delivered text with `characters` + `characterStyleOverrides` + `styleOverrideTable`. Run-merging logic is reusable, input format adapter has to be written.
- **Target surface**: `src/main/tools/discovery.ts::scan_text_nodes`, and `figma_get_file_data` text extraction path.
- **Compression impact**: add a compression profile flag (e.g. `rich_text: true`) so the behavior is opt-in during rollout.
- **Risk**: YAML output where `**foo**` might confuse downstream YAML parsers. Escape strategy required (single-quote wrap when markdown markers detected).
- **Effort**: 1–2 days with tests.

### B.2 — Component BOOLEAN/TEXT property surfacing (upstream `b0f9efc`)
- **Value**: `figma_get_component_deep` exposes hidden conditional layers + `{ type, defaultValue }` per property. Agent learns which `figma_set_instance_properties({ showBadge: true })` calls are valid before trying.
- **Plugin-side change**: `figma-desktop-bridge/code.js::DEEP_GET_COMPONENT` must enumerate `visible=false` children (plugin API supports this) and annotate which property controls each.
- **Output size**: cap hidden-children count to avoid Table-of-Tables blowups; extend existing `componentProperties` truncation flag.
- **Risk**: extension and compression code that counts `children.length` will see higher values. Audit callers.
- **Effort**: 1–2 days, includes bridge plugin change.

### B.3 — Proxy support (upstream `32d5779` + `a22f28f` revert)
- **Value**: unblocks enterprise users behind corporate HTTPS proxies.
- **Scope**: honor `HTTPS_PROXY`/`HTTP_PROXY`/`FIGMA_PROXY` env vars in `src/figma/figma-api.ts::request()` via `undici.EnvHttpProxyAgent`. Guard to avoid regression when no proxy env is set.
- **Gap**: TLS-intercepting proxies also need `NODE_EXTRA_CA_CERTS` support. Implementing proxy alone is a partial solution; decide scope before starting.
- **Effort**: ~2h for env wiring + ~1 day for cert handling + enterprise smoke test.

## Phase C — REST tool expansion (not GLips-dependent)

Bottega's `FigmaAPI` class already implements more endpoints than are surfaced as tools. Expose them for agent use:
- `figma_rest_get_variables` — combined wrapper over `getLocalVariables` + `getPublishedVariables`, merged shape.
- `figma_rest_comments` — read (`getComments`) + post (`postComment`) + delete (`deleteComment`).
- `figma_rest_export_images` — bulk `getImages` with scale/format options and file writeback (PNG/SVG/PDF).
- `figma_rest_get_file` — REST snapshot independent of the WS bridge (works offline from Figma Desktop).

**Effort**: ~300 LOC total + tests. Zero risk (reuses existing `FigmaAPI` methods, new tools wrapped by `OperationQueue` only where they mutate).

## Phase D — Figma official MCP integration (`use_figma`)

Not a GLips port. Figma ships an official MCP server (`https://mcp.figma.com/mcp` remote, desktop variant for Dev/Full paid seats). Integrating it would let Bottega's Pi SDK agent call `use_figma` and other Figma MCP tools alongside the existing WS tools.

### D.1 — Add MCP client dependency
- Add `@modelcontextprotocol/sdk` to `package.json` (not currently present).
- Verify version compatibility with Pi SDK runtime.

### D.2 — MCP client module
- **New file**: `src/main/mcp-client.ts`
- Establish connection to Figma MCP endpoint, handle auth via Figma OAuth (reuse token logic from `src/main/ipc-handlers-auth.ts`).
- Optionally support the desktop variant (local port) when detected.

### D.3 — Tool wrapper
- Expose Figma MCP tools as Pi SDK `ToolDefinition[]` so the agent sees them next to `figma_execute`, `figma_render_jsx`, etc.
- Namespace prefix to avoid collision (e.g. `figma_mcp_use`, `figma_mcp_get_code`).

### D.4 — Settings UI toggle
- **File**: `src/renderer/settings.js` + `src/main/app-state-persistence.ts`
- On/off switch and remote-vs-desktop selector. Default off until the integration is stable.

**Effort**: ~3 days for a minimum viable integration excluding auth edge cases.

#### D — Test plan
- **Unit**: mock MCP client transport, assert tool list normalization (Figma MCP tools → Pi SDK `ToolDefinition[]`), OAuth token refresh path.
- **Integration**: live connection to `https://mcp.figma.com/mcp` with a test Figma account + test file. Assert `use_figma` round-trip succeeds and result is surfaced in agent transcript.
- **E2E (Playwright-Electron)**: settings toggle enables client, tool appears in agent tool list, agent invokes it on a prompt.
- **Resilience**: connection drop mid-call surfaces a typed error (not silent hang); token expiry triggers re-auth flow, not crash.

#### D — Exit criteria (GO/NO-GO to ship)
- All unit + integration tests green.
- E2E: 10 consecutive full-flow runs pass without flakes.
- Metrics: `use_figma` p95 latency ≤ 2× baseline WS `figma_execute` round-trip.
- Settings toggle default remains OFF until `use_figma` round-trip error rate < 1% over 1 week of beta traffic.
- Rollback plan: toggle off + feature flag kill switch ships in same release as enabling path.
- Security: OAuth token stored via existing `figma-auth.json` + `safeStorage`; never in memory dumps or logs.

## Out of scope (NOT porting)

Explicitly declined from GLips v0.11.0:
- `29cff0c` perf O(n²) — relies on a simplification pipeline Bottega doesn't have.
- `b5724ad` async tree walker + progress — MCP-transport specific.
- `9dfb1cb` stateless HTTP transport refactor — MCP-transport specific.
- `dd237c8` CLI fetch subcommand — Bottega is a desktop app.
- `dd47ebf` / `62b9f94` jimp deps — Bottega does not use jimp.
- `6c0666a` PostHog telemetry — Bottega uses Axiom.
- `a077ace` duplicate style disambiguation — depends on the simplification pipeline.
- `19c50b3` BOOLEAN_OPERATION SVG collapse — plugin-side collapse not relevant to Bottega bridge.
- MCP SDK upgrade chores — covered by Phase D when we add the SDK ourselves.

## Attribution template for ported files

Files carrying ported code should include this at the top:

```ts
/**
 * Adapted from Figma-Context-MCP (MIT, © 2025 Graham Lipsman).
 * https://github.com/GLips/Figma-Context-MCP — commit <short-sha>, v<version>
 *
 * Bottega-specific changes: <summary>.
 */
```
