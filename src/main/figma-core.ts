import { FigmaWebSocketServer } from '../figma/websocket-server.js';
import { WebSocketConnector } from '../figma/websocket-connector.js';
import { FigmaAPI } from '../figma/figma-api.js';

export interface FigmaCore {
  wsServer: FigmaWebSocketServer;
  connector: WebSocketConnector;
  figmaAPI: FigmaAPI;
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}

export async function createFigmaCore(config: { port: number; figmaToken?: string }): Promise<FigmaCore> {
  const wsServer = new FigmaWebSocketServer({ port: config.port });
  const connector = new WebSocketConnector(wsServer);
  const figmaAPI = new FigmaAPI(config.figmaToken);

  return {
    wsServer, connector, figmaAPI,
    async start() { await wsServer.start(); },
    async stop() { await wsServer.stop(); },
    isConnected() { return wsServer.isClientConnected(); }
  };
}
