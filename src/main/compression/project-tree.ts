/**
 * Tree projection module — transforms raw Figma document trees into compact
 * projected representations, achieving 80-90% token reduction.
 *
 * Strips all default-value fields (visible:true, opacity:1, blendMode:NORMAL),
 * bounding box raw data, plugin data, prototype/reaction data, and geometry paths.
 * Compacts fills/strokes to hex strings and flags complex fills.
 */

// ── Types ────────────────────────────────────────

export interface ProjectedNode {
  id: string;
  type: string;
  name: string;
  box?: string;
  layout?: string;
  gap?: number;
  padding?: string;
  fill?: string;
  stroke?: string;
  text?: string;
  fontSize?: number;
  opacity?: number;
  componentKey?: string;
  componentRef?: string;
  hidden?: true;
  hasEffects?: true;
  hasComplexFill?: true;
  children?: ProjectedNode[];
}

export type ProjectionDetail = 'standard' | 'detailed';

import { rgbaToHex } from './color-utils.js';

// ── Fill helper ──────────────────────────────────

interface FillResult {
  fill: string;
  hasComplexFill?: true;
}

function resolveFill(fills: any[]): FillResult | null {
  if (!Array.isArray(fills) || fills.length === 0) return null;

  const visible = fills.find((f: any) => f.visible !== false);
  if (!visible) return null;

  const type: string = visible.type ?? '';

  if (type === 'SOLID') {
    if (!visible.color) return null;
    return { fill: rgbaToHex(visible.color) };
  }

  if (type === 'IMAGE') {
    return { fill: 'img', hasComplexFill: true };
  }

  if (
    type === 'GRADIENT_LINEAR' ||
    type === 'GRADIENT_RADIAL' ||
    type === 'GRADIENT_ANGULAR' ||
    type === 'GRADIENT_DIAMOND'
  ) {
    return { fill: 'grad', hasComplexFill: true };
  }

  return null;
}

// ── Padding helper ───────────────────────────────

function resolvePadding(node: any): string | undefined {
  const t = node.paddingTop ?? 0;
  const r = node.paddingRight ?? 0;
  const b = node.paddingBottom ?? 0;
  const l = node.paddingLeft ?? 0;

  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  return `${t},${r},${b},${l}`;
}

// ── Layout helper ────────────────────────────────

function resolveLayout(node: any): string | undefined {
  const mode: string | undefined = node.layoutMode;
  if (!mode) return undefined;

  if (mode === 'HORIZONTAL') {
    if (node.layoutWrap === 'WRAP') return 'WRAP';
    return 'H';
  }

  if (mode === 'VERTICAL') return 'V';

  return undefined;
}

// ── Stroke helper ────────────────────────────────

function resolveStroke(node: any): string | undefined {
  const strokes = node.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) return undefined;

  const visible = strokes.find((s: any) => s.visible !== false);
  if (!visible || visible.type !== 'SOLID' || !visible.color) return undefined;

  const hex = rgbaToHex(visible.color);
  const weight = node.strokeWeight ?? 1;
  return `${hex}/${weight}`;
}

// ── Core projection ──────────────────────────────

export function projectTree(rawNode: any, detail: ProjectionDetail = 'standard'): ProjectedNode {
  if (!rawNode || typeof rawNode !== 'object') {
    return { id: '?', type: 'UNKNOWN', name: '?' };
  }

  const projected: ProjectedNode = {
    id: rawNode.id ?? '?',
    type: rawNode.type ?? 'UNKNOWN',
    name: rawNode.name ?? '?',
  };

  // box
  if (typeof rawNode.width === 'number' && typeof rawNode.height === 'number') {
    projected.box = `${Math.round(rawNode.width)}x${Math.round(rawNode.height)}`;
  }

  // layout
  const layout = resolveLayout(rawNode);
  if (layout !== undefined) {
    projected.layout = layout;

    // gap — only when auto-layout is active
    if (typeof rawNode.itemSpacing === 'number' && rawNode.itemSpacing > 0) {
      projected.gap = rawNode.itemSpacing;
    }
  }

  // padding
  const padding = resolvePadding(rawNode);
  if (padding !== undefined) {
    projected.padding = padding;
  }

  // fill
  const fillResult = resolveFill(rawNode.fills);
  if (fillResult !== null) {
    projected.fill = fillResult.fill;
    if (fillResult.hasComplexFill) {
      projected.hasComplexFill = true;
    }
  }

  // stroke
  const stroke = resolveStroke(rawNode);
  if (stroke !== undefined) {
    projected.stroke = stroke;
  }

  // text (TEXT nodes only)
  if (rawNode.type === 'TEXT') {
    const chars: string | undefined = rawNode.characters;
    if (chars && chars.length > 0) {
      projected.text = chars.slice(0, 100);
    }

    // fontSize — detailed mode only
    if (detail === 'detailed' && typeof rawNode.fontSize === 'number') {
      projected.fontSize = rawNode.fontSize;
    }
  }

  // opacity — detailed mode only, only if !== 1
  if (detail === 'detailed' && typeof rawNode.opacity === 'number' && rawNode.opacity !== 1) {
    projected.opacity = rawNode.opacity;
  }

  // componentKey (INSTANCE nodes)
  if (rawNode.type === 'INSTANCE') {
    const key = rawNode.componentId ?? rawNode.mainComponent?.key;
    if (key !== undefined) {
      projected.componentKey = key;
    }
  }

  // componentRef (COMPONENT nodes)
  if (rawNode.type === 'COMPONENT' && rawNode.key !== undefined) {
    projected.componentRef = rawNode.key;
  }

  // hidden
  if (rawNode.visible === false) {
    projected.hidden = true;
  }

  // hasEffects
  if (Array.isArray(rawNode.effects) && rawNode.effects.length > 0) {
    projected.hasEffects = true;
  }

  // children — recurse
  if (Array.isArray(rawNode.children) && rawNode.children.length > 0) {
    projected.children = rawNode.children.map((child: any) => projectTree(child, detail));
  }

  return projected;
}

export function projectTreeArray(rawNodes: any[], detail: ProjectionDetail = 'standard'): ProjectedNode[] {
  return rawNodes.map((node) => projectTree(node, detail));
}
