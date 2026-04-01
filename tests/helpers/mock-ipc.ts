import { vi } from 'vitest';

/**
 * Intercepts ipcMain.handle() registrations so tests can invoke handlers directly.
 *
 * Usage:
 *   const ipc = createMockIpc();
 *   // After setupIpcHandlers runs, all handlers are captured:
 *   const result = await ipc.invoke('agent:prompt', 'hello');
 */
export function createMockIpc() {
  const handlers = new Map<string, (...args: any[]) => any>();

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
  };

  return {
    ipcMain: mockIpcMain,
    handlers,
    /** Invoke a registered handler as if the renderer called ipcRenderer.invoke() */
    async invoke(channel: string, ...args: any[]): Promise<any> {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for channel "${channel}"`);
      // First arg to ipcMain.handle callback is the IpcMainInvokeEvent (we pass a stub)
      return handler({ sender: {} } as any, ...args);
    },
  };
}
