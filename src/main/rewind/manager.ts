import { randomUUID } from 'node:crypto';
import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import type { FigmaWebSocketServer } from '../../figma/websocket-server.js';
import { extractCreatedNodeIds, extractTargetNodeIds } from '../mutation-tracker.js';
import type { OperationQueue } from '../operation-queue.js';
import { safeSend } from '../safe-send.js';
import { ScopedConnector } from '../scoped-connector.js';
import { isMutation } from '../tool-meta.js';
import { CaptureBuffer, type PendingMutationDraft } from './capture.js';
import { PROBE_TIMEOUT_MS } from './config.js';
import { NOOP_REWIND_METRICS, type RewindMetrics } from './metrics.js';
import { capturePreState } from './pre-state/index.js';
import { applyCheckpoint } from './restore.js';
import { RewindStore } from './store.js';
import type { Checkpoint, CheckpointSummary, MutationSnapshot, RestoreResult, RestoreScope } from './types.js';

const log = createChildLogger({ component: 'rewind-manager' });
const UNBOUND_FILE_KEY_SENTINEL = '__unbound__';

function initialSnapshotState(toolName: string): {
  kind: 'inverse-op' | 'non-restorable';
  skipReason?: 'unsupported' | 'execute';
} {
  if (toolName === 'figma_execute') return { kind: 'non-restorable', skipReason: 'execute' };
  if (toolName === 'figma_delete') return { kind: 'non-restorable', skipReason: 'unsupported' };
  return { kind: 'inverse-op' };
}

export interface RewindManagerDeps {
  store?: RewindStore;
  wsServer: Pick<FigmaWebSocketServer, 'getConnectedFiles' | 'isFileConnected' | 'sendCommand'>;
  metrics?: RewindMetrics;
  getWebContents?: (slotId: string) => Electron.WebContents | null;
  getQueue?: (fileKey: string) => OperationQueue;
  getConnector?: (fileKey: string) => IFigmaConnector;
}

interface UndoEntry {
  fileKey: string;
  mutations: MutationSnapshot[];
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

type UndoLookup = { status: 'found'; entry: UndoEntry } | { status: 'expired' } | { status: 'missing' };

const UNDO_TTL_MS = 300_000;

function failedRestore(error: string, restoredMutations = 0, skippedMutations = 0, undoToken?: string): RestoreResult {
  return { success: false, restoredMutations, skippedMutations, error, ...(undoToken ? { undoToken } : {}) };
}

export class RewindManager {
  private readonly capture = new CaptureBuffer();
  private readonly pendingCaptures = new Map<string, Set<Promise<void>>>();
  private readonly store: RewindStore;
  private readonly metrics: RewindMetrics;
  private enabled = true;
  private readonly probedFileKeys = new Set<string>();
  private readonly undoBuffer = new Map<string, UndoEntry>();

  constructor(private readonly deps: RewindManagerDeps) {
    this.metrics = deps.metrics ?? NOOP_REWIND_METRICS;
    this.store = deps.store ?? new RewindStore(undefined, undefined, this.metrics);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStore(): RewindStore {
    return this.store;
  }

  listCheckpoints(fileKey: string): CheckpointSummary[] {
    return this.store.listSummaries(fileKey);
  }

  previewCheckpoint(fileKey: string, checkpointId: string): Checkpoint | null {
    return this.store.getCheckpoint(fileKey, checkpointId);
  }

  resetProbeCache(fileKey?: string): void {
    if (fileKey) {
      this.probedFileKeys.delete(fileKey);
      return;
    }
    this.probedFileKeys.clear();
  }

  disable(slotId?: string, fileKey?: string): void {
    if (!this.enabled) return;
    this.enabled = false;
    const wc = this.resolveWebContents(slotId);
    if (wc) safeSend(wc, 'rewind:plugin-outdated', { fileKey: fileKey ?? null });
  }

  async clearCheckpoints(fileKey: string): Promise<{ success: boolean }> {
    await this.store.clear(fileKey);
    this.resetProbeCache(fileKey);
    for (const [undoToken, entry] of this.undoBuffer.entries()) {
      if (entry.fileKey !== fileKey) continue;
      clearTimeout(entry.timer);
      this.undoBuffer.delete(undoToken);
    }
    return { success: true };
  }

  onSlotReady(slotId: string, fileKey: string, sessionId: string): void {
    this.capture.onSlotReady(slotId, fileKey, sessionId);
  }

  onSlotClose(slotId: string): void {
    this.capture.onSlotClose(slotId);
    this.pendingCaptures.delete(slotId);
  }

  onTurnBegin(slotId: string, fileKey: string, prompt: string, turnIndex: number, promptId: string): void {
    if (!this.enabled || !this.isTrackableFileKey(fileKey)) return;
    this.capture.onTurnBegin(slotId, {
      fileKey,
      prompt,
      turnIndex,
      promptId,
      sessionId: this.capture.getSessionId(slotId) ?? slotId,
    });
  }

  onAgentStart(slotId: string, fileKey: string): void {
    if (!this.enabled || !this.isTrackableFileKey(fileKey)) return;
    this.capture.onAgentStart(slotId, fileKey);
  }

  async onSessionStart(slotId: string, fileKey: string, connector: IFigmaConnector): Promise<void> {
    if (!this.enabled || !this.isTrackableFileKey(fileKey) || this.probedFileKeys.has(fileKey)) return;
    const connectedFile = this.deps.wsServer.getConnectedFiles().find((entry) => entry.fileKey === fileKey);
    if (!connectedFile) {
      log.info({ slotId, fileKey }, 'rewind: probe deferred, no connected file for fileKey');
      this.metrics.recordRewindProbeDeferred();
      return;
    }
    this.probedFileKeys.add(fileKey);
    const probeNodeId = connectedFile.currentPageId;
    if (!probeNodeId) {
      log.warn({ slotId, fileKey }, 'rewind: missing probe node id');
      this.metrics.recordRewindPluginProbeFailed();
      this.disable(slotId, fileKey);
      return;
    }

    try {
      await Promise.race([
        connector.getNodeData(probeNodeId, ['name']),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`rewind probe timed out after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      log.warn({ err, slotId, fileKey }, 'rewind: plugin capability probe failed');
      this.metrics.recordRewindPluginProbeFailed();
      this.disable(slotId, fileKey);
    }
  }

  onToolCall(
    slotId: string,
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    connector: IFigmaConnector,
  ): void {
    if (!this.enabled || !isMutation(toolName)) return;

    const nodeIds = extractTargetNodeIds(toolName, input);
    if (toolName === 'figma_execute') {
      this.capture.markExecute(slotId);
    }
    const initial = initialSnapshotState(toolName);

    const draft: PendingMutationDraft = {
      toolCallId,
      tool: toolName,
      input,
      nodeIds,
      kind: initial.kind,
      skipReason: initial.skipReason,
    };
    this.capture.pushPending(slotId, draft);
    const captures = this.pendingCaptures.get(slotId) ?? new Set<Promise<void>>();
    this.pendingCaptures.set(slotId, captures);
    const capturePromise = capturePreState(toolName, input, connector)
      .then((result) => {
        this.capture.resolvePending(slotId, toolCallId, result);
      })
      .catch((err) => {
        log.warn({ err, slotId, toolName, toolCallId }, 'rewind: pre-state capture failed');
        this.capture.resolvePending(slotId, toolCallId, {
          kind: 'non-restorable',
          preState: {},
          skipReason: 'unsupported',
        });
      })
      .finally(() => {
        captures.delete(capturePromise);
        if (captures.size === 0) this.pendingCaptures.delete(slotId);
      });
    captures.add(capturePromise);
  }

  onToolResult(slotId: string, toolCallId: string, result: unknown): void {
    if (!this.enabled) return;
    this.capture.finalize(slotId, toolCallId, extractCreatedNodeIds(result));
  }

  async onAgentEnd(slotId: string): Promise<void> {
    if (!this.enabled) return;
    const captures = this.pendingCaptures.get(slotId);
    if (captures && captures.size > 0) {
      await Promise.allSettled([...captures]);
    }
    this.pendingCaptures.delete(slotId);
    const checkpoint = this.capture.commit(slotId);
    if (!checkpoint || checkpoint.mutations.length === 0) return;

    for (const mutation of checkpoint.mutations) {
      if (mutation.kind === 'inverse-op' && !mutation.skipReason) this.metrics.recordRewindCaptured();
      else this.metrics.recordRewindSkipped();
    }

    try {
      const { prunedCount } = await this.store.append(checkpoint.fileKey, checkpoint);
      this.metrics.recordRewindCheckpointCreated(checkpoint.executeTouched || checkpoint.restorableCount === 0);
      const wc = this.resolveWebContents(checkpoint.slotId);
      if (wc) {
        safeSend(wc, 'rewind:checkpoint-added', checkpoint.fileKey, {
          id: checkpoint.id,
          total: this.store.listSummaries(checkpoint.fileKey).length,
        });
        if (prunedCount > 0) {
          safeSend(wc, 'rewind:checkpoint-pruned', checkpoint.fileKey, { prunedCount });
        }
      }
    } catch (err) {
      log.warn({ err, slotId, fileKey: checkpoint.fileKey }, 'rewind: failed to append checkpoint');
    }
  }

  async restoreCheckpoint(fileKey: string, checkpointId: string, scope: RestoreScope): Promise<RestoreResult> {
    const startedAt = Date.now();
    this.metrics.recordRewindRestoreStarted(fileKey);

    try {
      const checkpoints = this.resolveCheckpointScope(fileKey, checkpointId, scope);
      if (checkpoints.length === 0) {
        this.metrics.recordRewindRestoreFailed(fileKey, 'checkpoint-not-found');
        return failedRestore('Checkpoint not found.');
      }

      const connector = this.resolveConnector(fileKey);
      const queue = this.resolveQueue(fileKey);
      let restoredMutations = 0;
      let skippedMutations = 0;
      const skipReasons: Partial<Record<import('./types.js').RewindSkipReason, number>> = {};
      const undoSnapshots: MutationSnapshot[] = [];

      const mergeSkipReasons = (extra: RestoreResult['skipReasons']): void => {
        if (!extra) return;
        for (const [reason, count] of Object.entries(extra)) {
          const key = reason as import('./types.js').RewindSkipReason;
          skipReasons[key] = (skipReasons[key] ?? 0) + (count ?? 0);
        }
      };

      for (const checkpoint of checkpoints) {
        const result = await applyCheckpoint(checkpoint, connector, queue, {
          registerUndoSnapshots: (_token, mutations) => {
            undoSnapshots.push(...mutations);
          },
        });
        restoredMutations += result.restoredMutations;
        skippedMutations += result.skippedMutations;
        mergeSkipReasons(result.skipReasons);
        if (result.error) {
          this.metrics.recordRewindRestoreFailed(fileKey, result.error);
          const partialToken = undoSnapshots.length > 0 ? this.setUndoEntry(fileKey, undoSnapshots) : undefined;
          const failed = failedRestore(result.error, restoredMutations, skippedMutations, partialToken);
          if (Object.keys(skipReasons).length > 0) failed.skipReasons = skipReasons;
          return failed;
        }
      }

      const undoToken = restoredMutations > 0 ? this.setUndoEntry(fileKey, undoSnapshots) : undefined;
      this.metrics.recordRewindRestoreCompleted(fileKey, restoredMutations, skippedMutations, Date.now() - startedAt);
      const result: RestoreResult = {
        success: restoredMutations > 0,
        restoredMutations,
        skippedMutations,
        undoToken,
      };
      if (Object.keys(skipReasons).length > 0) result.skipReasons = skipReasons;
      if (result.success) {
        const wc = this.resolveWebContents(checkpoints[0]?.slotId);
        if (wc) safeSend(wc, 'rewind:restored', fileKey, result);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.recordRewindRestoreFailed(fileKey, message);
      log.warn({ err, fileKey, checkpointId, scope }, 'rewind: restore failed');
      return failedRestore(message);
    }
  }

  async undoRestore(fileKey: string, undoToken: string): Promise<RestoreResult> {
    const lookup = this.readUndoEntry(undoToken);
    if (lookup.status === 'expired') {
      this.metrics.recordRewindUndoRestore(fileKey, 'expired');
      return failedRestore('Undo token expired.');
    }
    if (lookup.status === 'missing' || lookup.entry.fileKey !== fileKey) {
      this.metrics.recordRewindUndoRestore(fileKey, 'no-token');
      return failedRestore('Undo token not found.');
    }

    const entry = lookup.entry;
    this.deleteUndoEntry(undoToken);
    const connector = this.resolveConnector(fileKey);
    const queue = this.resolveQueue(fileKey);
    const checkpoint: Checkpoint = {
      id: undoToken,
      fileKey,
      sessionId: 'undo-restore',
      slotId: 'undo-restore',
      turnIndex: 0,
      prompt: 'undo restore',
      mutations: entry.mutations,
      executeTouched: false,
      timestamp: Date.now(),
      restorableCount: entry.mutations.length,
      nonRestorableCount: 0,
    };
    try {
      const result = await applyCheckpoint(checkpoint, connector, queue, {
        registerUndoSnapshots: () => {},
      });
      if (result.success) this.metrics.recordRewindUndoRestore(fileKey, 'success');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err, fileKey, undoToken }, 'rewind: undo restore failed');
      return failedRestore(message);
    }
  }

  private resolveWebContents(slotId?: string): Electron.WebContents | null {
    const resolved = this.deps.getWebContents?.(slotId ?? '');
    if (resolved && !resolved.isDestroyed()) return resolved;
    return null;
  }

  private isTrackableFileKey(fileKey: string): boolean {
    return !!fileKey && fileKey !== UNBOUND_FILE_KEY_SENTINEL;
  }

  private resolveConnector(fileKey: string): IFigmaConnector {
    if (this.deps.getConnector) return this.deps.getConnector(fileKey);
    return new ScopedConnector(this.deps.wsServer as FigmaWebSocketServer, fileKey);
  }

  private resolveQueue(fileKey: string): OperationQueue {
    if (!this.deps.getQueue) {
      throw new Error(`No operation queue available for fileKey ${fileKey}`);
    }
    return this.deps.getQueue(fileKey);
  }

  private resolveCheckpointScope(fileKey: string, checkpointId: string, scope: RestoreScope): Checkpoint[] {
    const summaries = this.store.listSummaries(fileKey);
    if (summaries.length === 0) return [];
    if (scope === 'last-turn') {
      if (summaries[0]?.id !== checkpointId) {
        log.warn(
          { checkpointId, mostRecent: summaries[0]?.id },
          'rewind: last-turn scope with mismatched checkpointId',
        );
        return [];
      }
      return summaries
        .slice(0, 1)
        .map((summary) => this.store.getCheckpoint(fileKey, summary.id))
        .filter((checkpoint): checkpoint is Checkpoint => checkpoint !== null);
    }
    const targetIndex = summaries.findIndex((summary) => summary.id === checkpointId);
    if (targetIndex < 0) return [];
    return summaries
      .slice(0, targetIndex + 1)
      .map((summary) => this.store.getCheckpoint(fileKey, summary.id))
      .filter((checkpoint): checkpoint is Checkpoint => checkpoint !== null);
  }

  private setUndoEntry(fileKey: string, mutations: MutationSnapshot[]): string {
    const undoToken = randomUUID();
    const timer = setTimeout(() => {
      this.deleteUndoEntry(undoToken);
    }, UNDO_TTL_MS);
    timer.unref?.();
    this.undoBuffer.set(undoToken, {
      fileKey,
      mutations,
      expiresAt: Date.now() + UNDO_TTL_MS,
      timer,
    });
    return undoToken;
  }

  private readUndoEntry(undoToken: string): UndoLookup {
    const entry = this.undoBuffer.get(undoToken);
    if (!entry) return { status: 'missing' };
    if (entry.expiresAt > Date.now()) return { status: 'found', entry };
    this.deleteUndoEntry(undoToken);
    return { status: 'expired' };
  }

  private deleteUndoEntry(undoToken: string): void {
    const entry = this.undoBuffer.get(undoToken);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.undoBuffer.delete(undoToken);
  }
}
