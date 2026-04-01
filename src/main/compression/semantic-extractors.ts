/**
 * Five composable extractors for semantic node construction.
 *
 * Each extractor is a pure function (raw, result, context) => void that reads
 * raw Figma plugin fields and writes to a SemanticNode. They are composed per-mode
 * by the extraction pipeline in project-tree.ts.
 */

import { rgbaToHex } from './color-utils.js';
import type { ExtractionContext, ExtractorFn, SemanticNode } from './semantic-modes.js';
import { findOrCreateNamedVar, findOrCreateVar } from './style-dedup.js';

// ── 1. Identity ────────────────────────────────

export const identityExtractor: ExtractorFn = (raw: any, result: SemanticNode) => {
  result.id = raw.id ?? '?';
  result.name = raw.name ?? '?';
  result.type = raw.type === 'VECTOR' ? 'IMAGE-SVG' : (raw.type ?? 'UNKNOWN');
};

// ── 2. Layout ──────────────────────────────────

function mapLayoutMode(raw: any): 'row' | 'column' | 'none' | undefined {
  const mode = raw.layoutMode;
  if (mode === 'HORIZONTAL') return 'row';
  if (mode === 'VERTICAL') return 'column';
  return undefined;
}

function mapJustifyContent(raw: any): string | undefined {
  const val = raw.primaryAxisAlignItems;
  if (!val || val === 'MIN') return undefined;
  if (val === 'MAX') return 'flex-end';
  if (val === 'CENTER') return 'center';
  if (val === 'SPACE_BETWEEN') return 'space-between';
  return undefined;
}

function detectStretch(raw: any, layoutMode?: 'row' | 'column' | 'none'): boolean {
  if (!layoutMode || layoutMode === 'none') return false;
  const children = raw.children;
  if (!Array.isArray(children) || children.length === 0) return false;

  // Cross-axis is opposite of layout direction
  const crossProp = layoutMode === 'row' ? 'layoutSizingVertical' : 'layoutSizingHorizontal';

  const nonAbsolute = children.filter((c: any) => c.layoutPositioning !== 'ABSOLUTE');
  if (nonAbsolute.length === 0) return false;

  return nonAbsolute.every((c: any) => c[crossProp] === 'FILL');
}

function mapAlignItems(raw: any, layoutMode?: 'row' | 'column' | 'none'): string | undefined {
  // Stretch detection takes priority
  if (detectStretch(raw, layoutMode)) return 'stretch';

  const val = raw.counterAxisAlignItems;
  if (!val || val === 'MIN') return undefined;
  if (val === 'MAX') return 'flex-end';
  if (val === 'CENTER') return 'center';
  if (val === 'BASELINE') return 'baseline';
  return undefined;
}

function generateCSSShorthand(t: number, r: number, b: number, l: number): string | undefined {
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  if (t === r && r === b && b === l) return `${t}px`;
  if (t === b && r === l) return `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

function mapSizing(
  raw: any,
): { horizontal?: 'fixed' | 'fill' | 'hug'; vertical?: 'fixed' | 'fill' | 'hug' } | undefined {
  const h = raw.layoutSizingHorizontal?.toLowerCase() as 'fixed' | 'fill' | 'hug' | undefined;
  const v = raw.layoutSizingVertical?.toLowerCase() as 'fixed' | 'fill' | 'hug' | undefined;
  if (!h && !v) return undefined;
  return { ...(h ? { horizontal: h } : {}), ...(v ? { vertical: v } : {}) };
}

function mapOverflow(raw: any): ('x' | 'y')[] | undefined {
  const dir = raw.overflowDirection;
  if (!dir) return undefined;
  const result: ('x' | 'y')[] = [];
  if (dir === 'HORIZONTAL_SCROLLING' || dir === 'HORIZONTAL_AND_VERTICAL_SCROLLING') result.push('x');
  if (dir === 'VERTICAL_SCROLLING' || dir === 'HORIZONTAL_AND_VERTICAL_SCROLLING') result.push('y');
  return result.length > 0 ? result : undefined;
}

export const layoutExtractor: ExtractorFn = (raw: any, result: SemanticNode) => {
  const mode = mapLayoutMode(raw);
  const justifyContent = mapJustifyContent(raw);
  const alignItems = mapAlignItems(raw, mode);
  const wrap = raw.layoutWrap === 'WRAP' ? true : undefined;
  const gap = typeof raw.itemSpacing === 'number' && raw.itemSpacing > 0 ? `${raw.itemSpacing}px` : undefined;
  const padding = generateCSSShorthand(
    raw.paddingTop ?? 0,
    raw.paddingRight ?? 0,
    raw.paddingBottom ?? 0,
    raw.paddingLeft ?? 0,
  );
  const sizing = mapSizing(raw);
  const overflow = mapOverflow(raw);
  const position = raw.layoutPositioning === 'ABSOLUTE' ? ('absolute' as const) : undefined;

  // Dimensions only when sizing is fixed (key Framelink insight)
  let dimensions: { width?: number; height?: number } | undefined;
  if (typeof raw.width === 'number' && typeof raw.height === 'number') {
    const hSizing = sizing?.horizontal;
    const vSizing = sizing?.vertical;
    // Include dimensions if no sizing info (legacy nodes) or if sizing is fixed
    const showWidth = !hSizing || hSizing === 'fixed';
    const showHeight = !vSizing || vSizing === 'fixed';
    if (showWidth || showHeight) {
      dimensions = {};
      if (showWidth) dimensions.width = Math.round(raw.width);
      if (showHeight) dimensions.height = Math.round(raw.height);
    }
  }

  // Only set layout if there's something to report
  if (mode || justifyContent || alignItems || wrap || gap || padding || sizing || dimensions || overflow || position) {
    const layout: NonNullable<typeof result.layout> = {};
    if (mode) layout.mode = mode;
    if (justifyContent) layout.justifyContent = justifyContent;
    if (alignItems) layout.alignItems = alignItems;
    if (wrap) layout.wrap = wrap;
    if (gap) layout.gap = gap;
    if (padding) layout.padding = padding;
    if (sizing) layout.sizing = sizing;
    if (dimensions) layout.dimensions = dimensions;
    if (position) layout.position = position;
    if (overflow) layout.overflow = overflow;
    result.layout = layout;
  }
};

// ── 3. Text ────────────────────────────────────

function buildTextStyleValue(raw: any): Record<string, unknown> | undefined {
  const style = raw.style ?? raw;
  const fontFamily = style.fontFamily ?? raw.fontFamily;
  const fontStyle = style.fontStyle ?? raw.fontStyle;
  const fontSize = style.fontSize ?? raw.fontSize;

  if (!fontFamily && !fontStyle && !fontSize) return undefined;

  const result: Record<string, unknown> = {};
  if (fontFamily) result.fontFamily = fontFamily;
  if (fontStyle) result.fontStyle = fontStyle;
  if (fontSize) result.fontSize = fontSize;

  // Relative units for line height and letter spacing
  const lhPx = style.lineHeightPx ?? raw.lineHeightPx;
  if (typeof lhPx === 'number' && typeof fontSize === 'number' && fontSize > 0) {
    result.lineHeight = `${parseFloat((lhPx / fontSize).toFixed(2))}em`;
  }

  const ls = style.letterSpacing ?? raw.letterSpacing;
  if (typeof ls === 'number' && ls !== 0 && typeof fontSize === 'number' && fontSize > 0) {
    result.letterSpacing = `${Math.round((ls / fontSize) * 100)}%`;
  }

  const textCase = style.textCase ?? raw.textCase;
  if (textCase && textCase !== 'ORIGINAL') result.textCase = textCase;

  const textAlign = style.textAlignHorizontal ?? raw.textAlignHorizontal;
  if (textAlign && textAlign !== 'LEFT') result.textAlign = textAlign;

  return result;
}

export const textExtractor: ExtractorFn = (raw: any, result: SemanticNode, context: ExtractionContext) => {
  if (raw.type !== 'TEXT') return;

  const chars = raw.characters;
  if (typeof chars === 'string' && chars.length > 0) {
    result.text = chars; // Full text — no truncation
  }

  const styleValue = buildTextStyleValue(raw);
  if (styleValue) {
    const namedTextStyle = raw.styles?.text ? `style:${raw.styles.text}` : undefined;
    result.textStyle = namedTextStyle
      ? findOrCreateNamedVar(context, styleValue, namedTextStyle)
      : findOrCreateVar(context, styleValue, 'ts');
  }
};

// ── 4. Visuals ─────────────────────────────────

function convertColor(color: any, opacity?: number): string {
  const a = color.a ?? 1;
  const effectiveOpacity = typeof opacity === 'number' ? a * opacity : a;
  if (effectiveOpacity < 1) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `rgba(${r}, ${g}, ${b}, ${parseFloat(effectiveOpacity.toFixed(2))})`;
  }
  return rgbaToHex(color);
}

function gradientAngle(handles: any[]): number {
  if (!handles || handles.length < 2) return 0;
  const dx = handles[1].x - handles[0].x;
  const dy = handles[1].y - handles[0].y;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
}

function convertGradientStops(stops: any[]): string {
  if (!Array.isArray(stops)) return '';
  return stops
    .map((s: any) => {
      const color = convertColor(s.color);
      const pos = Math.round(s.position * 100);
      return `${color} ${pos}%`;
    })
    .join(', ');
}

function convertFill(fill: any): unknown {
  if (fill.type === 'SOLID' && fill.color) {
    return convertColor(fill.color, fill.opacity);
  }

  if (fill.type === 'GRADIENT_LINEAR') {
    const angle = gradientAngle(fill.gradientHandlePositions);
    const stops = convertGradientStops(fill.gradientStops);
    return `linear-gradient(${angle}deg, ${stops})`;
  }

  if (fill.type === 'GRADIENT_RADIAL') {
    const handles = fill.gradientHandlePositions;
    const cx = handles?.[0] ? Math.round(handles[0].x * 100) : 50;
    const cy = handles?.[0] ? Math.round(handles[0].y * 100) : 50;
    const stops = convertGradientStops(fill.gradientStops);
    return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
  }

  if (fill.type === 'GRADIENT_ANGULAR') {
    const handles = fill.gradientHandlePositions;
    const angle = handles ? gradientAngle(handles) : 0;
    const cx = handles?.[0] ? Math.round(handles[0].x * 100) : 50;
    const cy = handles?.[0] ? Math.round(handles[0].y * 100) : 50;
    const stops = convertGradientStops(fill.gradientStops);
    return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${stops})`;
  }

  if (fill.type === 'IMAGE') {
    return { type: 'IMAGE', imageRef: fill.imageRef, scaleMode: fill.scaleMode };
  }

  return null;
}

function convertFills(fills: any[], context: ExtractionContext, namedStyleKey?: string): unknown {
  if (!Array.isArray(fills) || fills.length === 0) return undefined;
  const visible = fills.filter((f: any) => f.visible !== false);
  if (visible.length === 0) return undefined;

  const converted = visible.length === 1 ? convertFill(visible[0]) : visible.map(convertFill).filter(Boolean);
  if (!converted || (Array.isArray(converted) && converted.length === 0)) return undefined;

  if (namedStyleKey) {
    return findOrCreateNamedVar(context, converted, namedStyleKey);
  }
  return findOrCreateVar(context, converted, 'fill');
}

function convertEffects(effects: any[], isText: boolean): Record<string, string> | undefined {
  if (!Array.isArray(effects) || effects.length === 0) return undefined;
  const visible = effects.filter((e: any) => e.visible !== false);
  if (visible.length === 0) return undefined;

  const result: Record<string, string> = {};

  const shadows = visible.filter((e: any) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
  if (shadows.length > 0) {
    const shadowStr = shadows
      .map((s: any) => {
        const inset = s.type === 'INNER_SHADOW' ? 'inset ' : '';
        const x = s.offset?.x ?? 0;
        const y = s.offset?.y ?? 0;
        const blur = s.radius ?? 0;
        const spread = s.spread ?? 0;
        const color = s.color ? convertColor(s.color) : 'rgba(0, 0, 0, 0.25)';
        return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`;
      })
      .join(', ');

    if (isText) {
      // Text shadows don't support inset or spread in CSS
      result.textShadow = shadowStr;
    } else {
      result.boxShadow = shadowStr;
    }
  }

  const layerBlur = visible.find((e: any) => e.type === 'LAYER_BLUR');
  if (layerBlur) {
    result.filter = `blur(${layerBlur.radius ?? 0}px)`;
  }

  const bgBlur = visible.find((e: any) => e.type === 'BACKGROUND_BLUR');
  if (bgBlur) {
    result.backdropFilter = `blur(${bgBlur.radius ?? 0}px)`;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function convertStrokes(strokes: any[], raw: any, context: ExtractionContext): unknown {
  if (!Array.isArray(strokes) || strokes.length === 0) return undefined;
  const visible = strokes.filter((s: any) => s.visible !== false);
  if (visible.length === 0) return undefined;

  const converted = visible
    .map((s: any) => {
      if (s.type === 'SOLID' && s.color) {
        const color = convertColor(s.color, s.opacity);
        const weight = raw.strokeWeight ?? 1;
        return `${color} ${weight}px`;
      }
      return convertFill(s);
    })
    .filter(Boolean);

  if (converted.length === 0) return undefined;
  const value = converted.length === 1 ? converted[0] : converted;
  return findOrCreateVar(context, value, 'stroke');
}

function convertBorderRadius(raw: any): string | undefined {
  const cr = raw.cornerRadius;
  const corners = raw.rectangleCornerRadii;

  if (Array.isArray(corners) && corners.length === 4) {
    const [tl, tr, br, bl] = corners;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;
    if (tl === tr && tr === br && br === bl) return `${tl}px`;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }

  if (typeof cr === 'number' && cr > 0) return `${cr}px`;
  return undefined;
}

function resolveNamedStyle(raw: any, category: string): string | undefined {
  // Figma nodes have a `.styles` map: { fill: 'S:styleId', stroke: '...' }
  // When present, we use the style name (if available) as the globalVars key.
  // In plugin data, named styles aren't always resolved to their names,
  // so we return the style ID as a hint — the key will be `style:<id>`.
  const styleId = raw.styles?.[category];
  if (typeof styleId === 'string') return `style:${styleId}`;
  return undefined;
}

export const visualsExtractor: ExtractorFn = (raw: any, result: SemanticNode, context: ExtractionContext) => {
  const isText = raw.type === 'TEXT';

  // Fills
  const namedFillKey = resolveNamedStyle(raw, 'fill');
  const fills = convertFills(raw.fills, context, namedFillKey);
  if (fills !== undefined) result.fills = fills;

  // Strokes
  const strokes = convertStrokes(raw.strokes, raw, context);
  if (strokes !== undefined) result.strokes = strokes;

  // Effects
  const effectsValue = convertEffects(raw.effects, isText);
  if (effectsValue) {
    result.effects = findOrCreateVar(context, effectsValue, 'fx');
  }

  // Opacity
  if (typeof raw.opacity === 'number' && raw.opacity !== 1) {
    result.opacity = raw.opacity;
  }

  // Border radius
  const br = convertBorderRadius(raw);
  if (br) result.borderRadius = br;
};

// ── 5. Component ───────────────────────────────

export const componentExtractor: ExtractorFn = (raw: any, result: SemanticNode) => {
  if (raw.type === 'INSTANCE') {
    const key = raw.componentId ?? raw.mainComponent?.key;
    if (key !== undefined) result.componentId = key;

    if (raw.componentProperties) {
      const props = Object.entries(raw.componentProperties).map(([name, prop]: [string, any]) => ({
        name,
        value: String(prop.value ?? ''),
        type: String(prop.type ?? 'VARIANT'),
      }));
      if (props.length > 0) result.componentProperties = props;
    }
  }

  if (raw.type === 'COMPONENT' && raw.key !== undefined) {
    result.componentRef = raw.key;
  }
};
