import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createDsPageTools } from '../../../../src/main/tools/ds-page.js';
import { createMockConnector } from '../../../helpers/mock-connector.js';

// Create ToolDeps-compatible mock
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

describe('figma_update_ds_page', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createDsPageTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_update_ds_page');
  });

  it('should be registered as a tool', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('figma_update_ds_page');
  });

  it('should have required parameters', () => {
    expect(tool.parameters).toBeDefined();
  });

  it('should execute via operationQueue', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true, sectionId: '123:45' }));
    const result = await tool.execute(
      'call1',
      { section: 'colors', action: 'create', text: 'Primary: #A259FF' },
      null,
      null,
      null,
    );
    expect(result.content[0].text).toContain('success');
  });

  it('should support all section types', () => {
    // The tool description should mention the valid sections
    expect(tool.description).toContain('colors');
    expect(tool.description).toContain('typography');
  });

  it('should support create/update/append actions', async () => {
    deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ success: true }));
    for (const action of ['create', 'update', 'append']) {
      const result = await tool.execute('call1', { section: 'colors', action, text: 'test' }, null, null, null);
      expect(result.content[0].text).toContain('success');
    }
  });
});
