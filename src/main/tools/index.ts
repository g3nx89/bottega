import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { FigmaAPI } from '../../figma/figma-api.js';
import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import type { FigmaWebSocketServer } from '../../figma/websocket-server.js';
import type { CompressionConfigManager } from '../compression/compression-config.js';
import type { DesignSystemCache } from '../compression/design-system-cache.js';
import { toYaml } from '../compression/yaml-emitter.js';

const log = createChildLogger({ component: 'tool' });

import type { ImageGenerator } from '../image-gen/image-generator.js';
import type { OperationQueue } from '../operation-queue.js';
import { createAnnotationTools } from './annotations.js';
import { createBatchTools } from './batch.js';
import { createComponentTools } from './components.js';
import { createCoreTools } from './core.js';
import { createDiscoveryTools } from './discovery.js';
import { createDsPageTools } from './ds-page.js';
import { createImageGenTools } from './image-gen.js';
import { createJsxRenderTools } from './jsx-render.js';
import { createLayoutTools } from './layout.js';
import { createLayoutSizingTools } from './layout-sizing.js';
import { createLintTools } from './lint.js';
import { createManipulationTools } from './manipulation.js';
import { createStyleTools } from './style.js';
import { createTokenTools } from './tokens.js';

export interface ToolDeps {
  connector: IFigmaConnector;
  figmaAPI: FigmaAPI;
  operationQueue: OperationQueue;
  wsServer: FigmaWebSocketServer;
  getImageGenerator?: () => ImageGenerator | null;
  designSystemCache: DesignSystemCache;
  configManager: CompressionConfigManager;
  /** File key for cache scoping in multi-tab (UNBOUND_FILE_KEY for tabs without a file). */
  fileKey: string;
  /** Returns the current AI provider ('anthropic' | 'openai' | 'google' etc). Used for model-aware screenshot optimization. */
  getProvider?: () => string;
}

/** Standard text result wrapper — avoids repeating the same shape in every tool. */
export function textResult(data: unknown, format: 'json' | 'yaml' = 'json') {
  let text: string;
  try {
    text = format === 'yaml' ? toYaml(data) : JSON.stringify(data);
  } catch {
    text = `[Serialization error] ${String(data)}`;
  }
  return { content: [{ type: 'text' as const, text }], details: {} };
}

const QA_RECORDING = process.env.BOTTEGA_QA_RECORDING === '1';

/** Truncate large values for logging (code, JSX, SVG, base64). */
function sanitizeForLog(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 200) {
      clean[k] = `[${v.length} chars]`;
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/** Extract a short text preview from tool result content. */
function resultPreview(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const content = (result as any).content;
  if (!Array.isArray(content)) return undefined;
  const textPart = content.find((c: any) => c.type === 'text');
  const text = textPart?.text;
  return typeof text === 'string' ? text.slice(0, 200) : undefined;
}

/** Wrap tool execute to check abort signal before running. */
export function withAbortCheck(tool: ToolDefinition): ToolDefinition {
  const original = tool.execute;
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      if (!QA_RECORDING) {
        return original.call(tool, toolCallId, params, signal, onUpdate, ctx);
      }
      const start = Date.now();
      log.info({ toolName: tool.name, params: sanitizeForLog(params) }, 'Tool call started');
      try {
        const result = await original.call(tool, toolCallId, params, signal, onUpdate, ctx);
        log.info(
          { toolName: tool.name, durationMs: Date.now() - start, resultPreview: resultPreview(result) },
          'Tool call completed',
        );
        return result;
      } catch (err: unknown) {
        log.error({ toolName: tool.name, durationMs: Date.now() - start, err }, 'Tool call failed');
        throw err;
      }
    },
  };
}

export function createFigmaTools(deps: ToolDeps): ToolDefinition[] {
  const tools = [
    ...createCoreTools(deps),
    ...createDiscoveryTools(deps),
    ...createComponentTools(deps),
    ...createBatchTools(deps),
    ...createManipulationTools(deps),
    ...createTokenTools(deps),
    ...createLintTools(deps),
    ...createDsPageTools(deps),
    ...createLayoutTools(deps),
    ...createLayoutSizingTools(deps),
    ...createStyleTools(deps),
    ...createJsxRenderTools(deps),
    ...createAnnotationTools(deps),
    ...(deps.getImageGenerator ? createImageGenTools(deps) : []),
  ];
  return tools.map(withAbortCheck);
}
