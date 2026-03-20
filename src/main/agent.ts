import { createAgentSession, type CreateAgentSessionResult, SessionManager, AuthStorage, DefaultResourceLoader, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { createFigmaTools } from './tools/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import os from 'os';
import type { FigmaCore } from './figma-core.js';
import { OperationQueue } from './operation-queue.js';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

export interface ModelConfig {
  provider: string;  // 'anthropic' | 'openai' | 'google'
  modelId: string;   // e.g. 'claude-sonnet-4-5', 'gpt-4o', 'gemini-2.5-pro'
}

export const DEFAULT_MODEL: ModelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

/** Context window sizes in tokens per model ID */
export const CONTEXT_SIZES: Record<string, number> = {
  'claude-opus-4-6':   1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5':    200_000,
  'gpt-4o':              128_000,
  'gpt-4o-mini':         128_000,
  'o4-mini':             200_000,
  'o3-mini':             200_000,
  'gemini-2.5-pro':    1_000_000,
  'gemini-2.5-flash':  1_000_000,
};

export const AVAILABLE_MODELS: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (1M context)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
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
  // getModel() expects typed literals; cast for dynamic provider/model selection
  const model = getModel(modelConfig.provider as any, modelConfig.modelId as any);

  // Find human-readable label for the system prompt
  const allModels = AVAILABLE_MODELS[modelConfig.provider] || [];
  const modelLabel = allModels.find(m => m.id === modelConfig.modelId)?.label || modelConfig.modelId;

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
