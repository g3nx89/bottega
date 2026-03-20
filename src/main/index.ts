import { app, BrowserWindow, crashReporter } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFigmaCore } from './figma-core.js';
import { createFigmaAgent } from './agent.js';
import { setupIpcHandlers } from './ipc-handlers.js';
import { createChildLogger, logFilePath } from '../figma/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger({ component: 'main' });

// ── Crash & error logging ────────────────────

// Native crash dumps (segfault, OOM) → ~/Library/Logs/FigmaCompanion/crashes/
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

process.on('SIGINT', () => { app.quit(); });
process.on('SIGTERM', () => { app.quit(); });

// ── App startup ──────────────────────────────

app.whenReady().then(async () => {
  log.info({ logFile: logFilePath }, 'App starting');

  // 1. Start Figma core (WebSocket server on port 9223)
  figmaCore = await createFigmaCore({ port: 9223 });
  await figmaCore.start();
  log.info({ port: 9223 }, 'Figma WebSocket server started');

  // 2. Create agent
  const { session } = await createFigmaAgent(figmaCore);
  log.info('Figma agent session created');

  // 3. Create window
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

  // 4. Setup IPC between agent and renderer
  setupIpcHandlers(session, mainWindow);

  // 5. Forward Figma connection events to the UI
  figmaCore.wsServer.on('fileConnected', (info: { fileKey: string; fileName: string }) => {
    log.info({ fileName: info.fileName, fileKey: info.fileKey }, 'Figma file connected');
    mainWindow?.webContents.send('figma:connected', info.fileName);
  });
  figmaCore.wsServer.on('disconnected', () => {
    log.info('Figma disconnected');
    mainWindow?.webContents.send('figma:disconnected');
  });
});

app.on('before-quit', () => { cleanup(0); });
app.on('window-all-closed', () => app.quit());
