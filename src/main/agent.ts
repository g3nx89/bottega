import { createAgentSession, type CreateAgentSessionResult, SessionManager, AuthStorage, DefaultResourceLoader, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { createFigmaTools } from './tools/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import os from 'os';
import type { FigmaCore } from './figma-core.js';
import { OperationQueue } from './operation-queue.js';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

export interface ModelConfig {
  provider: string;  // Pi SDK provider ID: 'anthropic' | 'openai' | 'openai-codex' | 'google' | 'google-gemini-cli'
  modelId: string;   // e.g. 'claude-sonnet-4-6', 'gpt-4o', 'gpt-5.1', 'gemini-2.5-pro'
}

export const DEFAULT_MODEL: ModelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

/**
 * Maps UI display group names to Pi SDK OAuth provider IDs.
 * Display groups: anthropic, openai, google (what the user sees in account cards).
 * OAuth IDs: what Pi SDK uses for authStorage.login().
 */
export const OAUTH_PROVIDER_MAP: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai-codex',
  google: 'google-gemini-cli',
};

/** Human-readable info for display groups (used in both main & renderer) */
export const OAUTH_PROVIDER_INFO: Record<string, { label: string; description: string }> = {
  anthropic: { label: 'Anthropic', description: 'Claude Pro / Max' },
  openai: { label: 'OpenAI', description: 'ChatGPT Plus / Pro' },
  google: { label: 'Google', description: 'Gemini (free)' },
};

/** Context window sizes in tokens per model ID */
export const CONTEXT_SIZES: Record<string, number> = {
  'claude-opus-4-6':     1_000_000,
  'claude-sonnet-4-6':   1_000_000,
  'claude-haiku-4-5':      200_000,
  'gpt-4o':                128_000,
  'gpt-4o-mini':           128_000,
  'o4-mini':               200_000,
  'o3-mini':               200_000,
  'gpt-5.1':            1_000_000,
  'gpt-5.1-codex-mini': 1_000_000,
  'gemini-2.5-pro':      1_000_000,
  'gemini-2.5-flash':    1_000_000,
};

/**
 * Models grouped by display category.
 * Each entry carries `sdkProvider` — the actual Pi SDK provider ID for getModel().
 * API key models use the base provider (openai, google).
 * OAuth/subscription models use the OAuth provider (openai-codex, google-gemini-cli).
 */
export const AVAILABLE_MODELS: Record<string, { id: string; label: string; sdkProvider: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (1M)', sdkProvider: 'anthropic' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', sdkProvider: 'anthropic' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', sdkProvider: 'anthropic' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o', sdkProvider: 'openai' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', sdkProvider: 'openai' },
    { id: 'o4-mini', label: 'o4-mini', sdkProvider: 'openai' },
    { id: 'o3-mini', label: 'o3-mini', sdkProvider: 'openai' },
    { id: 'gpt-5.1', label: 'GPT-5.1 (Codex)', sdkProvider: 'openai-codex' },
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Mini (Codex)', sdkProvider: 'openai-codex' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', sdkProvider: 'google' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', sdkProvider: 'google' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Free)', sdkProvider: 'google-gemini-cli' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Free)', sdkProvider: 'google-gemini-cli' },
  ],
};

/**
 * Shared agent infrastructure: tools, auth, resource loader.
 * Created once, reused across session recreations.
 */
export interface AgentInfra {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  figmaTools: ToolDefinition[];
}

export async function createAgentInfra(figmaCore: FigmaCore): Promise<AgentInfra> {
  const operationQueue = new OperationQueue();

  const figmaTools = createFigmaTools({
    connector: figmaCore.connector,
    figmaAPI: figmaCore.figmaAPI,
    operationQueue,
    wsServer: figmaCore.wsServer,
  });

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  return { authStorage, modelRegistry, figmaTools };
}

export async function createFigmaAgent(
  infra: AgentInfra,
  modelConfig: ModelConfig = DEFAULT_MODEL,
): Promise<CreateAgentSessionResult> {
  // getModel() expects typed literals; cast for dynamic provider/model selection.
  // modelConfig.provider is the Pi SDK provider ID (e.g. 'openai-codex', 'google-gemini-cli').
  const model = getModel(modelConfig.provider as any, modelConfig.modelId as any);

  // Find human-readable label for the system prompt (search all groups)
  const allModels = Object.values(AVAILABLE_MODELS).flat();
  const entry = allModels.find(m => m.sdkProvider === modelConfig.provider && m.id === modelConfig.modelId);
  const modelLabel = entry?.label || modelConfig.modelId;

  // Build resource loader per session with model-specific system prompt.
  // Use os.tmpdir() as cwd so DefaultResourceLoader doesn't load project CLAUDE.md files.
  const resourceLoader = new DefaultResourceLoader({
    cwd: os.tmpdir(),
    systemPrompt: buildSystemPrompt(modelLabel),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const result = await createAgentSession({
    cwd: os.tmpdir(),
    model,
    thinkingLevel: 'medium',
    tools: [],
    customTools: infra.figmaTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    authStorage: infra.authStorage,
    modelRegistry: infra.modelRegistry,
  });

  return result;
}
