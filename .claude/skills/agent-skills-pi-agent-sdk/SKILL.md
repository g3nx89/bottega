---
name: pi-agent-sdk
description: "Best practices for Pi Agent SDK (@mariozechner/pi-coding-agent). Use when building with createAgentSession, AgentSession, pi-agent-core, pi-ai, pi-web-ui, extensions, custom tools, provider registration, session persistence, RPC/SDK embedding, or web UI components (ChatPanel, AgentInterface, Artifacts, Sandbox)."
---

# Pi Agent SDK - Verified Integration Playbook

This skill is for building and reviewing real integrations with:
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`
- `@mariozechner/pi-web-ui`

It is intentionally implementation-focused: session lifecycle, event streaming, extensions, provider/auth wiring, and production guardrails.

## Verified Baseline (2026-02-23)

Latest npm versions verified during this update:
- `@mariozechner/pi-coding-agent`: `0.54.2`
- `@mariozechner/pi-agent-core`: `0.54.2`
- `@mariozechner/pi-ai`: `0.54.2`

Official sources used:
- `https://github.com/badlogic/pi-mono`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/sdk.md`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/README.md`
- npm registry metadata (`npm view ... version time --json`)

## Required Workflow For Any Pi SDK Task

1. Verify package freshness before coding:

```bash
npm view @mariozechner/pi-coding-agent version
npm view @mariozechner/pi-agent-core version
npm view @mariozechner/pi-ai version
```

2. Prefer official docs and type declarations over memory:
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/docs/rpc.md`
- `packages/coding-agent/docs/providers.md`
- Installed `.d.ts` from your project `node_modules`

3. If behavior is ambiguous, inspect `.d.ts` signatures first (especially for extension event return contracts and `PromptOptions`).

## Architecture (Practical Mental Model)

```text
pi-ai           -> provider abstraction, streaming, auth helpers, model metadata
pi-agent-core   -> agent loop, tool execution, turn/message events, steering/follow-up queues
pi-coding-agent -> session manager, extensions, skills, prompts, resource loading, SDK + CLI + RPC
pi-web-ui       -> Lit-based chat UI components, artifacts, sandbox, storage, tool/message renderers
```

Use this split when debugging:
- Provider/auth bugs: usually `pi-ai` or `ModelRegistry/AuthStorage`
- Tool-loop behavior: usually `pi-agent-core`
- Session persistence, extension hooks, prompt expansion: usually `pi-coding-agent`
- Chat UI, streaming display, artifacts, sandbox, storage: usually `pi-web-ui`

## Quick Start (Programmatic SDK, Current API)

```typescript
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent"

const authStorage = AuthStorage.create() // or AuthStorage.inMemory()
const modelRegistry = new ModelRegistry(authStorage)

const resourceLoader = new DefaultResourceLoader({ cwd: process.cwd() })
await resourceLoader.reload()

const { session } = await createAgentSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
  resourceLoader,
})

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta)
  }
})

await session.prompt("List all TypeScript files")
```

## Runtime Semantics You Must Respect

### 1) Prompting During Streaming
`session.prompt()` while streaming requires `streamingBehavior`:

```typescript
await session.prompt("Interrupt and change direction", { streamingBehavior: "steer" })
await session.prompt("After finish, also do X", { streamingBehavior: "followUp" })
```

If omitted while streaming, it throws.

### 2) Steering vs Follow-up
- `steer`: delivered after current tool call, remaining tool calls are skipped
- `followUp`: waits for current run completion, then starts a new turn

### 3) Session Event Surface (AgentSession)
In addition to core agent events, session emits:
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`

Do not build streaming UI that assumes only text and tool events.

### 4) SessionManager APIs (Current)
Common static methods:
- `SessionManager.create(cwd, sessionDir?)`
- `SessionManager.open(path, sessionDir?)`
- `SessionManager.continueRecent(cwd, sessionDir?)`
- `SessionManager.inMemory(cwd?)`
- `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)`
- `SessionManager.list(cwd, sessionDir?, onProgress?)`
- `SessionManager.listAll(onProgress?)`

## Extensions (Current, High-Value Details)

### Event Families
- Session: `session_start`, `session_before_switch`, `session_switch`, `session_before_fork`, `session_fork`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`
- Agent/message/tool lifecycle: `before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start/update/end`, `context`
- Interception: `tool_call`, `tool_result`, `input`, `user_bash`
- Model: `model_select`

### Return Contracts Matter
Examples:
- `tool_call` returns `{ block?: boolean; reason?: string }`
- `tool_result` returns partial patches `{ content?, details?, isError? }`
- `context` returns `{ messages?: AgentMessage[] }`
- `session_before_compact` returns `{ cancel?: boolean; compaction?: CompactionResult }`

Do not assume old contracts like `appendMessages/prependMessages` unless your installed types confirm them.

### Google-Compatible Enum Rule
For tool parameter enums, use `StringEnum` from `@mariozechner/pi-ai`.
`Type.Union([Type.Literal(...)])` may break Google provider compatibility.

```typescript
import { StringEnum } from "@mariozechner/pi-ai"
import { Type } from "@sinclair/typebox"

const Params = Type.Object({
  action: StringEnum(["list", "add"] as const),
})
```

### Message Injection APIs
- `pi.sendMessage(..., { deliverAs: "steer" | "followUp" | "nextTurn", triggerTurn? })`
- `pi.sendUserMessage(..., { deliverAs?: "steer" | "followUp" })`

Use `sendUserMessage` when the model should treat it as a real user input.

### Provider Registration In Extensions
`pi.registerProvider(name, config)` can:
- add new providers,
- override base URL/headers,
- replace model lists,
- register OAuth-capable providers for `/login`.

## Provider/Auth Guidance (pi-ai + coding-agent)

Known providers currently include:
- `anthropic`, `openai`, `azure-openai-responses`, `openai-codex`
- `google`, `google-gemini-cli`, `google-antigravity`, `google-vertex`
- `amazon-bedrock`, `github-copilot`
- `xai`, `groq`, `cerebras`, `openrouter`, `vercel-ai-gateway`
- `zai`, `mistral`, `minimax`, `minimax-cn`, `huggingface`, `opencode`, `kimi-coding`

Auth resolution in `AuthStorage.getApiKey()` is effectively:
1. runtime override
2. auth.json key/oauth
3. env vars
4. fallback resolver

OAuth helper APIs (pi-ai):
- `loginAnthropic`, `loginOpenAICodex`, `loginGitHubCopilot`, `loginGeminiCli`, `loginAntigravity`
- `refreshOAuthToken`
- `getOAuthApiKey`

## Production Patterns (Recommended)

### 1) Serialize per-session prompts
If multiple inbound requests can hit one session concurrently, add per-session queueing or locking to avoid interleaved output and context races.

### 2) SSE bridge from `message_update`
Stream only `text_delta` to clients unless they explicitly want tool/thinking traces.

### 3) Harden tool boundaries
Use `tool_call` interception for denylist/allowlist, path guards, and destructive-command confirmation.

### 4) Keep extension state replayable
Persist state in tool result `details` and reconstruct from session entries on `session_start`.

### 5) Build for retries/compaction events
Handle `auto_retry_*` and `auto_compaction_*` in UI + telemetry.

## Common Mistakes

- Calling `prompt()` during streaming without `streamingBehavior`
- Returning ad-hoc tool error text instead of throwing in low-level tool execution
- Forgetting `StringEnum` for enum fields in tools used with Google models
- Assuming provider/env list from older versions (missing `minimax-cn`, `opencode`, etc.)
- Treating extension event contracts as stable across versions without checking installed `.d.ts`

## Pi Web UI (`@mariozechner/pi-web-ui`)

Source: `https://github.com/badlogic/pi-mono/tree/main/packages/web-ui`

A **reusable, library-grade web UI component package** for building AI chat interfaces. Built on Lit (Web Components), styled with Tailwind CSS v4, powered by `pi-ai` + `pi-agent-core`. Ships as an NPM package consumed by other apps.

### Tech Stack

| Layer | Technology |
|---|---|
| Component system | Lit + `@mariozechner/mini-lit` (custom helpers, light DOM) |
| Styling | Tailwind CSS v4 (JIT, no shadow DOM) |
| Language | TypeScript (strict ESM, `tsgo` build) |
| LLM SDK | `@mariozechner/pi-ai` |
| Agent runtime | `@mariozechner/pi-agent-core` (Agent, AgentMessage, tool loop) |
| Storage | Browser IndexedDB via abstract `StorageBackend` |
| Icons | Lucide |
| Sandbox | `<iframe sandbox="allow-scripts">` + `postMessage` |
| Build | `tsgo` + Tailwind CLI; dev via Vite |
| Local LLM | Ollama, LM Studio, llama.cpp, vLLM |

### Component Hierarchy

```text
<pi-chat-panel>                  ← Root container (ChatPanel)
  ├── <agent-interface>           ← Main chat UI, bridges Agent instance (AgentInterface)
  │   ├── <message-list>          ← Finalized messages (MessageList, lit repeat keyed)
  │   ├── <streaming-message-container> ← Current streaming msg (rAF batched, deep-clone for Lit)
  │   └── <message-editor>        ← Input + attachments + model selector + thinking level
  └── <artifacts-panel>           ← LLM-generated files live preview (ArtifactsPanel)
       └── HtmlArtifact / SvgArtifact / MarkdownArtifact / PdfArtifact / ExcelArtifact / ...
```

**Layout**: Desktop (>800px) side-by-side 50/50 chat+artifacts; Mobile (<800px) artifacts as full-screen overlay.

### Agent Integration Flow

1. Create `Agent` from `pi-agent-core` with `initialState` and `convertToLlm`
2. Call `chatPanel.setAgent(agent, config)` → wires `AgentInterface`
3. `AgentInterface` subscribes to `AgentEvent`s:
   - `message_start/end`, `turn_start/end`, `agent_start` → `requestUpdate()` (re-render stable list)
   - `message_update` → push to `StreamingMessageContainer` (batched via `requestAnimationFrame`)
   - `agent_end` → clear streaming container, final `requestUpdate()`
4. User input → `MessageEditor` fires `onSend` → `AgentInterface` checks API key → calls `agent.prompt()`

### Custom Message Types

The web-ui extends `pi-agent-core`'s type system:
```typescript
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "user-with-attachments": UserMessageWithAttachments;
    artifact: ArtifactMessage;
  }
}
```
`defaultConvertToLlm` filters out `artifact` messages and converts `user-with-attachments` to standard `user` messages with image/text content blocks before sending to LLM.

### Artifacts System

`ArtifactsPanel` manages `Map<string, Artifact>` (filename → content). LLM tool commands: `create`, `update`, `rewrite`, `get`, `delete`, `logs`.

| Extension | Renderer |
|---|---|
| `.html` | `SandboxedIframe` (live execution) |
| `.svg` | Inline SVG |
| `.md` | `<markdown-block>` |
| `.pdf` | pdfjs-dist |
| `.xlsx/.xls` | SheetJS |
| `.docx` | docx-preview |
| images | `<img>` |
| text/code | Code block |

Key design: Artifact DOM elements **persist in memory** even when panel unmounts (keeps HTML iframes running). `reconstructFromMessages()` replays `artifact` role + `toolResult` messages from session history to restore state on load.

### Sandbox Execution System

Safely runs LLM-generated code (HTML artifacts, JavaScript REPL):

```text
LLM Tool Call → AgentTool.execute() → SandboxedIframe
  → <iframe sandbox="allow-scripts"> (srcdoc)
  → postMessage ↔ RuntimeMessageRouter (singleton) ↔ SandboxRuntimeProviders
```

`SandboxedIframe.prepareHtmlDocument()` injects:
1. Data: `window.attachments`, `window.artifacts` from provider `getData()`
2. Bridge: `RuntimeMessageBridge` for `postMessage` ↔ `await` abstraction
3. Runtime functions: each provider's `getRuntime()` stringified
4. Navigation interceptor: all link clicks → `open-external-url` messages
5. User code wrapped in async IIFE with `window.complete()` call

**`SandboxRuntimeProvider` interface**:
```typescript
interface SandboxRuntimeProvider {
  getData(): Record<string, any>;
  getRuntime(): (sandboxId: string) => void;
  handleMessage?(msg, respond): Promise<void>;
  getDescription(): string;
  onExecutionStart?(sandboxId, signal?): void;
  onExecutionEnd?(sandboxId): void;
}
```
Built-in providers: `ConsoleRuntimeProvider`, `ArtifactsRuntimeProvider`, `AttachmentsRuntimeProvider`, `FileDownloadRuntimeProvider`.

`RuntimeMessageRouter` is a **singleton** replacing multiple `window.addEventListener("message")` with centralized routing by `sandboxId`. Supports both iframe `postMessage` and Chrome Extension `chrome.runtime.onUserScriptMessage`.

### Storage Architecture

```text
AppStorage (global singleton via getAppStorage()/setAppStorage())
  ├── SettingsStore
  ├── ProviderKeysStore
  ├── SessionsStore
  └── CustomProvidersStore
  └── StorageBackend (interface) → IndexedDBStorageBackend (built-in)
```

Sessions stored in two IndexedDB object stores:
- `sessions` — full `SessionData` (model, thinkingLevel, all messages + attachments)
- `sessions-metadata` — lightweight `SessionMetadata` indexed by `lastModified` for sorted listing

### Tool & Message Renderer Registries

Two extensible registries:
- **Tool Renderer Registry** (`tools/renderer-registry.ts`): `toolName → ToolRenderer`. Built-in: `BashRenderer`, `DefaultRenderer`, `CalculateRenderer`, `GetCurrentTimeRenderer`, `ArtifactsToolRenderer`. `setShowJsonMode(true)` for debug raw JSON view.
- **Message Renderer Registry** (`components/message-renderer-registry.ts`): `messageRole → MessageRenderer`. Apps register custom renderers for custom message types. `MessageList` checks this first, then falls back to built-in elements.

### Dialogs

| Dialog | Purpose | API |
|---|---|---|
| `ModelSelector` | Fuzzy-search model picker, keyboard nav (↑↓ Enter) | `ModelSelector.open(currentModel, onSelect)` |
| `SettingsDialog` | Sidebar-tab settings shell, accepts `SettingsTab[]` | `SettingsDialog.open([...tabs])` |
| `ApiKeyPromptDialog` | Inline API key prompt when key missing | `ApiKeyPromptDialog.prompt(provider)` |
| `SessionListDialog` | Browse/delete saved sessions | `SessionListDialog.open(onLoad, onDelete)` |
| `AttachmentOverlay` | Full-screen attachment preview | `AttachmentOverlay.open(attachment)` |
| `ProvidersModelsTab` | Cloud + custom provider management | Used as tab in `SettingsDialog` |

All dialogs self-append to `document.body` and self-remove on close.

### CORS Proxy Routing

`proxy-utils.ts` contains provider-specific proxy logic. `AgentInterface` installs a custom `streamFn` that:
1. Reads current proxy settings from `AppStorage` per call
2. `shouldUseProxyForProvider(provider, apiKey)` decides: Anthropic OAuth (`sk-ant-oat-*`) and Z-AI → proxy; regular API keys and OpenAI → direct
3. Rewrites `model.baseUrl` to `<proxyUrl>/?url=<encodedOriginalUrl>` if needed

### i18n

`utils/i18n.ts`: Full EN/DE translations (200+ strings), TypeScript type-safe keys via module augmentation of `mini-lit`'s `i18nMessages` interface. Set globally via `setLanguage()`.

### Canonical Integration Pattern (from example app)

```typescript
import { Agent } from "@mariozechner/pi-agent-core"
import { ChatPanel, AppStorage, IndexedDBStorageBackend, setAppStorage,
         ApiKeyPromptDialog, createJavaScriptReplTool } from "@mariozechner/pi-web-ui"
import { render, html } from "lit"

// 1. Wire storage
const backend = new IndexedDBStorageBackend({ dbName, version, stores });
const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

// 2. Create chat panel
const chatPanel = new ChatPanel();

// 3. Create Agent and connect
const agent = new Agent({ initialState, convertToLlm: defaultConvertToLlm });
await chatPanel.setAgent(agent, {
  onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
  toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
    const replTool = createJavaScriptReplTool();
    replTool.runtimeProvidersFactory = runtimeProvidersFactory;
    return [replTool];
  }
});

// 4. Render
render(html`<div>${chatPanel}</div>`, document.getElementById("app"));
```

Session persistence, URL-based session routing (`?session=<uuid>`), auto-save on `state-update`, and title editing are handled in the app layer — `web-ui` provides primitives, consumer handles orchestration.

### Package Directory Structure

```text
packages/web-ui/src/
├── index.ts                   ← Public API surface
├── app.css                    ← Tailwind entrypoint
├── ChatPanel.ts               ← Root container
├── components/
│   ├── AgentInterface.ts      ← Core chat + streaming engine
│   ├── MessageList.ts         ← Stable message list
│   ├── StreamingMessageContainer.ts
│   ├── MessageEditor.ts       ← Input with attachments/model/thinking
│   ├── Messages.ts            ← UserMessage, AssistantMessage, ToolMessage, AbortedMessage
│   ├── message-renderer-registry.ts
│   ├── SandboxedIframe.ts     ← Sandbox execution engine
│   ├── ThinkingBlock.ts, AttachmentTile.ts, ConsoleBlock.ts, ExpandableSection.ts, Input.ts
│   ├── ProviderKeyInput.ts, CustomProviderCard.ts
│   └── sandbox/               ← Sandbox runtime providers
│       ├── SandboxRuntimeProvider.ts, RuntimeMessageRouter.ts, RuntimeMessageBridge.ts
│       ├── ArtifactsRuntimeProvider.ts, AttachmentsRuntimeProvider.ts
│       ├── ConsoleRuntimeProvider.ts, FileDownloadRuntimeProvider.ts
├── dialogs/
│   ├── ModelSelector.ts, SettingsDialog.ts, SessionListDialog.ts
│   ├── ApiKeyPromptDialog.ts, AttachmentOverlay.ts, ProvidersModelsTab.ts
│   └── PersistentStorageDialog.ts
├── tools/
│   ├── index.ts, renderer-registry.ts, types.ts
│   ├── javascript-repl.ts, extract-document.ts
│   ├── renderers/ (Default, Bash, Calculate, GetCurrentTime)
│   └── artifacts/ (artifacts.ts, ArtifactElement.ts, Html/Svg/Md/Text/Image/Pdf/Excel/Docx Artifact)
├── storage/
│   ├── app-storage.ts, store.ts, types.ts
│   ├── backends/indexeddb-storage-backend.ts
│   └── stores/ (sessions, settings, provider-keys, custom-providers)
├── prompts/prompts.ts         ← LLM system prompt templates
└── utils/ (attachment-utils, auth-token, format, i18n, model-discovery, proxy-utils)
```

## References In This Skill

- `reference/api-types.md`
- `reference/pi-ai-providers.md`

Use them together with local installed type declarations for final implementation decisions.
