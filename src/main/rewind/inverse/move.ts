import type { IFigmaConnector } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';
import { readNodeId } from './index.js';

function readParentLayoutMode(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null;
  const raw = value.parent;
  if (!raw || typeof raw !== 'object') return null;
  const parent = raw as Record<string, unknown>;
  return typeof parent.layoutMode === 'string' ? parent.layoutMode : null;
}

class MoveInverseOp implements InverseOp {
  constructor(
    private readonly nodeId: string,
    private readonly x: number,
    private readonly y: number,
  ) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    const current = await connector.getNodeData(this.nodeId, ['parent']);
    const layoutMode = readParentLayoutMode(current as Record<string, unknown>);
    if (layoutMode !== null && layoutMode !== 'NONE') {
      throw new Error('rewind: target parent is auto-layout, move inverse skipped');
    }
    await connector.moveNode(this.nodeId, this.x, this.y);
  }
}

export function buildMoveInverse(snapshot: MutationSnapshot): InverseOp | null {
  const nodeId = readNodeId(snapshot);
  const x = snapshot.preState.x;
  const y = snapshot.preState.y;
  if (!nodeId || typeof x !== 'number' || typeof y !== 'number') return null;
  if (readParentLayoutMode(snapshot.preState) !== 'NONE') return null;
  return new MoveInverseOp(nodeId, x, y);
}
