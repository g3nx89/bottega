import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '../../../../src/main/compression/semantic-modes.js';
import {
  collapseSvgContainers,
  filterInvisible,
  removeEmptyKeys,
} from '../../../../src/main/compression/tree-collapse.js';

function makeNode(overrides: Partial<SemanticNode> = {}): SemanticNode {
  return { id: '1:1', name: 'Node', type: 'FRAME', ...overrides };
}

// ── filterInvisible ──────────────────────────────

describe('filterInvisible', () => {
  it('returns true for visible node', () => {
    expect(filterInvisible({ visible: true })).toBe(true);
  });

  it('returns false for invisible node', () => {
    expect(filterInvisible({ visible: false })).toBe(false);
  });

  it('returns true when visible is undefined (default visible)', () => {
    expect(filterInvisible({})).toBe(true);
  });
});

// ── collapseSvgContainers ────────────────────────

describe('collapseSvgContainers', () => {
  it('collapses FRAME with all VECTOR children to IMAGE-SVG', () => {
    const raw = { type: 'FRAME' };
    const result = makeNode({ type: 'FRAME' });
    const children: SemanticNode[] = [
      makeNode({ id: '2:1', type: 'IMAGE-SVG' }),
      makeNode({ id: '2:2', type: 'IMAGE-SVG' }),
    ];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(result.type).toBe('IMAGE-SVG');
    expect(finalChildren).toHaveLength(0);
  });

  it('collapses BOOLEAN_OPERATION with vector children', () => {
    const raw = { type: 'BOOLEAN_OPERATION' };
    const result = makeNode({ type: 'BOOLEAN_OPERATION' });
    const children: SemanticNode[] = [makeNode({ type: 'IMAGE-SVG' }), makeNode({ type: 'ELLIPSE' })];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(result.type).toBe('IMAGE-SVG');
    expect(finalChildren).toHaveLength(0);
  });

  it('does NOT collapse when children have mixed types', () => {
    const raw = { type: 'FRAME' };
    const result = makeNode({ type: 'FRAME' });
    const children: SemanticNode[] = [makeNode({ type: 'IMAGE-SVG' }), makeNode({ type: 'TEXT' })];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(result.type).toBe('FRAME');
    expect(finalChildren).toHaveLength(2);
  });

  it('does NOT collapse when parent has image fills', () => {
    const raw = {
      type: 'FRAME',
      fills: [{ type: 'IMAGE', visible: true }],
    };
    const result = makeNode({ type: 'FRAME' });
    const children: SemanticNode[] = [makeNode({ type: 'IMAGE-SVG' })];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(result.type).toBe('FRAME');
    expect(finalChildren).toHaveLength(1);
  });

  it('collapses GROUP with single IMAGE-SVG child', () => {
    const raw = { type: 'GROUP' };
    const result = makeNode({ type: 'GROUP' });
    const children: SemanticNode[] = [makeNode({ type: 'IMAGE-SVG' })];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(result.type).toBe('IMAGE-SVG');
    expect(finalChildren).toHaveLength(0);
  });

  it('returns children unchanged for empty array', () => {
    const raw = { type: 'FRAME' };
    const result = makeNode({ type: 'FRAME' });
    const children: SemanticNode[] = [];

    const finalChildren = collapseSvgContainers(raw, result, children);
    expect(finalChildren).toHaveLength(0);
    expect(result.type).toBe('FRAME');
  });
});

// ── removeEmptyKeys ──────────────────────────────

describe('removeEmptyKeys', () => {
  it('strips undefined values', () => {
    expect(removeEmptyKeys({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('strips null values', () => {
    expect(removeEmptyKeys({ a: 1, b: null })).toEqual({ a: 1 });
  });

  it('strips empty arrays', () => {
    expect(removeEmptyKeys({ a: 1, b: [] })).toEqual({ a: 1 });
  });

  it('strips empty objects', () => {
    expect(removeEmptyKeys({ a: 1, b: {} })).toEqual({ a: 1 });
  });

  it('preserves 0, false, and empty string', () => {
    expect(removeEmptyKeys({ a: 0, b: false, c: '' })).toEqual({ a: 0, b: false, c: '' });
  });

  it('handles deeply nested structures', () => {
    const input = {
      a: { b: { c: null, d: 42 }, e: [] },
      f: 'hello',
      g: { h: {} },
    };
    const result = removeEmptyKeys(input);
    expect(result).toEqual({ a: { b: { d: 42 } }, f: 'hello' });
  });

  it('returns undefined for entirely empty object', () => {
    expect(removeEmptyKeys({ a: null, b: undefined })).toBeUndefined();
  });

  it('cleans arrays of empty values', () => {
    expect(removeEmptyKeys({ items: [null, 1, undefined, 2] })).toEqual({ items: [1, 2] });
  });
});
