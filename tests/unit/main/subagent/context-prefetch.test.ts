/**
 * 10d. Context Pre-fetch unit tests
 */
import { describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => mockLog,
}));

import { formatBriefing, prefetchCommonContext } from '../../../../src/main/subagent/context-prefetch.js';
import type { PrefetchedContext } from '../../../../src/main/subagent/types.js';

function makeMockTools(overrides: Record<string, any> = {}) {
  const defaultResults: Record<string, any> = {
    figma_screenshot: { content: [{ type: 'image', data: 'base64data' }] },
    figma_get_file_data: { content: [{ type: 'text', text: '{"pages":[]}' }] },
    figma_design_system: { content: [{ type: 'text', text: '{"tokens":[]}' }] },
    ...overrides,
  };

  return Object.entries(defaultResults).map(([name, result]) => ({
    name,
    execute: vi.fn().mockResolvedValue(result),
  }));
}

describe('Context Pre-fetch', () => {
  describe('prefetchCommonContext', () => {
    it('calls get_file_data and design_system in parallel (screenshot omitted)', async () => {
      const tools = makeMockTools();
      await prefetchCommonContext(tools as any);

      const fileDataTool = tools.find((t) => t.name === 'figma_get_file_data')!;
      const dsTool = tools.find((t) => t.name === 'figma_design_system')!;
      const screenshotTool = tools.find((t) => t.name === 'figma_screenshot')!;
      expect(fileDataTool.execute).toHaveBeenCalledTimes(1);
      expect(dsTool.execute).toHaveBeenCalledTimes(1);
      expect(screenshotTool.execute).not.toHaveBeenCalled();
    });

    it('returns structured PrefetchedContext with fileData and designSystem', async () => {
      const tools = makeMockTools();
      const result = await prefetchCommonContext(tools as any);

      expect(result).toHaveProperty('screenshot');
      expect(result).toHaveProperty('fileData');
      expect(result).toHaveProperty('designSystem');
      expect(result.screenshot).toBeNull(); // screenshot omitted from prefetch
      expect(result.fileData).toBe('{"pages":[]}');
      expect(result.designSystem).toBe('{"tokens":[]}');
    });

    it('returns partial data when one tool call fails', async () => {
      const tools = makeMockTools({
        figma_design_system: null, // will be replaced with a failing tool
      });
      // Override design_system to throw
      const dsTool = tools.find((t) => t.name === 'figma_design_system')!;
      dsTool.execute = vi.fn().mockRejectedValue(new Error('WS disconnected'));

      const result = await prefetchCommonContext(tools as any);
      expect(result.fileData).toBe('{"pages":[]}');
      expect(result.designSystem).toBeNull();
    });

    it('returns all null fields when all three tool calls fail', async () => {
      const tools = makeMockTools();
      for (const tool of tools) {
        tool.execute = vi.fn().mockRejectedValue(new Error('Connection lost'));
      }

      const result = await prefetchCommonContext(tools as any);
      expect(result.screenshot).toBeNull();
      expect(result.fileData).toBeNull();
      expect(result.designSystem).toBeNull();
    });

    it('throws AbortError when signal is aborted before any call completes', async () => {
      const tools = makeMockTools();
      for (const tool of tools) {
        tool.execute = vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }

      await expect(prefetchCommonContext(tools as any)).rejects.toThrow('Aborted');
    });

    it('returns null for tool not found in tool set', async () => {
      // Empty tools array — none of the expected tools exist
      const result = await prefetchCommonContext([] as any);
      expect(result.screenshot).toBeNull();
      expect(result.fileData).toBeNull();
      expect(result.designSystem).toBeNull();
    });

    it('W-001: logs tool-not-found at debug level, not warn', async () => {
      mockLog.debug.mockClear();
      mockLog.warn.mockClear();

      // Empty tools array triggers "tool not found" path for each expected tool
      await prefetchCommonContext([] as any);

      // Should use debug (not warn) for missing tools — these are expected for subagent read-only tool sets
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: expect.any(String) }),
        expect.stringContaining('not found'),
      );
      // warn should NOT have been called for missing tools
      const warnCalls = mockLog.warn.mock.calls.filter(
        (call: any[]) => typeof call[1] === 'string' && call[1].includes('not found'),
      );
      expect(warnCalls).toHaveLength(0);
    });

    it('extracts text content from tool results', async () => {
      const tools = makeMockTools({
        figma_get_file_data: { content: [{ type: 'text', text: 'file data here' }] },
      });
      const result = await prefetchCommonContext(tools as any);
      expect(result.fileData).toBe('file data here');
    });
  });

  describe('formatBriefing', () => {
    const nullExtras = { lint: null, libraryComponents: null, componentAnalysis: null };

    it('formats full context into briefing string', () => {
      const context: PrefetchedContext = {
        screenshot: { type: 'image', data: 'base64...', mimeType: 'image/png' },
        fileData: '{"pages":[]}',
        designSystem: '{"tokens":[]}',
        ...nullExtras,
      };
      const briefing = formatBriefing(context);
      expect(briefing).toContain('Pre-fetched Briefing');
      expect(briefing).toContain('File Structure');
      expect(briefing).toContain('Design System');
      expect(briefing).toContain('Screenshot');
      expect(briefing).toContain('verify via tools');
    });

    it('handles all null fields gracefully', () => {
      const context: PrefetchedContext = {
        screenshot: null,
        fileData: null,
        designSystem: null,
        ...nullExtras,
      };
      const briefing = formatBriefing(context);
      expect(briefing).toContain('No pre-fetched data available');
    });

    it('includes only available sections', () => {
      const context: PrefetchedContext = {
        screenshot: null,
        fileData: '{"pages":[]}',
        designSystem: null,
        ...nullExtras,
      };
      const briefing = formatBriefing(context);
      expect(briefing).toContain('File Structure');
      expect(briefing).not.toContain('Design System');
      expect(briefing).not.toContain('Screenshot');
    });

    it('does not include raw screenshot data as text', () => {
      const context: PrefetchedContext = {
        screenshot: { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
        fileData: null,
        designSystem: null,
        ...nullExtras,
      };
      const briefing = formatBriefing(context);
      expect(briefing).not.toContain('iVBORw0KGgo');
      expect(briefing).toContain('Screenshot');
    });
  });
});
