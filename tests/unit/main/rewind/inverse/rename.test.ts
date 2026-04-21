import { describe, expect, it, vi } from 'vitest';
import { buildRenameInverse } from '../../../../../src/main/rewind/inverse/rename.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(name: unknown = 'Original Name'): MutationSnapshot {
  return {
    tool: 'figma_rename',
    input: { nodeId: '5:6', name: 'New Name' },
    nodeIds: ['5:6'],
    preState: { name },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildRenameInverse', () => {
  it('roundtrips prior layer name', async () => {
    const connector = { renameNode: vi.fn().mockResolvedValue({ success: true }) };
    const inverse = buildRenameInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.renameNode).toHaveBeenCalledWith('5:6', 'Original Name');
  });

  it('returns null when preState.name is not a string', () => {
    expect(buildRenameInverse(makeSnapshot(null))).toBeNull();
  });
});
