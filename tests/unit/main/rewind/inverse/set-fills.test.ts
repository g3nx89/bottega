import { describe, expect, it, vi } from 'vitest';
import { buildSetFillsInverse } from '../../../../../src/main/rewind/inverse/set-fills.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(): MutationSnapshot {
  return {
    tool: 'figma_set_fills',
    input: { nodeId: '1:2' },
    nodeIds: ['1:2'],
    preState: {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1 },
          boundVariables: { color: { id: 'var-color-1' } },
        },
      ],
    },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildSetFillsInverse', () => {
  it('roundtrips preState fills through setNodeFills preserveRaw=true', async () => {
    const connector = { setNodeFills: vi.fn().mockResolvedValue({ success: true }) };
    const inverse = buildSetFillsInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.setNodeFills).toHaveBeenCalledWith(
      '1:2',
      [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, boundVariables: { color: { id: 'var-color-1' } } }],
      true,
    );
  });

  it('preserves boundVariables payload exactly for restore', async () => {
    const connector = { setNodeFills: vi.fn().mockResolvedValue({ success: true }) };
    const snapshot = makeSnapshot();
    const inverse = buildSetFillsInverse(snapshot);

    await inverse?.apply(connector as never);

    expect(connector.setNodeFills.mock.calls[0]?.[1][0].boundVariables.color.id).toBe('var-color-1');
    expect(connector.setNodeFills.mock.calls[0]?.[1][0]).toEqual((snapshot.preState.fills as unknown[])[0]);
  });
});
