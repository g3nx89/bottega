import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { type ToolDeps, textResult } from './index.js';
import { parseJsx } from '../jsx-parser.js';
import { loadIconSvg, resolveIcons } from '../icon-loader.js';

export function createJsxRenderTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_render_jsx',
      label: 'Render JSX',
      description: `Render a JSX tree into Figma nodes. Uses Tailwind-like shorthand props:
- bg="#hex" → fill color
- p/px/py/pt/pr/pb/pl={n} → padding
- rounded={n} → corner radius
- flex="row"|"col" → auto layout
- gap={n} → item spacing
- justify="start|center|end|between" → primary axis
- items="start|center|end" → counter axis
- w={n}/h={n} → fixed dimensions
- grow → fill container
- stroke="#hex" → stroke color
- opacity={n} → opacity (0-1)
- shadow → drop shadow
- name="Layer Name" → node name

For icons, use <Icon name="prefix:name" size={24} />.`,
      promptSnippet: 'figma_render_jsx: create complex UI from JSX with Tailwind-like shorthand (bg, p, flex, rounded, etc.)',
      promptGuidelines: [
        'Use figma_render_jsx for creating complex multi-element layouts. It creates the entire tree in one roundtrip.',
        'Always wrap layouts in a <Frame> with flex="col" or flex="row" for auto layout.',
        'Use <Icon name="mdi:home" /> for icons (Iconify format: prefix:name).',
      ],
      parameters: Type.Object({
        jsx: Type.String({ description: 'JSX string with Tailwind-like shorthand props' }),
        x: Type.Optional(Type.Number({ description: 'X position' })),
        y: Type.Optional(Type.Number({ description: 'Y position' })),
        parentId: Type.Optional(Type.String({ description: 'Parent node ID' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          // 1. Parse JSX → TreeNode
          const tree = parseJsx(params.jsx);

          // 2. Resolve icons: single-pass collect + parallel fetch + in-place replace
          await resolveIcons(tree);

          // 3. Send to plugin via WebSocket
          const result = await connector.createFromJsx(tree, {
            x: params.x,
            y: params.y,
            parentId: params.parentId,
          });
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_create_icon',
      label: 'Create Icon',
      description: 'Create a vector icon node from Iconify. Use format "prefix:name" (e.g. "mdi:home", "lucide:star").',
      promptSnippet: 'figma_create_icon: create a vector icon from Iconify (e.g. "mdi:home", "lucide:star")',
      parameters: Type.Object({
        name: Type.String({ description: 'Iconify icon name (e.g. "mdi:home", "lucide:star")' }),
        size: Type.Optional(Type.Number({ description: 'Icon size in px (default: 24)', default: 24 })),
        color: Type.Optional(Type.String({ description: 'Icon color as hex (default: #000000)', default: '#000000' })),
        x: Type.Optional(Type.Number({ description: 'X position' })),
        y: Type.Optional(Type.Number({ description: 'Y position' })),
        parentId: Type.Optional(Type.String({ description: 'Parent node ID' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const svg = await loadIconSvg(params.name, params.size ?? 24);
          const result = await connector.createIcon(svg, params.size ?? 24, params.color ?? '#000000', {
            x: params.x, y: params.y, parentId: params.parentId,
          });
          return textResult(result);
        });
      },
    },
    {
      name: 'figma_bind_variable',
      label: 'Bind Variable',
      description: 'Link a node fill or stroke to a Figma variable (design token) by name.',
      promptSnippet: 'figma_bind_variable: link a node fill/stroke to a design token variable',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        variableName: Type.String({ description: 'Variable name (e.g. "colors/primary")' }),
        property: Type.Union([Type.Literal('fill'), Type.Literal('stroke')], { description: 'Which property to bind' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          await connector.bindVariable(params.nodeId, params.variableName, params.property);
          return textResult({ success: true });
        });
      },
    },
  ];
}
