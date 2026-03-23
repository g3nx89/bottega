import { app, BrowserWindow, crashReporter } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createChildLogger, logFilePath } from '../figma/logger.js';
import { createAgentInfra, createFigmaAgent } from './agent.js';
import { createFigmaCore } from './figma-core.js';
import { effectiveApiKey, loadImageGenSettings } from './image-gen/config.js';
import { ImageGenerator } from './image-gen/image-generator.js';
import { setupIpcHandlers } from './ipc-handlers.js';
import { safeSend } from './safe-send.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger({ component: 'main' });

// ── Crash & error logging ────────────────────

// Native crash dumps (segfault, OOM) → ~/Library/Logs/FigmaCowork/crashes/
crashReporter.start({ uploadToServer: false });

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception');
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});

// ── Graceful shutdown ────────────────────────

let mainWindow: BrowserWindow | null = null;
let figmaCore: Awaited<ReturnType<typeof createFigmaCore>> | null = null;
const appState: { infra: Awaited<ReturnType<typeof createAgentInfra>> | null } = { infra: null };
let cleaningUp = false;

async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  log.info('Shutting down');
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
  log.info({ logFile: logFilePath }, 'App starting');

  const isTestMode = !!process.env.FIGMA_COWORK_TEST_MODE;

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
    };
  } else {
    infra = await createAgentInfra(figmaCore, {
      getImageGenerator: () => imageGenState.generator,
    });
    const result = await createFigmaAgent(infra);
    session = result.session;
    log.info('Figma agent session created');
  }
  appState.infra = infra;

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

  // Log renderer crashes
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.fatal({ reason: details.reason, exitCode: details.exitCode }, 'Renderer process crashed');
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('Renderer became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    log.info('Renderer became responsive again');
  });

  // 5. Setup IPC between agent and renderer
  setupIpcHandlers(session as any, mainWindow, infra, imageGenState);

  // 6. Forward Figma connection events to the UI
  figmaCore.wsServer.on('fileConnected', (info: { fileKey: string; fileName: string }) => {
    log.info({ fileName: info.fileName, fileKey: info.fileKey }, 'Figma file connected');
    if (mainWindow) safeSend(mainWindow.webContents, 'figma:connected', info.fileName);
  });
  figmaCore.wsServer.on('disconnected', () => {
    log.info('Figma disconnected');
    if (mainWindow) safeSend(mainWindow.webContents, 'figma:disconnected');
  });

  // 7. Invalidate compression caches on Figma document changes
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
