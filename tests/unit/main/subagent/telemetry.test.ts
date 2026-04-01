/**
 * 10i. Telemetry unit tests — subagent track* methods
 */
import { describe, expect, it, vi } from 'vitest';

// Import the real UsageTracker to test its methods
import { UsageTracker } from '../../../../src/main/usage-tracker.js';

// Create a real tracker with a mock logger
function createRealTracker() {
  const logCalls: any[] = [];
  const mockLogger = {
    info: vi.fn((...args: any[]) => logCalls.push(args[0])),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const config = { sendDiagnostics: true, anonymousId: 'test' };
  const refs = {} as any;
  const tracker = new UsageTracker(mockLogger as any, config as any, refs);
  return { tracker, logCalls };
}

describe('Subagent Telemetry', () => {
  describe('trackSubagentBatchStart', () => {
    it('emits correct event with all fields', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackSubagentBatchStart({
        batchId: 'batch-1',
        batchSize: 3,
        roles: ['scout', 'analyst', 'auditor'],
      });
      const log = logCalls.find((c) => c.event === 'usage:subagent_batch_start');
      expect(log).toBeDefined();
      expect(log.batchId).toBe('batch-1');
      expect(log.batchSize).toBe(3);
      expect(log.roles).toEqual(['scout', 'analyst', 'auditor']);
    });

    it('includes turn context when provided', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackSubagentBatchStart({
        batchId: 'b1',
        batchSize: 1,
        roles: ['judge'],
        context: { promptId: 'p1', slotId: 's1', turnIndex: 3 },
      });
      const log = logCalls.find((c) => c.event === 'usage:subagent_batch_start');
      expect(log.promptId).toBe('p1');
      expect(log.slotId).toBe('s1');
      expect(log.turnIndex).toBe(3);
    });
  });

  describe('trackSubagentCompleted', () => {
    it('emits all required fields', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackSubagentCompleted({
        batchId: 'b1',
        subagentId: 'sub-1',
        role: 'scout',
        model: 'claude-haiku-4-5',
        durationMs: 5000,
        tokenUsage: { input: 1000, output: 500 },
        status: 'completed',
        toolCallCount: 3,
      });
      const log = logCalls.find((c) => c.event === 'usage:subagent_completed');
      expect(log).toBeDefined();
      expect(log.role).toBe('scout');
      expect(log.status).toBe('completed');
      expect(log.durationMs).toBe(5000);
      expect(log.toolCallCount).toBe(3);
    });

    it('redacts error messages', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackSubagentCompleted({
        batchId: 'b1',
        subagentId: 'sub-1',
        role: 'analyst',
        model: 'claude-sonnet-4-6',
        durationMs: 1000,
        tokenUsage: { input: 0, output: 0 },
        status: 'error',
        toolCallCount: 0,
        errorMessage: 'Auth failed with key sk-ant-secret12345678901234567890',
      });
      const log = logCalls.find((c) => c.event === 'usage:subagent_completed');
      expect(log.errorMessage).not.toContain('sk-ant-secret');
      expect(log.errorMessage).toContain('[REDACTED]');
    });
  });

  describe('trackSubagentBatchEnd', () => {
    it('emits accurate totals', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackSubagentBatchEnd({
        batchId: 'b1',
        totalDurationMs: 15000,
        totalTokens: 5000,
        completedCount: 2,
        errorCount: 1,
        abortedCount: 0,
      });
      const log = logCalls.find((c) => c.event === 'usage:subagent_batch_end');
      expect(log).toBeDefined();
      expect(log.completedCount).toBe(2);
      expect(log.errorCount).toBe(1);
      expect(log.abortedCount).toBe(0);
      expect(log.totalDurationMs).toBe(15000);
    });
  });

  describe('trackJudgeVerdict', () => {
    it('emits PASS variant', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackJudgeVerdict({
        batchId: 'b1',
        verdict: 'PASS',
        attempt: 1,
        maxAttempts: 2,
        failedCriteria: [],
        durationMs: 8000,
      });
      const log = logCalls.find((c) => c.event === 'usage:judge_verdict');
      expect(log.verdict).toBe('PASS');
      expect(log.failedCriteria).toEqual([]);
    });

    it('emits FAIL variant with failed criteria', () => {
      const { tracker, logCalls } = createRealTracker();
      tracker.trackJudgeVerdict({
        batchId: 'b1',
        verdict: 'FAIL',
        attempt: 2,
        maxAttempts: 3,
        failedCriteria: ['alignment', 'token_compliance'],
        durationMs: 12000,
      });
      const log = logCalls.find((c) => c.event === 'usage:judge_verdict');
      expect(log.verdict).toBe('FAIL');
      expect(log.failedCriteria).toEqual(['alignment', 'token_compliance']);
      expect(log.attempt).toBe(2);
    });
  });

  describe('trackSubagentAborted', () => {
    it('emits all 5 reason types', () => {
      const reasons = ['user_stop', 'timeout', 'slot_removed', 'model_switch', 'app_quit'] as const;
      for (const reason of reasons) {
        const { tracker, logCalls } = createRealTracker();
        tracker.trackSubagentAborted({
          batchId: 'b1',
          reason,
          completedCount: 1,
          totalCount: 3,
        });
        const log = logCalls.find((c) => c.event === 'usage:subagent_aborted');
        expect(log).toBeDefined();
        expect(log.reason).toBe(reason);
      }
    });
  });

  describe('disabled tracker', () => {
    it('does not emit when diagnostics disabled', () => {
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };
      const config = { sendDiagnostics: false, anonymousId: 'test' };
      const tracker = new UsageTracker(mockLogger as any, config as any, {} as any);
      tracker.trackSubagentBatchStart({ batchId: 'b1', batchSize: 1, roles: ['scout'] });
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });
});
