import { existsSync } from 'node:fs';
import { type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import {
  type AgentInfra,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  filterLevelsForModel,
  isThinkingLevel,
  type ModelConfig,
  safeReloadAuth,
  wrapPromptWithErrorCapture,
} from './agent.js';
import { checkForUpdates, downloadUpdate, getAppVersion, quitAndInstall } from './auto-updater.js';
import { exportDiagnosticsZip, formatSystemInfoForClipboard } from './diagnostics.js';
import type { FigmaAuthStore } from './figma-auth-store.js';
import {
  getInstalledManifestPath,
  getPluginTargetPath,
  type PluginSyncResult,
  syncFigmaPlugin,
} from './figma-plugin-sync.js';
import { effectiveApiKey, type ImageGenSettings, saveImageGenSettings } from './image-gen/config.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_GEN_MODELS, ImageGenerator } from './image-gen/image-generator.js';
import { setupAuthHandlers } from './ipc-handlers-auth.js';
import { setupFigmaAuthHandlers } from './ipc-handlers-figma-auth.js';
import {
  MSG_EXPORT_DIALOG_TITLE,
  MSG_EXPORT_FILTER_NAME,
  MSG_IMAGEGEN_NOT_INITIALIZED,
  MSG_REQUEST_FAILED_FALLBACK,
  messageForStreamError,
} from './messages.js';
import { classifyProbe } from './model-probe.js';
import {
  deriveSupportCode,
  loadDiagnosticsConfig,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
  type UsageTracker,
} from './remote-logger.js';
import { extractRenderableMessages, type RenderableTurn } from './renderable-messages.js';
import { safeSend } from './safe-send.js';
import { ScopedConnector } from './scoped-connector.js';
import { checkSendPreconditions } from './send-gates.js';
import { beginTurn, createEventRouter } from './session-events.js';
import type { SessionStore } from './session-store.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';
import { loadSubagentSettings, saveSubagentSettings } from './subagent/config.js';

export { extractRenderableMessages, type PluginSyncResult, type RenderableTurn, syncFigmaPlugin };

/** Controller returned by setupIpcHandlers for cross-module coordination. */
export interface IpcController {
  /** Subscribe a slot's session events to the renderer. Call after creating or restoring a slot. */
  subscribeSlot(slot: SessionSlot): void;
  /** Register a callback for model config changes. */
  onModelChange(cb: (config: ModelConfig) => void): void;
  /**
   * Fase 4: live view of in-progress judges. Used by the BOTTEGA_AGENT_TEST
   * `test:get-metrics` IPC handler so the snapshot can include
   * `judge.inProgressSlotIds` without exposing module-level state.
   */
  getJudgeInProgress(): ReadonlySet<string>;
}

const log = createChildLogger({ component: 'ipc' });

export interface AgentSessionLike {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: any) => void): void;
  setThinkingLevel?(level: string): void;
  setModel?(model: any): Promise<void>;
  // Optional so mocks/scripted sessions don't need to implement them.
  getAvailableThinkingLevels?(): string[];
  supportsThinking?(): boolean;
  supportsXhighThinking?(): boolean;
  readonly thinkingLevel?: string;
  readonly sessionFile: string | undefined;
  readonly messages: any[];
}

export interface ThinkingCapabilities {
  family: 'anthropic' | 'openai' | 'google' | 'unknown';
  availableLevels: string[];
  supportsThinking: boolean;
  supportsXhigh: boolean;
  currentLevel: string;
}

export interface ImageGenState {
  generator: ImageGenerator | null;
  settings: ImageGenSettings;
}

export interface SetupIpcDeps {
  slotManager: SlotManager;
  mainWindow: BrowserWindow;
  infra: AgentInfra;
  imageGenState?: ImageGenState;
  sessionStore?: SessionStore;
  usageTracker?: UsageTracker;
  figmaAuthStore?: FigmaAuthStore;
}

export function setupIpcHandlers(deps: SetupIpcDeps): IpcController {
  // Tracks in-flight force-rerun judge controllers so tab:close can abort
  // them. Declared early so handlers registered below can reference it.
  const activeBatchControllers = new Map<string, AbortController>();

  const { slotManager, mainWindow, infra, imageGenState, sessionStore, usageTracker, figmaAuthStore } = deps;
  const modelChangeListeners: Array<(config: ModelConfig) => void> = [];

  /** Helper: get slot or throw. */
  function requireSlot(slotId: string): SessionSlot {
    const slot = slotManager.getSlot(slotId);
    if (!slot) throw new Error(`Slot not found: ${slotId}`);
    return slot;
  }

  /** Persist the file→session mapping to disk for a slot. */
  function persistSlotSession(slot: SessionSlot): void {
    if (sessionStore && slot.fileKey && slot.fileName && slot.session.sessionFile) {
      sessionStore.set(slot.fileKey, slot.session.sessionFile, slot.fileName);
    }
  }

  // Session event routing (extracted to session-events.ts)
  const eventRouter = createEventRouter({
    slotManager,
    mainWindow,
    usageTracker,
    persistSlotSession,
    contextSizes: CONTEXT_SIZES,
    infra,
    getConnectorForSlot: (slot: SessionSlot) => {
      // B-018: Prefer the slot's bound fileKey. If the slot has never been bound
      // (e.g. judge toggled on before any fileConnected event landed) but there's
      // a live Bridge connection, fall back to the currently active file so the
      // judge can still run against real screenshots.
      const fileKey = slot.fileKey || infra.wsServer.getConnectedFileInfo()?.fileKey;
      return fileKey ? new ScopedConnector(infra.wsServer, fileKey) : null;
    },
  });
  const { subscribeToSlot } = eventRouter;

  // ── Task tracking (per-slot) ───────────

  ipcMain.handle('task:list', (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    return slot.taskStore.list();
  });

  // ── Agent prompt/abort ─────────────────

  ipcMain.handle('agent:prompt', async (_event, slotId: string, text: string) => {
    const slot = requireSlot(slotId);

    // B-020: Reload auth storage before each prompt to pick up refreshed OAuth tokens.
    safeReloadAuth(infra.authStorage);
    // F4 + F12: delegate gate checks to send-gates module (unit-tested in isolation).
    const gate = await checkSendPreconditions(
      { authStorage: infra.authStorage as any, modelProbe: infra.modelProbe, tracker: usageTracker },
      slot,
    );
    if (gate.type === 'blocked') {
      safeSend(mainWindow.webContents, 'agent:text-delta', slot.id, gate.message);
      safeSend(mainWindow.webContents, 'agent:end', slot.id);
      return;
    }

    // If streaming → enqueue for later
    if (slot.isStreaming) {
      const queued = slot.promptQueue.enqueue(text);
      safeSend(mainWindow.webContents, 'queue:updated', slot.id, slot.promptQueue.list());
      usageTracker?.trackPromptEnqueued(slot.promptQueue.length);
      slotManager.persistState();
      log.info({ slotId, promptId: queued.id, queueLength: slot.promptQueue.length }, 'Prompt enqueued');
      return;
    }

    // Update workflow context so the extension factory can resolve intent
    if (slot.fileKey) {
      infra.setWorkflowContext(text, slot.fileKey);
    }

    // Direct send — assign a promptId for correlation across tool calls and turn end
    beginTurn(slot, text, false, usageTracker, infra);
    slot.suggester.trackUserPrompt(text);
    slot.suggester.resetAssistantText();
    slot.isStreaming = true;
    try {
      await wrapPromptWithErrorCapture(slot.session, text, slot.modelConfig, usageTracker, {
        promptId: slot.currentPromptId ?? undefined,
        slotId: slot.id,
        turnIndex: slot.turnIndex,
      });
    } catch (err: any) {
      log.error({ err, slotId }, 'Prompt failed');
      if (err?.name !== 'AbortError') slot.lastStreamErrorPromptId = slot.currentPromptId;
      eventRouter.finalizeTurn(slot);
      slot.isStreaming = false;
      const isAuth = err.code === 'EAUTH' || err.status === 401 || err.status === 403;
      const errType = isAuth ? 'auth' : err.status === 429 ? 'rate_limit' : 'unknown';
      usageTracker?.trackAgentError(errType, err.message || 'Prompt failed');
      // F13: route by HTTP status for actionable text; fall back to raw message.
      // EAUTH is a Pi-SDK-normalized code — treat as 401 so user sees a re-login hint.
      const rawStatus = typeof err.status === 'number' ? err.status : null;
      const httpStatus = rawStatus ?? (err.code === 'EAUTH' ? 401 : null);
      const routed = messageForStreamError(httpStatus, slot.modelConfig.provider, slot.modelConfig.modelId);
      const errMsg = httpStatus ? routed : err.message || MSG_REQUEST_FAILED_FALLBACK;
      // F14: structured signal so renderer can decide retry visibility.
      safeSend(mainWindow.webContents, 'agent:stream-error', slot.id, {
        httpStatus,
        retriable: httpStatus === 429 || (httpStatus !== null && httpStatus >= 500),
        lastPrompt: text,
      });
      safeSend(mainWindow.webContents, 'agent:text-delta', slot.id, `\n\nError: ${errMsg}`);
      safeSend(mainWindow.webContents, 'agent:end', slot.id);
    }

    persistSlotSession(slot);
  });

  const ABORT_TIMEOUT_MS = 5_000;

  ipcMain.handle('agent:abort', async (_event, slotId: string) => {
    const slot = requireSlot(slotId);

    // B-003/B-007: Immediately reset streaming state so UI unblocks
    slot.isStreaming = false;
    safeSend(mainWindow.webContents, 'agent:end', slot.id);

    // Abort judge first (fast, no await)
    eventRouter.abortJudge(slotId);

    // Abort session with timeout — Pi SDK abort can hang for 30-60s
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        slot.session.abort(),
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error('abort timeout')), ABORT_TIMEOUT_MS);
        }),
      ]);
    } catch (err: any) {
      log.warn({ slotId, err: err.message }, 'Abort timed out or failed, forcing cleanup');
    } finally {
      clearTimeout(timer!);
    }

    eventRouter.finalizeTurn(slot);
    slot.promptQueue.clear();
    safeSend(mainWindow.webContents, 'queue:updated', slot.id, []);
    slotManager.persistState();
  });

  // ── Thinking level (per-slot) ────────────

  ipcMain.handle('agent:set-thinking', (_event, slotId: string, level: string) => {
    if (!isThinkingLevel(level)) return;
    const slot = requireSlot(slotId);
    const before = slot.thinkingLevel;
    slot.session.setThinkingLevel?.(level);
    // Pi SDK clamps silently when the model does not support the requested
    // level — read it back so callers learn the effective level.
    const effective = (slot.session.thinkingLevel as any) ?? level;
    slot.thinkingLevel = isThinkingLevel(effective) ? effective : level;
    usageTracker?.trackThinkingChange(before, slot.thinkingLevel);
    log.info({ slotId, requested: level, effective: slot.thinkingLevel }, 'Thinking level changed');
    return { level: slot.thinkingLevel };
  });

  ipcMain.handle('agent:get-thinking-capabilities', (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    const session = slot.session;
    const provider = slot.modelConfig?.provider ?? '';
    const family: 'anthropic' | 'openai' | 'google' | 'unknown' = provider.startsWith('anthropic')
      ? 'anthropic'
      : provider.startsWith('openai')
        ? 'openai'
        : provider.startsWith('google')
          ? 'google'
          : 'unknown';
    const supportsThinking = session.supportsThinking?.() ?? true;
    const supportsXhigh = session.supportsXhighThinking?.() ?? false;
    const rawLevels =
      session.getAvailableThinkingLevels?.() ??
      (supportsThinking
        ? supportsXhigh
          ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
          : ['off', 'minimal', 'low', 'medium', 'high']
        : ['off']);
    // Hard guard: Pi SDK should never include xhigh when supportsXhigh=false,
    // but double-check here so a future SDK bug can't leak "Max" into the UI
    // for models that don't actually support it.
    const guarded = supportsXhigh ? rawLevels : rawLevels.filter((l) => l !== 'xhigh');
    const availableLevels = filterLevelsForModel(slot.modelConfig?.modelId ?? '', guarded);
    const currentLevel = (session.thinkingLevel as any) ?? slot.thinkingLevel;
    return { family, availableLevels, supportsThinking, supportsXhigh, currentLevel };
  });

  // ── Model switch (per-slot) ──────────────

  ipcMain.handle('auth:switch-model', async (_event, slotId: string, config: ModelConfig) => {
    if (!config?.provider || !config?.modelId) {
      return { success: false, error: 'Invalid model config' };
    }
    // Validate model exists in known models (flat search across all groups)
    const knownModels = Object.values(AVAILABLE_MODELS).flat();
    const isKnown = knownModels.some(
      (m: any) => (m.sdkProvider ?? m.provider) === config.provider && (m.id ?? m.modelId) === config.modelId,
    );
    if (!isKnown) {
      return { success: false, error: `Unknown model: ${config.provider}/${config.modelId}` };
    }
    const slot = requireSlot(slotId);
    // F4: log mismatch between target model's required auth and what's stored
    const authForTarget = infra.authStorage.get(config.provider);
    if (!authForTarget) {
      usageTracker?.trackModelAuthMismatch({
        modelId: config.modelId,
        sdkProvider: config.provider,
        authType: null,
        attemptedAction: 'switch',
        slotId,
      });
    }
    const previousModel = { provider: slot.modelConfig.provider, modelId: slot.modelConfig.modelId };
    // Skip session recreation if the model hasn't actually changed
    if (previousModel.provider === config.provider && previousModel.modelId === config.modelId) {
      log.info({ slotId, provider: config.provider, model: config.modelId }, 'Model switch skipped (same model)');
      return { success: true };
    }
    log.info({ slotId, provider: config.provider, model: config.modelId }, 'Switching model');
    try {
      await slotManager.recreateSession(slotId, config);
      // Re-subscribe to the new session
      const updatedSlot = requireSlot(slotId);
      subscribeToSlot(updatedSlot);
      usageTracker?.trackModelSwitch(previousModel, { provider: config.provider, modelId: config.modelId }, 'user');
      modelChangeListeners.forEach((cb) => cb(config));
      // Push the new modelConfig to the renderer so its tab cache stays in
      // sync with main — the toolbar picker reads tab.modelConfig and gets
      // a stale checkmark if we skip this.
      const slotInfo = slotManager.getSlotInfo?.(slotId);
      if (slotInfo) safeSend(mainWindow.webContents, 'tab:updated', slotInfo);
      log.info({ slotId, provider: config.provider, model: config.modelId }, 'Model switched');
      return { success: true };
    } catch (err: any) {
      log.error({ err, slotId }, 'Failed to switch model');
      return { success: false, error: err.message };
    }
  });

  // ── Tab management ────────────────────────

  ipcMain.handle('tab:create', async (_event, fileKey?: string, fileName?: string) => {
    try {
      const slot = await slotManager.createSlot(fileKey, fileName);
      subscribeToSlot(slot);
      const slotInfo = slotManager.getSlotInfo(slot.id);
      if (slotInfo) safeSend(mainWindow.webContents, 'tab:created', slotInfo);
      return { success: true, slot: slotInfo };
    } catch (err: any) {
      log.error({ err, fileKey }, 'Failed to create tab');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tab:close', async (_event, slotId: string) => {
    try {
      // Abort any running subagent batch for this slot
      const batchCtrl = activeBatchControllers.get(slotId);
      if (batchCtrl) {
        batchCtrl.abort();
        activeBatchControllers.delete(slotId);
      }
      await slotManager.removeSlot(slotId);
      safeSend(mainWindow.webContents, 'tab:removed', slotId);
      return { success: true };
    } catch (err: any) {
      log.error({ err, slotId }, 'Failed to close tab');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tab:activate', (_event, slotId: string) => {
    try {
      slotManager.setActiveSlot(slotId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tab:list', () => {
    return slotManager.listSlots();
  });

  // ── Queue management ──────────────────────

  ipcMain.handle('queue:remove', (_event, slotId: string, promptId: string) => {
    const slot = requireSlot(slotId);
    const removed = slot.promptQueue.remove(promptId);
    if (removed) {
      safeSend(mainWindow.webContents, 'queue:updated', slot.id, slot.promptQueue.list());
      usageTracker?.trackPromptQueueCancelled();
      slotManager.persistState();
    }
    return removed;
  });

  ipcMain.handle('queue:edit', (_event, slotId: string, promptId: string, newText: string) => {
    const slot = requireSlot(slotId);
    const edited = slot.promptQueue.edit(promptId, newText);
    if (edited) {
      safeSend(mainWindow.webContents, 'queue:updated', slot.id, slot.promptQueue.list());
      usageTracker?.trackPromptQueueEdited();
      slotManager.persistState();
    }
    return edited;
  });

  ipcMain.handle('queue:clear', (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    const count = slot.promptQueue.clear();
    safeSend(mainWindow.webContents, 'queue:updated', slot.id, []);
    slotManager.persistState();
    return count;
  });

  ipcMain.handle('queue:list', (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    return slot.promptQueue.list();
  });

  // ── Feedback ─────────────────────────────────────

  ipcMain.handle(
    'feedback:submit',
    (_event, data: { slotId: string; sentiment: 'positive' | 'negative'; issueType?: string; details?: string }) => {
      const slot = slotManager.getSlot(data.slotId);
      usageTracker?.trackFeedback({
        sentiment: data.sentiment,
        issueType: data.issueType,
        details: data.details,
        promptId: slot?.lastCompletedPromptId ?? slot?.currentPromptId ?? undefined,
        slotId: data.slotId,
        turnIndex: slot?.lastCompletedTurnIndex ?? slot?.turnIndex,
      });
      log.info({ slotId: data.slotId, sentiment: data.sentiment, issueType: data.issueType }, 'Feedback submitted');
    },
  );

  // ── Window controls (global) ────────────────────

  ipcMain.handle('window:toggle-pin', () => {
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, 'floating');
    return next;
  });

  ipcMain.handle('window:is-pinned', () => {
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:set-opacity', (_event, opacity: number) => {
    mainWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)));
  });

  // ── Auth (delegated to ipc-handlers-auth.ts) ──
  setupAuthHandlers({ infra, mainWindow });

  // ── Figma REST API auth (Personal Access Token) ──
  if (figmaAuthStore) {
    setupFigmaAuthHandlers({ figmaAuthStore, figmaAPI: infra.figmaAPI, mainWindow });
  }

  // ── Image Generation settings (global) ────────────

  ipcMain.handle('imagegen:get-config', () => {
    const hasApiKey = !!imageGenState?.settings.apiKey;
    return {
      hasApiKey,
      // Kept for backwards compat with older renderer builds; identical to hasApiKey.
      hasCustomKey: hasApiKey,
      model: imageGenState?.settings.model || DEFAULT_IMAGE_MODEL,
      models: IMAGE_GEN_MODELS,
    };
  });

  ipcMain.handle('imagegen:set-config', async (_event, config: { apiKey?: string; model?: string }) => {
    if (!imageGenState) return { success: false, error: MSG_IMAGEGEN_NOT_INITIALIZED };

    if (config.apiKey !== undefined) {
      imageGenState.settings.apiKey = config.apiKey || undefined;
    }
    if (config.model) {
      imageGenState.settings.model = config.model;
    }

    await saveImageGenSettings(imageGenState.settings);

    const key = effectiveApiKey(imageGenState.settings);
    imageGenState.generator = key ? new ImageGenerator({ apiKey: key, model: imageGenState.settings.model }) : null;
    log.info(
      { model: imageGenState.generator?.model ?? imageGenState.settings.model, hasKey: !!key },
      'Image generator updated',
    );

    return { success: true, hasCustomKey: !!imageGenState.settings.apiKey };
  });

  ipcMain.handle('imagegen:test-key', async (_event, candidate?: string) => {
    // If a candidate key is passed (pre-save validation), use it; otherwise
    // fall back to the currently-stored key (post-save sanity check).
    const key = (typeof candidate === 'string' && candidate.trim()) || imageGenState?.settings.apiKey;
    if (!key) return { success: false, error: 'No API key configured' };
    // Cheapest valid Gemini API call: GET /v1beta/models. The key goes in
    // the x-goog-api-key header rather than a `?key=` query param to keep
    // secrets out of HTTP access logs, corporate TLS proxy traces, and
    // OS-level net-logs.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET',
        headers: { 'x-goog-api-key': key },
        signal: ctrl.signal,
      });
      if (res.ok) return { success: true };
      const body = await res.text().catch(() => '');
      const status = classifyProbe(res.status, body);
      if (status === 'unauthorized' || status === 'forbidden') {
        return { success: false, error: 'Invalid or unauthorized API key', code: status.toUpperCase() };
      }
      return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 120)}`, code: `HTTP_${res.status}` };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Timeout' : String(err?.message ?? err).slice(0, 120);
      return { success: false, error: msg, code: 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  });

  // ── Compression profile & cache management (global) ──────

  ipcMain.handle('compression:get-profiles', () => {
    return infra.configManager.getProfiles();
  });

  ipcMain.handle('compression:get-profile', () => {
    return infra.configManager.getActiveProfile();
  });

  ipcMain.handle('compression:set-profile', (_event, profile: string) => {
    try {
      const before = infra.configManager.getActiveProfile();
      infra.configManager.setProfile(profile as any);
      usageTracker?.trackCompressionProfileChange(before, profile);
      log.info({ profile }, 'Compression profile changed');
      return { success: true };
    } catch (err: any) {
      log.warn({ profile, err }, 'Invalid compression profile');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('compression:invalidate-caches', () => {
    infra.designSystemCache.invalidate();
    log.info('All compression caches invalidated manually');
    return { success: true };
  });

  // ── Subagent config (global) ──────────────────────

  ipcMain.handle('subagent:get-config', () => {
    return loadSubagentSettings();
  });

  ipcMain.handle('subagent:set-config', async (_event: any, config: any) => {
    if (!config || typeof config !== 'object') return { success: false, error: 'Invalid config' };
    await saveSubagentSettings(config);
    log.info('Subagent config updated');
    return { success: true };
  });

  // Subagent batch IPC (scout/analyst/auditor) was removed — orphan code.
  // The Judge harness uses its own pipeline (runMicroJudgeBatch +
  // forceRerunJudge). activeBatchControllers (declared earlier) still tracks
  // force-rerun judge controllers so tab:close can abort a running judge turn.

  // ── Judge control ──────────────────────────────────

  ipcMain.handle('judge:set-override', (_event: any, slotId: string, enabled: boolean | null) => {
    const slot = slotManager.getSlot(slotId);
    if (!slot) return { success: false, error: 'Slot not found' };
    slot.judgeOverride = typeof enabled === 'boolean' || enabled === null ? enabled : null;
    return { success: true };
  });

  ipcMain.handle('judge:force-rerun', async (_event: any, slotId: string) => {
    const slot = slotManager.getSlot(slotId);
    if (!slot) return { success: false, error: 'Slot not found' };
    if (!slot.fileKey) return { success: false, error: 'No file connected' };

    const connector = new ScopedConnector(infra.wsServer, slot.fileKey);
    const settings = (await import('./subagent/config.js')).loadSubagentSettings();
    const { forceRerunJudge } = await import('./subagent/judge-harness.js');
    const wc = mainWindow.webContents;

    const judgeController = new AbortController();
    activeBatchControllers.set(`judge-${slotId}`, judgeController);
    try {
      safeSend(wc, 'judge:running', slotId);
      const verdict = await forceRerunJudge(infra, connector, slot, settings, judgeController.signal, {
        onProgress: (event) => safeSend(wc, 'subagent:status', slotId, event),
        onVerdict: (v, attempt, max) => {
          safeSend(wc, 'judge:verdict', slotId, v, attempt, max);
          if (v.verdict === 'FAIL' && slot.taskStore?.size > 0) {
            safeSend(wc, 'task:updated', slotId, slot.taskStore.list());
          }
        },
        onRetryStart: (attempt, max) => safeSend(wc, 'judge:retry-start', slotId, attempt, max),
      });
      return { success: true, verdict };
    } catch (err: any) {
      log.warn({ err, slotId }, 'Force re-run judge failed');
      return { success: false, error: err.message };
    } finally {
      activeBatchControllers.delete(`judge-${slotId}`);
      // Safety net: the judge retry calls slot.session.prompt() which streams
      // events including thinking indicators. If the session prompt errors or
      // the event subscription is lost, agent:end never fires and the thinking
      // bubble ("...") stays forever. Always emit agent:end after force-rerun.
      safeSend(wc, 'agent:end', slotId);
    }
  });

  // ── Figma plugin setup (global) ──────────────────

  ipcMain.handle('plugin:check', () => {
    return { installed: existsSync(getInstalledManifestPath()) };
  });

  ipcMain.handle('plugin:install', async () => {
    const result = await syncFigmaPlugin();
    if (!result.synced) {
      usageTracker?.trackFigmaPluginInstalled(false);
      return { success: false, error: result.error };
    }
    // Show Finder fallback only when manual import is needed
    if (!result.autoRegistered && !result.alreadyRegistered) {
      shell.showItemInFolder(getInstalledManifestPath());
    }
    usageTracker?.trackFigmaPluginInstalled(true);
    return {
      success: true,
      path: getPluginTargetPath(),
      autoRegistered: result.autoRegistered,
      alreadyRegistered: result.alreadyRegistered,
      figmaRunning: result.figmaRunning,
    };
  });

  // ── Usage tracking (renderer → main) ────
  ipcMain.handle('usage:suggestion-clicked', (_event, index: number) => {
    usageTracker?.trackSuggestionClicked(index);
  });

  // ── Diagnostics (global) ─────────────────────────

  ipcMain.handle('diagnostics:export', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: MSG_EXPORT_DIALOG_TITLE,
      defaultPath: `bottega-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: MSG_EXPORT_FILTER_NAME, extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      await exportDiagnosticsZip(filePath);
      log.info({ filePath }, 'Diagnostics exported');
      return { success: true, path: filePath };
    } catch (err: any) {
      log.error({ err }, 'Diagnostics export failed');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('diagnostics:copy-info', () => {
    return formatSystemInfoForClipboard();
  });

  ipcMain.handle('diagnostics:get-support-code', () => {
    const config = loadDiagnosticsConfig();
    return deriveSupportCode(config.anonymousId);
  });

  // F15: recent errors ring buffer for the Diagnostics panel.
  ipcMain.handle('diagnostics:get-recent-errors', () => {
    return usageTracker?.getRecentErrors() ?? [];
  });

  ipcMain.handle('diagnostics:get-config', () => {
    const config = loadDiagnosticsConfig();
    return { sendDiagnostics: config.sendDiagnostics };
  });

  ipcMain.handle('diagnostics:set-config', async (_event, config: { sendDiagnostics: boolean }) => {
    const current = loadDiagnosticsConfig();
    const updated = { ...current, sendDiagnostics: config.sendDiagnostics };
    await saveDiagnosticsConfig(updated);
    reloadDiagnosticsConfig();
    log.info({ sendDiagnostics: updated.sendDiagnostics }, 'Diagnostics preference updated');
    return { success: true, requiresRestart: true };
  });

  // ── Session persistence (per-slot) ─────────────────

  async function resetSessionCore(slot: SessionSlot): Promise<void> {
    if (slot.isStreaming) {
      await slot.session.abort();
      eventRouter.finalizeTurn(slot);
      slot.isStreaming = false;
    }
    await slot.runtime.newSession();
    // Re-subscribe: runtime swaps the AgentSession instance, so prior listeners target a stale object.
    subscribeToSlot(slot);
    slot.suggester.reset();
    persistSlotSession(slot);
    slotManager.persistState();
  }

  ipcMain.handle('session:reset', async (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    try {
      await resetSessionCore(slot);
      log.info({ slotId, fileKey: slot.fileKey }, 'Session reset');
      return { success: true };
    } catch (err: any) {
      log.error({ err, slotId }, 'Failed to reset session');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('session:reset-with-clear', async (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    try {
      await resetSessionCore(slot);
      slot.promptQueue.clear();
      if (mainWindow) {
        safeSend(mainWindow.webContents, 'session:chat-cleared', slotId);
      }
      log.info({ slotId, fileKey: slot.fileKey }, 'Session reset with UI clear');
      return { success: true };
    } catch (err: any) {
      log.error({ err, slotId }, 'Failed to reset session with clear');
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('session:get-messages', (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    try {
      const messages = slot.session.messages || [];
      return extractRenderableMessages(messages);
    } catch (err: any) {
      log.warn({ err, slotId }, 'Failed to extract session messages');
      return [];
    }
  });

  // ── Canvas management (safe operations, always available) ─────────
  // These handlers are always exposed (not gated behind BOTTEGA_AGENT_TEST).
  // They enable QA infrastructure to manage test canvas state between runs.
  ipcMain.handle('figma:clear-page', async (_event: any, fileKey?: string) => {
    try {
      const code = `return (async () => {
        const p = figma.createPage();
        p.name = "Page " + (figma.root.children.length);
        await figma.setCurrentPageAsync(p);
        return JSON.stringify({ pageId: p.id, pageName: p.name });
      })()`;
      const targetKey = fileKey || infra.wsServer.getConnectedFileInfo()?.fileKey;
      return await infra.wsServer.sendCommand('EXECUTE_CODE', { code, timeout: 10000 }, 12000, targetKey || undefined);
    } catch (err: any) {
      log.warn({ err }, 'figma:clear-page failed');
      return { error: err.message };
    }
  });

  // Execute arbitrary plugin code. Unlike `test:figma-execute`, this is always
  // available — intended for QA infrastructure and introspection. The underlying
  // plugin already runs in a sandboxed Figma context; the only risk is modifying
  // the current file, which the user already granted by opening the plugin.
  ipcMain.handle('figma:execute', async (_event: any, code: string, timeoutMs?: number, fileKey?: string) => {
    try {
      const timeout = timeoutMs ?? 15_000;
      const targetKey = fileKey || infra.wsServer.getConnectedFileInfo()?.fileKey;
      return await infra.wsServer.sendCommand(
        'EXECUTE_CODE',
        { code, timeout },
        timeout + 2_000,
        targetKey || undefined,
      );
    } catch (err: any) {
      log.warn({ err }, 'figma:execute failed');
      return { error: err.message };
    }
  });

  // ── Auto-update (global) ────────────────────────
  ipcMain.handle('update:get-version', () => getAppVersion());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', async () => {
    try {
      await quitAndInstall();
    } catch (err: any) {
      log.error({ err }, 'update:install failed');
      safeSend(mainWindow.webContents, 'update:error', err?.message ?? 'Install failed');
    }
  });

  // ── Return controller ──

  return {
    subscribeSlot: subscribeToSlot,
    onModelChange: (cb: (config: ModelConfig) => void) => modelChangeListeners.push(cb),
    getJudgeInProgress: eventRouter.getJudgeInProgress,
  };
}
