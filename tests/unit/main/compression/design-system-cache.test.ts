import { describe, expect, it, vi } from 'vitest';
import { rgbaToHex } from '../../../../src/main/compression/color-utils.js';
import { compactDesignSystem, DesignSystemCache } from '../../../../src/main/compression/design-system-cache.js';

// ── rgbaToHex ────────────────────────────────────

describe('rgbaToHex', () => {
  it('converts pure red', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0 })).toBe('#FF0000');
  });

  it('converts {r:0.2, g:0.4, b:1}', () => {
    expect(rgbaToHex({ r: 0.2, g: 0.4, b: 1 })).toBe('#3366FF');
  });

  it('converts pure black', () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });
});

// ── compactDesignSystem ──────────────────────────

const REALISTIC_RAW = {
  variables: [
    {
      name: 'Brand',
      modes: [
        { modeId: 'm1', name: 'Light' },
        { modeId: 'm2', name: 'Dark' },
      ],
      variables: [
        {
          name: 'color/primary',
          resolvedType: 'COLOR',
          valuesByMode: {
            m1: { r: 0.2, g: 0.4, b: 1.0 },
            m2: { r: 0.1, g: 0.2, b: 0.8 },
          },
        },
        {
          name: 'color/secondary',
          resolvedType: 'COLOR',
          valuesByMode: {
            m1: { r: 1, g: 0, b: 0 },
            m2: { r: 0.8, g: 0, b: 0 },
          },
        },
      ],
    },
    {
      name: 'Spacing',
      modes: [{ modeId: 's1', name: 'Default' }],
      variables: [
        {
          name: 'spacing/sm',
          resolvedType: 'FLOAT',
          valuesByMode: { s1: 8 },
        },
        {
          name: 'label/cta',
          resolvedType: 'STRING',
          valuesByMode: { s1: 'Click me' },
        },
        {
          name: 'visible',
          resolvedType: 'BOOLEAN',
          valuesByMode: { s1: true },
        },
      ],
    },
  ],
  components: [
    {
      name: 'Button/Primary',
      key: 'abc123',
      componentSetName: 'Button',
      componentProperties: { variant: {}, size: {}, disabled: {} },
    },
    {
      name: 'Button/Secondary',
      key: 'def456',
      componentSetName: 'Button',
      componentProperties: { variant: {}, size: {} },
    },
  ],
};

describe('compactDesignSystem', () => {
  it('produces correct structure for realistic raw data with 2 collections and 5 variables', () => {
    const result = compactDesignSystem(REALISTIC_RAW);

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('Brand');
    expect(result.variables[0].modes).toEqual(['Light', 'Dark']);
    expect(Object.keys(result.variables[0].vars)).toEqual(['color/primary', 'color/secondary']);

    expect(result.variables[1].name).toBe('Spacing');
    expect(result.variables[1].modes).toEqual(['Default']);
    expect(Object.keys(result.variables[1].vars)).toHaveLength(3);
  });

  it('converts COLOR variable values to hex strings', () => {
    const result = compactDesignSystem(REALISTIC_RAW);
    const brand = result.variables[0];

    expect(brand.vars['color/primary'].type).toBe('COLOR');
    expect(brand.vars['color/primary'].values.Light).toBe('#3366FF');
    expect(brand.vars['color/primary'].values.Dark).toBe('#1A33CC');
    expect(brand.vars['color/secondary'].values.Light).toBe('#FF0000');
  });

  it('preserves FLOAT and STRING and BOOLEAN values as-is', () => {
    const result = compactDesignSystem(REALISTIC_RAW);
    const spacing = result.variables[1];

    expect(spacing.vars['spacing/sm'].type).toBe('FLOAT');
    expect(spacing.vars['spacing/sm'].values.Default).toBe(8);

    expect(spacing.vars['label/cta'].type).toBe('STRING');
    expect(spacing.vars['label/cta'].values.Default).toBe('Click me');

    expect(spacing.vars.visible.type).toBe('BOOLEAN');
    expect(spacing.vars.visible.values.Default).toBe(true);
  });

  it('extracts component props from componentProperties', () => {
    const result = compactDesignSystem(REALISTIC_RAW);

    const btn1 = result.components.find((c) => c.key === 'abc123')!;
    expect(btn1.props).toEqual(expect.arrayContaining(['variant', 'size', 'disabled']));
    expect(btn1.props).toHaveLength(3);

    const btn2 = result.components.find((c) => c.key === 'def456')!;
    expect(btn2.props).toEqual(expect.arrayContaining(['variant', 'size']));
    expect(btn2.props).toHaveLength(2);
  });

  it('groups variants by componentSetName', () => {
    const result = compactDesignSystem(REALISTIC_RAW);

    for (const comp of result.components) {
      expect(comp.variants).toEqual(expect.arrayContaining(['Button/Primary', 'Button/Secondary']));
    }
  });

  it('handles empty design system', () => {
    const result = compactDesignSystem({ variables: [], components: [] });
    expect(result.variables).toEqual([]);
    expect(result.components).toEqual([]);
  });

  it('treats null/undefined components as empty array', () => {
    const result = compactDesignSystem({ variables: [], components: null });
    expect(result.components).toEqual([]);

    const result2 = compactDesignSystem({ variables: [], components: undefined });
    expect(result2.components).toEqual([]);
  });
});

// ── DesignSystemCache ────────────────────────────

describe('DesignSystemCache', () => {
  it('returns null on cache miss (empty cache)', () => {
    const cache = new DesignSystemCache();
    expect(cache.get(true)).toBeNull();
    expect(cache.get(false)).toBeNull();
  });

  it('get(true) returns compact form after set()', () => {
    const cache = new DesignSystemCache();
    const { compact } = cache.set(REALISTIC_RAW);
    const result = cache.get(true);
    expect(result).toEqual(compact);
    expect((result as any).variables).toBeDefined();
    expect((result as any).components).toBeDefined();
  });

  it('get(false) returns raw form after set()', () => {
    const cache = new DesignSystemCache();
    cache.set(REALISTIC_RAW);
    const result = cache.get(false);
    expect(result).toBe(REALISTIC_RAW);
  });

  it('invalidate() causes next get() to return null', () => {
    const cache = new DesignSystemCache();
    cache.set(REALISTIC_RAW);
    cache.invalidate();
    expect(cache.get(true)).toBeNull();
    expect(cache.get(false)).toBeNull();
  });

  it('get() returns null after TTL expiry', () => {
    vi.useFakeTimers();
    const cache = new DesignSystemCache(5_000);
    cache.set(REALISTIC_RAW);
    vi.advanceTimersByTime(5_001);
    expect(cache.get(true)).toBeNull();
    vi.useRealTimers();
  });

  it('isValid() returns false when expired', () => {
    vi.useFakeTimers();
    const cache = new DesignSystemCache(5_000);
    cache.set(REALISTIC_RAW);
    vi.advanceTimersByTime(5_001);
    expect(cache.isValid()).toBe(false);
    vi.useRealTimers();
  });

  it('set() after invalidate() re-populates the cache', () => {
    const cache = new DesignSystemCache();
    cache.set(REALISTIC_RAW);
    cache.invalidate();
    expect(cache.get(true)).toBeNull();

    const simple = { variables: [], components: [] };
    cache.set(simple);
    const result = cache.get(true);
    expect(result).not.toBeNull();
    expect(result!.variables).toEqual([]);
  });

  it('isValid() returns false on empty cache', () => {
    const cache = new DesignSystemCache();
    expect(cache.isValid()).toBe(false);
  });

  it('isValid() returns true within TTL', () => {
    vi.useFakeTimers();
    const cache = new DesignSystemCache(5_000);
    cache.set(REALISTIC_RAW);
    vi.advanceTimersByTime(4_999);
    expect(cache.isValid()).toBe(true);
    vi.useRealTimers();
  });
});
