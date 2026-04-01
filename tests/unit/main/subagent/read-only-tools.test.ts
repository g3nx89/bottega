import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import { CATEGORY_MAP } from '../../../../src/main/compression/metrics.js';
import { createReadOnlyTools, READ_ONLY_TOOL_NAMES } from '../../../../src/main/subagent/read-only-tools.js';

function makeMockDeps(): any {
  return {
    connector: {
      sendCommand: vi.fn().mockResolvedValue({ result: 'ok' }),
      figmaUse: vi.fn().mockResolvedValue('ok'),
      figmaUseWithImages: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
    figmaAPI: {},
    operationQueue: { execute: vi.fn((fn: any) => fn()) },
    wsServer: { getConnectedFileName: vi.fn().mockReturnValue('test.fig') },
    designSystemCache: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
    configManager: { getConfig: vi.fn().mockReturnValue({ profile: 'standard' }) },
    fileKey: 'test-key',
  };
}

describe('Read-Only Tools', () => {
  describe('READ_ONLY_TOOL_NAMES', () => {
    it('contains only discovery and screenshot category tools', () => {
      for (const name of READ_ONLY_TOOL_NAMES) {
        const cat = CATEGORY_MAP[name];
        expect(cat === 'discovery' || cat === 'screenshot').toBe(true);
      }
    });

    it('includes expected core read-only tools', () => {
      expect(READ_ONLY_TOOL_NAMES.has('figma_screenshot')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_get_file_data')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_search_components')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_design_system')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_get_selection')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_status')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_lint')).toBe(true);
      expect(READ_ONLY_TOOL_NAMES.has('figma_get_annotations')).toBe(true);
    });

    it('excludes mutation tools', () => {
      const mutationTools = Object.entries(CATEGORY_MAP)
        .filter(([, cat]) => cat === 'mutation')
        .map(([name]) => name);

      for (const name of mutationTools) {
        expect(READ_ONLY_TOOL_NAMES.has(name)).toBe(false);
      }
    });

    it('excludes figma_execute', () => {
      expect(READ_ONLY_TOOL_NAMES.has('figma_execute')).toBe(false);
    });

    it('has a reasonable number of tools', () => {
      expect(READ_ONLY_TOOL_NAMES.size).toBeGreaterThanOrEqual(10);
      expect(READ_ONLY_TOOL_NAMES.size).toBeLessThanOrEqual(20);
    });

    it('automatically includes new discovery tools added to CATEGORY_MAP', () => {
      // Count all discovery + screenshot entries in CATEGORY_MAP
      const expectedCount = Object.entries(CATEGORY_MAP).filter(
        ([, cat]) => cat === 'discovery' || cat === 'screenshot',
      ).length;
      expect(READ_ONLY_TOOL_NAMES.size).toBe(expectedCount);
    });
  });

  describe('createReadOnlyTools abort check', () => {
    it('returns tools', () => {
      const tools = createReadOnlyTools(makeMockDeps());
      expect(tools.length).toBeGreaterThan(0);
    });

    it('rejects with Aborted when signal is already aborted', async () => {
      const tools = createReadOnlyTools(makeMockDeps());
      const tool = tools[0];
      const ac = new AbortController();
      ac.abort();

      await expect(tool.execute('test-call', {}, ac.signal, vi.fn(), {} as any)).rejects.toThrow('Aborted');
    });

    it('does not reject with Aborted when signal is not aborted', async () => {
      const tools = createReadOnlyTools(makeMockDeps());
      const tool = tools[0];
      const ac = new AbortController();

      const result = await tool.execute('test-call', {}, ac.signal, vi.fn(), {} as any).catch((err: Error) => {
        // Tool may fail for other reasons (missing mock data), but not due to abort
        expect(err.message).not.toBe('Aborted');
      });

      // If it resolved, that's also fine
      void result;
    });
  });
});
