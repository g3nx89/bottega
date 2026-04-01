# Bottega

A macOS desktop app for **design pair-programming**. Describe what you want in natural language — an AI agent operates directly on Figma Desktop via WebSocket, shows screenshots, and iterates based on your feedback.

[![Version](https://img.shields.io/github/v/release/g3nx89/bottega?label=version)](https://github.com/g3nx89/bottega/releases/latest)
[![CI](https://github.com/g3nx89/bottega/actions/workflows/ci.yml/badge.svg)](https://github.com/g3nx89/bottega/actions/workflows/ci.yml)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)
![Pi SDK](https://img.shields.io/badge/Pi%20SDK-0.64-blue)
![License](https://img.shields.io/badge/license-private-lightgrey)

## How It Works

1. **You chat** — type a natural-language request in the Bottega window.
2. **The agent plans** — powered by [Pi SDK](https://github.com/nicolevanderhoeven/pi-coding-agent), it picks from 49 Figma tools to fulfill your request.
3. **Figma updates live** — a WebSocket bridge plugin relays commands to Figma Desktop in real time.
4. **Visual verification** — the agent takes screenshots, checks its own work, and iterates if needed.

```
┌─────────────┐   IPC    ┌────────────────┐  WebSocket  ┌──────────────────┐
│  Renderer    │◄────────►│  Electron Main │◄───────────►│  Figma Desktop   │
│  (Chat UI)   │          │  (Pi Agent)    │   :9280     │  (Bridge Plugin) │
└─────────────┘          └────────────────┘             └──────────────────┘
```

## Features

- **Multi-model support** — Claude (Anthropic), GPT (OpenAI), and Gemini (Google) via Pi SDK OAuth
- **49 design tools** — create, modify, discover, and lint design elements without leaving the chat
- **JSX rendering** — describe complex layouts in JSX; they're parsed and created in Figma in a single roundtrip
- **Component discovery** — search local and library components, instantiate them, override properties
- **Design tokens** — set up variable collections, lint for token compliance
- **AI image generation** — generate, edit, and restore images on Figma nodes via Gemini API
- **Context compression** — switchable profiles keep long conversations within context limits
- **Auto-update** — built-in update mechanism via `electron-updater`
- **macOS native feel** — dark mode, traffic-light window controls, always-on-top pin

## Prerequisites

- **macOS** (Electron is built for macOS targets)
- **Node.js** 20+
- **Figma Desktop** with the **Bottega Bridge** plugin installed (see [Bridge Setup](#figma-bridge-setup))

## Getting Started

```bash
# Install dependencies
npm install

# Build and run
npm start
```

This builds the main process (ESM) and preload script (CJS) via esbuild, then launches Electron.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Build and run the app |
| `npm run build` | Build only (esbuild → `dist/`) |
| `npm test` | Run unit tests (vitest) |
| `npm run test:e2e` | Build + Playwright-Electron smoke tests |
| `npm run lint` | Lint with Biome |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run check` | Typecheck + lint + test (full CI check) |
| `npm run package` | Build + package `.dmg` via electron-builder |

## Figma Bridge Setup

Bottega communicates with Figma Desktop through a plugin that relays commands over WebSocket.

1. In Figma Desktop, go to **Plugins → Development → Import plugin from manifest…**
2. Select `figma-desktop-bridge/manifest.json` from this repo.
3. Run the plugin — it connects to Bottega's WebSocket server on port `9280`.

The status indicator in Bottega's title bar turns green when connected.

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry point
│   ├── agent.ts             # Pi SDK AgentSession setup
│   ├── figma-core.ts        # WebSocket server + connector + API wiring
│   ├── operation-queue.ts   # Mutex for serializing Figma mutations
│   ├── ipc-handlers.ts      # Agent events → renderer bridge
│   ├── preload.ts           # contextBridge (CJS)
│   ├── system-prompt.ts     # LLM system prompt with tool reference
│   ├── jsx-parser.ts        # JSX → TreeNode via esbuild + vm sandbox
│   ├── icon-loader.ts       # Iconify API cache
│   ├── prompt-suggester.ts  # Follow-up suggestion chips
│   ├── compression/         # Context compression profiles & metrics
│   ├── image-gen/           # Gemini-based image generation
│   └── tools/               # 49 ToolDefinition[] for Pi SDK
│       ├── core.ts          # execute, screenshot, status, get_selection
│       ├── discovery.ts     # file data, components, design system
│       ├── components.ts    # instantiate, properties, arrange
│       ├── manipulation.ts  # fills, strokes, text, resize, move, create, clone, delete
│       ├── tokens.ts        # setup tokens, lint
│       ├── jsx-render.ts    # render JSX, icons, bind variables
│       └── image-gen.ts     # generate/edit/restore images, icons, patterns, diagrams
├── figma/                   # Embedded from figma-console-mcp (MIT)
│   ├── websocket-server.ts  # WS server on port 9280
│   ├── websocket-connector.ts
│   ├── figma-api.ts         # Figma REST API client
│   └── types.ts             # Shared types + TreeNode
└── renderer/                # Vanilla HTML/CSS/JS (no framework)
    ├── index.html           # Chat layout with CSP
    ├── styles.css           # macOS-native dark UI
    └── app.js               # Streaming, tool cards, screenshots, markdown

figma-desktop-bridge/        # Figma plugin (forked from figma-console-mcp)
├── code.js                  # Plugin main thread
├── ui.html                  # WebSocket relay
└── manifest.json            # Plugin manifest
```

### Key Patterns

- **Mutation serialization** — All mutation tools go through `OperationQueue.execute()` to prevent concurrent Figma modifications.
- **JSX rendering pipeline** — LLM generates JSX → esbuild transform + vm sandbox → TreeNode → icons fetched from Iconify → single `CREATE_FROM_JSX` plugin roundtrip.
- **Preload is CJS** — Electron sandbox requires CommonJS for preload; main process uses ESM.
- **Tool params typed as `any`** — Pi SDK's `ToolDefinition[]` return breaks generic inference. Runtime validation is handled by TypeBox schemas.

## Tool Categories

| Category | Count | Examples |
|----------|-------|---------|
| Core | 4 | `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection` |
| Discovery | 8 | `figma_search_components`, `figma_get_library_components`, `figma_design_system`, `figma_scan_text_nodes` |
| Batch | 3 | `figma_batch_set_text`, `figma_batch_set_fills`, `figma_batch_transform` |
| Components | 4 | `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`, `figma_set_variant` |
| Manipulation | 10 | `figma_set_fills`, `figma_set_text`, `figma_resize`, `figma_move`, `figma_create_child` |
| Layout | 1 | `figma_auto_layout` |
| Style | 4 | `figma_set_text_style`, `figma_set_effects`, `figma_set_opacity`, `figma_set_corner_radius` |
| Tokens | 2 | `figma_setup_tokens`, `figma_lint` |
| Annotations | 3 | `figma_get_annotations`, `figma_set_annotations`, `figma_get_annotation_categories` |
| JSX Render | 3 | `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable` |
| Image Gen | 7 | `figma_generate_image`, `figma_edit_image`, `figma_generate_pattern` |

## Development

### Debug Mode

```bash
# Launch with remote debugging (attach DevTools or Playwright)
npx electron --remote-debugging-port=9222 dist/main.js
```

### Run Without Rebuilding

```bash
npx electron dist/main.js
```

### Smoke Test

```bash
node tests/electron-smoke.mjs
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 33 |
| AI agent | Pi SDK (`@mariozechner/pi-coding-agent`) |
| Tool schemas | TypeBox (`@sinclair/typebox`) |
| Build | esbuild |
| Figma bridge | WebSocket (`ws`) |
| Icons | Iconify (`@iconify/core`) |
| Image generation | Gemini API (`@google/genai`) |
| Logging | Pino |
| Tests | Vitest + Playwright |
| Linting | Biome |

## Releases

Download the latest `.dmg` from [Releases](https://github.com/g3nx89/bottega/releases/latest). The app auto-updates via `electron-updater` when new versions are published.

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

## Packaging

```bash
npm run package
```

Produces a signed and notarized `.dmg` for macOS distribution via `electron-builder`. Requires Apple Developer credentials configured in CI (see `.github/workflows/`).
