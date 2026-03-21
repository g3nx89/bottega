import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createManipulationTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_set_fills',
      label: 'Set Fills',
      description:
        'Set the fill colors of a node. Accepts hex colors. SOLID fills only — gradients and image fills require figma_execute.',
      promptSnippet: 'figma_set_fills: set solid fill colors on a node (SOLID only — gradients need figma_execute)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        fills: Type.Array(Type.Any(), {
          description: 'Array of fill paints. Simple: [{ type: "SOLID", color: "#FF0000" }]',
        }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setNodeFills(params.nodeId, params.fills);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_strokes',
      label: 'Set Strokes',
      description:
        'Set the stroke colors and weight of a node. SOLID strokes only — gradient strokes require figma_execute.',
      promptSnippet: 'figma_set_strokes: set solid stroke colors and weight (SOLID only)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        strokes: Type.Array(Type.Any(), { description: 'Array of stroke paints' }),
        weight: Type.Optional(Type.Number({ description: 'Stroke weight in px' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setNodeStrokes(params.nodeId, params.strokes, params.weight);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_text',
      label: 'Set Text',
      description: 'Set the text content and optionally font properties of a text node.',
      promptSnippet: 'figma_set_text: set text content and font properties on a text node',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Text node ID' }),
        text: Type.String({ description: 'Text content to set' }),
        fontFamily: Type.Optional(Type.String({ description: 'Font family (default: Inter)' })),
        fontSize: Type.Optional(Type.Number({ description: 'Font size in px' })),
        fontWeight: Type.Optional(Type.String({ description: 'Font weight/style (e.g. "Bold", "Medium")' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setTextContent(params.nodeId, params.text, {
            fontFamily: params.fontFamily,
            fontSize: params.fontSize,
            fontWeight: params.fontWeight,
          });
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_image_fill',
      label: 'Set Image Fill',
      description: 'Set an image as the fill of one or more nodes. Provide either a URL or base64-encoded image data.',
      promptSnippet: 'figma_set_image_fill: apply an image fill to nodes (from URL or base64)',
      parameters: Type.Object({
        nodeIds: Type.Array(Type.String(), { description: 'Node IDs to apply image fill to' }),
        imageUrl: Type.Optional(Type.String({ description: 'Image URL to fetch and apply' })),
        base64: Type.Optional(Type.String({ description: 'Base64-encoded image data' })),
        scaleMode: Type.Optional(
          Type.Union([Type.Literal('FILL'), Type.Literal('FIT'), Type.Literal('CROP'), Type.Literal('TILE')], {
            default: 'FILL',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const imageData = params.base64 ?? params.imageUrl ?? '';
          const result = await connector.setImageFill(params.nodeIds, imageData, params.scaleMode ?? 'FILL');
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_resize',
      label: 'Resize Node',
      description:
        'Resize a node to specific dimensions. Note: width/height are read-only in the Plugin API — this tool uses resize() internally.',
      promptSnippet: 'figma_resize: change a node width and height',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        width: Type.Number({ description: 'New width in px' }),
        height: Type.Number({ description: 'New height in px' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.resizeNode(params.nodeId, params.width, params.height);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_move',
      label: 'Move Node',
      description:
        'Move a node to a specific x/y position. For reparenting (moving into a different parent), use figma_execute with appendChild().',
      promptSnippet: 'figma_move: reposition a node (position only — reparenting needs figma_execute)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        x: Type.Number({ description: 'X position' }),
        y: Type.Number({ description: 'Y position' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.moveNode(params.nodeId, params.x, params.y);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_create_child',
      label: 'Create Child Node',
      description: 'Create a new child node inside a parent. Types: FRAME, RECTANGLE, ELLIPSE, TEXT, LINE.',
      promptSnippet: 'figma_create_child: create a new node (FRAME/RECTANGLE/ELLIPSE/TEXT/LINE) inside a parent',
      parameters: Type.Object({
        parentId: Type.String({ description: 'Parent node ID' }),
        type: Type.String({ description: 'Node type: FRAME, RECTANGLE, ELLIPSE, TEXT, LINE' }),
        props: Type.Optional(
          Type.Record(Type.String(), Type.Any(), { description: 'Initial properties (width, height, fills, etc.)' }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.createChildNode(params.parentId, params.type, params.props);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_clone',
      label: 'Clone Node',
      description:
        'Create a duplicate of a node. Preserves all visual properties including image fills — prefer over building from scratch.',
      promptSnippet: 'figma_clone: duplicate a node (preserves image fills and all visual properties)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID to clone' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.cloneNode(params.nodeId);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_delete',
      label: 'Delete Node',
      description: 'Delete a node and its children from the Figma document. Irreversible.',
      promptSnippet: 'figma_delete: remove a node (irreversible)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID to delete' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.deleteNode(params.nodeId);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_rename',
      label: 'Rename Node',
      description:
        'Rename a node in the Figma layers panel. Use semantic names with slash convention (e.g. "Card/Body").',
      promptSnippet: 'figma_rename: rename a layer (use semantic slash naming like "Card/Body")',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        name: Type.String({ description: 'New name' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.renameNode(params.nodeId, params.name);
          return textResult(result);
        });
      },
    },
  ];
}
