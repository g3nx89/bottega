import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createJsxRenderTools } from '../../../../src/main/tools/jsx-render.js';
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

describe('figma_bind_variable FLOAT properties', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createJsxRenderTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_bind_variable');
  });

  it('still supports fill binding', async () => {
    await tool.execute('call1', { nodeId: '1:2', variableName: 'colors/primary', property: 'fill' }, null, null, null);
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/primary', 'fill');
  });

  it('still supports stroke binding', async () => {
    await tool.execute('call1', { nodeId: '1:2', variableName: 'colors/border', property: 'stroke' }, null, null, null);
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/border', 'stroke');
  });

  it('supports paddingTop FLOAT binding', async () => {
    await tool.execute(
      'call1',
      { nodeId: '1:2', variableName: 'spacing/md', property: 'paddingTop' },
      null,
      null,
      null,
    );
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'spacing/md', 'paddingTop');
  });

  it('supports itemSpacing FLOAT binding', async () => {
    await tool.execute(
      'call1',
      { nodeId: '1:2', variableName: 'spacing/sm', property: 'itemSpacing' },
      null,
      null,
      null,
    );
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'spacing/sm', 'itemSpacing');
  });

  it('supports cornerRadius FLOAT binding', async () => {
    await tool.execute(
      'call1',
      { nodeId: '1:2', variableName: 'radii/md', property: 'cornerRadius' },
      null,
      null,
      null,
    );
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'radii/md', 'cornerRadius');
  });

  it('supports fontSize FLOAT binding', async () => {
    await tool.execute(
      'call1',
      { nodeId: '1:2', variableName: 'type/body-size', property: 'fontSize' },
      null,
      null,
      null,
    );
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'type/body-size', 'fontSize');
  });

  it('has updated description mentioning numeric properties', () => {
    expect(tool.description).toContain('numeric');
  });

  it('accepts all FLOAT properties in enum', () => {
    // Just check the description mentions the key ones
    expect(tool.description).toContain('padding');
    expect(tool.description).toContain('fontSize');
  });
});
