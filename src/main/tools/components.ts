import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { ToolDeps } from './index.js';

export function createComponentTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_instantiate',
      label: 'Instantiate Component',
      description: 'Create an instance of a component. Use component key from figma_search_components or figma_get_library_components. For library components, uses importComponentByKeyAsync.',
      promptSnippet: 'figma_instantiate: create instance of a component (local or library)',
      parameters: Type.Object({
        componentKey: Type.String({ description: 'Component key' }),
        x: Type.Optional(Type.Number({ description: 'X position' })),
        y: Type.Optional(Type.Number({ description: 'Y position' })),
        parentId: Type.Optional(Type.String({ description: 'Parent node ID' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.instantiateComponent(params.componentKey, {
            x: params.x, y: params.y, parentId: params.parentId,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        });
      },
    },
    {
      name: 'figma_set_instance_properties',
      label: 'Set Instance Properties',
      description: 'Set properties on a component instance (text overrides, boolean toggles, swap instances).',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Instance node ID' }),
        properties: Type.Record(Type.String(), Type.Any(), { description: 'Property name → value map' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setInstanceProperties(params.nodeId, params.properties);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        });
      },
    },
    {
      name: 'figma_arrange_component_set',
      label: 'Arrange Component Set',
      description: 'Arrange variants in a component set into a grid layout.',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Component set node ID' }),
        columns: Type.Optional(Type.Number({ description: 'Number of columns (default: auto)' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const cols = params.columns ?? 4;
          const code = `
            (async () => {
              const node = figma.getNodeById('${params.nodeId}');
              if (!node || node.type !== 'COMPONENT_SET') throw new Error('Not a component set');
              const children = [...node.children];
              const spacing = 20;
              let maxW = 0, maxH = 0;
              children.forEach(c => { maxW = Math.max(maxW, c.width); maxH = Math.max(maxH, c.height); });
              children.forEach((c, i) => {
                c.x = (i % ${cols}) * (maxW + spacing);
                c.y = Math.floor(i / ${cols}) * (maxH + spacing);
              });
              return { arranged: children.length, columns: ${cols} };
            })()
          `;
          const result = await connector.executeCodeViaUI(code, 15000);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        });
      },
    },
  ];
}
