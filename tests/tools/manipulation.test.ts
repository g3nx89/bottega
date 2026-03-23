import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManipulationTools } from '../../src/main/tools/manipulation.js';
import { createTestToolDeps } from '../helpers/mock-connector.js';

// Mock logger
vi.mock('../../src/figma/logger.js', () => ({
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

  const findTool = (name: string) => tools.find((t) => t.name === name);

  const expectTextResult = (result: any, data: unknown) => {
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(data) }],
      details: {},
    });
  };

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
    it('prefers base64 over imageUrl', async () => {
      const tool = findTool('figma_set_image_fill');

      await tool.execute(
        'c9',
        { nodeIds: ['5:6'], base64: 'b64data', imageUrl: 'https://img.png' },
        undefined,
        undefined,
        undefined,
      );

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], 'b64data', 'FILL');
    });

    it('falls back to imageUrl when base64 is absent', async () => {
      const tool = findTool('figma_set_image_fill');

      await tool.execute('c10', { nodeIds: ['5:6'], imageUrl: 'https://img.png' }, undefined, undefined, undefined);

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['5:6'], 'https://img.png', 'FILL');
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
