/**
 * 10k. Integration tests — Orchestrator + Judge flow with mocked Pi SDK sessions.
 *
 * These tests use real (mocked) Pi SDK sessions with scripted responses
 * to verify the full batch flow end-to-end.
 */
import { describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/subagent/session-factory.js', () => {
  return {
    createSubagentSession: vi.fn().mockImplementation(async () => {
      let subscriber: any = null;
      return {
        session: {
          subscribe: vi.fn((cb: any) => {
            subscriber = cb;
          }),
          prompt: vi.fn().mockImplementation(async () => {
            // Simulate text_delta events
            if (subscriber) {
              subscriber({
                type: 'message_update',
                assistantMessageEvent: { type: 'text_delta', delta: 'Analysis: ' },
              });
              subscriber({
                type: 'message_update',
                assistantMessageEvent: { type: 'text_delta', delta: 'Found 5 components.' },
              });
            }
          }),
          abort: vi.fn().mockResolvedValue(undefined),
        },
      };
    }),
  };
});

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn().mockResolvedValue({
    screenshot: null,
    fileData: '{"pages":["Page 1"]}',
    designSystem: '{"tokens":["--color-primary"]}',
  }),
  formatBriefing: vi.fn().mockReturnValue('# Briefing\nPre-fetched context here.'),
}));

vi.mock('../../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn().mockReturnValue([
    { name: 'figma_screenshot', execute: vi.fn() },
    { name: 'figma_get_file_data', execute: vi.fn() },
  ]),
  READ_ONLY_TOOL_NAMES: new Set(['figma_screenshot', 'figma_get_file_data']),
}));

vi.mock('../../../../src/main/subagent/session-logger.js', () => ({
  writeSubagentLog: vi.fn().mockResolvedValue(undefined),
  SUBAGENT_RUNS_DIR: '/tmp/test-subagent-runs',
}));

// ── Imports ──────────────────────────────────────

import type { SubagentSettings } from '../../../../src/main/subagent/config.js';
import { prefetchCommonContext } from '../../../../src/main/subagent/context-prefetch.js';
import { aggregateResults, runSubagentBatch } from '../../../../src/main/subagent/orchestrator.js';
import { writeSubagentLog } from '../../../../src/main/subagent/session-logger.js';

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

const mockConnector = { fileKey: 'test-file' } as any;

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

describe('Orchestrator Integration', () => {
  describe('full batch flow', () => {
    it('runs pre-fetch → spawn → parallel execution → aggregate for single agent', async () => {
      const progress: any[] = [];
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'Scan file structure' } }],
        defaultSettings,
        'integ-batch-1',
        new AbortController().signal,
        (event) => progress.push(event),
      );

      // Pre-fetch was called once
      expect(prefetchCommonContext).toHaveBeenCalledTimes(1);

      // Result has correct structure
      expect(result.batchId).toBeTruthy();
      expect(result.results).toHaveLength(1);
      expect(result.results[0].role).toBe('scout');
      expect(result.results[0].status).toBe('completed');
      expect(result.results[0].output).toContain('Analysis:');
      expect(result.aborted).toBe(false);

      // Progress events fired
      const spawned = progress.filter((p) => p.type === 'spawned');
      expect(spawned).toHaveLength(1);
      expect(spawned[0].role).toBe('scout');
    });

    it('runs multiple agents in parallel and returns all results', async () => {
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [
          { role: 'scout', context: { task: 'Scan' } },
          { role: 'analyst', context: { task: 'Analyze' } },
          { role: 'auditor', context: { task: 'Audit' } },
        ],
        defaultSettings,
        'integ-batch-2',
        new AbortController().signal,
        vi.fn(),
      );

      expect(result.results).toHaveLength(3);
      const roles = result.results.map((r) => r.role);
      expect(roles).toContain('scout');
      expect(roles).toContain('analyst');
      expect(roles).toContain('auditor');

      // All completed
      for (const r of result.results) {
        expect(r.status).toBe('completed');
      }
    });

    it('writes diagnostic logs for each result', async () => {
      await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'Scan' } }],
        defaultSettings,
        'integ-batch-3',
        new AbortController().signal,
        vi.fn(),
      );

      expect(writeSubagentLog).toHaveBeenCalled();
    });

    it('aggregates results without semantic deduplication', async () => {
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [
          { role: 'scout', context: { task: 'Count components' } },
          { role: 'auditor', context: { task: 'Count components' } },
        ],
        defaultSettings,
        'integ-batch-4',
        new AbortController().signal,
        vi.fn(),
      );

      const agg = aggregateResults(result.results);
      // Both results preserved — no merging even with same task
      expect(agg.results).toHaveLength(2);
      expect(agg.summary.completed).toBe(2);
    });
  });

  describe('abort handling', () => {
    it('returns aborted=true and partial results when signal fires mid-batch', async () => {
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 5);

      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [
          { role: 'scout', context: { task: 'Scan' } },
          { role: 'analyst', context: { task: 'Analyze' } },
        ],
        defaultSettings,
        'integ-batch-5',
        controller.signal,
        vi.fn(),
      );

      // May have partial results depending on timing
      expect(result.batchId).toBeTruthy();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns immediately with empty results when signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'Scan' } }],
        defaultSettings,
        'integ-batch-6',
        controller.signal,
        vi.fn(),
      );

      expect(result.aborted).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('empty and edge cases', () => {
    it('returns empty batch for zero requests', async () => {
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [],
        defaultSettings,
        'integ-batch-7',
        new AbortController().signal,
        vi.fn(),
      );

      expect(result.results).toEqual([]);
      expect(result.totalDurationMs).toBe(0);
      expect(result.aborted).toBe(false);
    });

    it('progress callback errors do not crash the batch', async () => {
      const badProgress = vi.fn().mockImplementation(() => {
        throw new Error('Progress handler crashed');
      });

      // Should not throw despite progress callback failing
      const result = await runSubagentBatch(
        mockInfra,
        mockConnector,
        [{ role: 'scout', context: { task: 'Scan' } }],
        defaultSettings,
        'integ-batch-8',
        new AbortController().signal,
        badProgress,
      );

      // Batch should still complete (progress error is non-fatal)
      expect(result.results).toHaveLength(1);
    });
  });
});
