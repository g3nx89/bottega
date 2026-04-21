import { describe, expect, it, vi } from 'vitest';
import { buildCloneInverse } from '../../../../../src/main/rewind/inverse/clone.js';
import { dispatchInverse } from '../../../../../src/main/rewind/inverse/index.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(createdNodeIds?: string[]): MutationSnapshot {
  return {
    tool: 'figma_clone',
    input: { nodeId: '1:2' },
    nodeIds: ['1:2'],
    createdNodeIds,
    preState: { subtree: { id: '1:2', type: 'FRAME', name: 'Source' } },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildCloneInverse', () => {
  it('roundtrips clone restore by deleting the created node id', async () => {
    const connector = { deleteNode: vi.fn().mockResolvedValue({ success: true }) };
    const inverse = buildCloneInverse(makeSnapshot(['5:10']));

    await inverse?.apply(connector as never);

    expect(connector.deleteNode).toHaveBeenCalledWith('5:10');
  });

  it('returns null when createdNodeIds are missing', () => {
    expect(buildCloneInverse(makeSnapshot())).toBeNull();
    expect(dispatchInverse(makeSnapshot())).toBeNull();
  });
});
