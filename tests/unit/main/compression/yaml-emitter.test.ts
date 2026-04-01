import { describe, expect, it } from 'vitest';
import { toYaml } from '../../../../src/main/compression/yaml-emitter.js';

describe('toYaml', () => {
  it('serializes null', () => {
    expect(toYaml(null)).toBe('null\n');
  });

  it('serializes strings', () => {
    expect(toYaml('hello')).toBe('hello\n');
  });

  it('quotes strings that look like numbers', () => {
    expect(toYaml('42')).toBe('"42"\n');
  });

  it('quotes strings with special YAML characters', () => {
    expect(toYaml('#comment')).toBe('"#comment"\n');
  });

  it('serializes numbers', () => {
    expect(toYaml(42)).toBe('42\n');
    expect(toYaml(3.14)).toBe('3.14\n');
  });

  it('serializes booleans', () => {
    expect(toYaml(true)).toBe('true\n');
    expect(toYaml(false)).toBe('false\n');
  });

  it('serializes flat objects', () => {
    const result = toYaml({ id: '1:1', name: 'Frame', type: 'FRAME' });
    expect(result).toContain('id: 1:1');
    expect(result).toContain('name: Frame');
    expect(result).toContain('type: FRAME');
  });

  it('serializes nested objects', () => {
    const result = toYaml({ layout: { mode: 'row', gap: '16px' } });
    expect(result).toContain('layout:');
    expect(result).toContain('  mode: row');
    expect(result).toContain('  gap: 16px');
  });

  it('serializes arrays as YAML lists', () => {
    const result = toYaml({ items: ['a', 'b', 'c'] });
    expect(result).toContain('- a');
    expect(result).toContain('- b');
    expect(result).toContain('- c');
  });

  it('serializes empty objects as {}', () => {
    const result = toYaml({ empty: {} });
    expect(result).toContain('empty: {}');
  });

  it('serializes empty arrays as []', () => {
    const result = toYaml({ empty: [] });
    expect(result).toContain('empty: []');
  });

  it('handles SemanticNode-like structures', () => {
    const node = {
      id: '1:1',
      name: 'Card',
      type: 'FRAME',
      layout: { mode: 'column', gap: '16px', padding: '24px' },
      children: [{ id: '2:1', name: 'Title', type: 'TEXT', text: 'Hello' }],
    };
    const result = toYaml(node);
    expect(result).toContain('id: 1:1');
    expect(result).toContain('name: Card');
    expect(result).toContain('mode: column');
    expect(result).toContain('text: Hello');
  });

  it('quotes true/false/null strings', () => {
    expect(toYaml('true')).toBe('"true"\n');
    expect(toYaml('false')).toBe('"false"\n');
    expect(toYaml('null')).toBe('"null"\n');
  });

  it('quotes empty strings', () => {
    expect(toYaml('')).toBe('""\n');
  });
});
