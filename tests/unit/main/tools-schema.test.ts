import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

/**
 * Tool schema validation tests — verifies that TypeBox schemas
 * used in ToolDefinition accept valid params and reject invalid ones.
 *
 * These tests validate schemas in isolation (no Figma connection needed).
 */

// Replicate schemas from tool files to test them independently
const schemas = {
  figma_execute: Type.Object({
    code: Type.String(),
    timeout: Type.Optional(Type.Number({ default: 30000 })),
  }),

  figma_set_fills: Type.Object({
    nodeId: Type.String(),
    fills: Type.Array(Type.Any()),
  }),

  figma_set_text: Type.Object({
    nodeId: Type.String(),
    text: Type.String(),
    fontFamily: Type.Optional(Type.String()),
    fontSize: Type.Optional(Type.Number()),
    fontWeight: Type.Optional(Type.String()),
  }),

  figma_resize: Type.Object({
    nodeId: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
  }),

  figma_move: Type.Object({
    nodeId: Type.String(),
    x: Type.Number(),
    y: Type.Number(),
  }),

  figma_create_child: Type.Object({
    parentId: Type.String(),
    type: Type.String(),
    props: Type.Optional(Type.Record(Type.String(), Type.Any())),
  }),

  figma_clone: Type.Object({
    nodeId: Type.String(),
  }),

  figma_delete: Type.Object({
    nodeId: Type.String(),
  }),

  figma_rename: Type.Object({
    nodeId: Type.String(),
    name: Type.String(),
  }),
};

describe('Tool schemas — valid params', () => {
  it('figma_execute accepts code string', () => {
    expect(Value.Check(schemas.figma_execute, { code: 'figma.currentPage' })).toBe(true);
  });

  it('figma_execute accepts optional timeout', () => {
    expect(Value.Check(schemas.figma_execute, { code: 'x', timeout: 5000 })).toBe(true);
  });

  it('figma_set_fills accepts nodeId + fills array', () => {
    expect(
      Value.Check(schemas.figma_set_fills, {
        nodeId: '1:2',
        fills: [{ type: 'SOLID', color: '#FF0000' }],
      }),
    ).toBe(true);
  });

  it('figma_set_text accepts all optional font params', () => {
    expect(
      Value.Check(schemas.figma_set_text, {
        nodeId: '1:2',
        text: 'Hello',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'Bold',
      }),
    ).toBe(true);
  });

  it('figma_resize accepts nodeId + dimensions', () => {
    expect(Value.Check(schemas.figma_resize, { nodeId: '1:2', width: 100, height: 200 })).toBe(true);
  });

  it('figma_move accepts nodeId + coordinates', () => {
    expect(Value.Check(schemas.figma_move, { nodeId: '1:2', x: 10, y: 20 })).toBe(true);
  });

  it('figma_create_child accepts parentId + type + optional props', () => {
    expect(
      Value.Check(schemas.figma_create_child, {
        parentId: '0:1',
        type: 'FRAME',
        props: { width: 100, height: 50 },
      }),
    ).toBe(true);
  });
});

describe('Tool schemas — invalid params', () => {
  it('figma_execute rejects missing code', () => {
    expect(Value.Check(schemas.figma_execute, {})).toBe(false);
  });

  it('figma_execute rejects numeric code', () => {
    expect(Value.Check(schemas.figma_execute, { code: 123 })).toBe(false);
  });

  it('figma_set_fills rejects missing nodeId', () => {
    expect(Value.Check(schemas.figma_set_fills, { fills: [] })).toBe(false);
  });

  it('figma_set_fills rejects fills as non-array', () => {
    expect(Value.Check(schemas.figma_set_fills, { nodeId: '1:2', fills: 'red' })).toBe(false);
  });

  it('figma_resize rejects string dimensions', () => {
    expect(Value.Check(schemas.figma_resize, { nodeId: '1:2', width: '100', height: '200' })).toBe(false);
  });

  it('figma_move rejects missing coordinates', () => {
    expect(Value.Check(schemas.figma_move, { nodeId: '1:2', x: 10 })).toBe(false);
  });

  it('figma_rename rejects missing name', () => {
    expect(Value.Check(schemas.figma_rename, { nodeId: '1:2' })).toBe(false);
  });

  it('figma_delete rejects empty object', () => {
    expect(Value.Check(schemas.figma_delete, {})).toBe(false);
  });
});
