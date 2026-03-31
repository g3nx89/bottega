---
name: bottega-architecture
description: Use when working on Bottega's architecture — Electron main process, Pi SDK AgentSession, IPC handlers, preload bridge, WebSocket Figma connector, JSX rendering pipeline, compression infrastructure, or agent lifecycle. Triggers include "IPC handler", "preload", "agent session", "WebSocket", "compression", "JSX parser", "system prompt", "model switching", "figma-core", "renderer event".
---

# Bottega — Architecture Guide

## When to Use

- Adding or modifying IPC channels (main ↔ renderer)
- Changing agent session lifecycle (create, subscribe, switch model, abort)
- Working on the WebSocket bridge or Figma Desktop plugin
- Modifying the JSX→Figma rendering pipeline
- Updating compression/caching infrastructure
- Changing the system prompt or tool registration
- Working on the renderer (vanilla JS chat UI)

## Full Architecture

```
┌─────────────────────── Electron App ───────────────────────┐
│                                                             │
│  Renderer (src/renderer/)          Preload (CJS!)           │
│  ┌──────────────────┐             ┌──────────────┐         │
│  │ index.html       │◄──IPC──────►│ preload.ts   │         │
│  │ styles.css       │  contextBridge │ (CJS bundle)│        │
│  │ app.js           │             └──────┬───────┘         │
│  │ (vanilla JS)     │                    │                  │
│  └──────────────────┘                    │ ipcRenderer      │
│                                          ▼                  │
│  Main Process (src/main/)                                   │
│  ┌──────────────────────────────────────────┐              │
│  │ index.ts — App entry                     │              │
│  │  ├─ createFigmaCore(port:9223)           │              │
│  │  ├─ createAgentInfra(figmaCore)          │              │
│  │  ├─ createFigmaAgent(infra)              │              │
│  │  ├─ BrowserWindow(preload, contextIso)   │              │
│  │  └─ setupIpcHandlers(session, window)    │              │
│  └──────────────────────────────────────────┘              │
│       │                    │                                │
│       ▼                    ▼                                │
│  ┌──────────┐    ┌─────────────────┐                       │
│  │ agent.ts │    │ ipc-handlers.ts │                       │
│  │ Pi SDK   │    │ IPC channels    │                       │
│  │ session  │    │ agent:prompt    │                       │
│  └────┬─────┘    │ auth:*          │                       │
│       │          │ window:*        │                       │
│       ▼          └─────────────────┘                       │
│  ┌─────────────────────────────────────┐                   │
│  │ tools/ — 34 ToolDefinition[]         │                   │
│  │  └─ operationQueue.execute()        │                   │
│  │     └─ connector.method()           │                   │
│  └──────────┬──────────────────────────┘                   │
│             │ WebSocket (port 9223)                         │
└─────────────┼──────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────┐
│ Figma Desktop Bridge Plugin         │
│ figma-desktop-bridge/               │
│  ├─ code.js  — Plugin main thread   │
│  ├─ ui.html  — WebSocket relay      │
│  └─ manifest.json                   │
│                                     │
│ Runs inside Figma Desktop's sandbox │
│ Full figma.* Plugin API access      │
└─────────────────────────────────────┘
```

## Module-by-Module Reference

### 1. index.ts — App Entry Point

Startup sequence (order matters):
1. `createFigmaCore({ port: 9223 })` → WebSocket server
2. `ImageGenerator` initialization (default + user API key)
3. `createAgentInfra(figmaCore)` → shared tools, auth, compression
4. `createFigmaAgent(infra)` → Pi SDK AgentSession
5. `BrowserWindow` creation (preload, contextIsolation, vibrancy)
6. `setupIpcHandlers(session, window, infra)` → IPC bridge
7. Figma event forwarding (`fileConnected`, `disconnected`, `documentChange`)

**Window config** (macOS-native feel):
```typescript
{
  width: 480, height: 720,
  titleBarStyle: 'hiddenInset',
  vibrancy: 'sidebar',
  trafficLightPosition: { x: 12, y: 12 },
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),  // CJS!
    contextIsolation: true,
    nodeIntegration: false,
  },
}
```

**Graceful shutdown**: `cleanup()` stops FigmaCore. Handles `SIGINT`, `SIGTERM`, `before-quit`.

### 2. agent.ts — Pi SDK Agent Session

**Key exports:**
- `ModelConfig` — `{ provider, modelId }` (e.g. `{ provider: 'anthropic', modelId: 'claude-sonnet-4-6' }`)
- `AgentInfra` — Shared infrastructure (auth, tools, compression) created once, reused across model switches
- `createAgentInfra(figmaCore)` — One-time setup
- `createFigmaAgent(infra, modelConfig)` — Creates a new AgentSession (called on model switch too)

**Model switching pattern:**
```typescript
// Agent infra is shared — only the session is recreated
const result = await createFigmaAgent(infra, newModelConfig);
session = result.session;
subscribeToSession(session);  // re-attach event handlers
```

**Pi SDK configuration:**
- `DefaultResourceLoader` with `cwd: os.tmpdir()` (avoids loading project CLAUDE.md)
- `noExtensions/noSkills/noPromptTemplates/noThemes: true` (clean sandbox)
- `extensionFactories: [compressionExtensionFactory]` — compression hooks
- `thinkingLevel: 'medium'` — balanced thinking
- `tools: []` + `customTools: figmaTools` — only our custom tools, no built-in Pi coding tools

**Available models:**
- Anthropic: Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
- OpenAI: GPT-5.4, Mini, Nano, Codex (via `openai-codex` OAuth)
- Google: Gemini 3 Flash, 3.1 Pro, 3.1 Flash Lite

### 3. ipc-handlers.ts — IPC Bridge

All IPC channels use `ipcMain.handle()` (invoke/handle pattern, not send/on).

**Channel categories:**

| Prefix | Purpose |
|--------|---------|
| `agent:*` | Prompt, abort, thinking, events |
| `auth:*` | Models, API keys, OAuth login/logout, model switching |
| `window:*` | Pin (always-on-top), opacity |
| `imagegen:*` | Image generation config |
| `compression:*` | Profile management, cache invalidation |

**Agent event forwarding** (session.subscribe → webContents.send):

| Pi SDK Event | IPC Channel | Data |
|-------------|-------------|------|
| `message_update` (text_delta) | `agent:text-delta` | delta string |
| `message_update` (thinking_delta) | `agent:thinking` | delta string |
| `tool_execution_start` | `agent:tool-start` | toolName, callId |
| `tool_execution_end` | `agent:tool-end` | toolName, callId, success, result |
| `message_end` | `agent:usage` | { input, output, total } |
| `agent_end` | `agent:end` | (none) |
| `auto_compaction_start/end` | `agent:compaction` | boolean |
| `auto_retry_start/end` | `agent:retry` | boolean |

**Screenshot forwarding**: When `figma_screenshot` tool ends, the image content is extracted and sent via `agent:screenshot`.

**Adding a new IPC channel:**
1. Add `ipcMain.handle('prefix:name', handler)` in `ipc-handlers.ts`
2. Add `contextBridge` method in `preload.ts`
3. Call via `window.api.methodName()` in renderer

### 4. preload.ts — Context Bridge

**CRITICAL: Must be built as CJS** (Electron sandbox requirement).

Build config in `scripts/build.mjs`:
```javascript
// preload: CJS format
{ entryPoints: ['src/main/preload.ts'], format: 'cjs', ... }
// main: ESM format
{ entryPoints: ['src/main/index.ts'], format: 'esm', ... }
```

The preload exposes `window.api` with typed methods. Pattern:

```typescript
contextBridge.exposeInMainWorld('api', {
  // Invoke (renderer → main, returns promise)
  myAction: (arg: string) => ipcRenderer.invoke('prefix:action', arg),

  // Listen (main → renderer, callback)
  onMyEvent: (cb: (data: any) => void) => {
    ipcRenderer.on('prefix:event', (_event, data) => cb(data));
  },
});
```

**Security rules:**
- NEVER expose `ipcRenderer` directly
- ALWAYS use `contextBridge.exposeInMainWorld()`
- Validate/sanitize in the handler, not the preload
- Keep the preload thin — just forwarding, no logic

### 5. figma-core.ts — WebSocket Infrastructure

Wires together:
- `FigmaWebSocketServer` — WS server on port 9223
- `WebSocketConnector` — `IFigmaConnector` implementation with 30+ methods
- `FigmaAPI` — REST API client (for library component search)

**Events emitted by wsServer:**
- `fileConnected` → `{ fileKey, fileName }` (NOT a plain string!)
- `disconnected` → (no data)
- `documentChange` → `{ hasStyleChanges, hasNodeChanges }` (triggers cache invalidation)

### 6. system-prompt.ts — LLM System Prompt

Template with `{{MODEL}}` placeholder replaced at session creation.

Contains:
- Workflow guide (analyze → check → discover → plan → execute → verify → iterate)
- Tool selection tables (which tool for which task)
- `figma_render_jsx` JSX reference (elements, shorthand props, examples)
- `figma_execute` Plugin API reference (async IIFE, operation order, node creation)
- Critical rules and anti-patterns
- Component workflow
- Image generation tools guide
- Design principles

**When to update**: Adding new tools, changing tool behavior, fixing LLM misuse patterns.

### 7. jsx-parser.ts — JSX Rendering Pipeline

```
JSX string → esbuild transform (jsx→h() calls) → vm.runInContext → TreeNode
```

- Uses `esbuild.transformSync()` with `jsxFactory: 'h'`
- Runs in a `vm.Context` sandbox with tag name mappings (Frame→frame, Text→text, etc.)
- Output `TreeNode` is sent to the plugin via `connector.createFromJsx()`
- Icons in the tree are resolved in parallel via `resolveIcons()` before sending

**Supported elements**: Frame, View, Rectangle/Rect, Ellipse, Text, Line, Svg, Image, Icon, Fragment

### 8. operation-queue.ts — Mutation Serializer

Promise-based mutex queue. All mutation tools call `operationQueue.execute(fn)` which:
1. Enqueues the function
2. If not already draining, starts sequential execution
3. Returns the resolved value of the function

This prevents concurrent WebSocket commands to the Figma plugin, which would cause race conditions.

### 9. Compression Infrastructure (src/main/compression/)

- `CompressionConfigManager` — Manages compression profiles (minimal, standard, detailed)
- `DesignSystemCache` — TTL-based cache for design system data
- `CompressionMetricsCollector` — Tracks token savings
- `createCompressionExtensionFactory` — Pi SDK extension hooks for compression
- `projectTree()` — Reduces Figma tree data to projected views (minimal/standard/detailed)

Cache is invalidated on `documentChange` events from Figma.

### 10. image-gen/ — AI Image Generation

Wraps Gemini API (`@google/genai`) for generating, editing, and restoring images on Figma nodes.

- `ImageGenerator` — Manages Gemini client and API key
- `config.ts` — Model list and configuration
- `prompt-builders.ts` — Structured prompt templates for icons, patterns, diagrams, stories, batch ops

7 tools in `tools/image-gen.ts`: `figma_generate_image`, `figma_edit_image`, `figma_restore_image`, `figma_generate_icon`, `figma_generate_pattern`, `figma_generate_story`, `figma_generate_diagram`.

Requires a Gemini API key configured in Settings → Image Generation.

### 11. prompt-suggester.ts — Follow-up Suggestions

After each agent turn, generates follow-up prompt suggestions via a lightweight LLM call. Suggestions are sent to the renderer via IPC as clickable chips.

### 12. safe-send.ts — IPC Crash Guard

`safeSend(webContents, channel, ...args)` — no-op if renderer is destroyed. Prevents crashes during cleanup when main process outlives the renderer window.

## Build System

```bash
node scripts/build.mjs   # esbuild: main (ESM) + preload (CJS) → dist/
npx electron dist/main.js # run
npx tsc --noEmit          # type check
```

**Key build constraints:**
- `packages: 'external'` — all npm deps resolve at runtime, not bundled
- Main process: ESM (`format: 'esm'`)
- Preload: CJS (`format: 'cjs'`) — Electron sandbox requirement
- Output: `dist/` directory

## Renderer (src/renderer/)

Vanilla HTML/CSS/JS — no React, no Vue, no framework.

- `index.html` — Chat layout with CSP headers
- `styles.css` — macOS-native design, #A259FF accent color, dark mode
- `app.js` — Streaming text rendering, tool cards, screenshots, markdown parsing

Accesses main process via `window.api.*` (exposed by preload).

## Adding a New Feature — Decision Tree

```
Is it a new Figma operation?
  → Add a tool (see bottega-tools skill)

Is it a new UI element in the chat?
  → Modify renderer app.js/styles.css
  → If it needs main process data: add IPC channel

Is it a new settings/config option?
  → Add IPC handler + preload method + renderer UI

Is it a new AI capability?
  → Modify system-prompt.ts
  → Possibly add new tools

Is it about data compression/optimization?
  → Work in src/main/compression/
  → Update compression profiles/config
```
