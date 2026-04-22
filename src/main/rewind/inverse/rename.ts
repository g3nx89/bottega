import type { IFigmaConnector } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';
import { readNodeId } from './index.js';

class RenameInverseOp implements InverseOp {
  constructor(
    private readonly nodeId: string,
    private readonly name: string,
  ) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    await connector.renameNode(this.nodeId, this.name);
  }
}

export function buildRenameInverse(snapshot: MutationSnapshot): InverseOp | null {
  const nodeId = readNodeId(snapshot);
  const name = snapshot.preState.name;
  if (!nodeId || typeof name !== 'string') return null;
  return new RenameInverseOp(nodeId, name);
}
