import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { FigmaAPI } from '../../figma/figma-api.js';
import type { IFigmaConnector } from '../../figma/figma-connector.js';
import type { FigmaWebSocketServer } from '../../figma/websocket-server.js';
import type { CompressionConfigManager } from '../compression/compression-config.js';
import type { DesignSystemCache } from '../compression/design-system-cache.js';
import type { ImageGenerator } from '../image-gen/image-generator.js';
import type { OperationQueue } from '../operation-queue.js';
import { createAnnotationTools } from './annotations.js';
import { createBatchTools } from './batch.js';
import { createComponentTools } from './components.js';
import { createCoreTools } from './core.js';
import { createDiscoveryTools } from './discovery.js';
import { createImageGenTools } from './image-gen.js';
import { createJsxRenderTools } from './jsx-render.js';
import { createLayoutTools } from './layout.js';
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
export function textResult(data: unknown) {
  let text: string;
  try {
    text = JSON.stringify(data);
  } catch {
    text = `[Serialization error] ${String(data)}`;
  }
  return { content: [{ type: 'text' as const, text }], details: {} };
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
      return original.call(tool, toolCallId, params, signal, onUpdate, ctx);
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
    ...createLayoutTools(deps),
    ...createStyleTools(deps),
    ...createJsxRenderTools(deps),
    ...createAnnotationTools(deps),
    ...(deps.getImageGenerator ? createImageGenTools(deps) : []),
  ];
  return tools.map(withAbortCheck);
}
