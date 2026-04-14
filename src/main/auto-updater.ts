import type { BrowserWindow } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { safeSend } from './safe-send.js';

const log = createChildLogger({ component: 'auto-updater' });

/**
 * Initializes auto-update checking via electron-updater.
 * Uses dynamic import() because electron-updater calls app.getVersion() on import,
 * which fails in test environments where Electron is not available.
 */
export async function initAutoUpdater(mainWindow: BrowserWindow): Promise<void> {
  let autoUpdater: any;
  try {
    const mod = await import('electron-updater');
    autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  } catch (err) {
    log.warn({ err }, 'Failed to load electron-updater — auto-updates disabled');
    return;
  }

  autoUpdater.logger = null; // We use pino instead
  autoUpdater.autoDownload = false; // User decides via modal
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update…');
    safeSend(mainWindow.webContents, 'update:checking');
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info({ version: info.version, releaseNotes: info.releaseNotes }, 'Update available');
    safeSend(mainWindow.webContents, 'update:available', {
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : info.releaseNotes?.map((n: any) => n.note).join('\n') || '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date');
    safeSend(mainWindow.webContents, 'update:not-available');
  });

  autoUpdater.on('download-progress', (progress: any) => {
    safeSend(mainWindow.webContents, 'update:progress', Math.round(progress.percent));
  });

  let downloadedVersion: string | null = null;
  autoUpdater.on('update-downloaded', (info: any) => {
    // Guard: electron-updater can fire this event twice (observed in logs).
    if (downloadedVersion === info.version) return;
    downloadedVersion = info.version;
    log.info({ version: info.version }, 'Update downloaded — will install on quit');
    safeSend(mainWindow.webContents, 'update:downloaded', info.version);
  });

  autoUpdater.on('error', (err: Error & { code?: string }) => {
    // Suppress "channel file not found" errors — they happen when the GitHub release
    // doesn't include latest-mac.yml and are not actionable by the user.
    if (err.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
      log.warn('Auto-update channel file missing (latest-mac.yml) — skipping update check');
      return;
    }
    log.error({ err }, 'Auto-update error');
    safeSend(mainWindow.webContents, 'update:error', err.message);
  });

  // Check after a short delay to avoid slowing down startup.
  // Errors are handled by the 'error' event above — swallow .catch to avoid duplicate logs.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5_000);
}

/** Download the available update. */
export async function downloadUpdate(): Promise<void> {
  const mod = await import('electron-updater');
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  await autoUpdater.downloadUpdate();
}

/** Manually check for updates. Errors are handled by the 'error' event listener. */
export async function checkForUpdates(): Promise<void> {
  const mod = await import('electron-updater');
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  // Swallow rejection — the autoUpdater 'error' event handler decides what to surface.
  await autoUpdater.checkForUpdates().catch(() => {});
}

/** Quit and install the downloaded update immediately. */
export async function quitAndInstall(): Promise<void> {
  try {
    const mod = await import('electron-updater');
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
    autoUpdater.quitAndInstall();
  } catch (err) {
    log.error({ err }, 'quitAndInstall failed');
    throw err;
  }
}

/** Returns the current app version. */
export function getAppVersion(): string {
  return __APP_VERSION__;
}
