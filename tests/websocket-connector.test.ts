import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketConnector } from '../src/figma/websocket-connector.js';

vi.mock('../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('WebSocketConnector', () => {
  let connector: WebSocketConnector;
  let mockSendCommand: ReturnType<typeof vi.fn>;
  let mockWsServer: any;

  beforeEach(() => {
    mockSendCommand = vi.fn().mockResolvedValue({ success: true });
    mockWsServer = {
      sendCommand: mockSendCommand,
      isClientConnected: vi.fn().mockReturnValue(true),
    };
    connector = new WebSocketConnector(mockWsServer);
  });

  it('executeCodeViaUI sends EXECUTE_CODE with timeout + 2000', async () => {
    await connector.executeCodeViaUI('figma.root.name', 5000);

    expect(mockSendCommand).toHaveBeenCalledWith('EXECUTE_CODE', { code: 'figma.root.name', timeout: 5000 }, 7000);
  });

  it('captureScreenshot sends CAPTURE_SCREENSHOT with 30s timeout', async () => {
    await connector.captureScreenshot('1:2', { scale: 2 });

    expect(mockSendCommand).toHaveBeenCalledWith('CAPTURE_SCREENSHOT', { nodeId: '1:2', scale: 2 }, 30000);
  });

  it('createFromJsx sends CREATE_FROM_JSX with 60s timeout', async () => {
    const tree = { type: 'FRAME', children: [] } as any;
    await connector.createFromJsx(tree, { x: 100, y: 200 });

    expect(mockSendCommand).toHaveBeenCalledWith('CREATE_FROM_JSX', { tree, x: 100, y: 200 }, 60000);
  });

  it('setImageFill sends SET_IMAGE_FILL with 60s timeout', async () => {
    await connector.setImageFill(['1:1', '2:2'], 'base64data', 'FIT');

    expect(mockSendCommand).toHaveBeenCalledWith(
      'SET_IMAGE_FILL',
      { nodeIds: ['1:1', '2:2'], imageData: 'base64data', scaleMode: 'FIT' },
      60000,
    );
  });

  it('getVariables sends EXECUTE_CODE with 32s timeout', async () => {
    await connector.getVariables('file-key-1');

    expect(mockSendCommand).toHaveBeenCalledWith(
      'EXECUTE_CODE',
      expect.objectContaining({ timeout: 30000 }),
      32000,
      'file-key-1',
    );
  });

  it('lintDesign sends LINT_DESIGN with 120s timeout', async () => {
    await connector.lintDesign('0:1', ['color', 'spacing'], 5, 100);

    expect(mockSendCommand).toHaveBeenCalledWith(
      'LINT_DESIGN',
      { nodeId: '0:1', rules: ['color', 'spacing'], maxDepth: 5, maxFindings: 100 },
      120000,
    );
  });

  it('refreshVariables sends REFRESH_VARIABLES with 300s timeout', async () => {
    await connector.refreshVariables();

    expect(mockSendCommand).toHaveBeenCalledWith('REFRESH_VARIABLES', {}, 300000);
  });

  it('error from sendCommand propagates correctly', async () => {
    mockSendCommand.mockRejectedValue(new Error('Connection lost'));

    await expect(connector.executeCodeViaUI('bad code')).rejects.toThrow('Connection lost');
  });

  // ── Edge cases: gap-filling ────────────────────────

  it('initialize() throws when no client is connected', async () => {
    // Edge case: initialize before plugin connects — should fail fast
    mockWsServer.isClientConnected.mockReturnValue(false);

    await expect(connector.initialize()).rejects.toThrow(/No WebSocket client connected/);
  });

  it('initialize() succeeds when client is connected', async () => {
    // Edge case: happy path — client is already connected
    mockWsServer.isClientConnected.mockReturnValue(true);

    await expect(connector.initialize()).resolves.toBeUndefined();
  });

  it('getTransportType returns websocket', () => {
    // Coverage: transport type accessor
    expect(connector.getTransportType()).toBe('websocket');
  });

  it('createVariable sends optional fields only when provided', async () => {
    // Edge case: optional params construction — with all options
    await connector.createVariable('primary', 'col:1', 'COLOR', {
      valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
      description: 'Primary color',
      scopes: ['ALL_SCOPES'],
    });

    expect(mockSendCommand).toHaveBeenCalledWith('CREATE_VARIABLE', {
      name: 'primary',
      collectionId: 'col:1',
      resolvedType: 'COLOR',
      valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
      description: 'Primary color',
      scopes: ['ALL_SCOPES'],
    });
  });

  it('createVariable without options omits optional fields', async () => {
    // Edge case: no options — only required fields sent
    await connector.createVariable('token', 'col:1', 'FLOAT');

    expect(mockSendCommand).toHaveBeenCalledWith('CREATE_VARIABLE', {
      name: 'token',
      collectionId: 'col:1',
      resolvedType: 'FLOAT',
    });
  });

  it('setNodeStrokes includes strokeWeight only when provided', async () => {
    // Edge case: optional strokeWeight param
    const strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }];

    await connector.setNodeStrokes('1:1', strokes, 2);
    expect(mockSendCommand).toHaveBeenCalledWith('SET_NODE_STROKES', {
      nodeId: '1:1',
      strokes,
      strokeWeight: 2,
    });

    mockSendCommand.mockClear();
    await connector.setNodeStrokes('1:1', strokes);
    expect(mockSendCommand).toHaveBeenCalledWith('SET_NODE_STROKES', {
      nodeId: '1:1',
      strokes,
    });
  });

  it('executeInPluginContext uses hardcoded 5s/7s timeouts', async () => {
    // Coverage: executeInPluginContext vs executeCodeViaUI
    await connector.executeInPluginContext('figma.root.name');

    expect(mockSendCommand).toHaveBeenCalledWith('EXECUTE_CODE', { code: 'figma.root.name', timeout: 5000 }, 7000);
  });
});
