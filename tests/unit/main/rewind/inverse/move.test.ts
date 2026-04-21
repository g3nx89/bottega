import { describe, expect, it, vi } from 'vitest';
import { buildMoveInverse } from '../../../../../src/main/rewind/inverse/move.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(layoutMode = 'NONE'): MutationSnapshot {
  return {
    tool: 'figma_move',
    input: { nodeId: '2:1', x: 100, y: 200 },
    nodeIds: ['2:1'],
    preState: {
      x: 10,
      y: 20,
      parent: { id: '0:1', layoutMode },
    },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildMoveInverse', () => {
  it('roundtrips prior absolute coordinates for free-positioned nodes', async () => {
    const connector = {
      getNodeData: vi.fn().mockResolvedValue({ parent: { layoutMode: 'NONE' } }),
      moveNode: vi.fn().mockResolvedValue({ success: true }),
    };
    const inverse = buildMoveInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.moveNode).toHaveBeenCalledWith('2:1', 10, 20);
  });

  it('skips move inverse when captured parent uses auto-layout', () => {
    expect(buildMoveInverse(makeSnapshot('VERTICAL'))).toBeNull();
  });

  it('throws when current parent switched to auto-layout between capture and restore', async () => {
    const connector = {
      getNodeData: vi.fn().mockResolvedValue({ parent: { layoutMode: 'VERTICAL' } }),
      moveNode: vi.fn(),
    };
    const inverse = buildMoveInverse(makeSnapshot());

    await expect(inverse?.apply(connector as never)).rejects.toThrow(/auto-layout/);
    expect(connector.moveNode).not.toHaveBeenCalled();
  });
});
