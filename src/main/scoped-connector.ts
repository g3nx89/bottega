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
import { MSG_BRIDGE_NOT_CONNECTED } from './messages.js';

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
    ) => {
      // Fail-fast: without this, every WS command waits its full timeout
      // (up to 120s for LINT_DESIGN) when the Bridge plugin isn't running
      // for this slot's file, starving the turn budget. Centralized here so
      // every connector method is covered. Race window between this check
      // and sendCommand is microseconds; sendCommand handles late disconnects.
      // Use || (not ??) so an empty-string targetFileKey falls back to the
      // slot's pinned fileKey, matching how wsServer.sendCommand itself coalesces.
      const target = targetFileKey || fileKey;
      if (!wsServer.isFileConnected(target)) {
        throw new Error(MSG_BRIDGE_NOT_CONNECTED(target));
      }
      return wsServer.sendCommand(method, params, timeoutMs, target);
    }) as typeof wsServer.sendCommand;
    super(scoped);
    this._fileKey = fileKey;
  }

  get fileKey(): string {
    return this._fileKey;
  }
}
