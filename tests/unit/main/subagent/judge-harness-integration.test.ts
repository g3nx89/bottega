/**
 * 10k. Integration tests — Judge Harness flow with mocked micro-judge orchestrator.
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
  runMicroJudgeBatch: vi.fn(),
}));

vi.mock('../../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn(() => []),
}));

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn(),
  formatBriefing: vi.fn(() => ''),
  prefetchForMicroJudges: vi.fn().mockResolvedValue({
    screenshot: null,
    fileData: null,
    designSystem: null,
    lint: null,
    libraryComponents: null,
    componentAnalysis: null,
  }),
}));

import { DEFAULT_SUBAGENT_SETTINGS, type SubagentSettings } from '../../../../src/main/subagent/config.js';
import { abortActiveJudge, runJudgeHarness } from '../../../../src/main/subagent/judge-harness.js';
import { runMicroJudgeBatch } from '../../../../src/main/subagent/orchestrator.js';
import type { MicroVerdict } from '../../../../src/main/subagent/types.js';

const mockRunMicroBatch = vi.mocked(runMicroJudgeBatch);

function makePassVerdicts(): MicroVerdict[] {
  return [
    {
      judgeId: 'alignment',
      pass: true,
      finding: 'Aligned',
      evidence: 'Verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'token_compliance',
      pass: true,
      finding: 'All tokens',
      evidence: 'Lint clean',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'visual_hierarchy',
      pass: true,
      finding: 'Clear',
      evidence: 'H1>H2>body',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'completeness',
      pass: true,
      finding: 'All present',
      evidence: 'Verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'consistency',
      pass: true,
      finding: 'Uniform',
      evidence: 'Verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'naming',
      pass: true,
      finding: 'Good',
      evidence: 'Verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'componentization',
      pass: true,
      finding: 'Good',
      evidence: 'Verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
  ];
}

function makeFailVerdicts(failedCriteria: string[] = ['token_compliance']): MicroVerdict[] {
  const verdicts = makePassVerdicts();
  for (const id of failedCriteria) {
    const idx = verdicts.findIndex((v) => v.judgeId === id);
    if (idx >= 0) {
      verdicts[idx] = {
        ...verdicts[idx]!,
        pass: false,
        finding: 'Hardcoded hex',
        evidence: '#FF0000',
        actionItems: ['Replace #FF0000 with --color-error token compliance fix'],
      };
    }
  }
  return verdicts;
}

const defaultSettings: SubagentSettings = {
  ...DEFAULT_SUBAGENT_SETTINGS,
  judgeMode: 'auto',
  autoRetry: false,
  maxRetries: 2,
};

function makeInfra() {
  return {
    queueManager: { getQueue: () => ({}) },
    wsServer: {},
    figmaAPI: {},
    designSystemCache: {},
    configManager: {},
  } as any;
}

function makeSlot() {
  return {
    id: 'slot-1',
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
    judgeOverride: null,
    lastTurnToolNames: [],
    sessionToolHistory: new Set<string>(['figma_setup_tokens']),
    taskStore: { create: vi.fn(), size: 0, list: vi.fn(() => []) },
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
    mockRunMicroBatch.mockResolvedValueOnce(makePassVerdicts());

    const cbs = makeCallbacks();
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      makeSlot(),
      defaultSettings,
      ['figma_set_fills', 'figma_screenshot'],
      [],
      new AbortController().signal,
      cbs,
    );

    expect(verdict?.verdict).toBe('PASS');
    expect(cbs.onVerdict).toHaveBeenCalledTimes(1);
    expect(cbs.onRetryStart).not.toHaveBeenCalled();
  });

  it('retry loop: FAIL → parent fixes → judge re-runs → PASS', async () => {
    // First run: FAIL on majority of criteria active in visual tier
    mockRunMicroBatch.mockResolvedValueOnce(makeFailVerdicts(['token_compliance', 'alignment', 'visual_hierarchy']));
    // Retry: only the failed judges re-run, now all PASS
    mockRunMicroBatch.mockResolvedValueOnce([
      {
        judgeId: 'token_compliance' as const,
        pass: true,
        finding: 'Fixed',
        evidence: 'OK',
        actionItems: [],
        status: 'evaluated' as const,
        durationMs: 100,
      },
      {
        judgeId: 'alignment' as const,
        pass: true,
        finding: 'Fixed',
        evidence: 'OK',
        actionItems: [],
        status: 'evaluated' as const,
        durationMs: 100,
      },
      {
        judgeId: 'visual_hierarchy' as const,
        pass: true,
        finding: 'Fixed',
        evidence: 'OK',
        actionItems: [],
        status: 'evaluated' as const,
        durationMs: 100,
      },
    ]);

    const slot = makeSlot();
    const cbs = makeCallbacks();
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 2 },
      ['figma_set_fills'],
      [],
      new AbortController().signal,
      cbs,
    );

    // Final verdict is PASS after retry
    expect(verdict?.verdict).toBe('PASS');
    // Parent was prompted to fix
    expect(slot.session.prompt).toHaveBeenCalledTimes(1);
    expect(slot.session.prompt).toHaveBeenCalledWith(expect.stringContaining('[JUDGE_RETRY]'));
    // maxRetries=2 → 3 total attempts; retry callback fires for attempt 2
    expect(cbs.onRetryStart).toHaveBeenCalledWith(2, 3);
    // Verdict callback fired twice (FAIL then PASS)
    expect(cbs.onVerdict).toHaveBeenCalledTimes(2);
  });

  it('retry exhaustion: FAIL × maxRetries → final FAIL shown', async () => {
    const failVerdicts = makeFailVerdicts(['token_compliance', 'alignment', 'visual_hierarchy']);
    // maxRetries=2 → 3 total attempts: initial + 2 retries
    const retryFail = makeFailVerdicts(['token_compliance', 'alignment', 'visual_hierarchy']);
    mockRunMicroBatch
      .mockResolvedValueOnce(failVerdicts)
      .mockResolvedValueOnce(retryFail)
      .mockResolvedValueOnce(retryFail);

    const slot = makeSlot();
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 2 },
      ['figma_set_fills'],
      [],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict?.verdict).toBe('FAIL');
    expect(slot.session.prompt).toHaveBeenCalledTimes(2); // 2 retry prompts
  });

  it('judge does NOT trigger for non-mutation tools', async () => {
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      makeSlot(),
      defaultSettings,
      ['figma_screenshot', 'figma_get_file_data', 'figma_status'],
      [],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict).toBeNull();
    expect(mockRunMicroBatch).not.toHaveBeenCalled();
  });

  it('judge with judgeMode off does NOT auto-trigger', async () => {
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      makeSlot(),
      { ...defaultSettings, judgeMode: 'off' },
      ['figma_set_fills'],
      [],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict).toBeNull();
    expect(mockRunMicroBatch).not.toHaveBeenCalled();
  });

  it('judgeOverride true triggers even with judgeMode off', async () => {
    mockRunMicroBatch.mockResolvedValueOnce(makePassVerdicts());

    const slot = makeSlot();
    slot.judgeOverride = true;
    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      slot,
      { ...defaultSettings, judgeMode: 'off' },
      ['figma_set_fills'],
      [],
      new AbortController().signal,
      makeCallbacks(),
    );

    expect(verdict?.verdict).toBe('PASS');
  });

  it('abortActiveJudge with no active judge is a no-op', () => {
    expect(() => abortActiveJudge('nonexistent')).not.toThrow();
  });

  it('parent agent error during retry exits loop gracefully', async () => {
    mockRunMicroBatch.mockResolvedValueOnce(
      makeFailVerdicts(['alignment', 'token_compliance', 'visual_hierarchy', 'consistency']),
    );

    const slot = makeSlot();
    slot.session.prompt.mockRejectedValueOnce(new Error('Model rate limited'));

    const verdict = await runJudgeHarness(
      makeInfra(),
      { fileKey: 'fk' } as any,
      slot,
      { ...defaultSettings, autoRetry: true, maxRetries: 3 },
      ['figma_set_fills'],
      [],
      new AbortController().signal,
      makeCallbacks(),
    );

    // Should return last FAIL verdict (retry loop exited on parent error)
    expect(verdict?.verdict).toBe('FAIL');
    // Only 1 micro-judge batch run (the retry was attempted but parent failed)
    expect(mockRunMicroBatch).toHaveBeenCalledTimes(1);
  });
});
