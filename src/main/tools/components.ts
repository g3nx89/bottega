import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createComponentTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_instantiate',
      label: 'Instantiate Component',
      description:
        'Create an instance of a component. For LOCAL components (just created via figma_create_component), pass nodeId (componentId from the create result). For LIBRARY/published components, pass componentKey (from figma_search_components / figma_get_library_components). At least one of nodeId or componentKey is required.',
      promptSnippet:
        'figma_instantiate: create instance — nodeId for local components, componentKey for library components',
      parameters: Type.Object({
        nodeId: Type.Optional(
          Type.String({
            description:
              'Component node ID (for local/unpublished components — use componentId from figma_create_component result)',
          }),
        ),
        componentKey: Type.Optional(
          Type.String({
            description:
              'Component key (for published library components — from figma_search_components / figma_get_library_components)',
          }),
        ),
        x: Type.Optional(Type.Number({ description: 'X position' })),
        y: Type.Optional(Type.Number({ description: 'Y position' })),
        parentId: Type.Optional(Type.String({ description: 'Parent node ID' })),
        variant: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description:
              'Variant property map for COMPONENT_SET (e.g. { State: "Hover", Size: "Large" }). Applied at instantiation — avoids follow-up figma_set_variant call.',
          }),
        ),
        size: Type.Optional(
          Type.Object(
            {
              width: Type.Number(),
              height: Type.Number(),
            },
            { description: 'Resize instance at creation — avoids follow-up figma_resize call.' },
          ),
        ),
        overrides: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description:
              'Component property overrides applied at instantiation (text, boolean, instance swap). Use base property name (e.g. "label"), not the disambiguated key. Avoids follow-up figma_set_instance_properties call.',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          if (!params.componentKey && !params.nodeId) {
            return textResult({
              success: false,
              error: 'figma_instantiate requires either nodeId (local components) or componentKey (library components)',
            });
          }
          const position =
            typeof params.x === 'number' || typeof params.y === 'number'
              ? { x: params.x ?? 0, y: params.y ?? 0 }
              : undefined;
          const result = await connector.instantiateComponent(params.componentKey ?? '', {
            nodeId: params.nodeId,
            position,
            parentId: params.parentId,
            variant: params.variant,
            size: params.size,
            overrides: params.overrides,
          });
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_instance_properties',
      label: 'Set Instance Properties',
      description:
        'Set properties on a component instance (text overrides, boolean toggles, swap instances). Use base property name (e.g. "label"), not the disambiguated key.',
      promptSnippet: 'figma_set_instance_properties: override instance properties (text, boolean, instance swap)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Instance node ID' }),
        properties: Type.Record(Type.String(), Type.Any(), { description: 'Property name → value map' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setInstanceProperties(params.nodeId, params.properties);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_arrange_component_set',
      label: 'Arrange Component Set',
      description:
        'Arrange variants in a component set into an organized grid layout with consistent spacing. PREFER this tool over figma_execute or figma_batch_transform when the user asks to "arrange", "organize", "lay out", or "grid" the variants of a component set — it handles spacing and column math in one call.',
      promptSnippet:
        'figma_arrange_component_set: organize component variants into a grid (prefer over figma_execute / figma_batch_transform)',
      promptGuidelines: [
        'Use whenever the user asks to arrange / organize / lay out / grid the variants of a component set.',
        'Prefer this over figma_execute or figma_batch_transform — it is a single dedicated call.',
      ],
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Component set node ID' }),
        columns: Type.Optional(Type.Number({ description: 'Number of columns (default: auto)' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const nodeId = String(params.nodeId).replace(/[^0-9:]/g, '');
          const cols = Math.max(1, Math.floor(Number(params.columns) || 4));
          // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
          const code = `
            return (async () => {
              try {
                const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)}); // nosemgrep
                if (!node || node.type !== 'COMPONENT_SET') {
                  return JSON.stringify({ success: false, error: 'Not a component set' });
                }
                const children = [...node.children];
                const spacing = 20;
                const cols = ${cols}; // nosemgrep
                let maxW = 0, maxH = 0;
                children.forEach(c => { maxW = Math.max(maxW, c.width); maxH = Math.max(maxH, c.height); });
                children.forEach((c, i) => {
                  c.x = (i % cols) * (maxW + spacing);
                  c.y = Math.floor(i / cols) * (maxH + spacing);
                });
                return JSON.stringify({ success: true, arranged: children.length, columns: cols });
              } catch (e) {
                return JSON.stringify({ success: false, error: e.message });
              }
            })()
          `;
          const result = await connector.executeCodeViaUI(code, 15000);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_create_component',
      label: 'Create Component',
      description:
        'Create a new Figma COMPONENT node, or convert an existing frame to a component. When converting, children and visual properties are preserved.',
      promptSnippet:
        'figma_create_component: create a component from scratch or convert an existing frame to a component',
      parameters: Type.Object({
        name: Type.String({ description: 'Component name' }),
        fromFrameId: Type.Optional(
          Type.String({ description: 'If provided, converts this frame to a component (preserves children)' }),
        ),
        width: Type.Optional(Type.Number({ description: 'Width in px (ignored when converting from frame)' })),
        height: Type.Optional(Type.Number({ description: 'Height in px (ignored when converting from frame)' })),
        parentId: Type.Optional(
          Type.String({ description: 'Parent node ID (ignored when converting — component stays in same parent)' }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const name = String(params.name);
          const fromFrameId = params.fromFrameId ? String(params.fromFrameId).replace(/[^0-9:;]/g, '') : undefined;
          const parentId = params.parentId ? String(params.parentId).replace(/[^0-9:;]/g, '') : undefined;
          const width = params.width ?? 100;
          const height = params.height ?? 100;

          // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
          const code = fromFrameId
            ? `
              return (async () => {
                try {
                  const frame = await figma.getNodeByIdAsync(${JSON.stringify(fromFrameId)});
                  if (!frame) {
                    return JSON.stringify({ success: false, error: 'Frame not found' });
                  }
                  if (frame.type !== 'FRAME' && frame.type !== 'GROUP') {
                    return JSON.stringify({ success: false, error: 'Node is not a FRAME or GROUP, type: ' + frame.type });
                  }
                  const component = figma.createComponent();
                  component.name = ${JSON.stringify(name)};
                  component.resize(frame.width, frame.height);
                  component.x = frame.x;
                  component.y = frame.y;
                  if (frame.parent) {
                    const idx = frame.parent.children.indexOf(frame);
                    frame.parent.insertChild(idx, component);
                  }
                  // Copy auto-layout properties if present
                  if ('layoutMode' in frame && frame.layoutMode !== 'NONE') {
                    component.layoutMode = frame.layoutMode;
                    component.primaryAxisSizingMode = frame.primaryAxisSizingMode;
                    component.counterAxisSizingMode = frame.counterAxisSizingMode;
                    component.paddingTop = frame.paddingTop;
                    component.paddingRight = frame.paddingRight;
                    component.paddingBottom = frame.paddingBottom;
                    component.paddingLeft = frame.paddingLeft;
                    component.itemSpacing = frame.itemSpacing;
                    if (frame.primaryAxisAlignItems) component.primaryAxisAlignItems = frame.primaryAxisAlignItems;
                    if (frame.counterAxisAlignItems) component.counterAxisAlignItems = frame.counterAxisAlignItems;
                  }
                  // Copy fills, strokes, effects, corner radius
                  if (frame.fills) component.fills = JSON.parse(JSON.stringify(frame.fills));
                  if (frame.strokes) component.strokes = JSON.parse(JSON.stringify(frame.strokes));
                  if (frame.effects) component.effects = JSON.parse(JSON.stringify(frame.effects));
                  if ('cornerRadius' in frame) component.cornerRadius = frame.cornerRadius;
                  // Move children from frame to component
                  const children = [...frame.children];
                  for (const child of children) {
                    component.appendChild(child);
                  }
                  frame.remove();
                  return JSON.stringify({ success: true, componentId: component.id, name: component.name, converted: true });
                } catch (e) {
                  return JSON.stringify({ success: false, error: e.message });
                }
              })()
            `
            : `
              return (async () => {
                try {
                  const component = figma.createComponent();
                  component.name = ${JSON.stringify(name)};
                  component.resize(${width}, ${height});
                  ${
                    parentId
                      ? `
                  const parent = await figma.getNodeByIdAsync(${JSON.stringify(parentId)});
                  if (parent && 'appendChild' in parent) {
                    parent.appendChild(component);
                  }
                  `
                      : ''
                  }
                  return JSON.stringify({ success: true, componentId: component.id, name: component.name, width: ${width}, height: ${height} });
                } catch (e) {
                  return JSON.stringify({ success: false, error: e.message });
                }
              })()
            `;
          const result = await connector.executeCodeViaUI(code, 15000);
          return textResult(typeof result === 'string' ? JSON.parse(result) : result);
        });
      },
    },
    {
      name: 'figma_set_variant',
      label: 'Set Component Variant',
      description:
        'Switch variant properties on a component instance (e.g. State: Hover, Size: Large). Preserves instance overrides.',
      promptSnippet: 'figma_set_variant: switch variant on component instance',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Component instance node ID' }),
        variant: Type.Record(Type.String(), Type.String(), {
          description: 'Variant properties as key-value pairs, e.g. { "State": "Hover", "Size": "Large" }',
        }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setVariant(params.nodeId, params.variant);
          return textResult(result);
        });
      },
    },
  ];
}
