import { describe, expect, it, vi } from 'vitest';
import { buildSetTextInverse } from '../../../../../src/main/rewind/inverse/set-text.js';
import type { MutationSnapshot } from '../../../../../src/main/rewind/types.js';

function makeSnapshot(): MutationSnapshot {
  return {
    tool: 'figma_set_text',
    input: { nodeId: '1:9', text: 'next' },
    nodeIds: ['1:9'],
    preState: {
      text: {
        characters: 'prev',
        fontName: { family: 'Geist', style: 'Medium' },
        fontSize: 14,
        fontsToLoad: [{ family: 'Geist', style: 'Medium' }],
      },
    },
    kind: 'inverse-op',
    capturedAt: Date.now(),
  };
}

describe('buildSetTextInverse', () => {
  it('roundtrips text content with font metadata', async () => {
    const connector = { setTextContent: vi.fn().mockResolvedValue({ success: true }) };
    const inverse = buildSetTextInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.setTextContent).toHaveBeenCalledWith('1:9', 'prev', {
      fontFamily: 'Geist',
      fontStyle: 'Medium',
      fontSize: 14,
      fontsToLoad: [{ family: 'Geist', style: 'Medium' }],
    });
  });

  it('respects fontsToLoad for restore rehydration', async () => {
    const connector = { setTextContent: vi.fn().mockResolvedValue({ success: true }) };
    const inverse = buildSetTextInverse(makeSnapshot());

    await inverse?.apply(connector as never);

    expect(connector.setTextContent.mock.calls[0]?.[2].fontsToLoad).toEqual([{ family: 'Geist', style: 'Medium' }]);
  });
});
