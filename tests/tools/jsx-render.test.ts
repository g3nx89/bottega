import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsxRenderTools } from '../../src/main/tools/jsx-render.js';
import { createTestToolDeps } from '../helpers/mock-connector.js';

// Mock logger
vi.mock('../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Mock jsx-parser — tested separately
vi.mock('../../src/main/jsx-parser.js', () => ({
  parseJsx: vi.fn().mockReturnValue({
    type: 'frame',
    props: { width: 100, height: 50 },
    children: [],
  }),
}));

// Mock icon-loader — tested separately
vi.mock('../../src/main/icon-loader.js', () => ({
  resolveIcons: vi.fn().mockResolvedValue(undefined),
  loadIconSvg: vi.fn().mockResolvedValue('<svg>mock</svg>'),
}));

import { loadIconSvg, resolveIcons } from '../../src/main/icon-loader.js';
import { parseJsx } from '../../src/main/jsx-parser.js';

describe('JSX Render Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createJsxRenderTools(deps);
  });

  // ── figma_render_jsx ────────────────────────────────────────────────

  describe('figma_render_jsx', () => {
    const getTool = () => tools.find((t) => t.name === 'figma_render_jsx');

    it('calls parseJsx with the jsx string param', async () => {
      const tool = getTool();

      await tool.execute('call-1', { jsx: '<Frame bg="#FFF" />' }, undefined, undefined, undefined);

      expect(parseJsx).toHaveBeenCalledWith('<Frame bg="#FFF" />');
    });

    it('calls resolveIcons with the parsed tree', async () => {
      const tool = getTool();
      const mockTree = { type: 'frame', props: { width: 100, height: 50 }, children: [] };
      vi.mocked(parseJsx).mockReturnValue(mockTree);

      await tool.execute('call-2', { jsx: '<Frame />' }, undefined, undefined, undefined);

      expect(resolveIcons).toHaveBeenCalledWith(mockTree);
    });

    it('calls connector.createFromJsx with tree and position options', async () => {
      const tool = getTool();
      const mockTree = { type: 'frame', props: { width: 200 }, children: [] };
      vi.mocked(parseJsx).mockReturnValue(mockTree);

      await tool.execute(
        'call-3',
        { jsx: '<Frame />', x: 10, y: 20, parentId: '1:5' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.createFromJsx).toHaveBeenCalledWith(mockTree, {
        x: 10,
        y: 20,
        parentId: '1:5',
      });
    });

    it('passes undefined for optional x, y, parentId when not provided', async () => {
      const tool = getTool();

      await tool.execute('call-4', { jsx: '<Frame />' }, undefined, undefined, undefined);

      expect(deps.connector.createFromJsx).toHaveBeenCalledWith(expect.any(Object), {
        x: undefined,
        y: undefined,
        parentId: undefined,
      });
    });

    it('uses OperationQueue for serialization', async () => {
      const tool = getTool();
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');

      await tool.execute('call-5', { jsx: '<Frame />' }, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(expect.any(Function));
    });

    it('returns textResult with the connector result', async () => {
      const tool = getTool();
      const connectorResult = { nodeId: '99:1', success: true };
      deps.connector.createFromJsx.mockResolvedValue(connectorResult);

      const result = await tool.execute('call-6', { jsx: '<Frame />' }, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(connectorResult) }],
        details: {},
      });
    });

    it('error from parseJsx propagates', async () => {
      const tool = getTool();
      vi.mocked(parseJsx).mockImplementation(() => {
        throw new Error('Invalid JSX syntax');
      });

      await expect(tool.execute('call-7', { jsx: '<<<bad' }, undefined, undefined, undefined)).rejects.toThrow(
        'Invalid JSX syntax',
      );
    });
  });

  // ── figma_create_icon ───────────────────────────────────────────────

  describe('figma_create_icon', () => {
    const getTool = () => tools.find((t) => t.name === 'figma_create_icon');

    it('calls loadIconSvg with name and default size 24', async () => {
      const tool = getTool();

      await tool.execute('call-8', { name: 'mdi:home' }, undefined, undefined, undefined);

      expect(loadIconSvg).toHaveBeenCalledWith('mdi:home', 24);
    });

    it('calls connector.createIcon with svg, size, color, and position', async () => {
      const tool = getTool();

      await tool.execute(
        'call-9',
        { name: 'lucide:star', size: 32, color: '#FF0000', x: 5, y: 10, parentId: '2:3' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.createIcon).toHaveBeenCalledWith('<svg>mock</svg>', 32, '#FF0000', {
        x: 5,
        y: 10,
        parentId: '2:3',
      });
    });

    it('uses default color #000000 when not provided', async () => {
      const tool = getTool();

      await tool.execute('call-10', { name: 'mdi:home' }, undefined, undefined, undefined);

      expect(deps.connector.createIcon).toHaveBeenCalledWith(
        '<svg>mock</svg>',
        24,
        '#000000',
        expect.objectContaining({}),
      );
    });

    it('uses OperationQueue for serialization', async () => {
      const tool = getTool();
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');

      await tool.execute('call-11', { name: 'mdi:home' }, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ── figma_bind_variable ─────────────────────────────────────────────

  describe('figma_bind_variable', () => {
    const getTool = () => tools.find((t) => t.name === 'figma_bind_variable');

    it('calls connector.bindVariable with nodeId, variableName, property', async () => {
      const tool = getTool();

      await tool.execute(
        'call-12',
        { nodeId: '1:42', variableName: 'colors/primary', property: 'fill' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:42', 'colors/primary', 'fill');
    });

    it('returns textResult with success: true', async () => {
      const tool = getTool();

      const result = await tool.execute(
        'call-13',
        { nodeId: '1:42', variableName: 'colors/bg', property: 'stroke' },
        undefined,
        undefined,
        undefined,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        details: {},
      });
    });

    it('uses OperationQueue for serialization', async () => {
      const tool = getTool();
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');

      await tool.execute(
        'call-14',
        { nodeId: '1:1', variableName: 'v', property: 'fill' },
        undefined,
        undefined,
        undefined,
      );

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
