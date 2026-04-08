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
import type { SlotManager } from './slot-manager.js';

// ─── Public types ──────────────────────────────────────────────────────

export type JudgeSkipReason = 'no-connector' | 'no-mutations' | 'disabled';
export type JudgeVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

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

export class MetricsRegistry {
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
