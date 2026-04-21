import { describe, expect, it } from 'vitest';
import { CaptureBuffer } from '../../../../src/main/rewind/capture.js';

function setupBuffer(): CaptureBuffer {
  const buffer = new CaptureBuffer();
  buffer.onSlotReady('slot-1', 'file-1', 'session-1');
  buffer.onTurnBegin('slot-1', {
    fileKey: 'file-1',
    prompt: 'Paint five nodes',
    turnIndex: 1,
    promptId: 'prompt-1',
    sessionId: 'session-1',
  });
  buffer.onAgentStart('slot-1', 'file-1');
  return buffer;
}

describe('CaptureBuffer', () => {
  it('commits three finalized mutations into one checkpoint', () => {
    const buffer = setupBuffer();

    for (let i = 0; i < 3; i += 1) {
      const toolCallId = `tc-${i}`;
      buffer.pushPending('slot-1', {
        toolCallId,
        tool: 'figma_set_fills',
        input: { nodeId: `${i}:1` },
        nodeIds: [`${i}:1`],
        kind: 'inverse-op',
      });
      buffer.resolvePending('slot-1', toolCallId, { preState: { fills: [{ type: 'SOLID', color: '#000000' }] } });
      buffer.finalize('slot-1', toolCallId, [`${i}:9`]);
    }

    const checkpoint = buffer.commit('slot-1');
    expect(checkpoint?.mutations).toHaveLength(3);
    expect(checkpoint?.restorableCount).toBe(3);
    expect(checkpoint?.mutations[0]?.createdNodeIds).toEqual(['0:9']);
  });

  it('returns null for empty turns', () => {
    const buffer = setupBuffer();
    expect(buffer.commit('slot-1')).toBeNull();
  });

  it('markExecute converts every mutation in the turn to non-restorable', () => {
    const buffer = setupBuffer();
    buffer.pushPending('slot-1', {
      toolCallId: 'tc-1',
      tool: 'figma_set_fills',
      input: { nodeId: '1:2' },
      nodeIds: ['1:2'],
      kind: 'inverse-op',
    });
    buffer.resolvePending('slot-1', 'tc-1', { preState: { fills: [] } });
    buffer.markExecute('slot-1');

    const checkpoint = buffer.commit('slot-1');
    expect(checkpoint?.executeTouched).toBe(true);
    expect(checkpoint?.mutations[0]?.kind).toBe('non-restorable');
    expect(checkpoint?.mutations[0]?.skipReason).toBe('execute');
    expect(checkpoint?.nonRestorableCount).toBe(1);
  });

  it('double commit is a no-op after the first checkpoint', () => {
    const buffer = setupBuffer();
    buffer.pushPending('slot-1', {
      toolCallId: 'tc-1',
      tool: 'figma_rename',
      input: { nodeId: '1:2', name: 'Next' },
      nodeIds: ['1:2'],
      kind: 'inverse-op',
    });
    buffer.resolvePending('slot-1', 'tc-1', { preState: { name: 'Prev' } });

    expect(buffer.commit('slot-1')).not.toBeNull();
    expect(buffer.commit('slot-1')).toBeNull();
  });
});
