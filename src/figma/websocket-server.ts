/**
 * WebSocket Bridge Server (Multi-Client)
 *
 * Creates a WebSocket server that multiple Desktop Bridge plugin instances connect to.
 * Each instance represents a different Figma file and is identified by its fileKey
 * (sent via FILE_INFO on connection). Per-file state (selection, document changes,
 * console logs) is maintained independently.
 *
 * Active file tracking: The "active" file is automatically switched when the user
 * interacts with a file (selection/page changes) or can be set explicitly via
 * setActiveFile(). All backward-compatible getters return data from the active file.
 *
 * Data flow: Main Process ←WebSocket→ ui.html ←postMessage→ code.js ←figma.*→ Figma
 */

import { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
import { PLUGIN_PROTOCOL_VERSION } from '../shared/plugin-protocol.js';
import { createChildLogger } from './logger.js';
import type { ConsoleLogEntry } from './types.js';

const logger = createChildLogger({ component: 'websocket-server' });

/**
 * Minimum plugin version this server accepts.
 * Re-exported from the shared protocol module so main-process code can
 * import from here as before; the authoritative source is
 * `src/shared/plugin-protocol.ts`, which must stay in sync with
 * `figma-desktop-bridge/ui.html#PLUGIN_VERSION`.
 */
export const REQUIRED_PLUGIN_VERSION = PLUGIN_PROTOCOL_VERSION;

/** WebSocket close code for version-incompatible plugins (RFC 6455 private-use range 4000-4999). */
const WS_CLOSE_VERSION_MISMATCH = 4001;

/**
 * Timeout constants for WebSocket command/response correlation.
 *
 * Invariant: COMMAND_DEFAULT < STALL_DETECTION < REFRESH_VARIABLES.
 * The bridge (figma-desktop-bridge/ui.html) hardcodes the same values —
 * keep them aligned or the server and client disagree on stall detection.
 */
export const WS_FAST_RPC_TIMEOUT_MS = 5_000;
export const WS_MEDIUM_RPC_TIMEOUT_MS = 10_000;
export const WS_COMMAND_DEFAULT_TIMEOUT_MS = 15_000;
export const WS_STALL_DETECTION_MS = 30_000;
export const WS_HEAVY_RPC_TIMEOUT_MS = 45_000;
export const WS_BATCH_TIMEOUT_MS = 60_000;
export const WS_REFRESH_VARIABLES_TIMEOUT_MS = 300_000;

export interface WebSocketServerOptions {
  port: number;
  host?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  method: string;
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
  targetFileKey: string;
}

export interface ConnectedFileInfo {
  fileName: string;
  fileKey: string | null;
  currentPage?: string;
  currentPageId?: string;
  pluginVersion: number;
  connectedAt: number;
}

export interface SelectionInfo {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    width?: number;
    height?: number;
  }>;
  count: number;
  page: string;
  timestamp: number;
}

export interface DocumentChangeEntry {
  hasStyleChanges: boolean;
  hasNodeChanges: boolean;
  changedNodeIds: string[];
  changeCount: number;
  timestamp: number;
}

/**
 * Per-file client connection state.
 * Each Figma file with the Desktop Bridge plugin open gets its own ClientConnection.
 */
export interface ClientConnection {
  ws: WebSocket;
  fileInfo: ConnectedFileInfo;
  selection: SelectionInfo | null;
  documentChanges: DocumentChangeEntry[];
  consoleLogs: ConsoleLogEntry[];
  lastActivity: number;
  gracePeriodTimer: ReturnType<typeof setTimeout> | null;
}

export class FigmaWebSocketServer extends EventEmitter {
  private wss: WSServer | null = null;
  /** Named clients indexed by fileKey — each represents a connected Figma file */
  private clients: Map<string, ClientConnection> = new Map();
  /** Clients awaiting FILE_INFO identification, mapped to their pending timeout */
  private _pendingClients: Map<WebSocket, ReturnType<typeof setTimeout>> = new Map();
  /** The fileKey of the currently active (targeted) file */
  private _activeFileKey: string | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter = 0;
  private options: WebSocketServerOptions;
  private _isStarted = false;
  private consoleBufferSize = 1000;
  private documentChangeBufferSize = 200;

  constructor(options: WebSocketServerOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this._isStarted) return;

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WSServer({
          port: this.options.port,
          host: this.options.host || 'localhost',
          maxPayload: 100 * 1024 * 1024, // 100MB — screenshots and large component data can be big
          verifyClient: (info, callback) => {
            // Mitigate Cross-Site WebSocket Hijacking (CSWSH):
            // Reject connections from unexpected browser origins.
            const origin = info.origin;
            let allowed =
              !origin || // No origin — local process (e.g. Node.js client)
              origin === 'null'; // Sandboxed iframe / Figma Desktop plugin UI
            if (!allowed && origin) {
              try {
                const hostname = new URL(origin).hostname;
                allowed = hostname === 'www.figma.com' || hostname === 'figma.com';
              } catch {
                allowed = false;
              }
            }
            if (allowed) {
              callback(true);
            } else {
              logger.warn({ origin }, 'Rejected WebSocket connection from unauthorized origin');
              callback(false, 403, 'Unauthorized Origin');
            }
          },
        });

        this.wss.on('listening', () => {
          this._isStarted = true;
          logger.info(
            { port: this.options.port, host: this.options.host || 'localhost' },
            'WebSocket bridge server started',
          );
          resolve();
        });

        this.wss.on('error', (error: any) => {
          if (!this._isStarted) {
            reject(error);
          } else {
            logger.error({ error }, 'WebSocket server error');
          }
        });

        this.wss.on('connection', (ws: WebSocket) => {
          // Add to pending until FILE_INFO identifies the file
          const pendingTimeout = setTimeout(() => {
            if (this._pendingClients.has(ws)) {
              this._pendingClients.delete(ws);
              logger.warn('Pending WebSocket client timed out without sending FILE_INFO');
              ws.close(1000, 'File identification timeout');
            }
          }, WS_STALL_DETECTION_MS);
          this._pendingClients.set(ws, pendingTimeout);

          logger.info(
            { totalClients: this.clients.size, pendingClients: this._pendingClients.size },
            'New WebSocket connection (pending file identification)',
          );

          ws.on('message', (data: import('ws').RawData) => {
            try {
              let text: string;
              if (typeof data === 'string') {
                text = data;
              } else if (Buffer.isBuffer(data)) {
                text = data.toString();
              } else if (Array.isArray(data)) {
                text = Buffer.concat(data).toString();
              } else {
                text = Buffer.from(data as ArrayBuffer).toString();
              }
              const message = JSON.parse(text);
              this.handleMessage(message, ws);
            } catch (error) {
              logger.error({ error }, 'Failed to parse WebSocket message');
            }
          });

          ws.on('close', (code: number, reason: Buffer) => {
            this.handleClientDisconnect(ws, code, reason.toString());
          });

          ws.on('error', (error: any) => {
            logger.error({ error }, 'WebSocket client error');
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Find a named client connection by its WebSocket reference
   */
  private findClientByWs(ws: WebSocket): { fileKey: string; client: ClientConnection } | null {
    for (const [fileKey, client] of this.clients) {
      if (client.ws === ws) return { fileKey, client };
    }
    return null;
  }

  /**
   * Handle incoming message from a plugin UI WebSocket connection
   */
  private handleMessage(message: any, ws: WebSocket): void {
    // Response to a command we sent
    if (message.id && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    // Unsolicited data from plugin (FILE_INFO, events, forwarded data)
    if (message.type) {
      // Progress updates from long-running operations — reset timeout without resolving
      if (message.type === 'OPERATION_PROGRESS' && message.data) {
        const { operationId } = message.data;
        if (operationId && this.pendingRequests.has(operationId)) {
          const pending = this.pendingRequests.get(operationId)!;
          clearTimeout(pending.timeoutId);
          pending.timeoutId = setTimeout(() => {
            if (this.pendingRequests.has(operationId)) {
              this.pendingRequests.delete(operationId);
              pending.reject(new Error(`Operation ${pending.method} timed out (no progress for 30s)`));
            }
          }, WS_STALL_DETECTION_MS);
          this.emit('operationProgress', message.data);
        }
        return;
      }

      // FILE_INFO promotes pending clients to named clients
      if (message.type === 'FILE_INFO' && message.data) {
        this.handleFileInfo(message.data, ws);
      }

      // Buffer document changes for the specific file
      if (message.type === 'DOCUMENT_CHANGE' && message.data) {
        const found = this.findClientByWs(ws);
        if (found) {
          const entry: DocumentChangeEntry = {
            hasStyleChanges: message.data.hasStyleChanges,
            hasNodeChanges: message.data.hasNodeChanges,
            changedNodeIds: message.data.changedNodeIds || [],
            changeCount: message.data.changeCount || 0,
            timestamp: message.data.timestamp || Date.now(),
          };
          found.client.documentChanges.push(entry);
          if (found.client.documentChanges.length > this.documentChangeBufferSize) {
            found.client.documentChanges.shift();
          }
          found.client.lastActivity = Date.now();
        }
        this.emit('documentChange', { fileKey: found?.fileKey ?? null, ...message.data });
      }

      // Track selection changes — user interaction makes this the active file
      if (message.type === 'SELECTION_CHANGE' && message.data) {
        const found = this.findClientByWs(ws);
        if (found) {
          found.client.selection = message.data as SelectionInfo;
          found.client.lastActivity = Date.now();
          this._activeFileKey = found.fileKey;
        }
        this.emit('selectionChange', { fileKey: found?.fileKey ?? null, ...message.data });
      }

      // Track page changes — user interaction makes this the active file
      if (message.type === 'PAGE_CHANGE' && message.data) {
        const found = this.findClientByWs(ws);
        if (found) {
          found.client.fileInfo.currentPage = message.data.pageName;
          found.client.fileInfo.currentPageId = message.data.pageId || null;
          found.client.lastActivity = Date.now();
          this._activeFileKey = found.fileKey;
        }
        this.emit('pageChange', { fileKey: found?.fileKey ?? null, ...message.data });
      }

      // Capture console logs for the specific file
      if (message.type === 'CONSOLE_CAPTURE' && message.data) {
        const found = this.findClientByWs(ws);
        const data = message.data;
        const entry: ConsoleLogEntry = {
          timestamp: data.timestamp || Date.now(),
          level: data.level || 'log',
          message: typeof data.message === 'string' ? data.message.substring(0, 1000) : String(data.message),
          args: Array.isArray(data.args) ? data.args.slice(0, 10) : [],
          source: 'plugin',
        };
        if (found) {
          found.client.consoleLogs.push(entry);
          if (found.client.consoleLogs.length > this.consoleBufferSize) {
            found.client.consoleLogs.shift();
          }
          found.client.lastActivity = Date.now();
        }
        this.emit('consoleLog', entry);
      }

      this.emit('pluginMessage', message);
      return;
    }

    logger.debug({ message }, 'Unhandled WebSocket message');
  }

  /**
   * Handle FILE_INFO message — promotes pending clients to named clients.
   */
  private handleFileInfo(data: any, ws: WebSocket): void {
    const fileKey = data.fileKey || null;

    if (!fileKey) {
      logger.warn('FILE_INFO received without fileKey — client remains pending');
      return;
    }

    // Version check — reject before mutating any state
    const pluginVersion: number | undefined = data.pluginVersion;
    if (!pluginVersion || pluginVersion < REQUIRED_PLUGIN_VERSION) {
      const effectiveVersion = pluginVersion ?? 0;
      const reason = !pluginVersion
        ? 'Plugin version missing (legacy plugin)'
        : `Plugin version ${pluginVersion} < required ${REQUIRED_PLUGIN_VERSION}`;
      logger.warn({ fileKey, pluginVersion: effectiveVersion, required: REQUIRED_PLUGIN_VERSION }, reason);

      // Notify plugin before closing
      try {
        ws.send(
          JSON.stringify({
            type: 'VERSION_MISMATCH',
            data: {
              pluginVersion: effectiveVersion,
              requiredVersion: REQUIRED_PLUGIN_VERSION,
              message: 'Plugin updated. Close and re-run Bottega Bridge from Plugins → Development.',
            },
          }),
        );
      } catch {
        /* ws may already be closing */
      }

      // Clean up pending state
      const pt = this._pendingClients.get(ws);
      if (pt) {
        clearTimeout(pt);
        this._pendingClients.delete(ws);
      }

      this.emit('versionMismatch', {
        fileKey,
        pluginVersion: effectiveVersion,
        requiredVersion: REQUIRED_PLUGIN_VERSION,
      });

      ws.close(WS_CLOSE_VERSION_MISMATCH, 'Plugin version incompatible');
      return;
    }

    // Remove from pending clients (cancel identification timeout)
    const pendingTimeout = this._pendingClients.get(ws);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this._pendingClients.delete(ws);
    }

    // Check if this ws was already registered under a different fileKey
    const previousEntry = this.findClientByWs(ws);
    if (previousEntry && previousEntry.fileKey !== fileKey) {
      this.clients.delete(previousEntry.fileKey);
      if (this._activeFileKey === previousEntry.fileKey) {
        this._activeFileKey = null;
      }
      logger.info({ oldFileKey: previousEntry.fileKey, newFileKey: fileKey }, 'WebSocket client switched files');
    }

    // If same fileKey already connected with a DIFFERENT ws, clean up old connection
    const existing = this.clients.get(fileKey);
    if (existing && existing.ws !== ws) {
      logger.info({ fileKey }, 'Replacing existing connection for same file');
      if (existing.gracePeriodTimer) {
        clearTimeout(existing.gracePeriodTimer);
      }
      this.rejectPendingRequestsForFile(fileKey, 'Connection replaced by same file reconnection');
      if (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING) {
        existing.ws.close(1000, 'Replaced by same file reconnection');
      }
    }

    // Create client connection (preserve per-file state from previous connection of same file)
    this.clients.set(fileKey, {
      ws,
      fileInfo: {
        fileName: data.fileName,
        fileKey,
        currentPage: data.currentPage,
        currentPageId: data.currentPageId || null,
        pluginVersion,
        connectedAt: Date.now(),
      },
      selection: existing?.selection || null,
      documentChanges: existing?.documentChanges || [],
      consoleLogs: existing?.consoleLogs || [],
      lastActivity: Date.now(),
      gracePeriodTimer: null,
    });

    this._activeFileKey = fileKey;

    logger.info(
      {
        fileName: data.fileName,
        fileKey,
        totalClients: this.clients.size,
        isActive: this._activeFileKey === fileKey,
      },
      'File connected via WebSocket',
    );

    this.emit('connected');
    this.emit('fileConnected', { fileKey, fileName: data.fileName });
  }

  /**
   * Handle a client WebSocket disconnecting.
   */
  private handleClientDisconnect(ws: WebSocket, code: number, reason: string): void {
    // Check if it was a pending client (never identified itself)
    const pendingTimeout = this._pendingClients.get(ws);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this._pendingClients.delete(ws);
      logger.info('Pending WebSocket client disconnected before file identification');
      this.emit('disconnected');
      return;
    }

    // Find which named client this belongs to
    const found = this.findClientByWs(ws);
    if (!found) {
      if (code === WS_CLOSE_VERSION_MISMATCH) {
        // Version-rejected client — versionMismatch event already emitted, suppress disconnected
        return;
      }
      logger.debug('Unknown WebSocket client disconnected');
      this.emit('disconnected');
      return;
    }

    const { fileKey, client } = found;
    logger.info({ fileKey, fileName: client.fileInfo.fileName, code, reason }, 'File disconnected from WebSocket');

    // Start grace period — keep state but clean up if not reconnected
    client.gracePeriodTimer = setTimeout(() => {
      client.gracePeriodTimer = null;
      const current = this.clients.get(fileKey);
      if (current && current.ws === ws) {
        this.clients.delete(fileKey);
        this.rejectPendingRequestsForFile(fileKey, 'WebSocket client disconnected');

        if (this._activeFileKey === fileKey) {
          this._activeFileKey = null;
          for (const [fk, c] of this.clients) {
            if (c.ws.readyState === WebSocket.OPEN) {
              this._activeFileKey = fk;
              break;
            }
          }
        }

        this.emit('fileDisconnected', { fileKey, fileName: client.fileInfo.fileName });
      }
    }, 5000);

    this.emit('disconnected');
  }

  /**
   * Send a command to a plugin UI and wait for the response.
   * By default targets the active file. Pass targetFileKey to target a specific file.
   */
  sendCommand(
    method: string,
    params: Record<string, any> = {},
    timeoutMs: number = WS_COMMAND_DEFAULT_TIMEOUT_MS,
    targetFileKey?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const fileKey = targetFileKey || this._activeFileKey;

      if (!fileKey) {
        reject(new Error('No active file connected. Make sure the Desktop Bridge plugin is open in Figma.'));
        return;
      }

      const client = this.clients.get(fileKey);
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('No WebSocket client connected. Make sure the Desktop Bridge plugin is open in Figma.'));
        return;
      }

      const id = `ws_${++this.requestIdCounter}_${Date.now()}`;

      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`WebSocket command ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        method,
        timeoutId,
        createdAt: Date.now(),
        targetFileKey: fileKey,
      });

      const message = JSON.stringify({ id, method, params });
      try {
        client.ws.send(message);
      } catch (sendError) {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Failed to send WebSocket command ${method}: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
          ),
        );
        return;
      }
      client.lastActivity = Date.now();

      logger.debug({ id, method, fileKey }, 'Sent WebSocket command');
    });
  }

  /**
   * Check if any named client is connected (transport availability check)
   */
  isClientConnected(): boolean {
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether the server has been started
   */
  isStarted(): boolean {
    return this._isStarted;
  }

  /**
   * Get the bound address info (port, host, family).
   */
  address(): import('net').AddressInfo | null {
    if (!this.wss) return null;
    const addr = this.wss.address();
    if (typeof addr === 'string') return null;
    return addr as import('net').AddressInfo;
  }

  // ============================================================================
  // Active file getters (backward compatible — return active file's state)
  // ============================================================================

  getConnectedFileInfo(): ConnectedFileInfo | null {
    if (!this._activeFileKey) return null;
    const client = this.clients.get(this._activeFileKey);
    return client?.fileInfo || null;
  }

  getCurrentSelection(): SelectionInfo | null {
    if (!this._activeFileKey) return null;
    const client = this.clients.get(this._activeFileKey);
    return client?.selection || null;
  }

  getDocumentChanges(options?: { count?: number; since?: number }): DocumentChangeEntry[] {
    if (!this._activeFileKey) return [];
    const client = this.clients.get(this._activeFileKey);
    if (!client) return [];

    let filtered = [...client.documentChanges];

    if (options?.since !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= options.since!);
    }

    if (options?.count !== undefined && options.count > 0) {
      filtered = filtered.slice(-options.count);
    }

    return filtered;
  }

  clearDocumentChanges(): number {
    if (!this._activeFileKey) return 0;
    const client = this.clients.get(this._activeFileKey);
    if (!client) return 0;
    const count = client.documentChanges.length;
    client.documentChanges = [];
    return count;
  }

  getConsoleLogs(options?: {
    count?: number;
    level?: ConsoleLogEntry['level'] | 'all';
    since?: number;
  }): ConsoleLogEntry[] {
    if (!this._activeFileKey) return [];
    const client = this.clients.get(this._activeFileKey);
    if (!client) return [];

    let filtered = [...client.consoleLogs];

    if (options?.since !== undefined) {
      filtered = filtered.filter((log) => log.timestamp >= options.since!);
    }

    if (options?.level && options.level !== 'all') {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options?.count !== undefined && options.count > 0) {
      filtered = filtered.slice(-options.count);
    }

    return filtered;
  }

  clearConsoleLogs(): number {
    if (!this._activeFileKey) return 0;
    const client = this.clients.get(this._activeFileKey);
    if (!client) return 0;
    const count = client.consoleLogs.length;
    client.consoleLogs = [];
    return count;
  }

  getConsoleStatus() {
    const client = this._activeFileKey ? this.clients.get(this._activeFileKey) : null;
    const logs = client?.consoleLogs || [];

    return {
      isMonitoring: !!(client && client.ws.readyState === WebSocket.OPEN),
      anyClientConnected: this.isClientConnected(),
      logCount: logs.length,
      bufferSize: this.consoleBufferSize,
      workerCount: 0,
      oldestTimestamp: logs[0]?.timestamp,
      newestTimestamp: logs[logs.length - 1]?.timestamp,
    };
  }

  // ============================================================================
  // Multi-client methods
  // ============================================================================

  /**
   * Returns true if the given fileKey has an OPEN websocket client.
   * Used by ScopedConnector for fail-fast precheck — avoids waiting the full
   * timeout (60-120s) when the Bridge plugin is not running for the slot's file.
   */
  isFileConnected(fileKey: string): boolean {
    const client = this.clients.get(fileKey);
    return !!client && client.ws.readyState === WebSocket.OPEN;
  }

  getConnectedFiles(): (ConnectedFileInfo & { isActive: boolean })[] {
    const files: (ConnectedFileInfo & { isActive: boolean })[] = [];
    for (const [fileKey, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        files.push({
          ...client.fileInfo,
          isActive: fileKey === this._activeFileKey,
        });
      }
    }
    return files;
  }

  setActiveFile(fileKey: string): boolean {
    const client = this.clients.get(fileKey);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      this._activeFileKey = fileKey;
      logger.info({ fileKey, fileName: client.fileInfo.fileName }, 'Active file switched');
      this.emit('activeFileChanged', { fileKey, fileName: client.fileInfo.fileName });
      return true;
    }
    return false;
  }

  getActiveFileKey(): string | null {
    return this._activeFileKey;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  private rejectPendingRequestsForFile(fileKey: string, reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.targetFileKey === fileKey) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(reason));
        this.pendingRequests.delete(id);
      }
    }
  }

  private rejectPendingRequests(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  async stop(): Promise<void> {
    for (const [, client] of this.clients) {
      if (client.gracePeriodTimer) {
        clearTimeout(client.gracePeriodTimer);
        client.gracePeriodTimer = null;
      }
    }

    for (const [, timeout] of this._pendingClients) {
      clearTimeout(timeout);
    }
    this._pendingClients.clear();

    this.rejectPendingRequests('WebSocket server shutting down');

    if (this.wss) {
      for (const ws of this.wss.clients) {
        ws.terminate();
      }
    }
    this.clients.clear();
    this._activeFileKey = null;

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          this._isStarted = false;
          logger.info('WebSocket bridge server stopped');
          resolve();
        });
      });
    }

    this._isStarted = false;
  }
}
