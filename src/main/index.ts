import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, crashReporter, dialog, ipcMain, safeStorage } from 'electron';
import { createChildLogger, logFilePath, logger, sessionUid } from '../figma/logger.js';
import { DEFAULT_WS_PORT } from '../figma/port-discovery.js';
import { WS_STALL_DETECTION_MS } from '../figma/websocket-server.js';
import { type AgentInfra, buildAuthAdapter, createAgentInfra, DEFAULT_MODEL, OAUTH_PROVIDER_MAP } from './agent.js';
import { AppStatePersistence } from './app-state-persistence.js';
import { readMeta, writeMeta } from './auth-meta.js';
import { readSnapshot, writeSnapshot } from './auth-snapshot.js';
import { decideAutoFallback } from './auto-fallback.js';
import { initAutoUpdater } from './auto-updater.js';
import { isTestMode } from './constants.js';
import { cleanOldLogs, collectSystemInfo } from './diagnostics.js';
import { FigmaAuthStore } from './figma-auth-store.js';
import { createFigmaCore } from './figma-core.js';
import { effectiveApiKey, loadImageGenSettings } from './image-gen/config.js';
import { ImageGenerator } from './image-gen/image-generator.js';
import { setupIpcHandlers, syncFigmaPlugin } from './ipc-handlers.js';
import { revalidateFigmaAuthOnStartup } from './ipc-handlers-figma-auth.js';
import { setupResetHandlers } from './ipc-handlers-reset.js';
import { getLastGood } from './last-known-good.js';
import {
  MSG_PLUGIN_UPDATED,
  MSG_PORT_IN_USE_BODY,
  MSG_PORT_IN_USE_TITLE,
  MSG_STARTUP_ERROR_BODY,
  MSG_STARTUP_ERROR_TITLE,
} from './messages.js';
import { MetricsRegistry } from './metrics-registry.js';
import { ModelProbe } from './model-probe.js';
import { loadDiagnosticsConfig, UsageTracker } from './remote-logger.js';
import { RewindManager } from './rewind/manager.js';
import { registerTestRewindIpc } from './rewind/test-ipc.js';
import { safeSend, safeWc } from './safe-send.js';
import { ScopedConnector } from './scoped-connector.js';
import { SessionStore } from './session-store.js';
import { SlotManager } from './slot-manager.js';
import { runStartupAuth } from './startup-auth.js';
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
/** When true, `before-quit` skips preventDefault so app.quit() proceeds after cleanup. */
let skipQuitPrevention = false;

/** Run fn, swallowing errors (best-effort cleanup step). */
async function safeRun(fn: () => void | Promise<void>, label = 'cleanup step'): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn({ err }, `Error during ${label}`);
  }
}

async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  if (process.env.BOTTEGA_FAST_QUIT) {
    process.exit(exitCode);
  }
  log.info('Shutting down');

  // B-017: Hard deadline for graceful shutdown. After DS-heavy sessions the WS
  // cleanup or metrics flush can hang and the QA runner has to pkill. Force exit
  // after 5s regardless of pending work.
  const forceExitTimer = setTimeout(() => {
    log.warn('Graceful shutdown timed out after 5s — forcing exit');
    process.exit(exitCode);
  }, 5000);
  forceExitTimer.unref?.();

  await safeRun(() => appState.slotManager?.persistStateSync(), 'persisting slot state');
  await safeRun(() => {
    appState.usageTracker?.trackAppQuit(Math.round(process.uptime()), 0);
    appState.usageTracker?.stopHeartbeat();
  }, 'tracking app quit');
  await Promise.all([
    safeRun(() => appState.infra?.metricsCollector.finalize(), 'finalizing metrics'),
    safeRun(() => figmaCore?.stop(), 'stopping Figma (WS cleanup)'),
  ]);
  clearTimeout(forceExitTimer);
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
const gotTheLock = process.env.BOTTEGA_AGENT_TEST ? true : app.requestSingleInstanceLock();
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

      const testMode = isTestMode();

      // 1. Start Figma core (WebSocket server — port 0 in test mode for auto-assign)
      const wsPort = testMode ? 0 : DEFAULT_WS_PORT;
      const figmaAuthStore = new FigmaAuthStore();
      const savedFigmaToken = figmaAuthStore.getToken();
      log.info({ hasFigmaToken: !!savedFigmaToken }, 'Figma REST API auth state loaded');
      figmaCore = await createFigmaCore({ port: wsPort, figmaToken: savedFigmaToken ?? undefined });
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
      const imageGenState: { generator: ImageGenerator | null; settings: typeof imageGenSettings } = {
        generator: apiKey ? new ImageGenerator({ apiKey, model: imageGenSettings.model }) : null,
        settings: imageGenSettings,
      };
      log.info(
        { model: imageGenState.generator?.model ?? imageGenSettings.model, hasKey: !!apiKey },
        'Image generator initialized',
      );

      // 3. Create agent infrastructure (tools are created per-slot, not globally)
      //    In test mode, use stub infra.
      let infra: Awaited<ReturnType<typeof createAgentInfra>>;

      if (testMode) {
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
        const modelRegistry = ModelRegistry.create(authStorage);
        const tmpDir = app.getPath('temp');
        const sessionManager = SessionManager.create(tmpDir, path.join(tmpDir, '.bottega-test-sessions'));

        const queueManager = new OperationQueueManager();
        const metricsRegistry = new MetricsRegistry();
        const activeFigmaCore = figmaCore;
        infra = {
          authStorage,
          modelRegistry,
          sessionManager,
          configManager,
          designSystemCache,
          metricsCollector,
          compressionExtensionFactory: () => ({}),
          taskExtensionFactory: () => ({}),
          workflowExtensionFactory: () => ({}),
          rewindManager: new RewindManager({
            wsServer: figmaCore.wsServer,
            metrics: metricsRegistry,
            getWebContents: () => mainWindow?.webContents ?? null,
            getQueue: (fileKey) => queueManager.getQueue(fileKey),
            getConnector: (fileKey) => new ScopedConnector(activeFigmaCore.wsServer, fileKey),
          }),
          setActiveTaskStore: () => {},
          setWorkflowContext: () => {},
          wsServer: figmaCore.wsServer,
          figmaAPI: figmaCore.figmaAPI,
          queueManager,
          metricsRegistry,
          modelProbe: new ModelProbe(buildAuthAdapter(authStorage)),
          getImageGenerator: () => imageGenState.generator,
        };
      } else {
        try {
          infra = await createAgentInfra(figmaCore, {
            getImageGenerator: () => imageGenState.generator,
            // Today Bottega is single-window; this resolver lives here so
            // future multi-window work has one place to plug in per-slot
            // routing (slotManager.getWindowForSlot(slotId)?.webContents).
            getWebContentsForSlot: () => mainWindow?.webContents ?? null,
          });
          log.info('Agent infrastructure created');
        } catch (err: any) {
          log.error(
            { message: err?.message, code: err?.code, name: err?.name, stack: err?.stack, raw: String(err) },
            'Agent infra creation failed',
          );
          // Graceful degradation: create stub infra so the UI can load and the user can configure credentials
          log.warn('Starting with stub infrastructure — agent features will be unavailable');
          // Graceful degradation: minimal stubs that satisfy AgentInfra so the
          // UI loads. Tools/auth will fail at runtime — that's expected, the
          // user is here to configure credentials. Each stub field is cast
          // individually so adding a new field to AgentInfra still surfaces a
          // type error in the spread, instead of being hidden by `as any`.
          const stubQueueManager = {
            getQueue: () => ({ execute: <T>(fn: () => Promise<T>) => fn() }),
            removeQueue: () => {},
          } as unknown as AgentInfra['queueManager'];
          const stubMetricsRegistry = new MetricsRegistry();
          const stubActiveFigmaCore = figmaCore;
          infra = {
            authStorage: {
              get: () => null,
              set() {},
              remove() {},
              getApiKey: async () => undefined,
              login: async () => {},
              logout() {},
            } as unknown as AgentInfra['authStorage'],
            modelRegistry: {} as unknown as AgentInfra['modelRegistry'],
            sessionManager: {} as unknown as AgentInfra['sessionManager'],
            configManager: {
              getActiveConfig: () => ({ designSystemCacheTtlMs: 60_000 }),
              getActiveProfile: () => 'balanced',
            } as unknown as AgentInfra['configManager'],
            designSystemCache: {
              get: () => null,
              set: (r: any) => ({ compact: {}, raw: r }),
              invalidate: () => {},
              isValid: () => false,
            } as unknown as AgentInfra['designSystemCache'],
            metricsCollector: {
              record: () => {},
              getSummary: () => ({}),
              finalize: async () => {},
            } as unknown as AgentInfra['metricsCollector'],
            compressionExtensionFactory: () => ({}),
            taskExtensionFactory: () => ({}),
            workflowExtensionFactory: () => ({}),
            rewindManager: new RewindManager({
              wsServer: figmaCore.wsServer,
              metrics: stubMetricsRegistry,
              getWebContents: () => mainWindow?.webContents ?? null,
              getQueue: (fileKey) => stubQueueManager.getQueue(fileKey),
              getConnector: (fileKey) => new ScopedConnector(stubActiveFigmaCore.wsServer, fileKey),
            }),
            setActiveTaskStore: () => {},
            setWorkflowContext: () => {},
            wsServer: figmaCore.wsServer,
            figmaAPI: figmaCore.figmaAPI,
            queueManager: stubQueueManager,
            metricsRegistry: stubMetricsRegistry,
            modelProbe: new ModelProbe({ getApiKey: async () => undefined }),
            getImageGenerator: () => imageGenState.generator,
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

      void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

      // 5. Usage tracker (remote diagnostics — opt-in, created before IPC to pass it)
      // Mutable ref for model config — updated by IPC handler after model switch
      const currentModel = { provider: DEFAULT_MODEL.provider, modelId: DEFAULT_MODEL.modelId };
      const diagConfig = loadDiagnosticsConfig();
      const usageTracker = new UsageTracker(createChildLogger({ component: 'usage' }), diagConfig, {
        getModelConfig: () => currentModel,
        getCompressionProfile: () => infra.configManager.getActiveProfile(),
        getDiagnosticsEnabled: () => diagConfig.sendDiagnostics,
        getAuthStatus: () => {
          const status: Record<string, { type: 'oauth' | 'api_key' | 'none' }> = {};
          for (const [displayGroup, oauthId] of Object.entries(OAUTH_PROVIDER_MAP) as [string, string][]) {
            const oauthCred = infra.authStorage.get(oauthId);
            const apiKeyCred = infra.authStorage.get(displayGroup);
            if (oauthCred?.type === 'oauth') {
              status[displayGroup] = { type: 'oauth' };
            } else if (apiKeyCred?.type === 'api_key' || oauthCred?.type === 'api_key') {
              status[displayGroup] = { type: 'api_key' };
            } else {
              status[displayGroup] = { type: 'none' };
            }
          }
          return status;
        },
        getImageGenInfo: () => ({
          hasKey: !!imageGenState.generator,
          model: imageGenState.generator?.model || 'unknown',
        }),
      });
      usageTracker.startHeartbeat();
      appState.usageTracker = usageTracker;
      // F11: now that the tracker exists, wire the ModelProbe telemetry sink
      // so every probe call emits usage:model_probe.
      infra.modelProbe.setTelemetry(usageTracker);

      // 6. Setup SlotManager + IPC between agent and renderer
      const sessionStore = new SessionStore();
      const appStatePersistence = new AppStatePersistence();
      const slotManager = new SlotManager(infra, sessionStore, appStatePersistence, figmaCore.wsServer, usageTracker);
      appState.slotManager = slotManager;

      // Restore slots from previous session (tabs + prompt queues)
      if (!process.env.BOTTEGA_SKIP_RESTORE) {
        try {
          const restoredCount = await slotManager.restoreFromDisk();
          if (restoredCount > 0) {
            log.info({ restoredCount }, 'Slots restored from previous session');
          }
        } catch (err: any) {
          log.warn({ err }, 'Failed to restore slots from disk');
        }
      }

      const ipcController = setupIpcHandlers({
        slotManager,
        mainWindow,
        infra,
        imageGenState,
        sessionStore,
        usageTracker,
        figmaAuthStore,
      });

      setupResetHandlers({
        infra,
        gracefulRelaunch: () => {
          // Schedule relaunch, then quit through the normal cleanup pipeline
          // (WS server stop, port release, single-instance lock freed).
          // app.exit(0) would bypass before-quit → leaked port → relaunched
          // process spins at 100% CPU trying to bind or hitting stale state.
          app.relaunch();
          skipQuitPrevention = true;
          app.quit();
        },
      });

      // Subscribe restored slots to IPC events
      for (const slotInfo of slotManager.listSlots()) {
        const slot = slotManager.getSlot(slotInfo.id);
        if (slot) ipcController.subscribeSlot(slot);
      }

      // F12: pre-warm ModelProbe cache for each active slot's current model.
      // Without this, the pre-send probe gate was dead code — getCached always
      // missed because nothing populated it on startup. Fire-and-forget so slow
      // probes don't block launch.
      for (const slotInfo of slotManager.listSlots()) {
        const slot = slotManager.getSlot(slotInfo.id);
        if (!slot) continue;
        void infra.modelProbe
          .probe(slot.modelConfig.provider, slot.modelConfig.modelId)
          .catch((err) => log.warn({ err, slotId: slot.id }, 'F12 cache warm-up failed'));
      }

      // F17: auto-fallback to last-known-good model per slot. Run async so a
      // slow probe doesn't block startup; banner fires when a switch happens.
      // Probes the target model too — never auto-switches to an equally broken one.
      void (async () => {
        for (const slotInfo of slotManager.listSlots()) {
          const slot = slotManager.getSlot(slotInfo.id);
          if (!slot) continue;
          const { provider, modelId } = slot.modelConfig;
          try {
            const probe = await infra.modelProbe.probe(provider, modelId);
            const decision = decideAutoFallback(modelId, probe.status, getLastGood(provider));
            if (decision.type === 'no_action') continue;
            // Probe the fallback target before committing — if it's also non-ok,
            // skip the switch to avoid false "switched to last-known-good" banner.
            const targetProbe = await infra.modelProbe.probe(provider, decision.to);
            if (targetProbe.status !== 'ok') {
              log.warn(
                { slotId: slot.id, from: decision.from, to: decision.to, targetStatus: targetProbe.status },
                'F17 auto-fallback skipped: target also non-ok',
              );
              continue;
            }
            log.warn(
              { slotId: slot.id, from: decision.from, to: decision.to, status: decision.probeStatus },
              'F17 auto-fallback triggered',
            );
            const previous = { provider, modelId: decision.from };
            await slotManager.recreateSession(slot.id, { provider, modelId: decision.to });
            const updated = slotManager.getSlot(slot.id);
            if (updated) ipcController.subscribeSlot(updated);
            usageTracker.trackModelSwitch(previous, { provider, modelId: decision.to }, 'auto_fallback');
            safeSend(mainWindow.webContents, 'agent:auto-fallback', slot.id, {
              from: decision.from,
              to: decision.to,
              reason: decision.probeStatus,
            });
          } catch (err) {
            log.warn({ err, slotId: slot.id }, 'F17 auto-fallback failed');
          }
        }
      })();

      // ── Background revalidation of the persisted Figma PAT (HIGH 2) ──
      // If the stored token was revoked between sessions, this clears it
      // and flips the UI to "Not connected" before the user's first tool
      // call wastes 3x403 round-trips. Fire-and-forget: the window is
      // already visible, so we don't block startup on a network call.
      if (savedFigmaToken) {
        void revalidateFigmaAuthOnStartup({
          figmaAuthStore,
          figmaAPI: infra.figmaAPI,
          mainWindow,
        }).catch((err) => {
          log.warn({ err }, 'Figma startup revalidation crashed');
        });
      }

      // Sync model config ref when model switches in IPC
      ipcController.onModelChange((config) => {
        currentModel.provider = config.provider;
        currentModel.modelId = config.modelId;
      });

      // ── Auto-sync Figma plugin on startup ──
      // Copies bundled plugin files to userData and auto-registers in Figma if not already done.
      try {
        const pluginSync = await syncFigmaPlugin();
        log.info(
          {
            synced: pluginSync.synced,
            autoRegistered: pluginSync.autoRegistered,
            alreadyRegistered: pluginSync.alreadyRegistered,
            figmaRunning: pluginSync.figmaRunning,
          },
          'Figma plugin startup sync',
        );
        // If plugin not registered and Figma is blocking, notify the renderer once it's ready
        if (
          pluginSync.synced &&
          !pluginSync.autoRegistered &&
          !pluginSync.alreadyRegistered &&
          pluginSync.figmaRunning
        ) {
          const wc = mainWindow.webContents;
          const notify = () => safeSend(wc, 'plugin:needs-setup');
          if (wc.isLoading()) {
            wc.once('did-finish-load', notify);
          } else {
            notify();
          }
        }
      } catch (err: any) {
        log.warn({ err }, 'Figma plugin startup sync failed (non-fatal)');
      }

      // ── Agent test oracle: direct Figma code execution + metrics snapshot ──
      // Two layers of protection:
      //  1. `process.env.BOTTEGA_AGENT_TEST` is replaced at build time by
      //     esbuild's `define` (see scripts/build.mjs). A packaged release
      //     built without the env var has the literal `''` here, so the
      //     condition is dead code that the bundler eliminates.
      //  2. `!app.isPackaged` is a runtime fallback in case someone ships a
      //     dev build by accident — the IPC won't register on a .dmg/.app.
      if (process.env.BOTTEGA_AGENT_TEST && !app.isPackaged) {
        ipcMain.handle(
          'test:figma-execute',
          async (_event: any, code: string, timeoutMs?: number, fileKey?: string) => {
            const timeout = timeoutMs ?? 15_000;
            return figmaCore?.wsServer.sendCommand(
              'EXECUTE_CODE',
              { code, timeout },
              timeout + 2_000,
              fileKey || undefined,
            );
          },
        );

        // Fase 4: test-only MetricsRegistry snapshot. Returns a JSON snapshot
        // of slots, judge counters, tools, turns, ws state, and process memory.
        // Schema is versioned (`schemaVersion: 1`) — see docs/test-metrics-schema.md.
        // Defensive null guard: appState may not be fully populated during
        // a soft-reset window — return null instead of throwing on `infra!`.
        ipcMain.handle('test:get-metrics', () => {
          if (!appState.infra || !appState.slotManager || !figmaCore) return null;
          return appState.infra.metricsRegistry.snapshot({
            slotManager: appState.slotManager,
            wsServer: figmaCore.wsServer,
            getJudgeInProgress: ipcController.getJudgeInProgress,
          });
        });

        ipcMain.handle('test:reset-metrics', () => {
          if (!appState.infra) return { ok: false };
          appState.infra.metricsRegistry.reset();
          return { ok: true };
        });

        registerTestRewindIpc(ipcMain, {
          getRewindManager: () => appState.infra?.rewindManager ?? null,
          getMetricsRegistry: () => appState.infra?.metricsRegistry ?? null,
          getMainWindow: () => mainWindow,
        });
      }

      // 7. Auto-updater (GitHub Releases)
      void initAutoUpdater(mainWindow);

      // 8. F3 + F5 + F6 + F7 + F21: launch-time auth orchestration.
      // Unit-tested in startup-auth.test.ts; index.ts just wires dependencies.
      const appVersion = app.getVersion();
      const window = mainWindow;
      const emitter = {
        emitKeychainUnavailable: (payload: any) => safeSend(window.webContents, 'keychain:unavailable', payload),
        emitPostUpgrade: (payload: any) => safeSend(window.webContents, 'app:post-upgrade', payload),
      };
      await runStartupAuth({
        keychain: {
          safeStorage,
          tracker: usageTracker,
          emitter,
        },
        snapshot: {
          storage: infra.authStorage,
          providerMap: OAUTH_PROVIDER_MAP,
          appVersion,
          readSnapshot: () =>
            readSnapshot(undefined, (reason) =>
              usageTracker.trackAuthSchemaIncompat({ file: 'auth-snapshot', reason }),
            ),
          writeSnapshot,
          tracker: usageTracker,
          emitter,
        },
        refresh: {
          storage: infra.authStorage,
          oauthIds: Object.values(OAUTH_PROVIDER_MAP),
          tracker: usageTracker,
        },
        meta: {
          storage: infra.authStorage,
          providerMap: OAUTH_PROVIDER_MAP,
          appVersion,
          readMeta: () =>
            readMeta(undefined, (reason) => usageTracker.trackAuthSchemaIncompat({ file: 'auth-meta', reason })),
          writeMeta,
          tracker: usageTracker,
        },
      });

      // 9. Emit app_launch event with full system info + settings snapshot
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
        const wc1 = safeWc(mainWindow);
        if (wc1) safeSend(wc1, 'figma:connected', info.fileName);

        // Auto-create tab if not already open for this file
        const existing = slotManager.getSlotByFileKey(info.fileKey);
        if (existing) {
          const slotInfo = slotManager.getSlotInfo(existing.id);
          const wc2 = safeWc(mainWindow);
          if (slotInfo && wc2) safeSend(wc2, 'tab:updated', slotInfo);
        } else if (!pendingCreations.has(info.fileKey)) {
          pendingCreations.add(info.fileKey);
          slotManager
            .createSlot(info.fileKey, info.fileName)
            .then((slot) => {
              ipcController.subscribeSlot(slot);
              const slotInfo = slotManager.getSlotInfo(slot.id);
              const wc3 = safeWc(mainWindow);
              if (slotInfo && wc3) safeSend(wc3, 'tab:created', slotInfo);
              // Warmup: fire a low-res screenshot to prime Figma's rendering pipeline.
              // Fire-and-forget — failure is harmless.
              figmaCore?.wsServer
                .sendCommand('CAPTURE_SCREENSHOT', { nodeId: '', scale: 0.25 }, WS_STALL_DETECTION_MS, info.fileKey)
                .catch((err: any) => log.debug({ err, fileKey: info.fileKey }, 'Screenshot warmup failed'));
              log.debug({ fileKey: info.fileKey }, 'Screenshot warmup triggered');
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
          const wc5 = safeWc(mainWindow);
          if (wc5) {
            safeSend(wc5, 'figma:version-mismatch', {
              pluginVersion: info.pluginVersion,
              requiredVersion: info.requiredVersion,
              message: MSG_PLUGIN_UPDATED(info.pluginVersion, info.requiredVersion),
            });
          }
        },
      );
      figmaCore.wsServer.on('fileDisconnected', (info: { fileKey: string; fileName: string }) => {
        log.info({ fileKey: info.fileKey }, 'Figma file disconnected');
        // Notify renderer that this specific tab lost connection
        const slot = slotManager.getSlotByFileKey(info.fileKey);
        const wc6 = safeWc(mainWindow);
        if (slot && wc6) {
          safeSend(wc6, 'tab:updated', slotManager.getSlotInfo(slot.id));
        }
      });
      const wsServerRef = figmaCore.wsServer;
      figmaCore.wsServer.on('disconnected', () => {
        // wsServer emits 'disconnected' on every individual client drop, not
        // only when the last one leaves. Treat it as global only when no
        // file is still connected — otherwise we'd flip the titlebar dot to
        // red while another tab is still happily attached.
        const stillConnected = slotManager.listSlots().some((s) => s.fileKey && wsServerRef.isFileConnected(s.fileKey));
        const wc4 = safeWc(mainWindow);
        if (!wc4) return;
        if (stillConnected) {
          log.debug('A Figma client disconnected but others remain — keeping titlebar dot green');
          // Resync per-tab dots for any slot that lost its specific client.
          for (const slotInfo of slotManager.listSlots()) {
            safeSend(wc4, 'tab:updated', slotManager.getSlotInfo(slotInfo.id));
          }
          return;
        }
        log.info('Figma disconnected (no remaining clients)');
        usageTracker.setFigmaConnected(false);
        usageTracker.trackFigmaDisconnected();
        safeSend(wc4, 'figma:disconnected');
        for (const slotInfo of slotManager.listSlots()) {
          safeSend(wc4, 'tab:updated', slotManager.getSlotInfo(slotInfo.id));
        }
      });

      // 10. Log operation progress events for observability
      figmaCore.wsServer.on('operationProgress', (data: any) => {
        usageTracker.trackOperationProgress({
          operationId: data.operationId,
          percent: data.percent,
          message: data.message,
          itemsProcessed: data.itemsProcessed,
          totalItems: data.totalItems,
        });
      });

      // 11. Invalidate compression caches on Figma document changes
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
  if (!cleaningUp && !skipQuitPrevention) {
    event.preventDefault();
    void cleanup(0);
  }
});
app.on('window-all-closed', () => app.quit());
