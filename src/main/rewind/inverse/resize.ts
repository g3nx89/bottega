import type { IFigmaConnector } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';
import { readNodeId } from './index.js';

function readLayoutSizing(snapshot: MutationSnapshot): { horizontal: string | null; vertical: string | null } {
  const raw = snapshot.preState.layoutSizing;
  if (!raw || typeof raw !== 'object') return { horizontal: null, vertical: null };
  const sizing = raw as Record<string, unknown>;
  return {
    horizontal: typeof sizing.horizontal === 'string' ? sizing.horizontal : null,
    vertical: typeof sizing.vertical === 'string' ? sizing.vertical : null,
  };
}

class ResizeInverseOp implements InverseOp {
  constructor(
    private readonly nodeId: string,
    private readonly width: number,
    private readonly height: number,
    private readonly layoutSizingHorizontal: string | null,
    private readonly layoutSizingVertical: string | null,
  ) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    await connector.resizeNode(this.nodeId, this.width, this.height, true);
    await connector.setLayoutSizing(this.nodeId, this.layoutSizingHorizontal, this.layoutSizingVertical);
  }
}

export function buildResizeInverse(snapshot: MutationSnapshot): InverseOp | null {
  const nodeId = readNodeId(snapshot);
  const width = snapshot.preState.width;
  const height = snapshot.preState.height;
  if (!nodeId || typeof width !== 'number' || typeof height !== 'number') return null;
  const layoutSizing = readLayoutSizing(snapshot);
  return new ResizeInverseOp(nodeId, width, height, layoutSizing.horizontal, layoutSizing.vertical);
}
