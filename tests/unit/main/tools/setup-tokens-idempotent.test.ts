import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
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

describe('figma_setup_tokens idempotent', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createTokenTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_setup_tokens');
  });

  it('creates new collection when none exists', async () => {
    deps.connector.getVariables.mockResolvedValue({ collections: [] });
    deps.connector.createVariableCollection.mockResolvedValue({ id: 'col1', defaultModeId: 'mode0' });
    deps.connector.createVariable.mockResolvedValue({ id: 'var1' });

    const result = await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [{ name: 'colors/primary', type: 'COLOR', values: { Light: { r: 0.65, g: 0.35, b: 1 } } }],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.createVariableCollection).toHaveBeenCalledWith('Tokens');
    expect(JSON.parse(result.content[0].text)).toHaveProperty('collectionId', 'col1');
  });

  it('updates existing collection when found', async () => {
    deps.connector.getVariables.mockResolvedValue({
      collections: [{ id: 'existing-col', name: 'Tokens', modes: [{ modeId: 'mode1', name: 'Light' }], variables: [] }],
    });
    deps.connector.createVariable.mockResolvedValue({ id: 'var1' });

    const result = await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [{ name: 'colors/primary', type: 'COLOR', values: { Light: { r: 0.65, g: 0.35, b: 1 } } }],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.createVariableCollection).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toHaveProperty('collectionId', 'existing-col');
  });

  it('updates existing variable instead of creating duplicate', async () => {
    deps.connector.getVariables.mockResolvedValue({
      collections: [
        {
          id: 'col1',
          name: 'Tokens',
          modes: [{ modeId: 'mode1', name: 'Light' }],
          variables: [{ id: 'var-existing', name: 'colors/primary', resolvedType: 'COLOR' }],
        },
      ],
    });

    await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [{ name: 'colors/primary', type: 'COLOR', values: { Light: { r: 1, g: 0, b: 0 } } }],
      },
      null,
      null,
      null,
    );

    // Should update existing, not create new
    expect(deps.connector.createVariable).not.toHaveBeenCalled();
    expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-existing', 'mode1', { r: 1, g: 0, b: 0 });
  });

  it('creates new variables that dont exist yet', async () => {
    deps.connector.getVariables.mockResolvedValue({
      collections: [
        {
          id: 'col1',
          name: 'Tokens',
          modes: [{ modeId: 'mode1', name: 'Light' }],
          variables: [],
        },
      ],
    });
    deps.connector.createVariable.mockResolvedValue({ id: 'new-var' });

    await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [{ name: 'colors/primary', type: 'COLOR', values: { Light: { r: 0.65, g: 0.35, b: 1 } } }],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.createVariable).toHaveBeenCalled();
  });

  it('adds new modes to existing collection', async () => {
    deps.connector.getVariables.mockResolvedValue({
      collections: [
        {
          id: 'col1',
          name: 'Tokens',
          modes: [{ modeId: 'mode1', name: 'Light' }],
          variables: [],
        },
      ],
    });
    deps.connector.addMode.mockResolvedValue({ modeId: 'mode2' });
    deps.connector.createVariable.mockResolvedValue({ id: 'var1' });

    await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light', 'Dark'],
        variables: [
          {
            name: 'colors/primary',
            type: 'COLOR',
            values: { Light: { r: 0.65, g: 0.35, b: 1 }, Dark: { r: 0.8, g: 0.5, b: 1 } },
          },
        ],
      },
      null,
      null,
      null,
    );

    // Should only add Dark mode (Light already exists)
    expect(deps.connector.addMode).toHaveBeenCalledWith('col1', 'Dark');
    expect(deps.connector.renameMode).not.toHaveBeenCalled();
  });
});
