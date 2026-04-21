import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';

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
import { type BottegaTestSession, createBottegaTestSession } from '../../../helpers/bottega-test-session.js';
import { createMockConnector } from '../../../helpers/mock-connector.js';
import { calls, says, when } from '../../../helpers/playbook.js';

function buildHarness(root: string, connector: ReturnType<typeof createMockConnector>) {
  const store = new RewindStore(root);
  const queue = new OperationQueue();
  const manager = new RewindManager({
    store,
    wsServer: { getConnectedFiles: () => [], isFileConnected: () => true, sendCommand: vi.fn() },
    getQueue: () => queue,
    getConnector: () => connector as never,
  });
  manager.onSlotReady('test-slot', 'test-file-key', 'session-1');

  return {
    store,
    manager,
    factory: createRewindExtensionFactory({
      isEnabled: () => manager.isEnabled(),
      getConnector: () => connector as any,
      getFileKey: () => 'test-file-key',
      getSlotId: () => 'test-slot',
      manager,
    }),
  };
}

describe('rewind playbook', () => {
  let session: BottegaTestSession | null = null;
  let connector: ReturnType<typeof createMockConnector>;

  afterEach(() => {
    session?.dispose();
    session = null;
  });

  it('5 set_fills produce one checkpoint with restorableCount=5', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (_nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: [{ type: 'SOLID', color: '#ffffff' }], strokes: [] };
      return { name: 'Layer' };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint five nodes', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#111111' }] }),
        calls('figma_set_fills', { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#222222' }] }),
        calls('figma_set_fills', { nodeId: '1:3', fills: [{ type: 'SOLID', color: '#333333' }] }),
        calls('figma_set_fills', { nodeId: '1:4', fills: [{ type: 'SOLID', color: '#444444' }] }),
        calls('figma_set_fills', { nodeId: '1:5', fills: [{ type: 'SOLID', color: '#555555' }] }),
        says('done'),
      ]),
    );

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary).toMatchObject({ restorableCount: 5, nonRestorableCount: 0 });
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    expect(checkpoint?.mutations).toHaveLength(5);
  });

  it('mix + execute marks the checkpoint as executeTouched', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (_nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: [{ type: 'SOLID', color: '#ffffff' }], strokes: [] };
      return { name: 'Layer' };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint and then execute', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#111111' }] }),
        calls('figma_execute', { code: 'return { success: true }' }),
        says('done'),
      ]),
    );

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary.executeTouched).toBe(true);
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    expect(checkpoint?.executeTouched).toBe(true);
    expect(checkpoint?.nonRestorableCount).toBe(2);
  });

  it('restore chain replays 5 set_fills and undoRestore returns to post-original state', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const nodeState = new Map<string, Array<Record<string, unknown>>>();
    const original = [
      ['1:1', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
      ['1:2', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
      ['1:3', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
      ['1:4', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
      ['1:5', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
    ] as const;
    for (const [nodeId, fills] of original) nodeState.set(nodeId, fills as Array<Record<string, unknown>>);

    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: nodeState.get(nodeId) ?? [], strokes: [] };
      return { name: 'Layer' };
    });
    connector.setNodeFills.mockImplementation(async (nodeId: string, fills: Array<Record<string, unknown>>) => {
      nodeState.set(nodeId, fills);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint five nodes', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#111111' }] }),
        calls('figma_set_fills', { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#222222' }] }),
        calls('figma_set_fills', { nodeId: '1:3', fills: [{ type: 'SOLID', color: '#333333' }] }),
        calls('figma_set_fills', { nodeId: '1:4', fills: [{ type: 'SOLID', color: '#444444' }] }),
        calls('figma_set_fills', { nodeId: '1:5', fills: [{ type: 'SOLID', color: '#555555' }] }),
        says('done'),
      ]),
    );

    const expectedPostOriginal = new Map<string, Array<Record<string, unknown>>>([
      ['1:1', [{ type: 'SOLID', color: '#111111' }]],
      ['1:2', [{ type: 'SOLID', color: '#222222' }]],
      ['1:3', [{ type: 'SOLID', color: '#333333' }]],
      ['1:4', [{ type: 'SOLID', color: '#444444' }]],
      ['1:5', [{ type: 'SOLID', color: '#555555' }]],
    ]);
    for (const [nodeId, fills] of expectedPostOriginal) {
      expect(nodeState.get(nodeId)).toEqual(fills);
    }

    const [summary] = harness.store.listSummaries('test-file-key');
    const restoreResult = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restoreResult.success).toBe(true);
    for (const [nodeId, fills] of original) {
      expect(nodeState.get(nodeId)).toEqual(fills);
    }

    const undoResult = await harness.manager.undoRestore('test-file-key', restoreResult.undoToken!);
    expect(undoResult.success).toBe(true);
    for (const [nodeId, fills] of expectedPostOriginal) {
      expect(nodeState.get(nodeId)).toEqual(fills);
    }
    expect(connector.setNodeFills).toHaveBeenCalledTimes(15);
  });

  it('clone node then restore deletes the created clone id', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (!fields) {
        return {
          id: nodeId,
          type: 'FRAME',
          name: 'Card',
          fills: [],
          strokes: [],
          position: { x: 10, y: 20 },
          size: { width: 100, height: 80 },
          layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          opacity: 1,
          cornerRadius: 0,
          parent: { id: '1:0', layoutMode: 'NONE' },
          children: [],
        };
      }
      return { name: 'Card' };
    });
    connector.cloneNode.mockResolvedValue({ success: true, id: '5:10' });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('duplicate the node', [calls('figma_clone', { nodeId: '1:2' }), says('done')]));

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    expect(checkpoint?.mutations[0]).toMatchObject({
      tool: 'figma_clone',
      kind: 'inverse-op',
      createdNodeIds: ['5:10'],
    });

    const restoreResult = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restoreResult.success).toBe(true);
    expect(connector.deleteNode).toHaveBeenCalledWith('5:10');
  });

  it('figma_move restore reverts node to pre-move position', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const pos = new Map<string, { x: number; y: number }>([['1:1', { x: 10, y: 20 }]]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      const current = pos.get(nodeId) ?? { x: 0, y: 0 };
      if (fields?.includes('position')) {
        return { position: current, parent: { id: '1:0', layoutMode: 'NONE' } };
      }
      if (fields?.includes('parent')) return { parent: { id: '1:0', layoutMode: 'NONE' } };
      return { name: 'Layer' };
    });
    connector.moveNode.mockImplementation(async (nodeId: string, x: number, y: number) => {
      pos.set(nodeId, { x, y });
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('move it', [calls('figma_move', { nodeId: '1:1', x: 100, y: 200 }), says('done')]));
    expect(pos.get('1:1')).toEqual({ x: 100, y: 200 });

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    expect(restore.restoredMutations).toBe(1);
    expect(connector.moveNode).toHaveBeenLastCalledWith('1:1', 10, 20);
    expect(pos.get('1:1')).toEqual({ x: 10, y: 20 });
  });

  it('figma_move inside auto-layout parent skips restore via inverse', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (_nodeId: string, fields?: string[]) => {
      if (fields?.includes('position')) {
        return { position: { x: 0, y: 0 }, parent: { id: '1:0', layoutMode: 'VERTICAL' } };
      }
      return { name: 'Layer' };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('move it', [calls('figma_move', { nodeId: '1:1', x: 5, y: 5 }), says('done')]));

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    // Inverse returns null for auto-layout parent → mutation skipped
    expect(restore.restoredMutations).toBe(0);
    expect(restore.skippedMutations).toBeGreaterThan(0);
    // moveNode called only during the original mutation, never during restore
    expect(connector.moveNode).toHaveBeenCalledTimes(1);
  });

  it('figma_resize restore reverts width/height and re-applies layoutSizing', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const size = new Map<string, { width: number; height: number }>([['1:1', { width: 100, height: 80 }]]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('size')) {
        return {
          size: size.get(nodeId) ?? { width: 0, height: 0 },
          layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
        };
      }
      return { name: 'Layer' };
    });
    connector.resizeNode.mockImplementation(async (nodeId: string, width: number, height: number) => {
      size.set(nodeId, { width, height });
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('resize it', [calls('figma_resize', { nodeId: '1:1', width: 300, height: 400 }), says('done')]),
    );
    expect(size.get('1:1')).toEqual({ width: 300, height: 400 });

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    // Inverse calls resizeNode(nodeId, w, h, true) then setLayoutSizing
    expect(connector.resizeNode).toHaveBeenLastCalledWith('1:1', 100, 80, true);
    expect(connector.setLayoutSizing).toHaveBeenLastCalledWith('1:1', 'FIXED', 'FIXED');
    expect(size.get('1:1')).toEqual({ width: 100, height: 80 });
  });

  it('figma_rename restore reverts name', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const names = new Map<string, string>([['1:1', 'Card']]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('name')) return { name: names.get(nodeId) ?? '' };
      return { name: names.get(nodeId) ?? '' };
    });
    connector.renameNode.mockImplementation(async (nodeId: string, name: string) => {
      names.set(nodeId, name);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('rename it', [calls('figma_rename', { nodeId: '1:1', name: 'Button' }), says('done')]));
    expect(names.get('1:1')).toBe('Button');

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    expect(connector.renameNode).toHaveBeenLastCalledWith('1:1', 'Card');
    expect(names.get('1:1')).toBe('Card');
  });

  it('figma_set_text restore reverts characters and passes captured font options', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const text = new Map<string, { characters: string; fontName: { family: string; style: string }; fontSize: number }>(
      [['1:1', { characters: 'Hello', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14 }]],
    );
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('text')) {
        const current = text.get(nodeId)!;
        return {
          text: {
            characters: current.characters,
            fontName: current.fontName,
            fontSize: current.fontSize,
            fontsToLoad: [current.fontName],
          },
        };
      }
      return {};
    });
    connector.setTextContent.mockImplementation(async (nodeId: string, characters: string) => {
      const current = text.get(nodeId)!;
      text.set(nodeId, { ...current, characters });
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('change text', [calls('figma_set_text', { nodeId: '1:1', text: 'Goodbye' }), says('done')]));
    expect(text.get('1:1')?.characters).toBe('Goodbye');

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    expect(connector.setTextContent).toHaveBeenLastCalledWith(
      '1:1',
      'Hello',
      expect.objectContaining({
        fontFamily: 'Inter',
        fontStyle: 'Regular',
        fontSize: 14,
        fontsToLoad: [{ family: 'Inter', style: 'Regular' }],
      }),
    );
    expect(text.get('1:1')?.characters).toBe('Hello');
  });

  it('figma_delete in a mixed turn is non-restorable but siblings still restore', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const fills = new Map<string, Array<Record<string, unknown>>>([
      ['1:1', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
    ]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: fills.get(nodeId) ?? [], strokes: [] };
      return { name: 'Layer' };
    });
    connector.setNodeFills.mockImplementation(async (nodeId: string, value: Array<Record<string, unknown>>) => {
      fills.set(nodeId, value);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint and delete', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#abcdef' }] }),
        calls('figma_delete', { nodeId: '1:2' }),
        says('done'),
      ]),
    );

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary).toMatchObject({ restorableCount: 1, nonRestorableCount: 1, executeTouched: false });
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    const deleteSnap = checkpoint?.mutations.find((m) => m.tool === 'figma_delete');
    expect(deleteSnap).toMatchObject({ kind: 'non-restorable', skipReason: 'unsupported' });

    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    expect(restore.restoredMutations).toBe(1);
    expect(restore.skippedMutations).toBe(1);
    expect(fills.get('1:1')).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]);
  });

  it('to-checkpoint scope spanning two turns reverses both in reverse order', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const fills = new Map<string, Array<Record<string, unknown>>>([
      ['1:1', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
    ]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: fills.get(nodeId) ?? [], strokes: [] };
      return { name: 'Layer' };
    });
    connector.setNodeFills.mockImplementation(async (nodeId: string, value: Array<Record<string, unknown>>) => {
      fills.set(nodeId, value);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('first paint', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#111111' }] }),
        says('ok'),
      ]),
    );
    await session.run(
      when('second paint', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#222222' }] }),
        says('ok'),
      ]),
    );
    expect(fills.get('1:1')).toEqual([{ type: 'SOLID', color: '#222222' }]);

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(2));
    const summaries = harness.store.listSummaries('test-file-key');
    // listSummaries returns most-recent first; the oldest checkpoint is the target for full rollback.
    const oldest = summaries[summaries.length - 1];
    const restore = await harness.manager.restoreCheckpoint('test-file-key', oldest.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    expect(restore.restoredMutations).toBe(2);
    expect(fills.get('1:1')).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]);
  });

  it('figma_clone checkpoint retains the full subtree pre-state for audit', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const subtree = {
      id: '1:2',
      type: 'FRAME',
      name: 'Card',
      fills: [],
      strokes: [],
      position: { x: 10, y: 20 },
      size: { width: 100, height: 80 },
      layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
      constraints: { horizontal: 'LEFT', vertical: 'TOP' },
      opacity: 1,
      cornerRadius: 0,
      parent: { id: '1:0', layoutMode: 'NONE' },
      children: [{ id: '1:3', type: 'TEXT', name: 'Label', children: [] }],
    };
    connector.getNodeData.mockResolvedValue(subtree);
    connector.cloneNode.mockResolvedValue({ success: true, id: '5:10' });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('clone card', [calls('figma_clone', { nodeId: '1:2' }), says('done')]));

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    const snap = checkpoint!.mutations[0];
    expect(snap.kind).toBe('inverse-op');
    const capturedSubtree = (snap.preState as { subtree: Record<string, unknown> }).subtree;
    expect(capturedSubtree).toMatchObject({
      id: '1:2',
      name: 'Card',
      children: [{ id: '1:3', name: 'Label', type: 'TEXT' }],
    });
  });

  it('figma_delete checkpoint is non-restorable and does not probe the subtree', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockResolvedValue({
      id: '1:9',
      type: 'FRAME',
      name: 'Trashed',
      parent: null,
      children: [],
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(when('delete node', [calls('figma_delete', { nodeId: '1:9' }), says('done')]));

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary).toMatchObject({ restorableCount: 0, nonRestorableCount: 1 });
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id);
    const snap = checkpoint!.mutations[0];
    expect(snap).toMatchObject({
      tool: 'figma_delete',
      kind: 'non-restorable',
      skipReason: 'unsupported',
      preState: {},
    });
    // Subtree is deliberately NOT captured — replaying it would be impossible.
    expect(snap.preState).not.toHaveProperty('subtree');

    // Restore attempt should succeed=false and must not invoke deleteNode a second time.
    const deleteCallsBeforeRestore = connector.deleteNode.mock.calls.length;
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(false);
    expect(restore.restoredMutations).toBe(0);
    expect(restore.skippedMutations).toBe(1);
    expect(connector.deleteNode.mock.calls.length).toBe(deleteCallsBeforeRestore);
  });

  it('mutation kinds are restricted to inverse-op or non-restorable — regression guard', async () => {
    // RestorableKind used to include a 'subtree-snapshot' variant that was declared
    // but neither produced nor consumed by restore.ts. The variant has since been
    // removed; this test prevents a silent reintroduction of dead kinds.
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (_nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: [], strokes: [] };
      return { name: 'Layer' };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint once', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#000000' }] }),
        says('ok'),
      ]),
    );
    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const checkpoint = harness.store.getCheckpoint('test-file-key', summary.id)!;
    const kinds = new Set(checkpoint.mutations.map((m) => m.kind));
    for (const kind of kinds) {
      expect(['inverse-op', 'non-restorable']).toContain(kind);
    }
  });

  it('restore on executeTouched checkpoint returns specific error and emits no undoToken', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockImplementation(async (_nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: [], strokes: [] };
      return { name: 'Layer' };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint then execute', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#000000' }] }),
        calls('figma_execute', { code: 'return { ok: true }' }),
        says('done'),
      ]),
    );

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary.executeTouched).toBe(true);

    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(false);
    expect(restore.error).toMatch(/arbitrary code execution/i);
    expect(restore.restoredMutations).toBe(0);
    expect(restore.undoToken).toBeUndefined();
    // Inverse was never dispatched even though one mutation was restorable in principle.
    expect(connector.setNodeFills).toHaveBeenCalledTimes(1); // only the original mutation
  });

  it('checkpoint with zero restorable mutations returns success=false and no undoToken', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    connector.getNodeData.mockResolvedValue({
      id: '1:1',
      type: 'FRAME',
      name: 'Doomed',
      fills: [],
      strokes: [],
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
      layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
      constraints: { horizontal: 'LEFT', vertical: 'TOP' },
      opacity: 1,
      cornerRadius: 0,
      parent: null,
      children: [],
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('delete two nodes', [
        calls('figma_delete', { nodeId: '1:1' }),
        calls('figma_delete', { nodeId: '1:2' }),
        says('ok'),
      ]),
    );

    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    expect(summary).toMatchObject({ restorableCount: 0, nonRestorableCount: 2, executeTouched: false });

    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(false);
    expect(restore.restoredMutations).toBe(0);
    expect(restore.skippedMutations).toBe(2);
    expect(restore.undoToken).toBeUndefined();
  });

  it('undoRestore success evicts the token so a second undo returns not-found', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const fills = new Map<string, Array<Record<string, unknown>>>([
      ['1:1', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
    ]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: fills.get(nodeId) ?? [], strokes: [] };
      return { name: 'Layer' };
    });
    connector.setNodeFills.mockImplementation(async (nodeId: string, value: Array<Record<string, unknown>>) => {
      fills.set(nodeId, value);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#abcdef' }] }),
        says('ok'),
      ]),
    );
    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    const token = restore.undoToken!;

    const first = await harness.manager.undoRestore('test-file-key', token);
    expect(first.success).toBe(true);

    const second = await harness.manager.undoRestore('test-file-key', token);
    expect(second.success).toBe(false);
    expect(second.error).toBe('Undo token not found.');
  });

  it('undoRestore with foreign fileKey rejects and does not consume the token', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rewind-playbook-'));
    connector = createMockConnector();
    const fills = new Map<string, Array<Record<string, unknown>>>([
      ['1:1', [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]],
    ]);
    connector.getNodeData.mockImplementation(async (nodeId: string, fields?: string[]) => {
      if (fields?.includes('fills')) return { fills: fills.get(nodeId) ?? [], strokes: [] };
      return { name: 'Layer' };
    });
    connector.setNodeFills.mockImplementation(async (nodeId: string, value: Array<Record<string, unknown>>) => {
      fills.set(nodeId, value);
      return { success: true };
    });
    const harness = buildHarness(root, connector);
    session = await createBottegaTestSession({
      toolDeps: { connector },
      extraExtensionFactories: [harness.factory],
    });

    await session.run(
      when('paint once', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#abcdef' }] }),
        says('ok'),
      ]),
    );
    await vi.waitFor(() => expect(harness.store.listSummaries('test-file-key')).toHaveLength(1));
    const [summary] = harness.store.listSummaries('test-file-key');
    const restore = await harness.manager.restoreCheckpoint('test-file-key', summary.id, 'to-checkpoint');
    expect(restore.success).toBe(true);
    const token = restore.undoToken!;

    // Wrong fileKey — token untouched, genuine undo still works.
    const rejected = await harness.manager.undoRestore('other-file-key', token);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe('Undo token not found.');

    const realUndo = await harness.manager.undoRestore('test-file-key', token);
    expect(realUndo.success).toBe(true);
    expect(fills.get('1:1')).toEqual([{ type: 'SOLID', color: '#abcdef' }]);

    // Second undo with the same token — already consumed.
    const second = await harness.manager.undoRestore('test-file-key', token);
    expect(second.success).toBe(false);
    expect(second.error).toBe('Undo token not found.');
  });
});
