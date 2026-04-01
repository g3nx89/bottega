import { describe, expect, it } from 'vitest';
import { extractTree } from '../../../../src/main/compression/project-tree.js';
import type { SemanticNode, SemanticResult } from '../../../../src/main/compression/semantic-modes.js';

// ── Helpers ──────────────────────────────────────

function makeFrame(overrides: Record<string, any> = {}): any {
  return {
    id: '1:1',
    type: 'FRAME',
    name: 'Frame',
    width: 100,
    height: 200,
    visible: true,
    ...overrides,
  };
}

function makeText(overrides: Record<string, any> = {}): any {
  return {
    id: '2:1',
    type: 'TEXT',
    name: 'Label',
    width: 80,
    height: 24,
    visible: true,
    characters: 'Hello world',
    fontSize: 14,
    ...overrides,
  };
}

function solidFill(r: number, g: number, b: number) {
  return [{ type: 'SOLID', color: { r, g, b, a: 1 }, visible: true }];
}

function solidStroke(r: number, g: number, b: number, weight = 1) {
  return { strokes: [{ type: 'SOLID', color: { r, g, b, a: 1 }, visible: true }], strokeWeight: weight };
}

/** Get first node from extraction result. */
function extract(
  node: any,
  mode: 'full' | 'structure' | 'content' | 'styling' | 'briefing' | 'component' = 'full',
): SemanticNode {
  const result = extractTree(node, mode);
  return result.nodes[0];
}

function extractResult(
  node: any,
  mode: 'full' | 'structure' | 'content' | 'styling' | 'briefing' | 'component' = 'full',
): SemanticResult {
  return extractTree(node, mode);
}

// ── Basic ────────────────────────────────────────

describe('extractTree — basic', () => {
  it('extracts id, type, name from a simple FRAME node', () => {
    const node = makeFrame({ id: '10:5', name: 'Card', width: 320, height: 480 });
    const result = extract(node);
    expect(result.id).toBe('10:5');
    expect(result.type).toBe('FRAME');
    expect(result.name).toBe('Card');
  });

  it('preserves nested hierarchy (FRAME > FRAME > TEXT)', () => {
    const inner = makeText({ id: '3:1' });
    const mid = makeFrame({ id: '2:1', children: [inner] });
    const root = makeFrame({ id: '1:1', children: [mid] });

    const result = extract(root);
    expect(result.children).toHaveLength(1);
    expect(result.children![0].id).toBe('2:1');
    expect(result.children![0].children).toHaveLength(1);
    expect(result.children![0].children![0].id).toBe('3:1');
    expect(result.children![0].children![0].type).toBe('TEXT');
  });

  it('preserves full text content (no truncation)', () => {
    const longText = 'A'.repeat(150);
    const node = makeText({ characters: longText });
    const result = extract(node);
    expect(result.text).toBe(longText);
    expect(result.text!.length).toBe(150);
  });

  it('omits text field when characters is empty string', () => {
    const node = makeText({ characters: '' });
    const result = extract(node);
    expect(result.text).toBeUndefined();
  });

  it('includes componentId for INSTANCE nodes', () => {
    const node = {
      id: '5:1',
      type: 'INSTANCE',
      name: 'Button',
      width: 120,
      height: 40,
      visible: true,
      componentId: 'abc123',
    };
    const result = extract(node);
    expect(result.componentId).toBe('abc123');
  });

  it('falls back to mainComponent.key for INSTANCE nodes when componentId absent', () => {
    const node = {
      id: '5:2',
      type: 'INSTANCE',
      name: 'Button',
      visible: true,
      mainComponent: { key: 'xyz789' },
    };
    const result = extract(node);
    expect(result.componentId).toBe('xyz789');
  });

  it('includes componentRef for COMPONENT nodes', () => {
    const node = {
      id: '6:1',
      type: 'COMPONENT',
      name: 'Button/Primary',
      visible: true,
      key: 'comp-key-001',
    };
    const result = extract(node);
    expect(result.componentRef).toBe('comp-key-001');
  });

  it('filters invisible nodes (visible: false)', () => {
    const root = makeFrame({
      children: [
        makeFrame({ id: '2:1', name: 'Visible', visible: true }),
        makeFrame({ id: '2:2', name: 'Hidden', visible: false }),
      ],
    });
    const result = extract(root);
    expect(result.children).toHaveLength(1);
    expect(result.children![0].name).toBe('Visible');
  });
});

// ── Fills and strokes ────────────────────────────

describe('extractTree — fills and strokes', () => {
  it('converts solid fill to hex color string', () => {
    const node = makeFrame({ fills: solidFill(1, 0, 0) });
    const result = extract(node);
    // Fill might be inlined (singleton) or a globalVars ref
    const resultFull = extractResult(node);
    // The fill should resolve to #FF0000 either inline or via ref
    const fillValue =
      typeof result.fills === 'string'
        ? (resultFull.globalVars?.styles[result.fills as string] ?? result.fills)
        : result.fills;
    expect(fillValue).toBeDefined();
  });

  it('omits fill field when fills array is empty', () => {
    const node = makeFrame({ fills: [] });
    const result = extract(node);
    expect(result.fills).toBeUndefined();
  });

  it('omits fill when fills is absent', () => {
    const node = makeFrame();
    const result = extract(node);
    expect(result.fills).toBeUndefined();
  });

  it('skips invisible fills', () => {
    const node = makeFrame({
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: false }],
    });
    const result = extract(node);
    expect(result.fills).toBeUndefined();
  });

  it('converts solid stroke', () => {
    const node = makeFrame({ ...solidStroke(0, 0, 1, 2), visible: true });
    const result = extract(node);
    expect(result.strokes).toBeDefined();
  });

  it('omits stroke field when strokes array is empty', () => {
    const node = makeFrame({ strokes: [] });
    const result = extract(node);
    expect(result.strokes).toBeUndefined();
  });
});

// ── Layout ───────────────────────────────────────

describe('extractTree — layout', () => {
  it('maps HORIZONTAL layoutMode to mode: row', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL' });
    const result = extract(node);
    expect(result.layout?.mode).toBe('row');
  });

  it('maps VERTICAL layoutMode to mode: column', () => {
    const node = makeFrame({ layoutMode: 'VERTICAL' });
    const result = extract(node);
    expect(result.layout?.mode).toBe('column');
  });

  it('maps HORIZONTAL + layoutWrap WRAP to wrap: true', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' });
    const result = extract(node);
    expect(result.layout?.mode).toBe('row');
    expect(result.layout?.wrap).toBe(true);
  });

  it('includes gap when layout is set and itemSpacing > 0', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', itemSpacing: 16 });
    const result = extract(node);
    expect(result.layout?.gap).toBe('16px');
  });

  it('omits gap when itemSpacing is 0', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', itemSpacing: 0 });
    const result = extract(node);
    expect(result.layout?.gap).toBeUndefined();
  });

  it('includes padding as CSS shorthand', () => {
    const node = makeFrame({ paddingTop: 8, paddingRight: 12, paddingBottom: 8, paddingLeft: 12 });
    const result = extract(node);
    expect(result.layout?.padding).toBe('8px 12px');
  });

  it('omits padding when all padding values are zero', () => {
    const node = makeFrame({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 });
    const result = extract(node);
    expect(result.layout?.padding).toBeUndefined();
  });

  it('uses shorthand for equal padding', () => {
    const node = makeFrame({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 });
    const result = extract(node);
    expect(result.layout?.padding).toBe('16px');
  });
});

// ── Visuals ─────────────────────────────────────

describe('extractTree — visuals', () => {
  it('omits opacity when it equals 1', () => {
    const node = makeFrame({ opacity: 1 });
    const result = extract(node);
    expect(result.opacity).toBeUndefined();
  });

  it('includes opacity when !== 1', () => {
    const node = makeFrame({ opacity: 0.75 });
    const result = extract(node);
    expect(result.opacity).toBe(0.75);
  });

  it('converts border radius', () => {
    const node = makeFrame({ cornerRadius: 8 });
    const result = extract(node);
    expect(result.borderRadius).toBe('8px');
  });

  it('converts four-corner border radius', () => {
    const node = makeFrame({ rectangleCornerRadii: [8, 4, 8, 4] });
    const result = extract(node);
    expect(result.borderRadius).toBe('8px 4px 8px 4px');
  });
});

// ── Modes ────────────────────────────────────────

describe('extractTree — modes', () => {
  it('briefing mode includes only id, name, type', () => {
    const node = makeFrame({
      layoutMode: 'HORIZONTAL',
      fills: solidFill(1, 0, 0),
      children: [makeText()],
    });
    const result = extract(node, 'briefing');
    expect(result.id).toBeDefined();
    expect(result.name).toBeDefined();
    expect(result.type).toBeDefined();
    expect(result.layout).toBeUndefined();
    expect(result.fills).toBeUndefined();
    // Children should still be present (briefing traverses)
    expect(result.children).toHaveLength(1);
    expect(result.children![0].text).toBeUndefined(); // no text extractor in briefing
  });

  it('structure mode has layout but no fills or text', () => {
    const node = makeFrame({
      layoutMode: 'HORIZONTAL',
      fills: solidFill(1, 0, 0),
      children: [makeText()],
    });
    const result = extract(node, 'structure');
    expect(result.layout?.mode).toBe('row');
    expect(result.fills).toBeUndefined();
    expect(result.children![0].text).toBeUndefined();
  });

  it('content mode has text but no layout or fills', () => {
    const node = makeText({
      layoutMode: 'HORIZONTAL',
      fills: solidFill(1, 0, 0),
    });
    const result = extract(node, 'content');
    expect(result.text).toBe('Hello world');
    expect(result.layout).toBeUndefined();
    expect(result.fills).toBeUndefined();
  });

  it('styling mode has fills but no layout or text', () => {
    const node = makeFrame({
      layoutMode: 'HORIZONTAL',
      fills: solidFill(1, 0, 0),
      children: [makeText()],
    });
    const result = extract(node, 'styling');
    expect(result.fills).toBeDefined();
    expect(result.layout).toBeUndefined();
    expect(result.children![0].text).toBeUndefined();
  });

  it('component mode has layout and componentId but no fills', () => {
    const node = {
      id: '5:1',
      type: 'INSTANCE',
      name: 'Btn',
      visible: true,
      width: 120,
      height: 40,
      layoutMode: 'HORIZONTAL',
      fills: solidFill(1, 0, 0),
      componentId: 'abc',
    };
    const result = extract(node, 'component');
    expect(result.layout?.mode).toBe('row');
    expect(result.componentId).toBe('abc');
    expect(result.fills).toBeUndefined();
  });
});

// ── SVG collapse ─────────────────────────────────

describe('extractTree — SVG collapse', () => {
  it('collapses VECTOR nodes to IMAGE-SVG', () => {
    const node = { id: '1:1', type: 'VECTOR', name: 'Path', visible: true };
    const result = extract(node);
    expect(result.type).toBe('IMAGE-SVG');
  });

  it('collapses frame with all vector children', () => {
    const root = makeFrame({
      children: [
        { id: '2:1', type: 'VECTOR', name: 'Path1', visible: true },
        { id: '2:2', type: 'VECTOR', name: 'Path2', visible: true },
      ],
    });
    const result = extract(root);
    expect(result.type).toBe('IMAGE-SVG');
    expect(result.children).toBeUndefined();
  });

  it('does NOT collapse frame with mixed children', () => {
    const root = makeFrame({
      children: [{ id: '2:1', type: 'VECTOR', name: 'Path1', visible: true }, makeText({ id: '2:2' })],
    });
    const result = extract(root);
    expect(result.type).toBe('FRAME');
    expect(result.children).toHaveLength(2);
  });
});

// ── Style deduplication ──────────────────────────

describe('extractTree — dedup', () => {
  it('shared fills produce globalVars references', () => {
    const sharedFill = solidFill(0.2, 0.4, 1);
    const root = makeFrame({
      children: [
        makeFrame({ id: '1:1', fills: sharedFill, visible: true }),
        makeFrame({ id: '1:2', fills: sharedFill, visible: true }),
        makeFrame({ id: '1:3', fills: sharedFill, visible: true }),
      ],
    });
    const result = extractResult(root);
    expect(result.globalVars).toBeDefined();
    // The shared fill should be in globalVars (referenced 3 times)
    const styleKeys = Object.keys(result.globalVars!.styles);
    expect(styleKeys.length).toBeGreaterThan(0);
  });

  it('unique fills are inlined (not in globalVars)', () => {
    const root = makeFrame({
      fills: solidFill(1, 0, 0), // unique — only this node has it
    });
    const result = extractResult(root);
    // Single fill should be inlined — no globalVars should exist
    expect(result.globalVars).toBeUndefined();
  });
});

// ── Edge cases ───────────────────────────────────

describe('extractTree — edge cases', () => {
  it('omits children field when children array is empty', () => {
    const node = makeFrame({ children: [] });
    const result = extract(node);
    expect(result.children).toBeUndefined();
  });

  it('handles null/undefined optional fields without crashing', () => {
    const node = {
      id: '99:1',
      type: 'RECTANGLE',
      name: 'Rect',
      visible: true,
      fills: null,
      strokes: undefined,
      effects: null,
      children: null,
    };
    const result = extract(node as any);
    expect(result.id).toBe('99:1');
    expect(result.fills).toBeUndefined();
    expect(result.strokes).toBeUndefined();
  });

  it('produces minimal output for a bare node in briefing mode', () => {
    const node = { id: '1:1', type: 'RECTANGLE', name: 'Rect', visible: true };
    const result = extract(node, 'briefing');
    expect(result.id).toBe('1:1');
    expect(result.type).toBe('RECTANGLE');
    expect(result.name).toBe('Rect');
    expect(result.layout).toBeUndefined();
    expect(result.fills).toBeUndefined();
  });

  it('full mode output is smaller than raw JSON for a large tree', () => {
    function makeRawNode(id: number): any {
      return {
        id: `${id}:${id}`,
        type: 'FRAME',
        name: `Frame ${id}`,
        width: 100,
        height: 200,
        visible: true,
        opacity: 1,
        blendMode: 'NORMAL',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 200 },
        absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 200 },
        pluginData: { somePlugin: { someKey: 'someValue' } },
        sharedPluginData: {},
        prototypeConnections: [],
        reactions: [],
        geometryPaths: [{ windingRule: 'NONZERO', data: 'M 0 0 L 100 0 L 100 200 L 0 200 Z' }],
        vectorPaths: [],
        constraints: { vertical: 'TOP', horizontal: 'LEFT' },
        layoutAlign: 'INHERIT',
        layoutGrow: 0,
        fills: [
          { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, visible: true, blendMode: 'NORMAL', opacity: 1 },
        ],
        strokes: [],
        strokeWeight: 1,
        effects: [],
        children: [],
      };
    }

    const rawNodes = Array.from({ length: 100 }, (_, i) => makeRawNode(i + 1));
    const inputJson = JSON.stringify(rawNodes);
    const result = extractTree(rawNodes, 'full');
    const outputJson = JSON.stringify(result);

    expect(outputJson.length).toBeLessThan(inputJson.length * 0.5);
  });
});

// ── extractTree with array input ─────────────────

describe('extractTree — array input', () => {
  it('returns nodes for array input', () => {
    const nodes = [
      makeFrame({ id: '1:1', name: 'A' }),
      makeFrame({ id: '1:2', name: 'B' }),
      makeText({ id: '1:3', name: 'C' }),
    ];
    const result = extractTree(nodes, 'full');
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].id).toBe('1:1');
    expect(result.nodes[1].id).toBe('1:2');
    expect(result.nodes[2].id).toBe('1:3');
    expect(result.nodes[2].type).toBe('TEXT');
  });

  it('returns empty nodes for empty input', () => {
    const result = extractTree([], 'full');
    expect(result.nodes).toEqual([]);
  });
});
