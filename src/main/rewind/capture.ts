import { randomUUID } from 'node:crypto';
import type { Checkpoint, MutationSnapshot, RestorableKind, RewindSkipReason } from './types.js';

export interface TurnSeed {
  fileKey: string;
  prompt: string;
  turnIndex: number;
  promptId: string;
  sessionId: string;
}

export interface PendingMutationDraft {
  toolCallId: string;
  tool: string;
  input: Record<string, unknown>;
  nodeIds: string[];
  kind: RestorableKind;
  preState?: Record<string, unknown>;
  skipReason?: RewindSkipReason;
  capturedAt?: number;
}

export interface PendingMutationResolution {
  kind?: RestorableKind;
  preState?: Record<string, unknown>;
  skipReason?: RewindSkipReason;
}

interface SlotMeta {
  fileKey: string;
  sessionId: string;
  lastTurnIndex: number;
}

interface PendingMutationRecord {
  toolCallId: string;
  tool: string;
  input: Record<string, unknown>;
  nodeIds: string[];
  createdNodeIds?: string[];
  kind: RestorableKind;
  preState: Record<string, unknown>;
  skipReason?: RewindSkipReason;
  capturedAt: number;
  resolved: boolean;
}

interface ActiveTurn extends TurnSeed {
  slotId: string;
  started: boolean;
  executeTouched: boolean;
  pendingOrder: string[];
  pending: Map<string, PendingMutationRecord>;
}

function toSnapshot(record: PendingMutationRecord, executeTouched: boolean): MutationSnapshot {
  const unresolvedSkip =
    !record.resolved && record.kind === 'inverse-op' && !record.skipReason
      ? ('ws-timeout' as const)
      : record.skipReason;
  const snapshot: MutationSnapshot = {
    tool: record.tool,
    input: record.input,
    nodeIds: [...record.nodeIds],
    preState: { ...record.preState },
    kind: record.kind,
    capturedAt: record.capturedAt,
  };
  if (record.createdNodeIds && record.createdNodeIds.length > 0) snapshot.createdNodeIds = [...record.createdNodeIds];
  if (unresolvedSkip) snapshot.skipReason = unresolvedSkip;
  if (executeTouched) {
    snapshot.kind = 'non-restorable';
    snapshot.skipReason = snapshot.skipReason ?? 'execute';
  }
  return snapshot;
}

export class CaptureBuffer {
  private readonly slotMeta = new Map<string, SlotMeta>();
  private readonly activeTurns = new Map<string, ActiveTurn>();

  onSlotReady(slotId: string, fileKey: string, sessionId: string): void {
    this.slotMeta.set(slotId, { fileKey, sessionId, lastTurnIndex: this.slotMeta.get(slotId)?.lastTurnIndex ?? 0 });
  }

  onSlotClose(slotId: string): void {
    this.slotMeta.delete(slotId);
    this.activeTurns.delete(slotId);
  }

  getSessionId(slotId: string): string | null {
    return this.slotMeta.get(slotId)?.sessionId ?? null;
  }

  onTurnBegin(slotId: string, seed: TurnSeed): void {
    const meta = this.slotMeta.get(slotId);
    this.slotMeta.set(slotId, {
      fileKey: seed.fileKey,
      sessionId: seed.sessionId,
      lastTurnIndex: Math.max(seed.turnIndex, meta?.lastTurnIndex ?? 0),
    });
    this.activeTurns.set(slotId, {
      ...seed,
      slotId,
      started: false,
      executeTouched: false,
      pendingOrder: [],
      pending: new Map(),
    });
  }

  onAgentStart(slotId: string, fileKey: string): void {
    const current = this.activeTurns.get(slotId);
    if (current) {
      current.started = true;
      return;
    }

    const meta = this.slotMeta.get(slotId);
    const nextTurnIndex = (meta?.lastTurnIndex ?? 0) + 1;
    const sessionId = meta?.sessionId ?? slotId;
    this.slotMeta.set(slotId, { fileKey, sessionId, lastTurnIndex: nextTurnIndex });
    this.activeTurns.set(slotId, {
      slotId,
      fileKey,
      prompt: '',
      turnIndex: nextTurnIndex,
      promptId: randomUUID(),
      sessionId,
      started: true,
      executeTouched: false,
      pendingOrder: [],
      pending: new Map(),
    });
  }

  pushPending(slotId: string, draft: PendingMutationDraft): void {
    const turn = this.activeTurns.get(slotId);
    if (!turn) return;
    const record: PendingMutationRecord = {
      toolCallId: draft.toolCallId,
      tool: draft.tool,
      input: draft.input,
      nodeIds: [...draft.nodeIds],
      createdNodeIds: undefined,
      kind: draft.kind,
      preState: draft.preState ? { ...draft.preState } : {},
      skipReason: draft.skipReason,
      capturedAt: draft.capturedAt ?? Date.now(),
      resolved: !!draft.preState || draft.skipReason !== undefined || draft.kind === 'non-restorable',
    };
    turn.pending.set(draft.toolCallId, record);
    turn.pendingOrder.push(draft.toolCallId);
  }

  resolvePending(slotId: string, toolCallId: string, resolution: PendingMutationResolution): void {
    const record = this.activeTurns.get(slotId)?.pending.get(toolCallId);
    if (!record) return;
    if (resolution.kind) record.kind = resolution.kind;
    if (resolution.preState) record.preState = { ...resolution.preState };
    if (resolution.skipReason) record.skipReason = resolution.skipReason;
    record.resolved = true;
  }

  finalize(slotId: string, toolCallId: string, createdNodeIds: string[]): void {
    const record = this.activeTurns.get(slotId)?.pending.get(toolCallId);
    if (!record || createdNodeIds.length === 0) return;
    record.createdNodeIds = [...createdNodeIds];
  }

  markExecute(slotId: string): void {
    const turn = this.activeTurns.get(slotId);
    if (!turn) return;
    turn.executeTouched = true;
  }

  commit(slotId: string): Checkpoint | null {
    const turn = this.activeTurns.get(slotId);
    if (!turn) return null;
    this.activeTurns.delete(slotId);
    const meta = this.slotMeta.get(slotId);
    if (meta) meta.lastTurnIndex = Math.max(meta.lastTurnIndex, turn.turnIndex);

    if (turn.pendingOrder.length === 0) return null;

    const mutations = turn.pendingOrder
      .map((toolCallId) => turn.pending.get(toolCallId))
      .filter((record): record is PendingMutationRecord => !!record)
      .map((record) => toSnapshot(record, turn.executeTouched));

    let restorableCount = 0;
    let nonRestorableCount = 0;
    for (const mutation of mutations) {
      if (mutation.kind === 'inverse-op' && !mutation.skipReason) restorableCount += 1;
      else nonRestorableCount += 1;
    }

    return {
      id: randomUUID(),
      fileKey: turn.fileKey,
      sessionId: turn.sessionId,
      slotId,
      turnIndex: turn.turnIndex,
      prompt: turn.prompt.slice(0, 500),
      mutations,
      executeTouched: turn.executeTouched,
      timestamp: Date.now(),
      restorableCount,
      nonRestorableCount,
    };
  }
}
