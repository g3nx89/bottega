import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import {
  type AgentInfra,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  isThinkingLevel,
  type ModelConfig,
  OAUTH_PROVIDER_INFO,
  OAUTH_PROVIDER_MAP,
} from './agent.js';
import { checkForUpdates, downloadUpdate, getAppVersion, quitAndInstall } from './auto-updater.js';
import { categorizeToolName } from './compression/metrics.js';
import { exportDiagnosticsZip, formatSystemInfoForClipboard } from './diagnostics.js';
import { effectiveApiKey, type ImageGenSettings, saveImageGenSettings } from './image-gen/config.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_GEN_MODELS, ImageGenerator } from './image-gen/image-generator.js';
import {
  MSG_EXPORT_DIALOG_TITLE,
  MSG_EXPORT_FILTER_NAME,
  MSG_GOOGLE_PROJECT_REQUIRED,
  MSG_IMAGEGEN_NOT_INITIALIZED,
  MSG_LOGIN_CANCELLED,
  MSG_LOGIN_IN_PROGRESS,
  MSG_NO_CREDENTIALS,
  MSG_PASTE_AUTH_CODE,
  MSG_PASTE_AUTH_CODE_PLACEHOLDER,
  MSG_PLUGIN_NOT_FOUND,
  MSG_REQUEST_FAILED_FALLBACK,
  MSG_UNKNOWN_PROVIDER,
} from './messages.js';
import {
  loadDiagnosticsConfig,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
  type UsageTracker,
} from './remote-logger.js';
import { extractRenderableMessages, type RenderableTurn } from './renderable-messages.js';
import { safeSend } from './safe-send.js';
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

  // Track tool execution timing for usage analytics (per toolCallId, across all slots)
  const toolStartTimes = new Map<string, number>();
  // Track which sessions have been subscribed to prevent duplicate listeners on model switch
  const subscribedSessions = new WeakSet<AgentSessionLike>();

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

  // ── Per-event handlers for slot subscription ───────

  function handleMessageUpdate(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    if (event.assistantMessageEvent?.type === 'text_delta') {
      safeSend(wc, 'agent:text-delta', slot.id, event.assistantMessageEvent.delta);
      slot.suggester.appendAssistantText(event.assistantMessageEvent.delta);
    }
    if (event.assistantMessageEvent?.type === 'thinking_delta') {
      safeSend(wc, 'agent:thinking', slot.id, event.assistantMessageEvent.delta);
    }
  }

  function handleToolStart(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    log.info({ tool: event.toolName, callId: event.toolCallId, slotId: slot.id }, 'Tool start');
    safeSend(wc, 'agent:tool-start', slot.id, event.toolName, event.toolCallId);
    toolStartTimes.set(event.toolCallId, Date.now());
  }

  function handleToolEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    const resultPreview = event.result?.content
      ? event.result.content.map((c: any) => ({
          type: c.type,
          ...(c.type === 'text' ? { text: (c.text || '').slice(0, 200) } : {}),
          ...(c.type === 'image' ? { hasData: !!c.data, dataLen: c.data?.length } : {}),
        }))
      : 'no content';
    log.info({ tool: event.toolName, callId: event.toolCallId, isError: event.isError, slotId: slot.id }, 'Tool end');
    log.debug({ tool: event.toolName, callId: event.toolCallId, resultContent: resultPreview }, 'Tool result detail');
    safeSend(wc, 'agent:tool-end', slot.id, event.toolName, event.toolCallId, !event.isError, event.result);

    const startTime = toolStartTimes.get(event.toolCallId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    toolStartTimes.delete(event.toolCallId);
    const category = categorizeToolName(event.toolName);
    if (event.isError) {
      usageTracker?.trackToolError(event.toolName, JSON.stringify(resultPreview), undefined);
    }
    usageTracker?.trackToolCall(event.toolName, category, !event.isError, durationMs);

    if (
      event.toolName.startsWith('figma_generate_') ||
      event.toolName.startsWith('figma_edit_') ||
      event.toolName === 'figma_restore_image'
    ) {
      usageTracker?.trackImageGen(event.toolName.replace('figma_', ''), 'gemini', !event.isError, durationMs);
    }
    if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
      const imageContent = event.result.content.find((c: any) => c.type === 'image');
      if (imageContent) safeSend(wc, 'agent:screenshot', slot.id, imageContent.data);
    }
  }

  function handleMessageEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    const msg = event.message;
    if (msg?.role === 'assistant' && msg.usage) {
      safeSend(wc, 'agent:usage', slot.id, {
        input: msg.usage.input,
        output: msg.usage.output,
        total: msg.usage.totalTokens,
      });
    }
  }

  function handleAgentEnd(wc: Electron.WebContents, slot: SessionSlot) {
    if (!slot.isStreaming) return; // stale event after abort — ignore
    const next = slot.promptQueue.dequeue();
    if (next) {
      safeSend(wc, 'queue:updated', slot.id, slot.promptQueue.list());
      safeSend(wc, 'agent:queued-prompt-start', slot.id, next.text);
      usageTracker?.trackPromptDequeued(slot.promptQueue.length);
      persistSlotSession(slot);
      slotManager.persistState();
      slot.session.prompt(next.text).catch((err: any) => {
        log.error({ err, slotId: slot.id }, 'Queued prompt failed');
        slot.isStreaming = false;
        slot.promptQueue.clear();
        safeSend(wc, 'agent:text-delta', slot.id, `\n\nError: ${err.message || MSG_REQUEST_FAILED_FALLBACK}`);
        safeSend(wc, 'agent:end', slot.id);
        safeSend(wc, 'queue:updated', slot.id, []);
      });
    } else {
      slot.isStreaming = false;
      safeSend(wc, 'agent:end', slot.id);
      persistSlotSession(slot);
      slotManager.persistState();
      const suggestStart = Date.now();
      slot.suggester
        .suggest(slot.modelConfig)
        .then((suggestions) => {
          usageTracker?.trackSuggestionsGenerated(suggestions.length, Date.now() - suggestStart);
          if (suggestions.length > 0) safeSend(wc, 'agent:suggestions', slot.id, suggestions);
          slot.suggester.resetAssistantText();
        })
        .catch((err) => {
          log.warn({ err, slotId: slot.id }, 'Failed to generate suggestions');
          slot.suggester.resetAssistantText();
        });
    }
  }

  /**
   * Subscribe to a slot's session events and route them to the renderer with slotId.
   * Called once per slot (after creation or restore), and again after model switch
   * (which creates a new session object).
   *
   * Listener lifecycle: Pi SDK's subscribe() has no unsubscribe API. When a model switch
   * replaces slot.session, the old session's listener becomes a no-op via the stale-event
   * guard below. The old listener closure is GC'd when the old AgentSession is collected.
   * This is bounded by MAX_SLOTS * model_switches_per_session.
   */
  function subscribeToSlot(slot: SessionSlot) {
    if (subscribedSessions.has(slot.session)) return;
    subscribedSessions.add(slot.session);
    const wc = mainWindow.webContents;
    const boundSession = slot.session; // capture identity for stale-event guard
    slot.session.subscribe((event: any) => {
      // Stale-event guard: if session was replaced (model switch) or slot removed, bail
      if (slot.session !== boundSession || !slotManager.getSlot(slot.id)) return;
      switch (event.type) {
        case 'message_update':
          handleMessageUpdate(wc, slot, event);
          break;
        case 'tool_execution_start':
          handleToolStart(wc, slot, event);
          break;
        case 'tool_execution_end':
          handleToolEnd(wc, slot, event);
          break;
        case 'message_end':
          handleMessageEnd(wc, slot, event);
          break;
        case 'agent_end':
          handleAgentEnd(wc, slot);
          break;
        case 'auto_compaction_start':
          safeSend(wc, 'agent:compaction', slot.id, true);
          break;
        case 'auto_compaction_end':
          safeSend(wc, 'agent:compaction', slot.id, false);
          usageTracker?.trackCompaction(0, 0);
          break;
        case 'auto_retry_start':
          safeSend(wc, 'agent:retry', slot.id, true);
          break;
        case 'auto_retry_end':
          safeSend(wc, 'agent:retry', slot.id, false);
          break;
      }
    });
  }

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

    // Direct send
    slot.suggester.trackUserPrompt(text);
    slot.suggester.resetAssistantText();
    usageTracker?.trackPrompt(text.length, false);
    slot.isStreaming = true;
    try {
      await slot.session.prompt(text);
    } catch (err: any) {
      log.error({ err, slotId }, 'Prompt failed');
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
    log.info({ slotId, provider: config.provider, model: config.modelId }, 'Switching model');
    const previousModel = { provider: slot.modelConfig.provider, modelId: slot.modelConfig.modelId };
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

  // ── Auth & Model management (global) ────────────

  ipcMain.handle('auth:get-models', () => {
    return AVAILABLE_MODELS;
  });

  ipcMain.handle('auth:get-context-sizes', () => {
    return CONTEXT_SIZES;
  });

  const VALID_PROVIDERS = new Set([...Object.keys(OAUTH_PROVIDER_MAP), ...Object.values(OAUTH_PROVIDER_MAP)]);

  ipcMain.handle('auth:set-key', (_event, provider: string, apiKey: string) => {
    if (!VALID_PROVIDERS.has(provider)) return false;
    if (apiKey) {
      infra.authStorage.set(provider, { type: 'api_key', key: apiKey });
      log.info({ provider }, 'API key saved');
    } else {
      infra.authStorage.remove(provider);
      log.info({ provider }, 'API key removed');
    }
    return true;
  });

  // ── OAuth login/logout (global) ─────────────────

  let loginAbortController: AbortController | null = null;
  let loginPromptResolver: ((value: string) => void) | null = null;

  ipcMain.handle('auth:get-auth-status', () => {
    const status: Record<string, { type: 'oauth' | 'api_key' | 'none'; label: string }> = {};
    for (const [displayGroup, oauthId] of Object.entries(OAUTH_PROVIDER_MAP)) {
      const oauthCred = infra.authStorage.get(oauthId);
      const apiKeyCred = infra.authStorage.get(displayGroup);
      if (oauthCred?.type === 'oauth') {
        status[displayGroup] = { type: 'oauth', label: OAUTH_PROVIDER_INFO[displayGroup]?.description || 'Logged in' };
      } else if (apiKeyCred?.type === 'api_key' || oauthCred?.type === 'api_key') {
        status[displayGroup] = { type: 'api_key', label: 'API key' };
      } else {
        status[displayGroup] = { type: 'none', label: 'Not connected' };
      }
    }
    return status;
  });

  ipcMain.handle('auth:set-google-project', (_event, projectId: string) => {
    if (projectId) {
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
      log.info({ projectId }, 'Google Cloud Project ID set');
    } else {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    }
    return true;
  });

  ipcMain.handle('auth:get-google-project', () => {
    return process.env.GOOGLE_CLOUD_PROJECT || '';
  });

  ipcMain.handle('auth:login', async (_event, displayGroup: string) => {
    const oauthId = OAUTH_PROVIDER_MAP[displayGroup];
    if (!oauthId) return { success: false, error: MSG_UNKNOWN_PROVIDER(displayGroup) };

    if (loginAbortController) {
      return { success: false, error: MSG_LOGIN_IN_PROGRESS };
    }

    loginAbortController = new AbortController();
    try {
      await infra.authStorage.login(oauthId, {
        onAuth: (info) => {
          try {
            const parsed = new URL(info.url);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
              void shell.openExternal(info.url);
            } else {
              log.warn({ url: info.url }, 'Refused to open non-HTTP URL');
            }
          } catch {
            log.warn({ url: info.url }, 'Invalid URL from OAuth provider');
          }
          safeSend(mainWindow.webContents, 'auth:login-event', {
            type: 'auth',
            url: info.url,
            instructions: info.instructions,
          });
        },
        onPrompt: (prompt) => {
          return new Promise<string>((resolve) => {
            loginPromptResolver = resolve;
            safeSend(mainWindow.webContents, 'auth:login-event', {
              type: 'prompt',
              message: prompt.message,
              placeholder: prompt.placeholder,
              allowEmpty: prompt.allowEmpty,
            });
          });
        },
        onProgress: (message) => {
          safeSend(mainWindow.webContents, 'auth:login-event', { type: 'progress', message });
        },
        onManualCodeInput: () => {
          return new Promise<string>((resolve) => {
            loginPromptResolver = resolve;
            safeSend(mainWindow.webContents, 'auth:login-event', {
              type: 'prompt',
              message: MSG_PASTE_AUTH_CODE,
              placeholder: MSG_PASTE_AUTH_CODE_PLACEHOLDER,
            });
          });
        },
        signal: loginAbortController.signal,
      });

      log.info({ displayGroup, oauthId }, 'OAuth login success');
      return { success: true };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        log.info({ displayGroup }, 'OAuth login cancelled');
        return { success: false, error: MSG_LOGIN_CANCELLED };
      }
      log.error({ displayGroup, err }, 'OAuth login failed');
      if (
        displayGroup === 'google' &&
        typeof err.message === 'string' &&
        err.message.includes('GOOGLE_CLOUD_PROJECT')
      ) {
        return { success: false, error: MSG_GOOGLE_PROJECT_REQUIRED, code: 'GOOGLE_CLOUD_PROJECT_REQUIRED' };
      }
      return { success: false, error: err.message };
    } finally {
      loginAbortController = null;
      loginPromptResolver = null;
    }
  });

  ipcMain.handle('auth:login-respond', (_event, response: string) => {
    if (loginPromptResolver) {
      loginPromptResolver(response);
      loginPromptResolver = null;
    }
  });

  ipcMain.handle('auth:login-cancel', () => {
    loginAbortController?.abort();
  });

  ipcMain.handle('auth:logout', (_event, displayGroup: string) => {
    const oauthId = OAUTH_PROVIDER_MAP[displayGroup];
    if (oauthId) {
      infra.authStorage.logout(oauthId);
    }
    infra.authStorage.remove(displayGroup);
    log.info({ displayGroup }, 'Logged out');
    return true;
  });

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
