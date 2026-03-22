import { describe, expect, it } from 'vitest';
import { enrichExecuteResult } from '../../src/main/compression/execute-enricher.js';

describe('enrichExecuteResult', () => {
  it('prefixes result containing node IDs and preserves full text', () => {
    const text = 'Created node "42:15" successfully.';
    const result = enrichExecuteResult([{ type: 'text', text }]);
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toBe('Returned IDs: 42:15\n' + text);
    expect(result!.extractedIds).toEqual(['42:15']);
  });

  it('returns null when result contains no node IDs', () => {
    const result = enrichExecuteResult([{ type: 'text', text: 'Operation completed successfully.' }]);
    expect(result).toBeNull();
  });

  it('extracts all distinct IDs when multiple unique IDs are present', () => {
    const text = 'Nodes "1:1", "2:3", "99:100" were updated.';
    const result = enrichExecuteResult([{ type: 'text', text }]);
    expect(result).not.toBeNull();
    expect(result!.extractedIds).toEqual(['1:1', '2:3', '99:100']);
    expect(result!.content[0].text).toContain('Returned IDs: 1:1, 2:3, 99:100\n');
  });

  it('deduplicates repeated IDs in extractedIds', () => {
    const text = 'Node "5:10" cloned to "5:10" and "5:10".';
    const result = enrichExecuteResult([{ type: 'text', text }]);
    expect(result).not.toBeNull();
    expect(result!.extractedIds).toEqual(['5:10']);
    expect(result!.content[0].text).toBe('Returned IDs: 5:10\n' + text);
  });

  it('returns null for an empty content array', () => {
    const result = enrichExecuteResult([]);
    expect(result).toBeNull();
  });

  it('returns null when content[0].text is a number, not a string', () => {
    const result = enrichExecuteResult([{ type: 'text', text: 12345 }]);
    expect(result).toBeNull();
  });

  it('preserves the full text intact for a very large result with IDs', () => {
    const padding = 'x'.repeat(50_000);
    const text = padding + ' "7:8" ' + padding;
    const result = enrichExecuteResult([{ type: 'text', text }]);
    expect(result).not.toBeNull();
    // Full original text must be present after the prefix line
    expect(result!.content[0].text).toBe('Returned IDs: 7:8\n' + text);
    expect(result!.content[0].text.length).toBe('Returned IDs: 7:8\n'.length + text.length);
    expect(result!.extractedIds).toEqual(['7:8']);
  });

  it('extractedIds matches all unique IDs in the result', () => {
    const ids = ['0:1', '123:456', '999:0', '42:42'];
    const text = ids.map((id) => `"${id}"`).join(' and ');
    const result = enrichExecuteResult([{ type: 'text', text }]);
    expect(result).not.toBeNull();
    expect(result!.extractedIds.sort()).toEqual([...ids].sort());
  });

  it('still works when content[0] lacks a type field but has text', () => {
    const text = 'Updated "3:7" with new fill.';
    const result = enrichExecuteResult([{ text }]);
    expect(result).not.toBeNull();
    expect(result!.extractedIds).toEqual(['3:7']);
    expect(result!.content[0].text).toBe('Returned IDs: 3:7\n' + text);
  });
});
