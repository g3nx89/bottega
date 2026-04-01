import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool } from '../../helpers/tool-test-utils.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Mock extractTree
vi.mock('../../../src/main/compression/project-tree.js', () => ({
  extractTree: vi.fn((data: any) => ({ nodes: [{ id: data.id, name: data.name, type: data.type }] })),
}));

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createDiscoveryTools } from '../../../src/main/tools/discovery.js';

describe('discovery tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: ToolDefinition[];

  const findTool = (name: string) => _findTool(tools, name);

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createDiscoveryTools(deps);
  });

  // ── figma_get_file_data ──────────────────────────

  describe('figma_get_file_data', () => {
    it('calls executeCodeViaUI with generated code and 30000 timeout', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ id: '0:1', type: 'PAGE', name: 'Page 1', children: [] }),
      );
      const tool = findTool('figma_get_file_data');
      await tool.execute('c1', {}, undefined, undefined, undefined);

      expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
      const [, timeout] = deps.connector.executeCodeViaUI.mock.calls[0];
      expect(timeout).toBe(30000);
    });

    it('parses JSON string result and returns projected tree', async () => {
      const raw = { id: '0:1', type: 'PAGE', name: 'Page 1', children: [] };
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify(raw));

      const tool = findTool('figma_get_file_data');
      const result = await tool.execute('c1', {}, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.nodes).toBeDefined();
      expect(parsed.nodes[0].id).toBe('0:1');
    });

    it('returns error as-is when result has error field', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ error: 'Node not found' }));
      const tool = findTool('figma_get_file_data');
      const result = await tool.execute('c1', { nodeId: '999:999' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Node not found');
    });

    it('generates code with figma.getNodeByIdAsync when nodeId is provided', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ id: '1:2', type: 'FRAME', name: 'F', children: [] }),
      );
      const tool = findTool('figma_get_file_data');
      await tool.execute('c1', { nodeId: '1:2' }, undefined, undefined, undefined);

      const codeArg = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(codeArg).toContain('figma.getNodeByIdAsync');
    });

    it('generates code with figma.currentPage when no nodeId', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ id: '0:1', type: 'PAGE', name: 'Page 1', children: [] }),
      );
      const tool = findTool('figma_get_file_data');
      await tool.execute('c1', {}, undefined, undefined, undefined);

      const codeArg = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(codeArg).toContain('figma.currentPage');
    });
  });

  // ── figma_search_components ──────────────────────

  describe('figma_search_components', () => {
    it('calls figmaAPI.searchComponents when libraryFileKey is provided', async () => {
      deps.figmaAPI.searchComponents.mockResolvedValue([{ name: 'Button', key: 'k1' }]);
      const tool = findTool('figma_search_components');
      await tool.execute('c1', { query: 'Button', libraryFileKey: 'file123' }, undefined, undefined, undefined);

      expect(deps.figmaAPI.searchComponents).toHaveBeenCalledWith('file123', 'Button');
      expect(deps.connector.getLocalComponents).not.toHaveBeenCalled();
    });

    it('calls connector.getLocalComponents and filters by query when no libraryFileKey', async () => {
      deps.connector.getLocalComponents.mockResolvedValue([
        { name: 'Primary Button', key: 'btn1' },
        { name: 'Card', key: 'card1' },
        { name: 'Icon Button', key: 'btn2' },
      ]);
      const tool = findTool('figma_search_components');
      const result = await tool.execute('c1', { query: 'button' }, undefined, undefined, undefined);

      expect(deps.connector.getLocalComponents).toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Primary Button');
      expect(parsed[1].name).toBe('Icon Button');
    });

    it('performs case-insensitive filtering', async () => {
      deps.connector.getLocalComponents.mockResolvedValue([
        { name: 'Primary Button', key: 'btn1' },
        { name: 'BUTTON Large', key: 'btn3' },
        { name: 'Card', key: 'card1' },
      ]);
      const tool = findTool('figma_search_components');
      const result = await tool.execute('c1', { query: 'button' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it('returns non-array result as-is when getLocalComponents returns non-array', async () => {
      deps.connector.getLocalComponents.mockResolvedValue({ error: 'Not connected' });
      const tool = findTool('figma_search_components');
      const result = await tool.execute('c1', { query: 'button' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ error: 'Not connected' });
    });
  });

  // ── figma_get_library_components ─────────────────

  describe('figma_get_library_components', () => {
    it('calls getComponents and getComponentSets in parallel', async () => {
      deps.figmaAPI.getComponents.mockResolvedValue({ meta: { components: ['c1'] } });
      deps.figmaAPI.getComponentSets.mockResolvedValue({ meta: { component_sets: ['cs1'] } });

      const tool = findTool('figma_get_library_components');
      await tool.execute('c1', { fileKey: 'lib123' }, undefined, undefined, undefined);

      expect(deps.figmaAPI.getComponents).toHaveBeenCalledWith('lib123');
      expect(deps.figmaAPI.getComponentSets).toHaveBeenCalledWith('lib123');
    });

    it('returns both components and componentSets in result', async () => {
      const comps = { meta: { components: [{ key: 'c1' }] } };
      const sets = { meta: { component_sets: [{ key: 'cs1' }] } };
      deps.figmaAPI.getComponents.mockResolvedValue(comps);
      deps.figmaAPI.getComponentSets.mockResolvedValue(sets);

      const tool = findTool('figma_get_library_components');
      const result = await tool.execute('c1', { fileKey: 'lib123' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.components).toEqual(comps);
      expect(parsed.componentSets).toEqual(sets);
    });
  });

  // ── figma_get_component_details ──────────────────

  describe('figma_get_component_details', () => {
    it('calls connector.getComponentFromPluginUI with nodeId', async () => {
      deps.connector.getComponentFromPluginUI.mockResolvedValue({ name: 'Button', variants: [] });
      const tool = findTool('figma_get_component_details');
      await tool.execute('c1', { nodeId: '5:10' }, undefined, undefined, undefined);

      expect(deps.connector.getComponentFromPluginUI).toHaveBeenCalledWith('5:10');
    });

    it('returns result in textResult format', async () => {
      const detail = { name: 'Button', variants: ['primary', 'secondary'] };
      deps.connector.getComponentFromPluginUI.mockResolvedValue(detail);
      const tool = findTool('figma_get_component_details');
      const result = await tool.execute('c1', { nodeId: '5:10' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(detail);
    });
  });

  // ── figma_design_system ──────────────────────────

  describe('figma_design_system', () => {
    it('returns cached data without calling connector when cache hit and no forceRefresh', async () => {
      deps.designSystemCache.get.mockReturnValue({ some: 'cached data' });

      const tool = findTool('figma_design_system');
      const result = await tool.execute('c1', {}, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ some: 'cached data' });
      expect(deps.connector.getVariables).not.toHaveBeenCalled();
      expect(deps.connector.getLocalComponents).not.toHaveBeenCalled();
    });

    it('fetches from connector on cache miss and stores in cache', async () => {
      deps.designSystemCache.get.mockReturnValue(null);
      deps.connector.getVariables.mockResolvedValue({ colors: ['red'] });
      deps.connector.getLocalComponents.mockResolvedValue([{ name: 'Btn' }]);

      const tool = findTool('figma_design_system');
      await tool.execute('c1', {}, undefined, undefined, undefined);

      expect(deps.connector.getVariables).toHaveBeenCalled();
      expect(deps.connector.getLocalComponents).toHaveBeenCalled();
      expect(deps.designSystemCache.set).toHaveBeenCalledWith(
        {
          variables: { colors: ['red'] },
          components: [{ name: 'Btn' }],
        },
        undefined,
      );
    });

    it('fetches from connector when forceRefresh is true even with cache', async () => {
      deps.designSystemCache.get.mockReturnValue({ some: 'cached data' });
      deps.connector.getVariables.mockResolvedValue({ v: 1 });
      deps.connector.getLocalComponents.mockResolvedValue([]);

      const tool = findTool('figma_design_system');
      await tool.execute('c1', { forceRefresh: true }, undefined, undefined, undefined);

      expect(deps.connector.getVariables).toHaveBeenCalled();
      expect(deps.connector.getLocalComponents).toHaveBeenCalled();
    });

    it('returns compact form when compactDesignSystem config is true', async () => {
      deps.configManager.getActiveConfig.mockReturnValue({
        defaultSemanticMode: 'full',
        outputFormat: 'json',
        compactDesignSystem: true,
        designSystemCacheTtlMs: 60000,
      });
      deps.designSystemCache.get.mockReturnValue({ summary: 'compacted' });

      const tool = findTool('figma_design_system');
      const result = await tool.execute('c1', {}, undefined, undefined, undefined);

      // Should have called get with shouldCompact=true and fileKey=undefined
      expect(deps.designSystemCache.get).toHaveBeenCalledWith(true, undefined);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ summary: 'compacted' });
    });

    it('calls designSystemCache.set with raw data on fresh fetch', async () => {
      deps.designSystemCache.get.mockReturnValue(null);
      deps.connector.getVariables.mockResolvedValue({ tokens: [] });
      deps.connector.getLocalComponents.mockResolvedValue([{ name: 'Card' }]);

      const tool = findTool('figma_design_system');
      await tool.execute('c1', {}, undefined, undefined, undefined);

      expect(deps.designSystemCache.set).toHaveBeenCalledWith(
        {
          variables: { tokens: [] },
          components: [{ name: 'Card' }],
        },
        undefined,
      );
    });
  });

  // ── figma_scan_text_nodes ─────────────────────────────────────────

  describe('figma_scan_text_nodes', () => {
    it('calls connector.scanTextNodes with no args by default', async () => {
      const tool = findTool('figma_scan_text_nodes');
      deps.connector.scanTextNodes.mockResolvedValue({ count: 0, nodes: [] });

      await tool.execute('c1', {}, undefined, undefined, undefined);

      expect(deps.connector.scanTextNodes).toHaveBeenCalledWith(undefined, undefined, undefined);
    });

    it('passes nodeId, maxDepth, and maxResults', async () => {
      const tool = findTool('figma_scan_text_nodes');
      deps.connector.scanTextNodes.mockResolvedValue({ count: 5, nodes: [] });

      await tool.execute('c2', { nodeId: '10:1', maxDepth: 3, maxResults: 50 }, undefined, undefined, undefined);

      expect(deps.connector.scanTextNodes).toHaveBeenCalledWith('10:1', 3, 50);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_scan_text_nodes');
      const data = { count: 2, nodes: [{ id: '1:1' }, { id: '1:2' }] };
      deps.connector.scanTextNodes.mockResolvedValue(data);

      const result = await tool.execute('c3', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: {},
      });
    });
  });
});
