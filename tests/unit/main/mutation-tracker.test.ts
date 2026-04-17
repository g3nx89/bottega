/**
 * mutation-tracker.ts — shared node-ID extraction used by guardrails,
 * rewind, and the judge harness. The logic was extracted verbatim from
 * session-events.ts; these tests lock in the contract so a future refactor
 * of the regex or input shape doesn't silently break consumers.
 */

import { describe, expect, it } from 'vitest';
import { extractCreatedNodeIds, extractTargetNodeIds } from '../../../src/main/mutation-tracker.js';

describe('extractTargetNodeIds — input shapes', () => {
  it('extracts nodeId scalar', () => {
    expect(extractTargetNodeIds('figma_set_fills', { nodeId: '1:2' })).toEqual(['1:2']);
  });
  it('extracts nodeIds array', () => {
    expect(extractTargetNodeIds('figma_delete', { nodeIds: ['1:2', '1:3'] })).toEqual(['1:2', '1:3']);
  });
  it('extracts parentId fallback for create-type tools', () => {
    expect(extractTargetNodeIds('figma_create_child', { parentId: '1:4' })).toEqual(['1:4']);
  });
  it('extracts single nodeId from figma_execute code', () => {
    expect(extractTargetNodeIds('figma_execute', { code: 'await figma.getNodeByIdAsync("5:6")' })).toEqual(['5:6']);
  });
  it('extracts multiple IDs from figma_execute code', () => {
    const code = 'const a = await figma.getNodeByIdAsync("1:2"); const b = await figma.getNodeByIdAsync("3:4");';
    expect(extractTargetNodeIds('figma_execute', { code })).toEqual(['1:2', '3:4']);
  });
  it('returns [] for empty object', () => {
    expect(extractTargetNodeIds('figma_set_fills', {})).toEqual([]);
  });
  it('returns [] for null input', () => {
    expect(extractTargetNodeIds('figma_set_fills', null)).toEqual([]);
  });
  it('ignores non-string nodeId', () => {
    expect(extractTargetNodeIds('figma_set_fills', { nodeId: 123 })).toEqual([]);
  });
  it('skips empty strings in nodeIds array', () => {
    expect(extractTargetNodeIds('figma_delete', { nodeIds: ['1:2', '', '3:4'] })).toEqual(['1:2', '3:4']);
  });
});

describe('extractCreatedNodeIds — result shapes', () => {
  it('extracts id from JSON text content', () => {
    const result = { content: [{ type: 'text', text: '{"id":"7:8"}' }] };
    expect(extractCreatedNodeIds(result)).toEqual(['7:8']);
  });
  it('extracts nodeId field alias', () => {
    const result = { content: [{ type: 'text', text: '{"nodeId":"9:10","other":1}' }] };
    expect(extractCreatedNodeIds(result)).toEqual(['9:10']);
  });
  it('dedupes duplicate IDs across content blocks', () => {
    const result = {
      content: [
        { type: 'text', text: '{"id":"1:1"}' },
        { type: 'text', text: '{"nodeId":"1:1","extra":"foo"}' },
      ],
    };
    expect(extractCreatedNodeIds(result)).toEqual(['1:1']);
  });
  it('extracts text-format node=N:M pattern', () => {
    const result = { content: [{ type: 'text', text: 'Created node=5:99 successfully' }] };
    expect(extractCreatedNodeIds(result)).toEqual(['5:99']);
  });
  it('returns [] when content is not an array', () => {
    expect(extractCreatedNodeIds({ content: 'nope' })).toEqual([]);
  });
  it('returns [] when result is null', () => {
    expect(extractCreatedNodeIds(null)).toEqual([]);
  });
});
