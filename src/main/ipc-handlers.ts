import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { type AgentInfra, AVAILABLE_MODELS, isThinkingLevel, type ModelConfig } from './agent.js';
import { checkForUpdates, downloadUpdate, getAppVersion, quitAndInstall } from './auto-updater.js';
import { exportDiagnosticsZip, formatSystemInfoForClipboard } from './diagnostics.js';
import { effectiveApiKey, type ImageGenSettings, saveImageGenSettings } from './image-gen/config.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_GEN_MODELS, ImageGenerator } from './image-gen/image-generator.js';
import { setupAuthHandlers } from './ipc-handlers-auth.js';
import {
  MSG_EXPORT_DIALOG_TITLE,
  MSG_EXPORT_FILTER_NAME,
  MSG_IMAGEGEN_NOT_INITIALIZED,
  MSG_NO_CREDENTIALS,
  MSG_PLUGIN_NOT_FOUND,
  MSG_REQUEST_FAILED_FALLBACK,
} from './messages.js';
import {
  loadDiagnosticsConfig,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
  type UsageTracker,
} from './remote-logger.js';
import { extractRenderableMessages, type RenderableTurn } from './renderable-messages.js';
import { safeSend } from './safe-send.js';
import { beginTurn, createEventRouter } from './session-events.js';
import type { SessionStore } from './session-store.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';

export { extractRenderableMessages, type RenderableTurn };

/** Controller returned by setupIpcHandlers for cross-module coordination. */
export interface IpcController {
  /** Subscribe a slot's session events to the renderer. Call after creating or restoring a slot. */
  subscribeSlot(slot: SessionSlot): void;
  /** Register a callback for model config changes. */
  onModelChange(cb: (config: ModelConfig) => void): void;
}

const log = createChildLogger({ component: 'ipc' });

export interface AgentSessionLike {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: any) => void): void;
  // Session persistence methods (Pi SDK AgentSession)
  newSession(options?: { parentSession?: string }): Promise<boolean>;
  switchSession(sessionPath: string): Promise<boolean>;
  setThinkingLevel?(level: string): void;
  readonly sessionFile: string | undefined;
  readonly messages: any[];
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
}

export function setupIpcHandlers(deps: SetupIpcDeps): IpcController {
  const { slotManager, mainWindow, infra, imageGenState, sessionStore, usageTracker } = deps;
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
  const eventRouter = createEventRouter({ slotManager, mainWindow, usageTracker, persistSlotSession });
  const { subscribeToSlot } = eventRouter;

  // ── Agent prompt/abort ─────────────────

  ipcMain.handle('agent:prompt', async (_event, slotId: string, text: string) => {
    const slot = requireSlot(slotId);

    // Pre-check credentials
    const apiKey = await infra.authStorage.getApiKey(slot.modelConfig.provider);
    if (!apiKey) {
      safeSend(mainWindow.webContents, 'agent:text-delta', slot.id, MSG_NO_CREDENTIALS);
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

    // Direct send — assign a promptId for correlation across tool calls and turn end
    beginTurn(slot, text, false, usageTracker);
    slot.suggester.trackUserPrompt(text);
    slot.suggester.resetAssistantText();
    slot.isStreaming = true;
    try {
      await slot.session.prompt(text);
    } catch (err: any) {
      log.error({ err, slotId }, 'Prompt failed');
      eventRouter.finalizeTurn(slot);
      slot.isStreaming = false;
      const errType = err.code === 'EAUTH' ? 'auth' : err.status === 429 ? 'rate_limit' : 'unknown';
      usageTracker?.trackAgentError(errType, err.message || 'Prompt failed');
      safeSend(
        mainWindow.webContents,
        'agent:text-delta',
        slot.id,
        `\n\nError: ${err.message || MSG_REQUEST_FAILED_FALLBACK}`,
      );
      safeSend(mainWindow.webContents, 'agent:end', slot.id);
    }

    persistSlotSession(slot);
  });

  ipcMain.handle('agent:abort', async (_event, slotId: string) => {
    const slot = requireSlot(slotId);
    await slot.session.abort();
    eventRouter.finalizeTurn(slot);
    slot.promptQueue.clear();
    slot.isStreaming = false;
    safeSend(mainWindow.webContents, 'queue:updated', slot.id, []);
    slotManager.persistState();
  });

  // ── Thinking level (per-slot) ────────────

  ipcMain.handle('agent:set-thinking', (_event, slotId: string, level: string) => {
    if (!isThinkingLevel(level)) return;
    const slot = requireSlot(slotId);
    const before = slot.thinkingLevel;
    slot.session.setThinkingLevel?.(level);
    slot.thinkingLevel = level;
    usageTracker?.trackThinkingChange(before, level);
    log.info({ slotId, level }, 'Thinking level changed');
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
      usageTracker?.trackModelSwitch(previousModel, { provider: config.provider, modelId: config.modelId });
      modelChangeListeners.forEach((cb) => cb(config));
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

  // ── Image Generation settings (global) ────────────

  ipcMain.handle('imagegen:get-config', () => {
    return {
      hasApiKey: !!effectiveApiKey(imageGenState?.settings ?? {}),
      hasCustomKey: !!imageGenState?.settings.apiKey,
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
    imageGenState.generator = new ImageGenerator({ apiKey: key, model: imageGenState.settings.model });
    log.info(
      { model: imageGenState.generator.model, isDefault: !imageGenState.settings.apiKey },
      'Image generator updated',
    );

    return { success: true, hasCustomKey: !!imageGenState.settings.apiKey };
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

  // ── Figma plugin setup (global) ──────────────────

  const PLUGIN_MANIFEST = 'manifest.json';

  function getPluginSourcePath(): string | null {
    const candidates = [
      join(process.resourcesPath, 'figma-desktop-bridge'),
      join(app.getAppPath(), 'figma-desktop-bridge'),
    ];
    for (const dir of candidates) {
      if (existsSync(join(dir, PLUGIN_MANIFEST))) return dir;
    }
    return null;
  }

  function getPluginTargetPath(): string {
    return join(app.getPath('userData'), 'figma-plugin');
  }

  ipcMain.handle('plugin:check', () => {
    return { installed: existsSync(join(getPluginTargetPath(), PLUGIN_MANIFEST)) };
  });

  ipcMain.handle('plugin:install', () => {
    const src = getPluginSourcePath();
    if (!src) {
      log.error('Plugin source not found in any candidate path');
      return { success: false, error: MSG_PLUGIN_NOT_FOUND };
    }
    const dest = getPluginTargetPath();
    try {
      cpSync(src, dest, { recursive: true, force: true });
      shell.showItemInFolder(join(dest, PLUGIN_MANIFEST));
      log.info({ dest }, 'Figma plugin copied and revealed in Finder');
      usageTracker?.trackFigmaPluginInstalled(true);
      return { success: true, path: dest };
    } catch (err: any) {
      log.error({ err }, 'Failed to copy Figma plugin');
      usageTracker?.trackFigmaPluginInstalled(false);
      return { success: false, error: err.message };
    }
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
    await slot.session.newSession();
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

  // ── Auto-update (global) ────────────────────────
  ipcMain.handle('update:get-version', () => getAppVersion());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => quitAndInstall());

  // ── Return controller ──

  return {
    subscribeSlot: subscribeToSlot,
    onModelChange: (cb: (config: ModelConfig) => void) => modelChangeListeners.push(cb),
  };
}
