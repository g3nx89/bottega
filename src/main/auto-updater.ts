import { app, type BrowserWindow } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { safeSend } from './safe-send.js';

const log = createChildLogger({ component: 'auto-updater' });

/** Lazy-loaded autoUpdater — electron-updater calls app.getVersion() on import, which fails in tests. */
let _autoUpdater: any;
function getAutoUpdater() {
  if (!_autoUpdater) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-updater');
    _autoUpdater = mod.autoUpdater || mod.default?.autoUpdater;
  }
  return _autoUpdater;
}

/**
 * Initializes auto-update checking via electron-updater.
 * Publishes events to the renderer so the UI can show update status.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  const autoUpdater = getAutoUpdater();
  autoUpdater.logger = null; // We use pino instead
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update…');
    safeSend(mainWindow.webContents, 'update:checking');
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info({ version: info.version }, 'Update available');
    safeSend(mainWindow.webContents, 'update:available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date');
    safeSend(mainWindow.webContents, 'update:not-available');
  });

  autoUpdater.on('download-progress', (progress: any) => {
    safeSend(mainWindow.webContents, 'update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    log.info({ version: info.version }, 'Update downloaded — will install on quit');
    safeSend(mainWindow.webContents, 'update:downloaded', info.version);
  });

  autoUpdater.on('error', (err: Error) => {
    log.error({ err }, 'Auto-update error');
    safeSend(mainWindow.webContents, 'update:error', err.message);
  });

  // Check after a short delay to avoid slowing down startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.warn({ err }, 'Failed to check for updates');
    });
  }, 5_000);
}

/** Quit and install the downloaded update immediately. */
export function quitAndInstall(): void {
  getAutoUpdater().quitAndInstall();
}

/** Returns the current app version. */
export function getAppVersion(): string {
  return app.getVersion();
}
