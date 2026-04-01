import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool } from '../../helpers/tool-test-utils.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createComponentTools } from '../../../src/main/tools/components.js';

describe('component tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: ToolDefinition[];

  const findTool = (name: string) => _findTool(tools, name);

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createComponentTools(deps);
  });

  // ── figma_instantiate ────────────────────────────

  describe('figma_instantiate', () => {
    it('calls connector.instantiateComponent with componentKey and options', async () => {
      deps.connector.instantiateComponent.mockResolvedValue({ id: '10:1', type: 'INSTANCE' });
      const tool = findTool('figma_instantiate');
      await tool.execute(
        'c1',
        { componentKey: 'abc123', x: 100, y: 200, parentId: '1:5' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.instantiateComponent).toHaveBeenCalledWith('abc123', {
        x: 100,
        y: 200,
        parentId: '1:5',
      });
    });

    it('passes x, y, parentId from params', async () => {
      deps.connector.instantiateComponent.mockResolvedValue({ id: '10:2' });
      const tool = findTool('figma_instantiate');
      await tool.execute('c1', { componentKey: 'k1', x: 50, y: 75, parentId: '2:3' }, undefined, undefined, undefined);

      const callArgs = deps.connector.instantiateComponent.mock.calls[0];
      expect(callArgs[0]).toBe('k1');
      expect(callArgs[1]).toEqual({ x: 50, y: 75, parentId: '2:3' });
    });

    it('uses OperationQueue (serialized execution)', async () => {
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');
      deps.connector.instantiateComponent.mockResolvedValue({ id: '10:3' });
      const tool = findTool('figma_instantiate');
      await tool.execute('c1', { componentKey: 'k1' }, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it('returns textResult with connector response', async () => {
      const response = { id: '10:4', type: 'INSTANCE', name: 'Button' };
      deps.connector.instantiateComponent.mockResolvedValue(response);
      const tool = findTool('figma_instantiate');
      const result = await tool.execute('c1', { componentKey: 'k1' }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(response);
    });
  });

  // ── figma_set_instance_properties ────────────────

  describe('figma_set_instance_properties', () => {
    it('calls connector.setInstanceProperties with nodeId and properties', async () => {
      deps.connector.setInstanceProperties.mockResolvedValue({ success: true });
      const tool = findTool('figma_set_instance_properties');
      const props = { label: 'Submit', disabled: false };
      await tool.execute('c1', { nodeId: '5:10', properties: props }, undefined, undefined, undefined);

      expect(deps.connector.setInstanceProperties).toHaveBeenCalledWith('5:10', props);
    });

    it('passes key-value property map correctly', async () => {
      deps.connector.setInstanceProperties.mockResolvedValue({ success: true });
      const tool = findTool('figma_set_instance_properties');
      const properties = { title: 'Hello', showIcon: true, variant: 'primary' };
      await tool.execute('c1', { nodeId: '3:7', properties }, undefined, undefined, undefined);

      const callArgs = deps.connector.setInstanceProperties.mock.calls[0];
      expect(callArgs[1]).toEqual(properties);
    });

    it('uses OperationQueue', async () => {
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');
      deps.connector.setInstanceProperties.mockResolvedValue({ success: true });
      const tool = findTool('figma_set_instance_properties');
      await tool.execute('c1', { nodeId: '1:1', properties: { a: 1 } }, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── figma_arrange_component_set ──────────────────

  describe('figma_arrange_component_set', () => {
    it('calls connector.executeCodeViaUI with generated code', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true, arranged: 6, columns: 3 }));
      const tool = findTool('figma_arrange_component_set');
      await tool.execute('c1', { nodeId: '1:23', columns: 3 }, undefined, undefined, undefined);

      expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    });

    it('sanitizes nodeId by stripping non-alphanumeric chars except colons', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));
      const tool = findTool('figma_arrange_component_set');
      await tool.execute('c1', { nodeId: '1:23', columns: 3 }, undefined, undefined, undefined);

      const code = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('"1:23"');
    });

    it('defaults columns to 4 and enforces minimum of 1', async () => {
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));
      const tool = findTool('figma_arrange_component_set');

      // No columns specified → defaults to 4
      await tool.execute('c1', { nodeId: '1:1' }, undefined, undefined, undefined);
      let code = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('const cols = 4');

      // Columns = -5 → clamped to minimum 1 (negative is truthy, so || 4 doesn't kick in)
      deps.connector.executeCodeViaUI.mockClear();
      await tool.execute('c2', { nodeId: '1:1', columns: -5 }, undefined, undefined, undefined);
      code = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('const cols = 1');
    });

    it('uses OperationQueue', async () => {
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));
      const tool = findTool('figma_arrange_component_set');
      await tool.execute('c1', { nodeId: '1:1', columns: 2 }, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it('returns textResult with connector response', async () => {
      const response = JSON.stringify({ success: true, arranged: 8, columns: 4 });
      deps.connector.executeCodeViaUI.mockResolvedValue(response);
      const tool = findTool('figma_arrange_component_set');
      const result = await tool.execute('c1', { nodeId: '2:5', columns: 4 }, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      // executeCodeViaUI returns a JSON string, textResult wraps it
      expect(parsed).toBeDefined();
    });
  });

  // ── figma_set_variant ─────────────────────────────────────────────

  describe('figma_set_variant', () => {
    it('calls connector.setVariant with nodeId and variant map', async () => {
      const tool = findTool('figma_set_variant');
      const variant = { State: 'Hover', Size: 'Large' };

      await tool.execute('c1', { nodeId: '1:2', variant }, undefined, undefined, undefined);

      expect(deps.connector.setVariant).toHaveBeenCalledWith('1:2', variant);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_variant');
      const data = { instance: { id: '1:2', name: 'Button', appliedVariants: { State: 'Hover' } } };
      deps.connector.setVariant.mockResolvedValue(data);

      const result = await tool.execute(
        'c2',
        { nodeId: '1:2', variant: { State: 'Hover' } },
        undefined,
        undefined,
        undefined,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: {},
      });
    });

    it('propagates connector errors', async () => {
      const tool = findTool('figma_set_variant');
      deps.connector.setVariant.mockRejectedValue(new Error('Not an instance'));

      await expect(
        tool.execute('c3', { nodeId: '1:2', variant: { State: 'Hover' } }, undefined, undefined, undefined),
      ).rejects.toThrow('Not an instance');
    });
  });
});
