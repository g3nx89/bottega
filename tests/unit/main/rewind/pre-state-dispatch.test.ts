import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePreState } from '../../../../src/main/rewind/pre-state/index.js';

describe('capturePreState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches the correct fields and shape for supported tools', async () => {
    const connector = {
      getNodeData: vi
        .fn()
        .mockResolvedValueOnce({ fills: [{ type: 'SOLID', color: '#fff' }], strokes: [] })
        .mockResolvedValueOnce({ text: { characters: 'Hello', fontsToLoad: [] } })
        .mockResolvedValueOnce({ position: { x: 10, y: 20 }, parent: { id: '1:0', layoutMode: 'NONE' } })
        .mockResolvedValueOnce({
          size: { width: 100, height: 80 },
          layoutSizing: { horizontal: 'FIXED', vertical: 'HUG' },
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
        })
        .mockResolvedValueOnce({ name: 'Layer/Name' }),
    };

    expect(await capturePreState('figma_set_fills', { nodeId: '1:2' }, connector as any)).toEqual({
      kind: 'inverse-op',
      preState: { fills: [{ type: 'SOLID', color: '#fff' }], strokes: [] },
    });
    expect(await capturePreState('figma_set_text', { nodeId: '1:2' }, connector as any)).toEqual({
      kind: 'inverse-op',
      preState: { text: { characters: 'Hello', fontName: undefined, fontSize: null, fontsToLoad: [] } },
    });
    expect(await capturePreState('figma_move', { nodeId: '1:2' }, connector as any)).toEqual({
      kind: 'inverse-op',
      preState: { x: 10, y: 20, parent: { id: '1:0', layoutMode: 'NONE' } },
    });
    expect(await capturePreState('figma_resize', { nodeId: '1:2' }, connector as any)).toEqual({
      kind: 'inverse-op',
      preState: {
        width: 100,
        height: 80,
        layoutSizing: { horizontal: 'FIXED', vertical: 'HUG' },
        constraints: { horizontal: 'LEFT', vertical: 'TOP' },
      },
    });
    expect(await capturePreState('figma_rename', { nodeId: '1:2' }, connector as any)).toEqual({
      kind: 'inverse-op',
      preState: { name: 'Layer/Name' },
    });

    expect(connector.getNodeData.mock.calls).toEqual([
      ['1:2', ['fills', 'strokes']],
      ['1:2', ['text']],
      ['1:2', ['position', 'parent']],
      ['1:2', ['size', 'layoutSizing', 'constraints']],
      ['1:2', ['name']],
    ]);
  });

  it('captures clone as inverse-op with subtree preState; delete skips the probe entirely', async () => {
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
      children: [{ id: '1:3', type: 'TEXT', name: 'Label' }],
    };
    const connector = { getNodeData: vi.fn().mockResolvedValue(subtree) };

    await expect(capturePreState('figma_clone', { nodeId: '1:2' }, connector as any)).resolves.toMatchObject({
      kind: 'inverse-op',
      preState: { subtree: { id: '1:2', name: 'Card', children: [{ id: '1:3', name: 'Label', type: 'TEXT' }] } },
    });
    // figma_delete is non-restorable, so we don't waste a WS round-trip or
    // storage on a subtree snapshot that restore.ts would never replay.
    await expect(capturePreState('figma_delete', { nodeId: '1:2' }, connector as any)).resolves.toEqual({
      kind: 'non-restorable',
      preState: {},
      skipReason: 'unsupported',
    });

    // Only the clone call hit the connector.
    expect(connector.getNodeData.mock.calls).toEqual([['1:2']]);
  });

  it('returns ws-timeout when the pre-state probe does not resolve in time', async () => {
    vi.useFakeTimers();
    const connector = { getNodeData: vi.fn(() => new Promise(() => undefined)) };
    const pending = capturePreState('figma_move', { nodeId: '1:2' }, connector as any, 25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({
      kind: 'inverse-op',
      preState: {},
      skipReason: 'ws-timeout',
    });
  });

  it('marks execute and unknown tools as skipped/non-restorable', async () => {
    const connector = { getNodeData: vi.fn() };
    await expect(capturePreState('figma_execute', { code: 'return 1' }, connector as any)).resolves.toEqual({
      kind: 'non-restorable',
      preState: {},
      skipReason: 'execute',
    });
    await expect(capturePreState('figma_unknown', { nodeId: '1:2' }, connector as any)).resolves.toEqual({
      kind: 'non-restorable',
      preState: {},
      skipReason: 'unsupported',
    });
  });
});
