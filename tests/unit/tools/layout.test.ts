import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayoutTools } from '../../../src/main/tools/layout.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool, expectTextResult } from '../../helpers/tool-test-utils.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Layout Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createLayoutTools(deps);
  });

  const findTool = (name: string) => _findTool(tools, name);

  describe('figma_auto_layout', () => {
    it('calls connector.setAutoLayout with nodeId and params', async () => {
      const tool = findTool('figma_auto_layout');
      const params = { nodeId: '1:2', direction: 'VERTICAL', padding: 16, itemSpacing: 8 };

      await tool.execute('c1', params, undefined, undefined, undefined);

      expect(deps.connector.setAutoLayout).toHaveBeenCalledWith('1:2', params);
    });

    it('passes only provided optional params', async () => {
      const tool = findTool('figma_auto_layout');
      const params = { nodeId: '1:2', direction: 'HORIZONTAL' };

      await tool.execute('c2', params, undefined, undefined, undefined);

      expect(deps.connector.setAutoLayout).toHaveBeenCalledWith('1:2', params);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_auto_layout');
      const data = { node: { id: '1:2', name: 'Frame', layoutMode: 'VERTICAL' } };
      deps.connector.setAutoLayout.mockResolvedValue(data);

      const result = await tool.execute(
        'c3',
        { nodeId: '1:2', direction: 'VERTICAL' },
        undefined,
        undefined,
        undefined,
      );

      expectTextResult(result, data);
    });
  });
});
