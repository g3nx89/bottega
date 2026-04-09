/**
 * FigmaAuthStore — persist a Figma REST API Personal Access Token on disk.
 *
 * Cifratura a riposo via Electron `safeStorage` (Keychain su macOS). Fallback a
 * plaintext con warn log solo se `safeStorage.isEncryptionAvailable()` è falso
 * (raro in Electron su macOS). File permissions 0o600 in ~/.bottega/figma-auth.json.
 *
 * Il file contiene metadata leggibile (`encrypted`, `userHandle`, `lastValidatedAt`)
 * più il token (cifrato base64 oppure plaintext in fallback).
 *
 * Invariants:
 * - A persisted state ALWAYS has a non-empty `token` field. States without a
 *   token are rejected at load time (treated as no file).
 * - `clear()` throws if the underlying unlink fails — callers must not assume
 *   success silently. The IPC handler propagates this to the renderer.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { atomicWriteJsonSync } from './fs-utils.js';

const log = createChildLogger({ component: 'figma-auth-store' });

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.bottega');
const FILE_NAME = 'figma-auth.json';

export interface FigmaAuthState {
  /** Non-empty: encrypted base64 string if safeStorage available, otherwise plaintext. */
  token: string;
  /** True if `token` is Keychain-encrypted (base64 of the ciphertext). */
  encrypted: boolean;
  /** Cached user handle from /v1/me for UI display. */
  userHandle?: string;
  /** ISO timestamp of last successful validation. */
  lastValidatedAt?: string;
}

export interface FigmaAuthStatus {
  connected: boolean;
  encrypted: boolean;
  userHandle?: string;
  lastValidatedAt?: string;
}

export class FigmaAuthStore {
  private readonly filePath: string;

  constructor(configDir?: string) {
    this.filePath = path.join(configDir || DEFAULT_CONFIG_DIR, FILE_NAME);
  }

  /** Load + decrypt. Returns null if no token stored or decryption fails. */
  getToken(): string | null {
    const state = this.loadState();
    if (!state) return null;

    if (state.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('Stored token is encrypted but safeStorage is unavailable — cannot decrypt');
        return null;
      }
      try {
        return safeStorage.decryptString(Buffer.from(state.token, 'base64'));
      } catch (err) {
        log.warn({ err }, 'Failed to decrypt Figma token — treating as absent');
        return null;
      }
    }

    return state.token;
  }

  /**
   * Encrypt (if available) and persist. `token` must be non-empty — callers
   * must call `clear()` explicitly to remove a saved token.
   */
  async setToken(token: string, userHandle?: string): Promise<void> {
    if (!token) {
      throw new Error('FigmaAuthStore.setToken: token must be non-empty (use clear() to remove)');
    }

    const encryptionAvailable = safeStorage.isEncryptionAvailable();
    let storedValue: string;
    let encrypted: boolean;

    if (encryptionAvailable) {
      storedValue = safeStorage.encryptString(token).toString('base64');
      encrypted = true;
    } else {
      log.warn('safeStorage unavailable — persisting Figma token in plaintext (0600 permissions)');
      storedValue = token;
      encrypted = false;
    }

    const state: FigmaAuthState = {
      token: storedValue,
      encrypted,
      userHandle,
      lastValidatedAt: new Date().toISOString(),
    };

    this.writeState(state);
    log.info({ encrypted, hasUserHandle: !!userHandle }, 'Figma auth token saved');
  }

  /**
   * Wipe from disk. Throws if the unlink fails so callers can surface the
   * error to the user instead of reporting false success.
   */
  async clear(): Promise<void> {
    if (!existsSync(this.filePath)) {
      // Already gone — treat as success. `existsSync` itself doesn't throw.
      return;
    }
    try {
      unlinkSync(this.filePath);
      log.info('Figma auth token cleared');
    } catch (err) {
      log.error({ err, path: this.filePath }, 'Failed to remove Figma auth file');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Return UI-safe status (no raw token). Mirrors `getToken()`'s decryption
   * path — `connected: true` means the token is present AND decryptable.
   * If decryption fails, the UI shows "Not connected" even though the file
   * still exists on disk (which is the correct user-facing behavior; they
   * need to re-enter the token).
   */
  getStatus(): FigmaAuthStatus {
    const state = this.loadState();
    if (!state) {
      return { connected: false, encrypted: false };
    }

    // Use getToken() to attempt decryption — ensures connected flag reflects
    // actual usability, not just file presence. HIGH 2 fix.
    const connected = this.getToken() !== null;
    return {
      connected,
      encrypted: state.encrypted,
      userHandle: state.userHandle,
      lastValidatedAt: state.lastValidatedAt,
    };
  }

  // ── private ──────────────────────────────────

  private loadState(): FigmaAuthState | null {
    try {
      if (!existsSync(this.filePath)) return null;
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<FigmaAuthState>;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.encrypted !== 'boolean' ||
        typeof parsed.token !== 'string' ||
        parsed.token.length === 0
      ) {
        log.warn({ path: this.filePath }, 'Invalid figma-auth.json — ignoring');
        return null;
      }
      return parsed as FigmaAuthState;
    } catch (err) {
      log.warn({ err, path: this.filePath }, 'Failed to read figma-auth.json');
      return null;
    }
  }

  private writeState(state: FigmaAuthState): void {
    // Ensure config dir exists with restrictive permissions before writing.
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWriteJsonSync(this.filePath, state);
    try {
      chmodSync(this.filePath, 0o600);
    } catch (err) {
      log.warn({ err }, 'Failed to chmod figma-auth.json to 0600');
    }
  }
}
