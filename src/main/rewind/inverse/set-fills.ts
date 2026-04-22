import type { IFigmaConnector } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';
import { readNodeId } from './index.js';

function readFills(snapshot: MutationSnapshot): Array<Record<string, unknown>> | null {
  const fills = snapshot.preState.fills;
  if (!Array.isArray(fills)) return null;
  return fills.filter((fill): fill is Record<string, unknown> => !!fill && typeof fill === 'object');
}

class SetFillsInverseOp implements InverseOp {
  constructor(
    private readonly nodeId: string,
    private readonly fills: Array<Record<string, unknown>>,
  ) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    await connector.setNodeFills(this.nodeId, this.fills, true);
  }
}

export function buildSetFillsInverse(snapshot: MutationSnapshot): InverseOp | null {
  const nodeId = readNodeId(snapshot);
  const fills = readFills(snapshot);
  if (!nodeId || !fills) return null;
  return new SetFillsInverseOp(nodeId, fills);
}
