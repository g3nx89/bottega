import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { ToolDeps } from './index.js';

export function createCoreTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, figmaAPI, operationQueue, wsServer } = deps;

  return [
    {
      name: 'figma_execute',
      label: 'Execute Plugin Code',
      description: 'Execute arbitrary Figma Plugin API code. Use async IIFE pattern. Always call figma.loadFontAsync() before setting text. Set layoutMode before padding.',
      promptSnippet: 'figma_execute: run arbitrary Plugin API code in Figma (escape hatch for anything not covered by other tools)',
      parameters: Type.Object({
        code: Type.String({ description: 'JavaScript code to execute in Figma plugin context' }),
        timeout: Type.Optional(Type.Number({ description: 'Timeout in ms (default: 30000)', default: 30000 })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.executeCodeViaUI(params.code, params.timeout ?? 30000);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        });
      },
    },
    {
      name: 'figma_screenshot',
      label: 'Screenshot',
      description: 'Capture a screenshot of the current Figma viewport or a specific node. ALWAYS call after mutations to verify results.',
      promptSnippet: 'figma_screenshot: capture visual screenshot (ALWAYS use after any mutation to verify)',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Node ID to capture. If omitted, captures current viewport.' })),
        format: Type.Optional(Type.Union([Type.Literal('png'), Type.Literal('jpg')], { default: 'png' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.captureScreenshot(params.nodeId ?? '', {
          format: params.format ?? 'png',
        });
        if (result && result.imageData) {
          return {
            content: [{
              type: 'image' as const,
              data: result.imageData,
              mimeType: 'image/png',
            }],
            details: {},
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
      },
    },
    {
      name: 'figma_screenshot_rest',
      label: 'Screenshot (REST API)',
      description: 'Export a node as an image via the Figma REST API. Requires a file key and node ID.',
      parameters: Type.Object({
        fileKey: Type.String({ description: 'Figma file key' }),
        nodeId: Type.String({ description: 'Node ID to export' }),
        scale: Type.Optional(Type.Number({ description: 'Export scale (default: 2)', default: 2 })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await figmaAPI.getImages(params.fileKey, [params.nodeId], {
          format: 'png',
          scale: params.scale ?? 2,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
      },
    },
    {
      name: 'figma_status',
      label: 'Connection Status',
      description: 'Check the connection status with Figma Desktop and the currently connected file.',
      promptSnippet: 'figma_status: check Figma connection status and connected file info',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const connected = wsServer.isClientConnected();
        const fileInfo = wsServer.getConnectedFileInfo();
        const files = wsServer.getConnectedFiles();
        return {
          content: [{ type: 'text', text: JSON.stringify({ connected, fileInfo, files }) }],
          details: {},
        };
      },
    },
    {
      name: 'figma_get_selection',
      label: 'Get Selection',
      description: 'Get the currently selected nodes in Figma.',
      promptSnippet: 'figma_get_selection: get currently selected nodes',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const selection = wsServer.getCurrentSelection();
        return { content: [{ type: 'text', text: JSON.stringify(selection) }], details: {} };
      },
    },
  ];
}
