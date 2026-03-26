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
├── ipc-handlers.ts       — Bridges agent events → renderer via IPC
├── preload.ts            — contextBridge exposing window.api (MUST be built as CJS)
├── system-prompt.ts      — LLM system prompt with tool reference and design patterns
├── jsx-parser.ts         — JSX string → TreeNode via esbuild transform + vm sandbox
├── icon-loader.ts        — Iconify API fetch with in-memory cache
├── prompt-suggester.ts   — AI-powered follow-up prompt suggestions (IPC → clickable chips)
├── safe-send.ts          — IPC crash guard (no-op if renderer destroyed)
├── compression/          — Context compression: profiles, metrics, design-system cache, mutation compressor
├── image-gen/            — Gemini-based image generation (config, generator, prompt builders)
└── tools/                — 34 ToolDefinition[] for Pi SDK (TypeBox schemas)
    ├── index.ts          — Aggregator, ToolDeps interface, textResult helper, abort-check wrapper
    ├── core.ts           — execute, screenshot, status, get_selection
    ├── discovery.ts      — get_file_data, search_components, get_library_components, get_component_details, design_system
    ├── components.ts     — instantiate, set_instance_properties, arrange_component_set
    ├── manipulation.ts   — set_fills, set_strokes, set_text, set_image_fill, resize, move, create_child, clone, delete, rename
    ├── tokens.ts         — setup_tokens, lint
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
└── app.js                 — Streaming text, tool cards, screenshots, markdown
```

## Build & Development

```bash
npm install
npm run build                   # esbuild: main (ESM) + preload (CJS) → dist/
npm start                       # build + run the app
npx electron dist/main.js       # run without rebuilding
npm test                        # vitest run
npm run lint                    # biome check src/ tests/
npx tsc --noEmit                # type check only
npx electron-builder --mac      # package .dmg
```

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
- `pino` — Structured logging
- `vitest` — Test runner; `@biomejs/biome` — Linter/formatter

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

## Tool Categories (34 tools)

- **Core** (4): `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection`
- **Discovery** (5): `figma_get_file_data`, `figma_search_components`, `figma_get_library_components`, `figma_get_component_details`, `figma_design_system`
- **Components** (3): `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`
- **Manipulation** (10): `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_set_image_fill`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`, `figma_rename`
- **Tokens** (2): `figma_setup_tokens`, `figma_lint`
- **JSX Render** (3): `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable`
- **Image Gen** (7): `figma_generate_image`, `figma_edit_image`, `figma_restore_image`, `figma_generate_icon`, `figma_generate_pattern`, `figma_generate_story`, `figma_generate_diagram`

## Language & Conventions

- TypeScript with ESM modules (main process), CJS (preload only)
- esbuild for bundling (not webpack/vite)
- Vanilla JS renderer (no React/Vue)
- Project documentation and PLAN.md are in Italian

<!-- OMC:START -->
<!-- OMC:VERSION:4.8.2 -->

# oh-my-claudecode - Intelligent Multi-Agent Orchestration

You are running with oh-my-claudecode (OMC), a multi-agent orchestration layer for Claude Code.
Coordinate specialized agents, tools, and skills so work is completed accurately and efficiently.

<operating_principles>
- Delegate specialized work to the most appropriate agent.
- Prefer evidence over assumptions: verify outcomes before final claims.
- Choose the lightest-weight path that preserves quality.
- Consult official docs before implementing with SDKs/frameworks/APIs.
</operating_principles>

<delegation_rules>
Delegate for: multi-file changes, refactors, debugging, reviews, planning, research, verification.
Work directly for: trivial ops, small clarifications, single commands.
Route code to `executor` (use `model=opus` for complex work). Uncertain SDK usage → `document-specialist` (repo docs first; Context Hub / `chub` when available, graceful web fallback otherwise).
</delegation_rules>

<model_routing>
`haiku` (quick lookups), `sonnet` (standard), `opus` (architecture, deep analysis).
Direct writes OK for: `~/.claude/**`, `.omc/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md`.
</model_routing>

<agent_catalog>
Prefix: `oh-my-claudecode:`. See `agents/*.md` for full prompts.

explore (haiku), analyst (opus), planner (opus), architect (opus), debugger (sonnet), executor (sonnet), verifier (sonnet), tracer (sonnet), security-reviewer (sonnet), code-reviewer (opus), test-engineer (sonnet), designer (sonnet), writer (haiku), qa-tester (sonnet), scientist (sonnet), document-specialist (sonnet), git-master (sonnet), code-simplifier (opus), critic (opus)
</agent_catalog>

<tools>
External AI: `/team N:executor "task"`, `omc team N:codex|gemini "..."`, `omc ask <claude|codex|gemini>`, `/ccg`
OMC State: `state_read`, `state_write`, `state_clear`, `state_list_active`, `state_get_status`
Teams: `TeamCreate`, `TeamDelete`, `SendMessage`, `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`
Notepad: `notepad_read`, `notepad_write_priority`, `notepad_write_working`, `notepad_write_manual`
Project Memory: `project_memory_read`, `project_memory_write`, `project_memory_add_note`, `project_memory_add_directive`
Code Intel: LSP (`lsp_hover`, `lsp_goto_definition`, `lsp_find_references`, `lsp_diagnostics`, etc.), AST (`ast_grep_search`, `ast_grep_replace`), `python_repl`
</tools>

<skills>
Invoke via `/oh-my-claudecode:<name>`. Trigger patterns auto-detect keywords.

Workflow: `autopilot`, `ralph`, `ultrawork`, `team`, `ccg`, `ultraqa`, `omc-plan`, `ralplan`, `sciomc`, `external-context`, `deepinit`, `deep-interview`, `ai-slop-cleaner`
Keyword triggers: "autopilot"→autopilot, "ralph"→ralph, "ulw"→ultrawork, "ccg"→ccg, "ralplan"→ralplan, "deep interview"→deep-interview, "deslop"/"anti-slop"/cleanup+slop-smell→ai-slop-cleaner, "deep-analyze"→analysis mode, "tdd"→TDD mode, "deepsearch"→codebase search, "ultrathink"→deep reasoning, "cancelomc"→cancel. Team orchestration is explicit via `/team`.
Utilities: `ask-codex`, `ask-gemini`, `cancel`, `note`, `learner`, `omc-setup`, `mcp-setup`, `hud`, `omc-doctor`, `omc-help`, `trace`, `release`, `project-session-manager`, `skill`, `writer-memory`, `ralph-init`, `configure-notifications`, `learn-about-omc` (`trace` is the evidence-driven tracing lane)
</skills>

<team_pipeline>
Stages: `team-plan` → `team-prd` → `team-exec` → `team-verify` → `team-fix` (loop).
Fix loop bounded by max attempts. `team ralph` links both modes.
</team_pipeline>

<verification>
Verify before claiming completion. Size appropriately: small→haiku, standard→sonnet, large/security→opus.
If verification fails, keep iterating.
</verification>

<execution_protocols>
Broad requests: explore first, then plan. 2+ independent tasks in parallel. `run_in_background` for builds/tests.
Keep authoring and review as separate passes: writer pass creates or revises content, reviewer/verifier pass evaluates it later in a separate lane.
Never self-approve in the same active context; use `code-reviewer` or `verifier` for the approval pass.
Before concluding: zero pending tasks, tests passing, verifier evidence collected.
</execution_protocols>

<hooks_and_context>
Hooks inject `<system-reminder>` tags. Key patterns: `hook success: Success` (proceed), `[MAGIC KEYWORD: ...]` (invoke skill), `The boulder never stops` (ralph/ultrawork active).
Persistence: `<remember>` (7 days), `<remember priority>` (permanent).
Kill switches: `DISABLE_OMC`, `OMC_SKIP_HOOKS` (comma-separated).
</hooks_and_context>

<cancellation>
`/oh-my-claudecode:cancel` ends execution modes. Cancel when done+verified or blocked. Don't cancel if work incomplete.
</cancellation>

<worktree_paths>
State: `.omc/state/`, `.omc/state/sessions/{sessionId}/`, `.omc/notepad.md`, `.omc/project-memory.json`, `.omc/plans/`, `.omc/research/`, `.omc/logs/`
</worktree_paths>

## Setup

Say "setup omc" or run `/oh-my-claudecode:omc-setup`.

<!-- OMC:END -->
