import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { createRewindExtensionFactory } from '../../../../src/main/rewind/extension-factory.js';
import { RewindManager } from '../../../../src/main/rewind/manager.js';
import { RewindStore } from '../../../../src/main/rewind/store.js';

type Handler = (event: unknown) => Promise<unknown> | unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  return {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    fire: (event: string, payload?: unknown) => handlers.get(event)?.(payload),
  };
}

describe('createRewindExtensionFactory', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'rewind-extension-'));
  });

  it('records a checkpoint without blocking the tool flow', async () => {
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
    const store = new RewindStore(root, 20, metrics);
    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
    });
    manager.onSlotReady('slot-1', 'file-1', 'session-1');
    manager.onTurnBegin('slot-1', 'file-1', 'paint node', 1, 'prompt-1');

    const connector = {
      getNodeData: vi.fn().mockResolvedValue({ fills: [{ type: 'SOLID', color: '#ffffff' }], strokes: [] }),
    };

    const pi = fakePi();
    createRewindExtensionFactory({
      isEnabled: () => manager.isEnabled(),
      getConnector: () => connector as any,
      getFileKey: () => 'file-1',
      getSlotId: () => 'slot-1',
      manager,
    })(pi);

    await pi.fire('agent_start');
    const toolCallResult = pi.fire('tool_call', {
      toolName: 'figma_set_fills',
      toolCallId: 'tc-1',
      input: { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#000000' }] },
    });
    await Promise.resolve();
    await pi.fire('tool_result', {
      toolCallId: 'tc-1',
      result: { content: [{ type: 'text', text: '{"id":"1:2"}' }] },
    });
    await pi.fire('agent_end');

    expect(toolCallResult).toBeUndefined();
    const [summary] = store.listSummaries('file-1');
    expect(summary).toMatchObject({ turnIndex: 1, restorableCount: 1 });
    expect(metrics.recordRewindCaptured).toHaveBeenCalledTimes(1);
  });

  it('fails safe when the manager handler throws', async () => {
    const manager = {
      isEnabled: () => true,
      onSessionStart: vi.fn(),
      onAgentStart: vi.fn(),
      onToolCall: vi.fn(() => {
        throw new Error('boom');
      }),
      onToolResult: vi.fn(),
      onAgentEnd: vi.fn(),
    };

    const pi = fakePi();
    createRewindExtensionFactory({
      isEnabled: () => true,
      getConnector: () => ({ getNodeData: vi.fn() }) as any,
      getFileKey: () => 'file-1',
      getSlotId: () => 'slot-1',
      manager: manager as any,
    })(pi);

    await expect(
      Promise.resolve(
        pi.fire('tool_call', {
          toolName: 'figma_set_fills',
          toolCallId: 'tc-1',
          input: { nodeId: '1:2' },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('waits for async pre-state capture before persisting the checkpoint', async () => {
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
    const store = new RewindStore(root, 20, metrics);
    const manager = new RewindManager({
      store,
      metrics,
      wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
    });
    manager.onSlotReady('slot-1', 'file-1', 'session-1');
    manager.onTurnBegin('slot-1', 'file-1', 'paint node', 1, 'prompt-1');

    const connector = {
      getNodeData: vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ fills: [{ type: 'SOLID', color: '#ffffff' }], strokes: [] }), 30);
          }),
      ),
    };

    const pi = fakePi();
    createRewindExtensionFactory({
      isEnabled: () => manager.isEnabled(),
      getConnector: () => connector as any,
      getFileKey: () => 'file-1',
      getSlotId: () => 'slot-1',
      manager,
    })(pi);

    await pi.fire('agent_start');
    await pi.fire('tool_call', {
      toolName: 'figma_set_fills',
      toolCallId: 'tc-async',
      input: { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#000000' }] },
    });
    await pi.fire('tool_result', {
      toolCallId: 'tc-async',
      result: { content: [{ type: 'text', text: '{"id":"1:2"}' }] },
    });
    await pi.fire('agent_end');

    const [summary] = store.listSummaries('file-1');
    expect(summary).toMatchObject({ restorableCount: 1, nonRestorableCount: 0 });
    const checkpoint = store.getCheckpoint('file-1', summary.id);
    expect(checkpoint?.mutations).toHaveLength(1);
    expect(checkpoint?.mutations[0]?.skipReason).toBeUndefined();
  });

  it('disables rewind after a failed capability probe and persists zero checkpoints', async () => {
    const store = new RewindStore(root);
    const manager = new RewindManager({
      store,
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
      },
    });
    manager.onSlotReady('slot-1', 'file-1', 'session-1');

    const connector = {
      getNodeData: vi.fn().mockRejectedValue(new Error('unknown message type GET_NODE_DATA')),
    };

    const pi = fakePi();
    createRewindExtensionFactory({
      isEnabled: () => manager.isEnabled(),
      getConnector: () => connector as any,
      getFileKey: () => 'file-1',
      getSlotId: () => 'slot-1',
      manager,
    })(pi);

    await pi.fire('session_start');
    manager.onTurnBegin('slot-1', 'file-1', 'paint node', 1, 'prompt-1');
    await pi.fire('agent_start');
    await pi.fire('tool_call', {
      toolName: 'figma_set_fills',
      toolCallId: 'tc-1',
      input: { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#000' }] },
    });
    await pi.fire('tool_result', { toolCallId: 'tc-1', result: { content: [{ type: 'text', text: 'ok' }] } });
    await pi.fire('agent_end');

    expect(manager.isEnabled()).toBe(false);
    expect(store.listSummaries('file-1')).toEqual([]);
  });
});
