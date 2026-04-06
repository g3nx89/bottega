import { execFile } from 'node:child_process';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { type AgentInfra, AVAILABLE_MODELS, CONTEXT_SIZES, isThinkingLevel, type ModelConfig } from './agent.js';
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
  deriveSupportCode,
  loadDiagnosticsConfig,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
  type UsageTracker,
} from './remote-logger.js';
import { extractRenderableMessages, type RenderableTurn } from './renderable-messages.js';
import { safeSend } from './safe-send.js';
import { ScopedConnector } from './scoped-connector.js';
import { beginTurn, createEventRouter } from './session-events.js';
import type { SessionStore } from './session-store.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';
import { loadSubagentSettings, saveSubagentSettings } from './subagent/config.js';

export { extractRenderableMessages, type RenderableTurn };

// ── Figma plugin helpers (module-level, used by both IPC and startup) ──

const PLUGIN_MANIFEST = 'manifest.json';
const PLUGIN_ID = 'bottega-bridge';
const PLUGIN_NAME = 'Bottega Bridge';
const pluginLog = createChildLogger({ component: 'plugin-sync' });

function getPluginSourcePath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'figma-desktop-bridge'),
    join(app.getAppPath(), 'figma-desktop-bridge'),
    // Dev mode: app.getAppPath() points to dist/, plugin is at project root
    join(app.getAppPath(), '..', 'figma-desktop-bridge'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, PLUGIN_MANIFEST))) return dir;
  }
  return null;
}

function getPluginTargetPath(): string {
  return join(app.getPath('userData'), 'figma-plugin');
}

function getFigmaSettingsPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Figma', 'settings.json');
}

const execFileAsync = promisify(execFile);

async function isFigmaRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-x', 'Figma'], { timeout: 3000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

interface FigmaExtEntry {
  id: number;
  manifestPath: string;
  lastKnownName?: string;
  lastKnownPluginId?: string;
  fileMetadata: {
    type: 'manifest' | 'code' | 'ui';
    codeFileId?: number;
    uiFileIds?: number[];
    manifestFileId?: number;
  };
}

/** Read-only check: is the plugin already registered in Figma's settings.json? Safe to call anytime. */
function isPluginRegistered(): boolean {
  const settingsPath = getFigmaSettingsPath();
  if (!existsSync(settingsPath)) return false;
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const extensions: FigmaExtEntry[] = settings.localFileExtensions ?? [];
    return extensions.some((e) => e.fileMetadata?.type === 'manifest' && e.lastKnownPluginId === PLUGIN_ID);
  } catch {
    return false;
  }
}

/**
 * Check if plugin is registered in Figma's settings.json; if not, append entries.
 * Single file read — avoids double parse. Never removes existing entries.
 * Must only be called when Figma is NOT running (Figma overwrites on exit).
 * Returns 'already' if already registered, 'registered' if newly added, 'failed' otherwise.
 */
function ensurePluginRegistered(pluginDir: string): 'already' | 'registered' | 'failed' {
  const settingsPath = getFigmaSettingsPath();
  if (!existsSync(settingsPath)) {
    pluginLog.warn('Figma settings.json not found — cannot auto-register plugin');
    return 'failed';
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const extensions: FigmaExtEntry[] = settings.localFileExtensions ?? [];

    if (extensions.some((e) => e.fileMetadata?.type === 'manifest' && e.lastKnownPluginId === PLUGIN_ID)) {
      return 'already';
    }

    const maxId = extensions.reduce((max, e) => Math.max(max, e.id), 0);
    const mId = maxId + 1;
    const cId = maxId + 2;
    const uId = maxId + 3;

    extensions.push(
      {
        id: mId,
        manifestPath: join(pluginDir, 'manifest.json'),
        lastKnownName: PLUGIN_NAME,
        lastKnownPluginId: PLUGIN_ID,
        fileMetadata: { type: 'manifest', codeFileId: cId, uiFileIds: [uId] },
      },
      {
        id: cId,
        manifestPath: join(pluginDir, 'code.js'),
        fileMetadata: { type: 'code', manifestFileId: mId },
      },
      {
        id: uId,
        manifestPath: join(pluginDir, 'ui.html'),
        fileMetadata: { type: 'ui', manifestFileId: mId },
      },
    );

    settings.localFileExtensions = extensions;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    pluginLog.info({ mId, pluginDir }, 'Plugin auto-registered in Figma settings.json');
    return 'registered';
  } catch (err) {
    pluginLog.warn({ err }, 'Failed to auto-register plugin in Figma settings');
    return 'failed';
  }
}

export interface PluginSyncResult {
  synced: boolean;
  autoRegistered: boolean;
  alreadyRegistered: boolean;
  figmaRunning: boolean;
  error?: string;
}

/** Check if installed plugin files differ from the bundled source. */
function pluginNeedsSync(src: string, dest: string): boolean {
  try {
    const destManifest = join(dest, PLUGIN_MANIFEST);
    if (!existsSync(destManifest)) return true;
    // Compare file sizes as a cheap content-change heuristic (mtime is unreliable after cpSync)
    const srcSize = statSync(join(src, PLUGIN_MANIFEST)).size;
    const destSize = statSync(destManifest).size;
    if (srcSize !== destSize) return true;
    const srcCodeSize = statSync(join(src, 'code.js')).size;
    const destCodeSize = statSync(join(dest, 'code.js')).size;
    return srcCodeSize !== destCodeSize;
  } catch {
    return true;
  }
}

/**
 * Sync plugin files from app bundle to userData and auto-register in Figma if needed.
 * Called at startup and from the manual install IPC handler.
 */
export async function syncFigmaPlugin(): Promise<PluginSyncResult> {
  const src = getPluginSourcePath();
  if (!src) {
    pluginLog.warn('Plugin source not found — skipping sync');
    return {
      synced: false,
      autoRegistered: false,
      alreadyRegistered: false,
      figmaRunning: false,
      error: MSG_PLUGIN_NOT_FOUND,
    };
  }

  const dest = getPluginTargetPath();
  try {
    if (pluginNeedsSync(src, dest)) {
      cpSync(src, dest, { recursive: true, force: true });
      pluginLog.info({ dest }, 'Plugin files synced');
    }
  } catch (err: any) {
    pluginLog.error({ err }, 'Failed to sync plugin files');
    return { synced: false, autoRegistered: false, alreadyRegistered: false, figmaRunning: false, error: err.message };
  }

  const figmaRunning = await isFigmaRunning();
  let autoRegistered = false;
  let alreadyRegistered = isPluginRegistered();

  if (!alreadyRegistered && !figmaRunning) {
    const result = ensurePluginRegistered(dest);
    alreadyRegistered = result === 'already';
    autoRegistered = result === 'registered';
  }

  return { synced: true, autoRegistered, alreadyRegistered, figmaRunning };
}

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
  const eventRouter = createEventRouter({
    slotManager,
    mainWindow,
    usageTracker,
    persistSlotSession,
    contextSizes: CONTEXT_SIZES,
    infra,
    getConnectorForSlot: (slot: SessionSlot) =>
      slot.fileKey ? new ScopedConnector(infra.wsServer, slot.fileKey) : null,
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

    // Update workflow context so the extension factory can resolve intent
    if (slot.fileKey) {
      infra.setWorkflowContext(text, slot.fileKey);
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

  // Active subagent batch controllers — keyed by slotId for external abort
  const activeBatchControllers = new Map<string, AbortController>();

  ipcMain.handle('subagent:run', async (_event: any, slotId: string, requests: any[]) => {
    const slot = requireSlot(slotId);
    if (!slot.fileKey) return { success: false, error: 'Slot has no Figma file connected' };
    if (activeBatchControllers.has(slotId)) return { success: false, error: 'Batch already running' };

    const connector = new ScopedConnector(infra.wsServer, slot.fileKey);
    const settings = loadSubagentSettings();
    const controller = new AbortController();
    activeBatchControllers.set(slotId, controller);

    try {
      const { randomUUID } = await import('node:crypto');
      const batchId = randomUUID();
      const wc = mainWindow.webContents;
      safeSend(wc, 'subagent:batch-start', slotId, { batchId, roles: requests.map((r: any) => r.role) });
      const { runSubagentBatch } = await import('./subagent/orchestrator.js');
      const result = await runSubagentBatch(infra, connector, requests, settings, batchId, controller.signal, (event) =>
        safeSend(wc, 'subagent:status', slotId, event),
      );
      safeSend(wc, 'subagent:batch-end', slotId, result);
      // Diagnostic logs already written by orchestrator — no duplicate here
      return { success: true, result };
    } catch (err: any) {
      log.error({ err, slotId }, 'Subagent batch failed');
      return { success: false, error: err.message };
    } finally {
      activeBatchControllers.delete(slotId);
    }
  });

  ipcMain.handle('subagent:abort', (_event: any, slotId: string) => {
    const ctrl = activeBatchControllers.get(slotId);
    if (ctrl) {
      ctrl.abort();
      activeBatchControllers.delete(slotId);
      return { success: true };
    }
    return { success: false, error: 'No active batch' };
  });

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
    }
  });

  // ── Figma plugin setup (global) ──────────────────

  ipcMain.handle('plugin:check', () => {
    return { installed: existsSync(join(getPluginTargetPath(), PLUGIN_MANIFEST)) };
  });

  ipcMain.handle('plugin:install', async () => {
    const result = await syncFigmaPlugin();
    if (!result.synced) {
      usageTracker?.trackFigmaPluginInstalled(false);
      return { success: false, error: result.error };
    }
    // Show Finder fallback only when manual import is needed
    if (!result.autoRegistered && !result.alreadyRegistered) {
      shell.showItemInFolder(join(getPluginTargetPath(), PLUGIN_MANIFEST));
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
