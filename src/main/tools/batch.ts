import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createBatchTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_batch_set_text',
      label: 'Batch Set Text',
      description:
        'Update text content on multiple nodes in a single call. Much faster than calling figma_set_text repeatedly.',
      promptSnippet: 'figma_batch_set_text: update text on multiple nodes at once',
      parameters: Type.Object({
        updates: Type.Array(
          Type.Object({
            nodeId: Type.String({ description: 'Text node ID' }),
            text: Type.String({ description: 'New text content' }),
            fontFamily: Type.Optional(Type.String({ description: 'Font family override' })),
            fontSize: Type.Optional(Type.Number({ description: 'Font size override' })),
          }),
          { description: 'Array of text updates to apply', maxItems: 200 },
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.batchSetText(params.updates);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_batch_set_fills',
      label: 'Batch Set Fills',
      description:
        'Set fill colors on multiple nodes in a single call. Much faster than calling figma_set_fills repeatedly.',
      promptSnippet: 'figma_batch_set_fills: set fills on multiple nodes at once',
      parameters: Type.Object({
        updates: Type.Array(
          Type.Object({
            nodeId: Type.String({ description: 'Node ID' }),
            fills: Type.Array(Type.Any(), { description: 'Fill paints array' }),
          }),
          { description: 'Array of fill updates to apply', maxItems: 200 },
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.batchSetFills(params.updates);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_batch_transform',
      label: 'Batch Transform',
      description:
        'Move and/or resize multiple nodes in a single call. Much faster than calling figma_move/figma_resize repeatedly.',
      promptSnippet: 'figma_batch_transform: move/resize multiple nodes at once',
      parameters: Type.Object({
        updates: Type.Array(
          Type.Object({
            nodeId: Type.String({ description: 'Node ID' }),
            x: Type.Optional(Type.Number({ description: 'New X position' })),
            y: Type.Optional(Type.Number({ description: 'New Y position' })),
            width: Type.Optional(Type.Number({ description: 'New width' })),
            height: Type.Optional(Type.Number({ description: 'New height' })),
          }),
          { description: 'Array of transform updates to apply', maxItems: 200 },
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.batchTransform(params.updates);
          return textResult(result);
        });
      },
    },
  ];
}
