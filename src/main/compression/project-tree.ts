/**
 * Semantic extraction pipeline — transforms raw Figma document trees into compact
 * semantic representations via composable extractors.
 *
 * Replaces the old subtractive projectTree() with a constructive approach:
 * each mode selects which extractors run, building only the fields needed.
 * Style deduplication, SVG collapse, and invisible filtering reduce token usage.
 */

import {
  componentExtractor,
  identityExtractor,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
} from './semantic-extractors.js';
import {
  type ExtractionContext,
  type ExtractorFn,
  type ExtractorName,
  MODE_EXTRACTORS,
  type SemanticMode,
  type SemanticNode,
  type SemanticResult,
} from './semantic-modes.js';
import { inlineSingles } from './style-dedup.js';
import { collapseSvgContainers, filterInvisible, removeEmptyKeys } from './tree-collapse.js';

// ── Extractor registry ─────────────────────────

const EXTRACTOR_REGISTRY: Record<ExtractorName, ExtractorFn> = {
  identity: identityExtractor,
  layout: layoutExtractor,
  text: textExtractor,
  visuals: visualsExtractor,
  component: componentExtractor,
};

// ── Core pipeline ──────────────────────────────

/** Walk-invariant config created once per extractTree() call. */
interface WalkConfig {
  extractors: ExtractorFn[];
  maxDepth: number;
  useCollapse: boolean;
}

function processNode(raw: any, config: WalkConfig, context: ExtractionContext): SemanticNode | null {
  const result: SemanticNode = { id: '', name: '', type: '' };

  for (const extractor of config.extractors) {
    extractor(raw, result, context);
  }

  if (Array.isArray(raw.children) && raw.children.length > 0 && context.currentDepth < config.maxDepth) {
    const childContext: ExtractionContext = {
      ...context,
      currentDepth: context.currentDepth + 1,
      parent: raw,
    };
    const children = walkAndExtract(raw.children, config, childContext);

    if (children.length > 0) {
      const finalChildren = config.useCollapse ? collapseSvgContainers(raw, result, children) : children;
      if (finalChildren.length > 0) result.children = finalChildren;
    }
  }

  return result;
}

function walkAndExtract(rawNodes: any[], config: WalkConfig, context: ExtractionContext): SemanticNode[] {
  const results: SemanticNode[] = [];

  for (const rawNode of rawNodes) {
    if (!filterInvisible(rawNode)) continue;
    const node = processNode(rawNode, config, context);
    if (node) results.push(node);
  }

  return results;
}

/**
 * Extract a semantic tree from raw Figma plugin data.
 *
 * @param rawNode - Raw node or array of nodes from the plugin walk
 * @param mode - Extraction mode controlling which fields are included
 * @param options - Optional max depth limit
 */
export function extractTree(rawNode: any, mode: SemanticMode, options?: { maxDepth?: number }): SemanticResult {
  const extractorNames = MODE_EXTRACTORS[mode];
  const extractors = extractorNames
    .map((name) => EXTRACTOR_REGISTRY[name as ExtractorName])
    .filter(Boolean) as ExtractorFn[];

  const config: WalkConfig = {
    extractors,
    maxDepth: options?.maxDepth != null && options.maxDepth >= 0 ? options.maxDepth : Infinity,
    useCollapse: extractorNames.includes('visuals'),
  };

  const context: ExtractionContext = {
    globalVars: { styles: {} },
    currentDepth: 0,
    styleCache: new Map(),
    nodesProcessed: 0,
  };

  const rawNodes = Array.isArray(rawNode) ? rawNode : [rawNode];
  const nodes = walkAndExtract(rawNodes, config, context);

  inlineSingles(nodes, context.globalVars);

  const hasStyles = Object.keys(context.globalVars.styles).length > 0;
  return {
    nodes: nodes.map((n) => removeEmptyKeys(n)).filter(Boolean),
    ...(hasStyles ? { globalVars: context.globalVars } : {}),
  };
}

// ── Re-exports ─────────────────────────────────

export type {
  ExtractionContext,
  ExtractorFn,
  ExtractorName,
  GlobalVars,
  SemanticMode,
  SemanticNode,
  SemanticResult,
} from './semantic-modes.js';

// ── Deprecated API ─────────────────────────────

/** @deprecated Use extractTree() instead. */
export type ProjectionDetail = 'standard' | 'detailed';

/** @deprecated Use extractTree() instead. Throws at runtime to catch missed callers. */
export function projectTree(_rawNode: any, _detail?: ProjectionDetail): never {
  throw new Error('projectTree is deprecated. Use extractTree() instead.');
}

/** @deprecated Use extractTree() instead. */
export function projectTreeArray(_rawNodes: any[], _detail?: ProjectionDetail): never {
  throw new Error('projectTreeArray is deprecated. Use extractTree() instead.');
}
