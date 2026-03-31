# Pi Agent SDK - API Type Reference (Verified 0.54.2)

This file is a practical type-level cheat sheet for day-to-day implementation.
It is based on:
- `@mariozechner/pi-coding-agent@0.54.2`
- `@mariozechner/pi-agent-core@0.54.2`
- `@mariozechner/pi-ai@0.54.2`

## Version Check Commands

```bash
npm view @mariozechner/pi-coding-agent version
npm view @mariozechner/pi-agent-core version
npm view @mariozechner/pi-ai version
```

## `pi-ai` Core Types

```typescript
type KnownApi =
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex"

type KnownProvider =
  | "amazon-bedrock"
  | "anthropic"
  | "google"
  | "google-gemini-cli"
  | "google-antigravity"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "huggingface"
  | "opencode"
  | "kimi-coding"
```

```typescript
type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh"

type Transport = "sse" | "websocket" | "auto"
type CacheRetention = "none" | "short" | "long"

interface StreamOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  apiKey?: string
  transport?: Transport
  cacheRetention?: CacheRetention
  sessionId?: string
  onPayload?: (payload: unknown) => void
  headers?: Record<string, string>
  maxRetryDelayMs?: number
  metadata?: Record<string, unknown>
}

interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel
  thinkingBudgets?: {
    minimal?: number
    low?: number
    medium?: number
    high?: number
  }
}
```

## `pi-agent-core` Critical Types

```typescript
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"

interface AgentState {
  systemPrompt: string
  model: Model<any>
  thinkingLevel: ThinkingLevel
  tools: AgentTool<any>[]
  messages: AgentMessage[]
  isStreaming: boolean
  streamMessage: AgentMessage | null
  pendingToolCalls: Set<string>
  error?: string
}
```

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

## `pi-coding-agent` Session Types

### Session Events

```typescript
type AgentSessionEvent =
  | AgentEvent
  | {
      type: "auto_compaction_start"
      reason: "threshold" | "overflow"
    }
  | {
      type: "auto_compaction_end"
      result: CompactionResult | undefined
      aborted: boolean
      willRetry: boolean
      errorMessage?: string
    }
  | {
      type: "auto_retry_start"
      attempt: number
      maxAttempts: number
      delayMs: number
      errorMessage: string
    }
  | {
      type: "auto_retry_end"
      success: boolean
      attempt: number
      finalError?: string
    }
```

### Prompt Options and Streaming Behavior

```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean
  images?: ImageContent[]
  streamingBehavior?: "steer" | "followUp"
  source?: "interactive" | "rpc" | "extension"
}
```

If `session.isStreaming` and `streamingBehavior` is missing, `prompt()` throws.

### AgentSession Message Injection

```typescript
sendCustomMessage(message, {
  triggerTurn?: boolean,
  deliverAs?: "steer" | "followUp" | "nextTurn"
})

sendUserMessage(content, {
  deliverAs?: "steer" | "followUp"
})
```

## SessionManager APIs

```typescript
SessionManager.create(cwd, sessionDir?)
SessionManager.open(path, sessionDir?)
SessionManager.continueRecent(cwd, sessionDir?)
SessionManager.inMemory(cwd?)
SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)
SessionManager.list(cwd, sessionDir?, onProgress?)
SessionManager.listAll(onProgress?)
```

## Extension Event Types (`pi-coding-agent`)

### Session Events
- `resources_discover`
- `session_start`
- `session_before_switch`
- `session_switch`
- `session_before_fork`
- `session_fork`
- `session_before_compact`
- `session_compact`
- `session_before_tree`
- `session_tree`
- `session_shutdown`

### Agent/Loop Events
- `context`
- `before_agent_start`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `model_select`

### Interception/Input Events
- `tool_call`
- `tool_result`
- `user_bash`
- `input`

## Extension Event Return Contracts

```typescript
interface ContextEventResult {
  messages?: AgentMessage[]
}

interface ToolCallEventResult {
  block?: boolean
  reason?: string
}

interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[]
  details?: unknown
  isError?: boolean
}

interface SessionBeforeSwitchResult {
  cancel?: boolean
}

interface SessionBeforeForkResult {
  cancel?: boolean
  skipConversationRestore?: boolean
}

interface SessionBeforeCompactResult {
  cancel?: boolean
  compaction?: CompactionResult
}

interface SessionBeforeTreeResult {
  cancel?: boolean
  summary?: { summary: string; details?: unknown }
  customInstructions?: string
  replaceInstructions?: boolean
  label?: string
}

type InputEventResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: ImageContent[] }
  | { action: "handled" }
```

## Extension API High-Impact Methods

```typescript
registerTool()
registerCommand()
registerShortcut()
registerFlag()
registerMessageRenderer()
sendMessage()
sendUserMessage()
appendEntry()
setSessionName()
setLabel()
exec()
getActiveTools()
getAllTools()
setActiveTools()
getCommands()
setModel()
getThinkingLevel()
setThinkingLevel()
registerProvider()
```

## Provider Registration Type

```typescript
interface ProviderConfig {
  baseUrl?: string
  apiKey?: string
  api?: Api
  streamSimple?: (model, context, options?) => AssistantMessageEventStream
  headers?: Record<string, string>
  authHeader?: boolean
  models?: ProviderModelConfig[]
  oauth?: {
    name: string
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
    getApiKey(credentials: OAuthCredentials): string
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[]
  }
}
```

## Practical Notes

- `AgentSessionEvent` includes retry and auto-compaction events; wire UI/telemetry accordingly.
- `AuthStorage.create()` and `AuthStorage.inMemory()` are preferred constructors.
- `ModelRegistry.getAvailable()` is synchronous in current typings.
- For tool-call input narrowing, use `isToolCallEventType()`; direct `event.toolName === ...` checks are less type-safe.
