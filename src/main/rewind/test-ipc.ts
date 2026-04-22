import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { safeSend } from '../safe-send.js';
import type { RewindManager } from './manager.js';
import type { RewindMetrics } from './metrics.js';

interface RestoreSimulation {
  success: boolean;
  restoredMutations: number;
  skippedMutations: number;
  undoToken?: string;
  error?: string;
}

interface UndoSimulation {
  success: boolean;
  restoredMutations: number;
  skippedMutations: number;
  error?: string;
}

interface SeedCheckpointPayload {
  fileKey: string;
  checkpointId?: string;
  slotId?: string;
  sessionId?: string;
  turnIndex?: number;
  prompt?: string;
  executeTouched?: boolean;
  restorableCount?: number;
  nonRestorableCount?: number;
  timestamp?: number;
}

export interface TestRewindIpcDeps {
  getRewindManager: () => RewindManager | null;
  getMetricsRegistry: () => RewindMetrics | null;
  getMainWindow: () => BrowserWindow | null;
}

export function registerTestRewindIpc(ipcMainLike: Pick<IpcMain, 'handle'>, deps: TestRewindIpcDeps): void {
  ipcMainLike.handle(
    'test:rewind-seed-checkpoint',
    async (_event: IpcMainInvokeEvent, payload: SeedCheckpointPayload) => {
      const manager = deps.getRewindManager();
      const window = deps.getMainWindow();
      if (!manager || !window) return { success: false };
      const checkpointId = payload.checkpointId ?? randomUUID();
      const timestamp = payload.timestamp ?? Date.now();
      await manager.getStore().append(payload.fileKey, {
        id: checkpointId,
        fileKey: payload.fileKey,
        sessionId: payload.sessionId ?? 'test-session',
        slotId: payload.slotId ?? 'test-slot',
        turnIndex: payload.turnIndex ?? 1,
        prompt: payload.prompt ?? 'test rewind checkpoint',
        mutations: [],
        executeTouched: payload.executeTouched ?? false,
        timestamp,
        restorableCount: payload.restorableCount ?? 1,
        nonRestorableCount: payload.nonRestorableCount ?? 0,
      });
      const total = manager.listCheckpoints(payload.fileKey).length;
      safeSend(window.webContents, 'rewind:checkpoint-added', payload.fileKey, { id: checkpointId, total });
      return { success: true, id: checkpointId, total };
    },
  );

  ipcMainLike.handle(
    'test:rewind-simulate-restore',
    async (_event: IpcMainInvokeEvent, fileKey: string, result?: Partial<RestoreSimulation>) => {
      const metrics = deps.getMetricsRegistry();
      const window = deps.getMainWindow();
      if (!metrics || !window) return { success: false, restoredMutations: 0, skippedMutations: 0 };
      const simulated: RestoreSimulation = {
        success: result?.success ?? true,
        restoredMutations: result?.restoredMutations ?? 1,
        skippedMutations: result?.skippedMutations ?? 0,
        undoToken: result?.undoToken ?? randomUUID(),
        error: result?.error,
      };
      metrics.recordRewindRestoreStarted(fileKey);
      if (simulated.success) {
        metrics.recordRewindRestoreCompleted(fileKey, simulated.restoredMutations, simulated.skippedMutations, 1);
        safeSend(window.webContents, 'rewind:restored', fileKey, simulated);
      } else {
        metrics.recordRewindRestoreFailed(fileKey, simulated.error ?? 'test-failure');
      }
      return simulated;
    },
  );

  ipcMainLike.handle(
    'test:rewind-simulate-undo',
    async (_event: IpcMainInvokeEvent, fileKey: string, result?: Partial<UndoSimulation>) => {
      const metrics = deps.getMetricsRegistry();
      if (!metrics) return { success: false, restoredMutations: 0, skippedMutations: 0 };
      const simulated: UndoSimulation = {
        success: result?.success ?? true,
        restoredMutations: result?.restoredMutations ?? 1,
        skippedMutations: result?.skippedMutations ?? 0,
        error: result?.error,
      };
      metrics.recordRewindUndoRestore(fileKey, simulated.success ? 'success' : 'no-token');
      return simulated;
    },
  );

  ipcMainLike.handle('test:rewind-plugin-outdated', (_event: IpcMainInvokeEvent, fileKey?: string | null) => {
    const window = deps.getMainWindow();
    if (!window) return { success: false };
    safeSend(window.webContents, 'rewind:plugin-outdated', { fileKey: fileKey ?? null });
    return { success: true };
  });
}
