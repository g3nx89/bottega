import { type BrowserWindow, ipcMain, shell } from 'electron';
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
import { type ImageGenSettings, saveImageGenSettings } from './image-gen/config.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_GEN_MODELS, ImageGenerator } from './image-gen/image-generator.js';
import { PromptSuggester } from './prompt-suggester.js';

const log = createChildLogger({ component: 'ipc' });

export interface AgentSessionLike {
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: any) => void): void;
}

export interface ImageGenState {
  generator: ImageGenerator | null;
  settings: ImageGenSettings;
}

export function setupIpcHandlers(
  initialSession: AgentSessionLike,
  mainWindow: BrowserWindow,
  infra: AgentInfra,
  imageGenState?: ImageGenState,
) {
  let session = initialSession;
  let isStreaming = false;
  let currentModelConfig: ModelConfig = DEFAULT_MODEL;

  // Prompt suggester — generates follow-up suggestions after each agent turn
  const suggester = new PromptSuggester(infra.authStorage, infra.modelRegistry);

  function subscribeToSession(s: AgentSessionLike) {
    s.subscribe((event: any) => {
      const wc = mainWindow.webContents;
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent?.type === 'text_delta') {
            wc.send('agent:text-delta', event.assistantMessageEvent.delta);
            suggester.appendAssistantText(event.assistantMessageEvent.delta);
          }
          if (event.assistantMessageEvent?.type === 'thinking_delta') {
            wc.send('agent:thinking', event.assistantMessageEvent.delta);
          }
          break;
        case 'tool_execution_start':
          log.info({ tool: event.toolName, callId: event.toolCallId, params: event.toolParams }, 'Tool start');
          wc.send('agent:tool-start', event.toolName, event.toolCallId);
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
          wc.send('agent:tool-end', event.toolName, event.toolCallId, !event.isError, event.result);
          if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
            const imageContent = event.result.content.find((c: any) => c.type === 'image');
            if (imageContent) {
              log.info({ dataLen: imageContent.data?.length }, 'Screenshot image forwarded to renderer');
              wc.send('agent:screenshot', imageContent.data);
            } else {
              log.warn({ content: resultPreview }, 'Screenshot tool succeeded but no image content found');
            }
          }
          break;
        }
        case 'message_end': {
          // Forward token usage for context bar
          const msg = event.message;
          if (msg?.usage) {
            wc.send('agent:usage', { input: msg.usage.input, output: msg.usage.output, total: msg.usage.totalTokens });
          }
          break;
        }
        case 'agent_end':
          isStreaming = false;
          wc.send('agent:end');
          // Generate suggestions asynchronously — don't block the UI
          suggester
            .suggest(currentModelConfig)
            .then((suggestions) => {
              if (suggestions.length > 0) {
                wc.send('agent:suggestions', suggestions);
              }
              suggester.resetAssistantText();
            })
            .catch((err) => {
              log.warn({ err }, 'Failed to generate suggestions');
              suggester.resetAssistantText();
            });
          break;
        case 'auto_compaction_start':
          wc.send('agent:compaction', true);
          break;
        case 'auto_compaction_end':
          wc.send('agent:compaction', false);
          break;
        case 'auto_retry_start':
          wc.send('agent:retry', true);
          break;
        case 'auto_retry_end':
          wc.send('agent:retry', false);
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
      mainWindow.webContents.send(
        'agent:text-delta',
        'No credentials configured for this model. Open Settings to log in or add an API key.',
      );
      mainWindow.webContents.send('agent:end');
      return;
    }

    suggester.trackUserPrompt(text);
    suggester.resetAssistantText();
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
      mainWindow.webContents.send(
        'agent:text-delta',
        `\n\nError: ${err.message || 'Request failed. Check your credentials in Settings.'}`,
      );
      mainWindow.webContents.send('agent:end');
    }
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
          mainWindow.webContents.send('auth:login-event', {
            type: 'auth',
            url: info.url,
            instructions: info.instructions,
          });
        },
        onPrompt: (prompt) => {
          return new Promise<string>((resolve) => {
            loginPromptResolver = resolve;
            mainWindow.webContents.send('auth:login-event', {
              type: 'prompt',
              message: prompt.message,
              placeholder: prompt.placeholder,
              allowEmpty: prompt.allowEmpty,
            });
          });
        },
        onProgress: (message) => {
          mainWindow.webContents.send('auth:login-event', { type: 'progress', message });
        },
        onManualCodeInput: () => {
          return new Promise<string>((resolve) => {
            loginPromptResolver = resolve;
            mainWindow.webContents.send('auth:login-event', {
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

  ipcMain.handle('agent:set-thinking', (_event, level: string) => {
    (session as any).setThinkingLevel?.(level);
    log.info({ level }, 'Thinking level changed');
  });

  ipcMain.handle('auth:switch-model', async (_event, config: ModelConfig) => {
    log.info({ provider: config.provider, model: config.modelId }, 'Switching model');
    try {
      // Abort current session if streaming
      if (isStreaming) {
        await session.abort();
        isStreaming = false;
      }

      // Create new session with new model
      const result = await createFigmaAgent(infra, config);
      session = result.session as unknown as AgentSessionLike;
      subscribeToSession(session);
      currentModelConfig = config;
      suggester.reset();
      log.info({ provider: config.provider, model: config.modelId }, 'Model switched');
      return { success: true };
    } catch (err: any) {
      log.error({ err }, 'Failed to switch model');
      return { success: false, error: err.message };
    }
  });

  // ── Image Generation settings ────────────

  ipcMain.handle('imagegen:get-config', () => {
    return {
      hasApiKey: !!imageGenState?.settings.apiKey,
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

    // Recreate generator with updated config
    if (imageGenState.settings.apiKey) {
      imageGenState.generator = new ImageGenerator({
        apiKey: imageGenState.settings.apiKey,
        model: imageGenState.settings.model,
      });
      log.info({ model: imageGenState.generator.model }, 'Image generator updated');
    } else {
      imageGenState.generator = null;
      log.info('Image generator disabled (no API key)');
    }

    return { success: true, hasApiKey: !!imageGenState.settings.apiKey };
  });
}
