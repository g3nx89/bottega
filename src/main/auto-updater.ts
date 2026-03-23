import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createChildLogger } from '../figma/logger.js';
import { safeSend } from './safe-send.js';

const log = createChildLogger({ component: 'auto-updater' });

/**
 * Initializes auto-update checking via electron-updater.
 * Publishes events to the renderer so the UI can show update status.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = null; // We use pino instead
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update…');
    safeSend(mainWindow.webContents, 'update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    log.info({ version: info.version }, 'Update available');
    safeSend(mainWindow.webContents, 'update:available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date');
    safeSend(mainWindow.webContents, 'update:not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    safeSend(mainWindow.webContents, 'update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info({ version: info.version }, 'Update downloaded — will install on quit');
    safeSend(mainWindow.webContents, 'update:downloaded', info.version);
  });

  autoUpdater.on('error', (err) => {
    log.error({ err }, 'Auto-update error');
    safeSend(mainWindow.webContents, 'update:error', err.message);
  });

  // Check after a short delay to avoid slowing down startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn({ err }, 'Failed to check for updates');
    });
  }, 5_000);
}

/** Quit and install the downloaded update immediately. */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

/** Returns the current app version. */
export function getAppVersion(): string {
  return app.getVersion();
}
