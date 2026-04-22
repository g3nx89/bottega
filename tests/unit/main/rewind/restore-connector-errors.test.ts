import { describe, expect, it, vi } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { applyCheckpoint } from '../../../../src/main/rewind/restore.js';
import type { Checkpoint } from '../../../../src/main/rewind/types.js';
import { createFailingConnector, createTimingOutConnector } from '../../../helpers/mock-connector.js';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

function baseMutation(tool: string, nodeId: string) {
  return {
    tool,
    input: { nodeId, fills: [{ type: 'SOLID', color: '#000000' }] },
    nodeIds: [nodeId],
    preState: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] },
    kind: 'inverse-op' as const,
    capturedAt: Date.now(),
  };
}

function makeCheckpoint(count = 3): Checkpoint {
  const mutations: Checkpoint['mutations'] = [];
  for (let i = 1; i <= count; i += 1) {
    mutations.push(baseMutation('figma_set_fills', `n${i}`));
  }
  return {
    id: 'cp-err',
    fileKey: 'file-1',
    sessionId: 'session-1',
    slotId: 'slot-1',
    turnIndex: 1,
    prompt: 'restore me',
    executeTouched: false,
    timestamp: Date.now(),
    restorableCount: count,
    nonRestorableCount: 0,
    mutations,
  };
}

describe('applyCheckpoint — connector transport errors', () => {
  it('counts every inverse as inverse-failed when connector rejects with a generic error', async () => {
    const connector = createFailingConnector(new Error('transport: socket reset'));
    const queue = new OperationQueue();
    const checkpoint = makeCheckpoint(3);

    const result = await applyCheckpoint(checkpoint, connector as never, queue, {
      registerUndoSnapshots: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.restoredMutations).toBe(0);
    expect(result.skippedMutations).toBe(3);
    expect(result.skipReasons).toEqual({ 'inverse-failed': 3 });
    expect(result.undoToken).toBeUndefined();
  });

  it('maps "not found" connector errors to node-not-found, not inverse-failed', async () => {
    const connector = createFailingConnector(new Error('Node not found for id n2'));
    const queue = new OperationQueue();
    const checkpoint = makeCheckpoint(2);

    const result = await applyCheckpoint(checkpoint, connector as never, queue, {
      registerUndoSnapshots: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.skippedMutations).toBe(2);
    expect(result.skipReasons).toEqual({ 'node-not-found': 2 });
  });

  it('does not register undo snapshots when every inverse fails', async () => {
    const connector = createFailingConnector();
    const queue = new OperationQueue();
    const registerUndoSnapshots = vi.fn();

    const result = await applyCheckpoint(makeCheckpoint(2), connector as never, queue, { registerUndoSnapshots });

    expect(result.undoToken).toBeUndefined();
    expect(registerUndoSnapshots).not.toHaveBeenCalled();
  });

  it('surfaces ws-timeout skipReason when pre-state capture races past PRE_STATE_TIMEOUT_MS', async () => {
    // Timing-out connector: every async call rejects after timeoutMs.
    // PRE_STATE_TIMEOUT_MS defaults to 1500ms; a 2500ms connector timeout
    // guarantees the pre-state race resolves with `ws-timeout` first.
    const connector = createTimingOutConnector(2500);
    const queue = new OperationQueue();
    const checkpoint = makeCheckpoint(1);

    const result = await applyCheckpoint(checkpoint, connector as never, queue, {
      registerUndoSnapshots: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.skippedMutations).toBe(1);
    expect(result.skipReasons).toEqual({ 'ws-timeout': 1 });
  }, 5000);

  it('restores the mutations whose inverse apply succeeds and skips the others with inverse-failed', async () => {
    // getNodeData succeeds (pre-state captured), but the inverse apply path
    // (setNodeFills) rejects for one of the nodes. Shape mirrors the "partial
    // failure mid-inverse" scenario audit row #7 (restore.ts:77).
    const baseConnector = createFailingConnector(new Error('apply failed'));
    baseConnector.getNodeData = vi
      .fn()
      .mockResolvedValue({ fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], strokes: [] });
    // Make setNodeFills succeed for n1 but throw for n2/n3 to produce a mix.
    baseConnector.setNodeFills = vi.fn(async (nodeId: string) => {
      if (nodeId === 'n1') return { success: true };
      throw new Error('apply failed');
    });
    const queue = new OperationQueue();

    const result = await applyCheckpoint(makeCheckpoint(3), baseConnector as never, queue, {
      registerUndoSnapshots: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(result.restoredMutations).toBe(1);
    expect(result.skippedMutations).toBe(2);
    expect(result.skipReasons).toEqual({ 'inverse-failed': 2 });
    expect(result.undoToken).toEqual(expect.any(String));
  });
});
