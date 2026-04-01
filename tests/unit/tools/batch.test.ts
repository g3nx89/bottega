import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchTools } from '../../../src/main/tools/batch.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool, expectTextResult } from '../../helpers/tool-test-utils.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Batch Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createBatchTools(deps);
  });

  const findTool = (name: string) => _findTool(tools, name);

  // ── figma_batch_set_text ──────────────────────────────────────────

  describe('figma_batch_set_text', () => {
    it('calls connector.batchSetText with updates array', async () => {
      const tool = findTool('figma_batch_set_text');
      const updates = [
        { nodeId: '1:2', text: 'Hello' },
        { nodeId: '3:4', text: 'World' },
      ];

      await tool.execute('c1', { updates }, undefined, undefined, undefined);

      expect(deps.connector.batchSetText).toHaveBeenCalledWith(updates);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_batch_set_text');
      const data = { updated: 2, total: 2, results: [] };
      deps.connector.batchSetText.mockResolvedValue(data);

      const result = await tool.execute('c2', { updates: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });

    it('passes through empty updates array', async () => {
      const tool = findTool('figma_batch_set_text');
      deps.connector.batchSetText.mockResolvedValue({ updated: 0, total: 0, results: [] });

      await tool.execute('c3', { updates: [] }, undefined, undefined, undefined);

      expect(deps.connector.batchSetText).toHaveBeenCalledWith([]);
    });
  });

  // ── figma_batch_set_fills ─────────────────────────────────────────

  describe('figma_batch_set_fills', () => {
    it('calls connector.batchSetFills with updates array', async () => {
      const tool = findTool('figma_batch_set_fills');
      const updates = [
        { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#FF0000' }] },
        { nodeId: '3:4', fills: [{ type: 'SOLID', color: '#00FF00' }] },
      ];

      await tool.execute('c4', { updates }, undefined, undefined, undefined);

      expect(deps.connector.batchSetFills).toHaveBeenCalledWith(updates);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_batch_set_fills');
      const data = { updated: 2, total: 2, results: [] };
      deps.connector.batchSetFills.mockResolvedValue(data);

      const result = await tool.execute('c5', { updates: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_batch_transform ─────────────────────────────────────────

  describe('figma_batch_transform', () => {
    it('calls connector.batchTransform with updates array', async () => {
      const tool = findTool('figma_batch_transform');
      const updates = [
        { nodeId: '1:2', x: 10, y: 20 },
        { nodeId: '3:4', width: 100, height: 50 },
      ];

      await tool.execute('c6', { updates }, undefined, undefined, undefined);

      expect(deps.connector.batchTransform).toHaveBeenCalledWith(updates);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_batch_transform');
      const data = { updated: 2, total: 2, results: [] };
      deps.connector.batchTransform.mockResolvedValue(data);

      const result = await tool.execute('c7', { updates: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });
});
