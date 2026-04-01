import type { BrowserWindow, WebContents } from 'electron';

/**
 * Prevents crashes when the renderer exits before main finishes cleanup.
 *
 * Guards against two shutdown races:
 * 1. WebContents destroyed between caller's null check and send()
 * 2. BrowserWindow destroyed so that accessing .webContents throws
 *    "Object has been destroyed" before safeSend is even called
 *
 * The try/catch covers both — callers can pass mainWindow.webContents
 * without worrying about the accessor throwing.
 */
export function safeSend(wc: WebContents, channel: string, ...args: any[]): void {
  try {
    if (wc.isDestroyed()) return;
    wc.send(channel, ...args);
  } catch {
    // Window/WebContents destroyed during shutdown — expected, silently ignore
  }
}

/**
 * Get WebContents from a BrowserWindow safely — returns null if destroyed.
 * Use at call sites: `const wc = safeWc(mainWindow); if (wc) safeSend(wc, ...)`
 */
export function safeWc(win: BrowserWindow | null | undefined): WebContents | null {
  try {
    if (!win || win.isDestroyed()) return null;
    return win.webContents;
  } catch {
    return null;
  }
}
