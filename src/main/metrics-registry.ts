/**
 * MetricsRegistry — test-observable runtime instrumentation for Bottega.
 *
 * Owns a bag of scalar counters (judge triggered/skipped/verdicts, tools,
 * turns) and assembles a full MetricsSnapshot by reading live state from
 * the injected deps (slotManager, wsServer, getJudgeInProgress) at capture
 * time. Kept isolated from UsageTracker so the two concerns don't couple:
 *   • UsageTracker = emit-only Axiom telemetry
 *   • MetricsRegistry = synchronous state observer for tests/QA harness
 *
 * Instantiated once in createAgentInfra (and in both index.ts test-mode
 * stubs). Exposed to tests via the BOTTEGA_AGENT_TEST gated IPC handlers
 * `test:get-metrics` / `test:reset-metrics`.
 *
 * See Fase 4 of docs/../plans/happy-marinating-sonnet.md for rationale,
 * and docs/test-metrics-schema.md for the wire contract (version 1).
 */

import type { FigmaWebSocketServer } from '../figma/websocket-server.js';
import type { RuleId } from './guardrails/types.js';
import type { RewindMetrics } from './rewind/metrics.js';
import type { SlotManager } from './slot-manager.js';

// ─── Public types ──────────────────────────────────────────────────────

export type JudgeSkipReason = 'no-connector' | 'no-mutations' | 'disabled';
export type JudgeVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** Known guardrails rule IDs + 'none' sentinel for non-matching evaluations. */
export type GuardrailsRuleIdMetric = RuleId | 'none';

export interface MetricsSnapshot {
  schemaVersion: 1;
  capturedAt: number;
  captureElapsedMs: number;
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    uptimeSec: number;
  };
  slots: Array<{
    id: string;
    fileKey: string | null;
    fileName: string | null;
    isStreaming: boolean;
    queueLength: number;
    turnIndex: number;
    lastCompletedTurnIndex: number;
    lastContextTokens: number | null;
    sessionToolHistorySize: number;
    lastTurnToolNames: string[];
    lastTurnMutatedNodeIdCount: number;
    judgeOverride: boolean | null;
    judgeInProgress: boolean;
  }>;
  judge: {
    inProgressSlotIds: string[];
    triggeredTotal: number;
    skippedTotal: number;
    skippedByReason: Partial<Record<JudgeSkipReason, number>>;
    verdictCounts: { PASS: number; FAIL: number; UNKNOWN: number };
  };
  tools: {
    callCount: number;
    errorCount: number;
    byName: Record<string, { calls: number; errors: number; totalDurationMs: number }>;
  };
  turns: {
    totalStarted: number;
    totalEnded: number;
  };
  guardrails: {
    evaluated: number;
    noMatch: number;
    /** Rule-B probe failures (WS/bridge error) — distinct from noMatch. */
    probeFailed: number;
    byRule: Record<string, { evaluated: number; blocked: number; allowed: number }>;
  };
  rewind: {
    captured: number;
    skipped: number;
    created: number;
    nonRestorable: number;
    restorableRatio: number;
    pruned: number;
    pluginProbeFailed: number;
    probeDeferred: number;
    restoreStarted: number;
    restoreCompleted: number;
    restoreFailed: number;
    undoRestore: { success: number; noToken: number; expired: number };
  };
  ws: {
    activeFileKey: string | null;
    connectedFiles: Array<{ fileKey: string | null; fileName: string; isActive: boolean }>;
  };
}

export interface MetricsRegistryDeps {
  slotManager: Pick<SlotManager, 'listSlots' | 'getSlot'>;
  wsServer: Pick<FigmaWebSocketServer, 'getConnectedFiles' | 'getActiveFileKey'>;
  getJudgeInProgress: () => ReadonlySet<string>;
}

// ─── Registry ──────────────────────────────────────────────────────────

interface ToolCounters {
  calls: number;
  errors: number;
  totalDurationMs: number;
}

export class MetricsRegistry implements RewindMetrics {
  // Counters owned by the registry. Snapshot reads are O(#slots + #tools).
  private judgeTriggered = 0;
  private judgeSkipped = 0;
  private judgeSkippedByReason = new Map<JudgeSkipReason, number>();
  private judgeVerdicts: Record<JudgeVerdict, number> = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  private toolCalls = 0;
  private toolErrors = 0;
  private toolByName = new Map<string, ToolCounters>();
  private turnsStarted = 0;
  private turnsEnded = 0;
  private guardrailsEvaluated = 0;
  private guardrailsNoMatch = 0;
  private guardrailsProbeFailed = 0;
  private guardrailsByRule = new Map<string, { evaluated: number; blocked: number; allowed: number }>();
  private rewindCaptured = 0;
  private rewindSkipped = 0;
  private rewindCheckpointsCreated = 0;
  private rewindCheckpointsNonRestorable = 0;
  private rewindPruned = 0;
  private rewindPluginProbeFailed = 0;
  private rewindProbeDeferred = 0;
  private rewindRestoreStarted = 0;
  private rewindRestoreCompleted = 0;
  private rewindRestoreFailed = 0;
  private rewindUndoRestore = { success: 0, noToken: 0, expired: 0 };

  recordJudgeTriggered(): void {
    this.judgeTriggered += 1;
  }

  recordJudgeSkipped(reason: JudgeSkipReason): void {
    this.judgeSkipped += 1;
    this.judgeSkippedByReason.set(reason, (this.judgeSkippedByReason.get(reason) ?? 0) + 1);
  }

  recordJudgeVerdict(verdict: JudgeVerdict): void {
    this.judgeVerdicts[verdict] += 1;
  }

  recordToolCall(name: string, durationMs: number, success: boolean): void {
    this.toolCalls += 1;
    if (!success) this.toolErrors += 1;
    const existing = this.toolByName.get(name);
    if (existing) {
      existing.calls += 1;
      existing.totalDurationMs += durationMs;
      if (!success) existing.errors += 1;
    } else {
      this.toolByName.set(name, {
        calls: 1,
        errors: success ? 0 : 1,
        totalDurationMs: durationMs,
      });
    }
  }

  recordTurnStart(): void {
    this.turnsStarted += 1;
  }

  recordTurnEnd(): void {
    this.turnsEnded += 1;
  }

  recordGuardrailsEvaluated(ruleId: GuardrailsRuleIdMetric): void {
    this.guardrailsEvaluated += 1;
    if (ruleId === 'none') {
      this.guardrailsNoMatch += 1;
      return;
    }
    const rec = this.guardrailsByRule.get(ruleId) ?? { evaluated: 0, blocked: 0, allowed: 0 };
    rec.evaluated += 1;
    this.guardrailsByRule.set(ruleId, rec);
  }

  recordGuardrailsBlocked(ruleId: Exclude<GuardrailsRuleIdMetric, 'none'>): void {
    const rec = this.guardrailsByRule.get(ruleId) ?? { evaluated: 0, blocked: 0, allowed: 0 };
    rec.blocked += 1;
    this.guardrailsByRule.set(ruleId, rec);
  }

  recordGuardrailsAllowed(ruleId: Exclude<GuardrailsRuleIdMetric, 'none'>): void {
    const rec = this.guardrailsByRule.get(ruleId) ?? { evaluated: 0, blocked: 0, allowed: 0 };
    rec.allowed += 1;
    this.guardrailsByRule.set(ruleId, rec);
  }

  recordGuardrailsProbeFailed(): void {
    this.guardrailsProbeFailed += 1;
  }

  recordRewindCaptured(): void {
    this.rewindCaptured += 1;
  }

  recordRewindSkipped(): void {
    this.rewindSkipped += 1;
  }

  recordRewindCheckpointCreated(nonRestorable: boolean): void {
    this.rewindCheckpointsCreated += 1;
    if (nonRestorable) this.rewindCheckpointsNonRestorable += 1;
  }

  recordRewindPruned(count = 1): void {
    this.rewindPruned += count;
  }

  recordRewindPluginProbeFailed(): void {
    this.rewindPluginProbeFailed += 1;
  }

  recordRewindProbeDeferred(): void {
    this.rewindProbeDeferred += 1;
  }

  recordRewindRestoreStarted(_fileKey: string): void {
    this.rewindRestoreStarted += 1;
  }

  recordRewindRestoreCompleted(_fileKey: string, _restored: number, _skipped: number, _ms: number): void {
    this.rewindRestoreCompleted += 1;
  }

  recordRewindRestoreFailed(_fileKey: string, _reason: string): void {
    this.rewindRestoreFailed += 1;
  }

  recordRewindUndoRestore(_fileKey: string, outcome: 'success' | 'no-token' | 'expired'): void {
    if (outcome === 'success') this.rewindUndoRestore.success += 1;
    else if (outcome === 'no-token') this.rewindUndoRestore.noToken += 1;
    else this.rewindUndoRestore.expired += 1;
  }

  reset(): void {
    this.judgeTriggered = 0;
    this.judgeSkipped = 0;
    this.judgeSkippedByReason.clear();
    this.judgeVerdicts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
    this.toolCalls = 0;
    this.toolErrors = 0;
    this.toolByName.clear();
    this.turnsStarted = 0;
    this.turnsEnded = 0;
    this.guardrailsEvaluated = 0;
    this.guardrailsNoMatch = 0;
    this.guardrailsProbeFailed = 0;
    this.guardrailsByRule.clear();
    this.rewindCaptured = 0;
    this.rewindSkipped = 0;
    this.rewindCheckpointsCreated = 0;
    this.rewindCheckpointsNonRestorable = 0;
    this.rewindPruned = 0;
    this.rewindPluginProbeFailed = 0;
    this.rewindProbeDeferred = 0;
    this.rewindRestoreStarted = 0;
    this.rewindRestoreCompleted = 0;
    this.rewindRestoreFailed = 0;
    this.rewindUndoRestore = { success: 0, noToken: 0, expired: 0 };
  }

  snapshot(deps: MetricsRegistryDeps): MetricsSnapshot {
    const t0 = performance.now();
    const capturedAt = Date.now();

    const mem = process.memoryUsage();
    const judgeInProgress = deps.getJudgeInProgress();

    // Slots: listSlots() returns SlotInfo; we enrich via getSlot() for
    // fields the public info doesn't expose (turnIndex, sessionToolHistory,
    // last-turn data, judgeOverride).
    const slotInfos = deps.slotManager.listSlots();
    const slots: MetricsSnapshot['slots'] = slotInfos.map((info) => {
      const slot = deps.slotManager.getSlot(info.id);
      return {
        id: info.id,
        fileKey: info.fileKey,
        fileName: info.fileName,
        isStreaming: info.isStreaming,
        queueLength: info.queueLength,
        turnIndex: slot?.turnIndex ?? 0,
        lastCompletedTurnIndex: slot?.lastCompletedTurnIndex ?? 0,
        lastContextTokens: slot?.lastContextTokens ?? null,
        sessionToolHistorySize: slot?.sessionToolHistory?.size ?? 0,
        lastTurnToolNames: slot?.lastTurnToolNames ? [...slot.lastTurnToolNames] : [],
        lastTurnMutatedNodeIdCount: slot?.lastTurnMutatedNodeIds?.length ?? 0,
        judgeOverride: slot?.judgeOverride ?? null,
        judgeInProgress: judgeInProgress.has(info.id),
      };
    });

    const skippedByReason: Record<string, number> = {};
    for (const [k, v] of this.judgeSkippedByReason) skippedByReason[k] = v;

    const toolByName: Record<string, ToolCounters> = {};
    for (const [k, v] of this.toolByName) {
      toolByName[k] = { calls: v.calls, errors: v.errors, totalDurationMs: v.totalDurationMs };
    }

    const connectedFiles = deps.wsServer.getConnectedFiles();
    const restorableRatio =
      this.rewindCheckpointsCreated > 0 ? 1 - this.rewindCheckpointsNonRestorable / this.rewindCheckpointsCreated : 0;

    return {
      schemaVersion: 1,
      capturedAt,
      captureElapsedMs: Math.round((performance.now() - t0) * 100) / 100,
      process: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        uptimeSec: Math.round(process.uptime()),
      },
      slots,
      judge: {
        inProgressSlotIds: [...judgeInProgress],
        triggeredTotal: this.judgeTriggered,
        skippedTotal: this.judgeSkipped,
        skippedByReason,
        verdictCounts: { ...this.judgeVerdicts },
      },
      tools: {
        callCount: this.toolCalls,
        errorCount: this.toolErrors,
        byName: toolByName,
      },
      turns: {
        totalStarted: this.turnsStarted,
        totalEnded: this.turnsEnded,
      },
      guardrails: {
        evaluated: this.guardrailsEvaluated,
        noMatch: this.guardrailsNoMatch,
        probeFailed: this.guardrailsProbeFailed,
        byRule: Object.fromEntries([...this.guardrailsByRule.entries()].map(([k, v]) => [k, { ...v }])),
      },
      rewind: {
        captured: this.rewindCaptured,
        skipped: this.rewindSkipped,
        created: this.rewindCheckpointsCreated,
        nonRestorable: this.rewindCheckpointsNonRestorable,
        restorableRatio,
        pruned: this.rewindPruned,
        pluginProbeFailed: this.rewindPluginProbeFailed,
        probeDeferred: this.rewindProbeDeferred,
        restoreStarted: this.rewindRestoreStarted,
        restoreCompleted: this.rewindRestoreCompleted,
        restoreFailed: this.rewindRestoreFailed,
        undoRestore: { ...this.rewindUndoRestore },
      },
      ws: {
        activeFileKey: deps.wsServer.getActiveFileKey(),
        connectedFiles: connectedFiles.map((c) => ({
          fileKey: c.fileKey,
          fileName: c.fileName,
          isActive: c.isActive,
        })),
      },
    };
  }
}
