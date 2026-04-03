import { describe, expect, it } from 'vitest';
import { compactDesignSystem, DesignSystemCache } from '../../../../src/main/compression/design-system-cache.js';

describe('Extended DS cache', () => {
  it('includes dsStatus=active when variables exist', () => {
    const raw = {
      variables: [
        {
          name: 'Tokens',
          modes: [{ modeId: 'm1', name: 'Light' }],
          variables: [
            { name: 'colors/primary', resolvedType: 'COLOR', valuesByMode: { m1: { r: 0.65, g: 0.35, b: 1 } } },
          ],
        },
      ],
      components: [],
    };
    const compact = compactDesignSystem(raw);
    expect(compact.dsStatus).toBe('active');
  });

  it('includes dsStatus=partial when collections exist but empty', () => {
    const raw = {
      variables: [{ name: 'Tokens', modes: [{ modeId: 'm1', name: 'Light' }], variables: [] }],
      components: [],
    };
    const compact = compactDesignSystem(raw);
    expect(compact.dsStatus).toBe('partial');
  });

  it('includes dsStatus=none when no collections', () => {
    const raw = { variables: [], components: [] };
    const compact = compactDesignSystem(raw);
    expect(compact.dsStatus).toBe('none');
  });

  it('includes rules from raw data', () => {
    const raw = {
      variables: [],
      components: [],
      rules: [{ section: 'colors', content: 'Use semantic names' }],
    };
    const compact = compactDesignSystem(raw);
    expect(compact.rules).toEqual([{ section: 'colors', content: 'Use semantic names' }]);
  });

  it('defaults rules to empty array', () => {
    const compact = compactDesignSystem({ variables: [], components: [] });
    expect(compact.rules).toEqual([]);
  });

  it('includes naming from raw data', () => {
    const raw = {
      variables: [],
      components: [],
      naming: { pageStyle: 'PascalCase', componentStyle: 'PascalCase', variableStyle: 'camelCase' },
    };
    const compact = compactDesignSystem(raw);
    expect(compact.naming).toEqual({
      pageStyle: 'PascalCase',
      componentStyle: 'PascalCase',
      variableStyle: 'camelCase',
    });
  });

  it('defaults naming to null', () => {
    const compact = compactDesignSystem({ variables: [], components: [] });
    expect(compact.naming).toBeNull();
  });

  it('cache stores and retrieves extended fields', () => {
    const cache = new DesignSystemCache(60000);
    const raw = {
      variables: [
        {
          name: 'Tokens',
          modes: [{ modeId: 'm1', name: 'Light' }],
          variables: [{ name: 'x', resolvedType: 'COLOR', valuesByMode: { m1: { r: 1, g: 0, b: 0 } } }],
        },
      ],
      components: [],
      rules: [{ section: 'colors', content: 'rule1' }],
      naming: { pageStyle: 'slash', componentStyle: 'PascalCase', variableStyle: 'slash' },
    };
    cache.set(raw, 'file1');
    const cached = cache.get(true, 'file1');
    expect(cached).not.toBeNull();
    expect((cached as any).dsStatus).toBe('active');
    expect((cached as any).rules).toHaveLength(1);
    expect((cached as any).naming).not.toBeNull();
  });
});
