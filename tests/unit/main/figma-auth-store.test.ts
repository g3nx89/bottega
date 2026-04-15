/**
 * Unit tests for FigmaAuthStore — encrypted token persistence via safeStorage.
 *
 * The store writes to a tmp dir (unique per test) to avoid touching the real
 * ~/.bottega. Electron's safeStorage is mocked with a reversible Buffer-based
 * cipher so round-trip tests can verify the encrypt→decrypt path.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock electron.safeStorage ─────────────────────────────
// Reversible cipher: reverse the string before base64. Good enough to assert
// that `encryptString` was called and `decryptString` round-trips.
// `vi.hoisted` ensures the mock exists when `vi.mock` runs (hoisting-safe).
const { safeStorageMock } = vi.hoisted(() => ({
  safeStorageMock: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((plain: string) => Buffer.from(plain.split('').reverse().join(''), 'utf-8')),
    decryptString: vi.fn((cipher: Buffer) => cipher.toString('utf-8').split('').reverse().join('')),
  },
}));

vi.mock('electron', () => ({
  safeStorage: safeStorageMock,
}));

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { FigmaAuthStore } from '../../../src/main/figma-auth-store.js';

describe('FigmaAuthStore', () => {
  let tmpDir: string;
  let store: FigmaAuthStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bottega-figma-auth-'));
    store = new FigmaAuthStore(tmpDir);
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
    safeStorageMock.encryptString.mockClear();
    safeStorageMock.decryptString.mockClear();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null before any token is set', () => {
    expect(store.getToken()).toBeNull();
    expect(store.getStatus()).toEqual({
      connected: false,
      encrypted: false,
      userHandle: undefined,
      lastValidatedAt: undefined,
    });
  });

  it('round-trips an encrypted token', async () => {
    await store.setToken('figd_secret123', 'alessandro');

    expect(safeStorageMock.encryptString).toHaveBeenCalledWith('figd_secret123');

    // Fresh store reading from disk — proves persistence works end-to-end.
    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBe('figd_secret123');

    const status = fresh.getStatus();
    expect(status.connected).toBe(true);
    expect(status.encrypted).toBe(true);
    expect(status.userHandle).toBe('alessandro');
    expect(status.lastValidatedAt).toBeTruthy();
  });

  it('persists token as base64 ciphertext, not plaintext', async () => {
    await store.setToken('figd_supersecret', 'alex');
    const raw = readFileSync(path.join(tmpDir, 'figma-auth.json'), 'utf-8');
    expect(raw).not.toContain('figd_supersecret');
    const parsed = JSON.parse(raw);
    expect(parsed.encrypted).toBe(true);
    expect(typeof parsed.token).toBe('string');
    expect(parsed.token.length).toBeGreaterThan(0);
  });

  it('falls back to plaintext when safeStorage is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    await store.setToken('figd_plain', 'anon');

    const raw = readFileSync(path.join(tmpDir, 'figma-auth.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.encrypted).toBe(false);
    expect(parsed.token).toBe('figd_plain');

    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBe('figd_plain');
  });

  it('returns null when encrypted token cannot be decrypted', async () => {
    await store.setToken('figd_realtoken', 'alex');

    // Fresh store + decrypt failure
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });
    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBeNull();
  });

  it('returns null when file is encrypted but safeStorage becomes unavailable', async () => {
    await store.setToken('figd_foo', 'alex');

    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBeNull();
  });

  it('F8: getTokenWithStatus reports decryptFailed=false on success', async () => {
    await store.setToken('figd_ok', 'alex');
    const fresh = new FigmaAuthStore(tmpDir);
    const result = fresh.getTokenWithStatus();
    expect(result).toEqual({ token: 'figd_ok', decryptFailed: false });
  });

  it('F8: getTokenWithStatus reports decryptFailed=true when decrypt throws', async () => {
    await store.setToken('figd_bad', 'alex');
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('keychain locked');
    });
    const fresh = new FigmaAuthStore(tmpDir);
    const result = fresh.getTokenWithStatus();
    expect(result.token).toBeNull();
    expect(result.decryptFailed).toBe(true);
  });

  it('F8: getTokenWithStatus reports decryptFailed=true when safeStorage unavailable', async () => {
    await store.setToken('figd_foo', 'alex');
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getTokenWithStatus()).toEqual({ token: null, decryptFailed: true });
  });

  it('F8: getTokenWithStatus reports no failure when no file exists', () => {
    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getTokenWithStatus()).toEqual({ token: null, decryptFailed: false });
  });

  it('clear() wipes the file from disk', async () => {
    await store.setToken('figd_xyz', 'alex');
    const filePath = path.join(tmpDir, 'figma-auth.json');
    expect(() => readFileSync(filePath)).not.toThrow();

    await store.clear();
    expect(() => readFileSync(filePath)).toThrow();

    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBeNull();
    expect(fresh.getStatus().connected).toBe(false);
  });

  it('clear() is a no-op (not an error) when the file is already gone', async () => {
    // HIGH 3: idempotent — "nothing to unlink" is success, not failure.
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'clear() propagates unlink errors instead of returning false success',
    async () => {
      // HIGH 3: if the underlying unlink fails, the caller MUST be notified so
      // the renderer can surface the failure and keep the UI in sync with disk.
      //
      // On POSIX, removing write permission from the parent directory forces
      // `unlinkSync` to throw EACCES even for the file's owner (the test user).
      // Skipped on Windows where chmod semantics differ.
      await store.setToken('figd_victim', 'alex');
      chmodSync(tmpDir, 0o500);
      try {
        await expect(store.clear()).rejects.toThrow();
      } finally {
        // Restore perms so afterEach can rmSync the directory.
        chmodSync(tmpDir, 0o700);
      }
    },
  );

  it('setToken("") throws — callers must use clear() explicitly', async () => {
    // Contract hardening: "empty token" is never a legal store state.
    await expect(store.setToken('', undefined)).rejects.toThrow(/non-empty/);
  });

  it('setToken overwrites a prior token and bumps lastValidatedAt', async () => {
    await store.setToken('figd_first', 'alex');
    const firstRaw = JSON.parse(readFileSync(path.join(tmpDir, 'figma-auth.json'), 'utf-8')) as {
      token: string;
      lastValidatedAt?: string;
    };

    // Wait 2ms so the ISO timestamp differs deterministically.
    await new Promise((r) => setTimeout(r, 2));

    await store.setToken('figd_second', 'alex');
    const secondRaw = JSON.parse(readFileSync(path.join(tmpDir, 'figma-auth.json'), 'utf-8')) as {
      token: string;
      lastValidatedAt?: string;
    };

    expect(secondRaw.token).not.toBe(firstRaw.token);
    expect(secondRaw.lastValidatedAt).not.toBe(firstRaw.lastValidatedAt);
    expect(safeStorageMock.encryptString).toHaveBeenCalledTimes(2);

    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBe('figd_second');
  });

  it('persists figma-auth.json with 0600 permissions', async () => {
    // Security guarantee — the file contains a plaintext userHandle and
    // (in fallback mode) a plaintext token. Other local users must not read it.
    await store.setToken('figd_sensitive', 'alex');
    const filePath = path.join(tmpDir, 'figma-auth.json');
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('ignores a corrupt figma-auth.json', async () => {
    await store.setToken('figd_ok', 'alex');
    const filePath = path.join(tmpDir, 'figma-auth.json');
    writeFileSync(filePath, '{ this is not valid json', 'utf-8');

    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getToken()).toBeNull();
    expect(fresh.getStatus().connected).toBe(false);
  });

  it('rejects a state file missing the token field (new invariant)', async () => {
    // loadState must reject nonsense states like {encrypted: true} with no token.
    const filePath = path.join(tmpDir, 'figma-auth.json');
    writeFileSync(filePath, JSON.stringify({ encrypted: true, userHandle: 'alex' }), 'utf-8');

    const fresh = new FigmaAuthStore(tmpDir);
    expect(fresh.getStatus()).toEqual({ connected: false, encrypted: false });
    expect(fresh.getToken()).toBeNull();
  });

  it('getStatus() reports connected:false when decryption fails, even if file exists', async () => {
    // HIGH 2: getStatus must mirror getToken's decryption path. Previously it
    // returned connected:true based on file presence, while getToken() returned
    // null, causing the UI to show "Connected" over a dead token.
    await store.setToken('figd_realtoken', 'alex');

    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });
    const fresh = new FigmaAuthStore(tmpDir);
    // Single getStatus call exercises the decrypt path via getToken() internally.
    // Calling getToken() again would consume a second mockImplementationOnce slot
    // (which doesn't exist), causing the test to mask the regression.
    expect(fresh.getStatus().connected).toBe(false);
  });
});
