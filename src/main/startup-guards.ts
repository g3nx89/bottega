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

/**
 * F6: Probe Electron's safeStorage at launch.
 * Round-trips a sentinel string to detect keychain corruption or encryption key
 * rotation (e.g. after a macOS keychain reset). Returns a structured status so
 * the caller can log the event and surface a banner when decrypt fails.
 */
export interface KeychainProbeResult {
  available: boolean;
  probeOk: boolean | null;
  reason?: string;
}

/**
 * Classifier helper that replaces the tri-state `boolean | null` gymnastics
 * at call sites. The three mutually-exclusive outcomes of runKeychainProbe:
 *   - `available`: encryption works, round-trip OK.
 *   - `unavailable`: encryption not offered by OS (non-macOS Electron builds).
 *   - `broken`: encryption claimed available but round-trip failed (banner case).
 */
export type KeychainClassification = 'available' | 'unavailable' | 'broken';

export function classifyKeychain(r: KeychainProbeResult): KeychainClassification {
  if (!r.available) return 'unavailable';
  return r.probeOk === false ? 'broken' : 'available';
}

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (buf: Buffer) => string;
}

export function runKeychainProbe(safeStorage: SafeStorageLike): KeychainProbeResult {
  let available: boolean;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch (err) {
    return { available: false, probeOk: null, reason: `isEncryptionAvailable threw: ${(err as Error).message}` };
  }
  if (!available) return { available: false, probeOk: null };
  try {
    const encrypted = safeStorage.encryptString('bottega-probe');
    const decrypted = safeStorage.decryptString(encrypted);
    if (decrypted !== 'bottega-probe') {
      return { available: true, probeOk: false, reason: 'round-trip mismatch' };
    }
    return { available: true, probeOk: true };
  } catch (err) {
    return { available: true, probeOk: false, reason: (err as Error).message };
  }
}
