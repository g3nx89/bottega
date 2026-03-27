import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ProjectionDetail, projectTree } from '../compression/project-tree.js';
import { type ToolDeps, textResult } from './index.js';

/** Plugin code that walks the Figma document tree and returns serialized node data. */
function buildGetFileDataCode(nodeId?: string, depth?: number): string {
  const maxDepth = typeof depth === 'number' && depth >= 0 ? depth : 100;
  // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
  return `return (async () => {
    try {
      const root = ${nodeId ? `await figma.getNodeByIdAsync(${JSON.stringify(nodeId)})` : 'figma.currentPage'};
      if (!root) return JSON.stringify({ error: 'Node not found' });
      function walk(node, d) {
        if (d > ${maxDepth}) return null;
        const n = {
          id: node.id, type: node.type, name: node.name,
          width: node.width, height: node.height,
          visible: node.visible, opacity: node.opacity,
          layoutMode: node.layoutMode, layoutWrap: node.layoutWrap,
          itemSpacing: node.itemSpacing,
          paddingTop: node.paddingTop, paddingRight: node.paddingRight,
          paddingBottom: node.paddingBottom, paddingLeft: node.paddingLeft,
        };
        if (node.fills && node.fills !== figma.mixed) n.fills = node.fills;
        if (node.strokes && node.strokes.length > 0) { n.strokes = node.strokes; n.strokeWeight = node.strokeWeight; }
        if (node.effects && node.effects.length > 0) n.effects = node.effects;
        if (node.type === 'TEXT') { n.characters = node.characters; n.fontSize = node.fontSize; }
        if (node.type === 'INSTANCE' && node.mainComponent) n.componentId = node.mainComponent.key;
        if (node.type === 'COMPONENT') n.key = node.key;
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
    {
      name: 'figma_get_file_data',
      label: 'Get File Data',
      description:
        'Get the node tree structure of the current page or a specific subtree. Returns a compact projected view with node IDs, types, names, layout, fills, and component references.',
      promptSnippet: 'figma_get_file_data: get page/node tree structure (compact projected view)',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Root node ID. If omitted, returns current page.' })),
        depth: Type.Optional(
          Type.Number({ description: 'Max traversal depth. -1 for unlimited (default).', default: -1 }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const code = buildGetFileDataCode(params.nodeId, params.depth);
        const rawResult = await connector.executeCodeViaUI(code, 30000);
        try {
          const parsed = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
          if (parsed?.error) return textResult({ error: parsed.error });
          const detail: ProjectionDetail = configManager.getActiveConfig().treeProjectionDetail;
          const projected = projectTree(parsed, detail);
          return textResult(projected);
        } catch {
          return textResult(rawResult);
        }
      },
    },
    {
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
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        if (params.libraryFileKey) {
          const result = await figmaAPI.searchComponents(params.libraryFileKey, params.query);
          return textResult(result);
        }
        const components = await connector.getLocalComponents();
        const filtered = Array.isArray(components)
          ? components.filter((c: any) => c.name?.toLowerCase().includes(params.query.toLowerCase()))
          : components;
        return textResult(filtered);
      },
    },
    {
      name: 'figma_get_library_components',
      label: 'Get Library Components',
      description:
        'Get all published components and component sets from an external library file. Requires the library file key. Use this to discover available components before instantiating with figma_instantiate.',
      promptSnippet:
        'figma_get_library_components: list all components in an external library file (requires file key)',
      parameters: Type.Object({
        fileKey: Type.String({ description: 'File key of the library' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const [components, componentSets] = await Promise.all([
          figmaAPI.getComponents(params.fileKey),
          figmaAPI.getComponentSets(params.fileKey),
        ]);
        return textResult({ components, componentSets });
      },
    },
    {
      name: 'figma_get_component_details',
      label: 'Get Component Details',
      description:
        'Get detailed information about a specific component: properties, variants, and nested layer structure.',
      promptSnippet: 'figma_get_component_details: inspect component properties, variants, and structure',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID of the component' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.getComponentFromPluginUI(params.nodeId);
        return textResult(result);
      },
    },
    {
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
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const depth = Math.min(Math.max(params.depth || 10, 1), 20);
        const result = await connector.deepGetComponent(params.nodeId, depth);
        return textResult(result);
      },
    },
    {
      name: 'figma_analyze_component_set',
      label: 'Analyze Component Set',
      description:
        'Analyze a COMPONENT_SET to extract variant state machine, CSS pseudo-class mappings, and cross-variant visual diffs. Essential for understanding how component variants map to interactive states in code.',
      promptSnippet: 'figma_analyze_component_set: extract variant states, CSS pseudo-class mappings, and visual diffs',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'COMPONENT_SET node ID (e.g., "214:274")' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.analyzeComponentSet(params.nodeId);
        return textResult(result);
      },
    },
    {
      name: 'figma_design_system',
      label: 'Design System Overview',
      description:
        'Get an overview of the design system: variables (tokens) and local components. Results are cached — use forceRefresh if you suspect the design system changed.',
      promptSnippet: 'figma_design_system: get design system overview (variables + local components, cached)',
      parameters: Type.Object({
        forceRefresh: Type.Optional(
          Type.Boolean({
            description: 'Force fresh fetch bypassing cache. Use when you suspect the design system changed.',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const shouldCompact = configManager.getActiveConfig().compactDesignSystem;

        // Check cache (unless forceRefresh requested)
        if (!params.forceRefresh) {
          const cached = designSystemCache.get(shouldCompact, fileKey);
          if (cached) return textResult(cached);
        }

        // Fetch fresh from Figma
        const [variables, components] = await Promise.all([connector.getVariables(), connector.getLocalComponents()]);
        const raw = { variables, components };

        // Store in cache and return appropriate form
        const { compact } = designSystemCache.set(raw, fileKey);
        return textResult(shouldCompact ? compact : raw);
      },
    },
  ];
}
