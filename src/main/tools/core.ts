import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

/**
 * AI vision processing limits per provider (max px on longest side).
 * Beyond this, the provider either downscales (Claude, OpenAI) or
 * tiles into more tokens with diminishing returns (Gemini).
 *
 * Claude:  images > 1568px are resized before tokenization — zero quality gain.
 * OpenAI:  GPT-5.4 "high" mode caps at 2048px, then patches within that budget.
 * Gemini:  no hard cap but tokens scale linearly with area — 1568 balances quality/cost.
 */
const VISION_MAX_DIMENSION: Record<string, number> = {
  anthropic: 1568,
  openai: 2048,
  'openai-codex': 2048,
  google: 1568,
  'google-gemini-cli': 1568,
};
const DEFAULT_VISION_MAX_DIMENSION = 1568;

/** Resolve the AI vision processing ceiling (px) for a given provider. */
export function getVisionMaxDimension(provider: string): number {
  return VISION_MAX_DIMENSION[provider] ?? DEFAULT_VISION_MAX_DIMENSION;
}

export function createCoreTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue, wsServer } = deps;

  return [
    defineTool({
      name: 'figma_execute',
      label: 'Execute Plugin Code',
      description:
        'Execute arbitrary Figma Plugin API code. Use async IIFE pattern. Always call figma.loadFontAsync() before setting text. Set layoutMode before padding. NEVER use for DS operations (tokens, variables, DS page) — use dedicated DS tools.',
      promptSnippet:
        'figma_execute: run arbitrary Plugin API code in Figma (escape hatch — NEVER for DS operations like tokens/variables/DS page)',
      parameters: Type.Object({
        code: Type.String({ description: 'JavaScript code to execute in Figma plugin context' }),
        timeout: Type.Optional(Type.Number({ description: 'Timeout in ms (default: 30000)', default: 30000 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const result = await connector.executeCodeViaUI(params.code, params.timeout ?? 30000);
          return textResult(result);
        });
      },
    }),
    defineTool({
      name: 'figma_screenshot',
      label: 'Screenshot',
      description:
        'Capture a screenshot of the current Figma viewport or a specific node. ALWAYS call after mutations to verify results.',
      promptSnippet: 'figma_screenshot: capture visual screenshot (ALWAYS use after any mutation to verify)',
      parameters: Type.Object({
        nodeId: Type.Optional(
          Type.String({ description: 'Node ID to capture. If omitted, captures current viewport.' }),
        ),
        format: Type.Optional(StringEnum(['PNG', 'JPG'] as const, { default: 'PNG' })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const maxDimension = getVisionMaxDimension(deps.getProvider?.() ?? '');
        const result = await connector.captureScreenshot(params.nodeId ?? '', {
          format: (params.format ?? 'PNG').toUpperCase(),
          maxDimension,
        });
        // Plugin returns { success, image: { base64, format, scale, node, bounds } }
        const base64 = result?.image?.base64 ?? result?.imageData;
        if (base64) {
          const dsCache = deps.designSystemCache?.get(true, deps.fileKey);
          const dsHint = dsCache && 'dsStatus' in dsCache ? (dsCache as any).dsStatus : undefined;
          const content: any[] = [
            {
              type: 'image' as const,
              data: base64,
              mimeType: 'image/png',
            },
          ];
          if (dsHint) {
            content.push({ type: 'text', text: `[dsStatus: ${dsHint}]` });
          }
          return { content, details: {} };
        }
        return textResult(result);
      },
    }),
    defineTool({
      name: 'figma_status',
      label: 'Connection Status',
      description: 'Check the connection status with Figma Desktop and the currently connected file.',
      promptSnippet: 'figma_status: check Figma connection status and connected file info',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const connected = wsServer.isClientConnected();
        const files = wsServer.getConnectedFiles();
        // B-023: Report the file bound to THIS slot (deps.fileKey) instead of the
        // globally-active plugin file. Otherwise Tab B would show Tab A's file name
        // whenever the plugin focus is on a different tab's file.
        const slotFileKey = deps.fileKey;
        const scopedFile = files.find((f) => f.fileKey === slotFileKey);
        const fileInfo = scopedFile ?? wsServer.getConnectedFileInfo();
        const dsCache = deps.designSystemCache.get(true, slotFileKey);
        const dsStatus = dsCache?.dsStatus ?? 'unknown';
        return textResult({ connected, fileInfo, files, dsStatus, slotFileKey });
      },
    }),
    defineTool({
      name: 'figma_get_selection',
      label: 'Get Selection',
      description: 'Get the currently selected nodes in Figma.',
      promptSnippet: 'figma_get_selection: get currently selected nodes',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        // B-023: Only return the selection when it belongs to this slot's file,
        // otherwise Tab B would mirror Tab A's current selection.
        const slotFileKey = deps.fileKey;
        const activeInfo = wsServer.getConnectedFileInfo();
        if (slotFileKey && activeInfo && activeInfo.fileKey !== slotFileKey) {
          return textResult({ nodes: [], note: 'No selection for this tab (plugin focus is on another file).' });
        }
        const selection = wsServer.getCurrentSelection();
        return textResult(selection);
      },
    }),
  ];
}
