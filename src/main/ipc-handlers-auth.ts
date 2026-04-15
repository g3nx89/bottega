/**
 * IPC handlers for authentication: API keys, OAuth login/logout, model listing.
 *
 * Extracted from ipc-handlers.ts to isolate the auth domain.
 */
import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { fail, ok } from '../shared/ipc-result.js';
import {
  type AgentInfra,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  OAUTH_PROVIDER_INFO,
  OAUTH_PROVIDER_MAP,
  safeReloadAuth,
} from './agent.js';
import { removeMetaEntry, touchMetaEntry } from './auth-meta.js';
import { AuthRefresher } from './auth-refresh.js';
import { recordLogout } from './auth-snapshot.js';
import {
  MSG_GOOGLE_PROJECT_REQUIRED,
  MSG_LOGIN_CANCELLED,
  MSG_LOGIN_IN_PROGRESS,
  MSG_PASTE_AUTH_CODE,
  MSG_PASTE_AUTH_CODE_PLACEHOLDER,
  MSG_UNKNOWN_PROVIDER,
} from './messages.js';
import { safeSend } from './safe-send.js';
import { redactMessage } from './usage-tracker.js';

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
      try {
        touchMetaEntry(provider, 'api_key', apiKey, app.getVersion());
      } catch (err) {
        log.warn({ err, provider }, 'Failed to touch auth-meta after set-key');
      }
      log.info({ provider }, 'API key saved');
    } else {
      infra.authStorage.remove(provider);
      try {
        removeMetaEntry(provider);
      } catch (err) {
        log.warn({ err, provider }, 'Failed to remove auth-meta entry');
      }
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
      // F20: 'openai' is API-key-only; 'openai-codex' is OAuth-only. Other groups
      // still accept either. Without this split, the OpenAI card would report
      // 'oauth' whenever a Codex login existed, hiding the missing API key.
      const apiKeyOnly = displayGroup === 'openai';
      const oauthOnly = displayGroup === 'openai-codex';
      const oauthCred = oauthOnly || !apiKeyOnly ? infra.authStorage.get(oauthId) : undefined;
      const apiKeyCred = oauthOnly ? undefined : infra.authStorage.get(displayGroup);
      if (!apiKeyOnly && oauthCred?.type === 'oauth') {
        status[displayGroup] = { type: 'oauth', label: OAUTH_PROVIDER_INFO[displayGroup]?.description || 'Logged in' };
      } else if (!oauthOnly && (apiKeyCred?.type === 'api_key' || oauthCred?.type === 'api_key')) {
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
      try {
        const cred = infra.authStorage.get(oauthId) as any;
        const token = cred?.access ?? cred?.accessToken ?? cred?.key ?? '';
        touchMetaEntry(oauthId, 'oauth', token, app.getVersion());
      } catch (err) {
        log.warn({ err, oauthId }, 'Failed to touch auth-meta after OAuth login');
      }
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

  // ── F11: model probe / test connection / model status ──

  ipcMain.handle('auth:force-refresh', async (_event, displayGroup: string) => {
    const oauthId = OAUTH_PROVIDER_MAP[displayGroup];
    if (!oauthId) return fail('Unknown provider', 'UNKNOWN_PROVIDER');
    try {
      const refresher = new AuthRefresher(infra.authStorage);
      const result = await refresher.refresh(oauthId);
      if (result.outcome === 'ok') return ok({ outcome: result.outcome });
      return fail(result.errorMessage ?? result.outcome, result.outcome.toUpperCase());
    } catch (err: any) {
      return fail(err?.message ?? String(err));
    }
  });

  ipcMain.handle('auth:probe-model', async (_event, provider: string, modelId: string) => {
    if (!provider || !modelId) return fail('invalid args', 'INVALID_ARGS');
    // Validate against known models — prevents cache pollution from arbitrary strings.
    const known = Object.values(AVAILABLE_MODELS)
      .flat()
      .some((m: any) => (m.sdkProvider ?? m.provider) === provider && (m.id ?? m.modelId) === modelId);
    if (!known) return fail('unknown model', 'UNKNOWN_MODEL');
    const start = Date.now();
    const result = await infra.modelProbe.probe(provider, modelId);
    return ok({
      status: result.status,
      httpStatus: result.httpStatus,
      cacheHit: result.cacheHit,
      durationMs: Date.now() - start,
    });
  });

  ipcMain.handle('auth:test-connection', async (_event, displayGroup: string) => {
    const entries = AVAILABLE_MODELS[displayGroup];
    if (!entries || entries.length === 0) return fail('Unknown provider', 'UNKNOWN_PROVIDER');
    const first = entries[0] as { id: string; sdkProvider: string };
    const result = await infra.modelProbe.probe(first.sdkProvider, first.id);
    if (result.status === 'ok') {
      return ok({ status: result.status, httpStatus: result.httpStatus, modelId: first.id });
    }
    // Security: route errorBody through redactMessage before exposing to renderer.
    const redacted = result.errorBody ? redactMessage(result.errorBody).slice(0, 200) : result.status;
    return fail(redacted, result.status.toUpperCase());
  });

  ipcMain.handle('auth:get-model-status', async () => {
    // Returns a snapshot per known model — consumed by the picker to render dots.
    // Parallelized: every Settings open triggers ~15 getStatusSnapshot calls,
    // each doing an async authStorage.getApiKey() (OAuth path hits keychain+lock).
    // Sequential awaits added ~15× latency; Promise.all runs per-model concurrently.
    const allModels = Object.values(AVAILABLE_MODELS).flat() as { id: string; sdkProvider: string }[];
    const entries = await Promise.all(
      allModels.map(async (m) => [m.id, await infra.modelProbe.getStatusSnapshot(m.sdkProvider, m.id)] as const),
    );
    return Object.fromEntries(entries);
  });

  ipcMain.handle('auth:logout', (_event, displayGroup: string) => {
    const oauthId = OAUTH_PROVIDER_MAP[displayGroup];
    if (oauthId) {
      infra.authStorage.logout(oauthId);
      try {
        removeMetaEntry(oauthId);
      } catch (err) {
        log.warn({ err, oauthId }, 'Failed to remove auth-meta on logout');
      }
    }
    infra.authStorage.remove(displayGroup);
    try {
      removeMetaEntry(displayGroup);
    } catch {
      // best-effort
    }
    // F3: tag this as user-initiated so the next-launch snapshot diff doesn't
    // flag the resulting regression as silent token loss.
    try {
      recordLogout(displayGroup);
    } catch (err) {
      log.warn({ err, displayGroup }, 'Failed to record logout timestamp');
    }
    log.info({ displayGroup }, 'Logged out');
    return true;
  });
}
