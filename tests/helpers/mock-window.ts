import { vi } from 'vitest';

/**
 * Minimal BrowserWindow mock for testing IPC handlers.
 * Provides a controllable `webContents` with `send` spy and `isDestroyed` toggle.
 */
export function createMockWindow() {
  let destroyed = false;

  const webContents = {
    send: vi.fn(),
    isDestroyed: () => destroyed,
  };

  return {
    webContents,
    isAlwaysOnTop: vi.fn().mockReturnValue(false),
    setAlwaysOnTop: vi.fn(),
    setOpacity: vi.fn(),
    /** Simulate webContents destruction (e.g., renderer crash or window close) */
    destroy() {
      destroyed = true;
    },
    /** Reset to alive state */
    revive() {
      destroyed = false;
    },
  };
}
