import { vi } from 'vitest';
import { OperationQueue } from '../../src/main/operation-queue.js';

/**
 * Creates a mock IFigmaConnector with every method as a vi.fn().
 * Default return: { success: true }
 */
export function createMockConnector() {
  const methods = [
    'initialize',
    'getTransportType',
    'executeInPluginContext',
    'getVariablesFromPluginUI',
    'getVariables',
    'executeCodeViaUI',
    'updateVariable',
    'createVariable',
    'deleteVariable',
    'refreshVariables',
    'renameVariable',
    'setVariableDescription',
    'addMode',
    'renameMode',
    'createVariableCollection',
    'deleteVariableCollection',
    'getComponentFromPluginUI',
    'getLocalComponents',
    'setNodeDescription',
    'addComponentProperty',
    'editComponentProperty',
    'deleteComponentProperty',
    'instantiateComponent',
    'resizeNode',
    'moveNode',
    'setNodeFills',
    'setNodeStrokes',
    'setNodeOpacity',
    'setNodeCornerRadius',
    'cloneNode',
    'deleteNode',
    'renameNode',
    'flattenLayers',
    'setTextContent',
    'createChildNode',
    'captureScreenshot',
    'setInstanceProperties',
    'setImageFill',
    'lintDesign',
    'clearFrameCache',
    'createFromJsx',
    'createIcon',
    'bindVariable',
    'deepGetComponent',
    'analyzeComponentSet',
    'getAnnotations',
    'setAnnotations',
    'getAnnotationCategories',
    'batchSetText',
    'batchSetFills',
    'batchTransform',
    'scanTextNodes',
    'setAutoLayout',
    'setVariant',
    'setTextStyle',
    'setEffects',
    'setOpacity',
    'setCornerRadius',
  ] as const;

  const mock: Record<string, any> = {};
  for (const method of methods) {
    if (method === 'getTransportType') {
      mock[method] = vi.fn().mockReturnValue('websocket');
    } else if (method === 'clearFrameCache') {
      mock[method] = vi.fn();
    } else {
      mock[method] = vi.fn().mockResolvedValue({ success: true });
    }
  }
  return mock as any;
}

/**
 * Creates a mock FigmaWebSocketServer for tools that read from wsServer directly
 * (figma_status, figma_get_selection).
 */
export function createMockWsServer() {
  return {
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    isClientConnected: vi.fn().mockReturnValue(true),
    isFileConnected: vi.fn().mockReturnValue(true),
    isStarted: vi.fn().mockReturnValue(true),
    getConnectedFileInfo: vi.fn().mockReturnValue({
      fileKey: 'abc123',
      fileName: 'Test.fig',
      connectedAt: Date.now(),
    }),
    getConnectedFiles: vi.fn().mockReturnValue([]),
    getCurrentSelection: vi.fn().mockReturnValue({ nodes: [], count: 0 }),
    getActiveFileKey: vi.fn().mockReturnValue('abc123'),
    address: vi.fn().mockReturnValue({ port: 9280 }),
    on: vi.fn(),
    emit: vi.fn(),
  } as any;
}

/**
 * Creates a mock FigmaAPI for discovery tools that use REST API.
 */
export function createMockFigmaAPI() {
  return {
    getFile: vi.fn().mockResolvedValue({}),
    getComponents: vi.fn().mockResolvedValue({ meta: { components: [] } }),
    getComponentSets: vi.fn().mockResolvedValue({ meta: { component_sets: [] } }),
    searchComponents: vi.fn().mockResolvedValue([]),
    getLocalVariables: vi.fn().mockResolvedValue({}),
    getPublishedVariables: vi.fn().mockResolvedValue({}),
    getAllVariables: vi.fn().mockResolvedValue({ local: {}, published: {} }),
    getNodes: vi.fn().mockResolvedValue({}),
    getStyles: vi.fn().mockResolvedValue({}),
    getImages: vi.fn().mockResolvedValue({ images: {} }),
    getComponentData: vi.fn().mockResolvedValue({}),
  } as any;
}

/**
 * Creates a mock DesignSystemCache.
 */
export function createMockDesignSystemCache() {
  let cachedData: any = null;
  return {
    get: vi.fn((compact?: boolean) => (cachedData ? (compact ? cachedData.compact : cachedData.raw) : null)),
    set: vi.fn((raw: any) => {
      cachedData = { raw, compact: { summary: 'compacted' } };
      return cachedData;
    }),
    invalidate: vi.fn(() => {
      cachedData = null;
    }),
  } as any;
}

/**
 * Creates a mock CompressionConfigManager.
 */
export function createMockConfigManager() {
  return {
    getActiveConfig: vi.fn().mockReturnValue({
      defaultSemanticMode: 'full' as const,
      compactDesignSystem: false,
      designSystemCacheTtlMs: 60000,
      outputFormat: 'json' as const,
    }),
    getActiveProfile: vi.fn().mockReturnValue('balanced'),
    getProfiles: vi.fn().mockReturnValue([]),
    setProfile: vi.fn(),
  } as any;
}

/**
 * Assembles a complete ToolDeps with real OperationQueue and mock everything else.
 */
export function createTestToolDeps(overrides?: Record<string, any>) {
  return {
    connector: createMockConnector(),
    figmaAPI: createMockFigmaAPI(),
    operationQueue: new OperationQueue(),
    wsServer: createMockWsServer(),
    designSystemCache: createMockDesignSystemCache(),
    configManager: createMockConfigManager(),
    ...overrides,
  } as any;
}
