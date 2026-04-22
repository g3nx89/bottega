export type RestorableKind = 'inverse-op' | 'non-restorable';

export type RewindSkipReason =
  | 'ws-timeout'
  | 'node-not-found'
  | 'unsupported'
  | 'execute'
  | 'inverse-unavailable'
  | 'inverse-failed';

export interface MutationSnapshot {
  tool: string;
  input: Record<string, unknown>;
  nodeIds: string[];
  createdNodeIds?: string[];
  preState: Record<string, unknown>;
  kind: RestorableKind;
  skipReason?: RewindSkipReason;
  capturedAt: number;
}

export interface Checkpoint {
  id: string;
  fileKey: string;
  sessionId: string;
  slotId: string;
  turnIndex: number;
  prompt: string;
  mutations: MutationSnapshot[];
  executeTouched: boolean;
  timestamp: number;
  restorableCount: number;
  nonRestorableCount: number;
}

export interface CheckpointSummary {
  id: string;
  fileKey: string;
  slotId: string;
  turnIndex: number;
  prompt: string;
  timestamp: number;
  restorableCount: number;
  nonRestorableCount: number;
  executeTouched: boolean;
}

export interface CheckpointIndex {
  version: 1;
  fileKey: string;
  entries: CheckpointSummary[];
}

export type RestoreScope = 'last-turn' | 'to-checkpoint';

export interface RestoreResult {
  success: boolean;
  restoredMutations: number;
  skippedMutations: number;
  undoToken?: string;
  error?: string;
  /** Counts per skipReason so the UI can surface why a mutation was not restored. */
  skipReasons?: Partial<Record<RewindSkipReason, number>>;
}

export interface InverseOp {
  apply(connector: import('../../figma/figma-connector.js').IFigmaConnector): Promise<void>;
}
