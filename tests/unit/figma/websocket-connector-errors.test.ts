import { describe, expect, it, vi } from 'vitest';
import { WebSocketConnector } from '../../../src/figma/websocket-connector.js';
import { createDisconnectedWsServer } from '../../helpers/mock-connector.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('WebSocketConnector — disconnected transport', () => {
  it('initialize rejects with a user-facing message when no client is connected', async () => {
    const connector = new WebSocketConnector(createDisconnectedWsServer());
    await expect(connector.initialize()).rejects.toThrow(/Desktop Bridge plugin/);
  });

  it('propagates sendCommand rejection from downstream methods', async () => {
    const wsServer = createDisconnectedWsServer();
    const connector = new WebSocketConnector(wsServer);
    await expect(connector.executeInPluginContext('figma.root.name')).rejects.toThrow(/no client connected/);
    expect(wsServer.sendCommand).toHaveBeenCalled();
  });

  it('captureScreenshot surfaces transport failure without swallowing it', async () => {
    const wsServer = createDisconnectedWsServer();
    const connector = new WebSocketConnector(wsServer);
    await expect(connector.captureScreenshot('1:2')).rejects.toThrow(/no client connected/);
  });
});

describe('WebSocketConnector — executeCodeViaUI response shape drift', () => {
  it('returns the raw response object when the WS relay omits the `result` field', async () => {
    // Guards against a silent `undefined` return if the relay payload shape
    // changes. The unwrap rule is `raw?.result !== undefined ? raw.result : raw`.
    const wsServer = {
      sendCommand: vi.fn().mockResolvedValue({ success: true }),
      isClientConnected: vi.fn().mockReturnValue(true),
    } as any;
    const connector = new WebSocketConnector(wsServer);

    const out = await connector.executeCodeViaUI('figma.root.name', 5000);

    expect(out).toEqual({ success: true });
  });

  it('unwraps `raw.result` when present', async () => {
    const wsServer = {
      sendCommand: vi.fn().mockResolvedValue({ success: true, result: { name: 'Doc' } }),
      isClientConnected: vi.fn().mockReturnValue(true),
    } as any;
    const connector = new WebSocketConnector(wsServer);

    const out = await connector.executeCodeViaUI('figma.root.name', 5000);

    expect(out).toEqual({ name: 'Doc' });
  });

  it('preserves falsy-but-defined result values (null, 0, empty string)', async () => {
    const wsServer = {
      sendCommand: vi.fn().mockResolvedValue({ success: true, result: null }),
      isClientConnected: vi.fn().mockReturnValue(true),
    } as any;
    const connector = new WebSocketConnector(wsServer);

    const out = await connector.executeCodeViaUI('figma.root.name');

    expect(out).toBeNull();
  });
});
