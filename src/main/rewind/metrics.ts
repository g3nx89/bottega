export interface RewindMetrics {
  recordRewindCaptured(): void;
  recordRewindSkipped(): void;
  recordRewindCheckpointCreated(nonRestorable: boolean): void;
  recordRewindPruned(count?: number): void;
  recordRewindPluginProbeFailed(): void;
  recordRewindProbeDeferred(): void;
  recordRewindRestoreStarted(fileKey: string): void;
  recordRewindRestoreCompleted(fileKey: string, restored: number, skipped: number, ms: number): void;
  recordRewindRestoreFailed(fileKey: string, reason: string): void;
  recordRewindUndoRestore(fileKey: string, outcome: 'success' | 'no-token' | 'expired'): void;
}

export const NOOP_REWIND_METRICS: RewindMetrics = {
  recordRewindCaptured() {},
  recordRewindSkipped() {},
  recordRewindCheckpointCreated() {},
  recordRewindPruned() {},
  recordRewindPluginProbeFailed() {},
  recordRewindProbeDeferred() {},
  recordRewindRestoreStarted() {},
  recordRewindRestoreCompleted() {},
  recordRewindRestoreFailed() {},
  recordRewindUndoRestore() {},
};
