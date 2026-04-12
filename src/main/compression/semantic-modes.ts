/**
 * Semantic extraction types and mode registry.
 *
 * Defines the constructive extraction model: instead of stripping fields from raw
 * Figma JSON (subtractive), each mode selects which extractors run, building only
 * the fields each consumer needs. Modes map to walk depth (fast/rich) on the plugin
 * side and extractor sets on the main-process side.
 */

// ── Semantic node ──────────────────────────────

export interface SemanticNode {
  id: string;
  name: string;
  type: string; // 'IMAGE-SVG' for collapsed vector subtrees
  // Layout (CSS semantics)
  layout?: {
    mode?: 'row' | 'column' | 'none';
    justifyContent?: string;
    alignItems?: string;
    wrap?: boolean;
    gap?: string;
    padding?: string;
    sizing?: { horizontal?: 'fixed' | 'fill' | 'hug'; vertical?: 'fixed' | 'fill' | 'hug' };
    dimensions?: { width?: number; height?: number };
    position?: 'absolute';
    overflow?: ('x' | 'y')[];
    absolutePos?: { x: number; y: number };
  };
  // Text
  text?: string;
  textStyle?: string | Record<string, unknown>;
  // Visuals
  fills?: string | unknown;
  strokes?: string | unknown;
  effects?: string | unknown;
  opacity?: number;
  borderRadius?: string;
  // Component
  componentId?: string;
  componentRef?: string;
  componentProperties?: { name: string; value: string; type: string }[];
  // Children
  children?: SemanticNode[];
}

// ── Extraction context ─────────────────────────

export interface GlobalVars {
  styles: Record<string, unknown>;
}

export interface ExtractionContext {
  globalVars: GlobalVars;
  currentDepth: number;
  parent?: any; // raw parent node for relative positioning / stretch detection
  styleCache: Map<string, string>; // JSON(value) → varId for dedup
  nodesProcessed: number; // per-call yield counter (avoids module-level mutable state)
}

export type ExtractorName = 'identity' | 'layout' | 'text' | 'visuals' | 'component';

export type ExtractorFn = (raw: any, result: SemanticNode, context: ExtractionContext) => void;

// ── Extraction result ──────────────────────────

export interface SemanticResult {
  nodes: SemanticNode[];
  globalVars?: GlobalVars; // omitted when empty
}

// ── Modes ──────────────────────────────────────

export type SemanticMode = 'structure' | 'content' | 'styling' | 'component' | 'full' | 'briefing';

/** Mode → extractor set mapping. Each extractor name maps to a function in the registry. */
export const MODE_EXTRACTORS: Record<SemanticMode, ExtractorName[]> = {
  structure: ['identity', 'layout'],
  content: ['identity', 'text'],
  styling: ['identity', 'visuals'],
  component: ['identity', 'layout', 'component'],
  full: ['identity', 'layout', 'text', 'visuals', 'component'],
  briefing: ['identity'],
};

/** Mode → plugin walk depth. 'fast' collects core fields, 'rich' adds visual/layout detail. */
export const MODE_WALK: Record<SemanticMode, 'fast' | 'rich'> = {
  structure: 'rich',
  content: 'fast',
  styling: 'rich',
  component: 'rich',
  full: 'rich',
  briefing: 'fast',
};
