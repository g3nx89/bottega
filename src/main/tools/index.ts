import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { WebSocketConnector } from '../../figma/websocket-connector.js';
import type { FigmaAPI } from '../../figma/figma-api.js';
import type { OperationQueue } from '../operation-queue.js';
import type { FigmaWebSocketServer } from '../../figma/websocket-server.js';
import { createCoreTools } from './core.js';
import { createDiscoveryTools } from './discovery.js';
import { createComponentTools } from './components.js';
import { createManipulationTools } from './manipulation.js';
import { createTokenTools } from './tokens.js';
import { createJsxRenderTools } from './jsx-render.js';

export interface ToolDeps {
  connector: WebSocketConnector;
  figmaAPI: FigmaAPI;
  operationQueue: OperationQueue;
  wsServer: FigmaWebSocketServer;
}

export function createFigmaTools(deps: ToolDeps): ToolDefinition[] {
  return [
    ...createCoreTools(deps),
    ...createDiscoveryTools(deps),
    ...createComponentTools(deps),
    ...createManipulationTools(deps),
    ...createTokenTools(deps),
    ...createJsxRenderTools(deps),
  ];
}
