/**
 * Reset IPC handlers — user-facing cleanup escape hatches.
 *
 * Three escalating levels:
 *   - app:reset-auth       clear tokens/API keys, keep sessions
 *   - app:clear-history    clear chat sessions, keep auth
 *   - app:factory-reset    nuke everything + restart
 *
 * Each handler prompts a native confirm dialog before destructive work.
 */

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, ipcMain, safeStorage } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import type { AgentInfra } from './agent.js';
import { OAUTH_PROVIDER_MAP } from './agent.js';

const log = createChildLogger({ component: 'ipc-reset' });

function defaultBottegaDir(): string {
  return path.join(os.homedir(), '.bottega');
}

function defaultAppSupportDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Bottega');
}

function defaultLogsDir(): string {
  return path.join(os.homedir(), 'Library', 'Logs', 'Bottega');
}

function removeIfPresent(p: string): boolean {
  // rmSync with force:true is a no-op on missing paths — skip the existsSync
  // pre-check (TOCTOU race + extra stat syscall).
  try {
    rmSync(p, { recursive: true, force: true });
    return true;
  } catch (err) {
    log.warn({ err, path: p }, 'Failed to remove path');
    return false;
  }
}

/** Forget every stored OAuth/API-key credential via Pi SDK authStorage. */
async function wipeAuthStorage(infra: AgentInfra): Promise<void> {
  const ids = new Set<string>([...Object.keys(OAUTH_PROVIDER_MAP), ...Object.values(OAUTH_PROVIDER_MAP)]);
  for (const id of ids) {
    try {
      infra.authStorage.logout(id);
    } catch {
      // pi-sdk may throw if already absent — ignore
    }
    try {
      infra.authStorage.remove(id);
    } catch {
      // ignore
    }
  }
}

async function confirm(title: string, message: string, detail: string): Promise<boolean> {
  const res = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Continue'],
    defaultId: 0,
    cancelId: 0,
    title,
    message,
    detail,
  });
  return res.response === 1;
}

export interface ResetHandlerDeps {
  infra: AgentInfra;
  /** Optional overrides for testing. */
  paths?: {
    bottegaDir?: string;
    appSupportDir?: string;
    logsDir?: string;
  };
}

export function setupResetHandlers({ infra, paths }: ResetHandlerDeps): void {
  const bottegaDir = paths?.bottegaDir ?? defaultBottegaDir();
  const appSupportDir = paths?.appSupportDir ?? defaultAppSupportDir();
  const logsDir = paths?.logsDir ?? defaultLogsDir();

  ipcMain.handle('app:reset-auth', async () => {
    const ok = await confirm(
      'Reset authentication',
      'Remove all stored logins and API keys?',
      'Chat history is kept. You will need to sign in again for every provider.',
    );
    if (!ok) return { ok: false, cancelled: true };
    await wipeAuthStorage(infra);
    for (const f of ['auth-meta.json', 'figma-auth.json', 'last-auth-snapshot.json', 'last-good-model.json']) {
      removeIfPresent(path.join(bottegaDir, f));
    }
    log.info('Auth reset completed');
    return { ok: true };
  });

  ipcMain.handle('app:clear-history', async () => {
    const ok = await confirm(
      'Clear chat history',
      'Delete all chat sessions and per-file history?',
      'Authentication and app settings are kept. This cannot be undone.',
    );
    if (!ok) return { ok: false, cancelled: true };
    removeIfPresent(path.join(bottegaDir, 'sessions'));
    removeIfPresent(path.join(bottegaDir, 'subagent-runs'));
    removeIfPresent(path.join(bottegaDir, 'file-sessions.json'));
    log.info('Chat history cleared');
    return { ok: true };
  });

  ipcMain.handle('app:factory-reset', async () => {
    const ok = await confirm(
      'Factory reset',
      'Erase ALL Bottega data and restart?',
      'This removes every login, chat, setting, and cache. The app will restart empty. This cannot be undone.',
    );
    if (!ok) return { ok: false, cancelled: true };
    await wipeAuthStorage(infra);
    removeIfPresent(bottegaDir);
    removeIfPresent(appSupportDir);
    removeIfPresent(logsDir);
    // safeStorage master key is not programmatically clearable — relying on
    // the bottegaDir wipe above since all encrypted blobs live there.
    void safeStorage.isEncryptionAvailable;
    log.info('Factory reset completed — relaunching');
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
}
