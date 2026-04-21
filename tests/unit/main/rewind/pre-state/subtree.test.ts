import { describe, expect, it, vi } from 'vitest';
import { captureSubtreePreState } from '../../../../../src/main/rewind/pre-state/subtree.js';

function makeNode(id: string, name: string, children?: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id,
    type: 'FRAME',
    name,
    fills: [],
    strokes: [],
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    layoutSizing: { horizontal: 'FIXED', vertical: 'FIXED' },
    constraints: { horizontal: 'LEFT', vertical: 'TOP' },
    opacity: 1,
    cornerRadius: 0,
    parent: null,
    children: children ?? [],
  };
}

describe('captureSubtreePreState', () => {
  it('captures the full subtree when depth<=3 and children<=200', async () => {
    const subtree = makeNode('1:1', 'Root', [makeNode('1:2', 'Child', [makeNode('1:3', 'Grandchild')])]);
    const connector = { getNodeData: vi.fn().mockResolvedValue(subtree) };

    const result = await captureSubtreePreState(connector as never, '1:1');

    expect(connector.getNodeData).toHaveBeenCalledWith('1:1');
    expect(result).toEqual({ subtree });
  });

  it('marks nodes deeper than level 3 as truncated placeholders', async () => {
    const subtree = makeNode('1:1', 'Root', [
      makeNode('1:2', 'L1', [makeNode('1:3', 'L2', [makeNode('1:4', 'L3', [makeNode('1:5', 'L4')])])]),
    ]);
    const connector = { getNodeData: vi.fn().mockResolvedValue(subtree) };

    const result = await captureSubtreePreState(connector as never, '1:1');
    const rootChildren = (result.subtree as Record<string, unknown>).children as Array<Record<string, unknown>>;
    const level1Children = (rootChildren[0]?.children ?? []) as Array<Record<string, unknown>>;
    const level2Children = (level1Children[0]?.children ?? []) as Array<Record<string, unknown>>;
    const level3Children = (level2Children[0]?.children ?? []) as Array<Record<string, unknown>>;

    expect(level3Children[0]).toEqual({
      id: '1:5',
      type: 'FRAME',
      name: 'L4',
      truncated: true,
    });
    expect(level2Children[0]?.truncated).toBe(true);
  });

  it('truncates containers with more than 200 children to the first 200', async () => {
    const children = Array.from({ length: 250 }, (_, index) => makeNode(`1:${index + 2}`, `Child ${index + 1}`));
    const subtree = makeNode('1:1', 'Root', children);
    const connector = { getNodeData: vi.fn().mockResolvedValue(subtree) };

    const result = await captureSubtreePreState(connector as never, '1:1');
    const root = result.subtree as Record<string, unknown>;
    const serializedChildren = root.children as Array<Record<string, unknown>>;

    expect(serializedChildren).toHaveLength(200);
    expect(serializedChildren[0]?.id).toBe('1:2');
    expect(serializedChildren[199]?.id).toBe('1:201');
    expect(root.truncated).toBe(true);
  });

  it('normalizes missing and malformed fields to safe defaults', async () => {
    const connector = {
      getNodeData: vi.fn().mockResolvedValue({
        // id/type/name missing, fills not array, opacity non-number, parent undefined
        fills: 'not-an-array',
        opacity: 'full',
        children: undefined,
      }),
    };

    const result = await captureSubtreePreState(connector as never, '1:1');
    const node = result.subtree as Record<string, unknown>;
    expect(node.id).toBe('');
    expect(node.type).toBe('UNKNOWN');
    expect(node.name).toBe('');
    expect(node.fills).toEqual([]);
    expect(node.strokes).toEqual([]);
    expect(node.opacity).toBeNull();
    expect(node.cornerRadius).toBeNull();
    expect(node.parent).toEqual({}); // undefined → ensureObject({}) not null
    expect(node.children).toEqual([]);
    expect(node.truncated).toBeUndefined();
  });

  it('preserves explicit parent=null (root node) without wrapping in an object', async () => {
    const connector = {
      getNodeData: vi.fn().mockResolvedValue({ id: '0:1', type: 'PAGE', name: 'Page 1', parent: null, children: [] }),
    };

    const result = await captureSubtreePreState(connector as never, '0:1');
    const node = result.subtree as Record<string, unknown>;
    expect(node.parent).toBeNull();
  });

  it('propagates connector errors so the dispatcher can map them to skipReasons', async () => {
    const connector = { getNodeData: vi.fn().mockRejectedValue(new Error('node not found: 1:1')) };
    await expect(captureSubtreePreState(connector as never, '1:1')).rejects.toThrow('node not found');
  });
});
