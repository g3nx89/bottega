/**
 * IPC handlers for authentication: API keys, OAuth login/logout, model listing.
 *
 * Extracted from ipc-handlers.ts to isolate the auth domain.
 */
import { type BrowserWindow, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import {
  type AgentInfra,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  OAUTH_PROVIDER_INFO,
  OAUTH_PROVIDER_MAP,
  safeReloadAuth,
} from './agent.js';
import {
  MSG_GOOGLE_PROJECT_REQUIRED,
  MSG_LOGIN_CANCELLED,
  MSG_LOGIN_IN_PROGRESS,
  MSG_PASTE_AUTH_CODE,
  MSG_PASTE_AUTH_CODE_PLACEHOLDER,
  MSG_UNKNOWN_PROVIDER,
} from './messages.js';
import { safeSend } from './safe-send.js';

const log = createChildLogger({ component: 'ipc-auth' });

const VALID_PROVIDERS = new Set([...Object.keys(OAUTH_PROVIDER_MAP), ...Object.values(OAUTH_PROVIDER_MAP)]);

export function setupAuthHandlers(deps: { infra: AgentInfra; mainWindow: BrowserWindow }): void {
  const { infra, mainWindow } = deps;

  let loginAbortController: AbortController | null = null;
  let loginPromptResolver: ((value: string) => void) | null = null;

  // ── Model / key queries ──────────────────────

  ipcMain.handle('auth:get-models', () => {
    return AVAILABLE_MODELS;
  });

  ipcMain.handle('auth:get-context-sizes', () => {
    return CONTEXT_SIZES;
  });

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

  // ── OAuth status & login ─────────────────────

  ipcMain.handle('auth:get-auth-status', () => {
    // B-020: Reload to show current auth state (tokens may have been refreshed externally)
    safeReloadAuth(infra.authStorage);
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
}
