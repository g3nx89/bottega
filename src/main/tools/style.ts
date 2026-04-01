import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createStyleTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_set_text_style',
      label: 'Set Text Style',
      description:
        'Set typography properties on a text node: letter spacing, line height, paragraph spacing, text case, decoration, and alignment.',
      promptSnippet:
        'figma_set_text_style: set typography (letterSpacing, lineHeight, textCase, textDecoration, alignment)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Text node ID' }),
        letterSpacing: Type.Optional(Type.Number({ description: 'Letter spacing in pixels' })),
        lineHeight: Type.Optional(Type.Number({ description: 'Line height in pixels' })),
        paragraphSpacing: Type.Optional(Type.Number({ description: 'Paragraph spacing in pixels' })),
        textCase: Type.Optional(
          StringEnum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'] as const, { description: 'Text case transform' }),
        ),
        textDecoration: Type.Optional(
          StringEnum(['NONE', 'UNDERLINE', 'STRIKETHROUGH'] as const, { description: 'Text decoration' }),
        ),
        textAlignHorizontal: Type.Optional(
          StringEnum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'] as const, { description: 'Horizontal alignment' }),
        ),
        textAlignVertical: Type.Optional(
          StringEnum(['TOP', 'CENTER', 'BOTTOM'] as const, { description: 'Vertical alignment' }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setTextStyle(params.nodeId, params);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_effects',
      label: 'Set Effects',
      description:
        'Set effects (shadows and blurs) on a node. Supports DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, and BACKGROUND_BLUR.',
      promptSnippet: 'figma_set_effects: set shadows and blurs on a node',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        effects: Type.Array(
          Type.Object({
            type: StringEnum(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'] as const, {
              description: 'Effect type',
            }),
            color: Type.Optional(Type.String({ description: 'Hex color (for shadows)' })),
            offsetX: Type.Optional(Type.Number({ description: 'X offset in pixels (for shadows)' })),
            offsetY: Type.Optional(Type.Number({ description: 'Y offset in pixels (for shadows)' })),
            radius: Type.Number({ description: 'Blur radius in pixels' }),
            spread: Type.Optional(Type.Number({ description: 'Spread radius (for shadows)' })),
            visible: Type.Optional(Type.Boolean({ description: 'Whether effect is visible (default: true)' })),
          }),
          { description: 'Array of effects to apply (replaces existing effects)' },
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setEffects(params.nodeId, params.effects);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_opacity',
      label: 'Set Opacity',
      description: 'Set the opacity of a node (0 = fully transparent, 1 = fully opaque).',
      promptSnippet: 'figma_set_opacity: set node opacity (0-1)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        opacity: Type.Number({ description: 'Opacity value from 0 (transparent) to 1 (opaque)' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setOpacity(params.nodeId, params.opacity);
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_set_corner_radius',
      label: 'Set Corner Radius',
      description: 'Set corner radius on a node. Use uniform radius for all corners, or set individual corners.',
      promptSnippet: 'figma_set_corner_radius: set corner radius (uniform or per-corner)',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        radius: Type.Optional(Type.Number({ description: 'Uniform radius for all corners' })),
        topLeft: Type.Optional(Type.Number({ description: 'Top-left corner radius' })),
        topRight: Type.Optional(Type.Number({ description: 'Top-right corner radius' })),
        bottomLeft: Type.Optional(Type.Number({ description: 'Bottom-left corner radius' })),
        bottomRight: Type.Optional(Type.Number({ description: 'Bottom-right corner radius' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.setCornerRadius(params.nodeId, params);
          return textResult(result);
        });
      },
    },
  ];
}
