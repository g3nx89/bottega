import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createAnnotationTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_get_annotations',
      label: 'Get Annotations',
      description:
        'Read design annotations from a node and optionally its children. Annotations contain designer notes, constraints, and instructions attached to specific elements.',
      promptSnippet: 'figma_get_annotations: read design annotations from a node',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID to read annotations from' }),
        includeChildren: Type.Optional(
          Type.Boolean({ description: 'Also read annotations from child nodes', default: false }),
        ),
        depth: Type.Optional(
          Type.Number({ description: 'Max child traversal depth (default: 1, max: 10)', default: 1 }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const depth = Math.min(params.depth || 1, 10);
        const result = await connector.getAnnotations(params.nodeId, params.includeChildren, depth);
        return textResult(result);
      },
    },
    {
      name: 'figma_set_annotations',
      label: 'Set Annotations',
      description:
        'Write design annotations to a node. Supports replace (default) or append mode. Use figma_get_annotation_categories first to get valid category IDs.',
      promptSnippet: 'figma_set_annotations: write design annotations to a node (replace or append)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID to write annotations to' }),
        annotations: Type.Array(
          Type.Object({
            label: Type.Optional(Type.String({ description: 'Plain text label' })),
            labelMarkdown: Type.Optional(Type.String({ description: 'Rich markdown label' })),
            properties: Type.Optional(
              Type.Array(
                Type.Object({
                  type: Type.String({
                    description:
                      'Pinned property type. Valid values: "width", "height", "maxWidth", "minWidth", "maxHeight", "minHeight", "fills", "strokes", "effects", "opacity", "cornerRadius", "strokeWeight", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"',
                  }),
                }),
              ),
            ),
            categoryId: Type.Optional(Type.String({ description: 'Annotation category ID' })),
          }),
        ),
        mode: Type.Optional(
          Type.Union([Type.Literal('replace'), Type.Literal('append')], {
            description: 'replace (default) overwrites existing annotations; append adds to them',
            default: 'replace',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setAnnotations(params.nodeId, params.annotations, params.mode);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_get_annotation_categories',
      label: 'Get Annotation Categories',
      description:
        'List available annotation categories defined in the Figma file. Returns both category ID and human-readable name. ALWAYS call this before figma_set_annotations to get valid category IDs.',
      promptSnippet: 'figma_get_annotation_categories: list categories (id + name). Call BEFORE set_annotations.',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.getAnnotationCategories();
        return textResult(result);
      },
    },
  ];
}
