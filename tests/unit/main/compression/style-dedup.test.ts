import { describe, expect, it } from 'vitest';
import type { ExtractionContext, GlobalVars, SemanticNode } from '../../../../src/main/compression/semantic-modes.js';
import { findOrCreateNamedVar, findOrCreateVar, inlineSingles } from '../../../../src/main/compression/style-dedup.js';

function makeContext(): ExtractionContext {
  return {
    globalVars: { styles: {} },
    currentDepth: 0,
    styleCache: new Map(),
    nodesProcessed: 0,
  };
}

describe('findOrCreateVar', () => {
  it('creates a new entry for a new value', () => {
    const ctx = makeContext();
    const ref = findOrCreateVar(ctx, '#FF0000', 'fill');
    expect(ref).toMatch(/^fill_/);
    expect(ctx.globalVars.styles[ref]).toBe('#FF0000');
  });

  it('returns existing ref for duplicate value', () => {
    const ctx = makeContext();
    const ref1 = findOrCreateVar(ctx, '#FF0000', 'fill');
    const ref2 = findOrCreateVar(ctx, '#FF0000', 'fill');
    expect(ref1).toBe(ref2);
    expect(Object.keys(ctx.globalVars.styles)).toHaveLength(1);
  });

  it('creates different refs for different values', () => {
    const ctx = makeContext();
    const ref1 = findOrCreateVar(ctx, '#FF0000', 'fill');
    const ref2 = findOrCreateVar(ctx, '#00FF00', 'fill');
    expect(ref1).not.toBe(ref2);
    expect(Object.keys(ctx.globalVars.styles)).toHaveLength(2);
  });

  it('handles complex objects as values', () => {
    const ctx = makeContext();
    const value = { fontFamily: 'Inter', fontWeight: 700, fontSize: 16 };
    const ref = findOrCreateVar(ctx, value, 'ts');
    expect(ctx.globalVars.styles[ref]).toEqual(value);
  });
});

describe('findOrCreateNamedVar', () => {
  it('uses the style name as the key', () => {
    const ctx = makeContext();
    const ref = findOrCreateNamedVar(ctx, '#FF0000', 'Primary/Blue');
    expect(ref).toBe('Primary/Blue');
    expect(ctx.globalVars.styles['Primary/Blue']).toBe('#FF0000');
  });

  it('makes subsequent lookups for same value return named key', () => {
    const ctx = makeContext();
    findOrCreateNamedVar(ctx, '#FF0000', 'Primary/Blue');
    const ref2 = findOrCreateVar(ctx, '#FF0000', 'fill');
    expect(ref2).toBe('Primary/Blue');
  });
});

describe('inlineSingles', () => {
  function makeNode(overrides: Partial<SemanticNode> = {}): SemanticNode {
    return { id: '1:1', name: 'N', type: 'FRAME', ...overrides };
  }

  it('inlines a fill referenced only once', () => {
    const globalVars: GlobalVars = { styles: { fill_abc: '#FF0000' } };
    const nodes: SemanticNode[] = [makeNode({ fills: 'fill_abc' })];

    inlineSingles(nodes, globalVars);

    expect(nodes[0].fills).toBe('#FF0000'); // inlined
    expect(globalVars.styles.fill_abc).toBeUndefined(); // removed
  });

  it('keeps a fill referenced twice in globalVars', () => {
    const globalVars: GlobalVars = { styles: { fill_abc: '#FF0000' } };
    const nodes: SemanticNode[] = [
      makeNode({ id: '1:1', fills: 'fill_abc' }),
      makeNode({ id: '1:2', fills: 'fill_abc' }),
    ];

    inlineSingles(nodes, globalVars);

    expect(nodes[0].fills).toBe('fill_abc'); // still a ref
    expect(nodes[1].fills).toBe('fill_abc');
    expect(globalVars.styles.fill_abc).toBe('#FF0000'); // still in globalVars
  });

  it('handles mixed — some singles, some shared', () => {
    const globalVars: GlobalVars = {
      styles: {
        fill_shared: '#FF0000',
        fill_unique: '#00FF00',
      },
    };
    const nodes: SemanticNode[] = [
      makeNode({ id: '1:1', fills: 'fill_shared' }),
      makeNode({ id: '1:2', fills: 'fill_shared' }),
      makeNode({ id: '1:3', fills: 'fill_unique' }),
    ];

    inlineSingles(nodes, globalVars);

    expect(globalVars.styles.fill_shared).toBe('#FF0000'); // kept
    expect(globalVars.styles.fill_unique).toBeUndefined(); // removed
    expect(nodes[2].fills).toBe('#00FF00'); // inlined
  });

  it('traverses nested children for counting', () => {
    const globalVars: GlobalVars = { styles: { fill_deep: '#0000FF' } };
    const child = makeNode({ id: '2:1', fills: 'fill_deep' });
    const nodes: SemanticNode[] = [makeNode({ id: '1:1', fills: 'fill_deep', children: [child] })];

    inlineSingles(nodes, globalVars);

    // Referenced twice (parent + child) — stays in globalVars
    expect(globalVars.styles.fill_deep).toBe('#0000FF');
  });

  it('replaces refs in strokes, effects, and textStyle fields', () => {
    const globalVars: GlobalVars = {
      styles: {
        stroke_a: '#000 1px',
        fx_a: { boxShadow: '2px 4px 8px' },
        ts_a: { fontFamily: 'Inter' },
      },
    };
    const nodes: SemanticNode[] = [makeNode({ strokes: 'stroke_a', effects: 'fx_a', textStyle: 'ts_a' })];

    inlineSingles(nodes, globalVars);

    expect(nodes[0].strokes).toBe('#000 1px');
    expect(nodes[0].effects).toEqual({ boxShadow: '2px 4px 8px' });
    expect(nodes[0].textStyle).toEqual({ fontFamily: 'Inter' });
  });
});
