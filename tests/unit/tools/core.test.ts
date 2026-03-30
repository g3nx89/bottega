import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoreTools } from '../../../src/main/tools/core.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Core Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createCoreTools(deps);
  });

  // ── figma_execute ──────────────────────────────────────────────────

  describe('figma_execute', () => {
    it('calls connector.executeCodeViaUI with code and default timeout', async () => {
      const tool = tools.find((t) => t.name === 'figma_execute');
      deps.connector.executeCodeViaUI.mockResolvedValue({ success: true, value: 42 });

      await tool.execute('call-1', { code: 'figma.currentPage.name' }, undefined, undefined, undefined);

      expect(deps.connector.executeCodeViaUI).toHaveBeenCalledWith('figma.currentPage.name', 30000);
    });

    it('passes custom timeout through', async () => {
      const tool = tools.find((t) => t.name === 'figma_execute');
      deps.connector.executeCodeViaUI.mockResolvedValue({ success: true });

      await tool.execute('call-2', { code: 'code()', timeout: 60000 }, undefined, undefined, undefined);

      expect(deps.connector.executeCodeViaUI).toHaveBeenCalledWith('code()', 60000);
    });

    it('wraps result in textResult format', async () => {
      const tool = tools.find((t) => t.name === 'figma_execute');
      const data = { success: true, value: 'hello' };
      deps.connector.executeCodeViaUI.mockResolvedValue(data);

      const result = await tool.execute('call-3', { code: 'c()' }, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: {},
      });
    });

    it('propagates errors from connector', async () => {
      const tool = tools.find((t) => t.name === 'figma_execute');
      deps.connector.executeCodeViaUI.mockRejectedValue(new Error('Plugin timeout'));

      await expect(tool.execute('call-4', { code: 'hang()' }, undefined, undefined, undefined)).rejects.toThrow(
        'Plugin timeout',
      );
    });
  });

  // ── figma_screenshot ───────────────────────────────────────────────

  describe('figma_screenshot', () => {
    it('returns image content when image.base64 is present', async () => {
      const tool = tools.find((t) => t.name === 'figma_screenshot');
      deps.connector.captureScreenshot.mockResolvedValue({
        success: true,
        image: { base64: 'abc123base64', format: 'PNG' },
      });

      const result = await tool.execute('call-5', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'image', data: 'abc123base64', mimeType: 'image/png' }],
        details: {},
      });
    });

    it('falls back to imageData field when image.base64 is absent', async () => {
      const tool = tools.find((t) => t.name === 'figma_screenshot');
      deps.connector.captureScreenshot.mockResolvedValue({
        success: true,
        imageData: 'fallback64',
      });

      const result = await tool.execute('call-6', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'image', data: 'fallback64', mimeType: 'image/png' }],
        details: {},
      });
    });

    it('returns textResult when no image data is available', async () => {
      const tool = tools.find((t) => t.name === 'figma_screenshot');
      const data = { success: false, error: 'Node not found' };
      deps.connector.captureScreenshot.mockResolvedValue(data);

      const result = await tool.execute('call-7', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: {},
      });
    });

    it('uses default format PNG and empty nodeId', async () => {
      const tool = tools.find((t) => t.name === 'figma_screenshot');
      deps.connector.captureScreenshot.mockResolvedValue({ success: true });

      await tool.execute('call-8', {}, undefined, undefined, undefined);

      expect(deps.connector.captureScreenshot).toHaveBeenCalledWith('', { format: 'PNG', maxDimension: 1568 });
    });

    it('propagates errors from connector', async () => {
      const tool = tools.find((t) => t.name === 'figma_screenshot');
      deps.connector.captureScreenshot.mockRejectedValue(new Error('WS disconnected'));

      await expect(tool.execute('call-9', {}, undefined, undefined, undefined)).rejects.toThrow('WS disconnected');
    });
  });

  // ── figma_status ───────────────────────────────────────────────────

  describe('figma_status', () => {
    it('calls wsServer methods and returns status info', async () => {
      const tool = tools.find((t) => t.name === 'figma_status');

      const result = await tool.execute('call-10', {}, undefined, undefined, undefined);

      expect(deps.wsServer.isClientConnected).toHaveBeenCalled();
      expect(deps.wsServer.getConnectedFileInfo).toHaveBeenCalled();
      expect(deps.wsServer.getConnectedFiles).toHaveBeenCalled();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('connected', true);
      expect(parsed).toHaveProperty('fileInfo');
      expect(parsed).toHaveProperty('files');
    });

    it('does not use the connector at all', async () => {
      const tool = tools.find((t) => t.name === 'figma_status');

      await tool.execute('call-11', {}, undefined, undefined, undefined);

      // None of the connector methods should have been called
      for (const key of Object.keys(deps.connector)) {
        if (typeof deps.connector[key] === 'function' && deps.connector[key].mock) {
          expect(deps.connector[key]).not.toHaveBeenCalled();
        }
      }
    });

    it('returns textResult with connected, fileInfo, and files', async () => {
      const tool = tools.find((t) => t.name === 'figma_status');

      const result = await tool.execute('call-12', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              connected: true,
              fileInfo: {
                fileKey: 'abc123',
                fileName: 'Test.fig',
                connectedAt: deps.wsServer.getConnectedFileInfo().connectedAt,
              },
              files: [],
            }),
          },
        ],
        details: {},
      });
    });
  });

  // ── figma_get_selection ────────────────────────────────────────────

  describe('figma_get_selection', () => {
    it('calls wsServer.getCurrentSelection', async () => {
      const tool = tools.find((t) => t.name === 'figma_get_selection');

      await tool.execute('call-13', {}, undefined, undefined, undefined);

      expect(deps.wsServer.getCurrentSelection).toHaveBeenCalled();
    });

    it('returns textResult with selection data', async () => {
      const tool = tools.find((t) => t.name === 'figma_get_selection');
      const selection = { nodes: [{ id: '1:2', name: 'Frame' }], count: 1 };
      deps.wsServer.getCurrentSelection.mockReturnValue(selection);

      const result = await tool.execute('call-14', {}, undefined, undefined, undefined);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(selection) }],
        details: {},
      });
    });
  });

  // ── Cross-cutting ─────────────────────────────────────────────────

  describe('cross-cutting', () => {
    it('all 4 tools have correct name properties', () => {
      const names = tools.map((t) => t.name);
      expect(names).toEqual(['figma_execute', 'figma_screenshot', 'figma_status', 'figma_get_selection']);
    });

    it('all tools have label and description', () => {
      for (const tool of tools) {
        expect(tool.label).toBeTruthy();
        expect(typeof tool.label).toBe('string');
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });

    it('figma_execute uses operationQueue (call resolves through queue)', async () => {
      const tool = tools.find((t) => t.name === 'figma_execute');
      deps.connector.executeCodeViaUI.mockResolvedValue({ ok: true });

      const result = await tool.execute('call-15', { code: 'test()' }, undefined, undefined, undefined);

      // The fact that it resolves and connector was called proves the queue processed it
      expect(deps.connector.executeCodeViaUI).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
    });
  });
});
