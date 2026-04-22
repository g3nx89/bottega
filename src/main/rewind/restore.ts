import { randomUUID } from 'node:crypto';
import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import type { OperationQueue } from '../operation-queue.js';
import { dispatchInverse } from './inverse/index.js';
import { capturePreState } from './pre-state/index.js';
import type { Checkpoint, MutationSnapshot, RestoreResult, RewindSkipReason } from './types.js';

const log = createChildLogger({ component: 'rewind-restore' });

export interface ApplyCheckpointOptions {
  registerUndoSnapshots: (undoToken: string, mutations: MutationSnapshot[]) => void;
}

function incrementReason(reasons: Partial<Record<RewindSkipReason, number>>, reason: RewindSkipReason): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export async function applyCheckpoint(
  checkpoint: Checkpoint,
  connector: IFigmaConnector,
  queue: OperationQueue,
  options: ApplyCheckpointOptions,
): Promise<RestoreResult> {
  if (checkpoint.executeTouched) {
    return {
      success: false,
      restoredMutations: 0,
      skippedMutations: 0,
      error: 'Checkpoint contains arbitrary code execution and cannot be restored.',
    };
  }

  const sorted = [...checkpoint.mutations].reverse();
  let restoredMutations = 0;
  let skippedMutations = 0;
  const skipReasons: Partial<Record<RewindSkipReason, number>> = {};
  const undoSnapshots: MutationSnapshot[] = [];

  for (const snapshot of sorted) {
    if (snapshot.kind === 'non-restorable') {
      skippedMutations += 1;
      if (snapshot.skipReason) incrementReason(skipReasons, snapshot.skipReason);
      continue;
    }

    try {
      type InverseOutcome =
        | { status: 'applied'; preState: Record<string, unknown> }
        | { status: 'skipped'; reason: RewindSkipReason };
      const outcome = await queue.execute(async (): Promise<InverseOutcome> => {
        const current = await capturePreState(snapshot.tool, snapshot.input, connector);
        if (current.kind !== 'inverse-op') {
          return { status: 'skipped', reason: current.skipReason ?? 'unsupported' };
        }
        if (current.skipReason) return { status: 'skipped', reason: current.skipReason };
        const inverse = dispatchInverse(snapshot);
        if (!inverse) return { status: 'skipped', reason: 'inverse-unavailable' };
        await inverse.apply(connector);
        return { status: 'applied', preState: current.preState };
      });

      if (outcome.status === 'skipped') {
        skippedMutations += 1;
        incrementReason(skipReasons, outcome.reason);
        continue;
      }

      undoSnapshots.push({
        ...snapshot,
        preState: outcome.preState,
        kind: 'inverse-op',
        skipReason: undefined,
        capturedAt: Date.now(),
      });
      restoredMutations += 1;
    } catch (err) {
      log.warn({ err, tool: snapshot.tool }, 'rewind: inverse failed, skipping');
      skippedMutations += 1;
      incrementReason(skipReasons, 'inverse-failed');
    }
  }

  const result: RestoreResult = { success: restoredMutations > 0, restoredMutations, skippedMutations };
  if (Object.keys(skipReasons).length > 0) result.skipReasons = skipReasons;

  if (restoredMutations === 0) return result;

  result.undoToken = randomUUID();
  options.registerUndoSnapshots(result.undoToken, undoSnapshots);
  return result;
}
