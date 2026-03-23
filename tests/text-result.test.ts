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

  // ── Edge cases: gap-filling ────────────────────────

  it('should return safe fallback for circular reference', () => {
    // Edge case: circular object — JSON.stringify would throw without safeguard
    const obj: any = { a: 1 };
    obj.self = obj;

    const result = textResult(obj);
    expect(result.content[0].text).toContain('[Serialization error]');
  });

  it('should return safe fallback for BigInt', () => {
    // Edge case: BigInt is not serializable by default
    const result = textResult(BigInt(42));
    expect(result.content[0].text).toContain('[Serialization error]');
  });

  it('should handle deeply nested object', () => {
    // Edge case: deep nesting — should not stack overflow
    let obj: any = { val: 'leaf' };
    for (let i = 0; i < 100; i++) {
      obj = { child: obj };
    }
    const result = textResult(obj);
    expect(result.content[0].text).toContain('leaf');
  });

  it('should handle empty string', () => {
    const result = textResult('');
    expect(result.content[0].text).toBe('""');
  });

  it('should handle number values', () => {
    expect(textResult(0).content[0].text).toBe('0');
    expect(textResult(-1).content[0].text).toBe('-1');
    expect(textResult(NaN).content[0].text).toBe('null'); // JSON.stringify(NaN) === 'null'
    expect(textResult(Infinity).content[0].text).toBe('null'); // JSON.stringify(Infinity) === 'null'
  });

  it('should handle boolean values', () => {
    expect(textResult(true).content[0].text).toBe('true');
    expect(textResult(false).content[0].text).toBe('false');
  });
});
