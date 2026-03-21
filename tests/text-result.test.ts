import { describe, expect, it } from 'vitest';
import { textResult } from '../src/main/tools/index.js';

describe('textResult', () => {
  it('should wrap a string into content array', () => {
    const result = textResult('hello');
    expect(result).toEqual({
      content: [{ type: 'text', text: '"hello"' }],
      details: {},
    });
  });

  it('should JSON-stringify objects', () => {
    const result = textResult({ connected: true, fileInfo: null });
    expect(result.content[0].text).toBe('{"connected":true,"fileInfo":null}');
  });

  it('should handle arrays', () => {
    const result = textResult([1, 2, 3]);
    expect(result.content[0].text).toBe('[1,2,3]');
  });

  it('should handle null', () => {
    const result = textResult(null);
    expect(result.content[0].text).toBe('null');
  });

  it('should handle undefined (JSON.stringify returns undefined)', () => {
    const result = textResult(undefined);
    // JSON.stringify(undefined) returns undefined, not a string
    expect(result.content[0].text).toBeUndefined();
  });

  it('should always return empty details object', () => {
    expect(textResult('x').details).toEqual({});
    expect(textResult({}).details).toEqual({});
  });
});
