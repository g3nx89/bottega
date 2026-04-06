import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createLayoutSizingTools } from '../../../../src/main/tools/layout-sizing.js';
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

describe('figma_set_layout_sizing', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createLayoutSizingTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_set_layout_sizing');
  });

  it('exists in the returned tools array', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('figma_set_layout_sizing');
  });

  it('fails when neither horizontal nor vertical is provided', async () => {
    const result = await tool.execute('call1', { nodeId: '1:2' }, null, null, null);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('At least one');
  });

  it('calls executeCodeViaUI when horizontal is provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, nodeId: '1:2', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED' }),
    );

    const result = await tool.execute('call1', { nodeId: '1:2', horizontal: 'FILL' }, null, null, null);
    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.layoutSizingHorizontal).toBe('FILL');
  });

  it('calls executeCodeViaUI when vertical is provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, nodeId: '1:2', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG' }),
    );

    const result = await tool.execute('call1', { nodeId: '1:2', vertical: 'HUG' }, null, null, null);
    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.layoutSizingVertical).toBe('HUG');
  });

  it('calls executeCodeViaUI when both horizontal and vertical are provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, nodeId: '1:2', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' }),
    );

    const result = await tool.execute(
      'call1',
      { nodeId: '1:2', horizontal: 'FILL', vertical: 'HUG' },
      null,
      null,
      null,
    );
    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.layoutSizingHorizontal).toBe('FILL');
    expect(parsed.layoutSizingVertical).toBe('HUG');
  });

  it('sanitizes nodeId to only digits, colons, and semicolons', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true, nodeId: '1:2' }));

    await tool.execute('call1', { nodeId: '1:2-evil<script>', horizontal: 'FIXED' }, null, null, null);

    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    // The sanitized nodeId should not contain angle brackets or dashes
    expect(code).not.toContain('<script>');
    expect(code).toContain('1:2');
  });

  it('passes 10000ms timeout to executeCodeViaUI', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true, nodeId: '1:2' }));

    await tool.execute('call1', { nodeId: '1:2', horizontal: 'FILL' }, null, null, null);

    expect(deps.connector.executeCodeViaUI).toHaveBeenCalledWith(expect.any(String), 10000);
  });

  it('handles executeCodeViaUI returning an object instead of string', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue({
      success: true,
      nodeId: '1:2',
      layoutSizingHorizontal: 'FILL',
    });

    const result = await tool.execute('call1', { nodeId: '1:2', horizontal: 'FILL' }, null, null, null);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('includes horizontal assignment in generated code when horizontal is provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));

    await tool.execute('call1', { nodeId: '1:2', horizontal: 'FILL' }, null, null, null);

    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(code).toContain('layoutSizingHorizontal');
    expect(code).toContain('FILL');
  });

  it('does not include horizontal assignment when only vertical is provided', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));

    await tool.execute('call1', { nodeId: '1:2', vertical: 'HUG' }, null, null, null);

    const code = deps.connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(code).toContain('layoutSizingVertical');
    expect(code).toContain('HUG');
    // Should NOT have an assignment for horizontal (the property check in template is fine)
    expect(code).not.toMatch(/node\.layoutSizingHorizontal\s*=/);
  });
});
