/**
 * Tree post-processing: invisible filtering, SVG subtree collapse, empty key removal.
 *
 * These run during or after extraction to reduce node count and output size.
 * SVG collapse is the biggest win: icon frames with 10-50 vector children
 * become a single IMAGE-SVG node.
 */

import type { SemanticNode } from './semantic-modes.js';

// ── Invisible filtering ────────────────────────

/** Returns false if the node is invisible (should be skipped entirely). */
export function filterInvisible(rawNode: any): boolean {
  return rawNode.visible !== false;
}

// ── SVG collapse ───────────────────────────────

const SVG_ELIGIBLE_TYPES = new Set([
  'IMAGE-SVG',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'REGULAR_POLYGON',
  'RECTANGLE',
]);

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'BOOLEAN_OPERATION', 'COMPONENT']);

function hasImageFill(rawNode: any): boolean {
  if (!Array.isArray(rawNode.fills)) return false;
  return rawNode.fills.some((f: any) => f.type === 'IMAGE' && f.visible !== false);
}

/**
 * Collapse SVG containers: if a container has ONLY SVG-eligible children and no
 * image fills, mark it as IMAGE-SVG and drop all children.
 *
 * Called bottom-up after children are processed — inner collapses cascade outward.
 * Returns the (possibly empty) children array to use.
 */
export function collapseSvgContainers(
  rawNode: any,
  result: SemanticNode,
  processedChildren: SemanticNode[],
): SemanticNode[] {
  if (!CONTAINER_TYPES.has(rawNode.type) && !CONTAINER_TYPES.has(result.type)) {
    return processedChildren;
  }

  if (processedChildren.length === 0) return processedChildren;

  // Check if all children are SVG-eligible
  const allSvg = processedChildren.every((child) => SVG_ELIGIBLE_TYPES.has(child.type));
  if (!allSvg) return processedChildren;

  // Don't collapse if parent has image fills
  if (hasImageFill(rawNode)) return processedChildren;

  // Collapse: mark parent as IMAGE-SVG, drop children
  result.type = 'IMAGE-SVG';
  return [];
}

// ── Empty key removal ──────────────────────────

/**
 * Recursively strip undefined, null, empty arrays, and empty objects from an object.
 * Preserves falsy-but-meaningful values: 0, false, ''.
 */
export function removeEmptyKeys(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    const filtered = obj.map(removeEmptyKeys).filter((v) => v !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }

  const result: Record<string, any> = {};
  let hasKeys = false;

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (val === undefined || val === null) continue;

    if (Array.isArray(val)) {
      const cleaned = removeEmptyKeys(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
        hasKeys = true;
      }
    } else if (typeof val === 'object') {
      const cleaned = removeEmptyKeys(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
        hasKeys = true;
      }
    } else {
      result[key] = val;
      hasKeys = true;
    }
  }

  return hasKeys ? result : undefined;
}
