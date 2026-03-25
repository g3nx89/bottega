/**
 * Startup guard logic extracted for testability.
 *
 * These pure-ish functions encapsulate the single-instance lock and
 * port-conflict handling decisions. They accept their side-effect
 * dependencies (dialog, app, window) as parameters so they can be
 * unit-tested without an Electron runtime.
 */

import type { BrowserWindow } from 'electron';

/**
 * Handle the `second-instance` event by restoring and focusing the existing window.
 * Safe to call when mainWindow is null (no-op).
 */
export function handleSecondInstance(mainWindow: BrowserWindow | null): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/**
 * Determine whether a startup error is a port conflict (EADDRINUSE).
 * Returns `true` if the error should be shown as a port-in-use dialog.
 */
export function isPortConflict(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
}
