import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigmaWebSocketServer } from '../src/figma/websocket-server.js';
import { WsTestClient } from './helpers/ws-test-client.js';

// Mock logger to suppress output
vi.mock('../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('FigmaWebSocketServer', () => {
  let server: FigmaWebSocketServer;
  let client: WsTestClient;
  let port: number;

  beforeEach(async () => {
    server = new FigmaWebSocketServer({ port: 0 });
    await server.start();
    port = server.address()!.port;
    client = new WsTestClient();
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
  });

  // ==========================================================================
  // Connection lifecycle
  // ==========================================================================

  describe('connection lifecycle', () => {
    it('starts and accepts connections', () => {
      expect(server.isStarted()).toBe(true);
      expect(server.address()).not.toBeNull();
      expect(server.address()!.port).toBeGreaterThan(0);
    });

    it('FILE_INFO promotes pending client to named client', async () => {
      expect(server.isClientConnected()).toBe(false);

      await client.connect(port, 'abc123', 'Test File');

      expect(server.isClientConnected()).toBe(true);
      const info = server.getConnectedFileInfo();
      expect(info).not.toBeNull();
      expect(info!.fileKey).toBe('abc123');
      expect(info!.fileName).toBe('Test File');
      expect(info!.currentPage).toBe('Page 1');
    });

    it('client disconnect makes isClientConnected false after grace period', async () => {
      await client.connect(port, 'abc123', 'Test File');
      expect(server.isClientConnected()).toBe(true);

      await client.close();

      // Still connected during the 5s grace period (ws is closed but entry remains)
      // After grace period fires, the entry is removed
      await new Promise((r) => setTimeout(r, 100));
      // The ws is closed so isClientConnected checks readyState
      expect(server.isClientConnected()).toBe(false);
    });

    it('client reconnect within grace period preserves state', async () => {
      await client.connect(port, 'abc123', 'Test File');

      // Send a document change to create some state
      client.sendEvent('DOCUMENT_CHANGE', {
        hasStyleChanges: false,
        hasNodeChanges: true,
        changedNodeIds: ['1:2'],
        changeCount: 1,
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const changesBefore = server.getDocumentChanges();
      expect(changesBefore.length).toBe(1);

      // Disconnect
      await client.close();
      await new Promise((r) => setTimeout(r, 100));

      // Reconnect quickly (within 5s grace period) with same fileKey
      const client2 = new WsTestClient();
      await client2.connect(port, 'abc123', 'Test File');

      // State should be preserved (document changes carried over)
      const changesAfter = server.getDocumentChanges();
      expect(changesAfter.length).toBe(1);
      expect(changesAfter[0].changedNodeIds).toEqual(['1:2']);

      await client2.close();
    });
  });

  // ==========================================================================
  // Pending client timeout
  // ==========================================================================

  describe('pending client timeout', () => {
    it('pending client times out after 30s without FILE_INFO', async () => {
      // Connect raw WebSocket without sending FILE_INFO
      const { WebSocket: WS } = await import('ws');
      const rawWs = new WS(`ws://localhost:${port}`);

      await new Promise<void>((resolve, reject) => {
        rawWs.on('open', () => resolve());
        rawWs.on('error', reject);
      });

      // Should not be a named client
      expect(server.isClientConnected()).toBe(false);

      // Wait for the close event from the server-side timeout.
      // The server uses a 30s timeout, but we can verify the mechanism
      // by waiting for the close event with a generous test timeout.
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        rawWs.on('close', (code, reason) => {
          resolve({ code, reason: reason?.toString() || '' });
        });
      });

      // Use the real 30s timeout — vitest testTimeout is 10s by default,
      // so we set a per-test timeout of 35s
      const result = await closePromise;
      expect(result.code).toBe(1000);
      expect(result.reason).toContain('timeout');

      // Clean up
      if (rawWs.readyState !== WS.CLOSED) {
        rawWs.terminate();
      }
    }, 35000);
  });

  // ==========================================================================
  // Command routing
  // ==========================================================================

  describe('command routing', () => {
    it('sendCommand resolves when client responds', async () => {
      await client.connect(port, 'abc123', 'Test File');
      client.onCommand('EXECUTE_CODE', (params) => ({ success: true, data: params.code }));

      const result = await server.sendCommand('EXECUTE_CODE', { code: 'figma.root.name' });
      expect(result).toEqual({ success: true, data: 'figma.root.name' });
    });

    it('sendCommand rejects on timeout', async () => {
      await client.connect(port, 'abc123', 'Test File');
      // Don't register a handler so the command will never get a response

      await expect(server.sendCommand('SLOW_CMD', {}, 100)).rejects.toThrow(/timed out/);
    });

    it('sendCommand rejects when no client is connected', async () => {
      // No client connected at all
      await expect(server.sendCommand('EXECUTE_CODE', { code: '1+1' })).rejects.toThrow(/No active file connected/);
    });
  });

  // ==========================================================================
  // Multi-file and active file tracking
  // ==========================================================================

  describe('multi-file tracking', () => {
    let client2: WsTestClient;

    afterEach(async () => {
      if (client2) await client2.close();
    });

    it('two clients with different fileKeys are both tracked, last is active', async () => {
      await client.connect(port, 'file-A', 'File A');
      client2 = new WsTestClient();
      await client2.connect(port, 'file-B', 'File B');

      const files = server.getConnectedFiles();
      expect(files.length).toBe(2);

      const fileKeys = files.map((f) => f.fileKey);
      expect(fileKeys).toContain('file-A');
      expect(fileKeys).toContain('file-B');

      // Last connected is active
      expect(server.getActiveFileKey()).toBe('file-B');
    });

    it('SELECTION_CHANGE switches active file', async () => {
      await client.connect(port, 'file-A', 'File A');
      client2 = new WsTestClient();
      await client2.connect(port, 'file-B', 'File B');

      expect(server.getActiveFileKey()).toBe('file-B');

      // Selection change from file-A
      client.sendEvent('SELECTION_CHANGE', {
        nodes: [{ id: '1:1', name: 'Rect', type: 'RECTANGLE' }],
        count: 1,
        page: 'Page 1',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(server.getActiveFileKey()).toBe('file-A');
    });

    it('PAGE_CHANGE switches active file and updates page info', async () => {
      await client.connect(port, 'file-A', 'File A');
      client2 = new WsTestClient();
      await client2.connect(port, 'file-B', 'File B');

      expect(server.getActiveFileKey()).toBe('file-B');

      // Page change from file-A
      client.sendEvent('PAGE_CHANGE', {
        pageName: 'Page 2',
        pageId: 'page:2',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(server.getActiveFileKey()).toBe('file-A');
      const info = server.getConnectedFileInfo();
      expect(info!.currentPage).toBe('Page 2');
      expect(info!.currentPageId).toBe('page:2');
    });

    it('setActiveFile switches active file explicitly', async () => {
      await client.connect(port, 'file-A', 'File A');
      client2 = new WsTestClient();
      await client2.connect(port, 'file-B', 'File B');

      expect(server.getActiveFileKey()).toBe('file-B');

      const switched = server.setActiveFile('file-A');
      expect(switched).toBe(true);
      expect(server.getActiveFileKey()).toBe('file-A');
    });

    it('getConnectedFiles lists all connected files with isActive flag', async () => {
      await client.connect(port, 'file-A', 'File A');
      client2 = new WsTestClient();
      await client2.connect(port, 'file-B', 'File B');

      server.setActiveFile('file-A');

      const files = server.getConnectedFiles();
      const fileA = files.find((f) => f.fileKey === 'file-A');
      const fileB = files.find((f) => f.fileKey === 'file-B');

      expect(fileA!.isActive).toBe(true);
      expect(fileB!.isActive).toBe(false);
    });
  });

  // ==========================================================================
  // Events and buffers
  // ==========================================================================

  describe('events and buffers', () => {
    it('DOCUMENT_CHANGE is buffered per file', async () => {
      await client.connect(port, 'abc123', 'Test File');

      client.sendEvent('DOCUMENT_CHANGE', {
        hasStyleChanges: true,
        hasNodeChanges: false,
        changedNodeIds: ['3:4'],
        changeCount: 2,
        timestamp: 1000,
      });
      await new Promise((r) => setTimeout(r, 50));

      const changes = server.getDocumentChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].hasStyleChanges).toBe(true);
      expect(changes[0].changedNodeIds).toEqual(['3:4']);
    });

    it('CONSOLE_CAPTURE is buffered per file', async () => {
      await client.connect(port, 'abc123', 'Test File');

      client.sendEvent('CONSOLE_CAPTURE', {
        timestamp: Date.now(),
        level: 'warn',
        message: 'test warning',
        args: [],
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = server.getConsoleLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toBe('test warning');
      expect(logs[0].source).toBe('plugin');
    });

    it('console buffer overflow caps at 1000 entries', async () => {
      await client.connect(port, 'abc123', 'Test File');

      // Send 1001 console entries
      for (let i = 0; i < 1001; i++) {
        client.sendEvent('CONSOLE_CAPTURE', {
          timestamp: i,
          level: 'log',
          message: `msg-${i}`,
          args: [],
        });
      }
      await new Promise((r) => setTimeout(r, 200));

      const logs = server.getConsoleLogs();
      expect(logs.length).toBe(1000);
      // First entry should have been shifted out; oldest kept is msg-1
      expect(logs[0].message).toBe('msg-1');
      expect(logs[999].message).toBe('msg-1000');
    });

    it('document change buffer overflow caps at 200', async () => {
      await client.connect(port, 'abc123', 'Test File');

      for (let i = 0; i < 201; i++) {
        client.sendEvent('DOCUMENT_CHANGE', {
          hasStyleChanges: false,
          hasNodeChanges: true,
          changedNodeIds: [`${i}:0`],
          changeCount: 1,
          timestamp: i,
        });
      }
      await new Promise((r) => setTimeout(r, 200));

      const changes = server.getDocumentChanges();
      expect(changes.length).toBe(200);
      // The first entry (timestamp 0) should have been shifted out
      expect(changes[0].timestamp).toBe(1);
      expect(changes[199].timestamp).toBe(200);
    });
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('stop() cleans up all clients and rejects pending requests', async () => {
      await client.connect(port, 'abc123', 'Test File');
      // Don't register handler — command will be pending
      const pendingPromise = server.sendCommand('SLOW_CMD', {}, 30000);

      await server.stop();

      await expect(pendingPromise).rejects.toThrow(/shutting down/);
      expect(server.isStarted()).toBe(false);
    });
  });
});
