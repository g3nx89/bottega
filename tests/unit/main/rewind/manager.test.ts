import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logInfo, safeSendSpy } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  safeSendSpy: vi.fn(),
}));

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: logInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('../../../../src/main/safe-send.js', () => ({
  safeSend: safeSendSpy,
}));

import { RewindManager } from '../../../../src/main/rewind/manager.js';
import { RewindStore } from '../../../../src/main/rewind/store.js';

function makeMetrics() {
  return {
    recordRewindCaptured: vi.fn(),
    recordRewindSkipped: vi.fn(),
    recordRewindCheckpointCreated: vi.fn(),
    recordRewindPruned: vi.fn(),
    recordRewindPluginProbeFailed: vi.fn(),
    recordRewindProbeDeferred: vi.fn(),
    recordRewindRestoreStarted: vi.fn(),
    recordRewindRestoreCompleted: vi.fn(),
    recordRewindRestoreFailed: vi.fn(),
    recordRewindUndoRestore: vi.fn(),
  };
}

function makeWebContents() {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

describe('RewindManager', () => {
  beforeEach(() => {
    logInfo.mockReset();
    safeSendSpy.mockReset();
  });

  it('resetProbeCache(fileKey) allows probing the same file again', async () => {
    const connector = { getNodeData: vi.fn().mockResolvedValue({ name: 'Page' }) };
    const manager = new RewindManager({
      wsServer: {
        getConnectedFiles: () => [
          {
            fileKey: 'file-1',
            currentPageId: '0:1',
            fileName: 'Demo',
            pluginVersion: 2,
            connectedAt: Date.now(),
            isActive: true,
          },
        ],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
    });

    await manager.onSessionStart('slot-1', 'file-1', connector as never);
    await manager.onSessionStart('slot-1', 'file-1', connector as never);
    expect(connector.getNodeData).toHaveBeenCalledTimes(1);

    manager.resetProbeCache('file-1');
    await manager.onSessionStart('slot-1', 'file-1', connector as never);
    expect(connector.getNodeData).toHaveBeenCalledTimes(2);
  });

  it('defers probe when no connected file is available and records the dedicated metric', async () => {
    const metrics = makeMetrics();
    const connector = { getNodeData: vi.fn() };
    const manager = new RewindManager({
      metrics,
      wsServer: {
        getConnectedFiles: () => [],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
    });

    await manager.onSessionStart('slot-1', 'file-1', connector as never);

    expect(connector.getNodeData).not.toHaveBeenCalled();
    expect(metrics.recordRewindProbeDeferred).toHaveBeenCalledTimes(1);
    expect(metrics.recordRewindPluginProbeFailed).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      { slotId: 'slot-1', fileKey: 'file-1' },
      'rewind: probe deferred, no connected file for fileKey',
    );
  });

  it('fails last-turn restore when checkpointId does not match the most recent checkpoint', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-manager-'));
    const store = new RewindStore(root);
    const metrics = makeMetrics();
    await store.append('file-1', {
      id: 'cp-latest',
      fileKey: 'file-1',
      sessionId: 'session-1',
      slotId: 'slot-1',
      turnIndex: 2,
      prompt: 'latest',
      mutations: [],
      executeTouched: false,
      timestamp: Date.now(),
      restorableCount: 0,
      nonRestorableCount: 0,
    });

    const manager = new RewindManager({
      store,
      metrics,
      wsServer: {
        getConnectedFiles: () => [],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-non-match', 'last-turn');

    expect(result).toEqual({
      success: false,
      restoredMutations: 0,
      skippedMutations: 0,
      error: 'Checkpoint not found.',
    });
    expect(metrics.recordRewindRestoreFailed).toHaveBeenCalledWith('file-1', 'checkpoint-not-found');
  });

  it('emits rewind:checkpoint-added after persisting a checkpoint on agent end', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-manager-'));
    const metrics = makeMetrics();
    const webContents = makeWebContents();
    const manager = new RewindManager({
      store: new RewindStore(root),
      metrics,
      getWebContents: () => webContents as never,
      wsServer: {
        getConnectedFiles: () => [],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
    });
    const connector = {
      getNodeData: vi.fn().mockResolvedValue({ name: 'Original' }),
    };

    manager.onSlotReady('slot-1', 'file-1', 'session-1');
    manager.onTurnBegin('slot-1', 'file-1', 'rename node', 1, 'prompt-1');
    manager.onToolCall('slot-1', 'call-1', 'figma_rename', { nodeId: '1:2', name: 'Renamed' }, connector as never);
    manager.onToolResult('slot-1', 'call-1', {});
    await manager.onAgentEnd('slot-1');

    expect(safeSendSpy).toHaveBeenCalledWith(
      webContents,
      'rewind:checkpoint-added',
      'file-1',
      expect.objectContaining({ total: 1 }),
    );
    expect(metrics.recordRewindCheckpointCreated).toHaveBeenCalledWith(false);
  });

  it('emits rewind:restored after a successful restore', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-manager-'));
    const store = new RewindStore(root);
    const metrics = makeMetrics();
    const webContents = makeWebContents();
    const connector = {
      renameNode: vi.fn().mockResolvedValue(undefined),
      getNodeData: vi.fn().mockResolvedValue({ name: 'Current' }),
    };
    const manager = new RewindManager({
      store,
      metrics,
      getWebContents: () => webContents as never,
      getConnector: () => connector as never,
      getQueue: () => ({ execute: async <T>(fn: () => Promise<T>) => fn() }),
      wsServer: {
        getConnectedFiles: () => [],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
    });

    await store.append('file-1', {
      id: 'cp-1',
      fileKey: 'file-1',
      sessionId: 'session-1',
      slotId: 'slot-1',
      turnIndex: 1,
      prompt: 'rename node',
      mutations: [
        {
          tool: 'figma_rename',
          input: { nodeId: '1:2', name: 'Renamed' },
          nodeIds: ['1:2'],
          preState: { name: 'Original' },
          kind: 'inverse-op',
          capturedAt: Date.now(),
        },
      ],
      executeTouched: false,
      timestamp: Date.now(),
      restorableCount: 1,
      nonRestorableCount: 0,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-1', 'last-turn');

    expect(result.success).toBe(true);
    expect(connector.renameNode).toHaveBeenCalledWith('1:2', 'Original');
    expect(safeSendSpy).toHaveBeenCalledWith(
      webContents,
      'rewind:restored',
      'file-1',
      expect.objectContaining({ success: true, restoredMutations: 1 }),
    );
  });

  it('returns expired error after the undo TTL window passes', async () => {
    vi.useFakeTimers();
    try {
      const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-manager-'));
      const store = new RewindStore(root);
      const metrics = makeMetrics();
      const connector = {
        renameNode: vi.fn().mockResolvedValue(undefined),
        getNodeData: vi.fn().mockResolvedValue({ name: 'Current' }),
      };
      const manager = new RewindManager({
        store,
        metrics,
        getWebContents: () => null,
        getConnector: () => connector as never,
        getQueue: () => ({ execute: async <T>(fn: () => Promise<T>) => fn() }) as never,
        wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
      });

      await store.append('file-1', {
        id: 'cp-ttl',
        fileKey: 'file-1',
        sessionId: 's',
        slotId: 'slot',
        turnIndex: 1,
        prompt: 'p',
        mutations: [
          {
            tool: 'figma_rename',
            input: { nodeId: '1:2', name: 'Renamed' },
            nodeIds: ['1:2'],
            preState: { name: 'Original' },
            kind: 'inverse-op',
            capturedAt: Date.now(),
          },
        ],
        executeTouched: false,
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
      });

      const restore = await manager.restoreCheckpoint('file-1', 'cp-ttl', 'last-turn');
      expect(restore.undoToken).toBeDefined();

      vi.setSystemTime(Date.now() + 300_001);

      const undo = await manager.undoRestore('file-1', restore.undoToken!);
      expect(undo.success).toBe(false);
      expect(undo.error).toBe('Undo token expired.');
      expect(metrics.recordRewindUndoRestore).toHaveBeenCalledWith('file-1', 'expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
