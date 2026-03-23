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
});
