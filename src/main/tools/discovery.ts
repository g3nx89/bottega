import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { extractTree } from '../compression/project-tree.js';
import { MODE_EXTRACTORS, MODE_WALK, type SemanticMode } from '../compression/semantic-modes.js';
import { type ToolDeps, textResult } from './index.js';

/**
 * Plugin code that walks the Figma document tree.
 * Two modes: 'fast' (core fields only) and 'rich' (adds visual/layout detail).
 */
function buildGetFileDataCode(nodeId?: string, depth?: number, walkMode: 'fast' | 'rich' = 'fast'): string {
  const maxDepth = typeof depth === 'number' && depth >= 0 ? depth : 100;

  // Extra fields collected in 'rich' mode for semantic extraction
  const richFields =
    walkMode === 'rich'
      ? `
          if (node.fills && node.fills !== figma.mixed) n.fills = node.fills;
          if (node.strokes && node.strokes.length > 0) { n.strokes = node.strokes; n.strokeWeight = node.strokeWeight; n.strokeDashes = node.strokeDashes; }
          if (node.effects && node.effects.length > 0) n.effects = node.effects;
          if (node.layoutSizingHorizontal) n.layoutSizingHorizontal = node.layoutSizingHorizontal;
          if (node.layoutSizingVertical) n.layoutSizingVertical = node.layoutSizingVertical;
          if (node.primaryAxisAlignItems) n.primaryAxisAlignItems = node.primaryAxisAlignItems;
          if (node.counterAxisAlignItems) n.counterAxisAlignItems = node.counterAxisAlignItems;
          if (node.layoutPositioning) n.layoutPositioning = node.layoutPositioning;
          if (node.layoutAlign) n.layoutAlign = node.layoutAlign;
          if (node.layoutGrow !== undefined) n.layoutGrow = node.layoutGrow;
          if (node.overflowDirection) n.overflowDirection = node.overflowDirection;
          if (node.cornerRadius !== undefined && node.cornerRadius !== 0) n.cornerRadius = node.cornerRadius;
          if (node.rectangleCornerRadii) n.rectangleCornerRadii = node.rectangleCornerRadii;
          if (node.clipsContent !== undefined) n.clipsContent = node.clipsContent;
          if (node.absoluteBoundingBox) n.absoluteBoundingBox = node.absoluteBoundingBox;
          if (node.styles) n.styles = node.styles;
          if (node.type === 'TEXT') {
            n.characters = node.characters; n.fontSize = node.fontSize;
            try {
              n.style = { fontFamily: node.fontName?.family, fontStyle: node.fontName?.style,
                lineHeightPx: node.lineHeight?.value, letterSpacing: node.letterSpacing?.value,
                textCase: node.textCase, textAlignHorizontal: node.textAlignHorizontal,
                textAlignVertical: node.textAlignVertical };
            } catch(e) { n.characters = node.characters; n.fontSize = node.fontSize; }
          }
          if (node.type === 'INSTANCE') {
            if (node.mainComponent) n.componentId = node.mainComponent.key;
            if (node.componentProperties) n.componentProperties = node.componentProperties;
          }
          if (node.type === 'COMPONENT') n.key = node.key;`
      : `
          if (node.fills && node.fills !== figma.mixed) n.fills = node.fills;
          if (node.strokes && node.strokes.length > 0) { n.strokes = node.strokes; n.strokeWeight = node.strokeWeight; }
          if (node.effects && node.effects.length > 0) n.effects = node.effects;
          if (node.type === 'TEXT') { n.characters = node.characters; n.fontSize = node.fontSize; }
          if (node.type === 'INSTANCE' && node.mainComponent) n.componentId = node.mainComponent.key;
          if (node.type === 'COMPONENT') n.key = node.key;`;

  // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
  return `return (async () => {
    try {
      const root = ${nodeId ? `await figma.getNodeByIdAsync(${JSON.stringify(nodeId)})` : 'figma.currentPage'}; // nosemgrep
      if (!root) return JSON.stringify({ error: 'Node not found' });
      function walk(node, d) {
        if (d > ${maxDepth}) return null; // nosemgrep
        const n = {
          id: node.id, type: node.type, name: node.name,
          width: node.width, height: node.height,
          visible: node.visible, opacity: node.opacity,
          layoutMode: node.layoutMode, layoutWrap: node.layoutWrap,
          itemSpacing: node.itemSpacing,
          paddingTop: node.paddingTop, paddingRight: node.paddingRight,
          paddingBottom: node.paddingBottom, paddingLeft: node.paddingLeft,
        };${richFields}
        if (node.children) n.children = node.children.map(c => walk(c, d + 1)).filter(Boolean);
        return n;
      }
      return JSON.stringify(walk(root, 0));
    } catch (e) { return JSON.stringify({ error: e.message }); }
  })()`;
}

export function createDiscoveryTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, figmaAPI, designSystemCache, configManager, fileKey } = deps;

  return [
    defineTool({
      name: 'figma_get_file_data',
      label: 'Get File Data',
      description:
        'Get the node tree structure of the current page or a specific subtree. Returns a semantic view with layout (CSS flexbox), visual styles (CSS values), and component info. Use the mode parameter to control detail level.',
      promptSnippet:
        'figma_get_file_data: get page/node tree (modes: structure, content, styling, component, full, briefing)',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Root node ID. If omitted, returns current page.' })),
        depth: Type.Optional(
          Type.Number({ description: 'Max traversal depth. -1 for unlimited (default).', default: -1 }),
        ),
        mode: Type.Optional(
          Type.String({
            description:
              'Extraction mode: structure (layout only), content (text only), styling (visual props), component (component info), full (everything), briefing (minimal). Default from compression profile.',
          }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const rawMode = params.mode ?? configManager.getActiveConfig().defaultSemanticMode;
        if (!(rawMode in MODE_EXTRACTORS))
          return textResult({ error: `Invalid mode: ${rawMode}. Valid: ${Object.keys(MODE_EXTRACTORS).join(', ')}` });
        const mode = rawMode as SemanticMode;
        const walkMode = MODE_WALK[mode];
        const code = buildGetFileDataCode(params.nodeId, params.depth, walkMode);
        const rawResult = await connector.executeCodeViaUI(code, 30000);
        try {
          const parsed = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
          if (parsed?.error) return textResult({ error: parsed.error });
          const result = extractTree(parsed, mode, { maxDepth: params.depth });
          const format = configManager.getActiveConfig().outputFormat;
          const dsCache = designSystemCache?.get(true, fileKey);
          if (dsCache && 'dsStatus' in dsCache) {
            if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
              (result as any)._dsStatus = (dsCache as any).dsStatus;
            }
          }
          return textResult(result, format);
        } catch {
          return textResult(rawResult);
        }
      },
    }),
    defineTool({
      name: 'figma_search_components',
      label: 'Search Components',
      description: 'Search for components by name. Searches local components or a library file.',
      promptSnippet: 'figma_search_components: search for components by name (local or library)',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query for component names' }),
        libraryFileKey: Type.Optional(
          Type.String({ description: 'File key of a library to search. If omitted, searches local components.' }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const format = configManager.getActiveConfig().outputFormat;
        if (params.libraryFileKey) {
          const result = await figmaAPI.searchComponents(params.libraryFileKey, params.query);
          return textResult(result, format);
        }
        const components = await connector.getLocalComponents();
        const filtered = Array.isArray(components)
          ? components.filter((c: any) => c.name?.toLowerCase().includes(params.query.toLowerCase()))
          : components;
        return textResult(filtered, format);
      },
    }),
    defineTool({
      name: 'figma_get_library_components',
      label: 'Get Library Components',
      description:
        'Get all published components and component sets from an external library file. Requires the library file key. PREFER this tool over figma_execute or figma_design_system when the user asks to "list library components", "show library contents", or "what is in this library".',
      promptSnippet:
        'figma_get_library_components: list components in a library file (prefer over figma_design_system / figma_execute)',
      parameters: Type.Object({
        fileKey: Type.String({ description: 'File key of the library' }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const format = configManager.getActiveConfig().outputFormat;
        const [components, componentSets] = await Promise.all([
          figmaAPI.getComponents(params.fileKey),
          figmaAPI.getComponentSets(params.fileKey),
        ]);
        return textResult({ components, componentSets }, format);
      },
    }),
    defineTool({
      name: 'figma_get_component_details',
      label: 'Get Component Details',
      description:
        'Get detailed information about a specific component: properties, variants, and nested layer structure.',
      promptSnippet: 'figma_get_component_details: inspect component properties, variants, and structure',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID of the component' }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = await connector.getComponentFromPluginUI(params.nodeId);
        return textResult(result);
      },
    }),
    defineTool({
      name: 'figma_get_component_deep',
      label: 'Deep Component Extraction',
      description:
        'Get a deeply nested component tree with full visual properties, resolved design tokens, prototype interactions, and annotations. Runs entirely in the plugin — no REST API needed. Also reports token_coverage (% of properties using design tokens vs hardcoded values).',
      promptSnippet:
        'figma_get_component_deep: extract full component tree with tokens, interactions, annotations, and token coverage',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Component node ID (e.g., "695:313")' }),
        depth: Type.Optional(Type.Number({ description: 'Max tree depth (default: 10, max: 20)', default: 10 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const depth = Math.min(Math.max(params.depth || 10, 1), 20);
        const result = await connector.deepGetComponent(params.nodeId, depth);
        return textResult(result);
      },
    }),
    defineTool({
      name: 'figma_analyze_component_set',
      label: 'Analyze Component Set',
      description:
        'Analyze a COMPONENT_SET to extract variant state machine, CSS pseudo-class mappings, and cross-variant visual diffs. PREFER this tool over figma_execute or figma_search_components when the user asks to "analyze", "inspect variants", or "compare states" of a component set — it produces a structured state-machine answer in one call.',
      promptSnippet:
        'figma_analyze_component_set: extract variant states + visual diffs (prefer over figma_execute / figma_search_components)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'COMPONENT_SET node ID (e.g., "214:274")' }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = await connector.analyzeComponentSet(params.nodeId);
        return textResult(result);
      },
    }),
    defineTool({
      name: 'figma_design_system',
      label: 'Design System Overview',
      description:
        'Get an overview of the design system: variables (tokens), rules, naming conventions, and local components. Returns dsStatus (none/partial/active). Results are cached — use forceRefresh after DS changes.',
      promptSnippet:
        'figma_design_system: get design system overview (variables + rules + naming + local components, cached). Use forceRefresh after DS changes',
      parameters: Type.Object({
        forceRefresh: Type.Optional(
          Type.Boolean({
            description: 'Force fresh fetch bypassing cache. Use when you suspect the design system changed.',
          }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const config = configManager.getActiveConfig();
        const shouldCompact = config.compactDesignSystem;
        const format = config.outputFormat;

        // Check cache (unless forceRefresh requested)
        if (!params.forceRefresh) {
          const cached = designSystemCache.get(shouldCompact, fileKey);
          if (cached) return textResult(cached, format);
        }

        // Fetch fresh from Figma — use allSettled so variables succeed even if
        // getLocalComponents times out (GET_LOCAL_COMPONENTS hangs on large files).
        // This populates the cache with at least the variables, avoiding repeated
        // 45s timeouts on subsequent calls.
        const [varsSettled, compsSettled] = await Promise.allSettled([
          connector.getVariables(),
          connector.getLocalComponents(),
        ]);
        const varsResult = varsSettled.status === 'fulfilled' ? varsSettled.value : null;
        const compsResult = compsSettled.status === 'fulfilled' ? compsSettled.value : null;
        // getLocalComponents failure is expected on large files — variables are still cached
        const rawCollections = varsResult
          ? Array.isArray(varsResult)
            ? varsResult
            : (varsResult?.variableCollections ?? varsResult?.variables ?? varsResult)
          : [];
        const rawComponents = compsResult
          ? Array.isArray(compsResult)
            ? compsResult
            : (compsResult?.components ?? compsResult)
          : [];
        // Preserve both flat variables AND collections for compactDesignSystem's shape detection
        const flatVars = varsResult && !Array.isArray(varsResult) ? varsResult?.variables : undefined;
        const raw = {
          variables: Array.isArray(rawCollections) ? rawCollections : [],
          ...(flatVars && Array.isArray(flatVars) ? { flatVariables: flatVars } : {}),
          variableCollections: varsResult?.variableCollections,
          components: Array.isArray(rawComponents) ? rawComponents : [],
        };

        // Store in cache — use shorter TTL for partial results (components failed)
        // so subsequent calls retry the component fetch sooner.
        const isPartial = compsResult === null;
        const { compact } = designSystemCache.set(raw, fileKey, isPartial ? 30_000 : undefined);
        return textResult(shouldCompact ? compact : raw, format);
      },
    }),
    defineTool({
      name: 'figma_scan_text_nodes',
      label: 'Scan Text Nodes',
      description:
        'Scan all text nodes under a node or the current page. Returns text content, font info, and position for each node.',
      promptSnippet: 'figma_scan_text_nodes: scan text nodes with font/position info',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Root node ID (defaults to current page)' })),
        maxDepth: Type.Optional(Type.Number({ description: 'Max traversal depth (default: unlimited)' })),
        maxResults: Type.Optional(Type.Number({ description: 'Max text nodes to return (default: 1000)' })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        // Read-only — no operationQueue needed
        const result = await connector.scanTextNodes(params.nodeId, params.maxDepth, params.maxResults);
        return textResult(result);
      },
    }),
  ];
}
