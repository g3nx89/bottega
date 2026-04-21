import { describe, expect, it, vi } from 'vitest';
import { buildResizeInverse } from '../../../../../src/main/rewind/inverse/resize.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(): MutationSnapshot {
  return {
    tool: 'figma_resize',
    input: { nodeId: '3:4', width: 300, height: 200 },
    nodeIds: ['3:4'],
    preState: {
      width: 120,
      height: 80,
      layoutSizing: { horizontal: 'HUG', vertical: 'FILL' },
    },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildResizeInverse', () => {
  it('roundtrips prior size through resizeNode with constraints', async () => {
    const connector = {
      resizeNode: vi.fn().mockResolvedValue({ success: true }),
      setLayoutSizing: vi.fn().mockResolvedValue({ success: true }),
    };
    const inverse = buildResizeInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.resizeNode).toHaveBeenCalledWith('3:4', 120, 80, true);
  });

  it('restores layout sizing after resizing', async () => {
    const connector = {
      resizeNode: vi.fn().mockResolvedValue({ success: true }),
      setLayoutSizing: vi.fn().mockResolvedValue({ success: true }),
    };
    const inverse = buildResizeInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.setLayoutSizing).toHaveBeenCalledWith('3:4', 'HUG', 'FILL');
  });
});
