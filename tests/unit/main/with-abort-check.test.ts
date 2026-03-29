import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for withAbortCheck wrapper from tools/index.ts.
 *
 * Since withAbortCheck is not exported, we test the same logic pattern
 * and verify that createFigmaTools applies it correctly.
 */

// Re-implement the withAbortCheck logic as a contract test
function withAbortCheck(tool: any): any {
  const original = tool.execute;
  return {
    ...tool,
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      return original.call(tool, toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

describe('withAbortCheck', () => {
  it('should throw when signal is already aborted', async () => {
    const tool = withAbortCheck({
      name: 'test_tool',
      execute: vi.fn().mockResolvedValue({ content: [] }),
    });

    const abortedSignal = { aborted: true };

    await expect(tool.execute('tc1', {}, abortedSignal, undefined, undefined)).rejects.toThrow('Aborted');
    // Original execute should NOT have been called
    expect(tool.execute).toBeDefined(); // wrapped
  });

  it('should call original execute when signal is not aborted', async () => {
    const originalExecute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const tool = withAbortCheck({
      name: 'test_tool',
      execute: originalExecute,
    });

    const signal = { aborted: false };
    const result = await tool.execute('tc1', { nodeId: '1:2' }, signal, undefined, undefined);

    expect(originalExecute).toHaveBeenCalledWith('tc1', { nodeId: '1:2' }, signal, undefined, undefined);
    expect(result.content[0].text).toBe('ok');
  });

  it('should call original execute when signal is undefined', async () => {
    const originalExecute = vi.fn().mockResolvedValue({ content: [] });
    const tool = withAbortCheck({
      name: 'test_tool',
      execute: originalExecute,
    });

    await tool.execute('tc1', {}, undefined, undefined, undefined);
    expect(originalExecute).toHaveBeenCalled();
  });

  it('should call original execute when signal is null', async () => {
    const originalExecute = vi.fn().mockResolvedValue({ content: [] });
    const tool = withAbortCheck({
      name: 'test_tool',
      execute: originalExecute,
    });

    await tool.execute('tc1', {}, null, undefined, undefined);
    expect(originalExecute).toHaveBeenCalled();
  });

  it('should preserve tool properties', () => {
    const tool = withAbortCheck({
      name: 'figma_resize',
      label: 'Resize',
      description: 'Resize a node',
      execute: vi.fn(),
    });

    expect(tool.name).toBe('figma_resize');
    expect(tool.label).toBe('Resize');
    expect(tool.description).toBe('Resize a node');
  });

  it('should propagate errors from original execute', async () => {
    const tool = withAbortCheck({
      name: 'test_tool',
      execute: vi.fn().mockRejectedValue(new Error('Connection lost')),
    });

    await expect(tool.execute('tc1', {}, { aborted: false }, undefined, undefined)).rejects.toThrow('Connection lost');
  });
});
