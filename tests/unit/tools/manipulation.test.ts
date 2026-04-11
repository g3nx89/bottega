import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManipulationTools } from '../../../src/main/tools/manipulation.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';
import { findTool as _findTool, expectTextResult } from '../../helpers/tool-test-utils.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Manipulation Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createManipulationTools(deps);
  });

  const findTool = (name: string) => _findTool(tools, name);

  // ── figma_set_fills ────────────────────────────────────────────────

  describe('figma_set_fills', () => {
    it('calls connector.setNodeFills with nodeId and fills', async () => {
      const tool = findTool('figma_set_fills');
      const fills = [{ type: 'SOLID', color: '#FF0000' }];

      await tool.execute('c1', { nodeId: '1:2', fills }, undefined, undefined, undefined);

      expect(deps.connector.setNodeFills).toHaveBeenCalledWith('1:2', fills);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_fills');
      const data = { success: true };
      deps.connector.setNodeFills.mockResolvedValue(data);

      const result = await tool.execute('c2', { nodeId: '1:2', fills: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_strokes ──────────────────────────────────────────────

  describe('figma_set_strokes', () => {
    it('calls connector.setNodeStrokes with nodeId, strokes, and weight', async () => {
      const tool = findTool('figma_set_strokes');
      const strokes = [{ type: 'SOLID', color: '#000000' }];

      await tool.execute('c3', { nodeId: '2:3', strokes, weight: 2 }, undefined, undefined, undefined);

      expect(deps.connector.setNodeStrokes).toHaveBeenCalledWith('2:3', strokes, 2);
    });

    it('passes undefined weight when not provided', async () => {
      const tool = findTool('figma_set_strokes');
      const strokes = [{ type: 'SOLID', color: '#111111' }];

      await tool.execute('c4', { nodeId: '2:3', strokes }, undefined, undefined, undefined);

      expect(deps.connector.setNodeStrokes).toHaveBeenCalledWith('2:3', strokes, undefined);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_strokes');
      const data = { success: true };
      deps.connector.setNodeStrokes.mockResolvedValue(data);

      const result = await tool.execute('c5', { nodeId: '2:3', strokes: [] }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_text ─────────────────────────────────────────────────

  describe('figma_set_text', () => {
    it('calls connector.setTextContent with nodeId, text, and font options', async () => {
      const tool = findTool('figma_set_text');

      await tool.execute(
        'c6',
        { nodeId: '3:4', text: 'Hello', fontFamily: 'Roboto', fontSize: 16, fontWeight: 'Bold' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.setTextContent).toHaveBeenCalledWith('3:4', 'Hello', {
        fontFamily: 'Roboto',
        fontSize: 16,
        fontWeight: 'Bold',
      });
    });

    it('passes undefined font props when not provided', async () => {
      const tool = findTool('figma_set_text');

      await tool.execute('c7', { nodeId: '3:4', text: 'Hi' }, undefined, undefined, undefined);

      expect(deps.connector.setTextContent).toHaveBeenCalledWith('3:4', 'Hi', {
        fontFamily: undefined,
        fontSize: undefined,
        fontWeight: undefined,
      });
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_set_text');
      const data = { success: true };
      deps.connector.setTextContent.mockResolvedValue(data);

      const result = await tool.execute('c8', { nodeId: '3:4', text: 'X' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_set_image_fill ───────────────────────────────────────────

  describe('figma_set_image_fill', () => {
    it('prefers base64 over imageUrl (no fetch)', async () => {
      const tool = findTool('figma_set_image_fill');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await tool.execute(
        'c9',
        { nodeIds: ['5:6'], base64: 'b64data', imageUrl: 'https://img.png' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], 'b64data', 'FILL');
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('fetches imageUrl host-side and sends base64 bytes (UX-011)', async () => {
      const tool = findTool('figma_set_image_fill');
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
      const expectedB64 = Buffer.from(bytes).toString('base64');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => bytes.buffer,
      } as any);

      await tool.execute('c10', { nodeIds: ['5:6'], imageUrl: 'https://img.png' }, undefined, undefined, undefined);

      expect(fetchSpy).toHaveBeenCalledWith('https://img.png', expect.objectContaining({ signal: expect.anything() }));
      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], expectedB64, 'FILL');
      fetchSpy.mockRestore();
    });

    it('returns error when imageUrl fetch fails (UX-011)', async () => {
      const tool = findTool('figma_set_image_fill');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any);

      const result = await tool.execute(
        'c10b',
        { nodeIds: ['5:6'], imageUrl: 'https://img.png' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      const text = (result as any).content[0].text;
      expect(text).toContain('HTTP 404');
      fetchSpy.mockRestore();
    });

    it('rejects non-image content-type responses (UX-011)', async () => {
      const tool = findTool('figma_set_image_fill');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any);

      const result = await tool.execute(
        'c10c',
        { nodeIds: ['5:6'], imageUrl: 'https://not-an-image.com' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      expect((result as any).content[0].text).toContain('did not return an image');
      fetchSpy.mockRestore();
    });

    it('uses default scaleMode FILL', async () => {
      const tool = findTool('figma_set_image_fill');

      await tool.execute('c11', { nodeIds: ['5:6'], base64: 'x' }, undefined, undefined, undefined);

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], 'x', 'FILL');
    });

    it('passes custom scaleMode', async () => {
      const tool = findTool('figma_set_image_fill');

      await tool.execute('c12', { nodeIds: ['5:6'], base64: 'x', scaleMode: 'FIT' }, undefined, undefined, undefined);

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], 'x', 'FIT');
    });
  });

  // ── figma_resize ───────────────────────────────────────────────────

  describe('figma_resize', () => {
    it('calls connector.resizeNode with nodeId, width, height', async () => {
      const tool = findTool('figma_resize');

      await tool.execute('c13', { nodeId: '6:7', width: 200, height: 100 }, undefined, undefined, undefined);

      expect(deps.connector.resizeNode).toHaveBeenCalledWith('6:7', 200, 100);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_resize');
      const data = { success: true };
      deps.connector.resizeNode.mockResolvedValue(data);

      const result = await tool.execute(
        'c14',
        { nodeId: '6:7', width: 50, height: 50 },
        undefined,
        undefined,
        undefined,
      );

      expectTextResult(result, data);
    });
  });

  // ── figma_move ─────────────────────────────────────────────────────

  describe('figma_move', () => {
    it('calls connector.moveNode with nodeId, x, y', async () => {
      const tool = findTool('figma_move');

      await tool.execute('c15', { nodeId: '7:8', x: 100, y: 200 }, undefined, undefined, undefined);

      expect(deps.connector.moveNode).toHaveBeenCalledWith('7:8', 100, 200);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_move');
      const data = { success: true };
      deps.connector.moveNode.mockResolvedValue(data);

      const result = await tool.execute('c16', { nodeId: '7:8', x: 0, y: 0 }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_create_child ─────────────────────────────────────────────

  describe('figma_create_child', () => {
    it('calls connector.createChildNode with parentId, type, and props', async () => {
      const tool = findTool('figma_create_child');
      const props = { width: 100, height: 50 };

      await tool.execute('c17', { parentId: '8:9', type: 'RECTANGLE', props }, undefined, undefined, undefined);

      expect(deps.connector.createChildNode).toHaveBeenCalledWith('8:9', 'RECTANGLE', props);
    });

    it('passes undefined props when not provided', async () => {
      const tool = findTool('figma_create_child');

      await tool.execute('c18', { parentId: '8:9', type: 'FRAME' }, undefined, undefined, undefined);

      expect(deps.connector.createChildNode).toHaveBeenCalledWith('8:9', 'FRAME', undefined);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_create_child');
      const data = { success: true, nodeId: '10:1' };
      deps.connector.createChildNode.mockResolvedValue(data);

      const result = await tool.execute('c19', { parentId: '8:9', type: 'TEXT' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_clone ────────────────────────────────────────────────────

  describe('figma_clone', () => {
    it('calls connector.cloneNode with nodeId', async () => {
      const tool = findTool('figma_clone');

      await tool.execute('c20', { nodeId: '9:10' }, undefined, undefined, undefined);

      expect(deps.connector.cloneNode).toHaveBeenCalledWith('9:10');
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_clone');
      const data = { success: true, clonedId: '11:1' };
      deps.connector.cloneNode.mockResolvedValue(data);

      const result = await tool.execute('c21', { nodeId: '9:10' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_delete ───────────────────────────────────────────────────

  describe('figma_delete', () => {
    it('calls connector.deleteNode with nodeId', async () => {
      const tool = findTool('figma_delete');

      await tool.execute('c22', { nodeId: '10:11' }, undefined, undefined, undefined);

      expect(deps.connector.deleteNode).toHaveBeenCalledWith('10:11');
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_delete');
      const data = { success: true };
      deps.connector.deleteNode.mockResolvedValue(data);

      const result = await tool.execute('c23', { nodeId: '10:11' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_rename ───────────────────────────────────────────────────

  describe('figma_rename', () => {
    it('calls connector.renameNode with nodeId and name', async () => {
      const tool = findTool('figma_rename');

      await tool.execute('c24', { nodeId: '11:12', name: 'Card/Header' }, undefined, undefined, undefined);

      expect(deps.connector.renameNode).toHaveBeenCalledWith('11:12', 'Card/Header');
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_rename');
      const data = { success: true };
      deps.connector.renameNode.mockResolvedValue(data);

      const result = await tool.execute('c25', { nodeId: '11:12', name: 'New Name' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });
  });

  // ── figma_flatten_layers ─────────────────────────────────────────

  describe('figma_flatten_layers', () => {
    it('calls connector.flattenLayers with nodeId', async () => {
      const tool = findTool('figma_flatten_layers');

      await tool.execute('c26', { nodeId: '20:1' }, undefined, undefined, undefined);

      expect(deps.connector.flattenLayers).toHaveBeenCalledWith('20:1', undefined);
    });

    it('passes maxDepth when provided', async () => {
      const tool = findTool('figma_flatten_layers');

      await tool.execute('c27', { nodeId: '20:1', maxDepth: 3 }, undefined, undefined, undefined);

      expect(deps.connector.flattenLayers).toHaveBeenCalledWith('20:1', 3);
    });

    it('returns textResult format', async () => {
      const tool = findTool('figma_flatten_layers');
      const data = { nodeId: '20:1', nodeName: 'Card', collapsed: 3, visited: 12 };
      deps.connector.flattenLayers.mockResolvedValue(data);

      const result = await tool.execute('c28', { nodeId: '20:1' }, undefined, undefined, undefined);

      expectTextResult(result, data);
    });

    it('is serialized through operationQueue', async () => {
      const tool = findTool('figma_flatten_layers');
      const flattenTool2 = findTool('figma_flatten_layers');

      // Fire 2 concurrently — both should resolve (serialized by queue)
      const [r1, r2] = await Promise.all([
        tool.execute('q4', { nodeId: '1:1' }, undefined, undefined, undefined),
        flattenTool2.execute('q5', { nodeId: '2:2' }, undefined, undefined, undefined),
      ]);

      expect(r1.content[0].type).toBe('text');
      expect(r2.content[0].type).toBe('text');
    });
  });

  // ── OperationQueue serialization ──────────────────────────────────

  describe('OperationQueue serialization', () => {
    it('resolves all 3 concurrent mutation calls', async () => {
      const setFills = findTool('figma_set_fills');
      const resize = findTool('figma_resize');
      const move = findTool('figma_move');

      // Fire 3 concurrently
      const [r1, r2, r3] = await Promise.all([
        setFills.execute('q1', { nodeId: '1:1', fills: [] }, undefined, undefined, undefined),
        resize.execute('q2', { nodeId: '1:1', width: 100, height: 100 }, undefined, undefined, undefined),
        move.execute('q3', { nodeId: '1:1', x: 0, y: 0 }, undefined, undefined, undefined),
      ]);

      expect(r1.content[0].type).toBe('text');
      expect(r2.content[0].type).toBe('text');
      expect(r3.content[0].type).toBe('text');

      // All connector methods were called
      expect(deps.connector.setNodeFills).toHaveBeenCalled();
      expect(deps.connector.resizeNode).toHaveBeenCalled();
      expect(deps.connector.moveNode).toHaveBeenCalled();
    });

    it('error from one tool does not block subsequent tools', async () => {
      const setFills = findTool('figma_set_fills');
      const resize = findTool('figma_resize');
      const move = findTool('figma_move');

      // First call will fail
      deps.connector.setNodeFills.mockRejectedValueOnce(new Error('Fill error'));

      const results = await Promise.allSettled([
        setFills.execute('q4', { nodeId: '1:1', fills: [] }, undefined, undefined, undefined),
        resize.execute('q5', { nodeId: '1:1', width: 50, height: 50 }, undefined, undefined, undefined),
        move.execute('q6', { nodeId: '1:1', x: 10, y: 10 }, undefined, undefined, undefined),
      ]);

      // First should have rejected
      expect(results[0].status).toBe('rejected');
      // The others should still resolve
      expect(results[1].status).toBe('fulfilled');
      expect(results[2].status).toBe('fulfilled');
    });
  });
});
