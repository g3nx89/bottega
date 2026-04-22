import type { IFigmaConnector, NodeDataField } from '../../../figma/figma-connector.js';
import { ensureObject } from './util.js';

export async function captureSimplePreState(
  connector: IFigmaConnector,
  nodeId: string,
  fields: NodeDataField[],
): Promise<Record<string, unknown>> {
  const raw = await connector.getNodeData(nodeId, fields);
  const data = ensureObject(raw);

  if (fields.includes('fills')) {
    return {
      fills: Array.isArray(data.fills) ? data.fills : [],
      strokes: Array.isArray(data.strokes) ? data.strokes : [],
    };
  }

  if (fields.includes('text')) {
    const text = ensureObject(data.text);
    return {
      text: {
        characters: typeof text.characters === 'string' ? text.characters : '',
        fontName: text.fontName,
        fontSize: typeof text.fontSize === 'number' ? text.fontSize : null,
        fontsToLoad: Array.isArray(text.fontsToLoad) ? text.fontsToLoad : [],
      },
    };
  }

  return {
    name: typeof data.name === 'string' ? data.name : '',
  };
}
