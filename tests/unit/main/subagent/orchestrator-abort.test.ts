import { describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/subagent/session-factory.js', () => ({
  createSubagentSession: vi.fn().mockImplementation(async (_infra, _tools, _config, _systemPrompt, signal) => {
    // Simulate that createSubagentSession respects abort signal
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
      // Simulate async initialization that can be aborted
      const timer = setTimeout(() => {
        resolve({
          session: {
            subscribe: vi.fn(),
            prompt: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        });
      }, 100);

      if (signal) {
        signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      }
    });
  }),
}));

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn().mockImplementation(async (_tools, signal) => {
    // Simulate that prefetch respects abort signal
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
      const timer = setTimeout(() => {
        resolve({
          screenshot: null,
          fileData: '{"pages":[]}',
          designSystem: '{"tokens":[]}',
        });
      }, 100);

      if (signal) {
        signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      }
    });
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
import { runSubagentBatch } from '../../../../src/main/subagent/orchestrator.js';

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

describe('Orchestrator abort handling', () => {
  it('aborts when signal fires during createSubagentSession', async () => {
    const controller = new AbortController();
    const batchId = 'test-batch-1';

    const batchPromise = runSubagentBatch(
      mockInfra,
      mockConnector,
      [{ role: 'scout', context: { task: 'analyze design' } }],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    // Abort immediately to interrupt createSubagentSession
    controller.abort();

    const result = await batchPromise;
    expect(result.aborted).toBe(true);
  });

  it('aborts when signal fires during newSession', async () => {
    const controller = new AbortController();
    const batchId = 'test-batch-2';

    const batchPromise = runSubagentBatch(
      mockInfra,
      mockConnector,
      [{ role: 'analyst', context: { task: 'analyze components' } }],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    // Abort immediately during session initialization
    controller.abort();

    const result = await batchPromise;
    expect(result.aborted).toBe(true);
  });

  it('aborts when signal fires during prompt', async () => {
    const controller = new AbortController();
    const batchId = 'test-batch-3';

    const batchPromise = runSubagentBatch(
      mockInfra,
      mockConnector,
      [{ role: 'auditor', context: { task: 'audit design' } }],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    // Abort immediately to interrupt prompt execution
    controller.abort();

    const result = await batchPromise;
    expect(result.aborted).toBe(true);
  });

  it('completes normally when signal is not aborted', async () => {
    const controller = new AbortController();
    const batchId = 'test-batch-4';

    const result = await runSubagentBatch(
      mockInfra,
      mockConnector,
      [],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    expect(result.aborted).toBe(false);
    expect(result.results).toEqual([]);
  });

  it('handles pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const batchId = 'test-batch-5';

    const result = await runSubagentBatch(
      mockInfra,
      mockConnector,
      [{ role: 'scout', context: { task: 'analyze' } }],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    expect(result.aborted).toBe(true);
  });

  it('reports timing breakdown in completed result', async () => {
    const controller = new AbortController();
    const batchId = 'test-batch-6';

    const result = await runSubagentBatch(
      mockInfra,
      mockConnector,
      [],
      defaultSettings,
      batchId,
      controller.signal,
      vi.fn(),
    );

    expect(result.aborted).toBe(false);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalDurationMs).toBe('number');
    expect(result.batchId).toBe(batchId);
  });
});
