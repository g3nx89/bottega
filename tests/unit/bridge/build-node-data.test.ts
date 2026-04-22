import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Load figma-desktop-bridge/code.js inside a vm sandbox with a stub `figma`
 * global. The bridge is vanilla JS (Figma plugin sandbox doesn't ship module
 * system), so we can't require it — we extract the top-level helpers by
 * running the file until the `figma.ui.onmessage` assignment and capturing
 * the functions we care about via globalThis.
 *
 * This gives us end-to-end coverage of `buildNodeData` + its normalization
 * helpers against a mock Figma node tree without booting a real plugin.
 */

const BRIDGE_PATH = path.resolve(__dirname, '../../../figma-desktop-bridge/code.js');

interface BridgeHelpers {
  buildNodeData: (
    node: unknown,
    fields?: string[],
    options?: { depth?: number; maxChildren?: number },
    currentDepth?: number,
  ) => any;
  collectFontsToLoad: (node: unknown) => Array<{ family: string; style: string }>;
  serializeNodeParent: (node: unknown) => unknown;
  normalizeNodeDataOptions: (options: unknown) => { depth: number; maxChildren: number };
}

function loadBridgeHelpers(): BridgeHelpers {
  const source = readFileSync(BRIDGE_PATH, 'utf8');
  // Halt execution before figma.ui.onmessage handlers try to run — we only
  // need the top-level helpers hoisted into the sandbox. Replacing the first
  // occurrence cleanly truncates the script at the right point.
  const truncateMarker = 'figma.ui.onmessage';
  const markerIdx = source.indexOf(truncateMarker);
  if (markerIdx < 0) throw new Error('bridge code.js changed shape: figma.ui.onmessage not found');
  const preHandlerSource = source.slice(0, markerIdx);

  const figmaStub = {
    showUI: () => {},
    ui: { postMessage: () => {}, onmessage: null },
    mixed: Symbol('figma.mixed'),
    getNodeByIdAsync: async () => null,
    clientStorage: {
      getAsync: async () => null,
      setAsync: async () => undefined,
    },
    currentPage: { selection: [] },
    variables: {},
  };

  const sandbox: Record<string, unknown> = {
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    figma: figmaStub,
    __html__: '<html></html>',
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${preHandlerSource}\nglobalThis.__bridgeExports = { buildNodeData, collectFontsToLoad, serializeNodeParent, normalizeNodeDataOptions };`,
    sandbox,
  );
  const exports = (sandbox as { __bridgeExports?: BridgeHelpers }).__bridgeExports;
  if (!exports) throw new Error('bridge helpers not captured from sandbox');
  return exports;
}

const helpers = loadBridgeHelpers();

function makeNode(overrides: Record<string, unknown> = {}): any {
  return {
    id: '1:1',
    type: 'FRAME',
    name: 'Frame',
    fills: [],
    strokes: [],
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    constraints: { horizontal: 'LEFT', vertical: 'TOP' },
    opacity: 1,
    cornerRadius: 0,
    parent: null,
    children: [],
    ...overrides,
  };
}

describe('figma-desktop-bridge buildNodeData', () => {
  it('serializes the default field set with nested position/size/layout shape', () => {
    const node = makeNode({ x: 10, y: 20, width: 200, height: 150 });
    const data = helpers.buildNodeData(node);
    expect(data).toMatchObject({
      id: '1:1',
      type: 'FRAME',
      name: 'Frame',
      fills: [],
      strokes: [],
      position: { x: 10, y: 20 },
      size: { width: 200, height: 150 },
      layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
      constraints: { horizontal: 'LEFT', vertical: 'TOP' },
      opacity: 1,
      cornerRadius: 0,
      parent: null,
      children: [],
    });
  });

  it('filters to the requested fields only when a list is provided', () => {
    const node = makeNode();
    const data = helpers.buildNodeData(node, ['name', 'fills']);
    expect(Object.keys(data).sort()).toEqual(['fills', 'id', 'name', 'type']);
  });

  it('clamps depth to 3 levels and marks deeper children as truncated', () => {
    const leaf = makeNode({ id: '1:5', name: 'L4' });
    const l3 = makeNode({ id: '1:4', name: 'L3', children: [leaf] });
    const l2 = makeNode({ id: '1:3', name: 'L2', children: [l3] });
    const l1 = makeNode({ id: '1:2', name: 'L1', children: [l2] });
    const root = makeNode({ id: '1:1', name: 'Root', children: [l1] });
    const data = helpers.buildNodeData(root, ['name', 'children']);
    // Tree nesting: root(d=0) → L1(d=1) → L2(d=2) → L3(d=3 — fully serialized
    // but its own children get summarized because serializeNodeChildren uses
    // the current depth). L3 itself is full; its leaf child is summarized.
    const l3Serialized = data.children[0].children[0].children[0];
    expect(l3Serialized).toMatchObject({ id: '1:4', type: 'FRAME', name: 'L3' });
    expect(l3Serialized.truncated).toBe(true);
    const summarizedLeaf = l3Serialized.children[0];
    expect(summarizedLeaf).toEqual({ id: '1:5', type: 'FRAME', name: 'L4', truncated: true });
  });

  it('caps children lists at 200 and marks the parent truncated', () => {
    const children = Array.from({ length: 250 }, (_, i) => makeNode({ id: `1:${i + 2}`, name: `C${i}` }));
    const root = makeNode({ id: '1:1', children });
    const data = helpers.buildNodeData(root, ['children']);
    expect(data.children).toHaveLength(200);
    expect(data.children[199].id).toBe('1:201');
    expect(data.truncated).toBe(true);
  });

  it('normalizes text nodes with fontsToLoad from getStyledTextSegments on mixed fonts', () => {
    const mixedSymbol = (helpers as unknown as { __figmaMixed?: symbol }).__figmaMixed;
    // Hack: use the value from the sandbox by extracting from a TEXT node case.
    // The sandbox's figma.mixed is a Symbol; collectFontsToLoad compares with ===.
    // Build a TEXT node with fontName === figma.mixed so the segments branch runs.
    const segments = [
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Inter', style: 'Bold' } },
      { fontName: { family: 'Inter', style: 'Regular' } }, // duplicate should be deduped
    ];
    // Re-load helpers with access to the real Symbol.
    const source = readFileSync(BRIDGE_PATH, 'utf8');
    const preHandler = source.slice(0, source.indexOf('figma.ui.onmessage'));
    const sandbox: Record<string, unknown> = {
      console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      figma: {
        showUI: () => {},
        ui: { postMessage: () => {}, onmessage: null },
        mixed: Symbol('figma.mixed'),
        getNodeByIdAsync: async () => null,
        clientStorage: { getAsync: async () => null, setAsync: async () => undefined },
        currentPage: { selection: [] },
        variables: {},
      },
      __html__: '<html></html>',
      setTimeout,
      clearTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(`${preHandler}\nglobalThis.__bridgeExports = { buildNodeData, collectFontsToLoad };`, sandbox);
    const exp = (sandbox as { __bridgeExports: { collectFontsToLoad: (n: unknown) => unknown } }).__bridgeExports;
    const figmaMixed = (sandbox.figma as { mixed: symbol }).mixed;
    const textNode = {
      type: 'TEXT',
      fontName: figmaMixed,
      getStyledTextSegments: () => segments,
    };
    const fonts = exp.collectFontsToLoad(textNode);
    expect(fonts).toEqual([
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter', style: 'Bold' },
    ]);
    // mixedSymbol not actually used — kept only to suppress unused-var warning.
    void mixedSymbol;
  });

  it('normalizeNodeDataOptions clamps to positive integers with safe caps', () => {
    expect(helpers.normalizeNodeDataOptions(undefined)).toEqual({ depth: 3, maxChildren: 200 });
    expect(helpers.normalizeNodeDataOptions({ depth: -5, maxChildren: 0 })).toEqual({ depth: 3, maxChildren: 200 });
    expect(helpers.normalizeNodeDataOptions({ depth: 2, maxChildren: 50 })).toEqual({ depth: 2, maxChildren: 50 });
    expect(helpers.normalizeNodeDataOptions({ depth: 999, maxChildren: 999 })).toEqual({ depth: 3, maxChildren: 200 });
    expect(helpers.normalizeNodeDataOptions({ depth: 1.9, maxChildren: 10.9 })).toEqual({ depth: 1, maxChildren: 10 });
  });

  it('serializeNodeParent returns layoutMode when present, null otherwise', () => {
    expect(helpers.serializeNodeParent({ parent: null })).toBeNull();
    expect(helpers.serializeNodeParent({ parent: { id: '1:0', name: 'Page', type: 'PAGE' } })).toEqual({
      id: '1:0',
      name: 'Page',
      type: 'PAGE',
      layoutMode: null,
    });
    expect(
      helpers.serializeNodeParent({ parent: { id: '1:0', name: 'Frame', type: 'FRAME', layoutMode: 'VERTICAL' } }),
    ).toEqual({ id: '1:0', name: 'Frame', type: 'FRAME', layoutMode: 'VERTICAL' });
  });
});
