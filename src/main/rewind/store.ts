import { chmodSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../../figma/logger.js';
import { atomicWriteJsonSync, readJsonOrQuarantine } from '../fs-utils.js';
import { MAX_CHECKPOINTS, SCHEMA_VERSION, STORAGE_ROOT } from './config.js';
import { NOOP_REWIND_METRICS, type RewindMetrics } from './metrics.js';
import type { Checkpoint, CheckpointIndex, CheckpointSummary } from './types.js';
import { assertPathWithin, validateCheckpointId, validateFileKey } from './validation.js';

const log = createChildLogger({ component: 'rewind-store' });

function isCheckpointSummary(value: unknown): value is CheckpointSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary.id === 'string' &&
    typeof summary.fileKey === 'string' &&
    typeof summary.slotId === 'string' &&
    typeof summary.turnIndex === 'number' &&
    typeof summary.prompt === 'string' &&
    typeof summary.timestamp === 'number' &&
    typeof summary.restorableCount === 'number' &&
    typeof summary.nonRestorableCount === 'number' &&
    typeof summary.executeTouched === 'boolean'
  );
}

function isCheckpointIndex(value: unknown): value is CheckpointIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Record<string, unknown>;
  return (
    index.version === SCHEMA_VERSION &&
    typeof index.fileKey === 'string' &&
    Array.isArray(index.entries) &&
    index.entries.every(isCheckpointSummary)
  );
}

function isMutationSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const snap = value as Record<string, unknown>;
  return (
    typeof snap.tool === 'string' &&
    !!snap.input &&
    typeof snap.input === 'object' &&
    Array.isArray(snap.nodeIds) &&
    !!snap.preState &&
    typeof snap.preState === 'object' &&
    typeof snap.kind === 'string' &&
    typeof snap.capturedAt === 'number'
  );
}

function isCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Record<string, unknown>;
  return (
    typeof checkpoint.id === 'string' &&
    typeof checkpoint.fileKey === 'string' &&
    typeof checkpoint.sessionId === 'string' &&
    typeof checkpoint.slotId === 'string' &&
    typeof checkpoint.turnIndex === 'number' &&
    typeof checkpoint.prompt === 'string' &&
    Array.isArray(checkpoint.mutations) &&
    checkpoint.mutations.every(isMutationSnapshot) &&
    typeof checkpoint.executeTouched === 'boolean' &&
    typeof checkpoint.timestamp === 'number' &&
    typeof checkpoint.restorableCount === 'number' &&
    typeof checkpoint.nonRestorableCount === 'number'
  );
}

function checkpointToSummary(checkpoint: Checkpoint): CheckpointSummary {
  return {
    id: checkpoint.id,
    fileKey: checkpoint.fileKey,
    slotId: checkpoint.slotId,
    turnIndex: checkpoint.turnIndex,
    prompt: checkpoint.prompt,
    timestamp: checkpoint.timestamp,
    restorableCount: checkpoint.restorableCount,
    nonRestorableCount: checkpoint.nonRestorableCount,
    executeTouched: checkpoint.executeTouched,
  };
}

export class RewindStore {
  private readonly indexCache = new Map<string, CheckpointIndex>();
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(
    private readonly storageRoot = STORAGE_ROOT,
    private readonly maxCheckpoints = MAX_CHECKPOINTS,
    private readonly metrics: RewindMetrics = NOOP_REWIND_METRICS,
  ) {
    try {
      mkdirSync(this.storageRoot, { recursive: true, mode: 0o700 });
      chmodSync(this.storageRoot, 0o700);
    } catch (err) {
      log.warn({ err, storageRoot: this.storageRoot }, 'rewind: failed to harden storage root permissions');
    }
  }

  async append(fileKey: string, checkpoint: Checkpoint): Promise<{ prunedCount: number }> {
    const safeKey = validateFileKey(fileKey);
    validateCheckpointId(checkpoint.id);
    let prunedCount = 0;
    await this.enqueue(safeKey, async () => {
      const index = this.loadIndex(safeKey);
      const payloadPath = this.checkpointPath(safeKey, checkpoint.id);
      atomicWriteJsonSync(payloadPath, checkpoint);

      const nextEntries = [
        checkpointToSummary(checkpoint),
        ...index.entries.filter((entry) => entry.id !== checkpoint.id),
      ];
      const pruned = nextEntries.slice(this.maxCheckpoints);
      index.entries = nextEntries.slice(0, this.maxCheckpoints);
      this.saveIndex(safeKey, index);

      if (pruned.length > 0) {
        for (const entry of pruned) {
          const stalePath = this.checkpointPath(safeKey, entry.id);
          try {
            unlinkSync(stalePath);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
            log.warn({ err, fileKey: safeKey, checkpointId: entry.id }, 'rewind: failed to unlink pruned checkpoint');
          }
        }
        this.metrics.recordRewindPruned(pruned.length);
        prunedCount = pruned.length;
      }
    });
    return { prunedCount };
  }

  listSummaries(fileKey: string): CheckpointSummary[] {
    return [...this.loadIndex(validateFileKey(fileKey)).entries];
  }

  getCheckpoint(fileKey: string, checkpointId: string): Checkpoint | null {
    const safeKey = validateFileKey(fileKey);
    const safeId = validateCheckpointId(checkpointId);
    return readJsonOrQuarantine<Checkpoint>(this.checkpointPath(safeKey, safeId), isCheckpoint);
  }

  async clear(fileKey: string): Promise<void> {
    const safeKey = validateFileKey(fileKey);
    await this.enqueue(safeKey, () => {
      const target = path.join(this.storageRoot, safeKey);
      assertPathWithin(this.storageRoot, target);
      rmSync(target, { recursive: true, force: true });
      this.indexCache.delete(safeKey);
    });
  }

  invalidate(fileKey?: string): void {
    if (fileKey) {
      this.indexCache.delete(fileKey);
      return;
    }
    this.indexCache.clear();
  }

  private async enqueue(fileKey: string, task: () => Promise<void> | void): Promise<void> {
    const previous = this.writeChains.get(fileKey) ?? Promise.resolve();
    const next = previous.then(async () => task());
    this.writeChains.set(
      fileKey,
      next.catch((err) => {
        log.warn({ err, fileKey }, 'rewind: serialized store operation failed');
      }),
    );
    await next;
  }

  private loadIndex(fileKey: string): CheckpointIndex {
    const cached = this.indexCache.get(fileKey);
    if (cached) return cached;

    const parsed = readJsonOrQuarantine<CheckpointIndex>(this.indexPath(fileKey), isCheckpointIndex);
    const index = parsed ?? { version: SCHEMA_VERSION, fileKey, entries: [] };
    this.indexCache.set(fileKey, index);
    return index;
  }

  private saveIndex(fileKey: string, index: CheckpointIndex): void {
    atomicWriteJsonSync(this.indexPath(fileKey), index);
    this.indexCache.set(fileKey, index);
  }

  private indexPath(fileKey: string): string {
    const p = path.join(this.storageRoot, fileKey, 'index.json');
    assertPathWithin(this.storageRoot, p);
    return p;
  }

  private checkpointPath(fileKey: string, checkpointId: string): string {
    const p = path.join(this.storageRoot, fileKey, 'checkpoints', `${checkpointId}.json`);
    assertPathWithin(this.storageRoot, p);
    return p;
  }
}
