import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { type ToolDeps, textResult } from './index.js';

export function createDiscoveryTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, figmaAPI } = deps;

  return [
    {
      name: 'figma_get_file_data',
      label: 'Get File Data',
      description: 'Get the document structure of a Figma file via REST API.',
      parameters: Type.Object({
        fileKey: Type.String({ description: 'Figma file key' }),
        depth: Type.Optional(Type.Number({ description: 'Max depth to traverse (default: 2)' })),
        nodeId: Type.Optional(Type.String({ description: 'Specific node ID to fetch' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await figmaAPI.getFile(params.fileKey, {
          depth: params.depth,
          ids: params.nodeId ? [params.nodeId] : undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'figma_search_components',
      label: 'Search Components',
      description: 'Search for components by name. Searches local components or a library file.',
      promptSnippet: 'figma_search_components: search for components by name (local or library)',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query for component names' }),
        libraryFileKey: Type.Optional(Type.String({ description: 'File key of a library to search. If omitted, searches local components.' })),
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
      description: 'Get all components and component sets from a library file.',
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
      description: 'Get detailed information about a specific component by node ID.',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID of the component' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.getComponentFromPluginUI(params.nodeId);
        return textResult(result);
      },
    },
    {
      name: 'figma_design_system',
      label: 'Design System Overview',
      description: 'Get an overview of the design system: variables (tokens) and local components.',
      promptSnippet: 'figma_design_system: get design system overview (variables + local components)',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const [variables, components] = await Promise.all([
          connector.getVariables(),
          connector.getLocalComponents(),
        ]);
        return textResult({ variables, components });
      },
    },
  ];
}
