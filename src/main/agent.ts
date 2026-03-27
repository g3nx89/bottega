import os from 'node:os';
import path from 'node:path';
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
import type { FigmaAPI } from '../figma/figma-api.js';
import type { FigmaWebSocketServer } from '../figma/websocket-server.js';
import type { CompressionConfigManager } from './compression/compression-config.js';
import type { DesignSystemCache } from './compression/design-system-cache.js';
import { createCompressionExtensionFactory } from './compression/extension-factory.js';
import type { CompressionMetricsCollector } from './compression/metrics.js';
import type { FigmaCore } from './figma-core.js';
import type { ImageGenerator } from './image-gen/image-generator.js';
import type { OperationQueueManager } from './operation-queue-manager.js';
import { ScopedConnector } from './scoped-connector.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createFigmaTools } from './tools/index.js';

export interface ModelConfig {
  provider: string; // Pi SDK provider ID: 'anthropic' | 'openai' | 'openai-codex' | 'google' | 'google-gemini-cli'
  modelId: string; // e.g. 'claude-sonnet-4-6', 'gpt-5.4', 'gemini-3.1-pro'
}

export const DEFAULT_MODEL: ModelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
export const VALID_THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set<ThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);
export function isThinkingLevel(s: string): s is ThinkingLevel {
  return VALID_THINKING_LEVELS.has(s as ThinkingLevel);
}

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
 * Shared agent infrastructure: auth, compression, and Figma core references.
 * Created once, reused across session recreations and slot creation.
 */
export interface AgentInfra {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  sessionManager: SessionManager;
  configManager: CompressionConfigManager;
  designSystemCache: DesignSystemCache;
  metricsCollector: CompressionMetricsCollector;
  compressionExtensionFactory: (pi: any) => void;
  wsServer: FigmaWebSocketServer;
  figmaAPI: FigmaAPI;
  queueManager: OperationQueueManager;
  getImageGenerator?: () => ImageGenerator | null;
}

/**
 * Default sessions directory: ~/.bottega/sessions/
 * Each app launch creates a new JSONL session file. Model switches
 * are recorded as entries within the same session.
 */
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.bottega', 'sessions');

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
  // Compression infrastructure (dynamic imports: biome auto-converts static value imports to type-only)
  const { CompressionConfigManager } = await import('./compression/compression-config.js');
  const { DesignSystemCache } = await import('./compression/design-system-cache.js');
  const { CompressionMetricsCollector } = await import('./compression/metrics.js');

  const configManager = new CompressionConfigManager();
  const designSystemCache = new DesignSystemCache(() => configManager.getActiveConfig().designSystemCacheTtlMs);
  const metricsCollector = new CompressionMetricsCollector('app-session', 'pending', 1_000_000);
  const compressionExtensionFactory = createCompressionExtensionFactory(configManager, metricsCollector);

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const sessionManager = SessionManager.create(os.tmpdir(), opts.sessionsDir || DEFAULT_SESSIONS_DIR);
  const { OperationQueueManager: OQM } = await import('./operation-queue-manager.js');
  const queueManager = new OQM();

  return {
    authStorage,
    modelRegistry,
    sessionManager,
    configManager,
    designSystemCache,
    metricsCollector,
    compressionExtensionFactory,
    wsServer: figmaCore.wsServer,
    figmaAPI: figmaCore.figmaAPI,
    queueManager,
    getImageGenerator: opts.getImageGenerator,
  };
}

/** Shared helper: builds resource loader + creates agent session. */
async function buildAgentSession(
  infra: AgentInfra,
  tools: ToolDefinition[],
  modelConfig: ModelConfig,
): Promise<CreateAgentSessionResult> {
  const model = getModel(modelConfig.provider as any, modelConfig.modelId as any);

  const allModels = Object.values(AVAILABLE_MODELS).flat();
  const entry = allModels.find((m) => m.sdkProvider === modelConfig.provider && m.id === modelConfig.modelId);
  const modelLabel = entry?.label || modelConfig.modelId;

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

  return createAgentSession({
    cwd: os.tmpdir(),
    model,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
    tools: [],
    customTools: tools,
    resourceLoader,
    sessionManager: infra.sessionManager,
    authStorage: infra.authStorage,
    modelRegistry: infra.modelRegistry,
  });
}

/**
 * Create file-scoped tools for a specific Figma file.
 * Each call produces a ScopedConnector pinned to `fileKey` and a per-file OperationQueue,
 * so tools automatically target the right file without the caller passing fileKey around.
 */
export function createScopedTools(
  infra: AgentInfra,
  fileKey: string,
): { tools: ToolDefinition[]; connector: ScopedConnector } {
  const connector = new ScopedConnector(infra.wsServer, fileKey);
  const operationQueue = infra.queueManager.getQueue(fileKey);

  const tools = createFigmaTools({
    connector,
    figmaAPI: infra.figmaAPI,
    operationQueue,
    wsServer: infra.wsServer,
    getImageGenerator: infra.getImageGenerator,
    designSystemCache: infra.designSystemCache,
    configManager: infra.configManager,
    fileKey,
  });

  return { tools, connector };
}

/**
 * Create an agent session for a specific slot (file-scoped tools already created).
 * Used by SlotManager when creating or recreating sessions per-tab.
 */
export async function createFigmaAgentForSlot(
  infra: AgentInfra,
  scopedTools: ToolDefinition[],
  modelConfig: ModelConfig = DEFAULT_MODEL,
): Promise<CreateAgentSessionResult> {
  return buildAgentSession(infra, scopedTools, modelConfig);
}
