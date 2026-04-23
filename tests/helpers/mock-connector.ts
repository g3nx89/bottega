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
    'setLayoutSizing',
    'setNodeStrokes',
    'setNodeOpacity',
    'setNodeCornerRadius',
    'cloneNode',
    'deleteNode',
    'renameNode',
    'flattenLayers',
    'setTextContent',
    'createChildNode',
    'getNodeData',
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
    getMe: vi.fn().mockResolvedValue({ id: 'user-1', handle: 'mock-user' }),
    getFileVersions: vi.fn().mockResolvedValue({ versions: [] }),
    getDevResources: vi.fn().mockResolvedValue({ dev_resources: [] }),
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
 * IFigmaConnector mock that rejects every async call with a descriptive error.
 * Use for testing error-path branches — connector methods that surface transport
 * failures, timeouts, or WS disconnect.
 */
export function createFailingConnector(defaultError: Error = new Error('mock: connector failure')) {
  const mock = createMockConnector();
  for (const key of Object.keys(mock)) {
    if (typeof mock[key] !== 'function') continue;
    if (key === 'getTransportType' || key === 'clearFrameCache') continue;
    mock[key] = vi.fn().mockRejectedValue(defaultError);
  }
  return mock;
}

/**
 * IFigmaConnector mock that simulates WS timeout — async methods return a
 * promise that rejects after `timeoutMs` with a timeout error. Mirrors real
 * `ws: command timed out` behavior.
 */
export function createTimingOutConnector(timeoutMs = 50) {
  const mock = createMockConnector();
  for (const key of Object.keys(mock)) {
    if (typeof mock[key] !== 'function') continue;
    if (key === 'getTransportType' || key === 'clearFrameCache') continue;
    mock[key] = vi
      .fn()
      .mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error(`mock: ${key} timed out`)), timeoutMs)),
      );
  }
  return mock;
}

/**
 * WebSocket server mock with every connection predicate returning false and
 * sendCommand rejecting. Simulates "plugin not loaded" or "Figma closed" state.
 */
export function createDisconnectedWsServer() {
  return {
    sendCommand: vi.fn().mockRejectedValue(new Error('mock: no client connected')),
    isClientConnected: vi.fn().mockReturnValue(false),
    isFileConnected: vi.fn().mockReturnValue(false),
    isStarted: vi.fn().mockReturnValue(true),
    getConnectedFileInfo: vi.fn().mockReturnValue(null),
    getConnectedFiles: vi.fn().mockReturnValue([]),
    getCurrentSelection: vi.fn().mockReturnValue({ nodes: [], count: 0 }),
    getActiveFileKey: vi.fn().mockReturnValue(null),
    address: vi.fn().mockReturnValue({ port: 9280 }),
    on: vi.fn(),
    emit: vi.fn(),
  } as any;
}

/**
 * FigmaAPI mock whose methods reject with an Error carrying a `.status` field
 * that mimics fetch response status codes (401/429/500/etc).
 */
export function createFailingFigmaAPI(status = 500, body = 'mock: API failure') {
  const err = Object.assign(new Error(body), { status });
  return {
    getFile: vi.fn().mockRejectedValue(err),
    getComponents: vi.fn().mockRejectedValue(err),
    getComponentSets: vi.fn().mockRejectedValue(err),
    searchComponents: vi.fn().mockRejectedValue(err),
    getLocalVariables: vi.fn().mockRejectedValue(err),
    getPublishedVariables: vi.fn().mockRejectedValue(err),
    getAllVariables: vi.fn().mockRejectedValue(err),
    getNodes: vi.fn().mockRejectedValue(err),
    getStyles: vi.fn().mockRejectedValue(err),
    getImages: vi.fn().mockRejectedValue(err),
    getComponentData: vi.fn().mockRejectedValue(err),
    getMe: vi.fn().mockRejectedValue(err),
    getFileVersions: vi.fn().mockRejectedValue(err),
    getDevResources: vi.fn().mockRejectedValue(err),
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
