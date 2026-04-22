import type { IFigmaConnector, NodeDataField } from '../../../figma/figma-connector.js';
import { ensureObject } from './util.js';

export async function captureGeometryPreState(
  connector: IFigmaConnector,
  nodeId: string,
  fields: NodeDataField[],
): Promise<Record<string, unknown>> {
  const raw = await connector.getNodeData(nodeId, fields);
  const data = ensureObject(raw);

  if (fields.includes('position')) {
    const position = ensureObject(data.position);
    return {
      x: typeof position.x === 'number' ? position.x : null,
      y: typeof position.y === 'number' ? position.y : null,
      parent: ensureObject(data.parent),
    };
  }

  const size = ensureObject(data.size);
  return {
    width: typeof size.width === 'number' ? size.width : null,
    height: typeof size.height === 'number' ? size.height : null,
    layoutSizing: ensureObject(data.layoutSizing),
    constraints: ensureObject(data.constraints),
  };
}
