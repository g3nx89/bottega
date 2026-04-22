import type { IFigmaConnector, NodeDataField } from '../../../figma/figma-connector.js';
import { PRE_STATE_TIMEOUT_MS } from '../config.js';
import type { RestorableKind, RewindSkipReason } from '../types.js';
import { captureGeometryPreState } from './geometry.js';
import { captureSimplePreState } from './simple.js';
import { captureSubtreePreState } from './subtree.js';

export interface PreStateCaptureResult {
  kind: RestorableKind;
  preState: Record<string, unknown>;
  skipReason?: RewindSkipReason;
}

interface CaptureSpec {
  kind: RestorableKind;
  fields?: NodeDataField[];
  capture?: (connector: IFigmaConnector, nodeId: string, fields: NodeDataField[]) => Promise<Record<string, unknown>>;
  skipReason?: RewindSkipReason;
}

const TOOL_SPECS: Record<string, CaptureSpec> = {
  figma_set_fills: { kind: 'inverse-op', fields: ['fills', 'strokes'], capture: captureSimplePreState },
  figma_set_text: { kind: 'inverse-op', fields: ['text'], capture: captureSimplePreState },
  figma_move: { kind: 'inverse-op', fields: ['position', 'parent'], capture: captureGeometryPreState },
  figma_resize: {
    kind: 'inverse-op',
    fields: ['size', 'layoutSizing', 'constraints'],
    capture: captureGeometryPreState,
  },
  figma_rename: { kind: 'inverse-op', fields: ['name'], capture: captureSimplePreState },
  figma_delete: {
    // Capturing a subtree would serialize up to 200 children × 3 levels of data
    // that is never replayed (restore treats this snapshot as non-restorable).
    // Skip the probe entirely to save WS round-trips and storage.
    kind: 'non-restorable',
    skipReason: 'unsupported' as const,
  },
  figma_clone: { kind: 'inverse-op', fields: [], capture: captureSubtreePreState },
  figma_execute: { kind: 'non-restorable', skipReason: 'execute' as const },
};

function readNodeId(input: Record<string, unknown>): string | null {
  return typeof input.nodeId === 'string' && input.nodeId.length > 0 ? input.nodeId : null;
}

export async function capturePreState(
  toolName: string,
  input: Record<string, unknown>,
  connector: IFigmaConnector,
  timeoutMs = PRE_STATE_TIMEOUT_MS,
): Promise<PreStateCaptureResult> {
  const spec = TOOL_SPECS[toolName];
  if (!spec) {
    return { kind: 'non-restorable', preState: {}, skipReason: 'unsupported' };
  }

  if (!spec.capture || !spec.fields) {
    return { kind: spec.kind, preState: {}, skipReason: spec.skipReason };
  }

  const nodeId = readNodeId(input);
  if (!nodeId) {
    return { kind: spec.kind, preState: {}, skipReason: 'node-not-found' };
  }

  const timeout = new Promise<PreStateCaptureResult>((resolve) => {
    setTimeout(() => resolve({ kind: spec.kind, preState: {}, skipReason: 'ws-timeout' }), timeoutMs);
  });

  const capture = spec
    .capture(connector, nodeId, spec.fields)
    .then<PreStateCaptureResult>((preState) => ({ kind: spec.kind, preState }))
    .catch<PreStateCaptureResult>((err: unknown) => {
      const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (message.includes('not found')) {
        return { kind: spec.kind, preState: {}, skipReason: 'node-not-found' };
      }
      throw err;
    });

  return Promise.race([capture, timeout]);
}
