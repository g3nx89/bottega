import { describe, expect, it } from 'vitest';
import { projectTree, projectTreeArray } from '../../src/main/compression/project-tree.js';

// ── Helpers ──────────────────────────────────────

function makeFrame(overrides: Record<string, any> = {}): any {
  return {
    id: '1:1',
    type: 'FRAME',
    name: 'Frame',
    width: 100,
    height: 200,
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

// ── Basic ────────────────────────────────────────

describe('projectTree — basic', () => {
  it('projects id, type, name and box from a simple FRAME node', () => {
    const node = makeFrame({ id: '10:5', name: 'Card', width: 320, height: 480 });
    const result = projectTree(node);
    expect(result.id).toBe('10:5');
    expect(result.type).toBe('FRAME');
    expect(result.name).toBe('Card');
    expect(result.box).toBe('320x480');
  });

  it('preserves nested hierarchy (FRAME > FRAME > TEXT)', () => {
    const inner = makeText({ id: '3:1' });
    const mid = makeFrame({ id: '2:1', children: [inner] });
    const root = makeFrame({ id: '1:1', children: [mid] });

    const result = projectTree(root);
    expect(result.children).toHaveLength(1);
    expect(result.children![0].id).toBe('2:1');
    expect(result.children![0].children).toHaveLength(1);
    expect(result.children![0].children![0].id).toBe('3:1');
    expect(result.children![0].children![0].type).toBe('TEXT');
  });

  it('truncates text content at 100 characters for TEXT nodes', () => {
    const longText = 'A'.repeat(150);
    const node = makeText({ characters: longText });
    const result = projectTree(node);
    expect(result.text).toBe('A'.repeat(100));
    expect(result.text!.length).toBe(100);
  });

  it('omits text field when characters is empty string', () => {
    const node = makeText({ characters: '' });
    const result = projectTree(node);
    expect(result.text).toBeUndefined();
  });

  it('includes componentKey for INSTANCE nodes', () => {
    const node = {
      id: '5:1',
      type: 'INSTANCE',
      name: 'Button',
      width: 120,
      height: 40,
      componentId: 'abc123',
    };
    const result = projectTree(node);
    expect(result.componentKey).toBe('abc123');
  });

  it('falls back to mainComponent.key for INSTANCE nodes when componentId absent', () => {
    const node = {
      id: '5:2',
      type: 'INSTANCE',
      name: 'Button',
      mainComponent: { key: 'xyz789' },
    };
    const result = projectTree(node);
    expect(result.componentKey).toBe('xyz789');
  });

  it('includes componentRef for COMPONENT nodes', () => {
    const node = {
      id: '6:1',
      type: 'COMPONENT',
      name: 'Button/Primary',
      key: 'comp-key-001',
    };
    const result = projectTree(node);
    expect(result.componentRef).toBe('comp-key-001');
  });

  it('sets hidden: true when visible is false', () => {
    const node = makeFrame({ visible: false });
    const result = projectTree(node);
    expect(result.hidden).toBe(true);
  });

  it('omits hidden field when visible is true', () => {
    const node = makeFrame({ visible: true });
    const result = projectTree(node);
    expect(result.hidden).toBeUndefined();
  });
});

// ── Fills and strokes ────────────────────────────

describe('projectTree — fills and strokes', () => {
  it('converts solid fill to hex color string', () => {
    // r=1, g=0, b=0 → #FF0000
    const node = makeFrame({ fills: solidFill(1, 0, 0) });
    const result = projectTree(node);
    expect(result.fill).toBe('#FF0000');
    expect(result.hasComplexFill).toBeUndefined();
  });

  it('sets fill to "grad" and hasComplexFill for gradient fill', () => {
    const node = makeFrame({
      fills: [{ type: 'GRADIENT_LINEAR', visible: true }],
    });
    const result = projectTree(node);
    expect(result.fill).toBe('grad');
    expect(result.hasComplexFill).toBe(true);
  });

  it('sets fill to "img" and hasComplexFill for image fill', () => {
    const node = makeFrame({
      fills: [{ type: 'IMAGE', visible: true }],
    });
    const result = projectTree(node);
    expect(result.fill).toBe('img');
    expect(result.hasComplexFill).toBe(true);
  });

  it('omits fill field when fills array is empty', () => {
    const node = makeFrame({ fills: [] });
    const result = projectTree(node);
    expect(result.fill).toBeUndefined();
  });

  it('omits fill when fills is absent', () => {
    const node = makeFrame();
    const result = projectTree(node);
    expect(result.fill).toBeUndefined();
  });

  it('formats solid stroke as "#RRGGBB/W"', () => {
    // r=0, g=0, b=1 → #0000FF, weight=2
    const node = makeFrame({ ...solidStroke(0, 0, 1, 2) });
    const result = projectTree(node);
    expect(result.stroke).toBe('#0000FF/2');
  });

  it('omits stroke field when strokes array is empty', () => {
    const node = makeFrame({ strokes: [] });
    const result = projectTree(node);
    expect(result.stroke).toBeUndefined();
  });

  it('omits stroke when strokes is absent', () => {
    const node = makeFrame();
    const result = projectTree(node);
    expect(result.stroke).toBeUndefined();
  });

  it('skips invisible fills and uses first visible one', () => {
    const node = makeFrame({
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, visible: false },
        { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, visible: true },
      ],
    });
    const result = projectTree(node);
    expect(result.fill).toBe('#00FF00');
  });
});

// ── Layout ───────────────────────────────────────

describe('projectTree — layout', () => {
  it('maps HORIZONTAL layoutMode to layout = "H"', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL' });
    const result = projectTree(node);
    expect(result.layout).toBe('H');
  });

  it('maps VERTICAL layoutMode to layout = "V"', () => {
    const node = makeFrame({ layoutMode: 'VERTICAL' });
    const result = projectTree(node);
    expect(result.layout).toBe('V');
  });

  it('maps HORIZONTAL + layoutWrap WRAP to layout = "WRAP"', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' });
    const result = projectTree(node);
    expect(result.layout).toBe('WRAP');
  });

  it('includes gap when layout is set and itemSpacing > 0', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', itemSpacing: 16 });
    const result = projectTree(node);
    expect(result.gap).toBe(16);
  });

  it('omits gap when itemSpacing is 0', () => {
    const node = makeFrame({ layoutMode: 'HORIZONTAL', itemSpacing: 0 });
    const result = projectTree(node);
    expect(result.gap).toBeUndefined();
  });

  it('includes padding as "T,R,B,L" when any value is non-zero', () => {
    const node = makeFrame({ paddingTop: 8, paddingRight: 12, paddingBottom: 8, paddingLeft: 12 });
    const result = projectTree(node);
    expect(result.padding).toBe('8,12,8,12');
  });

  it('omits padding when all padding values are zero', () => {
    const node = makeFrame({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 });
    const result = projectTree(node);
    expect(result.padding).toBeUndefined();
  });

  it('omits padding when padding fields are absent', () => {
    const node = makeFrame();
    const result = projectTree(node);
    expect(result.padding).toBeUndefined();
  });
});

// ── Effects and defaults ─────────────────────────

describe('projectTree — effects and defaults', () => {
  it('sets hasEffects: true when effects array is non-empty', () => {
    const node = makeFrame({ effects: [{ type: 'DROP_SHADOW' }] });
    const result = projectTree(node);
    expect(result.hasEffects).toBe(true);
  });

  it('omits hasEffects when effects array is empty', () => {
    const node = makeFrame({ effects: [] });
    const result = projectTree(node);
    expect(result.hasEffects).toBeUndefined();
  });

  it('omits hasEffects when effects is absent', () => {
    const node = makeFrame();
    const result = projectTree(node);
    expect(result.hasEffects).toBeUndefined();
  });

  it('omits opacity when it equals 1 (standard mode)', () => {
    const node = makeFrame({ opacity: 1 });
    const result = projectTree(node);
    expect(result.opacity).toBeUndefined();
  });

  it('omits opacity in standard mode even when !== 1', () => {
    const node = makeFrame({ opacity: 0.5 });
    const result = projectTree(node, 'standard');
    expect(result.opacity).toBeUndefined();
  });

  it('does not include blendMode field in any output', () => {
    const node = makeFrame({ blendMode: 'NORMAL' });
    const result = projectTree(node) as any;
    expect(result.blendMode).toBeUndefined();
  });
});

// ── Detail modes ─────────────────────────────────

describe('projectTree — detail modes', () => {
  it('omits fontSize for TEXT nodes in standard mode', () => {
    const node = makeText({ fontSize: 16 });
    const result = projectTree(node, 'standard');
    expect(result.fontSize).toBeUndefined();
  });

  it('includes fontSize for TEXT nodes in detailed mode', () => {
    const node = makeText({ fontSize: 16 });
    const result = projectTree(node, 'detailed');
    expect(result.fontSize).toBe(16);
  });

  it('includes opacity !== 1 in detailed mode', () => {
    const node = makeFrame({ opacity: 0.75 });
    const result = projectTree(node, 'detailed');
    expect(result.opacity).toBe(0.75);
  });

  it('omits opacity === 1 even in detailed mode', () => {
    const node = makeFrame({ opacity: 1 });
    const result = projectTree(node, 'detailed');
    expect(result.opacity).toBeUndefined();
  });

  it('defaults to standard mode when detail argument is omitted', () => {
    const node = makeText({ fontSize: 18, opacity: 0.5 });
    const result = projectTree(node);
    expect(result.fontSize).toBeUndefined();
    expect(result.opacity).toBeUndefined();
  });
});

// ── Edge cases ───────────────────────────────────

describe('projectTree — edge cases', () => {
  it('omits children field when children array is empty', () => {
    const node = makeFrame({ children: [] });
    const result = projectTree(node);
    expect(result.children).toBeUndefined();
  });

  it('handles null/undefined optional fields without crashing', () => {
    const node = {
      id: '99:1',
      type: 'RECTANGLE',
      name: 'Rect',
      fills: null,
      strokes: undefined,
      effects: null,
      children: null,
    };
    expect(() => projectTree(node as any)).not.toThrow();
    const result = projectTree(node as any);
    expect(result.id).toBe('99:1');
    expect(result.fill).toBeUndefined();
    expect(result.stroke).toBeUndefined();
    expect(result.hasEffects).toBeUndefined();
    expect(result.children).toBeUndefined();
  });

  it('produces minimal output for a bare node (only id, type, name)', () => {
    const node = { id: '1:1', type: 'RECTANGLE', name: 'Rect' };
    const result = projectTree(node);
    const keys = Object.keys(result);
    expect(keys).toEqual(['id', 'type', 'name']);
  });

  it('output JSON size is < 20% of input JSON size for a large tree', () => {
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
    const projected = projectTreeArray(rawNodes);
    const outputJson = JSON.stringify(projected);

    expect(outputJson.length).toBeLessThan(inputJson.length * 0.2);
  });
});

// ── projectTreeArray ─────────────────────────────

describe('projectTreeArray', () => {
  it('returns empty array for empty input', () => {
    const result = projectTreeArray([]);
    expect(result).toEqual([]);
  });

  it('projects all nodes in an array', () => {
    const nodes = [
      makeFrame({ id: '1:1', name: 'A' }),
      makeFrame({ id: '1:2', name: 'B' }),
      makeText({ id: '1:3', name: 'C' }),
    ];
    const result = projectTreeArray(nodes);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('1:1');
    expect(result[1].id).toBe('1:2');
    expect(result[2].id).toBe('1:3');
    expect(result[2].type).toBe('TEXT');
  });

  it('passes detail mode to each node projection', () => {
    const nodes = [makeText({ id: '2:1', fontSize: 20 })];
    const standard = projectTreeArray(nodes, 'standard');
    const detailed = projectTreeArray(nodes, 'detailed');
    expect(standard[0].fontSize).toBeUndefined();
    expect(detailed[0].fontSize).toBe(20);
  });
});
