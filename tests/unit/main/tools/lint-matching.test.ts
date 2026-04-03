import { describe, expect, it } from 'vitest';
import {
  checkAutoLayout,
  checkBoundVariables,
  checkColors,
  checkDepthAndSizing,
  checkEffects,
  checkNaming,
  checkSpacing,
  checkTypography,
} from '../../../../src/main/tools/lint.js';

describe('lint matching functions', () => {
  describe('checkColors', () => {
    it('returns empty for colors in palette', () => {
      const fills = [{ type: 'SOLID', color: { r: 0.65, g: 0.35, b: 1 } }];
      const palette = [{ r: 0.65, g: 0.35, b: 1 }];
      expect(checkColors(fills, palette)).toEqual([]);
    });

    it('detects color not in palette', () => {
      const fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
      const palette = [{ r: 0.65, g: 0.35, b: 1 }];
      const issues = checkColors(fills, palette);
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('color-not-in-palette');
    });

    it('flags unbound but correct value', () => {
      const fills = [{ type: 'SOLID', color: { r: 0.65, g: 0.35, b: 1 }, boundVariables: undefined }];
      const palette = [{ r: 0.65, g: 0.35, b: 1 }];
      const issues = checkColors(fills, palette, { requireBinding: true });
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('unbound-but-correct');
    });

    it('tolerates small floating point differences', () => {
      const fills = [{ type: 'SOLID', color: { r: 0.6500001, g: 0.35, b: 1 } }];
      const palette = [{ r: 0.65, g: 0.35, b: 1 }];
      expect(checkColors(fills, palette)).toEqual([]);
    });
  });

  describe('checkSpacing', () => {
    it('returns empty for spacing values in token set', () => {
      const node = { paddingTop: 16, paddingBottom: 16, itemSpacing: 8 };
      const spacingTokens = [4, 8, 16, 24, 32, 48];
      expect(checkSpacing(node, spacingTokens)).toEqual([]);
    });

    it('detects non-standard spacing', () => {
      const node = { paddingTop: 13, itemSpacing: 8 };
      const spacingTokens = [4, 8, 16, 24, 32, 48];
      const issues = checkSpacing(node, spacingTokens);
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('non-standard-spacing');
      expect(issues[0].property).toBe('paddingTop');
    });
  });

  describe('checkTypography', () => {
    it('returns empty for matching type scale', () => {
      const node = { fontSize: 16, fontFamily: 'Inter', fontWeight: 'Regular' };
      const typeScale = [{ fontSize: 16, fontFamily: 'Inter', fontWeight: 'Regular' }];
      expect(checkTypography(node, typeScale)).toEqual([]);
    });

    it('detects font size not in scale', () => {
      const node = { fontSize: 15, fontFamily: 'Inter' };
      const typeScale = [{ fontSize: 14 }, { fontSize: 16 }];
      const issues = checkTypography(node, typeScale);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('font-size-not-in-scale');
    });
  });

  describe('checkNaming', () => {
    it('returns empty for properly named nodes', () => {
      expect(checkNaming({ name: 'Card/Body', type: 'FRAME' })).toEqual([]);
    });

    it('flags default names', () => {
      const issues = checkNaming({ name: 'Frame 1', type: 'FRAME' });
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('default-name');
    });

    it('flags Rectangle default names', () => {
      const issues = checkNaming({ name: 'Rectangle 2', type: 'RECTANGLE' });
      expect(issues.length).toBe(1);
    });
  });

  describe('checkAutoLayout', () => {
    it('returns empty for frame with auto-layout', () => {
      expect(checkAutoLayout({ type: 'FRAME', layoutMode: 'VERTICAL', childCount: 2 })).toEqual([]);
    });

    it('flags frame with children but no auto-layout', () => {
      const issues = checkAutoLayout({ type: 'FRAME', layoutMode: 'NONE', childCount: 3 });
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('missing-auto-layout');
    });

    it('ignores leaf frames with no children', () => {
      expect(checkAutoLayout({ type: 'FRAME', layoutMode: 'NONE', childCount: 0 })).toEqual([]);
    });
  });

  describe('checkDepthAndSizing', () => {
    it('returns empty for acceptable depth', () => {
      expect(checkDepthAndSizing({ depth: 3, sizingH: 'FILL', sizingV: 'HUG' })).toEqual([]);
    });

    it('flags excessive nesting', () => {
      const issues = checkDepthAndSizing({ depth: 5 });
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('excessive-nesting');
    });

    it('flags FIXED sizing where FILL expected', () => {
      const issues = checkDepthAndSizing({ depth: 2, sizingH: 'FIXED', parentLayoutMode: 'HORIZONTAL' });
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('should-be-fill');
    });
  });

  describe('checkEffects', () => {
    it('returns empty when effects match styles', () => {
      const effects = [
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4 },
      ];
      const effectStyles = [
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4 },
      ];
      expect(checkEffects(effects, effectStyles)).toEqual([]);
    });

    it('flags unstandardized effects', () => {
      const effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 4 }, radius: 8 }];
      const effectStyles: any[] = [];
      const issues = checkEffects(effects, effectStyles);
      expect(issues.length).toBe(1);
    });
  });

  describe('checkBoundVariables', () => {
    it('returns empty when all values are bound', () => {
      const node = {
        fills: [{ type: 'SOLID', color: { r: 0.65, g: 0.35, b: 1 }, boundVariables: { color: { id: 'var1' } } }],
      };
      const dsVariables = [{ id: 'var1', name: 'colors/primary', resolvedValue: { r: 0.65, g: 0.35, b: 1 } }];
      expect(checkBoundVariables(node, dsVariables)).toEqual([]);
    });

    it('flags value matching DS but not bound', () => {
      const node = { fills: [{ type: 'SOLID', color: { r: 0.65, g: 0.35, b: 1 } }] };
      const dsVariables = [{ id: 'var1', name: 'colors/primary', resolvedValue: { r: 0.65, g: 0.35, b: 1 } }];
      const issues = checkBoundVariables(node, dsVariables);
      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe('should-be-bound');
      expect(issues[0].suggestedVariable).toBe('colors/primary');
    });
  });
});
