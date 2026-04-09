/**
 * IPC handlers for the Figma REST API Personal Access Token.
 *
 * Flow: user pastes a PAT in Settings → we validate against `GET /v1/me` →
 * on success we persist via `FigmaAuthStore` and update the live `FigmaAPI`
 * instance via `setAccessToken()`, no app restart required.
 *
 * Invariants (HIGH 3 fix):
 * - On clear: the store is wiped BEFORE the live `FigmaAPI` is reset, so a
 *   failed unlink leaves both in their original state (no divergence).
 * - The live `FigmaAPI` is only cleared after `store.clear()` confirms success.
 */
import { type BrowserWindow, ipcMain, shell } from 'electron';
import { FigmaAPI } from '../figma/figma-api.js';
import { createChildLogger } from '../figma/logger.js';
import type { FigmaAuthStore } from './figma-auth-store.js';
import { safeSend } from './safe-send.js';

const log = createChildLogger({ component: 'ipc-figma-auth' });

const FIGMA_PAT_DOCS_URL = 'https://www.figma.com/developers/api#access-tokens';

export interface SetupFigmaAuthDeps {
  figmaAuthStore: FigmaAuthStore;
  figmaAPI: FigmaAPI;
  mainWindow: BrowserWindow;
}

export interface FigmaAuthSetResult {
  success: boolean;
  userHandle?: string;
  error?: string;
  status?: number;
}

export function setupFigmaAuthHandlers(deps: SetupFigmaAuthDeps): void {
  const { figmaAuthStore, figmaAPI, mainWindow } = deps;

  ipcMain.handle('figma-auth:get-status', () => {
    return figmaAuthStore.getStatus();
  });

  ipcMain.handle('figma-auth:set-token', async (_event, token: unknown): Promise<FigmaAuthSetResult> => {
    if (typeof token !== 'string' || !token.trim()) {
      return { success: false, error: 'Token is required' };
    }
    const trimmed = token.trim();

    const validation = await FigmaAPI.validateToken(trimmed);
    if (!validation.ok) {
      log.warn({ status: validation.status }, 'Figma token validation failed');
      return { success: false, error: validation.error, status: validation.status };
    }

    try {
      await figmaAuthStore.setToken(trimmed, validation.handle);
      figmaAPI.setAccessToken(trimmed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to persist Figma token');
      return { success: false, error: message };
    }

    log.info({ userHandle: validation.handle }, 'Figma REST API token saved');
    safeSend(mainWindow.webContents, 'figma-auth:status-changed', figmaAuthStore.getStatus());
    return { success: true, userHandle: validation.handle };
  });

  ipcMain.handle('figma-auth:clear', async () => {
    // HIGH 3: clear() throws on failure. Wipe disk FIRST, then reset runtime.
    // If disk fails, runtime stays at the old token (no divergence) and the
    // renderer sees success:false so the UI doesn't lie.
    try {
      await figmaAuthStore.clear();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to clear Figma token from disk');
      return { success: false, error: message };
    }
    figmaAPI.setAccessToken('');
    safeSend(mainWindow.webContents, 'figma-auth:status-changed', figmaAuthStore.getStatus());
    return { success: true };
  });

  ipcMain.handle('figma-auth:open-pat-docs', async () => {
    // `shell.openExternal` resolves to void and rejects on failure. Previously
    // we returned an unconditional `true` which made `Promise<boolean>` a lie.
    // Swallow the error and let the renderer decide if it wants to surface it.
    try {
      await shell.openExternal(FIGMA_PAT_DOCS_URL);
    } catch (err: unknown) {
      log.warn({ err }, 'Failed to open Figma PAT docs URL');
    }
  });

  log.info('Figma REST API auth IPC handlers registered');
}

/**
 * Background startup revalidation (HIGH 2 fix).
 *
 * After the main window is up, re-check the persisted token against `/v1/me`.
 * On 401/403 we clear the store and emit `status-changed` so the UI flips from
 * "Connected as X" to "Not connected" instead of silently waiting for the 3x403
 * circuit breaker to trip on the first tool call.
 *
 * Network errors during startup are NOT treated as revocation — the user may
 * simply be offline. Only confirmed 401/403 triggers a clear.
 */
export async function revalidateFigmaAuthOnStartup(deps: SetupFigmaAuthDeps): Promise<void> {
  const { figmaAuthStore, figmaAPI, mainWindow } = deps;

  const status = figmaAuthStore.getStatus();
  if (!status.connected) {
    return;
  }

  const token = figmaAuthStore.getToken();
  if (!token) {
    // Status said connected but decryption just failed — force the UI to
    // sync up with reality (HIGH 2: getStatus + getToken are now consistent,
    // but cover the race).
    safeSend(mainWindow.webContents, 'figma-auth:status-changed', figmaAuthStore.getStatus());
    return;
  }

  log.info('Revalidating persisted Figma token against /v1/me');
  const validation = await FigmaAPI.validateToken(token);
  if (validation.ok) {
    log.info({ userHandle: validation.handle }, 'Persisted Figma token is still valid');
    return;
  }

  // Only auth-level failures mean "token is dead". Network/timeout errors
  // keep the token in place and let the user retry later.
  if (validation.status === 401 || validation.status === 403) {
    log.warn({ status: validation.status }, 'Persisted Figma token is no longer valid — clearing');
    try {
      await figmaAuthStore.clear();
      figmaAPI.setAccessToken('');
    } catch (err) {
      log.error({ err }, 'Failed to clear revoked Figma token at startup');
    }
    safeSend(mainWindow.webContents, 'figma-auth:status-changed', figmaAuthStore.getStatus());
    return;
  }

  log.warn({ error: validation.error }, 'Figma startup revalidation inconclusive (kept existing token)');
}
