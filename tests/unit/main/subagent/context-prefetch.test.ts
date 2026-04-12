/**
 * 10d. Context Pre-fetch unit tests
 */
import { describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => mockLog,
}));

import {
  formatBriefing,
  prefetchCommonContext,
  prefetchForMicroJudges,
} from '../../../../src/main/subagent/context-prefetch.js';
import type { PrefetchDataKey, PrefetchedContext } from '../../../../src/main/subagent/types.js';
import { threeMisalignedSquares as threeMisalignedSquaresFixture } from '../../../helpers/evidence-fixtures.js';

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
    const nullExtras = { lint: null, libraryComponents: null, componentAnalysis: null, judgeEvidence: null };

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

  // UX-003: judge screenshot scoping — verify that when the harness knows which
  // node was just mutated, the screenshot call passes `nodeId` instead of a
  // viewport zoom. Without this, the judge evaluates unrelated pre-existing
  // canvas content and produces false positives like "[DS::colors] frame not
  // visible" on a totally unrelated node.
  describe('prefetchForMicroJudges — UX-003 screenshot scoping', () => {
    const screenshotNeeds = new Set<PrefetchDataKey>(['screenshot']);

    it('calls figma_screenshot with viewport params when no targetNodeId is provided', async () => {
      const tools = makeMockTools();
      await prefetchForMicroJudges(tools as any, screenshotNeeds);

      const screenshotTool = tools.find((t) => t.name === 'figma_screenshot')!;
      expect(screenshotTool.execute).toHaveBeenCalledTimes(1);
      const callParams = (screenshotTool.execute as any).mock.calls[0][1];
      expect(callParams).toEqual({ zoom: 2 });
      expect(callParams.nodeId).toBeUndefined();
    });

    it('calls figma_screenshot with nodeId when a targetNodeId is provided', async () => {
      const tools = makeMockTools();
      await prefetchForMicroJudges(tools as any, screenshotNeeds, undefined, undefined, '128:445');

      const screenshotTool = tools.find((t) => t.name === 'figma_screenshot')!;
      expect(screenshotTool.execute).toHaveBeenCalledTimes(1);
      const callParams = (screenshotTool.execute as any).mock.calls[0][1];
      expect(callParams).toEqual({ nodeId: '128:445' });
      // Must NOT also pass zoom — the bridge auto-fits the node to the frame
      // and a zoom value would conflict with the crop.
      expect(callParams.zoom).toBeUndefined();
    });

    it('propagates targetNodeId onto the returned PrefetchedContext so judges can reference it', async () => {
      const tools = makeMockTools();
      const result = await prefetchForMicroJudges(tools as any, screenshotNeeds, undefined, undefined, '128:445');
      expect(result.targetNodeId).toBe('128:445');
      expect(result.screenshot).not.toBeNull();
    });

    it('leaves targetNodeId null when not provided (unscoped viewport screenshot)', async () => {
      const tools = makeMockTools();
      const result = await prefetchForMicroJudges(tools as any, screenshotNeeds);
      expect(result.targetNodeId).toBeNull();
    });
  });

  // ── Data needs routing — verifies that only the tools matching the requested
  // PrefetchDataKey set are invoked, and no unneeded WS roundtrips occur.
  describe('prefetchForMicroJudges — data needs routing', () => {
    function makeMockToolsNamed() {
      const results: Record<string, any> = {
        figma_screenshot: { content: [{ type: 'image', data: 'png-data' }] },
        figma_get_file_data: { content: [{ type: 'text', text: '{"pages":[]}' }] },
        figma_design_system: { content: [{ type: 'text', text: '{"tokens":[]}' }] },
        figma_lint: { content: [{ type: 'text', text: '{"violations":[]}' }] },
        figma_get_library_components: {
          content: [{ type: 'text', text: '{"components":[],"componentSets":[]}' }],
        },
      };
      return Object.entries(results).map(([name, result]) => ({
        name,
        execute: vi.fn().mockResolvedValue(result),
      }));
    }

    it('fetches only fileData when that is the sole need', async () => {
      const tools = makeMockToolsNamed();
      await prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>(['fileData']));

      expect(tools.find((t) => t.name === 'figma_get_file_data')!.execute).toHaveBeenCalledTimes(1);
      expect(tools.find((t) => t.name === 'figma_screenshot')!.execute).not.toHaveBeenCalled();
      expect(tools.find((t) => t.name === 'figma_lint')!.execute).not.toHaveBeenCalled();
      expect(tools.find((t) => t.name === 'figma_design_system')!.execute).not.toHaveBeenCalled();
      expect(tools.find((t) => t.name === 'figma_get_library_components')!.execute).not.toHaveBeenCalled();
    });

    it('fetches lint + designSystem together when both are needed', async () => {
      const tools = makeMockToolsNamed();
      await prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>(['lint', 'designSystem']));

      expect(tools.find((t) => t.name === 'figma_lint')!.execute).toHaveBeenCalledTimes(1);
      expect(tools.find((t) => t.name === 'figma_design_system')!.execute).toHaveBeenCalledTimes(1);
      expect(tools.find((t) => t.name === 'figma_screenshot')!.execute).not.toHaveBeenCalled();
      expect(tools.find((t) => t.name === 'figma_get_file_data')!.execute).not.toHaveBeenCalled();
    });

    it('skips libraryComponents when fileKey is not provided', async () => {
      const tools = makeMockToolsNamed();
      await prefetchForMicroJudges(
        tools as any,
        new Set<PrefetchDataKey>(['libraryComponents']),
        undefined,
        undefined, // no fileKey
      );

      expect(tools.find((t) => t.name === 'figma_get_library_components')!.execute).not.toHaveBeenCalled();
    });

    it('fetches libraryComponents when fileKey is provided', async () => {
      const tools = makeMockToolsNamed();
      await prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>(['libraryComponents']), undefined, 'abc123');

      expect(tools.find((t) => t.name === 'figma_get_library_components')!.execute).toHaveBeenCalledTimes(1);
    });

    it('populates componentAnalysis when both fileData and libraryComponents are fetched', async () => {
      const tools = makeMockToolsNamed();
      // Override fileData with a minimal valid page structure
      const fileDataTool = tools.find((t) => t.name === 'figma_get_file_data')!;
      fileDataTool.execute = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ pages: [{ name: 'Page', children: [] }] }) }],
      });
      // Override libraryComponents with a named component
      const libTool = tools.find((t) => t.name === 'figma_get_library_components')!;
      libTool.execute = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ components: [{ name: 'Button' }] }) }],
      });

      const result = await prefetchForMicroJudges(
        tools as any,
        new Set<PrefetchDataKey>(['fileData', 'libraryComponents']),
        undefined,
        'abc123',
      );

      expect(result.fileData).not.toBeNull();
      expect(result.libraryComponents).not.toBeNull();
      // componentAnalysis is a post-processing step — should be populated (even if empty stats)
      expect(result.componentAnalysis).not.toBeNull();
      expect(result.componentAnalysis).toHaveProperty('stats');
    });

    it('returns null componentAnalysis when libraryComponents is missing', async () => {
      const tools = makeMockToolsNamed();
      const result = await prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>(['fileData']));

      expect(result.fileData).not.toBeNull();
      expect(result.componentAnalysis).toBeNull();
    });

    it('returns all null fields for an empty needs set', async () => {
      const tools = makeMockToolsNamed();
      const result = await prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>());

      expect(result.screenshot).toBeNull();
      expect(result.fileData).toBeNull();
      expect(result.designSystem).toBeNull();
      expect(result.lint).toBeNull();
      expect(result.libraryComponents).toBeNull();
      expect(result.componentAnalysis).toBeNull();
      expect(result.judgeEvidence).toBeNull();
      for (const tool of tools) {
        expect(tool.execute).not.toHaveBeenCalled();
      }
    });

    it('rethrows AbortError from within prefetchForMicroJudges', async () => {
      const tools = makeMockToolsNamed();
      const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      tools.find((t) => t.name === 'figma_get_file_data')!.execute = vi.fn().mockRejectedValue(abortError);

      await expect(prefetchForMicroJudges(tools as any, new Set<PrefetchDataKey>(['fileData']))).rejects.toThrow(
        'Aborted',
      );
    });
  });

  // Judge evidence extraction — runs a JS payload inside the Figma plugin via
  // the connector's `executeCodeViaUI`. This exercises the wiring between
  // `prefetchForMicroJudges`, `buildEvidenceCode`, and `computeJudgeEvidence`.
  describe('prefetchForMicroJudges — judgeEvidence extraction', () => {
    const evidenceNeeds = new Set<PrefetchDataKey>(['judgeEvidence']);

    // Use shared fixture — 3 misaligned squares from evidence-fixtures.ts
    const threeMisalignedSquaresRaw = threeMisalignedSquaresFixture;

    function makeMockConnector(executeImpl?: (...args: any[]) => any): any {
      return {
        executeCodeViaUI: executeImpl ? vi.fn(executeImpl) : vi.fn().mockResolvedValue([]),
        fileKey: 'test-file',
      };
    }

    it('calls connector.executeCodeViaUI with the generated code when judgeEvidence is needed', async () => {
      const tools = makeMockTools();
      const connector = makeMockConnector(() => Promise.resolve(threeMisalignedSquaresRaw));
      const result = await prefetchForMicroJudges(
        tools as any,
        evidenceNeeds,
        undefined,
        'test-file',
        '1:1',
        connector,
      );
      expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
      const [code, timeout] = (connector.executeCodeViaUI as any).mock.calls[0];
      // JSON.stringify wraps the ID in double quotes
      expect(code).toContain('"1:1"');
      expect(code).toContain('figma.getNodeById');
      expect(timeout).toBe(20_000);
      expect(result.judgeEvidence?.alignment.verdict).toBe('misaligned');
      expect(result.judgeEvidence?.targetNodeId).toBe('1:1');
    });

    it('skips evidence extraction when targetNodeId is absent', async () => {
      const tools = makeMockTools();
      const connector = makeMockConnector();
      const result = await prefetchForMicroJudges(
        tools as any,
        evidenceNeeds,
        undefined,
        'test-file',
        undefined,
        connector,
      );
      expect(connector.executeCodeViaUI).not.toHaveBeenCalled();
      expect(result.judgeEvidence).toBeNull();
    });

    it('skips evidence extraction when connector is omitted (back-compat)', async () => {
      const tools = makeMockTools();
      const result = await prefetchForMicroJudges(tools as any, evidenceNeeds, undefined, 'test-file', '1:1');
      expect(result.judgeEvidence).toBeNull();
    });

    it('resolves judgeEvidence=null when executeCodeViaUI rejects (does not throw)', async () => {
      const tools = makeMockTools();
      const connector = makeMockConnector(() => Promise.reject(new Error('plugin timeout')));
      const result = await prefetchForMicroJudges(
        tools as any,
        evidenceNeeds,
        undefined,
        'test-file',
        '1:1',
        connector,
      );
      expect(result.judgeEvidence).toBeNull();
    });

    it('resolves judgeEvidence=null when the plugin returns a non-array payload', async () => {
      const tools = makeMockTools();
      const connector = makeMockConnector(() => Promise.resolve({ error: 'bad' }));
      const result = await prefetchForMicroJudges(
        tools as any,
        evidenceNeeds,
        undefined,
        'test-file',
        '1:1',
        connector,
      );
      expect(result.judgeEvidence).toBeNull();
    });

    it('does not fetch evidence when neededData lacks judgeEvidence', async () => {
      const tools = makeMockTools();
      const connector = makeMockConnector();
      await prefetchForMicroJudges(
        tools as any,
        new Set<PrefetchDataKey>(['fileData']),
        undefined,
        'test-file',
        '1:1',
        connector,
      );
      expect(connector.executeCodeViaUI).not.toHaveBeenCalled();
    });

    it('applies the 15s withPrefetchTimeout wrapper — never-resolving payload → null', async () => {
      vi.useFakeTimers();
      const tools = makeMockTools();
      const connector = makeMockConnector(() => new Promise(() => {}));
      const promise = prefetchForMicroJudges(tools as any, evidenceNeeds, undefined, 'test-file', '1:1', connector);
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await promise;
      expect(result.judgeEvidence).toBeNull();
      vi.useRealTimers();
    });
  });
});
