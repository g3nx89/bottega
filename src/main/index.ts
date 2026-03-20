import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFigmaCore } from './figma-core.js';
import { createFigmaAgent } from './agent.js';
import { setupIpcHandlers } from './ipc-handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  // 1. Start Figma core (WebSocket server on port 9223)
  const figmaCore = await createFigmaCore({ port: 9223 });
  await figmaCore.start();
  console.log('Figma WebSocket server started on port 9223');

  // 2. Create agent
  const { session } = await createFigmaAgent(figmaCore);
  console.log('Figma agent session created');

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

  // 4. Setup IPC between agent and renderer
  setupIpcHandlers(session, mainWindow);

  // 5. Forward Figma connection events to the UI
  figmaCore.wsServer.on('fileConnected', (info: { fileKey: string; fileName: string }) => {
    console.log('Figma file connected:', info.fileName, info.fileKey);
    mainWindow?.webContents.send('figma:connected', info.fileName);
  });
  figmaCore.wsServer.on('disconnected', () => {
    console.log('Figma disconnected');
    mainWindow?.webContents.send('figma:disconnected');
  });

  // 6. Cleanup on shutdown
  const cleanup = async () => {
    await figmaCore.stop();
  };
  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
});

app.on('window-all-closed', () => app.quit());
