import { describe, expect, it } from 'vitest';
import {
  createDisconnectedWsServer,
  createFailingConnector,
  createFailingFigmaAPI,
  createTimingOutConnector,
} from '../../helpers/mock-connector.js';

describe('createFailingConnector', () => {
  it('rejects on arbitrary async method call', async () => {
    const c = createFailingConnector();
    await expect(c.setNodeFills('id', [])).rejects.toThrow(/connector failure/);
    await expect(c.captureScreenshot('id')).rejects.toThrow(/connector failure/);
  });

  it('propagates custom error', async () => {
    const c = createFailingConnector(new Error('boom'));
    await expect(c.resizeNode('id', 1, 1)).rejects.toThrow('boom');
  });

  it('preserves sync methods (getTransportType / clearFrameCache)', () => {
    const c = createFailingConnector();
    expect(c.getTransportType()).toBe('websocket');
    expect(() => c.clearFrameCache()).not.toThrow();
  });
});

describe('createTimingOutConnector', () => {
  it('rejects with timeout error within the configured budget', async () => {
    const c = createTimingOutConnector(10);
    const start = Date.now();
    await expect(c.setNodeFills('id', [])).rejects.toThrow(/timed out/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(200);
  });

  it('embeds method name in the timeout message', async () => {
    const c = createTimingOutConnector(10);
    await expect(c.captureScreenshot('id')).rejects.toThrow(/captureScreenshot timed out/);
  });
});

describe('createDisconnectedWsServer', () => {
  it('reports disconnected predicates but server started', () => {
    const ws = createDisconnectedWsServer();
    expect(ws.isClientConnected()).toBe(false);
    expect(ws.isFileConnected()).toBe(false);
    expect(ws.isStarted()).toBe(true);
    expect(ws.getConnectedFileInfo()).toBeNull();
    expect(ws.getActiveFileKey()).toBeNull();
  });

  it('rejects sendCommand calls', async () => {
    const ws = createDisconnectedWsServer();
    await expect(ws.sendCommand('PING', {})).rejects.toThrow(/no client connected/);
  });
});

describe('createFailingFigmaAPI', () => {
  it('rejects with status 429 when configured', async () => {
    const api = createFailingFigmaAPI(429, 'rate limited');
    try {
      await api.getFile('key');
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(err.status).toBe(429);
      expect(err.message).toBe('rate limited');
    }
  });

  it('applies to every REST method', async () => {
    const api = createFailingFigmaAPI(500);
    await expect(api.getComponents('k')).rejects.toHaveProperty('status', 500);
    await expect(api.getImages('k', ['id'])).rejects.toHaveProperty('status', 500);
    await expect(api.getAllVariables('k')).rejects.toHaveProperty('status', 500);
  });
});
