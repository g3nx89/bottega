import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageGenTools } from '../../../src/main/tools/image-gen.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Mock prompt builders (tested separately)
vi.mock('../../../src/main/image-gen/prompt-builders.js', () => ({
  buildBatchPrompts: vi.fn((prompt: string) => [prompt]),
  buildIconPrompt: vi.fn((prompt: string) => prompt + ' icon'),
  buildPatternPrompt: vi.fn((prompt: string) => prompt + ' pattern'),
  buildDiagramPrompt: vi.fn((prompt: string) => prompt + ' diagram'),
  buildStoryStepPrompt: vi.fn((prompt: string, step: number) => `${prompt} step ${step}`),
}));

function createMockImageGenerator() {
  return {
    generate: vi.fn().mockResolvedValue({ success: true, images: ['gen-img-base64'] }),
    generateBatch: vi.fn().mockResolvedValue({ success: true, images: ['batch-img-base64'] }),
    edit: vi.fn().mockResolvedValue({ success: true, images: ['edited-img-base64'] }),
    model: 'gemini-test',
  };
}

describe('Image Gen Tools', () => {
  let deps: any;
  let tools: any[];
  let mockGen: ReturnType<typeof createMockImageGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGen = createMockImageGenerator();
    deps = createTestToolDeps({ getImageGenerator: () => mockGen });
    tools = createImageGenTools(deps);
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
  }

  function run(tool: any, params: any, signal?: AbortSignal) {
    return tool.execute('call-id', params, signal, undefined, undefined);
  }

  function parseResult(result: any) {
    return JSON.parse(result.content[0].text);
  }

  // ── cross-cutting ──────────────────────────────────────────────────

  describe('cross-cutting', () => {
    it('creates all 7 image-gen tools', () => {
      const names = tools.map((t: any) => t.name);
      expect(names).toEqual([
        'figma_generate_image',
        'figma_edit_image',
        'figma_restore_image',
        'figma_generate_icon',
        'figma_generate_pattern',
        'figma_generate_story',
        'figma_generate_diagram',
      ]);
    });

    it('all tools have label and description', () => {
      for (const tool of tools) {
        expect(tool.label).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });
  });

  // ── requireImageGen guard ──────────────────────────────────────────

  describe('requireImageGen guard', () => {
    it('throws when getImageGenerator returns null', async () => {
      const nullDeps = createTestToolDeps({ getImageGenerator: () => null });
      const nullTools = createImageGenTools(nullDeps);
      const tool = nullTools.find((t) => t.name === 'figma_generate_image')!;

      await expect(run(tool, { prompt: 'test' })).rejects.toThrow('Image generation not configured');
    });
  });

  // ── figma_generate_image ───────────────────────────────────────────

  describe('figma_generate_image', () => {
    it('calls generateBatch with enriched prompts', async () => {
      const tool = findTool('figma_generate_image');
      await run(tool, { prompt: 'a sunset' });

      expect(mockGen.generateBatch).toHaveBeenCalledWith(['a sunset'], undefined);
    });

    it('applies image to nodeIds when provided', async () => {
      const tool = findTool('figma_generate_image');
      const result = await run(tool, { prompt: 'a sunset', nodeIds: ['1:2'] });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['1:2'], 'batch-img-base64', 'FILL');
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.appliedToNodes).toEqual(['1:2']);
    });

    it('uses custom scaleMode when provided', async () => {
      const tool = findTool('figma_generate_image');
      await run(tool, { prompt: 'a sunset', nodeIds: ['1:2'], scaleMode: 'FIT' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['1:2'], 'batch-img-base64', 'FIT');
    });

    it('does not apply when no nodeIds', async () => {
      const tool = findTool('figma_generate_image');
      const result = await run(tool, { prompt: 'a sunset' });

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed.appliedToNodes).toEqual([]);
      expect(parsed.hint).toContain('figma_set_image_fill');
    });

    it('returns error when generateBatch fails', async () => {
      mockGen.generateBatch.mockResolvedValue({ success: false, images: [], error: 'API quota exceeded' });
      const tool = findTool('figma_generate_image');
      const result = await run(tool, { prompt: 'test' });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('API quota exceeded');
    });
  });

  // ── figma_edit_image ───────────────────────────────────────────────

  describe('figma_edit_image', () => {
    it('exports node image then calls gen.edit with it', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({
        image: { base64: 'source-img-base64' },
      });

      const tool = findTool('figma_edit_image');
      await run(tool, { prompt: 'remove background', nodeId: '3:4' });

      expect(deps.connector.captureScreenshot).toHaveBeenCalledWith('3:4', { format: 'PNG' });
      expect(mockGen.edit).toHaveBeenCalledWith('remove background', 'source-img-base64');
    });

    it('applies edited image back to the same node', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({
        image: { base64: 'source-img-base64' },
      });

      const tool = findTool('figma_edit_image');
      const result = await run(tool, { prompt: 'remove background', nodeId: '3:4' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['3:4'], 'edited-img-base64', 'FILL');
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
    });

    it('falls back to imageData field when image.base64 is absent', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({ imageData: 'fallback-data' });

      const tool = findTool('figma_edit_image');
      await run(tool, { prompt: 'edit it', nodeId: '5:6' });

      expect(mockGen.edit).toHaveBeenCalledWith('edit it', 'fallback-data');
    });

    it('returns error when edit fails', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({
        image: { base64: 'src' },
      });
      mockGen.edit.mockResolvedValue({ success: false, images: [], error: 'Content policy' });

      const tool = findTool('figma_edit_image');
      const result = await run(tool, { prompt: 'bad prompt', nodeId: '3:4' });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Content policy');
      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
    });

    it('throws when captureScreenshot returns no image data', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({ success: false });

      const tool = findTool('figma_edit_image');
      await expect(run(tool, { prompt: 'edit', nodeId: '3:4' })).rejects.toThrow('Failed to export node image');
    });
  });

  // ── figma_restore_image ────────────────────────────────────────────

  describe('figma_restore_image', () => {
    it('uses editNodeImage flow same as edit_image', async () => {
      deps.connector.captureScreenshot.mockResolvedValue({
        image: { base64: 'source-img' },
      });

      const tool = findTool('figma_restore_image');
      const result = await run(tool, { prompt: 'enhance quality', nodeId: '7:8' });

      expect(deps.connector.captureScreenshot).toHaveBeenCalledWith('7:8', { format: 'PNG' });
      expect(mockGen.edit).toHaveBeenCalledWith('enhance quality', 'source-img');
      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['7:8'], 'edited-img-base64', 'FILL');
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.hint).toContain('Restored');
    });
  });

  // ── figma_generate_icon ────────────────────────────────────────────

  describe('figma_generate_icon', () => {
    it('calls buildIconPrompt then gen.generate', async () => {
      const { buildIconPrompt } = await import('../../../src/main/image-gen/prompt-builders.js');
      const tool = findTool('figma_generate_icon');
      await run(tool, { prompt: 'a mountain' });

      expect(buildIconPrompt).toHaveBeenCalledWith('a mountain', {
        type: undefined,
        style: undefined,
        background: undefined,
        corners: undefined,
      });
      expect(mockGen.generate).toHaveBeenCalledWith('a mountain icon');
    });

    it('applies to nodeId when provided', async () => {
      const tool = findTool('figma_generate_icon');
      const result = await run(tool, { prompt: 'a mountain', nodeId: '9:10' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['9:10'], 'gen-img-base64', 'FILL');
      const parsed = parseResult(result);
      expect(parsed.appliedToNode).toBe('9:10');
    });

    it('does not apply when no nodeId', async () => {
      const tool = findTool('figma_generate_icon');
      const result = await run(tool, { prompt: 'a mountain' });

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed.appliedToNode).toBeNull();
    });

    it('returns error when generate fails', async () => {
      mockGen.generate.mockResolvedValue({ success: false, images: [], error: 'Model error' });
      const tool = findTool('figma_generate_icon');
      const result = await run(tool, { prompt: 'test' });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Model error');
    });
  });

  // ── figma_generate_pattern ─────────────────────────────────────────

  describe('figma_generate_pattern', () => {
    it('calls buildPatternPrompt then gen.generate', async () => {
      const { buildPatternPrompt } = await import('../../../src/main/image-gen/prompt-builders.js');
      const tool = findTool('figma_generate_pattern');
      await run(tool, { prompt: 'geometric triangles' });

      expect(buildPatternPrompt).toHaveBeenCalled();
      expect(mockGen.generate).toHaveBeenCalledWith('geometric triangles pattern');
    });

    it('applies to nodeIds with TILE default for seamless type', async () => {
      const tool = findTool('figma_generate_pattern');
      await run(tool, { prompt: 'dots', nodeIds: ['11:12'], type: 'seamless' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['11:12'], 'gen-img-base64', 'TILE');
    });

    it('applies to nodeIds with FILL default for non-seamless type', async () => {
      const tool = findTool('figma_generate_pattern');
      await run(tool, { prompt: 'wood', nodeIds: ['11:12'], type: 'texture' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['11:12'], 'gen-img-base64', 'FILL');
    });

    it('respects explicit scaleMode over default', async () => {
      const tool = findTool('figma_generate_pattern');
      await run(tool, { prompt: 'dots', nodeIds: ['11:12'], type: 'seamless', scaleMode: 'FIT' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['11:12'], 'gen-img-base64', 'FIT');
    });

    it('does not apply when no nodeIds', async () => {
      const tool = findTool('figma_generate_pattern');
      const result = await run(tool, { prompt: 'dots' });

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed.appliedToNodes).toEqual([]);
    });
  });

  // ── figma_generate_diagram ─────────────────────────────────────────

  describe('figma_generate_diagram', () => {
    it('calls buildDiagramPrompt then gen.generate', async () => {
      const { buildDiagramPrompt } = await import('../../../src/main/image-gen/prompt-builders.js');
      const tool = findTool('figma_generate_diagram');
      await run(tool, { prompt: 'auth flow' });

      expect(buildDiagramPrompt).toHaveBeenCalled();
      expect(mockGen.generate).toHaveBeenCalledWith('auth flow diagram');
    });

    it('applies to nodeId when provided', async () => {
      const tool = findTool('figma_generate_diagram');
      const result = await run(tool, { prompt: 'auth flow', nodeId: '13:14' });

      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['13:14'], 'gen-img-base64', 'FILL');
      const parsed = parseResult(result);
      expect(parsed.appliedToNode).toBe('13:14');
    });

    it('does not apply when no nodeId', async () => {
      const tool = findTool('figma_generate_diagram');
      const result = await run(tool, { prompt: 'auth flow' });

      expect(deps.connector.setImageFill).not.toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed.appliedToNode).toBeNull();
    });
  });

  // ── figma_generate_story ───────────────────────────────────────────

  describe('figma_generate_story', () => {
    it('generates sequential images calling gen.generate per step', async () => {
      const tool = findTool('figma_generate_story');
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ containerId: 'c:1', frameIds: ['f:1', 'f:2', 'f:3', 'f:4'] }),
      );

      const result = await run(tool, { prompt: 'a journey' });

      // Default 4 steps
      expect(mockGen.generate).toHaveBeenCalledTimes(4);
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.stepsGenerated).toBe(4);
      expect(parsed.stepsRequested).toBe(4);
      expect(parsed.containerId).toBe('c:1');
    });

    it('respects custom step count', async () => {
      const tool = findTool('figma_generate_story');
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ containerId: 'c:2', frameIds: ['f:1', 'f:2'] }),
      );

      await run(tool, { prompt: 'short story', steps: 2 });

      expect(mockGen.generate).toHaveBeenCalledTimes(2);
    });

    it('applies images to created frames via setImageFill', async () => {
      const tool = findTool('figma_generate_story');
      deps.connector.executeCodeViaUI.mockResolvedValue(
        JSON.stringify({ containerId: 'c:3', frameIds: ['f:1', 'f:2'] }),
      );

      await run(tool, { prompt: 'two steps', steps: 2 });

      expect(deps.connector.setImageFill).toHaveBeenCalledTimes(2);
      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['f:1'], 'gen-img-base64', 'FILL');
      expect(deps.connector.setImageFill).toHaveBeenCalledWith(['f:2'], 'gen-img-base64', 'FILL');
    });

    it('returns error when all image generations fail', async () => {
      mockGen.generate.mockResolvedValue({ success: false, images: [], error: 'fail' });
      const tool = findTool('figma_generate_story');

      const result = await run(tool, { prompt: 'bad story', steps: 2 });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Failed to generate');
    });

    it('returns error from executeCodeViaUI when frame creation fails', async () => {
      const tool = findTool('figma_generate_story');
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ error: 'Parent not found' }));

      const result = await run(tool, { prompt: 'a journey', parentId: 'bad:id' });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Parent not found');
    });

    it('stops generating when signal is aborted', async () => {
      const controller = new AbortController();
      // Abort after first generate call
      mockGen.generate.mockImplementation(async () => {
        controller.abort();
        return { success: true, images: ['img'] };
      });

      const tool = findTool('figma_generate_story');
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ containerId: 'c:4', frameIds: ['f:1'] }));

      const result = await run(tool, { prompt: 'test', steps: 4 }, controller.signal);

      // Only first call completes before abort
      expect(mockGen.generate).toHaveBeenCalledTimes(1);
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.stepsGenerated).toBe(1);
    });
  });
});
