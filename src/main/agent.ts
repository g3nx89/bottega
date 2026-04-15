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
import type { CompactDesignSystem, DesignSystemCache } from './compression/design-system-cache.js';
import { createCompressionExtensionFactory } from './compression/extension-factory.js';
import type { CompressionMetricsCollector } from './compression/metrics.js';
import type { FigmaCore } from './figma-core.js';
import type { ImageGenerator } from './image-gen/image-generator.js';
import { MetricsRegistry } from './metrics-registry.js';
import { ModelProbe } from './model-probe.js';
import type { OperationQueueManager } from './operation-queue-manager.js';
import { ScopedConnector } from './scoped-connector.js';
import { buildSystemPrompt, type DsBlockData } from './system-prompt.js';
import { createTaskExtensionFactory } from './tasks/extension-factory.js';
import { TaskStore } from './tasks/store.js';
import { createTaskTools } from './tasks/tools.js';
import { createFigmaTools } from './tools/index.js';
import { composeCapabilities } from './workflows/capability-composer.js';
import { buildDesignWorkflowContext } from './workflows/design-context.js';
import { createWorkflowExtensionFactory, type WorkflowState } from './workflows/extension-factory.js';
import { resolveIntent } from './workflows/intent-router.js';
import type { DesignWorkflowContext } from './workflows/types.js';

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
  // F20: 'openai' now means API key only. ChatGPT Codex OAuth moved to its own
  // display group 'openai-codex' to disambiguate the two login surfaces.
  openai: 'openai-codex',
  'openai-codex': 'openai-codex',
  google: 'google-gemini-cli',
};

/** Human-readable info for display groups (used in both main & renderer) */
export const OAUTH_PROVIDER_INFO: Record<string, { label: string; description: string }> = {
  anthropic: { label: 'Anthropic', description: 'Claude Pro / Max' },
  openai: { label: 'OpenAI', description: 'API key (platform.openai.com)' },
  'openai-codex': { label: 'ChatGPT (Codex)', description: 'ChatGPT Plus / Pro subscription' },
  google: { label: 'Google', description: 'Gemini (free)' },
};

/** Context window sizes in tokens per model ID */
export const CONTEXT_SIZES: Record<string, number> = {
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
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

/** Strip markdown headers, XML tags, and newlines to prevent prompt injection. */
function sanitizeDsValue(s: string): string {
  return s.replace(/[#<>\n\r]/g, '').slice(0, 100);
}

/** Summarize DS variables matching a predicate into a compact `key=value` string. */
function summarizeVars(
  ds: CompactDesignSystem,
  predicate: (name: string, v: { type: string; values: Record<string, string | number | boolean> }) => boolean,
  limit: number,
): string | undefined {
  const matches = ds.variables
    .flatMap((col) => Object.entries(col.vars))
    .filter(([name, v]) => predicate(name, v))
    .slice(0, limit);

  if (matches.length === 0) return undefined;

  return matches
    .map(([name, v]) => {
      const firstValue = Object.values(v.values)[0];
      const safeName = sanitizeDsValue(name.split('/').pop() ?? name);
      const safeValue = firstValue !== undefined ? sanitizeDsValue(String(firstValue)) : 'none';
      return `${safeName}=${safeValue}`;
    })
    .join(' ');
}

/** Convert cached DS data to the compact DsBlockData for the system prompt. */
function readDesignSystemBlock(cache: DesignSystemCache, fileKey: string): DsBlockData | undefined {
  const ds = cache.get(true, fileKey) as CompactDesignSystem | null;
  if (!ds || !('dsStatus' in ds)) return undefined;
  const compact = ds as CompactDesignSystem;

  return {
    colors: summarizeVars(compact, (_, v) => v.type === 'COLOR', 8),
    typography: summarizeVars(compact, (name) => /font|type|size/i.test(name), 6),
    spacing: summarizeVars(compact, (name, v) => v.type === 'FLOAT' && /spacing|space|gap|padding/i.test(name), 8),
    radii: summarizeVars(compact, (name, v) => v.type === 'FLOAT' && /radius|radii|rounded/i.test(name), 6),
    status: compact.dsStatus,
  };
}

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
  taskExtensionFactory: (pi: any) => void;
  workflowExtensionFactory: (pi: any) => void;
  setActiveTaskStore: (store: TaskStore | undefined) => void;
  /** Update the current user message and fileKey for workflow intent resolution. */
  setWorkflowContext: (message: string, fileKey: string) => void;
  wsServer: FigmaWebSocketServer;
  figmaAPI: FigmaAPI;
  queueManager: OperationQueueManager;
  /** Test-observable runtime counters; snapshot via BOTTEGA_AGENT_TEST IPC. */
  metricsRegistry: MetricsRegistry;
  /** F11: shared per-session ModelProbe with TTL cache. */
  modelProbe: ModelProbe;
  getImageGenerator?: () => ImageGenerator | null;
}

/**
 * F1: Classify stream errors from Pi SDK into structured shape for telemetry.
 * Pi SDK surfaces provider errors in varying shapes — extract httpStatus and
 * errorCode from known fields without leaking tokens.
 */
export interface ClassifiedStreamError {
  httpStatus: number | null;
  errorCode: string | null;
  errorBody: string;
}

export function classifyStreamError(err: any): ClassifiedStreamError {
  const httpStatus =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.statusCode === 'number'
        ? err.statusCode
        : typeof err?.response?.status === 'number'
          ? err.response.status
          : null;
  const errorCode =
    typeof err?.code === 'string'
      ? err.code
      : typeof err?.errorCode === 'string'
        ? err.errorCode
        : typeof err?.name === 'string' && err.name !== 'Error'
          ? err.name
          : null;
  const body =
    typeof err?.body === 'string'
      ? err.body
      : typeof err?.response?.body === 'string'
        ? err.response.body
        : typeof err?.response?.data === 'string'
          ? err.response.data
          : typeof err?.message === 'string'
            ? err.message
            : String(err);
  return { httpStatus, errorCode, errorBody: body };
}

/** Tracker shape consumed by the wrapper — matches UsageTracker surface. */
export interface StreamErrorSink {
  trackLlmStreamError(data: {
    provider: string;
    modelId: string;
    httpStatus: number | null;
    errorCode: string | null;
    errorBody: string;
    durationMs: number;
    promptId?: string;
    slotId?: string;
    turnIndex?: number;
  }): void;
  trackPromptCancelled?(data: {
    provider: string;
    modelId: string;
    durationMs: number;
    promptId?: string;
    slotId?: string;
    turnIndex?: number;
  }): void;
}

export interface PromptSessionLike {
  prompt: (text: string, options?: any) => Promise<unknown>;
}

/**
 * Wrap a session.prompt() call with error capture. Emits usage:llm_stream_error
 * for rejections, usage:prompt_cancelled for AbortError, and rethrows so existing
 * handlers still fire.
 */
export async function wrapPromptWithErrorCapture(
  session: PromptSessionLike,
  text: string,
  modelConfig: ModelConfig,
  tracker: StreamErrorSink | undefined,
  context: { promptId?: string; slotId?: string; turnIndex?: number } = {},
  options?: any,
): Promise<unknown> {
  const start = Date.now();
  try {
    return await (options === undefined ? session.prompt(text) : session.prompt(text, options));
  } catch (err: any) {
    const durationMs = Date.now() - start;
    if (err?.name === 'AbortError') {
      tracker?.trackPromptCancelled?.({
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        durationMs,
        ...context,
      });
      throw err;
    }
    const { httpStatus, errorCode, errorBody } = classifyStreamError(err);
    tracker?.trackLlmStreamError({
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      httpStatus,
      errorCode,
      errorBody,
      durationMs,
      ...context,
    });
    throw err;
  }
}

/**
 * B-020: Safely reload auth storage if the method exists.
 * Pi SDK's AuthStorage.reload() is not on the public interface but exists on
 * the file-based implementation. Reloading picks up externally refreshed OAuth
 * tokens before reading credentials.
 */
export function safeReloadAuth(authStorage: AuthStorage): void {
  if (typeof (authStorage as any).reload === 'function') {
    (authStorage as any).reload();
  }
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

  let _activeTaskStore: TaskStore | undefined;
  const taskExtensionFactory = createTaskExtensionFactory(() => _activeTaskStore);

  // Workflow extension — per-fileKey state to prevent bleed across tabs/slots
  interface PerSlotWorkflowState {
    message: string;
    previousMode?: import('./workflows/types.js').InteractionMode;
    modeBeforeReview?: import('./workflows/types.js').InteractionMode;
    cachedState: WorkflowState | null | undefined;
    cacheKey: string;
  }
  const _workflowStateMap = new Map<string, PerSlotWorkflowState>();
  let _activeWorkflowFileKey = '';

  const workflowExtensionFactory = createWorkflowExtensionFactory((): WorkflowState | null => {
    const fileKey = _activeWorkflowFileKey;
    const slot = _workflowStateMap.get(fileKey);
    if (!slot || !slot.message) return null;

    const key = `${slot.message}|${fileKey}`;
    if (slot.cacheKey === key && slot.cachedState !== undefined) {
      return slot.cachedState;
    }

    const ds = designSystemCache.get(true, fileKey) as CompactDesignSystem | null;
    const dsStatus: DesignWorkflowContext['dsStatus'] = ds?.dsStatus ?? 'unknown';

    const context = buildDesignWorkflowContext({
      dsStatus,
      userMessage: slot.message,
      previousMode: slot.previousMode,
      modeBeforeReview: slot.modeBeforeReview,
    });
    const resolution = resolveIntent(slot.message, context);

    const result: WorkflowState | null = resolution.pack
      ? {
          context: resolution.context,
          pack: resolution.pack,
          composed: composeCapabilities(resolution.pack.capabilities),
        }
      : null;

    // Persist mode for next turn so transitions propagate correctly
    if (context.interactionMode === 'review' && slot.previousMode !== 'review') {
      slot.modeBeforeReview = slot.previousMode;
    }
    slot.previousMode = resolution.context.interactionMode;

    slot.cacheKey = key;
    slot.cachedState = result;
    return result;
  });

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
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
    taskExtensionFactory,
    workflowExtensionFactory,
    setActiveTaskStore: (s) => {
      if (_activeTaskStore !== s) {
        _activeTaskStore = s;
        taskExtensionFactory.reset();
      }
    },
    setWorkflowContext: (message: string, fileKey: string) => {
      _activeWorkflowFileKey = fileKey;
      if (!_workflowStateMap.has(fileKey)) {
        _workflowStateMap.set(fileKey, { message: '', cachedState: undefined, cacheKey: '' });
      }
      const slot = _workflowStateMap.get(fileKey)!;
      slot.message = message;
      slot.cachedState = undefined;
      slot.cacheKey = '';
    },
    wsServer: figmaCore.wsServer,
    figmaAPI: figmaCore.figmaAPI,
    queueManager,
    metricsRegistry: new MetricsRegistry(),
    // F11: telemetry wired later via setModelProbeTelemetry() to avoid a
    // circular dep on UsageTracker.
    modelProbe: new ModelProbe(authStorage),
    getImageGenerator: opts.getImageGenerator,
  };
}

/** Shared helper: builds resource loader + creates agent session. */
async function buildAgentSession(
  infra: AgentInfra,
  tools: ToolDefinition[],
  modelConfig: ModelConfig,
  fileKey?: string,
): Promise<CreateAgentSessionResult> {
  const model = getModel(modelConfig.provider as any, modelConfig.modelId as any);

  const allModels = Object.values(AVAILABLE_MODELS).flat();
  const entry = allModels.find((m) => m.sdkProvider === modelConfig.provider && m.id === modelConfig.modelId);
  const modelLabel = entry?.label || modelConfig.modelId;

  // Read DS block from cache if fileKey available
  const dsData = fileKey ? readDesignSystemBlock(infra.designSystemCache, fileKey) : undefined;

  const resourceLoader = new DefaultResourceLoader({
    cwd: os.tmpdir(),
    systemPrompt: buildSystemPrompt(modelLabel, dsData),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [infra.compressionExtensionFactory, infra.taskExtensionFactory, infra.workflowExtensionFactory],
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
  getProvider?: () => string,
): { tools: ToolDefinition[]; connector: ScopedConnector; taskStore: TaskStore } {
  const connector = new ScopedConnector(infra.wsServer, fileKey);
  const operationQueue = infra.queueManager.getQueue(fileKey);

  const figmaTools = createFigmaTools({
    connector,
    figmaAPI: infra.figmaAPI,
    operationQueue,
    wsServer: infra.wsServer,
    getImageGenerator: infra.getImageGenerator,
    designSystemCache: infra.designSystemCache,
    configManager: infra.configManager,
    fileKey,
    getProvider,
  });

  const taskStore = new TaskStore();
  const taskTools = createTaskTools(taskStore);
  const tools = [...figmaTools, ...taskTools];

  return { tools, connector, taskStore };
}

/**
 * Create an agent session for a specific slot (file-scoped tools already created).
 * Used by SlotManager when creating or recreating sessions per-tab.
 */
export async function createFigmaAgentForSlot(
  infra: AgentInfra,
  scopedTools: ToolDefinition[],
  modelConfig: ModelConfig = DEFAULT_MODEL,
  fileKey?: string,
): Promise<CreateAgentSessionResult> {
  return buildAgentSession(infra, scopedTools, modelConfig, fileKey);
}
