/**
 * Scoped Figma Connector — pins all commands to a specific fileKey.
 * Extends WebSocketConnector by wrapping the WS server to inject fileKey routing.
 *
 * Correctness invariant: every WebSocketConnector method must route through
 * wsServer.sendCommand() for file-targeted operations. If a future method
 * bypasses sendCommand, it will silently skip file-key scoping.
 */

import { WebSocketConnector } from '../figma/websocket-connector.js';
import type { FigmaWebSocketServer } from '../figma/websocket-server.js';

export class ScopedConnector extends WebSocketConnector {
  private readonly _fileKey: string;

  constructor(wsServer: FigmaWebSocketServer, fileKey: string) {
    // Intercept sendCommand to inject fileKey as the default target.
    // Object.create delegates all other methods (isClientConnected, etc.) to the original.
    const scoped = Object.create(wsServer) as FigmaWebSocketServer;
    scoped.sendCommand = ((
      method: string,
      params: Record<string, any> = {},
      timeoutMs?: number,
      targetFileKey?: string,
    ) => wsServer.sendCommand(method, params, timeoutMs, targetFileKey ?? fileKey)) as typeof wsServer.sendCommand;
    super(scoped);
    this._fileKey = fileKey;
  }

  get fileKey(): string {
    return this._fileKey;
  }
}
