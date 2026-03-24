import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, crashReporter } from 'electron';
import { createChildLogger, logFilePath, logger, sessionUid } from '../figma/logger.js';
import { createAgentInfra, createFigmaAgent } from './agent.js';
import { initAutoUpdater } from './auto-updater.js';
import { cleanOldLogs, collectSystemInfo } from './diagnostics.js';
import { createFigmaCore } from './figma-core.js';
import { effectiveApiKey, loadImageGenSettings } from './image-gen/config.js';
import { ImageGenerator } from './image-gen/image-generator.js';
import { setupIpcHandlers } from './ipc-handlers.js';
import { loadDiagnosticsConfig, UsageTracker } from './remote-logger.js';
import { safeSend } from './safe-send.js';
import { SessionStore } from './session-store.js';

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
      if (versions.length > 0) candidates.push(path.join(nvmDir, versions[versions.length - 1], 'bin'));
    } catch {}
  }

  // fnm
  const fnmDir = path.join(home, '.local/share/fnm/node-versions');
  if (existsSync(fnmDir)) {
    try {
      const versions = readdirSync(fnmDir)
        .filter((d) => d.startsWith('v'))
        .sort();
      if (versions.length > 0) candidates.push(path.join(fnmDir, versions[versions.length - 1], 'installation/bin'));
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
} = { infra: null, usageTracker: null };
let cleaningUp = false;

async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  log.info('Shutting down');
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

// ── App startup ──────────────────────────────

app.whenReady().then(async () => {
  const appStartTime = Date.now();
  log.info({ logFile: logFilePath, sessionUid }, 'App starting');

  // Clean up log files older than 30 days (async, fire-and-forget — don't block startup)
  cleanOldLogs().catch(() => {});

  const isTestMode = !!process.env.BOTTEGA_TEST_MODE;

  // 1. Start Figma core (WebSocket server — port 0 in test mode for auto-assign)
  const wsPort = isTestMode ? 0 : 9223;
  figmaCore = await createFigmaCore({ port: wsPort });
  await figmaCore.start();
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

  // 3. Create agent infrastructure and session
  //    In test mode, skip real agent session creation (Pi SDK may hang without credentials).
  let infra: Awaited<ReturnType<typeof createAgentInfra>>;
  let session: any;

  if (isTestMode) {
    log.info('Test mode: using stub agent session');
    const { CompressionConfigManager } = await import('./compression/compression-config.js');
    const { DesignSystemCache } = await import('./compression/design-system-cache.js');
    const { CompressionMetricsCollector } = await import('./compression/metrics.js');

    const configManager = new CompressionConfigManager();
    const designSystemCache = new DesignSystemCache(() => 60_000);
    const metricsCollector = new CompressionMetricsCollector('test', 'pending', 1_000_000);

    infra = {
      authStorage: {
        getApiKey: async () => 'test',
        get: () => null,
        set() {},
        remove() {},
        login: async () => {},
        logout() {},
      },
      modelRegistry: {},
      sessionManager: {},
      figmaTools: [],
      configManager,
      designSystemCache,
      metricsCollector,
      compressionExtensionFactory: () => ({}),
    } as any;

    session = {
      prompt: async () => {},
      abort: async () => {},
      subscribe: () => {},
      newSession: async () => true,
      switchSession: async () => true,
      sessionFile: undefined,
      messages: [],
    };
  } else {
    try {
      infra = await createAgentInfra(figmaCore, {
        getImageGenerator: () => imageGenState.generator,
      });
      const result = await createFigmaAgent(infra);
      session = result.session;
      log.info('Figma agent session created');
    } catch (err: any) {
      log.error(
        { message: err?.message, code: err?.code, name: err?.name, stack: err?.stack, raw: String(err) },
        'Agent session creation failed — starting without agent',
      );
      infra = infra!;
      session = {
        prompt: async () => {},
        abort: async () => {},
        subscribe: () => {},
        newSession: async () => true,
        switchSession: async () => true,
        sessionFile: undefined,
        messages: [],
      };
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

  // 6. Setup IPC between agent and renderer (with session persistence + usage tracker)
  const sessionStore = new SessionStore();
  const ipcController = setupIpcHandlers({
    initialSession: session as any,
    mainWindow,
    infra,
    imageGenState,
    sessionStore,
    usageTracker,
  });

  // Sync model config ref when model switches in IPC
  ipcController.onModelChange((config) => {
    currentModel.provider = config.provider;
    currentModel.modelId = config.modelId;
  });

  // 7. Auto-updater (GitHub Releases)
  initAutoUpdater(mainWindow);

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

  // 9. Forward Figma connection events to the UI + restore session
  figmaCore.wsServer.on('fileConnected', (info: { fileKey: string; fileName: string }) => {
    log.info({ fileName: info.fileName, fileKey: info.fileKey }, 'Figma file connected');
    usageTracker.setFigmaConnected(true);
    usageTracker.trackFigmaConnected(info.fileKey, 0);
    if (mainWindow) safeSend(mainWindow.webContents, 'figma:connected', info.fileName);
    // Restore or create session for this file
    ipcController.switchToFile(info.fileKey, info.fileName).catch((err) => {
      log.warn({ err, fileKey: info.fileKey }, 'Session switch on file connect failed');
    });
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
      infra.designSystemCache.invalidate();
      log.debug(
        { hasStyleChanges: data.hasStyleChanges, hasNodeChanges: data.hasNodeChanges },
        'Compression cache invalidated via documentChange',
      );
    }
  });
});

app.on('before-quit', (event) => {
  if (!cleaningUp) {
    event.preventDefault();
    cleanup(0);
  }
});
app.on('window-all-closed', () => app.quit());
