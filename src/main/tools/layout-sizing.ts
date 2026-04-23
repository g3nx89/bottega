import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createLayoutSizingTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    defineTool({
      name: 'figma_set_layout_sizing',
      label: 'Set Layout Sizing',
      description:
        'Set layoutSizingHorizontal and/or layoutSizingVertical on a node. Controls how a child behaves inside an auto-layout parent: FIXED (explicit size), HUG (shrink to content), FILL (expand to fill).',
      promptSnippet:
        'figma_set_layout_sizing: set horizontal/vertical sizing mode (FIXED/HUG/FILL) on a node in auto-layout',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        horizontal: Type.Optional(
          StringEnum(['FIXED', 'HUG', 'FILL'] as const, {
            description: 'Horizontal sizing mode: FIXED, HUG, or FILL',
          }),
        ),
        vertical: Type.Optional(
          StringEnum(['FIXED', 'HUG', 'FILL'] as const, {
            description: 'Vertical sizing mode: FIXED, HUG, or FILL',
          }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const nodeId = params.nodeId.replace(/[^0-9:;]/g, '');
          const horizontal = params.horizontal;
          const vertical = params.vertical;

          if (!horizontal && !vertical) {
            return textResult({ success: false, error: 'At least one of horizontal or vertical must be provided' });
          }

          // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
          const code = `
            return (async () => {
              try {
                const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
                if (!node) {
                  return JSON.stringify({ success: false, error: 'Node not found' });
                }
                if (!('layoutSizingHorizontal' in node)) {
                  return JSON.stringify({ success: false, error: 'Node does not support layout sizing (not in auto-layout?)' });
                }
                ${horizontal ? `node.layoutSizingHorizontal = ${JSON.stringify(horizontal)};` : ''}
                ${vertical ? `node.layoutSizingVertical = ${JSON.stringify(vertical)};` : ''}
                return JSON.stringify({
                  success: true,
                  nodeId: node.id,
                  layoutSizingHorizontal: node.layoutSizingHorizontal,
                  layoutSizingVertical: node.layoutSizingVertical
                });
              } catch (e) {
                return JSON.stringify({ success: false, error: e.message });
              }
            })()
          `;
          const result = await connector.executeCodeViaUI(code, 10000);
          return textResult(typeof result === 'string' ? JSON.parse(result) : result);
        });
      },
    }),
  ];
}
