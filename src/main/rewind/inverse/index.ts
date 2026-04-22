import type { InverseOp, MutationSnapshot } from '../types.js';
import { buildCloneInverse } from './clone.js';
import { buildMoveInverse } from './move.js';
import { buildRenameInverse } from './rename.js';
import { buildResizeInverse } from './resize.js';
import { buildSetFillsInverse } from './set-fills.js';
import { buildSetTextInverse } from './set-text.js';

export function readNodeId(snapshot: MutationSnapshot): string | null {
  return typeof snapshot.nodeIds[0] === 'string' && snapshot.nodeIds[0].length > 0 ? snapshot.nodeIds[0] : null;
}

export function dispatchInverse(snapshot: MutationSnapshot): InverseOp | null {
  switch (snapshot.tool) {
    case 'figma_set_fills':
      return buildSetFillsInverse(snapshot);
    case 'figma_set_text':
      return buildSetTextInverse(snapshot);
    case 'figma_clone':
      return buildCloneInverse(snapshot);
    case 'figma_move':
      return buildMoveInverse(snapshot);
    case 'figma_resize':
      return buildResizeInverse(snapshot);
    case 'figma_rename':
      return buildRenameInverse(snapshot);
    default:
      return null;
  }
}
