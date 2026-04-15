/**
 * Unit tests for setupFigmaAuthHandlers — IPC handlers that persist a Figma
 * Personal Access Token after validating it via `FigmaAPI.validateToken`.
 *
 * We mock `ipcMain.handle` to capture registered handlers and invoke them
 * directly. `FigmaAPI.validateToken` is mocked per-test so these tests focus
 * on orchestration (persist → apply → emit), not HTTP details (those live in
 * `figma-api.test.ts`).
 */
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────

const handlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
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

vi.mock('../../../src/main/safe-send.js', () => ({
  safeSend: vi.fn(),
}));

// Mock FigmaAPI — keep the real class shape but stub static validateToken
// and instance setAccessToken. All HTTP details are tested in figma-api.test.ts.
// `vi.hoisted` ensures the mock exists when the hoisted `vi.mock` factory runs.
const { validateTokenMock } = vi.hoisted(() => ({
  validateTokenMock: vi.fn(),
}));

vi.mock('../../../src/figma/figma-api.js', () => ({
  FigmaAPI: class {
    static validateToken = validateTokenMock;
    setAccessToken = vi.fn();
  },
}));

import { shell } from 'electron';
import type { FigmaAPI } from '../../../src/figma/figma-api.js';
import type { FigmaAuthStore } from '../../../src/main/figma-auth-store.js';
import { revalidateFigmaAuthOnStartup, setupFigmaAuthHandlers } from '../../../src/main/ipc-handlers-figma-auth.js';
import { safeSend } from '../../../src/main/safe-send.js';

describe('setupFigmaAuthHandlers', () => {
  let figmaAuthStore: FigmaAuthStore & {
    setToken: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    getTokenWithStatus: ReturnType<typeof vi.fn>;
  };
  let figmaAPI: FigmaAPI & { setAccessToken: ReturnType<typeof vi.fn> };
  let mainWindow: BrowserWindow;

  beforeEach(() => {
    handlers.clear();
    validateTokenMock.mockReset();
    figmaAuthStore = {
      setToken: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ connected: false, encrypted: false }),
      getToken: vi.fn().mockReturnValue(null),
      getTokenWithStatus: vi.fn().mockReturnValue({ token: null, decryptFailed: false }),
    } as any;
    figmaAPI = { setAccessToken: vi.fn() } as any;
    mainWindow = { webContents: {} } as any;

    setupFigmaAuthHandlers({ figmaAuthStore, figmaAPI, mainWindow });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function invoke(channel: string, ...args: any[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Handler not registered: ${channel}`);
    return handler({} as any, ...args);
  }

  it('registers all four IPC channels', () => {
    expect(handlers.has('figma-auth:get-status')).toBe(true);
    expect(handlers.has('figma-auth:set-token')).toBe(true);
    expect(handlers.has('figma-auth:clear')).toBe(true);
    expect(handlers.has('figma-auth:open-pat-docs')).toBe(true);
  });

  it('get-status delegates to the store', async () => {
    figmaAuthStore.getStatus.mockReturnValue({ connected: true, encrypted: true, userHandle: 'alex' });
    const result = await invoke('figma-auth:get-status');
    expect(result).toEqual({ connected: true, encrypted: true, userHandle: 'alex' });
  });

  describe('set-token', () => {
    it('validates → persists → updates FigmaAPI → emits status', async () => {
      validateTokenMock.mockResolvedValueOnce({ ok: true, handle: 'alessandro' });

      const result = await invoke('figma-auth:set-token', '  figd_goodtoken  ');

      expect(validateTokenMock).toHaveBeenCalledWith('figd_goodtoken');
      expect(figmaAuthStore.setToken).toHaveBeenCalledWith('figd_goodtoken', 'alessandro');
      expect(figmaAPI.setAccessToken).toHaveBeenCalledWith('figd_goodtoken');
      expect(safeSend).toHaveBeenCalledWith(expect.anything(), 'figma-auth:status-changed', expect.any(Object));
      expect(result).toEqual({ success: true, userHandle: 'alessandro' });
    });

    it('passes only userHandle to setToken, never email (PII regression guard)', async () => {
      // FigmaAPI.validateToken already strips `email` from the return shape,
      // but the handler must not re-read it from elsewhere.
      validateTokenMock.mockResolvedValueOnce({ ok: true, handle: 'alex', email: 'a@b.c' } as any);
      await invoke('figma-auth:set-token', 'figd_x');

      const [, passedHandle] = figmaAuthStore.setToken.mock.calls[0]!;
      expect(passedHandle).toBe('alex');
      // Paranoia: no call argument contains the email string.
      for (const call of figmaAuthStore.setToken.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('a@b.c');
      }
    });

    it('rejects empty / non-string input without calling validateToken', async () => {
      const r1 = await invoke('figma-auth:set-token', '');
      const r2 = await invoke('figma-auth:set-token', '   ');
      const r3 = await invoke('figma-auth:set-token', 42);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(validateTokenMock).not.toHaveBeenCalled();
      expect(figmaAuthStore.setToken).not.toHaveBeenCalled();
    });

    it('does NOT persist on validation failure (401/403)', async () => {
      validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'Invalid token', status: 401 });

      const result = await invoke('figma-auth:set-token', 'figd_bad');

      expect(result).toEqual({ success: false, error: 'Invalid token', status: 401 });
      expect(figmaAuthStore.setToken).not.toHaveBeenCalled();
      expect(figmaAPI.setAccessToken).not.toHaveBeenCalled();
      expect(safeSend).not.toHaveBeenCalled();
    });

    it('surfaces network errors from validateToken', async () => {
      validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'ECONNREFUSED' });
      const result = await invoke('figma-auth:set-token', 'figd_x');
      expect(result).toEqual({ success: false, error: 'ECONNREFUSED' });
      expect(figmaAuthStore.setToken).not.toHaveBeenCalled();
    });

    it('does NOT update FigmaAPI or emit status when store.setToken throws', async () => {
      // Rollback invariant: if persistence fails after a successful validation,
      // runtime state stays put (no divergence) and the renderer sees failure.
      validateTokenMock.mockResolvedValueOnce({ ok: true, handle: 'alex' });
      figmaAuthStore.setToken.mockRejectedValueOnce(new Error('EACCES: cannot write'));

      const result = await invoke('figma-auth:set-token', 'figd_x');

      expect(result).toEqual({ success: false, error: 'EACCES: cannot write' });
      expect(figmaAPI.setAccessToken).not.toHaveBeenCalled();
      expect(safeSend).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('wipes the store, resets FigmaAPI, and emits status on success', async () => {
      const result = await invoke('figma-auth:clear');
      expect(figmaAuthStore.clear).toHaveBeenCalled();
      expect(figmaAPI.setAccessToken).toHaveBeenCalledWith('');
      expect(safeSend).toHaveBeenCalledWith(expect.anything(), 'figma-auth:status-changed', expect.any(Object));
      expect(result).toEqual({ success: true });
    });

    it('does NOT reset FigmaAPI or emit status when store.clear throws', async () => {
      // HIGH 3: the renderer must see success:false when the on-disk clear
      // fails. Runtime state and disk state must stay in sync.
      figmaAuthStore.clear.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const result = await invoke('figma-auth:clear');

      expect(result).toEqual({ success: false, error: 'EACCES' });
      expect(figmaAPI.setAccessToken).not.toHaveBeenCalled();
      expect(safeSend).not.toHaveBeenCalled();
    });
  });

  describe('open-pat-docs', () => {
    it('opens the Figma docs URL externally', async () => {
      await invoke('figma-auth:open-pat-docs');
      expect(shell.openExternal).toHaveBeenCalledWith('https://www.figma.com/developers/api#access-tokens');
    });

    it('swallows shell.openExternal failures without crashing', async () => {
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('No browser'));
      // Handler resolves to void now — must not throw.
      await expect(invoke('figma-auth:open-pat-docs')).resolves.toBeUndefined();
    });
  });

  // ── test-token (added this session) ────────────────
  describe('test-token', () => {
    it('registers the channel', () => {
      expect(handlers.has('figma-auth:test-token')).toBe(true);
    });

    it('returns an error when no token is configured', async () => {
      figmaAuthStore.getStatus.mockReturnValue({ connected: false, encrypted: false });
      const result = await invoke('figma-auth:test-token');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no token/i);
      expect(validateTokenMock).not.toHaveBeenCalled();
    });

    it('returns success + userHandle when the stored token validates', async () => {
      figmaAuthStore.getStatus.mockReturnValue({ connected: true, encrypted: true, userHandle: 'alex' });
      figmaAuthStore.getToken.mockReturnValue('figd_goodtoken');
      validateTokenMock.mockResolvedValueOnce({ ok: true, handle: 'alex' });

      const result = await invoke('figma-auth:test-token');

      expect(validateTokenMock).toHaveBeenCalledWith('figd_goodtoken');
      expect(result).toEqual({ success: true, userHandle: 'alex' });
    });

    it('returns failure with status when Figma rejects the token', async () => {
      figmaAuthStore.getStatus.mockReturnValue({ connected: true, encrypted: true });
      figmaAuthStore.getToken.mockReturnValue('figd_expired');
      validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'Unauthorized', status: 403 });

      const result = await invoke('figma-auth:test-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
      expect(result.status).toBe(403);
    });

    it('returns failure when decryption yielded a null token despite connected status', async () => {
      figmaAuthStore.getStatus.mockReturnValue({ connected: true, encrypted: true });
      figmaAuthStore.getToken.mockReturnValue(null);

      const result = await invoke('figma-auth:test-token');
      expect(result.success).toBe(false);
      expect(validateTokenMock).not.toHaveBeenCalled();
    });
  });
});

describe('revalidateFigmaAuthOnStartup', () => {
  let figmaAuthStore: FigmaAuthStore & {
    clear: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    getTokenWithStatus: ReturnType<typeof vi.fn>;
  };
  let figmaAPI: FigmaAPI & { setAccessToken: ReturnType<typeof vi.fn> };
  let mainWindow: BrowserWindow;

  beforeEach(() => {
    validateTokenMock.mockReset();
    figmaAuthStore = {
      clear: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ connected: true, encrypted: true, userHandle: 'alex' }),
      getToken: vi.fn().mockReturnValue('figd_persisted'),
      getTokenWithStatus: vi.fn().mockReturnValue({ token: 'figd_persisted', decryptFailed: false }),
    } as any;
    figmaAPI = { setAccessToken: vi.fn() } as any;
    mainWindow = { webContents: {} } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when no token is persisted', async () => {
    figmaAuthStore.getStatus.mockReturnValue({ connected: false, encrypted: false });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(validateTokenMock).not.toHaveBeenCalled();
    expect(figmaAuthStore.clear).not.toHaveBeenCalled();
  });

  it('keeps the token when revalidation succeeds', async () => {
    validateTokenMock.mockResolvedValueOnce({ ok: true, handle: 'alex' });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(validateTokenMock).toHaveBeenCalledWith('figd_persisted');
    expect(figmaAuthStore.clear).not.toHaveBeenCalled();
    expect(figmaAPI.setAccessToken).not.toHaveBeenCalled();
  });

  it('clears the token and emits status-changed on 401', async () => {
    validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'Invalid token', status: 401 });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(figmaAuthStore.clear).toHaveBeenCalled();
    expect(figmaAPI.setAccessToken).toHaveBeenCalledWith('');
    expect(safeSend).toHaveBeenCalledWith(expect.anything(), 'figma-auth:status-changed', expect.any(Object));
  });

  it('clears the token and emits status-changed on 403', async () => {
    validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'Invalid token', status: 403 });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(figmaAuthStore.clear).toHaveBeenCalled();
    expect(figmaAPI.setAccessToken).toHaveBeenCalledWith('');
  });

  it('does NOT clear on network errors — user may be offline', async () => {
    validateTokenMock.mockResolvedValueOnce({ ok: false, error: 'ECONNREFUSED' });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(figmaAuthStore.clear).not.toHaveBeenCalled();
    expect(figmaAPI.setAccessToken).not.toHaveBeenCalled();
  });

  it('force-emits status-changed when getStatus says connected but decrypt fails', async () => {
    // Covers the edge case where the store file exists but decryption is broken.
    figmaAuthStore.getToken.mockReturnValue(null);
    figmaAuthStore.getTokenWithStatus.mockReturnValue({ token: null, decryptFailed: true });

    await revalidateFigmaAuthOnStartup({ figmaAuthStore, figmaAPI, mainWindow } as any);

    expect(validateTokenMock).not.toHaveBeenCalled();
    // F8: also emits the figma:token_lost banner signal
    expect(safeSend).toHaveBeenCalledWith(expect.anything(), 'figma:token_lost', expect.any(Object));
    expect(safeSend).toHaveBeenCalledWith(expect.anything(), 'figma-auth:status-changed', expect.any(Object));
  });
});
