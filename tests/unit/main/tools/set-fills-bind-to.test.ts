import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createManipulationTools } from '../../../../src/main/tools/manipulation.js';
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

describe('figma_set_fills with bindTo', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createManipulationTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_set_fills');
  });

  it('works without bindTo (backwards compatible)', async () => {
    const _result = await tool.execute(
      'call1',
      {
        nodeId: '1:2',
        fills: [{ type: 'SOLID', color: '#FF0000' }],
      },
      null,
      null,
      null,
    );
    expect(deps.connector.setNodeFills).toHaveBeenCalledWith('1:2', [{ type: 'SOLID', color: '#FF0000' }]);
  });

  it('calls bindVariable after setNodeFills when bindTo provided', async () => {
    const _result = await tool.execute(
      'call1',
      {
        nodeId: '1:2',
        fills: [{ type: 'SOLID', color: '#A259FF' }],
        bindTo: 'colors/primary',
      },
      null,
      null,
      null,
    );
    expect(deps.connector.setNodeFills).toHaveBeenCalled();
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/primary', 'fill');
  });
});

describe('figma_set_strokes with bindTo', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createManipulationTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_set_strokes');
  });

  it('works without bindTo (backwards compatible)', async () => {
    await tool.execute(
      'call1',
      {
        nodeId: '1:2',
        strokes: [{ type: 'SOLID', color: '#000000' }],
      },
      null,
      null,
      null,
    );
    expect(deps.connector.setNodeStrokes).toHaveBeenCalled();
    expect(deps.connector.bindVariable).not.toHaveBeenCalled();
  });

  it('calls bindVariable when bindTo provided', async () => {
    await tool.execute(
      'call1',
      {
        nodeId: '1:2',
        strokes: [{ type: 'SOLID', color: '#000000' }],
        bindTo: 'colors/border',
      },
      null,
      null,
      null,
    );
    expect(deps.connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/border', 'stroke');
  });
});
