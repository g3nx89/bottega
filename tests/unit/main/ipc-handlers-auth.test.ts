/**
 * Tests setupAuthHandlers — covers F4/F5/F7/F11/F20 auth IPC contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ───────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getVersion: vi.fn().mockReturnValue('0.14.1') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

const _touchMeta = vi.fn();
const _removeMeta = vi.fn();
vi.mock('../../../src/main/auth-meta.js', () => ({
  touchMetaEntry: (...args: any[]) => _touchMeta(...args),
  removeMetaEntry: (...args: any[]) => _removeMeta(...args),
}));

const _recordLogout = vi.fn();
vi.mock('../../../src/main/auth-snapshot.js', () => ({
  recordLogout: (...args: any[]) => _recordLogout(...args),
}));

const _refresherRefresh = vi.fn().mockResolvedValue({ outcome: 'ok' });
vi.mock('../../../src/main/auth-refresh.js', () => ({
  AuthRefresher: class {
    refresh = _refresherRefresh;
  },
}));

// Stub agent.js exports consumed by ipc-handlers-auth.
vi.mock('../../../src/main/agent.js', () => ({
  AVAILABLE_MODELS: {
    anthropic: [{ id: 'claude-sonnet-4-6', label: 'Sonnet', sdkProvider: 'anthropic' }],
    openai: [{ id: 'gpt-5.4', label: 'GPT 5.4', sdkProvider: 'openai' }],
    'openai-codex': [{ id: 'gpt-5.3-codex', label: 'Codex', sdkProvider: 'openai-codex' }],
  },
  CONTEXT_SIZES: {},
  OAUTH_PROVIDER_MAP: {
    anthropic: 'anthropic',
    openai: 'openai-codex',
    'openai-codex': 'openai-codex',
    google: 'google-gemini-cli',
  },
  OAUTH_PROVIDER_INFO: {
    anthropic: { label: 'Anthropic', description: 'Claude' },
    openai: { label: 'OpenAI', description: 'API key' },
    'openai-codex': { label: 'ChatGPT Codex', description: 'OAuth' },
    google: { label: 'Google', description: 'Gemini' },
  },
  safeReloadAuth: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────

import { ipcMain } from 'electron';
import { setupAuthHandlers } from '../../../src/main/ipc-handlers-auth.js';

// ── Helpers ────────────────────────────────────────────────────

function getHandler(channel: string) {
  const call = (ipcMain.handle as any).mock.calls.find((c: any) => c[0] === channel);
  if (!call) throw new Error(`No handler registered: ${channel}`);
  return call[1];
}

async function invoke(channel: string, ...args: any[]) {
  return getHandler(channel)({ sender: {} }, ...args);
}

function makeAuthStorage(initial: Record<string, any> = {}) {
  const state = { ...initial };
  return {
    get: vi.fn((p: string) => state[p]),
    set: vi.fn((p: string, v: any) => {
      state[p] = v;
    }),
    remove: vi.fn((p: string) => {
      delete state[p];
    }),
    getApiKey: vi.fn(async (p: string) => state[p]?.key ?? state[p]?.access ?? null),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
  };
}

function makeInfra(authStorage: any, trackerRefs: { trackModelAuthMismatch?: any; trackAuthInvalidated?: any } = {}) {
  return {
    authStorage,
    modelProbe: {
      probe: vi.fn().mockResolvedValue({ status: 'ok', probedAt: Date.now(), ttlMs: 1000, cacheHit: false }),
      getStatusSnapshot: vi.fn().mockResolvedValue('ok'),
    },
    tracker: trackerRefs,
  };
}

// ── Suite ──────────────────────────────────────────────────────

describe('setupAuthHandlers', () => {
  let authStorage: ReturnType<typeof makeAuthStorage>;
  let infra: any;
  let mainWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();
    authStorage = makeAuthStorage();
    infra = makeInfra(authStorage);
    mainWindow = { webContents: {} };
    setupAuthHandlers({ infra: infra as any, mainWindow });
  });

  // ── F4: auth mismatch on switch-model ────────────────────────

  describe('F4: mismatch telemetry is a send-path concern, handled in ipc-handlers, not here', () => {
    // auth:switch-model handler is registered by setupIpcHandlers (not setupAuthHandlers).
    // F4 tests for switch live in ipc-handlers.test.ts — this just documents the split.
    it('does not register auth:switch-model (belongs to setupIpcHandlers)', () => {
      const call = (ipcMain.handle as any).mock.calls.find((c: any) => c[0] === 'auth:switch-model');
      expect(call).toBeUndefined();
    });
  });

  // ── auth:login OAuth flow ─────────────────────────────────────

  describe('auth:login OAuth flow', () => {
    it('success path: calls authStorage.login + touchMetaEntry with oauthId', async () => {
      authStorage.login = vi.fn().mockImplementation(async (oauthId: string) => {
        // Simulate Pi SDK writing the cred after login completes.
        authStorage.set(oauthId, { type: 'oauth', access: 'fresh-token' });
      });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      const res = await invoke('auth:login', 'anthropic');
      expect(res.success).toBe(true);
      expect(authStorage.login).toHaveBeenCalledWith('anthropic', expect.any(Object));
      expect(_touchMeta).toHaveBeenCalledWith('anthropic', 'oauth', 'fresh-token', '0.14.1');
    });

    it('unknown displayGroup returns MSG_UNKNOWN_PROVIDER error', async () => {
      const res = await invoke('auth:login', 'mystery');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Unknown provider/i);
      expect(authStorage.login).not.toHaveBeenCalled();
    });

    it('AbortError maps to MSG_LOGIN_CANCELLED', async () => {
      const abortErr = new Error('cancelled');
      (abortErr as any).name = 'AbortError';
      authStorage.login = vi.fn().mockRejectedValue(abortErr);
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      const res = await invoke('auth:login', 'anthropic');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cancelled/i);
    });

    it('Google Cloud Project error maps to GOOGLE_CLOUD_PROJECT_REQUIRED code', async () => {
      authStorage.login = vi.fn().mockRejectedValue(new Error('GOOGLE_CLOUD_PROJECT missing'));
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      const res = await invoke('auth:login', 'google');
      expect(res.success).toBe(false);
      expect(res.code).toBe('GOOGLE_CLOUD_PROJECT_REQUIRED');
    });

    it('onAuth refuses to open non-http URL via shell.openExternal', async () => {
      const { shell } = await import('electron');
      (shell.openExternal as any).mockClear();
      authStorage.login = vi.fn().mockImplementation(async (_id: string, cbs: any) => {
        // Simulate SDK passing a dangerous URL.
        cbs.onAuth({ url: 'javascript:alert(1)', instructions: 'x' });
      });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      await invoke('auth:login', 'anthropic');
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('concurrent auth:login returns MSG_LOGIN_IN_PROGRESS', async () => {
      let resolveFirst: () => void;
      authStorage.login = vi.fn().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveFirst = () => r();
          }),
      );
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      const first = invoke('auth:login', 'anthropic');
      await new Promise((r) => setImmediate(r));
      const second = await invoke('auth:login', 'anthropic');
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/in progress/i);
      // Let the first settle to avoid hanging mocks.
      resolveFirst!();
      await first;
    });

    it('auth:login-respond resolves the pending prompt', async () => {
      let pendingPromptResolver: ((v: string) => void) | undefined;
      authStorage.login = vi.fn().mockImplementation(async (_id: string, cbs: any) => {
        const code = await cbs.onPrompt({ message: 'Enter code:', placeholder: '...' });
        expect(code).toBe('user-typed-code');
      });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });

      const loginPromise = invoke('auth:login', 'anthropic');
      await new Promise((r) => setImmediate(r));
      await invoke('auth:login-respond', 'user-typed-code');
      await loginPromise;
      void pendingPromptResolver;
    });
  });

  // ── F5: set-key / logout touch auth-meta ─────────────────────

  describe('F5: auth-meta side effects', () => {
    it('auth:set-key with key calls touchMetaEntry', async () => {
      await invoke('auth:set-key', 'openai', 'sk-test');
      expect(authStorage.set).toHaveBeenCalledWith('openai', { type: 'api_key', key: 'sk-test' });
      expect(_touchMeta).toHaveBeenCalledWith('openai', 'api_key', 'sk-test', '0.14.1');
    });

    it('auth:set-key with empty key calls removeMetaEntry', async () => {
      await invoke('auth:set-key', 'openai', '');
      expect(authStorage.remove).toHaveBeenCalledWith('openai');
      expect(_removeMeta).toHaveBeenCalledWith('openai');
    });

    it('auth:logout removes meta entry for both displayGroup AND oauthId, records logout timestamp', async () => {
      await invoke('auth:logout', 'openai-codex');
      expect(authStorage.logout).toHaveBeenCalledWith('openai-codex');
      expect(_recordLogout).toHaveBeenCalledWith('openai-codex');
      expect(_removeMeta).toHaveBeenCalled();
    });
  });

  // ── F7: force-refresh ────────────────────────────────────────

  describe('F7: auth:force-refresh', () => {
    it('invokes AuthRefresher for mapped OAuth id', async () => {
      const result = await invoke('auth:force-refresh', 'openai');
      // 'openai' maps to 'openai-codex'
      expect(_refresherRefresh).toHaveBeenCalledWith('openai-codex');
      expect(result.success).toBe(true);
    });

    it('returns error for unknown display group', async () => {
      const result = await invoke('auth:force-refresh', 'mystery');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown/);
      expect(_refresherRefresh).not.toHaveBeenCalled();
    });

    it('returns failed outcome when refresher reports failure', async () => {
      _refresherRefresh.mockResolvedValueOnce({ outcome: 'failed', errorMessage: '401 expired' });
      const result = await invoke('auth:force-refresh', 'anthropic');
      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  // ── F11: model probe IPC ─────────────────────────────────────

  describe('F11: model probe IPC handlers', () => {
    it('auth:probe-model forwards to ModelProbe.probe', async () => {
      infra.modelProbe.probe.mockResolvedValueOnce({
        status: 'unauthorized',
        httpStatus: 401,
        probedAt: 0,
        ttlMs: 1000,
        cacheHit: false,
      });
      const result = await invoke('auth:probe-model', 'anthropic', 'claude-sonnet-4-6');
      expect(infra.modelProbe.probe).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('unauthorized');
      expect(result.data.httpStatus).toBe(401);
    });

    it('auth:probe-model returns error for invalid args', async () => {
      const result = await invoke('auth:probe-model', '', 'modelX');
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ARGS');
      expect(infra.modelProbe.probe).not.toHaveBeenCalled();
    });

    it('auth:probe-model rejects unknown model (cache pollution guard)', async () => {
      const result = await invoke('auth:probe-model', 'anthropic', 'nonexistent-model');
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNKNOWN_MODEL');
      expect(infra.modelProbe.probe).not.toHaveBeenCalled();
    });

    it('auth:test-connection probes first model of display group', async () => {
      infra.modelProbe.probe.mockResolvedValueOnce({
        status: 'ok',
        probedAt: 0,
        ttlMs: 1000,
        cacheHit: false,
      });
      const result = await invoke('auth:test-connection', 'openai');
      expect(infra.modelProbe.probe).toHaveBeenCalledWith('openai', 'gpt-5.4');
      expect(result.success).toBe(true);
      expect(result.data.modelId).toBe('gpt-5.4');
    });

    it('auth:test-connection reports non-ok with status code', async () => {
      infra.modelProbe.probe.mockResolvedValueOnce({
        status: 'forbidden',
        httpStatus: 403,
        probedAt: 0,
        ttlMs: 1000,
        cacheHit: false,
      });
      const result = await invoke('auth:test-connection', 'anthropic');
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('auth:test-connection redacts errorBody before returning', async () => {
      infra.modelProbe.probe.mockResolvedValueOnce({
        status: 'unauthorized',
        httpStatus: 401,
        errorBody: 'bad Bearer sk-live-deadbeef1234567890',
        probedAt: 0,
        ttlMs: 1000,
        cacheHit: false,
      });
      const result = await invoke('auth:test-connection', 'anthropic');
      expect(result.success).toBe(false);
      expect(result.error).not.toContain('sk-live');
      expect(result.error).toContain('[REDACTED]');
    });

    it('auth:test-connection rejects unknown provider', async () => {
      const result = await invoke('auth:test-connection', 'nope');
      expect(result.success).toBe(false);
      expect(infra.modelProbe.probe).not.toHaveBeenCalled();
    });

    it('auth:get-model-status iterates all AVAILABLE_MODELS', async () => {
      infra.modelProbe.getStatusSnapshot
        .mockResolvedValueOnce('ok')
        .mockResolvedValueOnce('unauthorized')
        .mockResolvedValueOnce('unknown');
      const result = await invoke('auth:get-model-status');
      expect(result).toEqual({
        'claude-sonnet-4-6': 'ok',
        'gpt-5.4': 'unauthorized',
        'gpt-5.3-codex': 'unknown',
      });
    });
  });

  // ── F20: split OpenAI / Codex in get-auth-status ─────────────

  describe('F20: auth:get-auth-status splits OpenAI API-key from Codex OAuth', () => {
    it('openai card shows api_key when only API key is present (oauth ignored)', async () => {
      authStorage = makeAuthStorage({
        openai: { type: 'api_key', key: 'sk-live' },
        // NOTE: OpenAI Codex OAuth is stored under 'openai-codex' — openai card must ignore it.
        'openai-codex': { type: 'oauth', access: 'tok' },
      });
      infra = makeInfra(authStorage);
      // Re-register handlers with new storage.
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });
      const status = await invoke('auth:get-auth-status');
      expect(status.openai.type).toBe('api_key');
      expect(status['openai-codex'].type).toBe('oauth');
    });

    it('openai card shows none when only Codex OAuth exists (no API key)', async () => {
      authStorage = makeAuthStorage({
        'openai-codex': { type: 'oauth', access: 'tok' },
      });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });
      const status = await invoke('auth:get-auth-status');
      expect(status.openai.type).toBe('none');
      expect(status['openai-codex'].type).toBe('oauth');
    });

    it('openai-codex card ignores api_key entries', async () => {
      authStorage = makeAuthStorage({
        'openai-codex': { type: 'api_key', key: 'should-not-appear' },
      });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });
      const status = await invoke('auth:get-auth-status');
      expect(status['openai-codex'].type).toBe('none');
    });

    it('anthropic still accepts both oauth and api_key', async () => {
      authStorage = makeAuthStorage({ anthropic: { type: 'oauth', access: 'tok' } });
      infra = makeInfra(authStorage);
      (ipcMain.handle as any).mockClear();
      setupAuthHandlers({ infra: infra as any, mainWindow });
      const status = await invoke('auth:get-auth-status');
      expect(status.anthropic.type).toBe('oauth');
    });
  });
});
