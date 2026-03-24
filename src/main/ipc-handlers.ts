import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import {
  type AgentInfra,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  createFigmaAgent,
  DEFAULT_MODEL,
  type ModelConfig,
  OAUTH_PROVIDER_INFO,
  OAUTH_PROVIDER_MAP,
} from './agent.js';
import { checkForUpdates, downloadUpdate, getAppVersion, quitAndInstall } from './auto-updater.js';
import { categorizeToolName } from './compression/metrics.js';
import { exportDiagnosticsZip, formatSystemInfoForClipboard } from './diagnostics.js';
import { effectiveApiKey, type ImageGenSettings, saveImageGenSettings } from './image-gen/config.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_GEN_MODELS, ImageGenerator } from './image-gen/image-generator.js';
import { OperationQueue } from './operation-queue.js';
import { PromptSuggester } from './prompt-suggester.js';
import {
  loadDiagnosticsConfig,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
  type UsageTracker,
} from './remote-logger.js';
import { extractRenderableMessages, type RenderableTurn } from './renderable-messages.js';
import { safeSend } from './safe-send.js';
import type { SessionStore } from './session-store.js';

export { extractRenderableMessages, type RenderableTurn };

/** Controller returned by setupIpcHandlers for cross-module coordination. */
export interface IpcController {
  /** Switch the agent session to match a Figma file. Restores existing session or starts new. */
  switchToFile(fileKey: string, fileName: string): Promise<void>;
  /** Register a callback for model config changes. */
  onModelChange(cb: (config: ModelConfig) => void): void;
}

const log = createChildLogger({ component: 'ipc' });

export interface AgentSessionLike {
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
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
  initialSession: AgentSessionLike;
  mainWindow: BrowserWindow;
  infra: AgentInfra;
  imageGenState?: ImageGenState;
  sessionStore?: SessionStore;
  usageTracker?: UsageTracker;
}

export function setupIpcHandlers(deps: SetupIpcDeps): IpcController {
  const { mainWindow, infra, imageGenState, sessionStore, usageTracker } = deps;
  let session = deps.initialSession;
  let isStreaming = false;
  let currentModelConfig: ModelConfig = DEFAULT_MODEL;
  let currentFileKey: string | null = null;
  let currentFileName: string | null = null;

  // Prompt suggester — generates follow-up suggestions after each agent turn
  const suggester = new PromptSuggester(infra.authStorage, infra.modelRegistry);
  const switchQueue = new OperationQueue();
  const modelChangeListeners: Array<(config: ModelConfig) => void> = [];

  /** Abort the current agent stream if active. */
  async function abortIfStreaming(): Promise<void> {
    if (isStreaming) {
      await session.abort();
      isStreaming = false;
      toolStartTimes.clear();
    }
  }

  /** Persist the current file→session mapping to disk. */
  function persistSessionMapping(): void {
    if (sessionStore && currentFileKey && currentFileName && session.sessionFile) {
      sessionStore.set(currentFileKey, session.sessionFile, currentFileName);
    }
  }

  // Track tool execution timing for usage analytics
  const toolStartTimes = new Map<string, number>();

  function subscribeToSession(s: AgentSessionLike) {
    s.subscribe((event: any) => {
      const wc = mainWindow.webContents;
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent?.type === 'text_delta') {
            safeSend(wc, 'agent:text-delta', event.assistantMessageEvent.delta);
            suggester.appendAssistantText(event.assistantMessageEvent.delta);
          }
          if (event.assistantMessageEvent?.type === 'thinking_delta') {
            safeSend(wc, 'agent:thinking', event.assistantMessageEvent.delta);
          }
          break;
        case 'tool_execution_start':
          log.info({ tool: event.toolName, callId: event.toolCallId, params: event.toolParams }, 'Tool start');
          safeSend(wc, 'agent:tool-start', event.toolName, event.toolCallId);
          toolStartTimes.set(event.toolCallId, Date.now());
          break;
        case 'tool_execution_end': {
          const resultPreview = event.result?.content
            ? event.result.content.map((c: any) => ({
                type: c.type,
                ...(c.type === 'text' ? { text: (c.text || '').slice(0, 200) } : {}),
                ...(c.type === 'image' ? { hasData: !!c.data, dataLen: c.data?.length } : {}),
              }))
            : 'no content';
          log.info(
            {
              tool: event.toolName,
              callId: event.toolCallId,
              isError: event.isError,
              resultContent: resultPreview,
            },
            'Tool end',
          );
          safeSend(wc, 'agent:tool-end', event.toolName, event.toolCallId, !event.isError, event.result);
          const startTime = toolStartTimes.get(event.toolCallId);
          const durationMs = startTime ? Date.now() - startTime : 0;
          toolStartTimes.delete(event.toolCallId);
          const category = categorizeToolName(event.toolName);
          if (event.isError) {
            usageTracker?.trackToolError(event.toolName, String(resultPreview), undefined);
          }
          usageTracker?.trackToolCall(event.toolName, category, !event.isError, durationMs);
          // Image gen tools emit a second event for the image-specific Axiom dashboard
          if (
            event.toolName.startsWith('figma_generate_') ||
            event.toolName.startsWith('figma_edit_') ||
            event.toolName === 'figma_restore_image'
          ) {
            const imageType = event.toolName.replace('figma_', '');
            usageTracker?.trackImageGen(imageType, 'gemini', !event.isError, durationMs);
          }
          if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
            const imageContent = event.result.content.find((c: any) => c.type === 'image');
            if (imageContent) {
              log.info({ dataLen: imageContent.data?.length }, 'Screenshot image forwarded to renderer');
              safeSend(wc, 'agent:screenshot', imageContent.data);
            } else {
              log.warn({ content: resultPreview }, 'Screenshot tool succeeded but no image content found');
            }
          }
          break;
        }
        case 'message_end': {
          // Forward token usage for context bar
          const msg = event.message;
          if (msg?.role === 'assistant') {
            const usage = msg.usage;
            if (usage) {
              safeSend(wc, 'agent:usage', {
                input: usage.input,
                output: usage.output,
                total: usage.totalTokens,
              });
            } else {
              log.warn('Assistant message_end has no usage data — context bar will not update');
            }
          }
          break;
        }
        case 'agent_end':
          isStreaming = false;
          safeSend(wc, 'agent:end');
          // Generate suggestions asynchronously — don't block the UI
          {
            const suggestStart = Date.now();
            suggester
              .suggest(currentModelConfig)
              .then((suggestions) => {
                usageTracker?.trackSuggestionsGenerated(suggestions.length, Date.now() - suggestStart);
                if (suggestions.length > 0) {
                  safeSend(wc, 'agent:suggestions', suggestions);
                }
                suggester.resetAssistantText();
              })
              .catch((err) => {
                log.warn({ err }, 'Failed to generate suggestions');
                suggester.resetAssistantText();
              });
          }
          break;
        case 'auto_compaction_start':
          safeSend(wc, 'agent:compaction', true);
          break;
        case 'auto_compaction_end':
          safeSend(wc, 'agent:compaction', false);
          usageTracker?.trackCompaction(0, 0); // SDK does not expose token counts; zeros signal "compaction occurred"
          break;
        case 'auto_retry_start':
          safeSend(wc, 'agent:retry', true);
          break;
        case 'auto_retry_end':
          safeSend(wc, 'agent:retry', false);
          break;
      }
    });
  }

  // Subscribe to initial session
  subscribeToSession(session);

  // ── Agent prompt/abort ─────────────────
  ipcMain.handle('agent:prompt', async (_event, text: string) => {
    // Pre-check: ensure the current provider has credentials before calling prompt.
    // Without this, the SDK may hang indefinitely on an unauthenticated API call.
    const apiKey = await infra.authStorage.getApiKey(currentModelConfig.provider);
    if (!apiKey) {
      safeSend(
        mainWindow.webContents,
        'agent:text-delta',
        'No credentials configured for this model. Open Settings to log in or add an API key.',
      );
      safeSend(mainWindow.webContents, 'agent:end');
      return;
    }

    suggester.trackUserPrompt(text);
    suggester.resetAssistantText();
    usageTracker?.trackPrompt(text.length, isStreaming);
    try {
      if (isStreaming) {
        await session.prompt(text, { streamingBehavior: 'followUp' });
      } else {
        isStreaming = true;
        await session.prompt(text);
      }
    } catch (err: any) {
      log.error({ err }, 'Prompt failed');
      isStreaming = false;
      const errType = err.code === 'EAUTH' ? 'auth' : err.status === 429 ? 'rate_limit' : 'unknown';
      usageTracker?.trackAgentError(errType, err.message || 'Prompt failed');
      safeSend(
        mainWindow.webContents,
        'agent:text-delta',
        `\n\nError: ${err.message || 'Request failed. Check your credentials in Settings.'}`,
      );
      safeSend(mainWindow.webContents, 'agent:end');
    }

    persistSessionMapping();
  });

  ipcMain.handle('agent:abort', async () => {
    await session.abort();
    isStreaming = false;
  });

  // ── Window controls ────────────────────
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

  // ── Auth & Model management ────────────

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

  // ── OAuth login/logout ─────────────────

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
    if (!oauthId) return { success: false, error: `Unknown provider: ${displayGroup}` };

    // Concurrency guard: only one login at a time
    if (loginAbortController) {
      return { success: false, error: 'Login already in progress' };
    }

    loginAbortController = new AbortController();
    try {
      await infra.authStorage.login(oauthId, {
        onAuth: (info) => {
          // Validate URL before opening in system browser
          try {
            const parsed = new URL(info.url);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
              shell.openExternal(info.url);
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
              message: 'Paste the authorization code or callback URL:',
              placeholder: 'Code or URL…',
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
        return { success: false, error: 'Login cancelled' };
      }
      log.error({ displayGroup, err }, 'OAuth login failed');
      // Detect Google Workspace accounts that need a Cloud Project ID
      if (
        displayGroup === 'google' &&
        typeof err.message === 'string' &&
        err.message.includes('GOOGLE_CLOUD_PROJECT')
      ) {
        return {
          success: false,
          error:
            'This Google account requires a Cloud Project ID. Enter your Google Cloud Project ID in the field below and try again.',
          code: 'GOOGLE_CLOUD_PROJECT_REQUIRED',
        };
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
      // logout() already calls remove() internally
      infra.authStorage.logout(oauthId);
    }
    // Also remove API key credentials stored under the display group name
    infra.authStorage.remove(displayGroup);
    log.info({ displayGroup }, 'Logged out');
    return true;
  });

  let currentThinkingLevel = 'medium';

  ipcMain.handle('agent:set-thinking', (_event, level: string) => {
    const before = currentThinkingLevel;
    session.setThinkingLevel?.(level);
    currentThinkingLevel = level;
    usageTracker?.trackThinkingChange(before, level);
    log.info({ level }, 'Thinking level changed');
  });

  ipcMain.handle('auth:switch-model', (_event, config: ModelConfig) =>
    switchQueue.execute(async () => {
      log.info({ provider: config.provider, model: config.modelId }, 'Switching model');
      const previousModel = { provider: currentModelConfig.provider, modelId: currentModelConfig.modelId };
      try {
        await abortIfStreaming();

        const result = await createFigmaAgent(infra, config);
        session = result.session as unknown as AgentSessionLike;
        subscribeToSession(session);
        currentModelConfig = config;
        currentThinkingLevel = 'medium'; // reset to default for new session
        suggester.reset();
        persistSessionMapping();
        usageTracker?.trackModelSwitch(previousModel, { provider: config.provider, modelId: config.modelId });
        // Notify external listeners (e.g., SettingsRefs in index.ts)
        modelChangeListeners.forEach((cb) => cb(config));

        log.info({ provider: config.provider, model: config.modelId }, 'Model switched');
        return { success: true };
      } catch (err: any) {
        log.error({ err }, 'Failed to switch model');
        return { success: false, error: err.message };
      }
    }),
  );

  // ── Image Generation settings ────────────

  ipcMain.handle('imagegen:get-config', () => {
    return {
      hasApiKey: !!effectiveApiKey(imageGenState?.settings ?? {}),
      hasCustomKey: !!imageGenState?.settings.apiKey,
      model: imageGenState?.settings.model || DEFAULT_IMAGE_MODEL,
      models: IMAGE_GEN_MODELS,
    };
  });

  ipcMain.handle('imagegen:set-config', async (_event, config: { apiKey?: string; model?: string }) => {
    if (!imageGenState) return { success: false, error: 'Image generation not initialized' };

    if (config.apiKey !== undefined) {
      imageGenState.settings.apiKey = config.apiKey || undefined;
    }
    if (config.model) {
      imageGenState.settings.model = config.model;
    }

    // Persist to disk
    await saveImageGenSettings(imageGenState.settings);

    // Recreate generator with updated config (falls back to default key)
    const key = effectiveApiKey(imageGenState.settings);
    imageGenState.generator = new ImageGenerator({
      apiKey: key,
      model: imageGenState.settings.model,
    });
    log.info(
      { model: imageGenState.generator.model, isDefault: !imageGenState.settings.apiKey },
      'Image generator updated',
    );

    return { success: true, hasCustomKey: !!imageGenState.settings.apiKey };
  });

  // ── Compression profile & cache management ──────

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

  // ── Figma plugin setup ──────────────────

  const PLUGIN_MANIFEST = 'manifest.json';

  function getPluginSourcePath(): string | null {
    const candidates = [
      join(process.resourcesPath, 'figma-desktop-bridge'), // Packaged app
      join(app.getAppPath(), 'figma-desktop-bridge'), // Dev mode
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
      return { success: false, error: 'Plugin files not found in app bundle.' };
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

  // ── Diagnostics ─────────────────────────

  ipcMain.handle('diagnostics:export', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Diagnostics',
      defaultPath: `bottega-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
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

  // ── Session persistence ─────────────────

  ipcMain.handle('session:reset', () =>
    switchQueue.execute(async () => {
      try {
        await abortIfStreaming();
        await session.newSession();
        suggester.reset();
        persistSessionMapping();

        log.info({ fileKey: currentFileKey }, 'Session reset');
        return { success: true };
      } catch (err: any) {
        log.error({ err }, 'Failed to reset session');
        return { success: false, error: err.message };
      }
    }),
  );

  ipcMain.handle('session:get-messages', () => {
    try {
      const messages = session.messages || [];
      return extractRenderableMessages(messages);
    } catch (err: any) {
      log.warn({ err }, 'Failed to extract session messages');
      return [];
    }
  });

  // ── Auto-update ────────────────────────
  ipcMain.handle('update:get-version', () => getAppVersion());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => quitAndInstall());

  // ── Controller for cross-module coordination ──

  async function switchToFile(fileKey: string, fileName: string): Promise<void> {
    await switchQueue.execute(() => switchToFileImpl(fileKey, fileName));
  }

  async function switchToFileImpl(fileKey: string, fileName: string): Promise<void> {
    currentFileKey = fileKey;
    currentFileName = fileName;

    if (!sessionStore) return;

    const entry = sessionStore.get(fileKey);

    if (entry && existsSync(entry.sessionPath)) {
      try {
        await abortIfStreaming();
        await session.switchSession(entry.sessionPath);
        sessionStore.touch(fileKey);
        suggester.reset();

        const messages = extractRenderableMessages(session.messages || []);
        safeSend(mainWindow.webContents, 'session:restored', messages);
        log.info({ fileKey, fileName, turns: messages.length }, 'Session restored for file');
      } catch (err) {
        log.warn({ err, fileKey }, 'Failed to restore session — starting fresh');
        safeSend(mainWindow.webContents, 'session:restore-failed', { fileKey, fileName });
        await startNewSessionForFile(fileKey, fileName);
      }
    } else {
      await startNewSessionForFile(fileKey, fileName);
    }
  }

  async function startNewSessionForFile(fileKey: string, fileName: string): Promise<void> {
    try {
      await abortIfStreaming();
      await session.newSession();
      suggester.reset();

      if (sessionStore && session.sessionFile) {
        sessionStore.set(fileKey, session.sessionFile, fileName);
      }
      // Signal renderer to clear any stale chat from a previous file
      safeSend(mainWindow.webContents, 'session:restored', []);
      log.info({ fileKey, fileName }, 'New session started for file');
    } catch (err) {
      log.warn({ err, fileKey }, 'Failed to start new session for file');
    }
  }

  return {
    switchToFile,
    onModelChange: (cb: (config: ModelConfig) => void) => modelChangeListeners.push(cb),
  };
}
