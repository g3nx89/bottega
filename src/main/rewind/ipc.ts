import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { createChildLogger } from '../../figma/logger.js';
import type { RewindManager } from './manager.js';
import { validateExternalCheckpointId, validateFileKey, validateScope, validateUndoToken } from './validation.js';

const log = createChildLogger({ component: 'rewind-ipc' });
let rewindIpcRegistered = false;

function invalidArgs(err: unknown): { success: false; error: string } {
  const message = err instanceof Error ? err.message : 'invalid arguments';
  log.warn({ err }, 'rewind: rejected IPC request');
  return { success: false, error: message };
}

export function registerRewindIpc(ipcMainLike: Pick<IpcMain, 'handle'>, manager: RewindManager): void {
  if (rewindIpcRegistered) return;

  ipcMainLike.handle('checkpoint:list', (_event: IpcMainInvokeEvent, fileKey: unknown) => {
    try {
      return manager.listCheckpoints(validateFileKey(fileKey));
    } catch (err) {
      log.warn({ err }, 'rewind: rejected IPC request');
      return [];
    }
  });

  ipcMainLike.handle('checkpoint:preview', (_event: IpcMainInvokeEvent, fileKey: unknown, checkpointId: unknown) => {
    try {
      return manager.previewCheckpoint(validateFileKey(fileKey), validateExternalCheckpointId(checkpointId));
    } catch (err) {
      log.warn({ err }, 'rewind: rejected IPC request');
      return null;
    }
  });

  ipcMainLike.handle(
    'checkpoint:restore',
    async (_event: IpcMainInvokeEvent, fileKey: unknown, checkpointId: unknown, scope: unknown) => {
      try {
        return await manager.restoreCheckpoint(
          validateFileKey(fileKey),
          validateExternalCheckpointId(checkpointId),
          validateScope(scope),
        );
      } catch (err) {
        return { ...invalidArgs(err), restoredMutations: 0, skippedMutations: 0 };
      }
    },
  );

  ipcMainLike.handle(
    'checkpoint:undo-restore',
    async (_event: IpcMainInvokeEvent, fileKey: unknown, undoToken: unknown) => {
      try {
        return await manager.undoRestore(validateFileKey(fileKey), validateUndoToken(undoToken));
      } catch (err) {
        return { ...invalidArgs(err), restoredMutations: 0, skippedMutations: 0 };
      }
    },
  );

  ipcMainLike.handle('checkpoint:clear', async (_event: IpcMainInvokeEvent, fileKey: unknown) => {
    try {
      return await manager.clearCheckpoints(validateFileKey(fileKey));
    } catch (err) {
      return invalidArgs(err);
    }
  });

  rewindIpcRegistered = true;
}
