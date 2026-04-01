import { describe, expect, it } from 'vitest';
import {
  componentExtractor,
  identityExtractor,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
} from '../../../../src/main/compression/semantic-extractors.js';
import type { ExtractionContext, SemanticNode } from '../../../../src/main/compression/semantic-modes.js';

function makeContext(): ExtractionContext {
  return {
    globalVars: { styles: {} },
    currentDepth: 0,
    styleCache: new Map(),
    nodesProcessed: 0,
  };
}

function makeResult(): SemanticNode {
  return { id: '', name: '', type: '' };
}

// ── Identity ─────────────────────────────────────

describe('identityExtractor', () => {
  it('extracts id, name, type from FRAME', () => {
    const raw = { id: '1:1', name: 'Card', type: 'FRAME' };
    const result = makeResult();
    identityExtractor(raw, result, makeContext());
    expect(result.id).toBe('1:1');
    expect(result.name).toBe('Card');
    expect(result.type).toBe('FRAME');
  });

  it('converts VECTOR to IMAGE-SVG', () => {
    const raw = { id: '2:1', name: 'Path', type: 'VECTOR' };
    const result = makeResult();
    identityExtractor(raw, result, makeContext());
    expect(result.type).toBe('IMAGE-SVG');
  });

  it('preserves BOOLEAN_OPERATION type', () => {
    const raw = { id: '3:1', name: 'Union', type: 'BOOLEAN_OPERATION' };
    const result = makeResult();
    identityExtractor(raw, result, makeContext());
    expect(result.type).toBe('BOOLEAN_OPERATION');
  });

  it('uses defaults for missing fields', () => {
    const raw = {};
    const result = makeResult();
    identityExtractor(raw, result, makeContext());
    expect(result.id).toBe('?');
    expect(result.name).toBe('?');
    expect(result.type).toBe('UNKNOWN');
  });
});

// ── Layout ───────────────────────────────────────

describe('layoutExtractor', () => {
  it('maps HORIZONTAL to row', () => {
    const raw = { layoutMode: 'HORIZONTAL' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.mode).toBe('row');
  });

  it('maps VERTICAL to column', () => {
    const raw = { layoutMode: 'VERTICAL' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.mode).toBe('column');
  });

  it('maps primaryAxisAlignItems CENTER to justifyContent center', () => {
    const raw = { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.justifyContent).toBe('center');
  });

  it('omits justifyContent for MIN (default)', () => {
    const raw = { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'MIN' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.justifyContent).toBeUndefined();
  });

  it('maps SPACE_BETWEEN to space-between', () => {
    const raw = { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.justifyContent).toBe('space-between');
  });

  it('detects stretch when all children have cross-axis FILL', () => {
    const raw = {
      layoutMode: 'HORIZONTAL',
      counterAxisAlignItems: 'MIN',
      children: [{ layoutSizingVertical: 'FILL' }, { layoutSizingVertical: 'FILL' }],
    };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.alignItems).toBe('stretch');
  });

  it('does NOT detect stretch when children have mixed sizing', () => {
    const raw = {
      layoutMode: 'HORIZONTAL',
      counterAxisAlignItems: 'MIN',
      children: [{ layoutSizingVertical: 'FILL' }, { layoutSizingVertical: 'FIXED' }],
    };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.alignItems).toBeUndefined(); // MIN → omit
  });

  it('excludes absolute children from stretch detection', () => {
    const raw = {
      layoutMode: 'HORIZONTAL',
      counterAxisAlignItems: 'MIN',
      children: [{ layoutSizingVertical: 'FILL' }, { layoutSizingVertical: 'FIXED', layoutPositioning: 'ABSOLUTE' }],
    };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.alignItems).toBe('stretch');
  });

  it('maps sizing FIXED/FILL/HUG', () => {
    const raw = { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.sizing?.horizontal).toBe('fill');
    expect(result.layout?.sizing?.vertical).toBe('hug');
  });

  it('includes dimensions only when sizing is fixed', () => {
    const raw = { width: 320, height: 480, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.dimensions?.width).toBe(320);
    expect(result.layout?.dimensions?.height).toBe(480);
  });

  it('omits dimensions when sizing is fill', () => {
    const raw = { width: 320, height: 480, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FILL' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.dimensions).toBeUndefined();
  });

  it('generates CSS shorthand for equal padding', () => {
    const raw = { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.padding).toBe('16px');
  });

  it('generates CSS shorthand for symmetric padding', () => {
    const raw = { paddingTop: 10, paddingRight: 20, paddingBottom: 10, paddingLeft: 20 };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.padding).toBe('10px 20px');
  });

  it('generates full CSS shorthand for different padding', () => {
    const raw = { paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 40 };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.padding).toBe('10px 20px 30px 40px');
  });

  it('maps overflow directions', () => {
    const raw = { overflowDirection: 'HORIZONTAL_AND_VERTICAL_SCROLLING' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.overflow).toEqual(['x', 'y']);
  });

  it('sets position absolute', () => {
    const raw = { layoutPositioning: 'ABSOLUTE' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.position).toBe('absolute');
  });

  it('sets wrap true', () => {
    const raw = { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' };
    const result = makeResult();
    layoutExtractor(raw, result, makeContext());
    expect(result.layout?.wrap).toBe(true);
  });
});

// ── Text ─────────────────────────────────────────

describe('textExtractor', () => {
  it('extracts full text without truncation', () => {
    const raw = { type: 'TEXT', characters: 'A'.repeat(500), fontSize: 16 };
    const result = makeResult();
    textExtractor(raw, result, makeContext());
    expect(result.text).toBe('A'.repeat(500));
  });

  it('creates text style with font properties', () => {
    const ctx = makeContext();
    const raw = { type: 'TEXT', characters: 'Hello', fontSize: 16, style: { fontFamily: 'Inter', fontWeight: 700 } };
    const result = makeResult();
    textExtractor(raw, result, ctx);
    expect(result.textStyle).toBeDefined();
  });

  it('calculates lineHeight in em', () => {
    const ctx = makeContext();
    const raw = { type: 'TEXT', characters: 'Hi', fontSize: 16, style: { fontFamily: 'Inter', lineHeightPx: 24 } };
    const result = makeResult();
    textExtractor(raw, result, ctx);
    const styleRef = result.textStyle as string;
    const style = (ctx.globalVars.styles[styleRef] as Record<string, unknown>) ?? result.textStyle;
    if (typeof style === 'object') {
      expect(style.lineHeight).toBe('1.5em');
    }
  });

  it('calculates letterSpacing in %', () => {
    const ctx = makeContext();
    const raw = { type: 'TEXT', characters: 'Hi', fontSize: 16, style: { fontFamily: 'Inter', letterSpacing: 0.8 } };
    const result = makeResult();
    textExtractor(raw, result, ctx);
    const styleRef = result.textStyle as string;
    const style = (ctx.globalVars.styles[styleRef] as Record<string, unknown>) ?? result.textStyle;
    if (typeof style === 'object') {
      expect(style.letterSpacing).toBe('5%');
    }
  });

  it('deduplicates identical text styles', () => {
    const ctx = makeContext();
    const raw1 = { type: 'TEXT', characters: 'A', fontSize: 16, style: { fontFamily: 'Inter', fontWeight: 400 } };
    const raw2 = { type: 'TEXT', characters: 'B', fontSize: 16, style: { fontFamily: 'Inter', fontWeight: 400 } };
    const r1 = makeResult();
    const r2 = makeResult();
    textExtractor(raw1, r1, ctx);
    textExtractor(raw2, r2, ctx);
    expect(r1.textStyle).toBe(r2.textStyle); // same ref
  });

  it('skips non-TEXT nodes', () => {
    const raw = { type: 'FRAME', characters: 'should be ignored' };
    const result = makeResult();
    textExtractor(raw, result, makeContext());
    expect(result.text).toBeUndefined();
  });
});

// ── Visuals ──────────────────────────────────────

describe('visualsExtractor', () => {
  it('converts solid fill to hex', () => {
    const ctx = makeContext();
    const raw = { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }] };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    expect(result.fills).toBeDefined();
    // Resolve the fill value
    const fillValue = typeof result.fills === 'string' ? ctx.globalVars.styles[result.fills] : result.fills;
    expect(fillValue).toBe('#FF0000');
  });

  it('converts solid fill with opacity to rgba', () => {
    const ctx = makeContext();
    const raw = { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.5 }, visible: true }] };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fillValue = typeof result.fills === 'string' ? ctx.globalVars.styles[result.fills] : result.fills;
    expect(fillValue).toContain('rgba(');
  });

  it('converts image fill', () => {
    const ctx = makeContext();
    const raw = { fills: [{ type: 'IMAGE', imageRef: 'img123', scaleMode: 'FILL', visible: true }] };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fillValue = typeof result.fills === 'string' ? ctx.globalVars.styles[result.fills] : result.fills;
    expect(fillValue).toEqual({ type: 'IMAGE', imageRef: 'img123', scaleMode: 'FILL' });
  });

  it('converts drop shadow to boxShadow', () => {
    const ctx = makeContext();
    const raw = {
      type: 'FRAME',
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          offset: { x: 2, y: 4 },
          radius: 8,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.25 },
        },
      ],
    };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    expect(result.effects).toBeDefined();
    const fxValue =
      typeof result.effects === 'string' ? (ctx.globalVars.styles[result.effects] as any) : result.effects;
    expect(fxValue.boxShadow).toContain('2px 4px 8px');
  });

  it('converts inner shadow with inset prefix', () => {
    const ctx = makeContext();
    const raw = {
      type: 'FRAME',
      effects: [
        {
          type: 'INNER_SHADOW',
          visible: true,
          offset: { x: 0, y: 2 },
          radius: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.1 },
        },
      ],
    };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fxValue =
      typeof result.effects === 'string' ? (ctx.globalVars.styles[result.effects] as any) : result.effects;
    expect(fxValue.boxShadow).toContain('inset');
  });

  it('converts layer blur to filter', () => {
    const ctx = makeContext();
    const raw = { type: 'FRAME', effects: [{ type: 'LAYER_BLUR', visible: true, radius: 4 }] };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fxValue =
      typeof result.effects === 'string' ? (ctx.globalVars.styles[result.effects] as any) : result.effects;
    expect(fxValue.filter).toBe('blur(4px)');
  });

  it('converts background blur to backdropFilter', () => {
    const ctx = makeContext();
    const raw = { type: 'FRAME', effects: [{ type: 'BACKGROUND_BLUR', visible: true, radius: 10 }] };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fxValue =
      typeof result.effects === 'string' ? (ctx.globalVars.styles[result.effects] as any) : result.effects;
    expect(fxValue.backdropFilter).toBe('blur(10px)');
  });

  it('includes opacity only when !== 1', () => {
    const result1 = makeResult();
    visualsExtractor({ opacity: 1 }, result1, makeContext());
    expect(result1.opacity).toBeUndefined();

    const result2 = makeResult();
    visualsExtractor({ opacity: 0.5 }, result2, makeContext());
    expect(result2.opacity).toBe(0.5);
  });

  it('converts single corner radius', () => {
    const result = makeResult();
    visualsExtractor({ cornerRadius: 8 }, result, makeContext());
    expect(result.borderRadius).toBe('8px');
  });

  it('converts four-corner border radius', () => {
    const result = makeResult();
    visualsExtractor({ rectangleCornerRadii: [8, 4, 8, 4] }, result, makeContext());
    expect(result.borderRadius).toBe('8px 4px 8px 4px');
  });

  it('uses text shadow for TEXT nodes', () => {
    const ctx = makeContext();
    const raw = {
      type: 'TEXT',
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
        },
      ],
    };
    const result = makeResult();
    visualsExtractor(raw, result, ctx);
    const fxValue =
      typeof result.effects === 'string' ? (ctx.globalVars.styles[result.effects] as any) : result.effects;
    expect(fxValue.textShadow).toBeDefined();
    expect(fxValue.boxShadow).toBeUndefined();
  });
});

// ── Component ────────────────────────────────────

describe('componentExtractor', () => {
  it('extracts componentId from INSTANCE', () => {
    const raw = { type: 'INSTANCE', componentId: 'abc123' };
    const result = makeResult();
    componentExtractor(raw, result, makeContext());
    expect(result.componentId).toBe('abc123');
  });

  it('extracts componentRef from COMPONENT', () => {
    const raw = { type: 'COMPONENT', key: 'comp-key' };
    const result = makeResult();
    componentExtractor(raw, result, makeContext());
    expect(result.componentRef).toBe('comp-key');
  });

  it('extracts componentProperties from INSTANCE', () => {
    const raw = {
      type: 'INSTANCE',
      componentId: 'abc',
      componentProperties: {
        Size: { value: 'large', type: 'VARIANT' },
        Disabled: { value: 'true', type: 'BOOLEAN' },
      },
    };
    const result = makeResult();
    componentExtractor(raw, result, makeContext());
    expect(result.componentProperties).toHaveLength(2);
    expect(result.componentProperties![0].name).toBe('Size');
    expect(result.componentProperties![0].value).toBe('large');
  });

  it('does nothing for non-component nodes', () => {
    const raw = { type: 'FRAME' };
    const result = makeResult();
    componentExtractor(raw, result, makeContext());
    expect(result.componentId).toBeUndefined();
    expect(result.componentRef).toBeUndefined();
  });
});
