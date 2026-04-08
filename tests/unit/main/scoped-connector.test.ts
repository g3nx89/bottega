import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopedConnector } from '../../../src/main/scoped-connector.js';

const FILE_KEY = 'abc123';

function makeMockWsServer() {
  return {
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    isClientConnected: vi.fn().mockReturnValue(true),
    isFileConnected: vi.fn().mockReturnValue(true),
  } as any;
}

describe('ScopedConnector', () => {
  let mockWsServer: ReturnType<typeof makeMockWsServer>;
  let connector: ScopedConnector;

  beforeEach(() => {
    mockWsServer = makeMockWsServer();
    connector = new ScopedConnector(mockWsServer, FILE_KEY);
  });

  // ============================================================================
  // Constructor & getter
  // ============================================================================

  it('stores fileKey and getter returns it', () => {
    expect(connector.fileKey).toBe(FILE_KEY);
  });

  it('constructor accepts different fileKeys', () => {
    const other = new ScopedConnector(mockWsServer, 'xyz789');
    expect(other.fileKey).toBe('xyz789');
  });

  // ============================================================================
  // Lifecycle
  // ============================================================================

  it('initialize() resolves when isClientConnected returns true', async () => {
    await expect(connector.initialize()).resolves.toBeUndefined();
    expect(mockWsServer.isClientConnected).toHaveBeenCalled();
  });

  it('initialize() throws when no client is connected', async () => {
    mockWsServer.isClientConnected.mockReturnValue(false);
    await expect(connector.initialize()).rejects.toThrow('No WebSocket client connected');
  });

  it('getTransportType() returns websocket', () => {
    expect(connector.getTransportType()).toBe('websocket');
  });

  // ============================================================================
  // fileKey is always passed as targetFileKey
  // ============================================================================

  it('setNodeFills passes fileKey as targetFileKey', async () => {
    const fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    await connector.setNodeFills('node1', fills);
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'SET_NODE_FILLS',
      { nodeId: 'node1', fills },
      undefined,
      FILE_KEY,
    );
  });

  it('captureScreenshot passes fileKey as targetFileKey with 45000 timeout', async () => {
    await connector.captureScreenshot('node1', { format: 'PNG', scale: 2 });
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'CAPTURE_SCREENSHOT',
      { nodeId: 'node1', format: 'PNG', scale: 2 },
      45000,
      FILE_KEY,
    );
  });

  it('executeInPluginContext passes fileKey as targetFileKey', async () => {
    await connector.executeInPluginContext('return 42;');
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'EXECUTE_CODE',
      { code: 'return 42;', timeout: 5000 },
      7000,
      FILE_KEY,
    );
  });

  it('createChildNode passes fileKey as targetFileKey', async () => {
    await connector.createChildNode('parent1', 'RECTANGLE', { width: 100 });
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'CREATE_CHILD_NODE',
      { parentId: 'parent1', nodeType: 'RECTANGLE', properties: { width: 100 } },
      undefined,
      FILE_KEY,
    );
  });

  it('instantiateComponent passes fileKey as targetFileKey', async () => {
    await connector.instantiateComponent('comp-key-abc', { parentId: 'frame1' });
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'INSTANTIATE_COMPONENT',
      { componentKey: 'comp-key-abc', parentId: 'frame1' },
      undefined,
      FILE_KEY,
    );
  });

  // ============================================================================
  // Two connectors with different fileKeys route independently
  // ============================================================================

  it('two connectors with different fileKeys route to separate targets', async () => {
    const serverA = makeMockWsServer();
    const serverB = makeMockWsServer();
    const connA = new ScopedConnector(serverA, 'fileA');
    const connB = new ScopedConnector(serverB, 'fileB');

    await connA.setNodeFills('n1', []);
    await connB.setNodeFills('n1', []);

    const [, , , targetA] = serverA.sendCommand.mock.calls[0];
    const [, , , targetB] = serverB.sendCommand.mock.calls[0];
    expect(targetA).toBe('fileA');
    expect(targetB).toBe('fileB');
  });

  // ============================================================================
  // executeCodeViaUI unwraps { success, result }
  // ============================================================================

  it('executeCodeViaUI unwraps { success, result } response', async () => {
    mockWsServer.sendCommand.mockResolvedValue({ success: true, result: { nodeId: 'n42' } });
    const out = await connector.executeCodeViaUI('someCode');
    expect(out).toEqual({ nodeId: 'n42' });
  });

  it('executeCodeViaUI returns raw response when result is absent', async () => {
    mockWsServer.sendCommand.mockResolvedValue({ success: true });
    const out = await connector.executeCodeViaUI('someCode');
    expect(out).toEqual({ success: true });
  });

  // ============================================================================
  // clearFrameCache is a no-op
  // ============================================================================

  it('clearFrameCache does not throw', () => {
    expect(() => connector.clearFrameCache()).not.toThrow();
  });

  // ============================================================================
  // Routing invariant: every command method injects fileKey
  // ============================================================================

  it('every async IFigmaConnector method routes through sendCommand with fileKey', async () => {
    const calls = [
      connector.executeInPluginContext('code'),
      connector.getVariablesFromPluginUI(),
      connector.getVariables(),
      connector.executeCodeViaUI('code'),
      connector.updateVariable('v', 'm', 1),
      connector.createVariable('n', 'c', 'COLOR'),
      connector.deleteVariable('v'),
      connector.refreshVariables(),
      connector.renameVariable('v', 'new'),
      connector.setVariableDescription('v', 'desc'),
      connector.addMode('c', 'Dark'),
      connector.renameMode('c', 'm', 'new'),
      connector.createVariableCollection('Tokens'),
      connector.deleteVariableCollection('c'),
      connector.getComponentFromPluginUI('n'),
      connector.getLocalComponents(),
      connector.setNodeDescription('n', 'desc'),
      connector.addComponentProperty('n', 'p', 'BOOLEAN', true),
      connector.editComponentProperty('n', 'p', false),
      connector.deleteComponentProperty('n', 'p'),
      connector.instantiateComponent('key'),
      connector.resizeNode('n', 100, 100),
      connector.moveNode('n', 0, 0),
      connector.setNodeFills('n', []),
      connector.setNodeStrokes('n', []),
      connector.setNodeOpacity('n', 1),
      connector.setNodeCornerRadius('n', 8),
      connector.cloneNode('n'),
      connector.deleteNode('n'),
      connector.renameNode('n', 'new'),
      connector.setTextContent('n', 'text'),
      connector.createChildNode('p', 'FRAME'),
      connector.captureScreenshot('n'),
      connector.setInstanceProperties('n', {}),
      connector.setImageFill(['n'], 'data'),
      connector.lintDesign(),
      connector.createFromJsx({ type: 'Frame', props: {}, children: [] } as any),
      connector.createIcon('<svg/>', 24, '#000'),
      connector.bindVariable('n', 'v', 'fill'),
    ];
    await Promise.allSettled(calls);

    // If any method bypasses sendCommand, this will catch it
    expect(mockWsServer.sendCommand.mock.calls.length).toBe(calls.length);
    for (const call of mockWsServer.sendCommand.mock.calls) {
      expect(call[3]).toBe(FILE_KEY);
    }
  });

  // ============================================================================
  // createFromJsx passes tree and opts correctly
  // ============================================================================

  it('createFromJsx passes tree and opts to sendCommand', async () => {
    mockWsServer.sendCommand.mockResolvedValue({ nodeId: 'new1', childIds: ['c1', 'c2'] });
    const tree = { type: 'Frame', props: {}, children: [] } as any;
    const opts = { x: 10, y: 20, parentId: 'frame99' };
    const result = await connector.createFromJsx(tree, opts);

    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'CREATE_FROM_JSX',
      { tree, x: 10, y: 20, parentId: 'frame99' },
      60000,
      FILE_KEY,
    );
    expect(result).toEqual({ nodeId: 'new1', childIds: ['c1', 'c2'] });
  });

  // ============================================================================
  // setImageFill uses 30s timeout (was 60s — reduced for UX-005 / P-006)
  // ============================================================================

  it('setImageFill passes correct params with 30000 timeout', async () => {
    await connector.setImageFill(['n1', 'n2'], 'base64data==', 'FIT');
    expect(mockWsServer.sendCommand).toHaveBeenCalledWith(
      'SET_IMAGE_FILL',
      { nodeIds: ['n1', 'n2'], imageData: 'base64data==', scaleMode: 'FIT' },
      30000,
      FILE_KEY,
    );
  });

  it('setImageFill defaults scaleMode to FILL', async () => {
    await connector.setImageFill(['n1'], 'imgdata');
    const [, params] = mockWsServer.sendCommand.mock.calls[0];
    expect(params.scaleMode).toBe('FILL');
  });

  // ============================================================================
  // Pattern 1 fail-fast precheck (P-006 / B-008 / B-018 family)
  // ============================================================================

  describe('fail-fast precheck when Bridge is not connected', () => {
    it('throws immediately on sendCommand when isFileConnected returns false', async () => {
      mockWsServer.isFileConnected.mockReturnValue(false);
      await expect(connector.setNodeFills('node1', [])).rejects.toThrow(/Bridge not connected/);
      expect(mockWsServer.sendCommand).not.toHaveBeenCalled();
    });

    it('blocks createFromJsx before sendCommand (would otherwise wait 60s)', async () => {
      mockWsServer.isFileConnected.mockReturnValue(false);
      await expect(connector.createFromJsx({ type: 'Frame', props: {}, children: [] } as any)).rejects.toThrow(
        /Bridge not connected/,
      );
      expect(mockWsServer.sendCommand).not.toHaveBeenCalled();
    });

    it('blocks lintDesign without waiting the 120s timeout', async () => {
      mockWsServer.isFileConnected.mockReturnValue(false);
      await expect(connector.lintDesign()).rejects.toThrow(/Bridge not connected/);
      expect(mockWsServer.sendCommand).not.toHaveBeenCalled();
    });

    it('checks isFileConnected with the slot fileKey', async () => {
      mockWsServer.isFileConnected.mockReturnValue(false);
      await connector.setNodeFills('n', []).catch(() => {});
      expect(mockWsServer.isFileConnected).toHaveBeenCalledWith(FILE_KEY);
    });

    it('passes through when isFileConnected returns true', async () => {
      mockWsServer.isFileConnected.mockReturnValue(true);
      await expect(connector.setNodeFills('n', [])).resolves.toBeDefined();
      expect(mockWsServer.sendCommand).toHaveBeenCalled();
    });
  });
});
