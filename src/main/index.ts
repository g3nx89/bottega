import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, crashReporter, dialog } from 'electron';
import { createChildLogger, logFilePath, logger, sessionUid } from '../figma/logger.js';
import { DEFAULT_WS_PORT } from '../figma/port-discovery.js';
import { createAgentInfra } from './agent.js';
import { AppStatePersistence } from './app-state-persistence.js';
import { initAutoUpdater } from './auto-updater.js';
import { cleanOldLogs, collectSystemInfo } from './diagnostics.js';
import { createFigmaCore } from './figma-core.js';
import { effectiveApiKey, loadImageGenSettings } from './image-gen/config.js';
import { ImageGenerator } from './image-gen/image-generator.js';
import { setupIpcHandlers } from './ipc-handlers.js';
import {
  MSG_PORT_IN_USE_BODY,
  MSG_PORT_IN_USE_TITLE,
  MSG_STARTUP_ERROR_BODY,
  MSG_STARTUP_ERROR_TITLE,
} from './messages.js';
import { loadDiagnosticsConfig, UsageTracker } from './remote-logger.js';
import { safeSend } from './safe-send.js';
import { SessionStore } from './session-store.js';
import { SlotManager } from './slot-manager.js';
import { handleSecondInstance, isPortConflict } from './startup-guards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Ensure PATH includes node/npm location ──────────
// When launched from Finder, macOS provides a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// Pi SDK needs `npm` to resolve global packages. We scan common install locations.
import { existsSync, readdirSync } from 'node:fs';

{
  const home = process.env.HOME || '';
  const candidates = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.volta/bin'),
    path.join(home, '.local/bin'),
  ];

  // nvm: find the latest installed version's bin directory
  const nvmDir = path.join(home, '.nvm/versions/node');
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir)
        .filter((d) => d.startsWith('v'))
        .sort();
      if (versions.length > 0) candidates.push(path.join(nvmDir, versions[versions.length - 1]!, 'bin'));
    } catch {}
  }

  // fnm
  const fnmDir = path.join(home, '.local/share/fnm/node-versions');
  if (existsSync(fnmDir)) {
    try {
      const versions = readdirSync(fnmDir)
        .filter((d) => d.startsWith('v'))
        .sort();
      if (versions.length > 0) candidates.push(path.join(fnmDir, versions[versions.length - 1]!, 'installation/bin'));
    } catch {}
  }

  const currentPath = process.env.PATH || '';
  const missing = candidates.filter((p) => p && existsSync(p) && !currentPath.includes(p));
  if (missing.length > 0) {
    process.env.PATH = `${currentPath}:${missing.join(':')}`;
  }
}

const log = createChildLogger({ component: 'main' });

// ── Crash & error logging ────────────────────

// Native crash dumps (segfault, OOM) → ~/Library/Logs/Bottega/crashes/
crashReporter.start({ uploadToServer: false });

process.on('uncaughtException', (err) => {
  // Track before exit — appState.usageTracker is null until app.whenReady()
  appState.usageTracker?.trackUncaughtException({ name: err.name, message: err.message, stack: err.stack });
  log.fatal({ err }, 'Uncaught exception');
  // Flush pino async transports before exiting — callback exits immediately on success, timeout as safety net
  logger.flush(() => app.exit(1));
  setTimeout(() => app.exit(1), 1000);
});

process.on('unhandledRejection', (reason: any) => {
  appState.usageTracker?.trackUnhandledRejection({
    name: reason?.name,
    code: reason?.code,
    message: reason?.message,
  });
  log.error(
    {
      message: reason?.message,
      code: reason?.code,
      name: reason?.name,
      stack: reason?.stack,
      raw: String(reason),
    },
    'Unhandled promise rejection',
  );
});

// ── Graceful shutdown ────────────────────────

let mainWindow: BrowserWindow | null = null;
let figmaCore: Awaited<ReturnType<typeof createFigmaCore>> | null = null;
const appState: {
  infra: Awaited<ReturnType<typeof createAgentInfra>> | null;
  usageTracker: UsageTracker | null;
  slotManager: InstanceType<typeof SlotManager> | null;
} = { infra: null, usageTracker: null, slotManager: null };
let cleaningUp = false;

async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  log.info('Shutting down');
  try {
    if (appState.slotManager) {
      appState.slotManager.persistStateSync();
    }
  } catch {
    // best-effort
  }
  try {
    if (appState.usageTracker) {
      appState.usageTracker.trackAppQuit(Math.round(process.uptime()), 0);
      appState.usageTracker.stopHeartbeat();
    }
  } catch {
    // best-effort
  }
  try {
    if (appState.infra) await appState.infra.metricsCollector.finalize();
  } catch (err) {
    log.warn({ err }, 'Error finalizing metrics');
  }
  try {
    if (figmaCore) await figmaCore.stop();
  } catch (err) {
    log.error({ err }, 'Error during cleanup');
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  app.quit();
});
process.on('SIGTERM', () => {
  app.quit();
});

// ── Single instance lock ─────────────────────
// Prevent multiple Bottega instances from conflicting on the WebSocket port.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.warn('Another Bottega instance is already running — quitting');
  app.quit();
} else {
  app.on('second-instance', () => handleSecondInstance(mainWindow));

  // ── App startup ──────────────────────────────
  // Inside the else branch so a second instance never reaches startup code,
  // even if app.quit() hasn't completed before whenReady resolves.

  app
    .whenReady()
    .then(async () => {
      const appStartTime = Date.now();
      log.info({ logFile: logFilePath, sessionUid }, 'App starting');

      // Clean up log files older than 30 days (async, fire-and-forget — don't block startup)
      cleanOldLogs().catch(() => {});

      const isTestMode = !!process.env.BOTTEGA_TEST_MODE;

      // 1. Start Figma core (WebSocket server — port 0 in test mode for auto-assign)
      const wsPort = isTestMode ? 0 : DEFAULT_WS_PORT;
      figmaCore = await createFigmaCore({ port: wsPort });
      try {
        await figmaCore.start();
      } catch (err: unknown) {
        if (isPortConflict(err)) {
          log.error({ port: wsPort }, 'Port already in use — cannot start WebSocket server');
          dialog.showErrorBox(MSG_PORT_IN_USE_TITLE, MSG_PORT_IN_USE_BODY(wsPort));
          figmaCore = null; // never started — nothing to clean up
          app.quit();
          return;
        }
        throw err;
      }
      log.info({ port: figmaCore.wsServer.address()?.port ?? wsPort }, 'Figma WebSocket server started');

      // 2. Image generation state (shared between tools and IPC handlers)
      const imageGenSettings = loadImageGenSettings();
      const apiKey = effectiveApiKey(imageGenSettings);
      const imageGenState = {
        generator: new ImageGenerator({ apiKey, model: imageGenSettings.model }),
        settings: imageGenSettings,
      };
      log.info(
        { model: imageGenState.generator.model, isDefault: !imageGenSettings.apiKey },
        'Image generator initialized',
      );

      // 3. Create agent infrastructure (tools are created per-slot, not globally)
      //    In test mode, use stub infra.
      let infra: Awaited<ReturnType<typeof createAgentInfra>>;

      if (isTestMode) {
        log.info('Test mode: using stub agent infra');
        const { CompressionConfigManager } = await import('./compression/compression-config.js');
        const { DesignSystemCache } = await import('./compression/design-system-cache.js');
        const { CompressionMetricsCollector } = await import('./compression/metrics.js');
        const { OperationQueueManager } = await import('./operation-queue-manager.js');
        const { AuthStorage, ModelRegistry, SessionManager } = await import('@mariozechner/pi-coding-agent');

        const configManager = new CompressionConfigManager();
        const designSystemCache = new DesignSystemCache(() => 60_000);
        const metricsCollector = new CompressionMetricsCollector('test', 'pending', 1_000_000);
        // Always use real AuthStorage (Pi SDK internals depend on it).
        // BOTTEGA_TEST_MOCK_AUTH=1 → override getApiKey to block real API calls.
        const authStorage = AuthStorage.create();
        if (process.env.BOTTEGA_TEST_MOCK_AUTH) {
          authStorage.getApiKey = async () => undefined;
        }
        const modelRegistry = new ModelRegistry(authStorage);
        const tmpDir = app.getPath('temp');
        const sessionManager = SessionManager.create(tmpDir, path.join(tmpDir, '.bottega-test-sessions'));

        infra = {
          authStorage,
          modelRegistry,
          sessionManager,
          configManager,
          designSystemCache,
          metricsCollector,
          compressionExtensionFactory: () => ({}),
          wsServer: figmaCore.wsServer,
          figmaAPI: figmaCore.figmaAPI,
          queueManager: new OperationQueueManager(),
          getImageGenerator: () => imageGenState.generator,
        } as any;
      } else {
        try {
          infra = await createAgentInfra(figmaCore, {
            getImageGenerator: () => imageGenState.generator,
          });
          log.info('Agent infrastructure created');
        } catch (err: any) {
          log.error(
            { message: err?.message, code: err?.code, name: err?.name, stack: err?.stack, raw: String(err) },
            'Agent infra creation failed',
          );
          // Graceful degradation: create stub infra so the UI can load and the user can configure credentials
          log.warn('Starting with stub infrastructure — agent features will be unavailable');
          infra = {
            authStorage: {
              get: () => null,
              set() {},
              remove() {},
              getApiKey: async () => undefined,
              login: async () => {},
              logout() {},
            },
            modelRegistry: {},
            sessionManager: {},
            configManager: {
              getActiveConfig: () => ({ designSystemCacheTtlMs: 60_000 }),
              getActiveProfile: () => 'balanced',
            },
            designSystemCache: {
              get: () => null,
              set: (r: any) => ({ compact: {}, raw: r }),
              invalidate: () => {},
              isValid: () => false,
            },
            metricsCollector: { record: () => {}, getSummary: () => ({}), finalize: async () => {} },
            compressionExtensionFactory: () => ({}),
            wsServer: figmaCore.wsServer,
            figmaAPI: figmaCore.figmaAPI,
            queueManager: { getQueue: () => ({ execute: <T>(fn: () => Promise<T>) => fn() }), removeQueue: () => {} },
            getImageGenerator: () => imageGenState.generator,
          } as any;
        }
      }
      appState.infra = infra;
      // usageTracker assigned after IPC setup (step 7 below)

      // 4. Create window
      mainWindow = new BrowserWindow({
        width: 480,
        height: 720,
        titleBarStyle: 'hiddenInset',
        vibrancy: 'sidebar',
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

      // 5. Usage tracker (remote diagnostics — opt-in, created before IPC to pass it)
      // Mutable ref for model config — updated by IPC handler after model switch
      const currentModel = { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' };
      const diagConfig = loadDiagnosticsConfig();
      const usageTracker = new UsageTracker(createChildLogger({ component: 'usage' }), diagConfig, {
        getModelConfig: () => currentModel,
        getCompressionProfile: () => infra.configManager.getActiveProfile(),
        getDiagnosticsEnabled: () => diagConfig.sendDiagnostics,
        getImageGenInfo: () => ({
          hasKey: !!imageGenState.generator,
          model: imageGenState.generator?.model || 'unknown',
        }),
      });
      usageTracker.startHeartbeat();
      appState.usageTracker = usageTracker;

      // 6. Setup SlotManager + IPC between agent and renderer
      const sessionStore = new SessionStore();
      const appStatePersistence = new AppStatePersistence();
      const slotManager = new SlotManager(infra, sessionStore, appStatePersistence, figmaCore.wsServer, usageTracker);
      appState.slotManager = slotManager;

      // Restore slots from previous session (tabs + prompt queues)
      try {
        const restoredCount = await slotManager.restoreFromDisk();
        if (restoredCount > 0) {
          log.info({ restoredCount }, 'Slots restored from previous session');
        }
      } catch (err: any) {
        log.warn({ err }, 'Failed to restore slots from disk');
      }

      const ipcController = setupIpcHandlers({
        slotManager,
        mainWindow,
        infra,
        imageGenState,
        sessionStore,
        usageTracker,
      });

      // Subscribe restored slots to IPC events
      for (const slotInfo of slotManager.listSlots()) {
        const slot = slotManager.getSlot(slotInfo.id);
        if (slot) ipcController.subscribeSlot(slot);
      }

      // Sync model config ref when model switches in IPC
      ipcController.onModelChange((config) => {
        currentModel.provider = config.provider;
        currentModel.modelId = config.modelId;
      });

      // 7. Auto-updater (GitHub Releases)
      void initAutoUpdater(mainWindow);

      // 8. Emit app_launch event with full system info + settings snapshot
      const startupMs = Date.now() - appStartTime;
      usageTracker.trackAppLaunch(collectSystemInfo(), startupMs, false);

      // Consolidated renderer event listeners (logging + tracker in one place)
      mainWindow.webContents.on('render-process-gone', (_event, details) => {
        log.fatal({ reason: details.reason, exitCode: details.exitCode }, 'Renderer process crashed');
        usageTracker.trackRendererCrash(details.reason, details.exitCode);
      });
      mainWindow.webContents.on('unresponsive', () => {
        log.warn('Renderer became unresponsive');
        usageTracker.setRendererResponsive(false);
      });
      mainWindow.webContents.on('responsive', () => {
        log.info('Renderer became responsive again');
        usageTracker.setRendererResponsive(true);
      });

      // 9. Forward Figma connection events → auto-create tabs via SlotManager
      const pendingCreations = new Set<string>(); // guard against concurrent createSlot for same fileKey
      figmaCore.wsServer.on('fileConnected', (info: { fileKey: string; fileName: string }) => {
        log.info({ fileName: info.fileName, fileKey: info.fileKey }, 'Figma file connected');
        usageTracker.setFigmaConnected(true);
        usageTracker.trackFigmaConnected(info.fileKey, 0);
        // Emit global figma:connected for status dot in renderer
        if (mainWindow) safeSend(mainWindow.webContents, 'figma:connected', info.fileName);

        // Auto-create tab if not already open for this file
        const existing = slotManager.getSlotByFileKey(info.fileKey);
        if (existing) {
          const slotInfo = slotManager.getSlotInfo(existing.id);
          if (slotInfo && mainWindow) safeSend(mainWindow.webContents, 'tab:updated', slotInfo);
        } else if (!pendingCreations.has(info.fileKey)) {
          pendingCreations.add(info.fileKey);
          slotManager
            .createSlot(info.fileKey, info.fileName)
            .then((slot) => {
              ipcController.subscribeSlot(slot);
              const slotInfo = slotManager.getSlotInfo(slot.id);
              if (slotInfo && mainWindow) safeSend(mainWindow.webContents, 'tab:created', slotInfo);
            })
            .catch((err: any) => {
              log.warn({ err, fileKey: info.fileKey }, 'Auto-tab creation failed');
            })
            .finally(() => pendingCreations.delete(info.fileKey));
        }
      });
      figmaCore.wsServer.on(
        'versionMismatch',
        (info: { fileKey: string; pluginVersion: number; requiredVersion: number }) => {
          log.warn(info, 'Figma plugin version mismatch');
          if (mainWindow) {
            safeSend(mainWindow.webContents, 'figma:version-mismatch', {
              pluginVersion: info.pluginVersion,
              requiredVersion: info.requiredVersion,
            });
          }
        },
      );
      figmaCore.wsServer.on('fileDisconnected', (info: { fileKey: string; fileName: string }) => {
        log.info({ fileKey: info.fileKey }, 'Figma file disconnected');
        // Notify renderer that this specific tab lost connection
        const slot = slotManager.getSlotByFileKey(info.fileKey);
        if (slot && mainWindow) {
          safeSend(mainWindow.webContents, 'tab:updated', slotManager.getSlotInfo(slot.id));
        }
      });
      figmaCore.wsServer.on('disconnected', () => {
        log.info('Figma disconnected');
        usageTracker.setFigmaConnected(false);
        usageTracker.trackFigmaDisconnected();
        if (mainWindow) safeSend(mainWindow.webContents, 'figma:disconnected');
      });

      // 10. Invalidate compression caches on Figma document changes
      figmaCore.wsServer.on('documentChange', (data: any) => {
        if (data.hasStyleChanges || data.hasNodeChanges) {
          infra.designSystemCache.invalidate(data.fileKey);
          log.debug(
            { hasStyleChanges: data.hasStyleChanges, hasNodeChanges: data.hasNodeChanges, fileKey: data.fileKey },
            'Compression cache invalidated via documentChange',
          );
        }
      });
    })
    .catch((err: unknown) => {
      log.fatal({ err }, 'Fatal error during app startup');
      dialog.showErrorBox(MSG_STARTUP_ERROR_TITLE, MSG_STARTUP_ERROR_BODY(err));
      app.quit();
    });
} // end single-instance else

app.on('before-quit', (event) => {
  if (!cleaningUp) {
    event.preventDefault();
    void cleanup(0);
  }
});
app.on('window-all-closed', () => app.quit());
