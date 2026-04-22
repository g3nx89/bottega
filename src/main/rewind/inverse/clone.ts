import type { IFigmaConnector } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';

function readCreatedNodeId(snapshot: MutationSnapshot): string | null {
  return typeof snapshot.createdNodeIds?.[0] === 'string' && snapshot.createdNodeIds[0].length > 0
    ? snapshot.createdNodeIds[0]
    : null;
}

class CloneInverseOp implements InverseOp {
  constructor(private readonly createdNodeId: string) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    await connector.deleteNode(this.createdNodeId);
  }
}

export function buildCloneInverse(snapshot: MutationSnapshot): InverseOp | null {
  const createdNodeId = readCreatedNodeId(snapshot);
  if (!createdNodeId) return null;
  return new CloneInverseOp(createdNodeId);
}
