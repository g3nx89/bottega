import { describe, expect, it, vi } from 'vitest';
import { MetricsRegistry } from '../../../src/main/metrics-registry.js';

/**
 * Unit tests for MetricsRegistry (Fase 4 / Task 4.11).
 *
 * The registry is a DI-style counter bag: it owns scalar counters + per-name
 * tool maps, and assembles a full snapshot by reading live state from injected
 * deps (slotManager, wsServer, getJudgeInProgress) at capture time.
 *
 * These tests stay focused on the counter math + snapshot assembly — nothing
 * in here needs a real AgentSession or Electron window.
 */

// ── Helpers ──────────────────────────────────────

function makeSlot(overrides: Partial<any> = {}): any {
  return {
    id: 'slot-1',
    fileKey: 'abc',
    fileName: 'Test.fig',
    isStreaming: false,
    modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    turnIndex: 3,
    lastCompletedTurnIndex: 2,
    lastContextTokens: 1234,
    sessionToolHistory: new Set<string>(['figma_screenshot', 'figma_set_fills']),
    lastTurnToolNames: ['figma_set_fills'],
    lastTurnMutatedNodeIds: ['1:2', '1:3'],
    judgeOverride: null,
    promptQueue: { length: 0 },
    ...overrides,
  };
}

function makeSlotInfo(slot: any): any {
  return {
    id: slot.id,
    fileKey: slot.fileKey,
    fileName: slot.fileName,
    isStreaming: slot.isStreaming,
    isConnected: true,
    modelConfig: slot.modelConfig,
    queueLength: slot.promptQueue.length,
    lastContextTokens: slot.lastContextTokens,
  };
}

function makeDeps(
  opts: {
    slots?: any[];
    judgeInProgress?: Set<string>;
    connectedFiles?: Array<{ fileKey: string; fileName: string; isActive: boolean }>;
    activeFileKey?: string | null;
  } = {},
) {
  const slots = opts.slots ?? [makeSlot()];
  const judgeInProgress = opts.judgeInProgress ?? new Set<string>();
  const connectedFiles = opts.connectedFiles ?? [{ fileKey: 'abc', fileName: 'Test.fig', isActive: true }];
  const activeFileKey = opts.activeFileKey ?? 'abc';

  const slotManager = {
    listSlots: vi.fn(() => slots.map(makeSlotInfo)),
    getSlot: vi.fn((id: string) => slots.find((s) => s.id === id)),
  } as any;

  const wsServer = {
    getConnectedFiles: vi.fn(() => connectedFiles),
    getActiveFileKey: vi.fn(() => activeFileKey),
  } as any;

  return {
    slotManager,
    wsServer,
    getJudgeInProgress: () => judgeInProgress as ReadonlySet<string>,
  };
}

// ── Tests ────────────────────────────────────────

describe('MetricsRegistry', () => {
  describe('snapshot() top-level shape', () => {
    it('returns schemaVersion: 1 plus all top-level keys', () => {
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(makeDeps());
      expect(snap.schemaVersion).toBe(1);
      expect(snap).toHaveProperty('capturedAt');
      expect(snap).toHaveProperty('captureElapsedMs');
      expect(snap).toHaveProperty('process');
      expect(snap).toHaveProperty('slots');
      expect(snap).toHaveProperty('judge');
      expect(snap).toHaveProperty('tools');
      expect(snap).toHaveProperty('turns');
      expect(snap).toHaveProperty('rewind');
      expect(snap).toHaveProperty('ws');
    });

    it('golden shape: Object.keys matches expected set (drift detector)', () => {
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(makeDeps());
      expect(Object.keys(snap).sort()).toEqual(
        [
          'schemaVersion',
          'capturedAt',
          'captureElapsedMs',
          'process',
          'slots',
          'judge',
          'tools',
          'turns',
          'guardrails',
          'rewind',
          'ws',
        ].sort(),
      );
      expect(Object.keys(snap.guardrails).sort()).toEqual(['evaluated', 'noMatch', 'probeFailed', 'byRule'].sort());
      expect(Object.keys(snap.rewind).sort()).toEqual(
        [
          'captured',
          'skipped',
          'created',
          'nonRestorable',
          'restorableRatio',
          'pruned',
          'pluginProbeFailed',
          'probeDeferred',
          'restoreStarted',
          'restoreCompleted',
          'restoreFailed',
          'undoRestore',
        ].sort(),
      );
      expect(Object.keys(snap.judge).sort()).toEqual(
        ['inProgressSlotIds', 'triggeredTotal', 'skippedTotal', 'skippedByReason', 'verdictCounts'].sort(),
      );
      expect(Object.keys(snap.tools).sort()).toEqual(['callCount', 'errorCount', 'byName'].sort());
      expect(Object.keys(snap.turns).sort()).toEqual(['totalStarted', 'totalEnded'].sort());
    });
  });

  describe('reset()', () => {
    it('zeroes counters while preserving registry identity', () => {
      const reg = new MetricsRegistry();
      reg.recordJudgeTriggered();
      reg.recordJudgeTriggered();
      reg.recordJudgeSkipped('no-connector');
      reg.recordJudgeVerdict('PASS');
      reg.recordToolCall('figma_set_fills', 42, true);
      reg.recordTurnStart();
      reg.recordTurnEnd();

      reg.reset();

      const snap = reg.snapshot(makeDeps());
      expect(snap.judge.triggeredTotal).toBe(0);
      expect(snap.judge.skippedTotal).toBe(0);
      expect(snap.judge.skippedByReason).toEqual({});
      expect(snap.judge.verdictCounts).toEqual({ PASS: 0, FAIL: 0, UNKNOWN: 0 });
      expect(snap.tools.callCount).toBe(0);
      expect(snap.tools.errorCount).toBe(0);
      expect(snap.tools.byName).toEqual({});
      expect(snap.turns.totalStarted).toBe(0);
      expect(snap.turns.totalEnded).toBe(0);
      expect(snap.rewind).toEqual({
        captured: 0,
        skipped: 0,
        created: 0,
        nonRestorable: 0,
        restorableRatio: 0,
        pruned: 0,
        pluginProbeFailed: 0,
        probeDeferred: 0,
        restoreStarted: 0,
        restoreCompleted: 0,
        restoreFailed: 0,
        undoRestore: { success: 0, noToken: 0, expired: 0 },
      });
    });
  });

  describe('recordJudgeSkipped()', () => {
    it('bumps skippedTotal + per-reason counter for each of the 3 reasons', () => {
      const reg = new MetricsRegistry();
      reg.recordJudgeSkipped('no-connector');
      reg.recordJudgeSkipped('no-connector');
      reg.recordJudgeSkipped('no-mutations');
      reg.recordJudgeSkipped('disabled');

      const snap = reg.snapshot(makeDeps());
      expect(snap.judge.skippedTotal).toBe(4);
      expect(snap.judge.skippedByReason).toEqual({
        'no-connector': 2,
        'no-mutations': 1,
        disabled: 1,
      });
    });
  });

  describe('recordJudgeVerdict()', () => {
    it('updates verdictCounts independently for PASS/FAIL/UNKNOWN', () => {
      const reg = new MetricsRegistry();
      reg.recordJudgeVerdict('PASS');
      reg.recordJudgeVerdict('PASS');
      reg.recordJudgeVerdict('PASS');
      reg.recordJudgeVerdict('FAIL');
      reg.recordJudgeVerdict('UNKNOWN');
      reg.recordJudgeVerdict('UNKNOWN');

      const snap = reg.snapshot(makeDeps());
      expect(snap.judge.verdictCounts).toEqual({ PASS: 3, FAIL: 1, UNKNOWN: 2 });
    });
  });

  describe('recordToolCall()', () => {
    it('accumulates calls/errors/totalDurationMs per tool name', () => {
      const reg = new MetricsRegistry();
      reg.recordToolCall('figma_set_fills', 100, true);
      reg.recordToolCall('figma_set_fills', 200, true);
      reg.recordToolCall('figma_set_fills', 50, false);
      reg.recordToolCall('figma_screenshot', 300, true);

      const snap = reg.snapshot(makeDeps());
      expect(snap.tools.callCount).toBe(4);
      expect(snap.tools.errorCount).toBe(1);
      expect(snap.tools.byName).toEqual({
        figma_set_fills: { calls: 3, errors: 1, totalDurationMs: 350 },
        figma_screenshot: { calls: 1, errors: 0, totalDurationMs: 300 },
      });
    });
  });

  describe('recordTurnStart / recordTurnEnd', () => {
    it('independently bumps totalStarted and totalEnded', () => {
      const reg = new MetricsRegistry();
      reg.recordTurnStart();
      reg.recordTurnStart();
      reg.recordTurnStart();
      reg.recordTurnEnd();
      reg.recordTurnEnd();

      const snap = reg.snapshot(makeDeps());
      expect(snap.turns.totalStarted).toBe(3);
      expect(snap.turns.totalEnded).toBe(2);
    });
  });

  describe('guardrails counters', () => {
    it('evaluated with real rule increments per-rule and total', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsEvaluated('bulk-delete');
      reg.recordGuardrailsEvaluated('bulk-delete');
      reg.recordGuardrailsEvaluated('detach-main-instance');
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails.evaluated).toBe(3);
      expect(snap.guardrails.noMatch).toBe(0);
      expect(snap.guardrails.byRule['bulk-delete']).toEqual({ evaluated: 2, blocked: 0, allowed: 0 });
      expect(snap.guardrails.byRule['detach-main-instance']).toEqual({ evaluated: 1, blocked: 0, allowed: 0 });
    });

    it("'none' increments noMatch without polluting byRule", () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsEvaluated('none');
      reg.recordGuardrailsEvaluated('none');
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails.evaluated).toBe(2);
      expect(snap.guardrails.noMatch).toBe(2);
      expect(snap.guardrails.byRule).toEqual({});
    });

    it('blocked and allowed record on existing ruleId', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsEvaluated('bulk-delete');
      reg.recordGuardrailsBlocked('bulk-delete');
      reg.recordGuardrailsAllowed('bulk-delete');
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails.byRule['bulk-delete']).toEqual({ evaluated: 1, blocked: 1, allowed: 1 });
    });

    it('blocked without prior evaluated still creates the record (defensive)', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsBlocked('main-ds-component');
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails.byRule['main-ds-component']).toEqual({ evaluated: 0, blocked: 1, allowed: 0 });
    });

    it('byRule snapshot is a plain object (not a Map)', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsEvaluated('bulk-delete');
      const snap = reg.snapshot(makeDeps());
      expect(Object.prototype.toString.call(snap.guardrails.byRule)).toBe('[object Object]');
    });

    it('recordGuardrailsProbeFailed increments probeFailed counter only', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsProbeFailed();
      reg.recordGuardrailsProbeFailed();
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails.probeFailed).toBe(2);
      expect(snap.guardrails.evaluated).toBe(0);
      expect(snap.guardrails.noMatch).toBe(0);
      expect(snap.guardrails.byRule).toEqual({});
    });

    it('reset() zeroes guardrails counters', () => {
      const reg = new MetricsRegistry();
      reg.recordGuardrailsEvaluated('bulk-delete');
      reg.recordGuardrailsBlocked('bulk-delete');
      reg.recordGuardrailsEvaluated('none');
      reg.recordGuardrailsProbeFailed();
      reg.reset();
      const snap = reg.snapshot(makeDeps());
      expect(snap.guardrails).toEqual({ evaluated: 0, noMatch: 0, probeFailed: 0, byRule: {} });
    });
  });

  describe('rewind counters', () => {
    it('captures skipped, pruned and probe failures independently', () => {
      const reg = new MetricsRegistry();
      reg.recordRewindCaptured();
      reg.recordRewindCaptured();
      reg.recordRewindSkipped();
      reg.recordRewindCheckpointCreated(false);
      reg.recordRewindCheckpointCreated(true);
      reg.recordRewindPruned(3);
      reg.recordRewindPluginProbeFailed();
      reg.recordRewindProbeDeferred();
      reg.recordRewindRestoreStarted('file-1');
      reg.recordRewindRestoreCompleted('file-1', 2, 1, 30);
      reg.recordRewindRestoreFailed('file-1', 'node-not-found');
      reg.recordRewindUndoRestore('file-1', 'success');
      reg.recordRewindUndoRestore('file-1', 'expired');

      const snap = reg.snapshot(makeDeps());
      expect(snap.rewind).toEqual({
        captured: 2,
        skipped: 1,
        created: 2,
        nonRestorable: 1,
        restorableRatio: 0.5,
        pruned: 3,
        pluginProbeFailed: 1,
        probeDeferred: 1,
        restoreStarted: 1,
        restoreCompleted: 1,
        restoreFailed: 1,
        undoRestore: { success: 1, noToken: 0, expired: 1 },
      });
    });

    it('computes created, nonRestorable and restorableRatio from 3 checkpoints', () => {
      const reg = new MetricsRegistry();
      reg.recordRewindCheckpointCreated(false);
      reg.recordRewindCheckpointCreated(false);
      reg.recordRewindCheckpointCreated(true);

      const snap = reg.snapshot(makeDeps());
      expect(snap.rewind.created).toBe(3);
      expect(snap.rewind.nonRestorable).toBe(1);
      expect(snap.rewind.restorableRatio).toBeCloseTo(2 / 3, 3);
    });
  });

  describe('snapshot.process', () => {
    it('returns rss, heap, and uptime in sane ranges', () => {
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(makeDeps());
      expect(snap.process.rssBytes).toBeGreaterThan(0);
      expect(snap.process.heapUsedBytes).toBeGreaterThan(0);
      expect(snap.process.heapTotalBytes).toBeGreaterThanOrEqual(snap.process.heapUsedBytes);
      expect(snap.process.externalBytes).toBeGreaterThanOrEqual(0);
      expect(snap.process.uptimeSec).toBeGreaterThanOrEqual(0);
    });
  });

  describe('snapshot.slots', () => {
    it('mirrors slotManager.listSlots() ordering and enriches via getSlot()', () => {
      const slotA = makeSlot({ id: 'a', fileKey: 'fkA' });
      const slotB = makeSlot({ id: 'b', fileKey: 'fkB', turnIndex: 5, isStreaming: true });
      const slotC = makeSlot({ id: 'c', fileKey: null });
      const judgeInProgress = new Set(['b']);
      const deps = makeDeps({ slots: [slotA, slotB, slotC], judgeInProgress });
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(deps);

      expect(snap.slots).toHaveLength(3);
      expect(snap.slots.map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c']);
      expect(snap.slots[1]).toMatchObject({
        id: 'b',
        fileKey: 'fkB',
        turnIndex: 5,
        isStreaming: true,
        judgeInProgress: true,
        lastContextTokens: 1234,
        sessionToolHistorySize: 2,
        lastTurnToolNames: ['figma_set_fills'],
        lastTurnMutatedNodeIdCount: 2,
        judgeOverride: null,
      });
      expect(snap.slots[0].judgeInProgress).toBe(false);
    });
  });

  describe('snapshot.ws', () => {
    it('derives activeFileKey and connectedFiles from wsServer', () => {
      const deps = makeDeps({
        connectedFiles: [
          { fileKey: 'fkA', fileName: 'A.fig', isActive: false },
          { fileKey: 'fkB', fileName: 'B.fig', isActive: true },
        ],
        activeFileKey: 'fkB',
      });
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(deps);
      expect(snap.ws.activeFileKey).toBe('fkB');
      expect(snap.ws.connectedFiles).toHaveLength(2);
      expect(snap.ws.connectedFiles.map((c: { fileKey: string | null }) => c.fileKey)).toEqual(['fkA', 'fkB']);
    });
  });

  describe('snapshot.judge.inProgressSlotIds', () => {
    it('reflects getJudgeInProgress() set as a sorted array', () => {
      const judgeInProgress = new Set(['slot-2', 'slot-1']);
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(makeDeps({ judgeInProgress }));
      expect(snap.judge.inProgressSlotIds.sort()).toEqual(['slot-1', 'slot-2']);
    });
  });

  describe('snapshot() smoke perf', () => {
    it('<10ms mean on 100 iterations', () => {
      const reg = new MetricsRegistry();
      const deps = makeDeps();
      // Warm
      for (let i = 0; i < 5; i++) reg.snapshot(deps);

      const runs = 100;
      const start = performance.now();
      for (let i = 0; i < runs; i++) reg.snapshot(deps);
      const elapsed = performance.now() - start;
      const mean = elapsed / runs;
      expect(mean).toBeLessThan(10);
    });
  });

  describe('snapshot.slots[i].lastContextTokens (DD-3)', () => {
    it('is null when slot.lastContextTokens is undefined', () => {
      const slot = makeSlot();
      delete slot.lastContextTokens;
      const reg = new MetricsRegistry();
      const snap = reg.snapshot(makeDeps({ slots: [slot] }));
      expect(snap.slots[0].lastContextTokens).toBeNull();
    });
  });
});
