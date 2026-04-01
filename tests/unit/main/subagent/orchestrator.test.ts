import { describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/subagent/session-factory.js', () => ({
  createSubagentSession: vi.fn().mockResolvedValue({
    session: {
      subscribe: vi.fn(),
      newSession: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn().mockResolvedValue({
    screenshot: null,
    fileData: '{"pages":[]}',
    designSystem: '{"tokens":[]}',
  }),
  formatBriefing: vi.fn().mockReturnValue('# Briefing\nTest briefing content'),
}));

vi.mock('../../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn().mockReturnValue([]),
  READ_ONLY_TOOL_NAMES: new Set(['figma_screenshot', 'figma_get_file_data']),
}));

vi.mock('../../../../src/main/subagent/session-logger.js', () => ({
  writeSubagentLog: vi.fn().mockResolvedValue(undefined),
  SUBAGENT_RUNS_DIR: '/tmp/test-subagent-runs',
}));

import type { SubagentSettings } from '../../../../src/main/subagent/config.js';
import { aggregateResults, runSubagentBatch } from '../../../../src/main/subagent/orchestrator.js';
import type { SubagentResult } from '../../../../src/main/subagent/types.js';

const mockInfra = {
  authStorage: {},
  modelRegistry: {},
  sessionManager: {},
  configManager: {},
  designSystemCache: {},
  metricsCollector: {},
  compressionExtensionFactory: vi.fn(),
  wsServer: {},
  figmaAPI: {},
  queueManager: { getQueue: vi.fn().mockReturnValue({}) },
} as any;

const mockConnector = {
  fileKey: 'test-file-key',
} as any;

const defaultSettings: SubagentSettings = {
  models: {
    scout: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    analyst: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    auditor: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    judge: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  },
  judgeMode: 'auto',
  autoRetry: false,
  maxRetries: 2,
};

describe('Orchestrator', () => {
  describe('runSubagentBatch', () => {
    it('returns empty result for empty requests', async () => {
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [],
        defaultSettings,
        'test-batch-1',
        new AbortController().signal,
        vi.fn(),
      );
      expect(result.results).toEqual([]);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.aborted).toBe(false);
    });

    it('generates a batchId', async () => {
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [],
        defaultSettings,
        'test-batch-2',
        new AbortController().signal,
        vi.fn(),
      );
      expect(result.batchId).toBeTruthy();
      expect(typeof result.batchId).toBe('string');
    });

    it('returns aborted=true when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'test' } }],
        defaultSettings,
        'test-batch-abort',
        controller.signal,
        vi.fn(),
      );
      expect(result.aborted).toBe(true);
    });

    it('fires progress events', async () => {
      const onProgress = vi.fn();
      await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'test' } }],
        defaultSettings,
        'test-batch-progress',
        new AbortController().signal,
        onProgress,
      );
      // Should have at least a 'spawned' event
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ role: 'scout', type: 'spawned' }));
    });
  });

  describe('aggregateResults', () => {
    it('correctly counts completed/errors/aborted', () => {
      const results: SubagentResult[] = [
        { role: 'scout', subagentId: 's1', status: 'completed', output: 'ok', durationMs: 100 },
        { role: 'analyst', subagentId: 's2', status: 'error', error: 'fail', durationMs: 50 },
        { role: 'auditor', subagentId: 's3', status: 'aborted', durationMs: 10 },
      ];
      const agg = aggregateResults(results);
      expect(agg.summary.total).toBe(3);
      expect(agg.summary.completed).toBe(1);
      expect(agg.summary.errors).toBe(1);
      expect(agg.summary.aborted).toBe(1);
    });

    it('preserves role and verdict in output', () => {
      const verdict = {
        verdict: 'PASS' as const,
        criteria: [],
        actionItems: [],
        summary: 'All good',
      };
      const results: SubagentResult[] = [
        { role: 'judge', subagentId: 'j1', status: 'completed', output: '{}', verdict, durationMs: 200 },
      ];
      const agg = aggregateResults(results);
      expect(agg.results[0].role).toBe('judge');
      expect(agg.results[0].verdict).toEqual(verdict);
    });

    it('handles empty results array', () => {
      const agg = aggregateResults([]);
      expect(agg.summary.total).toBe(0);
      expect(agg.results).toEqual([]);
    });

    it('does not merge or deduplicate across roles', () => {
      const results: SubagentResult[] = [
        { role: 'scout', subagentId: 's1', status: 'completed', output: '10 components', durationMs: 100 },
        { role: 'auditor', subagentId: 's2', status: 'completed', output: '12 components', durationMs: 150 },
      ];
      const agg = aggregateResults(results);
      // Both results preserved independently — no merging
      expect(agg.results).toHaveLength(2);
      expect(agg.results[0].output).toBe('10 components');
      expect(agg.results[1].output).toBe('12 components');
    });
  });
});
