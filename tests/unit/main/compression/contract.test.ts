/**
 * Contract invariant tests for the semantic extraction pipeline.
 *
 * These tests verify structural guarantees that must hold across all modes
 * and inputs: dedup uniqueness, inline-singles correctness, invisible filtering,
 * SVG collapse depth, and mode field isolation.
 */

import { describe, expect, it } from 'vitest';
import { extractTree } from '../../../../src/main/compression/project-tree.js';
import type { SemanticNode } from '../../../../src/main/compression/semantic-modes.js';

// ── Realistic fixture tree ───────────────────────

function buildRealisticTree(): any {
  const sharedFill = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 1, a: 1 }, visible: true }];
  const sharedTextStyle = { fontFamily: 'Inter', fontWeight: 400, fontSize: 14 };

  return {
    id: '0:1',
    type: 'FRAME',
    name: 'Page',
    width: 1440,
    height: 900,
    visible: true,
    layoutMode: 'VERTICAL',
    itemSpacing: 24,
    paddingTop: 32,
    paddingRight: 32,
    paddingBottom: 32,
    paddingLeft: 32,
    fills: sharedFill,
    children: [
      // Card 1
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Card',
        width: 320,
        height: 200,
        visible: true,
        fills: sharedFill,
        cornerRadius: 8,
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            offset: { x: 0, y: 2 },
            radius: 8,
            spread: 0,
            color: { r: 0, g: 0, b: 0, a: 0.1 },
          },
        ],
        children: [
          {
            id: '1:2',
            type: 'TEXT',
            name: 'Title',
            visible: true,
            characters: 'Card Title',
            fontSize: 18,
            style: { fontFamily: 'Inter', fontWeight: 700 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }],
          },
          {
            id: '1:3',
            type: 'TEXT',
            name: 'Body',
            visible: true,
            characters: 'Body text here',
            fontSize: 14,
            style: sharedTextStyle,
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }],
          },
        ],
      },
      // Card 2 (same fills → dedup)
      {
        id: '2:1',
        type: 'FRAME',
        name: 'Card 2',
        width: 320,
        height: 200,
        visible: true,
        fills: sharedFill,
        cornerRadius: 8,
        children: [
          {
            id: '2:2',
            type: 'TEXT',
            name: 'Title 2',
            visible: true,
            characters: 'Another Title',
            fontSize: 18,
            style: { fontFamily: 'Inter', fontWeight: 700 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }],
          },
          {
            id: '2:3',
            type: 'TEXT',
            name: 'Body 2',
            visible: true,
            characters: 'More body text',
            fontSize: 14,
            style: sharedTextStyle,
          },
        ],
      },
      // Icon container (SVG collapse target)
      {
        id: '3:1',
        type: 'FRAME',
        name: 'Icon',
        width: 24,
        height: 24,
        visible: true,
        children: [
          { id: '3:2', type: 'VECTOR', name: 'Path1', visible: true },
          { id: '3:3', type: 'VECTOR', name: 'Path2', visible: true },
          { id: '3:4', type: 'ELLIPSE', name: 'Circle', visible: true },
        ],
      },
      // Hidden element (should be filtered)
      {
        id: '4:1',
        type: 'FRAME',
        name: 'Hidden Panel',
        width: 400,
        height: 300,
        visible: false,
        children: [{ id: '4:2', type: 'TEXT', name: 'Secret', visible: true, characters: 'You should not see this' }],
      },
      // Instance
      {
        id: '5:1',
        type: 'INSTANCE',
        name: 'Button',
        width: 120,
        height: 40,
        visible: true,
        componentId: 'btn-primary',
        fills: sharedFill,
        componentProperties: {
          Label: { value: 'Click Me', type: 'TEXT' },
          Size: { value: 'medium', type: 'VARIANT' },
        },
      },
      // Component def
      {
        id: '6:1',
        type: 'COMPONENT',
        name: 'Button/Primary',
        width: 120,
        height: 40,
        visible: true,
        key: 'comp-btn-primary',
        fills: sharedFill,
      },
    ],
  };
}

const FIXTURE_TREE = buildRealisticTree();

// ── Helpers ──────────────────────────────────────

function flattenNodes(nodes: SemanticNode[]): SemanticNode[] {
  const result: SemanticNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) result.push(...flattenNodes(node.children));
  }
  return result;
}

function collectAllIds(nodes: SemanticNode[]): string[] {
  return flattenNodes(nodes).map((n) => n.id);
}

function countVarReferences(nodes: SemanticNode[], varId: string): number {
  let count = 0;
  for (const node of flattenNodes(nodes)) {
    if (node.fills === varId) count++;
    if (node.strokes === varId) count++;
    if (node.effects === varId) count++;
    if (node.textStyle === varId) count++;
  }
  return count;
}

// ── Contract tests ───────────────────────────────

describe('extraction contracts', () => {
  describe('deduplication', () => {
    it('no duplicate style values in globalVars', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      if (!result.globalVars) return; // no styles to check
      const values = Object.values(result.globalVars.styles).map((v) => JSON.stringify(v));
      expect(new Set(values).size).toBe(values.length);
    });

    it('all globalVars entries referenced at least twice (inline-singles worked)', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      for (const varId of Object.keys(result.globalVars?.styles ?? {})) {
        const count = countVarReferences(result.nodes, varId);
        expect(count, `${varId} should be referenced 2+ times`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('invisible filtering', () => {
    it('zero invisible nodes in output', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      const allNodeIds = collectAllIds(result.nodes);
      expect(allNodeIds).not.toContain('4:1'); // Hidden Panel
      expect(allNodeIds).not.toContain('4:2'); // Secret text inside hidden panel
    });
  });

  describe('SVG collapse', () => {
    it('no SVG subtree deeper than 1 level', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      for (const node of flattenNodes(result.nodes)) {
        if (node.type === 'IMAGE-SVG') {
          expect(node.children, `IMAGE-SVG ${node.id} should have no children`).toBeUndefined();
        }
      }
    });

    it('icon frame collapses to IMAGE-SVG', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      const allNodes = flattenNodes(result.nodes);
      const icon = allNodes.find((n) => n.name === 'Icon');
      expect(icon).toBeDefined();
      expect(icon!.type).toBe('IMAGE-SVG');
    });
  });

  describe('mode contracts', () => {
    it('briefing output has no layout/text/visuals/component fields', () => {
      const result = extractTree(FIXTURE_TREE, 'briefing');
      for (const node of flattenNodes(result.nodes)) {
        expect(node.layout).toBeUndefined();
        expect(node.text).toBeUndefined();
        expect(node.fills).toBeUndefined();
        expect(node.componentId).toBeUndefined();
      }
    });

    it('structure output has no fills/effects/text fields', () => {
      const result = extractTree(FIXTURE_TREE, 'structure');
      for (const node of flattenNodes(result.nodes)) {
        expect(node.fills).toBeUndefined();
        expect(node.effects).toBeUndefined();
        expect(node.text).toBeUndefined();
      }
    });

    it('content output has no layout/fills/component fields', () => {
      const result = extractTree(FIXTURE_TREE, 'content');
      for (const node of flattenNodes(result.nodes)) {
        expect(node.layout).toBeUndefined();
        expect(node.fills).toBeUndefined();
        expect(node.componentId).toBeUndefined();
      }
    });
  });

  describe('token budget', () => {
    it('full mode output is smaller than raw JSON', () => {
      const result = extractTree(FIXTURE_TREE, 'full');
      const rawSize = JSON.stringify(FIXTURE_TREE).length;
      const extractedSize = JSON.stringify(result).length;
      expect(extractedSize).toBeLessThan(rawSize);
    });

    it('briefing mode output is at least 60% smaller than raw JSON', () => {
      const result = extractTree(FIXTURE_TREE, 'briefing');
      const rawSize = JSON.stringify(FIXTURE_TREE).length;
      const extractedSize = JSON.stringify(result).length;
      expect(extractedSize / rawSize).toBeLessThan(0.4);
    });
  });
});
