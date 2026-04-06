import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createBatchTools } from '../../../../src/main/tools/batch.js';
import { createComponentTools } from '../../../../src/main/tools/components.js';
import { createTokenTools } from '../../../../src/main/tools/tokens.js';
import { createMockConnector } from '../../../helpers/mock-connector.js';

function createTestDeps() {
  const connector = createMockConnector();
  const operationQueue = new OperationQueue();
  return {
    connector,
    operationQueue,
    wsServer: {} as any,
    figmaAPI: {} as any,
    designSystemCache: {} as any,
    configManager: {} as any,
    fileKey: 'test',
  };
}

// ─── figma_create_component ───────────────────────────────────────────────────

describe('figma_create_component', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createComponentTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_create_component');
  });

  it('exists in the returned tools array', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('figma_create_component');
  });

  it('creates a new component with default dimensions', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:1', name: 'Button', width: 100, height: 100 }),
    );

    const result = await tool.execute('call1', { name: 'Button' }, null, null, null);
    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.componentId).toBe('comp:1');
    expect(parsed.name).toBe('Button');
  });

  it('creates a new component with custom dimensions', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:1', name: 'Card', width: 300, height: 200 }),
    );

    const result = await tool.execute('call1', { name: 'Card', width: 300, height: 200 }, null, null, null);
    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(code).toContain('300');
    expect(code).toContain('200');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('uses conversion code path when fromFrameId is provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:2', name: 'Card', converted: true }),
    );

    const result = await tool.execute('call1', { name: 'Card', fromFrameId: '10:5' }, null, null, null);
    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    // Conversion code checks for FRAME or GROUP type
    expect(code).toContain('FRAME');
    expect(code).toContain('GROUP');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.converted).toBe(true);
  });

  it('includes parentId in create-from-scratch code when provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:3', name: 'Icon' }),
    );

    await tool.execute('call1', { name: 'Icon', parentId: '5:1' }, null, null, null);
    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(code).toContain('getNodeByIdAsync');
    expect(code).toContain('appendChild');
  });

  it('sanitizes fromFrameId to only digits, colons, and semicolons', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));

    await tool.execute('call1', { name: 'Test', fromFrameId: '10:5<script>' }, null, null, null);
    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(code).not.toContain('<script>');
  });

  it('passes 15000ms timeout to executeCodeViaUI', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));

    await tool.execute('call1', { name: 'Test' }, null, null, null);
    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledWith(expect.any(String), 15000);
  });

  it('handles executeCodeViaUI returning an object instead of string', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue({ success: true, componentId: 'comp:1', name: 'Test' });

    const result = await tool.execute('call1', { name: 'Test' }, null, null, null);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});

// ─── figma_batch_bind_variable ────────────────────────────────────────────────

describe('figma_batch_bind_variable', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createTokenTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_batch_bind_variable');
  });

  it('exists in the returned tools array', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('figma_batch_bind_variable');
  });

  it('binds all variables successfully', async () => {
    const result = await tool.execute(
      'call1',
      {
        bindings: [
          { nodeId: '1:2', variableName: 'colors/primary', property: 'fill' },
          { nodeId: '3:4', variableName: 'colors/secondary', property: 'stroke' },
        ],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.bindVariable).toHaveBeenCalledTimes(2);
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/primary', 'fill');
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('3:4', 'colors/secondary', 'stroke');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(2);
  });

  it('reports failures without stopping the batch', async () => {
    deps.connector.bindVariable
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Variable not found'))
      .mockResolvedValueOnce({ success: true });

    const result = await tool.execute(
      'call1',
      {
        bindings: [
          { nodeId: '1:2', variableName: 'colors/primary', property: 'fill' },
          { nodeId: '3:4', variableName: 'missing/var', property: 'fill' },
          { nodeId: '5:6', variableName: 'colors/tertiary', property: 'stroke' },
        ],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.bindVariable).toHaveBeenCalledTimes(3);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.total).toBe(3);
    // The failed result should have an error message
    const failedResult = parsed.results.find((r: any) => !r.success);
    expect(failedResult.error).toContain('Variable not found');
  });

  it('handles empty bindings array', async () => {
    const result = await tool.execute('call1', { bindings: [] }, null, null, null);
    expect(deps.connector.bindVariable).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(0);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(0);
  });

  it('includes nodeId, variableName, and property in each result entry', async () => {
    const result = await tool.execute(
      'call1',
      {
        bindings: [{ nodeId: '1:2', variableName: 'spacing/md', property: 'paddingTop' }],
      },
      null,
      null,
      null,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results[0]).toEqual({
      nodeId: '1:2',
      variableName: 'spacing/md',
      property: 'paddingTop',
      success: true,
    });
  });
});

// ─── figma_batch_rename ───────────────────────────────────────────────────────

describe('figma_batch_rename', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createBatchTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_batch_rename');
  });

  it('exists in the returned tools array', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('figma_batch_rename');
  });

  it('renames all nodes successfully', async () => {
    const result = await tool.execute(
      'call1',
      {
        updates: [
          { nodeId: '1:2', name: 'Card/Header' },
          { nodeId: '3:4', name: 'Card/Body' },
        ],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.renameNode).toHaveBeenCalledTimes(2);
    expect(deps.connector.renameNode).toHaveBeenCalledWith('1:2', 'Card/Header');
    expect(deps.connector.renameNode).toHaveBeenCalledWith('3:4', 'Card/Body');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(2);
  });

  it('reports failures without stopping the batch', async () => {
    deps.connector.renameNode
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Node not found'))
      .mockResolvedValueOnce({ success: true });

    const result = await tool.execute(
      'call1',
      {
        updates: [
          { nodeId: '1:2', name: 'Good' },
          { nodeId: 'bad:id', name: 'Missing' },
          { nodeId: '5:6', name: 'Also Good' },
        ],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.renameNode).toHaveBeenCalledTimes(3);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.total).toBe(3);
    const failedResult = parsed.results.find((r: any) => !r.success);
    expect(failedResult.error).toContain('Node not found');
  });

  it('handles empty updates array', async () => {
    const result = await tool.execute('call1', { updates: [] }, null, null, null);
    expect(deps.connector.renameNode).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.succeeded).toBe(0);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(0);
  });

  it('includes nodeId and name in each result entry', async () => {
    const result = await tool.execute(
      'call1',
      {
        updates: [{ nodeId: '1:2', name: 'Card/Title' }],
      },
      null,
      null,
      null,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results[0]).toEqual({
      nodeId: '1:2',
      name: 'Card/Title',
      success: true,
    });
  });

  it('processes updates sequentially (not in parallel)', async () => {
    const callOrder: string[] = [];
    deps.connector.renameNode.mockImplementation(async (nodeId: string) => {
      callOrder.push(nodeId);
      return { success: true };
    });

    await tool.execute(
      'call1',
      {
        updates: [
          { nodeId: '1:1', name: 'A' },
          { nodeId: '2:2', name: 'B' },
          { nodeId: '3:3', name: 'C' },
        ],
      },
      null,
      null,
      null,
    );

    expect(callOrder).toEqual(['1:1', '2:2', '3:3']);
  });
});
