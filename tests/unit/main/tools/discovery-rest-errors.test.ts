import { beforeEach, describe, expect, it } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createDiscoveryTools } from '../../../../src/main/tools/discovery.js';
import {
  createFailingFigmaAPI,
  createMockConfigManager,
  createMockConnector,
  createMockDesignSystemCache,
  createMockWsServer,
} from '../../../helpers/mock-connector.js';

function depsWithFailingApi(status: number, body = 'mock: API failure') {
  return {
    connector: createMockConnector(),
    figmaAPI: createFailingFigmaAPI(status, body),
    operationQueue: new OperationQueue(),
    wsServer: createMockWsServer(),
    designSystemCache: createMockDesignSystemCache(),
    configManager: createMockConfigManager(),
    fileKey: 'test',
  } as any;
}

function findTool(deps: any, name: string): any {
  const tool = createDiscoveryTools(deps).find((t: any) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('discovery tools — REST error propagation', () => {
  describe('figma_search_components (library path)', () => {
    let tool: any;
    beforeEach(() => {
      tool = findTool(depsWithFailingApi(500), 'figma_search_components');
    });

    it('rejects with the API error (500) when searching a library', async () => {
      await expect(
        tool.execute('call-1', { query: 'Button', libraryFileKey: 'lib-1' }, undefined, undefined, undefined),
      ).rejects.toMatchObject({ status: 500 });
    });

    it('surfaces 401 (unauthorized token) unchanged to the caller', async () => {
      const t = findTool(depsWithFailingApi(401, 'Invalid token'), 'figma_search_components');
      await expect(
        t.execute('call-1', { query: 'x', libraryFileKey: 'lib-1' }, undefined, undefined, undefined),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid token' });
    });
  });

  describe('figma_get_library_components', () => {
    it('rejects when either getComponents or getComponentSets rejects', async () => {
      const tool = findTool(depsWithFailingApi(500), 'figma_get_library_components');
      await expect(tool.execute('call-1', { fileKey: 'lib-1' }, undefined, undefined, undefined)).rejects.toMatchObject(
        { status: 500 },
      );
    });

    it('surfaces 429 (rate-limited) without retry inside the tool layer', async () => {
      const tool = findTool(depsWithFailingApi(429, 'Too many requests'), 'figma_get_library_components');
      await expect(tool.execute('call-1', { fileKey: 'lib-1' }, undefined, undefined, undefined)).rejects.toMatchObject(
        { status: 429 },
      );
    });
  });

  describe('figma_search_components (local path is unaffected)', () => {
    it('does not hit figmaAPI when libraryFileKey is omitted', async () => {
      const deps = depsWithFailingApi(500);
      deps.connector.getLocalComponents.mockResolvedValue([{ name: 'ButtonPrimary' }, { name: 'Card' }]);
      const tool = findTool(deps, 'figma_search_components');

      const res = await tool.execute('call-1', { query: 'button' }, undefined, undefined, undefined);

      expect((res.content[0] as any).text).toContain('ButtonPrimary');
      expect(deps.figmaAPI.searchComponents).not.toHaveBeenCalled();
    });
  });
});
