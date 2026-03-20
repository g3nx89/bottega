import { ipcMain, type BrowserWindow } from 'electron';

// The actual AgentSession type will come from pi-coding-agent
// For now use a minimal interface matching what we need
export interface AgentSessionLike {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: any) => void): void;
}

export interface FigmaCoreLike {
  isConnected(): boolean;
}

export function setupIpcHandlers(
  session: AgentSessionLike,
  figmaCore: FigmaCoreLike,
  mainWindow: BrowserWindow
) {
  // Subscribe to agent events → forward to renderer
  session.subscribe((event: any) => {
    const wc = mainWindow.webContents;
    switch (event.type) {
      case 'message_update':
        if (event.assistantMessageEvent?.type === 'text_delta') {
          wc.send('agent:text-delta', event.assistantMessageEvent.delta);
        }
        if (event.assistantMessageEvent?.type === 'thinking_delta') {
          wc.send('agent:thinking', event.assistantMessageEvent.delta);
        }
        break;
      case 'tool_execution_start':
        wc.send('agent:tool-start', event.toolName, event.toolCallId);
        break;
      case 'tool_execution_end':
        wc.send('agent:tool-end', event.toolName, event.toolCallId, !event.isError, event.result);
        // Extract screenshot images
        if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
          const imageContent = event.result.content.find((c: any) => c.type === 'image');
          if (imageContent) {
            wc.send('agent:screenshot', imageContent.data);
          }
        }
        break;
      case 'agent_end':
        wc.send('agent:end');
        break;
    }
  });

  // IPC handlers from renderer
  ipcMain.handle('agent:prompt', async (_event, text: string) => {
    await session.prompt(text);
  });

  ipcMain.handle('agent:abort', async () => {
    await session.abort();
  });
}
