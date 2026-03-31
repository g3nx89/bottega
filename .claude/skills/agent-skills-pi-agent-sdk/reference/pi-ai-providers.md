# pi-ai Provider Reference (Verified 0.54.2)

This file documents provider-level behavior for `@mariozechner/pi-ai` as of `0.54.2`.

## Source-Of-Truth Pointers

- `packages/ai/src/types.ts` (KnownApi / KnownProvider)
- `packages/ai/src/env-api-keys.ts` (env var mapping)
- `packages/ai/README.md` (provider setup, OAuth workflows)
- installed `dist/providers/*.d.ts` (provider-specific options)

## Known APIs

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
```

## Known Providers

| Provider | Typical API | Auth Mode |
|---|---|---|
| `anthropic` | `anthropic-messages` | API key or OAuth token |
| `openai` | `openai-responses` (primary), can also use completions models | API key |
| `azure-openai-responses` | `azure-openai-responses` | API key |
| `openai-codex` | `openai-codex-responses` | OAuth |
| `google` | `google-generative-ai` | API key |
| `google-gemini-cli` | `google-gemini-cli` | OAuth |
| `google-antigravity` | `google-generative-ai` | OAuth |
| `google-vertex` | `google-vertex` | ADC + project/location |
| `amazon-bedrock` | `bedrock-converse-stream` | AWS credentials/profile/token |
| `github-copilot` | OpenAI-compatible transport | OAuth |
| `xai` | `openai-completions` | API key |
| `groq` | `openai-completions` | API key |
| `cerebras` | `openai-completions` | API key |
| `openrouter` | `openai-completions` | API key |
| `vercel-ai-gateway` | `openai-completions` | API key |
| `zai` | `openai-completions` | API key |
| `mistral` | `openai-completions` | API key |
| `minimax` | `openai-completions` | API key |
| `minimax-cn` | `openai-completions` | API key |
| `huggingface` | `openai-completions` | API key/token |
| `opencode` | `openai-completions` | API key |
| `kimi-coding` | `openai-completions` | API key |

## Environment Variables (Current Map)

From `packages/ai/src/env-api-keys.ts`:

| Provider | Env var(s) |
|---|---|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` (preferred) or `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `google-vertex` | ADC + `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |
| `amazon-bedrock` | `AWS_PROFILE` or IAM vars or Bedrock token envs |
| `github-copilot` | `COPILOT_GITHUB_TOKEN` or `GH_TOKEN` or `GITHUB_TOKEN` |
| `mistral` | `MISTRAL_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` |
| `zai` | `ZAI_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY` |
| `huggingface` | `HF_TOKEN` |
| `opencode` | `OPENCODE_API_KEY` |
| `kimi-coding` | `KIMI_API_KEY` |

## Provider-Specific Stream Options (Type-Level)

### OpenAI Responses

```typescript
interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
  reasoningSummary?: "auto" | "detailed" | "concise" | null
  serviceTier?: ResponseCreateParamsStreaming["service_tier"]
}
```

### OpenAI Completions-Compatible

```typescript
interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } }
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
}
```

### Anthropic

```typescript
type AnthropicEffort = "low" | "medium" | "high" | "max"

interface AnthropicOptions extends StreamOptions {
  thinkingEnabled?: boolean
  thinkingBudgetTokens?: number
  effort?: AnthropicEffort
  interleavedThinking?: boolean
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string }
}
```

### Google Generative AI

```typescript
interface GoogleOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "any"
  thinking?: {
    enabled: boolean
    budgetTokens?: number
    level?: GoogleThinkingLevel
  }
}
```

### Azure OpenAI Responses

```typescript
interface AzureOpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
  reasoningSummary?: "auto" | "detailed" | "concise" | null
  azureApiVersion?: string
  azureResourceName?: string
  azureBaseUrl?: string
  azureDeploymentName?: string
}
```

### Bedrock / Vertex

- `BedrockOptions` extends `StreamOptions` (credentialed via AWS SDK environment/profile/role sources).
- `GoogleVertexOptions` extends `StreamOptions` (plus project/location/ADC semantics).

## OAuth Helper APIs

From `pi-ai` OAuth module:

```typescript
loginAnthropic()
loginOpenAICodex()
loginGitHubCopilot()
loginGeminiCli()
loginAntigravity()
refreshOAuthToken(providerId, credentials)
getOAuthApiKey(providerId, credentialsMap)
```

OAuth provider abstraction supports custom registration:

```typescript
registerOAuthProvider(provider)
getOAuthProvider(id)
getOAuthProviders()
```

## Auth Resolution Behavior (Important)

Common resolution order in coding-agent integrations:
1. runtime override (`AuthStorage.setRuntimeApiKey`)
2. persisted auth (`auth.json` API key/oauth)
3. env var fallback (`getEnvApiKey` mapping)
4. custom fallback resolver (for custom providers)

## Custom Provider/Model Tips

- For OpenAI-compatible endpoints (Ollama, vLLM, LM Studio, proxies), use `openai-completions` or `openai-responses` models with explicit `baseUrl`.
- If endpoint quirks exist, use model `compat` fields and custom headers.
- In coding-agent extensions, use `pi.registerProvider()` for runtime provider registration and optional OAuth integration.

## Sanity Check Snippet

```typescript
import { getProviders, getModels } from "@mariozechner/pi-ai"

for (const provider of getProviders()) {
  const models = getModels(provider)
  console.log(provider, models.length)
}
```
