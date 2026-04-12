import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../../src/main/subagent/judge-registry.js', () => ({
  getJudgeDefinition: vi.fn().mockReturnValue({
    id: 'alignment',
    label: 'Alignment',
    description: 'Layout precision',
    defaultModel: 'claude-sonnet-4-6',
    defaultThinking: 'medium',
    tiers: new Set(['full', 'standard', 'visual']),
    dataNeeds: ['fileData'],
  }),
}));

vi.mock('../../../../src/main/subagent/system-prompts.js', () => ({
  getSystemPrompt: vi.fn().mockReturnValue('You are a subagent.'),
  getMicroJudgeSystemPrompt: vi.fn().mockReturnValue('You are a micro-judge.'),
  getMicroJudgeCriterionPrompt: vi.fn().mockReturnValue('Evaluate alignment.'),
}));

import type { SubagentSettings } from '../../../../src/main/subagent/config.js';
import { getJudgeDefinition } from '../../../../src/main/subagent/judge-registry.js';
import { aggregateResults, runMicroJudgeBatch, runSubagentBatch } from '../../../../src/main/subagent/orchestrator.js';
import { createSubagentSession } from '../../../../src/main/subagent/session-factory.js';
import {
  getMicroJudgeCriterionPrompt,
  getMicroJudgeSystemPrompt,
} from '../../../../src/main/subagent/system-prompts.js';
import type { MicroJudgeId, PrefetchedContext, SubagentResult } from '../../../../src/main/subagent/types.js';

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
  microJudges: {} as any,
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

  // ── Micro-Judge Batch (P-001 / P-003) ──────────────────────────────

  describe('runMicroJudgeBatch', () => {
    const mockCreateSubagentSession = vi.mocked(createSubagentSession);

    const microBatchInfra = {
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

    const microBatchSettings: SubagentSettings = {
      models: {
        scout: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
        analyst: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
        auditor: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
        judge: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      },
      judgeMode: 'auto',
      autoRetry: false,
      maxRetries: 2,
      microJudges: {} as any,
    };

    const emptyPrefetched: PrefetchedContext = {
      screenshot: null,
      fileData: '{"pages":[]}',
      designSystem: null,
      lint: null,
      libraryComponents: null,
      componentAnalysis: null,
      judgeEvidence: null,
    };

    /** Helper: create a mock session that emits a JSON verdict via subscribe, then resolves prompt. */
    function _makeMockSession(verdictJson: string, promptDelay = 0) {
      let subscribeCb: ((event: any) => void) | null = null;
      return {
        session: {
          subscribe: vi.fn((cb: any) => {
            subscribeCb = cb;
          }),
          newSession: vi.fn().mockResolvedValue(undefined),
          prompt: vi.fn().mockImplementation(async () => {
            if (promptDelay > 0) {
              await new Promise((resolve) => setTimeout(resolve, promptDelay));
            }
            // Emit text_delta events with the verdict JSON
            if (subscribeCb) {
              subscribeCb({
                assistantMessageEvent: { type: 'text_delta', delta: verdictJson },
              });
            }
          }),
          abort: vi.fn().mockResolvedValue(undefined),
        },
      };
    }

    const mockGetJudgeDefinition = vi.mocked(getJudgeDefinition);
    const mockGetMicroJudgeSystemPrompt = vi.mocked(getMicroJudgeSystemPrompt);
    const mockGetMicroJudgeCriterionPrompt = vi.mocked(getMicroJudgeCriterionPrompt);

    beforeEach(() => {
      mockCreateSubagentSession.mockReset();
      mockGetJudgeDefinition.mockReturnValue({
        id: 'alignment',
        label: 'Alignment',
        description: 'Layout precision',
        defaultModel: 'claude-haiku-4-5',
        tiers: new Set(['full', 'standard', 'visual']),
        dataNeeds: ['fileData'],
      } as any);
      mockGetMicroJudgeSystemPrompt.mockReturnValue('You are a micro-judge.');
      mockGetMicroJudgeCriterionPrompt.mockReturnValue('Evaluate this criterion.');
    });

    it('P-001: all judges launch simultaneously — createSubagentSession called for all before any prompt', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment', 'token_compliance', 'visual_hierarchy'];
      const sessionCreationOrder: number[] = [];
      const promptCallOrder: number[] = [];
      let callIndex = 0;

      mockCreateSubagentSession.mockImplementation(async () => {
        const idx = callIndex++;
        sessionCreationOrder.push(idx);
        const verdictJson = JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] });
        let subscribeCb: ((event: any) => void) | null = null;
        return {
          session: {
            subscribe: vi.fn((cb: any) => {
              subscribeCb = cb;
            }),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              promptCallOrder.push(idx);
              if (subscribeCb) {
                subscribeCb({ assistantMessageEvent: { type: 'text_delta', delta: verdictJson } });
              }
            }),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-parallel',
        new AbortController().signal,
        vi.fn(),
      );

      // All 3 sessions created
      expect(sessionCreationOrder).toHaveLength(3);
      // All 3 prompts called (one per judge)
      expect(promptCallOrder).toHaveLength(3);
      // createSubagentSession was called once per judge
      expect(mockCreateSubagentSession).toHaveBeenCalledTimes(3);
    });

    it('P-003: per-judge timeout returns timeout verdict while other judges complete normally', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment', 'token_compliance'];

      let callCount = 0;
      mockCreateSubagentSession.mockImplementation(async () => {
        const idx = callCount++;
        const verdictJson = JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] });
        let subscribeCb: ((event: any) => void) | null = null;

        return {
          session: {
            subscribe: vi.fn((cb: any) => {
              subscribeCb = cb;
            }),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              if (idx === 0) {
                // First judge hangs forever (simulates >30s timeout)
                // The per-judge AbortSignal.timeout(30_000) will abort this
                await new Promise((_resolve, reject) => {
                  // Listen for abort on the current context — the AbortSignal.timeout
                  // will cause the session.abort() which we simulate by rejecting
                  const timer = setTimeout(() => {}, 60_000);
                  // In real code, the judgeSignal abort handler calls session.abort()
                  // We simulate the timeout by throwing AbortError after a short delay
                  // Since we can't easily trigger AbortSignal.timeout in tests,
                  // we throw an AbortError directly
                  clearTimeout(timer);
                  const err = new DOMException('The operation was aborted', 'AbortError');
                  reject(err);
                });
              } else {
                // Second judge completes immediately
                if (subscribeCb) {
                  subscribeCb({ assistantMessageEvent: { type: 'text_delta', delta: verdictJson } });
                }
              }
            }),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-timeout',
        new AbortController().signal,
        vi.fn(),
      );

      expect(results).toHaveLength(2);

      // First judge: timed out / aborted — gets a skip verdict
      const timedOut = results.find((r) => r.judgeId === 'alignment')!;
      expect(timedOut.pass).toBe(true); // Timeout is a skip, not a fail
      expect(timedOut.status).toBe('timeout');

      // Second judge: completed normally
      const completed = results.find((r) => r.judgeId === 'token_compliance')!;
      expect(completed.pass).toBe(true);
      expect(completed.status).toBe('evaluated');
    });

    it('P-003: timeout verdict has correct structure (pass=true, status=timeout, finding text)', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment'];

      mockCreateSubagentSession.mockImplementation(async () => {
        return {
          session: {
            subscribe: vi.fn(),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              // Simulate AbortError from per-judge timeout
              const err = new DOMException('The operation was aborted', 'AbortError');
              throw err;
            }),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-timeout-struct',
        new AbortController().signal,
        vi.fn(),
      );

      expect(results).toHaveLength(1);
      const verdict = results[0];
      expect(verdict.judgeId).toBe('alignment');
      expect(verdict.pass).toBe(true); // Timeouts don't count as failures
      expect(verdict.status).toBe('timeout');
      expect(verdict.evidence).toBe('');
      expect(verdict.actionItems).toEqual([]);
      expect(verdict.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('parent signal abort stops all judges', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment', 'token_compliance', 'visual_hierarchy'];
      const controller = new AbortController();

      // Abort the parent signal before the batch runs
      controller.abort();

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-parent-abort',
        controller.signal,
        vi.fn(),
      );

      expect(results).toHaveLength(3);
      // All judges should be skipped due to parent abort
      for (const verdict of results) {
        expect(verdict.pass).toBe(true);
        expect(verdict.status).toBe('timeout');
      }
      // No sessions should have been created since signal was already aborted
      expect(mockCreateSubagentSession).not.toHaveBeenCalled();
    });

    it('parent signal abort during execution aborts in-flight judges', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment', 'token_compliance'];
      const controller = new AbortController();

      const abortFns: Array<ReturnType<typeof vi.fn>> = [];

      mockCreateSubagentSession.mockImplementation(async () => {
        const abortFn = vi.fn().mockResolvedValue(undefined);
        abortFns.push(abortFn);
        let subscribeCb: ((event: any) => void) | null = null;

        return {
          session: {
            subscribe: vi.fn((cb: any) => {
              subscribeCb = cb;
            }),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              // Abort the parent signal mid-execution
              controller.abort();
              // The judgeSignal (AbortSignal.any([signal, ...])) will be aborted
              // After prompt, the code checks judgeSignal.aborted and returns skip verdict
              if (subscribeCb) {
                subscribeCb({
                  assistantMessageEvent: {
                    type: 'text_delta',
                    delta: JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] }),
                  },
                });
              }
            }),
            abort: abortFn,
          },
        } as any;
      });

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-mid-abort',
        controller.signal,
        vi.fn(),
      );

      expect(results).toHaveLength(2);
      // Both judges should detect the aborted signal and return timeout/skip verdicts
      for (const verdict of results) {
        expect(verdict.pass).toBe(true);
        expect(verdict.status).toBe('timeout');
      }
    });

    it('successful judges return evaluated verdicts with correct judgeId', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment', 'naming'];

      mockCreateSubagentSession.mockImplementation(async () => {
        let subscribeCb: ((event: any) => void) | null = null;
        return {
          session: {
            subscribe: vi.fn((cb: any) => {
              subscribeCb = cb;
            }),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              if (subscribeCb) {
                subscribeCb({
                  assistantMessageEvent: {
                    type: 'text_delta',
                    delta: JSON.stringify({
                      pass: false,
                      finding: 'needs work',
                      evidence: 'misaligned',
                      actionItems: ['fix it'],
                    }),
                  },
                });
              }
            }),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-success',
        new AbortController().signal,
        vi.fn(),
      );

      expect(results).toHaveLength(2);
      expect(results[0].judgeId).toBe('alignment');
      expect(results[0].status).toBe('evaluated');
      expect(results[0].pass).toBe(false);
      expect(results[0].finding).toBe('needs work');
      expect(results[0].actionItems).toEqual(['fix it']);

      expect(results[1].judgeId).toBe('naming');
      expect(results[1].status).toBe('evaluated');
    });

    it('non-abort errors produce error verdicts', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment'];

      mockCreateSubagentSession.mockImplementation(async () => {
        return {
          session: {
            subscribe: vi.fn(),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      const results = await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-error',
        new AbortController().signal,
        vi.fn(),
      );

      expect(results).toHaveLength(1);
      const verdict = results[0];
      expect(verdict.judgeId).toBe('alignment');
      expect(verdict.pass).toBe(true); // Errors are skips, not failures
      expect(verdict.status).toBe('error');
      expect(verdict.finding).toBe('API rate limit exceeded');
    });

    it('fires progress events for spawned and completed judges', async () => {
      const judgeIds: MicroJudgeId[] = ['alignment'];
      const onProgress = vi.fn();

      mockCreateSubagentSession.mockImplementation(async () => {
        let subscribeCb: ((event: any) => void) | null = null;
        return {
          session: {
            subscribe: vi.fn((cb: any) => {
              subscribeCb = cb;
            }),
            newSession: vi.fn().mockResolvedValue(undefined),
            prompt: vi.fn().mockImplementation(async () => {
              if (subscribeCb) {
                subscribeCb({
                  assistantMessageEvent: {
                    type: 'text_delta',
                    delta: JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] }),
                  },
                });
              }
            }),
            abort: vi.fn().mockResolvedValue(undefined),
          },
        } as any;
      });

      await runMicroJudgeBatch(
        microBatchInfra,
        judgeIds,
        emptyPrefetched,
        microBatchSettings,
        'Create a button',
        'batch-progress',
        new AbortController().signal,
        onProgress,
      );

      // Should fire 'spawned' event
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'spawned', role: 'judge', summary: 'alignment' }),
      );
      // Should fire 'completed' event
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'completed', role: 'judge', summary: 'alignment:PASS' }),
      );
    });

    // Per-judge evidence slicing — the 4 "measurement" judges each receive
    // ONLY their relevant slice of JudgeEvidence. The other 4 judges never
    // see any evidence section. This block verifies the isolation.
    describe('judgeEvidence injection', () => {
      /** Build a full JudgeEvidence report with distinct markers per slice. */
      function buildFullEvidence(): any {
        return {
          alignment: {
            verdict: 'misaligned',
            tolerancePx: 4,
            siblingGroupsChecked: 1,
            findings: [
              {
                parentId: '1:1',
                parentName: 'Parent',
                axis: 'y',
                values: [0, 15, 0],
                maxDeviation: 15,
                nodeIds: ['1:2', '1:3', '1:4'],
              },
            ],
          },
          visual_hierarchy: {
            verdict: 'flat',
            textCount: 3,
            uniqueFontSizes: [14],
            uniqueFontStyles: ['Regular'],
            allSameStyle: true,
            samples: [],
          },
          consistency: {
            verdict: 'inconsistent',
            siblingGroupsChecked: 1,
            findings: [
              {
                parentId: '2:1',
                parentName: 'Cards',
                property: 'paddingTop',
                values: [16, 24, 16],
                nodeIds: ['2:2', '2:3', '2:4'],
              },
            ],
          },
          naming: {
            verdict: 'hasAutoNames',
            autoNamedFrames: [{ id: '3:1', name: 'Frame 1' }],
            framesWithoutAutoLayout: [],
          },
          targetNodeId: '1:1',
          nodeCount: 10,
        };
      }

      /**
       * Run a batch with capture: returns a map of judgeId → user prompt text
       * passed to session.prompt(). Uses getJudgeDefinition mockImplementation
       * so each judge id gets the right dataNeeds.
       */
      async function runBatchCapturingPrompts(
        judgeIds: MicroJudgeId[],
        prefetchedOverrides: Partial<PrefetchedContext>,
      ): Promise<Record<string, string>> {
        // Map each judge to its real dataNeeds shape
        const judgeDefs: Record<string, any> = {
          alignment: {
            id: 'alignment',
            dataNeeds: ['fileData', 'judgeEvidence'],
            defaultModel: 'claude-sonnet-4-6',
            defaultThinking: 'medium',
          },
          visual_hierarchy: {
            id: 'visual_hierarchy',
            dataNeeds: ['screenshot', 'designSystem', 'judgeEvidence'],
            defaultModel: 'claude-sonnet-4-6',
            defaultThinking: 'medium',
          },
          consistency: {
            id: 'consistency',
            dataNeeds: ['fileData', 'lint', 'judgeEvidence'],
            defaultModel: 'claude-sonnet-4-6',
            defaultThinking: 'medium',
          },
          naming: {
            id: 'naming',
            dataNeeds: ['fileData', 'judgeEvidence'],
            defaultModel: 'claude-haiku-4-5',
            defaultThinking: 'low',
          },
          completeness: {
            id: 'completeness',
            dataNeeds: ['screenshot', 'fileData'],
            defaultModel: 'claude-sonnet-4-6',
            defaultThinking: 'medium',
          },
          componentization: {
            id: 'componentization',
            dataNeeds: ['fileData', 'libraryComponents'],
            defaultModel: 'claude-haiku-4-5',
            defaultThinking: 'low',
          },
          token_compliance: {
            id: 'token_compliance',
            dataNeeds: ['lint', 'designSystem'],
            defaultModel: 'claude-haiku-4-5',
            defaultThinking: 'low',
          },
          design_quality: {
            id: 'design_quality',
            dataNeeds: ['screenshot'],
            defaultModel: 'claude-sonnet-4-6',
            defaultThinking: 'medium',
          },
        };
        mockGetJudgeDefinition.mockImplementation(((id: string) => judgeDefs[id]) as any);
        mockGetMicroJudgeCriterionPrompt.mockImplementation(((id: string) => `Evaluate ${id}.`) as any);

        // Capture user prompts per call. createSubagentSession is called once per judge.
        const calls: Array<{ judgeIdx: number; prompt: string }> = [];
        let idx = 0;
        mockCreateSubagentSession.mockImplementation(async () => {
          const myIdx = idx++;
          let subscribeCb: ((event: any) => void) | null = null;
          return {
            session: {
              subscribe: vi.fn((cb: any) => {
                subscribeCb = cb;
              }),
              newSession: vi.fn().mockResolvedValue(undefined),
              prompt: vi.fn().mockImplementation(async (userPrompt: string) => {
                calls.push({ judgeIdx: myIdx, prompt: userPrompt });
                if (subscribeCb) {
                  subscribeCb({
                    assistantMessageEvent: {
                      type: 'text_delta',
                      delta: JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] }),
                    },
                  });
                }
              }),
              abort: vi.fn().mockResolvedValue(undefined),
            },
          } as any;
        });

        const prefetched: PrefetchedContext = {
          screenshot: null,
          fileData: '{"pages":[]}',
          designSystem: '{"tokens":[]}',
          lint: 'lint-data',
          libraryComponents: null,
          componentAnalysis: null,
          judgeEvidence: null,
          ...prefetchedOverrides,
        };

        await runMicroJudgeBatch(
          microBatchInfra,
          judgeIds,
          prefetched,
          microBatchSettings,
          'Test turn',
          'batch-evidence',
          new AbortController().signal,
          vi.fn(),
        );

        // Map calls back to judgeId (order is preserved by Promise.all over judgeIds)
        const result: Record<string, string> = {};
        calls.sort((a, b) => a.judgeIdx - b.judgeIdx);
        for (let i = 0; i < judgeIds.length; i++) {
          result[judgeIds[i]!] = calls[i]?.prompt ?? '';
        }
        return result;
      }

      it('injects only the alignment slice into the alignment judge prompt', async () => {
        const evidence = buildFullEvidence();
        const prompts = await runBatchCapturingPrompts(['alignment', 'completeness'], { judgeEvidence: evidence });
        expect(prompts.alignment).toContain('## Pre-Computed Evidence');
        expect(prompts.alignment).toContain('"verdict": "misaligned"');
        expect(prompts.alignment).toContain('"maxDeviation": 15');
        // Other slices must NOT leak into alignment's prompt
        expect(prompts.alignment).not.toContain('"allSameStyle"');
        expect(prompts.alignment).not.toContain('"autoNamedFrames"');
        // Unchanged judge sees no evidence section at all
        expect(prompts.completeness).not.toContain('## Pre-Computed Evidence');
      });

      it('injects only the typography slice into visual_hierarchy', async () => {
        const evidence = buildFullEvidence();
        const prompts = await runBatchCapturingPrompts(['visual_hierarchy'], { judgeEvidence: evidence });
        expect(prompts.visual_hierarchy).toContain('"allSameStyle": true');
        expect(prompts.visual_hierarchy).toContain('"verdict": "flat"');
        expect(prompts.visual_hierarchy).not.toContain('"maxDeviation"');
        expect(prompts.visual_hierarchy).not.toContain('"paddingTop"');
      });

      it('injects only the consistency slice into consistency', async () => {
        const evidence = buildFullEvidence();
        const prompts = await runBatchCapturingPrompts(['consistency'], { judgeEvidence: evidence });
        expect(prompts.consistency).toContain('"property": "paddingTop"');
        expect(prompts.consistency).toContain('[\n        16,\n        24,\n        16\n      ]');
        expect(prompts.consistency).not.toContain('"allSameStyle"');
      });

      it('injects only the naming slice into naming', async () => {
        const evidence = buildFullEvidence();
        const prompts = await runBatchCapturingPrompts(['naming'], { judgeEvidence: evidence });
        expect(prompts.naming).toContain('"autoNamedFrames"');
        expect(prompts.naming).toContain('"Frame 1"');
        expect(prompts.naming).not.toContain('"maxDeviation"');
      });

      it('omits the evidence section when judgeEvidence is null', async () => {
        const prompts = await runBatchCapturingPrompts(['alignment'], { judgeEvidence: null });
        expect(prompts.alignment).not.toContain('## Pre-Computed Evidence');
      });

      it('does NOT inject evidence into componentization / design_quality / token_compliance / completeness', async () => {
        const evidence = buildFullEvidence();
        const prompts = await runBatchCapturingPrompts(
          ['componentization', 'design_quality', 'token_compliance', 'completeness'],
          { judgeEvidence: evidence },
        );
        for (const [, prompt] of Object.entries(prompts)) {
          expect(prompt).not.toContain('## Pre-Computed Evidence');
        }
      });

      it('caps the evidence slice at 6000 characters', async () => {
        // Build an alignment slice with 500 findings to blow past the 6KB cap
        const huge: any = buildFullEvidence();
        huge.alignment.findings = [];
        for (let i = 0; i < 500; i++) {
          huge.alignment.findings.push({
            parentId: `p${i}`,
            parentName: 'Parent' + i,
            axis: 'y',
            values: [0, 10, 0],
            maxDeviation: 10,
            nodeIds: [`${i}:1`, `${i}:2`, `${i}:3`],
          });
        }
        const prompts = await runBatchCapturingPrompts(['alignment'], { judgeEvidence: huge });
        const section = prompts.alignment.split('## Pre-Computed Evidence')[1] ?? '';
        // The section (everything from the header onward) should be ≤ ~6KB + header + newlines
        expect(section.length).toBeLessThanOrEqual(6200);
      });
    });
  });
});
