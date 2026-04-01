import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/compression/metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/compression/metrics.js')>();
  return { ...actual };
});

vi.mock('../../../../src/main/subagent/orchestrator.js', () => ({
  runSubagentBatch: vi.fn(),
}));

import type { SubagentSettings } from '../../../../src/main/subagent/config.js';
import { abortActiveJudge, runJudgeHarness } from '../../../../src/main/subagent/judge-harness.js';
import { runSubagentBatch } from '../../../../src/main/subagent/orchestrator.js';

const mockRunBatch = vi.mocked(runSubagentBatch);

const makeSlot = (overrides: any = {}) => ({
  id: 'slot-1',
  session: { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) },
  ...overrides,
});

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

const mockCallbacks = () => ({
  onProgress: vi.fn(),
  onVerdict: vi.fn(),
  onRetryStart: vi.fn(),
});

describe('Judge Harness', () => {
  describe('runJudgeHarness', () => {
    it('returns null when judgeMode is off', async () => {
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        { ...defaultSettings, judgeMode: 'off' },
        ['figma_set_fills'],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns null when judgeMode is ask', async () => {
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        { ...defaultSettings, judgeMode: 'ask' },
        ['figma_set_fills'],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns null when turn has no mutations', async () => {
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_screenshot', 'figma_get_file_data'],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns PASS verdict when judge passes', async () => {
      const verdict = {
        verdict: 'PASS' as const,
        criteria: [{ name: 'alignment', pass: true, finding: 'ok', evidence: 'verified' }],
        actionItems: [],
        summary: 'All good',
      };
      mockRunBatch.mockResolvedValueOnce({
        batchId: 'batch-1',
        results: [{ role: 'judge', subagentId: 'j1', status: 'completed', output: '{}', verdict, durationMs: 100 }],
        totalDurationMs: 100,
        aborted: false,
      });

      const cbs = mockCallbacks();
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_set_fills', 'figma_screenshot'],
        new AbortController().signal,
        cbs,
      );
      expect(result).toEqual(verdict);
      expect(cbs.onVerdict).toHaveBeenCalledWith(verdict, 1, 1);
    });

    it('returns FAIL verdict without retry when autoRetry is off', async () => {
      const verdict = {
        verdict: 'FAIL' as const,
        criteria: [{ name: 'alignment', pass: false, finding: 'bad', evidence: 'off by 2px' }],
        actionItems: ['Fix alignment'],
        summary: 'Failed',
      };
      mockRunBatch.mockResolvedValueOnce({
        batchId: 'batch-1',
        results: [{ role: 'judge', subagentId: 'j1', status: 'completed', output: '{}', verdict, durationMs: 100 }],
        totalDurationMs: 100,
        aborted: false,
      });

      const slot = makeSlot();
      const cbs = mockCallbacks();
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        slot as any,
        { ...defaultSettings, autoRetry: false },
        ['figma_set_fills'],
        new AbortController().signal,
        cbs,
      );
      expect(result?.verdict).toBe('FAIL');
      // No retry prompt sent to parent
      expect(slot.session.prompt).not.toHaveBeenCalled();
      expect(cbs.onRetryStart).not.toHaveBeenCalled();
    });

    it('retries on FAIL when autoRetry is enabled', async () => {
      const failVerdict = {
        verdict: 'FAIL' as const,
        criteria: [{ name: 'alignment', pass: false, finding: 'bad', evidence: 'off' }],
        actionItems: ['Fix it'],
        summary: 'Failed',
      };
      const passVerdict = {
        verdict: 'PASS' as const,
        criteria: [{ name: 'alignment', pass: true, finding: 'ok', evidence: 'verified' }],
        actionItems: [],
        summary: 'All good',
      };

      mockRunBatch
        .mockResolvedValueOnce({
          batchId: 'b1',
          results: [
            {
              role: 'judge',
              subagentId: 'j1',
              status: 'completed',
              output: '{}',
              verdict: failVerdict,
              durationMs: 100,
            },
          ],
          totalDurationMs: 100,
          aborted: false,
        })
        .mockResolvedValueOnce({
          batchId: 'b2',
          results: [
            {
              role: 'judge',
              subagentId: 'j2',
              status: 'completed',
              output: '{}',
              verdict: passVerdict,
              durationMs: 100,
            },
          ],
          totalDurationMs: 100,
          aborted: false,
        });

      const slot = makeSlot();
      const cbs = mockCallbacks();
      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        slot as any,
        { ...defaultSettings, autoRetry: true, maxRetries: 2 },
        ['figma_set_fills'],
        new AbortController().signal,
        cbs,
      );
      expect(result?.verdict).toBe('PASS');
      // Parent should have been prompted to fix
      expect(slot.session.prompt).toHaveBeenCalledTimes(1);
      expect(slot.session.prompt).toHaveBeenCalledWith(expect.stringContaining('Fix it'));
      // maxRetries=2 → 3 total attempts (1 initial + 2 retries)
      expect(cbs.onRetryStart).toHaveBeenCalledWith(2, 3);
    });

    it('returns null when batch is aborted', async () => {
      mockRunBatch.mockResolvedValueOnce({
        batchId: 'b1',
        results: [],
        totalDurationMs: 10,
        aborted: true,
      });

      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_set_fills'],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns null when judge result has no verdict', async () => {
      mockRunBatch.mockResolvedValueOnce({
        batchId: 'b1',
        results: [{ role: 'judge', subagentId: 'j1', status: 'error', error: 'timeout', durationMs: 100 }],
        totalDurationMs: 100,
        aborted: false,
      });

      const result = await runJudgeHarness(
        {} as any,
        {} as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_set_fills'],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });
  });

  describe('abortActiveJudge', () => {
    it('does not throw when no active judge exists', () => {
      expect(() => abortActiveJudge('nonexistent-slot')).not.toThrow();
    });
  });
});
