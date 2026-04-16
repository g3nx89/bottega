import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createLayoutTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    defineTool({
      name: 'figma_auto_layout',
      label: 'Set Auto Layout',
      description:
        'Configure auto-layout on a frame. Handles property ordering automatically (layoutMode first, then sizing, padding, spacing, alignment). Prefer this over figma_execute for layout setup.',
      promptSnippet:
        'figma_auto_layout: set auto-layout (direction, padding, spacing, alignment) — correct ordering guaranteed',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Frame node ID' }),
        direction: StringEnum(['HORIZONTAL', 'VERTICAL', 'NONE'] as const, {
          description: 'Layout direction (NONE removes auto-layout)',
        }),
        padding: Type.Optional(Type.Number({ description: 'Uniform padding (all sides)' })),
        paddingTop: Type.Optional(Type.Number({ description: 'Top padding (overrides uniform)' })),
        paddingBottom: Type.Optional(Type.Number({ description: 'Bottom padding' })),
        paddingLeft: Type.Optional(Type.Number({ description: 'Left padding' })),
        paddingRight: Type.Optional(Type.Number({ description: 'Right padding' })),
        itemSpacing: Type.Optional(Type.Number({ description: 'Gap between children' })),
        primaryAxisAlignItems: Type.Optional(
          StringEnum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'] as const, {
            description: 'Primary axis alignment',
          }),
        ),
        counterAxisAlignItems: Type.Optional(
          StringEnum(['MIN', 'CENTER', 'MAX', 'BASELINE'] as const, {
            description: 'Counter axis alignment',
          }),
        ),
        layoutWrap: Type.Optional(StringEnum(['NO_WRAP', 'WRAP'] as const, { description: 'Wrap behavior' })),
        primaryAxisSizingMode: Type.Optional(
          StringEnum(['FIXED', 'AUTO'] as const, { description: 'Primary axis sizing (AUTO = hug contents)' }),
        ),
        counterAxisSizingMode: Type.Optional(
          StringEnum(['FIXED', 'AUTO'] as const, { description: 'Counter axis sizing (AUTO = hug contents)' }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setAutoLayout(params.nodeId, params);
          return textResult(result);
        });
      },
    }),
  ];
}
