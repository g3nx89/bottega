import { getModel } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import {
  AuthStorage,
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import os from 'os';
import path from 'path';
import type { CompressionConfigManager } from './compression/compression-config.js';
import type { DesignSystemCache } from './compression/design-system-cache.js';
import { createCompressionExtensionFactory } from './compression/extension-factory.js';
import type { CompressionMetricsCollector } from './compression/metrics.js';
import type { FigmaCore } from './figma-core.js';
import type { ImageGenerator } from './image-gen/image-generator.js';
import { OperationQueue } from './operation-queue.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createFigmaTools } from './tools/index.js';

export interface ModelConfig {
  provider: string; // Pi SDK provider ID: 'anthropic' | 'openai' | 'openai-codex' | 'google' | 'google-gemini-cli'
  modelId: string; // e.g. 'claude-sonnet-4-6', 'gpt-5.4', 'gemini-3.1-pro'
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
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.4-mini': 1_000_000,
  'gpt-5.4-nano': 1_000_000,
  'gpt-5.3-codex': 1_000_000,
  'gemini-3-flash': 1_000_000,
  'gemini-3.1-pro': 1_000_000,
  'gemini-3.1-flash-lite': 1_000_000,
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
    { id: 'gpt-5.4', label: 'GPT-5.4', sdkProvider: 'openai' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', sdkProvider: 'openai' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', sdkProvider: 'openai' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', sdkProvider: 'openai-codex' },
  ],
  google: [
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash', sdkProvider: 'google' },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', sdkProvider: 'google' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', sdkProvider: 'google' },
  ],
};

/**
 * Shared agent infrastructure: tools, auth, resource loader, compression.
 * Created once, reused across session recreations.
 */
export interface AgentInfra {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  sessionManager: SessionManager;
  figmaTools: ToolDefinition[];
  configManager: CompressionConfigManager;
  designSystemCache: DesignSystemCache;
  metricsCollector: CompressionMetricsCollector;
  compressionExtensionFactory: (pi: any) => void;
}

/**
 * Default sessions directory: ~/.figma-cowork/sessions/
 * Each app launch creates a new JSONL session file. Model switches
 * are recorded as entries within the same session.
 */
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.figma-cowork', 'sessions');

export interface AgentInfraOptions {
  sessionsDir?: string;
  getImageGenerator?: () => ImageGenerator | null;
}

export async function createAgentInfra(
  figmaCore: FigmaCore,
  options?: AgentInfraOptions | string,
): Promise<AgentInfra> {
  // Backwards-compatible: accept string (sessionsDir) or options object
  const opts: AgentInfraOptions = typeof options === 'string' ? { sessionsDir: options } : options || {};
  const operationQueue = new OperationQueue();

  // Compression infrastructure (dynamic imports: biome auto-converts static value imports to type-only)
  const { CompressionConfigManager } = await import('./compression/compression-config.js');
  const { DesignSystemCache } = await import('./compression/design-system-cache.js');
  const { CompressionMetricsCollector } = await import('./compression/metrics.js');

  const configManager = new CompressionConfigManager();
  const designSystemCache = new DesignSystemCache(() => configManager.getActiveConfig().designSystemCacheTtlMs);
  const metricsCollector = new CompressionMetricsCollector('app-session', 'pending', 1_000_000);
  const compressionExtensionFactory = createCompressionExtensionFactory(configManager, metricsCollector);

  const figmaTools = createFigmaTools({
    connector: figmaCore.connector,
    figmaAPI: figmaCore.figmaAPI,
    operationQueue,
    wsServer: figmaCore.wsServer,
    getImageGenerator: opts.getImageGenerator,
    designSystemCache,
    configManager,
  });

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const sessionManager = SessionManager.create(os.tmpdir(), opts.sessionsDir || DEFAULT_SESSIONS_DIR);

  return {
    authStorage,
    modelRegistry,
    sessionManager,
    figmaTools,
    configManager,
    designSystemCache,
    metricsCollector,
    compressionExtensionFactory,
  };
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
  const entry = allModels.find((m) => m.sdkProvider === modelConfig.provider && m.id === modelConfig.modelId);
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
    extensionFactories: [infra.compressionExtensionFactory],
  });
  await resourceLoader.reload();

  const result = await createAgentSession({
    cwd: os.tmpdir(),
    model,
    thinkingLevel: 'medium',
    tools: [],
    customTools: infra.figmaTools,
    resourceLoader,
    sessionManager: infra.sessionManager,
    authStorage: infra.authStorage,
    modelRegistry: infra.modelRegistry,
  });

  return result;
}
