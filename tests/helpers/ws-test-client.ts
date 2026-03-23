import WebSocket from 'ws';

/**
 * Test helper that connects to the FigmaWebSocketServer,
 * sends FILE_INFO for identification, and can respond to commands.
 */
export class WsTestClient {
  ws: WebSocket | null = null;
  private received: any[] = [];
  private commandHandlers = new Map<string, (params: any) => any>();

  async connect(port: number, fileKey: string, fileName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${port}`);
      this.ws.on('open', () => {
        // Identify this client
        this.ws!.send(
          JSON.stringify({
            type: 'FILE_INFO',
            data: { fileKey, fileName, currentPage: 'Page 1' },
          }),
        );
        // Give the server a tick to process FILE_INFO
        setTimeout(resolve, 50);
      });
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.received.push(msg);
          // Auto-respond to commands if handler registered
          if (msg.id && msg.method) {
            const handler = this.commandHandlers.get(msg.method);
            if (handler) {
              const result = handler(msg.params);
              this.ws!.send(JSON.stringify({ id: msg.id, result }));
            }
          }
        } catch {
          /* ignore non-JSON */
        }
      });
    });
  }

  /** Register an auto-responder for a specific command method */
  onCommand(method: string, handler: (params: any) => any): void {
    this.commandHandlers.set(method, handler);
  }

  /** Send a raw message to the server */
  send(message: any): void {
    this.ws?.send(JSON.stringify(message));
  }

  /** Send a simulated event (SELECTION_CHANGE, PAGE_CHANGE, etc.) */
  sendEvent(type: string, data: any): void {
    this.send({ type, data });
  }

  /** Get all received messages */
  getReceived(): any[] {
    return [...this.received];
  }

  /** Close the connection */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.on('close', () => resolve());
      this.ws.close();
    });
  }
}
