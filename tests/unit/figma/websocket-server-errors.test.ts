import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { FigmaWebSocketServer } from '../../../src/figma/websocket-server.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('FigmaWebSocketServer — high-priority error branches', () => {
  let server: FigmaWebSocketServer;

  beforeEach(async () => {
    server = new FigmaWebSocketServer({ port: 0 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('logs post-listen wss errors without rejecting the start() promise or crashing', async () => {
    // Audit row ws:174 — when the underlying wss emits 'error' AFTER the
    // listening handshake, it should be logged and swallowed, not re-thrown.
    const wss = (server as any).wss;
    expect(wss).toBeDefined();

    // Simulate an OS-level runtime error on the listening server.
    expect(() => wss.emit('error', new Error('synthetic: socket revoked'))).not.toThrow();
    expect(server.isStarted()).toBe(true);
  });

  it('sendCommand rejects when the cached client has non-OPEN readyState', async () => {
    // Audit row ws:538/544 — client exists in the map but ws is CLOSING or
    // CLOSED (e.g. Bridge tab reloading). Should not try to send.
    const fakeClient = {
      ws: { readyState: WebSocket.CLOSING, send: vi.fn() },
      fileInfo: {
        fileName: 'X',
        fileKey: 'fk-1',
        currentPage: 'Page 1',
        currentPageId: '0:1',
        pluginVersion: 2,
        connectedAt: Date.now(),
      },
      selection: null,
      documentChanges: [],
      consoleLogs: [],
      lastActivity: Date.now(),
      gracePeriodTimer: null,
    };
    (server as any).clients.set('fk-1', fakeClient);
    (server as any)._activeFileKey = 'fk-1';

    await expect(server.sendCommand('PING', {})).rejects.toThrow(/No WebSocket client connected/);
    expect(fakeClient.ws.send).not.toHaveBeenCalled();
  });

  it('sendCommand rejects and cleans up pending request when ws.send throws synchronously', async () => {
    // Audit row ws:568 — send() buffer overflow / already-closed errors must
    // reject and not leak a pending-request entry.
    const send = vi.fn(() => {
      throw new Error('synthetic: buffer overflow');
    });
    const fakeClient = {
      ws: { readyState: WebSocket.OPEN, send },
      fileInfo: {
        fileName: 'X',
        fileKey: 'fk-2',
        currentPage: 'Page 1',
        currentPageId: '0:1',
        pluginVersion: 2,
        connectedAt: Date.now(),
      },
      selection: null,
      documentChanges: [],
      consoleLogs: [],
      lastActivity: Date.now(),
      gracePeriodTimer: null,
    };
    (server as any).clients.set('fk-2', fakeClient);
    (server as any)._activeFileKey = 'fk-2';

    await expect(server.sendCommand('PING', {}, 5000)).rejects.toThrow(
      /Failed to send WebSocket command PING.*buffer overflow/,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect((server as any).pendingRequests.size).toBe(0);
  });
});
