import { expect } from 'vitest';

/**
 * Find a tool by name from a tools array. Throws if not found.
 */
export function findTool(tools: any[], name: string) {
  const t = tools.find((t: any) => t.name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t;
}

/**
 * Assert that a tool result matches the textResult format for the given data.
 */
export function expectTextResult(result: any, data: unknown) {
  expect(result).toEqual({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    details: {},
  });
}
