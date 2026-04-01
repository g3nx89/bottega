/**
 * 10k. Integration tests — Judge Harness flow with mocked orchestrator.
 *
 * Tests the full judge lifecycle: trigger → run → verdict → retry → final verdict.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { JudgeVerdict } from '../../../../src/main/subagent/types.js';

const mockRunBatch = vi.mocked(runSubagentBatch);

function makePassVerdict(): JudgeVerdict {
  return {
    verdict: 'PASS',
    criteria: [
      { name: 'alignment', pass: true, finding: 'Aligned', evidence: 'Verified' },
      { name: 'token_compliance', pass: true, finding: 'All tokens', evidence: 'Lint clean' },
      { name: 'visual_hierarchy', pass: true, finding: 'Clear', evidence: 'H1>H2>body' },
      { name: 'completeness', pass: true, finding: 'All present', evidence: 'Verified' },
      { name: 'consistency', pass: true, finding: 'Uniform', evidence: 'Verified' },
    ],
    actionItems: [],
    summary: 'All 5 criteria pass.',
  };
}

function makeFailVerdict(failedCriteria: string[] = ['token_compliance']): JudgeVerdict {
  return {
    verdict: 'FAIL',
    criteria: [
      { name: 'alignment', pass: true, finding: 'Aligned', evidence: 'OK' },
      {
        name: 'token_compliance',
        pass: !failedCriteria.includes('token_compliance'),
        finding: 'Hardcoded hex',
        evidence: '#FF0000',
      },
      { name: 'visual_hierarchy', pass: true, finding: 'Clear', evidence: 'OK' },
      { name: 'completeness', pass: true, finding: 'Complete', evidence: 'OK' },
      {
        name: 'consistency',
        pass: !failedCriteria.includes('consistency'),
        finding: 'Inconsistent',
        evidence: 'padding varies',
      },
    ],
    actionItems: ['Replace #FF0000 with --color-error token'],
    summary: 'FAIL: token_compliance violated.',
  };
}

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

function makeSlot() {
  return {
    id: 'slot-1',
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function makeCallbacks() {
  return {
    onProgress: vi.fn(),
    onVerdict: vi.fn(),
    onRetryStart: vi.fn(),
  };
}

describe('Judge Harness Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('full auto-judge flow: mutation turn → judge triggers → PASS verdict', async () => {
    const passVerdict = makePassVerdict();
    mockRunBatch.mockResolvedValueOnce({
      batchId: 'b1',
      results: [
        { role: 'judge', subagentId: 'j1', status: 'completed', output: '{}', verdict: passVerdict, durationMs: 5000 },
      ],
      totalDurationMs: 5000,
      aborted: false,
    });

    const cbs = makeCallbacks();
    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      makeSlot(),
      defaultSettings,
      ['figma_set_fills', 'figma_screenshot'],
      new AbortController().signal,
      cbs,
    );

    expect(verdict).toEqual(passVerdict);
    expect(cbs.onVerdict).toHaveBeenCalledWith(passVerdict, 1, 1);
    expect(cbs.onRetryStart).not.toHaveBeenCalled();
  });

  it('retry loop: FAIL → parent fixes → judge re-runs → PASS', async () => {
    const failVerdict = makeFailVerdict();
    const passVerdict = makePassVerdict();

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
            durationMs: 5000,
          },
        ],
        totalDurationMs: 5000,
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
            durationMs: 4000,
          },
        ],
        totalDurationMs: 4000,
        aborted: false,
      });

    const slot = makeSlot();
    const cbs = makeCallbacks();
    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 2 },
      ['figma_set_fills'],
      new AbortController().signal,
      cbs,
    );

    // Final verdict is PASS after retry
    expect(verdict?.verdict).toBe('PASS');
    // Parent was prompted to fix
    expect(slot.session.prompt).toHaveBeenCalledTimes(1);
    expect(slot.session.prompt).toHaveBeenCalledWith(expect.stringContaining('Replace #FF0000'));
    // maxRetries=2 → 3 total attempts; retry callback fires for attempt 2
    expect(cbs.onRetryStart).toHaveBeenCalledWith(2, 3);
    // Verdict callback fired twice (FAIL then PASS)
    expect(cbs.onVerdict).toHaveBeenCalledTimes(2);
  });

  it('retry exhaustion: FAIL × maxRetries → final FAIL shown', async () => {
    const failVerdict = makeFailVerdict();

    // maxRetries=2 → 3 total attempts: initial + 2 retries = 3 judge runs
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
            durationMs: 5000,
          },
        ],
        totalDurationMs: 5000,
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
            verdict: failVerdict,
            durationMs: 5000,
          },
        ],
        totalDurationMs: 5000,
        aborted: false,
      })
      .mockResolvedValueOnce({
        batchId: 'b3',
        results: [
          {
            role: 'judge',
            subagentId: 'j3',
            status: 'completed',
            output: '{}',
            verdict: failVerdict,
            durationMs: 5000,
          },
        ],
        totalDurationMs: 5000,
        aborted: false,
      });

    const slot = makeSlot();
    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 2 },
      ['figma_set_fills'],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict?.verdict).toBe('FAIL');
    expect(slot.session.prompt).toHaveBeenCalledTimes(2); // 2 retry prompts
  });

  it('judge does NOT trigger for non-mutation tools', async () => {
    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      makeSlot(),
      defaultSettings,
      ['figma_screenshot', 'figma_get_file_data', 'figma_status'],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict).toBeNull();
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it('judge with ask mode does NOT auto-trigger', async () => {
    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      makeSlot(),
      { ...defaultSettings, judgeMode: 'ask' },
      ['figma_set_fills'],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict).toBeNull();
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it('abort during judge execution returns null', async () => {
    const controller = new AbortController();
    mockRunBatch.mockResolvedValueOnce({
      batchId: 'b1',
      results: [],
      totalDurationMs: 0,
      aborted: true,
    });

    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      makeSlot(),
      defaultSettings,
      ['figma_set_fills'],
      controller.signal,
      makeCallbacks(),
    );

    expect(verdict).toBeNull();
  });

  it('abortActiveJudge with no active judge is a no-op', () => {
    expect(() => abortActiveJudge('nonexistent')).not.toThrow();
  });

  it('parent agent error during retry exits loop gracefully', async () => {
    const failVerdict = makeFailVerdict();
    mockRunBatch.mockResolvedValueOnce({
      batchId: 'b1',
      results: [
        { role: 'judge', subagentId: 'j1', status: 'completed', output: '{}', verdict: failVerdict, durationMs: 5000 },
      ],
      totalDurationMs: 5000,
      aborted: false,
    });

    const slot = makeSlot();
    slot.session.prompt.mockRejectedValueOnce(new Error('Model rate limited'));

    const verdict = await runJudgeHarness(
      {} as any,
      {} as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 3 },
      ['figma_set_fills'],
      new AbortController().signal,
      makeCallbacks(),
    );

    // Should return last FAIL verdict (retry loop exited on parent error)
    expect(verdict?.verdict).toBe('FAIL');
    // Only 1 judge run (the retry was attempted but parent failed)
    expect(mockRunBatch).toHaveBeenCalledTimes(1);
  });
});
