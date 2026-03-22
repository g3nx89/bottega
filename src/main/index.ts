import { app, BrowserWindow, crashReporter } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createChildLogger, logFilePath } from '../figma/logger.js';
import { createAgentInfra, createFigmaAgent } from './agent.js';
import { createFigmaCore } from './figma-core.js';
import { effectiveApiKey, loadImageGenSettings } from './image-gen/config.js';
import { ImageGenerator } from './image-gen/image-generator.js';
import { setupIpcHandlers } from './ipc-handlers.js';

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
let cleaningUp = false;

async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  log.info('Shutting down');
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

  // 1. Start Figma core (WebSocket server on port 9223)
  figmaCore = await createFigmaCore({ port: 9223 });
  await figmaCore.start();
  log.info({ port: 9223 }, 'Figma WebSocket server started');

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

  // 3. Create agent infrastructure (shared across session recreations)
  const infra = await createAgentInfra(figmaCore, {
    getImageGenerator: () => imageGenState.generator,
  });
  const { session } = await createFigmaAgent(infra);
  log.info('Figma agent session created');

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
    mainWindow?.webContents.send('figma:connected', info.fileName);
  });
  figmaCore.wsServer.on('disconnected', () => {
    log.info('Figma disconnected');
    mainWindow?.webContents.send('figma:disconnected');
  });
});

app.on('before-quit', () => {
  cleanup(0);
});
app.on('window-all-closed', () => app.quit());
