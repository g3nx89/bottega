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
import type { MicroJudgeId, MicroVerdict } from '../../../../src/main/subagent/types.js';

const mockRunMicroBatch = vi.mocked(runMicroJudgeBatch);

const makeSlot = (overrides: any = {}) => ({
  id: 'slot-1',
  session: { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) },
  judgeOverride: null,
  lastTurnToolNames: [],
  sessionToolHistory: new Set<string>(['figma_setup_tokens']),
  ...overrides,
});

const defaultSettings: SubagentSettings = {
  ...DEFAULT_SUBAGENT_SETTINGS,
  judgeMode: 'auto',
  autoRetry: false,
  maxRetries: 2,
};

const mockCallbacks = () => ({
  onProgress: vi.fn(),
  onVerdict: vi.fn(),
  onRetryStart: vi.fn(),
});

function makePassVerdicts(): MicroVerdict[] {
  return [
    {
      judgeId: 'alignment',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'token_compliance',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'visual_hierarchy',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'completeness',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'consistency',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'naming',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
    {
      judgeId: 'componentization',
      pass: true,
      finding: 'ok',
      evidence: 'verified',
      actionItems: [],
      status: 'evaluated',
      durationMs: 100,
    },
  ];
}

function makeFailVerdicts(): MicroVerdict[] {
  const verdicts = makePassVerdicts();
  // Fail majority (5/7) to ensure FAIL under majority-pass aggregation regardless of tier
  const failIds: MicroJudgeId[] = ['alignment', 'token_compliance', 'visual_hierarchy', 'consistency', 'naming'];
  for (const v of verdicts) {
    if (failIds.includes(v.judgeId)) {
      v.pass = false;
      v.finding = `bad ${v.judgeId}`;
      v.evidence = `evidence for ${v.judgeId}`;
      v.actionItems = [`Fix ${v.judgeId}`];
    }
  }
  return verdicts;
}

describe('Judge Harness', () => {
  describe('runJudgeHarness', () => {
    it('returns null when judgeMode is off', async () => {
      const result = await runJudgeHarness(
        {} as any,
        { fileKey: 'fk' } as any,
        makeSlot() as any,
        { ...defaultSettings, judgeMode: 'off' },
        ['figma_set_fills'],
        [],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns null when judgeOverride is false', async () => {
      const result = await runJudgeHarness(
        {} as any,
        { fileKey: 'fk' } as any,
        makeSlot({ judgeOverride: false }) as any,
        defaultSettings,
        ['figma_set_fills'],
        [],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns null when turn has no mutations', async () => {
      const result = await runJudgeHarness(
        {} as any,
        { fileKey: 'fk' } as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_screenshot', 'figma_get_file_data'],
        [],
        new AbortController().signal,
        mockCallbacks(),
      );
      expect(result).toBeNull();
    });

    it('returns PASS verdict when all micro-judges pass', async () => {
      mockRunMicroBatch.mockResolvedValueOnce(makePassVerdicts());

      const cbs = mockCallbacks();
      const infra = {
        queueManager: { getQueue: () => ({}) },
        wsServer: {},
        figmaAPI: {},
        designSystemCache: {},
        configManager: {},
      } as any;
      const result = await runJudgeHarness(
        infra,
        { fileKey: 'fk' } as any,
        makeSlot() as any,
        defaultSettings,
        ['figma_set_fills', 'figma_screenshot'],
        [],
        new AbortController().signal,
        cbs,
      );
      expect(result?.verdict).toBe('PASS');
      expect(cbs.onVerdict).toHaveBeenCalledTimes(1);
    });

    it('returns FAIL verdict without retry when autoRetry is off', async () => {
      mockRunMicroBatch.mockResolvedValueOnce(makeFailVerdicts());

      const slot = makeSlot();
      const cbs = mockCallbacks();
      const infra = {
        queueManager: { getQueue: () => ({}) },
        wsServer: {},
        figmaAPI: {},
        designSystemCache: {},
        configManager: {},
      } as any;
      const result = await runJudgeHarness(
        infra,
        { fileKey: 'fk' } as any,
        slot as any,
        { ...defaultSettings, autoRetry: false },
        ['figma_set_fills'],
        [],
        new AbortController().signal,
        cbs,
      );
      expect(result?.verdict).toBe('FAIL');
      // No retry prompt sent to parent
      expect(slot.session.prompt).not.toHaveBeenCalled();
      expect(cbs.onRetryStart).not.toHaveBeenCalled();
    });

    it('retries on FAIL when autoRetry is enabled', async () => {
      // First run: 5/7 fail. Retry fixes all 5 failed judges → PASS
      mockRunMicroBatch.mockResolvedValueOnce(makeFailVerdicts()).mockResolvedValueOnce([
        {
          judgeId: 'alignment' as const,
          pass: true,
          finding: 'fixed',
          evidence: 'ok',
          actionItems: [] as string[],
          status: 'evaluated' as const,
          durationMs: 100,
        },
        {
          judgeId: 'token_compliance' as const,
          pass: true,
          finding: 'fixed',
          evidence: 'ok',
          actionItems: [] as string[],
          status: 'evaluated' as const,
          durationMs: 100,
        },
        {
          judgeId: 'visual_hierarchy' as const,
          pass: true,
          finding: 'fixed',
          evidence: 'ok',
          actionItems: [] as string[],
          status: 'evaluated' as const,
          durationMs: 100,
        },
        {
          judgeId: 'consistency' as const,
          pass: true,
          finding: 'fixed',
          evidence: 'ok',
          actionItems: [] as string[],
          status: 'evaluated' as const,
          durationMs: 100,
        },
        {
          judgeId: 'naming' as const,
          pass: true,
          finding: 'fixed',
          evidence: 'ok',
          actionItems: [] as string[],
          status: 'evaluated' as const,
          durationMs: 100,
        },
      ]);

      const slot = makeSlot();
      const cbs = mockCallbacks();
      const infra = {
        queueManager: { getQueue: () => ({}) },
        wsServer: {},
        figmaAPI: {},
        designSystemCache: {},
        configManager: {},
      } as any;
      const result = await runJudgeHarness(
        infra,
        { fileKey: 'fk' } as any,
        slot as any,
        { ...defaultSettings, autoRetry: true, maxRetries: 2 },
        ['figma_set_fills'],
        [],
        new AbortController().signal,
        cbs,
      );
      expect(result?.verdict).toBe('PASS');
      // Parent should have been prompted to fix
      expect(slot.session.prompt).toHaveBeenCalledTimes(1);
      expect(slot.session.prompt).toHaveBeenCalledWith(expect.stringContaining('[JUDGE_RETRY]'));
      // maxRetries=2 → 3 total attempts; retry callback fires for attempt 2
      expect(cbs.onRetryStart).toHaveBeenCalledWith(2, 3);
    });
  });

  describe('abortActiveJudge', () => {
    it('does not throw when no active judge exists', () => {
      expect(() => abortActiveJudge('nonexistent-slot')).not.toThrow();
    });
  });
});
