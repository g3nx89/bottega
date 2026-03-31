# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bottega — a macOS Electron desktop app for design pair-programming. Users describe what they want in natural language, an AI agent (Pi SDK) operates on Figma Desktop via WebSocket, shows screenshots, and iterates based on feedback.

## Architecture

```
Electron Main Process (src/main/)
├── index.ts              — App entry: Electron window + WS server + agent startup
├── agent.ts              — Pi SDK AgentSession with custom system prompt, no coding tools
├── figma-core.ts         — Wires FigmaWebSocketServer + WebSocketConnector + FigmaAPI
├── operation-queue.ts    — Promise-based mutex for serializing Figma mutations
├── operation-queue-manager.ts — Multi-queue manager (per-file queue isolation)
├── ipc-handlers.ts       — Bridges agent events → renderer via IPC
├── ipc-handlers-auth.ts  — Auth-specific IPC handlers (OAuth, API keys)
├── session-events.ts     — Agent session event wiring (message-end, usage, analytics)
├── preload.ts            — contextBridge exposing window.api (MUST be built as CJS)
├── system-prompt.ts      — LLM system prompt with tool reference and design patterns
├── jsx-parser.ts         — JSX string → TreeNode via esbuild transform + vm sandbox
├── icon-loader.ts        — Iconify API fetch with in-memory cache
├── prompt-suggester.ts   — AI-powered follow-up prompt suggestions (IPC → clickable chips)
├── prompt-queue.ts       — Queues user prompts when agent is busy
├── safe-send.ts          — IPC crash guard (no-op if renderer destroyed)
├── scoped-connector.ts   — Per-session scoped Figma connector
├── session-store.ts      — Multi-session persistence store
├── slot-manager.ts       — Agent slot allocation and lifecycle
├── app-state-persistence.ts — Save/restore app state across restarts
├── auto-updater.ts       — Electron auto-update via electron-updater
├── startup-guards.ts     — Single-instance lock, port availability checks
├── diagnostics.ts        — Runtime diagnostic reporting
├── usage-tracker.ts      — Token/API usage tracking
├── remote-logger.ts      — Axiom remote log transport
├── vitals.ts             — App health metrics
├── messages.ts           — Agent message type definitions
├── renderable-messages.ts — Message → renderer format conversion
├── fs-utils.ts           — File system helpers
├── compression/          — Context compression (config, extension-factory, design-system-cache, mutation-compressor, metrics, color-utils, execute-enricher, project-tree)
├── image-gen/            — Gemini-based image generation (config, generator, prompt builders)
└── tools/                — 39 ToolDefinition[] for Pi SDK (TypeBox schemas)
    ├── index.ts          — Aggregator, ToolDeps interface, textResult helper, abort-check wrapper
    ├── core.ts           — execute, screenshot, status, get_selection
    ├── discovery.ts      — get_file_data, search_components, get_library_components, get_component_details, get_component_deep, analyze_component_set, design_system
    ├── components.ts     — instantiate, set_instance_properties, arrange_component_set
    ├── manipulation.ts   — set_fills, set_strokes, set_text, set_image_fill, resize, move, create_child, clone, delete, rename
    ├── tokens.ts         — setup_tokens, lint
    ├── annotations.ts    — get_annotations, set_annotations, get_annotation_categories
    ├── jsx-render.ts     — render_jsx, create_icon, bind_variable
    └── image-gen.ts      — generate_image, edit_image, restore_image, generate_icon, generate_pattern, generate_story, generate_diagram

Figma Core (src/figma/)           — Embedded from figma-console-mcp (MIT), cloud relay removed
├── websocket-server.ts           — WS server on port 9280, sendCommand with Promise correlation
├── websocket-connector.ts        — IFigmaConnector impl + 3 figma-use methods
├── figma-connector.ts            — IFigmaConnector interface
├── figma-api.ts                  — Figma REST API client
├── types.ts                      — Shared types + TreeNode
├── logger.ts, port-discovery.ts

Desktop Bridge Plugin (figma-desktop-bridge/)   — Fork of figma-console-mcp plugin
├── code.js               — Plugin main thread (upstream + CREATE_FROM_JSX/ICON/BIND_VARIABLE)
├── ui.html               — WebSocket relay bridge
└── manifest.json          — Plugin config (name: "Bottega Bridge")

Renderer (src/renderer/)          — Vanilla HTML/CSS/JS, no framework
├── index.html             — Chat layout with CSP headers
├── styles.css             — macOS-native design, #A259FF accent, dark mode
├── app.js                 — Streaming text, tool cards, screenshots, markdown
├── settings.js            — Settings panel (auth, model select, API keys, compression)
└── slash-commands.js      — Slash command menu handling
```

## Build & Development

```bash
npm install
npm run build                   # esbuild: main (ESM) + preload (CJS) → dist/
npm start                       # build + run the app
npx electron dist/main.js       # run without rebuilding
npm test                        # vitest run
npm run test:e2e                # Playwright e2e tests (builds first)
npm run test:coverage           # vitest with coverage report
npm run lint                    # biome check src/ tests/
npm run lint:fix                # biome auto-fix
npm run check                   # typecheck + lint + lint:types + test + lint:dead + audit:deps
npm run test:uat                # Playwright UAT tests (builds first)
npm run test:agent              # Playwright agent-level tests (builds first)
npm run test:agent:smoke        # Agent smoke tests only (@smoke tag)
npm run test:agent:imagegen     # Agent image generation tests
npm run lint:types              # eslint type-level checks
npm run lint:arch               # semgrep architectural linting (requires semgrep)
npm run build:check             # build + bundle size check
npx tsc --noEmit                # type check only
npm run package                 # build + electron-builder .dmg
```

**Pre-commit hooks** (husky + lint-staged + commitlint):
- Staged `{src,tests}/**/*.ts` files are auto-formatted via `biome check --write`
- Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)

**Debug mode** (attach Playwright or DevTools):
```bash
npx electron --remote-debugging-port=9222 dist/main.js
```

**Smoke test** (Playwright-Electron):
```bash
node tests/electron-smoke.mjs
```

## Key Dependencies

- `@mariozechner/pi-coding-agent` / `@mariozechner/pi-ai` — Pi SDK (AgentSession, ToolDefinition, DefaultResourceLoader)
- `@sinclair/typebox` — Tool parameter schemas (TypeBox, NOT Zod)
- `ws` — WebSocket server for Figma Desktop Bridge communication
- `esbuild` — Build tool AND runtime dep (JSX transform in jsx-parser.ts)
- `@iconify/utils` / `@iconify/core` — Icon SVG generation for figma_create_icon / figma_render_jsx
- `@google/genai` — Gemini API for AI image generation tools
- `@axiomhq/pino` — Remote logging transport to Axiom
- `archiver` — ZIP archiving (diagnostics export)
- `electron-updater` — Auto-update support
- `pino` / `pino-pretty` — Structured logging
- `vitest` — Test runner; `@biomejs/biome` — Linter/formatter; `@playwright/test` — E2E

## Environment Setup

- **Figma Desktop Bridge**: The plugin in `figma-desktop-bridge/` must be loaded in Figma Desktop (Plugins → Development → Import plugin from manifest). Without it, the WS connection won't establish.
- **Gemini API key**: Required for image generation tools. Configured in the app's Settings UI.
- **Axiom token**: Optional — enables remote logging via `@axiomhq/pino`. Without it, logs are local-only.
- **GitHub releases**: Published to `g3nx89/bottega`. Code signing requires Apple Developer certs + notarization.

## Important Patterns

- **Mutation serialization**: All mutation tools go through `OperationQueue.execute()` to prevent concurrent Figma modifications.
- **JSX rendering flow**: LLM generates JSX → `jsx-parser.ts` (esbuild transform + vm sandbox with tag name mappings) → TreeNode → icons pre-fetched from Iconify → single `CREATE_FROM_JSX` plugin roundtrip.
- **Preload MUST be CJS**: Electron's sandbox requires CommonJS for preload scripts. The build produces `format: 'cjs'` for preload only, `format: 'esm'` for main.
- **node_modules are external**: `packages: 'external'` in esbuild — all npm deps resolve at runtime from node_modules, not bundled.
- **WS events emit objects**: `fileConnected` emits `{ fileKey, fileName }`, not a plain string.
- **Pi SDK system prompt**: Injected via `DefaultResourceLoader({ systemPrompt })` with `noExtensions/noSkills/noPromptTemplates/noThemes: true`.
- **Tool params typed as `any`**: ToolDefinition generic inference doesn't work when returning `ToolDefinition[]`. Params are cast to `any` in execute — runtime validation is via TypeBox schemas.
- **Upstream sync**: `src/figma/` and `figma-desktop-bridge/` are embedded/forked. Track in respective `UPSTREAM.md` files.
- **Context compression**: `compression/` profiles tune how verbose tool results are. Active profile switchable at runtime via IPC; the extension factory reads live config on every `tool_result`.
- **Image generation**: `image-gen/` wraps Gemini API (`@google/genai`). Tools can generate, edit, and restore images on Figma nodes. Requires a Gemini API key configured in Settings.
- **Prompt suggester**: After each agent turn, `prompt-suggester.ts` generates follow-up suggestions via a lightweight LLM call, forwarded as clickable chips in the renderer.

## Tool Categories (39 tools)

- **Core** (4): `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection`
- **Discovery** (7): `figma_get_file_data`, `figma_search_components`, `figma_get_library_components`, `figma_get_component_details`, `figma_get_component_deep`, `figma_analyze_component_set`, `figma_design_system`
- **Components** (3): `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`
- **Manipulation** (10): `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_set_image_fill`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`, `figma_rename`
- **Tokens** (2): `figma_setup_tokens`, `figma_lint`
- **Annotations** (3): `figma_get_annotations`, `figma_set_annotations`, `figma_get_annotation_categories`
- **JSX Render** (3): `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable`
- **Image Gen** (7): `figma_generate_image`, `figma_edit_image`, `figma_restore_image`, `figma_generate_icon`, `figma_generate_pattern`, `figma_generate_story`, `figma_generate_diagram`

## Playbook Test Harness

Deterministic agent testing without LLM calls — replaces the model with scripted responses while exercising real tools, compression extension, and OperationQueue.

**Files:**
- `tests/helpers/playbook.ts` — DSL: `when()`, `calls()`, `says()`, late-bound `() => params`, `.chain()` chaining
- `tests/helpers/event-collector.ts` — Event recording with query helpers (`toolSequence()`, `mutationTools()`, `compressedResults()`)
- `tests/helpers/bottega-test-session.ts` — Creates real Pi SDK AgentSession with playbook streamFn + mocked deps
- `tests/unit/main/agent-playbook.test.ts` — Base tests (pipeline, chaining, multi-turn)
- `tests/unit/main/agent-playbook-extended.test.ts` — Extended tests (compression e2e, OperationQueue serialization, JSX pipeline, error recovery, realistic tool chains)

**Quick start:** `createBottegaTestSession({ toolDeps, mockTools, compressionProfile })` → `t.run(when("prompt", [calls("tool", params), says("text")]))` → assert on `t.events`. See `agent-playbook.test.ts` for examples.

**When to write playbook tests:**
- New tool: write a playbook test exercising it against mock connector
- Bug regression: reproduce with a scripted scenario before fixing
- Compression changes: verify profile behavior with `compressionProfile` option
- Tool chain validation: test multi-step sequences with `.chain()` + late-bound params

**When NOT to use playbook (use agent tests instead):**
- Testing system prompt effectiveness (requires real LLM)
- Testing model-specific behavior (reasoning, tool selection quality)
- Testing WebSocket resilience (requires real connection)

## Test Helpers (`tests/helpers/`)

- `mock-connector.ts` — `createTestToolDeps()` (complete ToolDeps with real OperationQueue + mocked everything else), `createMockConnector()`, `createMockWsServer()`, `createMockFigmaAPI()`, `createMockDesignSystemCache()`, `createMockConfigManager()`
- `mock-session.ts` — `createMockSession()` with `emitEvent()` for subscriber testing
- `mock-slot-manager.ts` — `createMockSlotManager()` for multi-tab IPC tests
- `mock-ipc.ts` / `mock-window.ts` — Electron IPC and BrowserWindow mocks
- `scripted-session.ts` — `ScriptedSession` replays event sequences (for IPC handler tests)
- `script-fragments.ts` — Factory functions: `textDeltaEvents()`, `toolCallEvents()`, `screenshotToolEvents()`, etc.
- `playbook.ts` / `event-collector.ts` / `bottega-test-session.ts` — Playbook harness (see above)

## Language & Conventions

- TypeScript with ESM modules (main process), CJS (preload only)
- esbuild for bundling (not webpack/vite)
- Vanilla JS renderer (no React/Vue)
- Project documentation and PLAN.md are in Italian

