import type { IFigmaConnector, SetTextOptions } from '../../../figma/figma-connector.js';
import type { InverseOp, MutationSnapshot } from '../types.js';
import { readNodeId } from './index.js';

interface FontRef {
  family: string;
  style: string;
}

function readTextState(snapshot: MutationSnapshot): {
  characters: string;
  fontName?: FontRef;
  fontSize?: number | null;
  fontsToLoad: FontRef[];
} | null {
  const raw = snapshot.preState.text;
  if (!raw || typeof raw !== 'object') return null;
  const text = raw as Record<string, unknown>;
  const fontNameRaw = text.fontName;
  const fontName =
    fontNameRaw && typeof fontNameRaw === 'object'
      ? ({
          family:
            typeof (fontNameRaw as Record<string, unknown>).family === 'string'
              ? ((fontNameRaw as Record<string, unknown>).family as string)
              : '',
          style:
            typeof (fontNameRaw as Record<string, unknown>).style === 'string'
              ? ((fontNameRaw as Record<string, unknown>).style as string)
              : '',
        } satisfies FontRef)
      : undefined;

  const fontsToLoad = Array.isArray(text.fontsToLoad)
    ? text.fontsToLoad.filter(
        (font): font is FontRef =>
          !!font &&
          typeof font === 'object' &&
          typeof (font as Record<string, unknown>).family === 'string' &&
          typeof (font as Record<string, unknown>).style === 'string',
      )
    : [];

  return {
    characters: typeof text.characters === 'string' ? text.characters : '',
    fontName: fontName?.family && fontName.style ? fontName : undefined,
    fontSize: typeof text.fontSize === 'number' ? text.fontSize : null,
    fontsToLoad,
  };
}

class SetTextInverseOp implements InverseOp {
  constructor(
    private readonly nodeId: string,
    private readonly characters: string,
    private readonly options: SetTextOptions,
  ) {}

  async apply(connector: IFigmaConnector): Promise<void> {
    await connector.setTextContent(this.nodeId, this.characters, this.options);
  }
}

export function buildSetTextInverse(snapshot: MutationSnapshot): InverseOp | null {
  const nodeId = readNodeId(snapshot);
  const text = readTextState(snapshot);
  if (!nodeId || !text) return null;
  return new SetTextInverseOp(nodeId, text.characters, {
    fontFamily: text.fontName?.family,
    fontStyle: text.fontName?.style,
    fontSize: typeof text.fontSize === 'number' ? text.fontSize : undefined,
    fontsToLoad: text.fontsToLoad,
  });
}
