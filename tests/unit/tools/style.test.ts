import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStyleTools } from '../../../src/main/tools/style.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool, expectTextResult } from '../../helpers/tool-test-utils.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Style Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createStyleTools(deps);
  });

  const findTool = (name: string) => _findTool(tools, name);

  // ── figma_set_text_style ──────────────────────────────────────────

  describe('figma_set_text_style', () => {
    it('calls connector.setTextStyle with nodeId and style props', async () => {
      const tool = findTool('figma_set_text_style');
      const params = { nodeId: '1:2', lineHeight: 32, textCase: 'UPPER' };

      await tool.execute('c1', params, undefined, undefined, undefined);

      expect(deps.connector.setTextStyle).toHaveBeenCalledWith('1:2', params);
    });

    it('passes only provided optional params', async () => {
      const tool = findTool('figma_set_text_style');

      await tool.execute('c2', { nodeId: '1:2', letterSpacing: 1.5 }, undefined, undefined, undefined);

      expect(deps.connector.setTextStyle).toHaveBeenCalledWith('1:2', { nodeId: '1:2', letterSpacing: 1.5 });
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_text_style');
      const data = { node: { id: '1:2', name: 'Title' } };
      deps.connector.setTextStyle.mockResolvedValue(data);

      const result = await tool.execute('c3', { nodeId: '1:2', textCase: 'UPPER' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_effects ─────────────────────────────────────────────

  describe('figma_set_effects', () => {
    it('calls connector.setEffects with nodeId and effects array', async () => {
      const tool = findTool('figma_set_effects');
      const effects = [{ type: 'DROP_SHADOW', radius: 4, offsetX: 0, offsetY: 2, color: '#000000' }];

      await tool.execute('c4', { nodeId: '1:2', effects }, undefined, undefined, undefined);

      expect(deps.connector.setEffects).toHaveBeenCalledWith('1:2', effects);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_effects');
      const data = { node: { id: '1:2', name: 'Card' } };
      deps.connector.setEffects.mockResolvedValue(data);

      const result = await tool.execute('c5', { nodeId: '1:2', effects: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_opacity ─────────────────────────────────────────────

  describe('figma_set_opacity', () => {
    it('calls connector.setOpacity with nodeId and opacity', async () => {
      const tool = findTool('figma_set_opacity');

      await tool.execute('c6', { nodeId: '1:2', opacity: 0.5 }, undefined, undefined, undefined);

      expect(deps.connector.setOpacity).toHaveBeenCalledWith('1:2', 0.5);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_opacity');
      const data = { node: { id: '1:2', name: 'Overlay' } };
      deps.connector.setOpacity.mockResolvedValue(data);

      const result = await tool.execute('c7', { nodeId: '1:2', opacity: 0.8 }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_corner_radius ───────────────────────────────────────

  describe('figma_set_corner_radius', () => {
    it('calls connector.setCornerRadius with uniform radius', async () => {
      const tool = findTool('figma_set_corner_radius');
      const params = { nodeId: '1:2', radius: 8 };

      await tool.execute('c8', params, undefined, undefined, undefined);

      expect(deps.connector.setCornerRadius).toHaveBeenCalledWith('1:2', params);
    });

    it('calls connector.setCornerRadius with per-corner values', async () => {
      const tool = findTool('figma_set_corner_radius');
      const params = { nodeId: '1:2', topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 };

      await tool.execute('c9', params, undefined, undefined, undefined);

      expect(deps.connector.setCornerRadius).toHaveBeenCalledWith('1:2', params);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_corner_radius');
      const data = { node: { id: '1:2', name: 'Button' } };
      deps.connector.setCornerRadius.mockResolvedValue(data);

      const result = await tool.execute('c10', { nodeId: '1:2', radius: 4 }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });
});
