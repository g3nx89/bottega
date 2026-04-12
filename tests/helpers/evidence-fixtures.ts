/**
 * Shared evidence fixtures for judge-evidence tests.
 *
 * Provides a `makeEvidenceNode` builder with sensible defaults
 * and pre-built golden-negative raw trees.
 */

import type { EvidenceNode } from '../../src/main/subagent/judge-evidence.js';

/** Build an EvidenceNode with defaults — only specify the fields you care about. */
export function makeEvidenceNode(partial: Partial<EvidenceNode> = {}): EvidenceNode {
  return {
    id: partial.id ?? '0:0',
    name: partial.name ?? 'Node',
    type: partial.type ?? 'FRAME',
    parentId: partial.parentId ?? null,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 10,
    height: partial.height ?? 10,
    layoutMode: partial.layoutMode ?? 'NONE',
    paddingTop: partial.paddingTop ?? 0,
    paddingRight: partial.paddingRight ?? 0,
    paddingBottom: partial.paddingBottom ?? 0,
    paddingLeft: partial.paddingLeft ?? 0,
    itemSpacing: partial.itemSpacing ?? 0,
    fontSize: partial.fontSize ?? null,
    fontStyle: partial.fontStyle ?? null,
    fontFamily: partial.fontFamily ?? null,
    cornerRadius: partial.cornerRadius ?? null,
    childCount: partial.childCount ?? 0,
  };
}

// ── Golden-negative raw trees ───────────────────────────────────────────

/** 3 squares, middle one offset by 15px on the y axis → alignment FAIL. */
export const threeMisalignedSquares: EvidenceNode[] = [
  makeEvidenceNode({ id: '1:1', name: 'Parent', type: 'FRAME', childCount: 3 }),
  makeEvidenceNode({ id: '1:2', parentId: '1:1', type: 'RECTANGLE', x: 0, y: 0 }),
  makeEvidenceNode({ id: '1:3', parentId: '1:1', type: 'RECTANGLE', x: 100, y: 15 }),
  makeEvidenceNode({ id: '1:4', parentId: '1:1', type: 'RECTANGLE', x: 200, y: 0 }),
];

/** 3 text nodes all 14px Regular — no hierarchy → visual_hierarchy FAIL. */
export const threeFlatTexts: EvidenceNode[] = [
  makeEvidenceNode({ id: '2:1', name: 'Container', type: 'FRAME', childCount: 3 }),
  makeEvidenceNode({ id: '2:2', parentId: '2:1', type: 'TEXT', name: 'Title', fontSize: 14, fontStyle: 'Regular' }),
  makeEvidenceNode({ id: '2:3', parentId: '2:1', type: 'TEXT', name: 'Body', fontSize: 14, fontStyle: 'Regular' }),
  makeEvidenceNode({ id: '2:4', parentId: '2:1', type: 'TEXT', name: 'Caption', fontSize: 14, fontStyle: 'Regular' }),
];

/** 3 cards with inconsistent paddingTop = [16, 24, 16] → consistency FAIL. */
export const threeInconsistentCards: EvidenceNode[] = [
  makeEvidenceNode({ id: '3:1', name: 'Cards Container', type: 'FRAME', childCount: 3 }),
  makeEvidenceNode({ id: '3:2', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
  makeEvidenceNode({ id: '3:3', parentId: '3:1', type: 'FRAME', paddingTop: 24 }),
  makeEvidenceNode({ id: '3:4', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
];

/** A single auto-named frame with 4 children and no auto-layout → naming FAIL. */
export const autoNamedFrame: EvidenceNode[] = [
  makeEvidenceNode({ id: '4:1', name: 'Frame 1', type: 'FRAME', layoutMode: 'NONE', childCount: 4 }),
];

/** A well-formed card — aligned (auto-layout), hierarchical text, semantic name → all PASS. */
export const wellFormedCard: EvidenceNode[] = [
  makeEvidenceNode({
    id: '5:1',
    name: 'Profile Card',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    childCount: 3,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
  }),
  makeEvidenceNode({ id: '5:2', parentId: '5:1', type: 'TEXT', name: 'Title', fontSize: 24, fontStyle: 'Bold' }),
  makeEvidenceNode({ id: '5:3', parentId: '5:1', type: 'TEXT', name: 'Body', fontSize: 14, fontStyle: 'Regular' }),
  makeEvidenceNode({ id: '5:4', parentId: '5:1', type: 'RECTANGLE', name: 'Divider', cornerRadius: 4 }),
];
