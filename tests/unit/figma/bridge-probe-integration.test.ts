import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketConnector } from '../../../src/figma/websocket-connector.js';
import { FigmaWebSocketServer } from '../../../src/figma/websocket-server.js';
import { WsTestClient } from '../../helpers/ws-test-client.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/**
 * Integration tests covering the wire format between the main-side
 * WebSocketConnector and the Figma Desktop Bridge plugin for the new
 * rewind-support commands (GET_NODE_DATA, SET_LAYOUT_SIZING) plus the
 * preserveRaw flag on SET_NODE_FILLS. These round-trips go through a real
 * FigmaWebSocketServer + WsTestClient, so any drift in requestId correlation,
 * parameter shape, or response handling surfaces here.
 */
describe('Bridge probe integration', () => {
  let server: FigmaWebSocketServer;
  let client: WsTestClient;
  let connector: WebSocketConnector;
  let port: number;
  const FILE_KEY = 'test-file';

  beforeEach(async () => {
    server = new FigmaWebSocketServer({ port: 0 });
    await server.start();
    port = server.address()!.port;
    client = new WsTestClient();
    await client.connect(port, FILE_KEY, 'Test File', 2);
    connector = new WebSocketConnector(server);
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
  });

  describe('GET_NODE_DATA wire format', () => {
    it('forwards requested fields and returns the plugin payload unchanged', async () => {
      const capturedParams: unknown[] = [];
      client.onCommand('GET_NODE_DATA', (params) => {
        capturedParams.push(params);
        return {
          id: params.nodeId,
          type: 'FRAME',
          name: 'Card',
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
          strokes: [],
          position: { x: 10, y: 20 },
          size: { width: 100, height: 80 },
          layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
          constraints: { horizontal: 'LEFT', vertical: 'TOP' },
          opacity: 1,
          cornerRadius: 0,
          parent: { id: '1:0', layoutMode: 'NONE' },
          children: [],
        };
      });

      const result = await connector.getNodeData('1:2', ['fills', 'strokes', 'parent']);

      expect(capturedParams).toEqual([{ nodeId: '1:2', fields: ['fills', 'strokes', 'parent'] }]);
      expect(result).toMatchObject({
        id: '1:2',
        name: 'Card',
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        parent: { id: '1:0', layoutMode: 'NONE' },
      });
    });

    it('omits the fields param when called without one (plugin uses DEFAULT_GET_NODE_DATA_FIELDS)', async () => {
      let received: any;
      client.onCommand('GET_NODE_DATA', (params) => {
        received = params;
        return { id: params.nodeId, type: 'RECTANGLE', name: 'Box' };
      });

      await connector.getNodeData('1:5');

      expect(received).toEqual({ nodeId: '1:5' });
      expect('fields' in received).toBe(false);
    });

    it('returns an empty object when the plugin responds with null/undefined payload', async () => {
      client.onCommand('GET_NODE_DATA', () => null);
      const result = await connector.getNodeData('1:6');
      expect(result).toEqual({});
    });

    it('propagates plugin errors as rejections when the response carries an error field', async () => {
      // WsTestClient's auto-responder always wraps into {id, result}. Capture the
      // incoming command manually so we can reply with {id, error} instead.
      client.ws!.removeAllListeners('message');
      client.ws!.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'GET_NODE_DATA') {
          client.ws!.send(JSON.stringify({ id: msg.id, error: 'node not found: 1:X' }));
        }
      });

      await expect(connector.getNodeData('1:X', ['name'])).rejects.toThrow('node not found: 1:X');
    });
  });

  describe('SET_LAYOUT_SIZING wire format', () => {
    it('passes horizontal/vertical sizing modes and a 5s timeout', async () => {
      const capturedParams: unknown[] = [];
      client.onCommand('SET_LAYOUT_SIZING', (params) => {
        capturedParams.push(params);
        return { success: true };
      });

      await connector.setLayoutSizing('1:3', 'FIXED', 'HUG');

      expect(capturedParams).toEqual([{ nodeId: '1:3', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG' }]);
    });

    it('preserves explicit null values so the plugin can skip unwanted axes', async () => {
      const capturedParams: unknown[] = [];
      client.onCommand('SET_LAYOUT_SIZING', (params) => {
        capturedParams.push(params);
        return { success: true };
      });

      await connector.setLayoutSizing('1:4', null, 'FILL');

      expect(capturedParams).toEqual([{ nodeId: '1:4', layoutSizingHorizontal: null, layoutSizingVertical: 'FILL' }]);
    });
  });

  describe('SET_NODE_FILLS preserveRaw flag', () => {
    it('omits preserveRaw=false by default and threads true when requested', async () => {
      const seenCalls: Array<Record<string, unknown>> = [];
      client.onCommand('SET_NODE_FILLS', (params) => {
        seenCalls.push(params);
        return { success: true };
      });

      await connector.setNodeFills('1:10', [{ type: 'SOLID', color: '#abcdef' }]);
      await connector.setNodeFills('1:11', [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], true);

      expect(seenCalls).toEqual([
        { nodeId: '1:10', fills: [{ type: 'SOLID', color: '#abcdef' }], preserveRaw: false },
        { nodeId: '1:11', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], preserveRaw: true },
      ]);
    });
  });

  describe('Request correlation and timeouts', () => {
    it('correlates concurrent commands independently by requestId', async () => {
      // Delay responses to ensure the two commands are in-flight simultaneously.
      const pending: Array<{ id: string; params: any; resolve: () => void }> = [];
      client.ws!.removeAllListeners('message');
      client.ws!.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'GET_NODE_DATA') {
          pending.push({
            id: msg.id,
            params: msg.params,
            resolve: () =>
              client.ws!.send(
                JSON.stringify({ id: msg.id, result: { id: msg.params.nodeId, name: `Node-${msg.params.nodeId}` } }),
              ),
          });
        }
      });

      const first = connector.getNodeData('1:1', ['name']);
      const second = connector.getNodeData('1:2', ['name']);

      // Wait until both commands are queued in the test client.
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      expect(pending[0].id).not.toBe(pending[1].id);

      // Resolve in reverse order to prove out-of-order correlation works.
      pending[1].resolve();
      pending[0].resolve();

      const [a, b] = await Promise.all([first, second]);
      expect(a).toMatchObject({ name: 'Node-1:1' });
      expect(b).toMatchObject({ name: 'Node-1:2' });
    });

    it('rejects with a timeout error when the plugin never responds', async () => {
      // No handler registered → the command sits in pendingRequests until timeout.
      const promise = (
        server as unknown as {
          sendCommand: (method: string, params: any, timeoutMs: number) => Promise<any>;
        }
      ).sendCommand('GET_NODE_DATA', { nodeId: '1:X' }, 80);

      await expect(promise).rejects.toThrow(/GET_NODE_DATA timed out after 80ms/);
    });

    it('ignores responses with unknown requestIds without crashing', async () => {
      // Fire a rogue response with no matching pending request.
      client.ws!.send(JSON.stringify({ id: 'does-not-exist', result: { ignored: true } }));
      await new Promise((r) => setTimeout(r, 20));

      // Server stays healthy — subsequent real command succeeds.
      client.onCommand('GET_NODE_DATA', (params) => ({ id: params.nodeId, type: 'FRAME', name: 'Still alive' }));
      const result = await connector.getNodeData('1:7');
      expect(result).toMatchObject({ name: 'Still alive' });
    });
  });
});
