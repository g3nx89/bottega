import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { RewindManager } from '../../../../src/main/rewind/manager.js';
import { applyCheckpoint } from '../../../../src/main/rewind/restore.js';
import { RewindStore } from '../../../../src/main/rewind/store.js';
import type { Checkpoint } from '../../../../src/main/rewind/types.js';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

function makeCheckpoint(): Checkpoint {
  return {
    id: 'cp-restore',
    fileKey: 'file-1',
    sessionId: 'session-1',
    slotId: 'slot-1',
    turnIndex: 1,
    prompt: 'restore me',
    executeTouched: false,
    timestamp: Date.now(),
    restorableCount: 3,
    nonRestorableCount: 0,
    mutations: [
      {
        tool: 'figma_rename',
        input: { nodeId: 'n1', name: 'Renamed' },
        nodeIds: ['n1'],
        preState: { name: 'Original' },
        kind: 'inverse-op',
        capturedAt: Date.now(),
      },
      {
        tool: 'figma_move',
        input: { nodeId: 'n2', x: 80, y: 90 },
        nodeIds: ['n2'],
        preState: { x: 5, y: 6, parent: { layoutMode: 'NONE' } },
        kind: 'inverse-op',
        capturedAt: Date.now(),
      },
      {
        tool: 'figma_set_fills',
        input: { nodeId: 'n3', fills: [{ type: 'SOLID', color: '#000000' }] },
        nodeIds: ['n3'],
        preState: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] },
        kind: 'inverse-op',
        capturedAt: Date.now(),
      },
    ],
  };
}

function makeFillCheckpoint(id: string, nodeId: string): Checkpoint {
  return {
    id,
    fileKey: 'file-1',
    sessionId: 'session-1',
    slotId: 'slot-1',
    turnIndex: 1,
    prompt: 'restore me',
    executeTouched: false,
    timestamp: Date.now(),
    restorableCount: 1,
    nonRestorableCount: 0,
    mutations: [
      {
        tool: 'figma_set_fills',
        input: { nodeId, fills: [{ type: 'SOLID', color: '#000000' }] },
        nodeIds: [nodeId],
        preState: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] },
        kind: 'inverse-op',
        capturedAt: Date.now(),
      },
    ],
  };
}

describe('Rewind restore pipeline', () => {
  it('restores mutations in LIFO order and returns an undoToken', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const calls: string[] = [];
    const metrics = {
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

    const connector = {
      getNodeData: vi.fn(async (_nodeId: string, fields?: string[]) => {
        if (fields?.includes('fills')) return { fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] };
        if (fields?.includes('position')) return { position: { x: 80, y: 90 }, parent: { layoutMode: 'NONE' } };
        if (fields?.includes('name')) return { name: 'Renamed' };
        return {};
      }),
      setNodeFills: vi.fn(async () => {
        calls.push('fills');
        return { success: true };
      }),
      moveNode: vi.fn(async () => {
        calls.push('move');
        return { success: true };
      }),
      renameNode: vi.fn(async () => {
        calls.push('rename');
        return { success: true };
      }),
    };

    await store.append('file-1', makeCheckpoint());
    const manager = new RewindManager({
      store,
      metrics,
      wsServer: {
        getConnectedFiles: () => [],
        isFileConnected: () => true,
        sendCommand: vi.fn(),
      },
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-restore', 'to-checkpoint');

    expect(result.success).toBe(true);
    expect(result.undoToken).toEqual(expect.any(String));
    expect(calls).toEqual(['fills', 'move', 'rename']);
  });

  it('undoRestore reapplies the recaptured state back to post-original values', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const metrics = {
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
    let fillState: Array<Record<string, unknown>> = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];

    const connector = {
      getNodeData: vi.fn(async (_nodeId: string, fields?: string[]) => {
        if (fields?.includes('fills')) return { fills: fillState, strokes: [] };
        return {};
      }),
      setNodeFills: vi.fn(async (_nodeId: string, fills: Array<Record<string, unknown>>) => {
        fillState = fills;
        return { success: true };
      }),
      moveNode: vi.fn().mockResolvedValue({ success: true }),
      renameNode: vi.fn().mockResolvedValue({ success: true }),
    };

    await store.append('file-1', {
      ...makeCheckpoint(),
      id: 'cp-fills-only',
      mutations: [
        {
          tool: 'figma_set_fills',
          input: { nodeId: 'n3', fills: [{ type: 'SOLID', color: '#000000' }] },
          nodeIds: ['n3'],
          preState: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] },
          kind: 'inverse-op',
          capturedAt: Date.now(),
        },
      ],
      restorableCount: 1,
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
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const restoreResult = await manager.restoreCheckpoint('file-1', 'cp-fills-only', 'to-checkpoint');
    expect(fillState).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]);

    const undoResult = await manager.undoRestore('file-1', restoreResult.undoToken!);
    expect(undoResult.success).toBe(true);
    expect(fillState).toEqual([{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]);
  });

  it('serializes current-state reads with inverse writes for concurrent restores', async () => {
    const queue = new OperationQueue();
    const events: string[] = [];
    const connector = {
      getNodeData: vi.fn(async (nodeId: string, fields?: string[]) => {
        if (fields?.includes('fills')) {
          events.push(`read-${nodeId}`);
          return { fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] };
        }
        return {};
      }),
      setNodeFills: vi.fn(async (nodeId: string) => {
        events.push(`write-${nodeId}`);
        return { success: true };
      }),
    };
    const registerUndoSnapshots = vi.fn();

    await Promise.all([
      applyCheckpoint(makeFillCheckpoint('cp-1', 'n1'), connector as never, queue, { registerUndoSnapshots }),
      applyCheckpoint(makeFillCheckpoint('cp-2', 'n2'), connector as never, queue, { registerUndoSnapshots }),
    ]);

    expect(events).toEqual(['read-n1', 'write-n1', 'read-n2', 'write-n2']);
  });

  it('continues past a failing inverse and returns undoToken covering successful ops', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const metrics = {
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

    const setCalls: string[] = [];
    const connector = {
      getNodeData: vi.fn(async (_nodeId: string, fields?: string[]) => {
        if (fields?.includes('fills')) return { fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] };
        if (fields?.includes('name')) return { name: 'Renamed' };
        if (fields?.includes('position')) return { position: { x: 80, y: 90 }, parent: { layoutMode: 'NONE' } };
        return {};
      }),
      setNodeFills: vi.fn(async (nodeId: string) => {
        setCalls.push(`fills:${nodeId}`);
        if (nodeId === 'n3') throw new Error('boom');
        return { success: true };
      }),
      moveNode: vi.fn(async () => {
        setCalls.push('move');
        return { success: true };
      }),
      renameNode: vi.fn(async () => {
        setCalls.push('rename');
        return { success: true };
      }),
    };

    await store.append('file-1', makeCheckpoint());
    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-restore', 'to-checkpoint');

    expect(result.success).toBe(true);
    expect(result.restoredMutations).toBe(2);
    expect(result.skippedMutations).toBe(1);
    expect(result.undoToken).toEqual(expect.any(String));
    expect(setCalls).toEqual(['fills:n3', 'move', 'rename']);
  });

  it('executeTouched checkpoint mid-scope yields partialToken covering earlier replayed inverses', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const metrics = {
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

    const setCalls: string[] = [];
    const connector = {
      getNodeData: vi.fn(async (_nodeId: string) => ({
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
        strokes: [],
      })),
      setNodeFills: vi.fn(async (nodeId: string) => {
        setCalls.push(nodeId);
        return { success: true };
      }),
    };

    // Three checkpoints: oldest + middle clean, newest poisoned by execute.
    // Restore is newest-first, so the poisoned one is hit first and aborts the scope
    // before the older inverses are applied.
    const poisoned: Checkpoint = {
      ...makeFillCheckpoint('cp-poisoned', 'n3'),
      executeTouched: true,
    };
    await store.append('file-1', makeFillCheckpoint('cp-oldest', 'n1'));
    await store.append('file-1', makeFillCheckpoint('cp-middle', 'n2'));
    await store.append('file-1', poisoned);

    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-oldest', 'to-checkpoint');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arbitrary code execution/i);
    expect(result.restoredMutations).toBe(0);
    // Aborts on the first (newest) checkpoint, so no inverses ran and no partial token.
    expect(result.undoToken).toBeUndefined();
    expect(setCalls).toEqual([]);
  });

  it('partial-token path: clean newer checkpoint restores, poisoned older one aborts with partial undoToken', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const metrics = {
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

    const setCalls: string[] = [];
    const connector = {
      getNodeData: vi.fn(async () => ({ fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] })),
      setNodeFills: vi.fn(async (nodeId: string) => {
        setCalls.push(nodeId);
        return { success: true };
      }),
    };

    // Oldest is poisoned, newer ones are clean. newest-first ordering replays the clean
    // ones successfully, then hits the poisoned oldest and returns partialToken.
    const poisonedOldest: Checkpoint = {
      ...makeFillCheckpoint('cp-oldest', 'n1'),
      executeTouched: true,
    };
    await store.append('file-1', poisonedOldest);
    await store.append('file-1', makeFillCheckpoint('cp-middle', 'n2'));
    await store.append('file-1', makeFillCheckpoint('cp-newest', 'n3'));

    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-oldest', 'to-checkpoint');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arbitrary code execution/i);
    expect(result.restoredMutations).toBe(2);
    expect(result.undoToken).toEqual(expect.any(String));
    expect(setCalls).toEqual(['n3', 'n2']);

    // The partial token can be used to redo the two applied inverses.
    const undo = await manager.undoRestore('file-1', result.undoToken!);
    expect(undo.success).toBe(true);
    expect(undo.restoredMutations).toBe(2);
  });

  it('applies multi-checkpoint to-checkpoint scope newest-first', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-restore-'));
    const store = new RewindStore(root);
    const queue = new OperationQueue();
    const metrics = {
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

    const applied: string[] = [];
    const connector = {
      getNodeData: vi.fn(async () => ({ fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] })),
      setNodeFills: vi.fn(async (nodeId: string) => {
        applied.push(nodeId);
        return { success: true };
      }),
    };

    await store.append('file-1', makeFillCheckpoint('cp-oldest', 'n1'));
    await store.append('file-1', makeFillCheckpoint('cp-middle', 'n2'));
    await store.append('file-1', makeFillCheckpoint('cp-newest', 'n3'));

    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
      getQueue: () => queue,
      getConnector: () => connector as never,
    });

    const result = await manager.restoreCheckpoint('file-1', 'cp-oldest', 'to-checkpoint');

    expect(result.success).toBe(true);
    expect(result.restoredMutations).toBe(3);
    expect(applied).toEqual(['n3', 'n2', 'n1']);
  });
});
