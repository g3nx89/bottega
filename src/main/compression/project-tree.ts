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

const GRADIENT_TYPES = new Set(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']);
const IMAGE_FILL: Readonly<FillResult> = { fill: 'img', hasComplexFill: true };
const GRADIENT_FILL: Readonly<FillResult> = { fill: 'grad', hasComplexFill: true };

function resolveFill(fills: any[]): FillResult | null {
  if (!Array.isArray(fills) || fills.length === 0) return null;

  const visible = fills.find((f: any) => f.visible !== false);
  if (!visible) return null;

  const type: string = visible.type ?? '';

  if (type === 'SOLID') {
    return visible.color ? { fill: rgbaToHex(visible.color) } : null;
  }

  if (type === 'IMAGE') return IMAGE_FILL;
  if (GRADIENT_TYPES.has(type)) return GRADIENT_FILL;

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

// ── Type-specific projection helpers ────────────

function projectTextProps(node: any, projected: ProjectedNode, detail: ProjectionDetail): void {
  const chars: string | undefined = node.characters;
  if (chars && chars.length > 0) {
    projected.text = chars.slice(0, 100);
  }
  if (detail === 'detailed' && typeof node.fontSize === 'number') {
    projected.fontSize = node.fontSize;
  }
}

function projectInstanceProps(node: any, projected: ProjectedNode, _detail: ProjectionDetail): void {
  const key = node.componentId ?? node.mainComponent?.key;
  if (key !== undefined) projected.componentKey = key;
}

function projectComponentRefProps(node: any, projected: ProjectedNode, _detail: ProjectionDetail): void {
  if (node.key !== undefined) projected.componentRef = node.key;
}

/** Map node types → type-specific projection helpers. */
const TYPE_PROJECTORS: Record<string, (node: any, projected: ProjectedNode, detail: ProjectionDetail) => void> = {
  TEXT: projectTextProps,
  INSTANCE: projectInstanceProps,
  COMPONENT: projectComponentRefProps,
};

// ── Core projection ──────────────────────────────

function projectLayoutProps(rawNode: any, projected: ProjectedNode): void {
  if (typeof rawNode.width === 'number' && typeof rawNode.height === 'number') {
    projected.box = `${Math.round(rawNode.width)}x${Math.round(rawNode.height)}`;
  }
  const layout = resolveLayout(rawNode);
  if (layout !== undefined) {
    projected.layout = layout;
    if (typeof rawNode.itemSpacing === 'number' && rawNode.itemSpacing > 0) {
      projected.gap = rawNode.itemSpacing;
    }
  }
  const padding = resolvePadding(rawNode);
  if (padding !== undefined) projected.padding = padding;
}

function projectStyleProps(rawNode: any, projected: ProjectedNode): void {
  const fillResult = resolveFill(rawNode.fills);
  if (fillResult !== null) {
    projected.fill = fillResult.fill;
    if (fillResult.hasComplexFill) projected.hasComplexFill = true;
  }
  const stroke = resolveStroke(rawNode);
  if (stroke !== undefined) projected.stroke = stroke;
}

function projectFlags(rawNode: any, projected: ProjectedNode, detail: ProjectionDetail): void {
  if (detail === 'detailed' && typeof rawNode.opacity === 'number' && rawNode.opacity !== 1) {
    projected.opacity = rawNode.opacity;
  }
  if (rawNode.visible === false) projected.hidden = true;
  if (Array.isArray(rawNode.effects) && rawNode.effects.length > 0) projected.hasEffects = true;
}

/** Assign identity fields with safe defaults (reduces branch count in projectTree). */
function assignIdentity(rawNode: any, projected: ProjectedNode): void {
  projected.id = rawNode.id ?? '?';
  projected.type = rawNode.type ?? 'UNKNOWN';
  projected.name = rawNode.name ?? '?';
}

function projectChildren(rawNode: any, projected: ProjectedNode, detail: ProjectionDetail): void {
  const children = rawNode.children;
  if (Array.isArray(children) && children.length > 0) {
    projected.children = children.map((c: any) => projectTree(c, detail));
  }
}

export function projectTree(rawNode: any, detail: ProjectionDetail = 'standard'): ProjectedNode {
  if (!rawNode || typeof rawNode !== 'object') {
    return { id: '?', type: 'UNKNOWN', name: '?' };
  }

  const projected = {} as ProjectedNode;
  assignIdentity(rawNode, projected);

  projectLayoutProps(rawNode, projected);
  projectStyleProps(rawNode, projected);
  TYPE_PROJECTORS[rawNode.type]?.(rawNode, projected, detail);
  projectFlags(rawNode, projected, detail);
  projectChildren(rawNode, projected, detail);

  return projected;
}

export function projectTreeArray(rawNodes: any[], detail: ProjectionDetail = 'standard'): ProjectedNode[] {
  return rawNodes.map((node) => projectTree(node, detail));
}
