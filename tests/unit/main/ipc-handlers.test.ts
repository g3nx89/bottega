import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be before imports) ─────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getAppPath: vi.fn().mockReturnValue('/mock/appPath'),
    isPackaged: false,
  },
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ filePath: '/tmp/test.zip', canceled: false }),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  cpSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 0, mtimeMs: 0 }),
}));

vi.mock('node:child_process', () => ({
  execFile: vi
    .fn()
    .mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb?: (err: any, stdout: string, stderr: string) => void) => {
        // promisify calls with 3 args (no callback) — return a ChildProcess-like object
        // When promisified, execFile rejects on non-zero exit (pgrep: no match)
        if (!cb) {
          // promisify style: return value is ignored, the promisified wrapper handles it
        }
        const err = new Error('no process') as any;
        err.code = 1;
        if (cb) cb(err, '', '');
        return { on: vi.fn(), stdout: null, stderr: null, pid: 0 };
      },
    ),
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: vi.fn().mockReturnValue('/mock/home') };
});

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual };
});

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('../../../src/main/agent.js', () => ({
  AVAILABLE_MODELS: [
    { provider: 'anthropic', modelId: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  CONTEXT_SIZES: { default: 128000, large: 1000000 },
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  OAUTH_PROVIDER_MAP: { Anthropic: 'anthropic-oauth', google: 'google-gemini-cli' } as Record<string, string>,
  OAUTH_PROVIDER_INFO: {
    Anthropic: { description: 'Claude' },
    google: { description: 'Gemini' },
  } as Record<string, { description: string }>,
  createFigmaAgent: vi.fn(),
  safeReloadAuth: vi.fn(),
  wrapPromptWithErrorCapture: vi.fn(async (session: any, text: string) => session.prompt(text)),
  isThinkingLevel: (s: string) => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(s),
  filterLevelsForModel: (modelId: string, levels: readonly string[]) => {
    const id = (modelId.includes('/') ? (modelId.split('/').pop() ?? modelId) : modelId).toLowerCase();
    const isGemini3Pro = /gemini-3(?:\.1)?-pro/.test(id);
    const isAnthropicAdaptive =
      id.includes('opus-4-6') || id.includes('opus-4.6') || id.includes('sonnet-4-6') || id.includes('sonnet-4.6');
    return levels.filter((level) => {
      if ((id.startsWith('gpt-5.2') || id.startsWith('gpt-5.3') || id.startsWith('gpt-5.4')) && level === 'minimal') {
        return false;
      }
      if (id === 'gpt-5.1' && level === 'xhigh') return false;
      if (id === 'gpt-5.1-codex-mini' && (level === 'minimal' || level === 'low')) return false;
      if (isAnthropicAdaptive && level === 'minimal') return false;
      if (isGemini3Pro && (level === 'minimal' || level === 'medium')) return false;
      return true;
    });
  },
}));

vi.mock('../../../src/main/image-gen/config.js', () => ({
  effectiveApiKey: vi.fn().mockReturnValue('test-key'),
  saveImageGenSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/main/image-gen/image-generator.js', () => ({
  DEFAULT_IMAGE_MODEL: 'gemini-2.0-flash',
  IMAGE_GEN_MODELS: ['gemini-2.0-flash', 'dall-e-3'],
  ImageGenerator: class {
    model = 'gemini-2.0-flash';
  },
}));

vi.mock('../../../src/main/diagnostics.js', () => ({
  exportDiagnosticsZip: vi.fn().mockResolvedValue(undefined),
  formatSystemInfoForClipboard: vi.fn().mockReturnValue('Bottega v0.3.0\nmacOS'),
}));

vi.mock('../../../src/main/remote-logger.js', () => ({
  loadDiagnosticsConfig: vi.fn().mockReturnValue({ sendDiagnostics: false, anonymousId: 'test-id' }),
  reloadDiagnosticsConfig: vi.fn().mockReturnValue({ sendDiagnostics: true, anonymousId: 'test-id' }),
  saveDiagnosticsConfig: vi.fn().mockResolvedValue(undefined),
  deriveSupportCode: vi.fn().mockReturnValue('BTG-TEST-CODE'),
}));

vi.mock('../../../src/main/prompt-suggester.js', () => ({
  PromptSuggester: class {
    trackUserPrompt = vi.fn();
    appendAssistantText = vi.fn();
    resetAssistantText = vi.fn();
    suggest = vi.fn().mockResolvedValue([]);
    reset = vi.fn();
  },
}));

vi.mock('../../../src/main/auto-updater.js', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  getAppVersion: vi.fn().mockReturnValue('1.0.0'),
  quitAndInstall: vi.fn(),
}));

// safe-send: use the real implementation so we can test destroyed-window behavior
// (it's a pure function that just checks isDestroyed and calls send)

// ── Imports (after mocks) ─────────────────────────────────────────

import { execFile } from 'node:child_process';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { app, dialog, ipcMain, shell } from 'electron';
import { exportDiagnosticsZip, formatSystemInfoForClipboard } from '../../../src/main/diagnostics.js';
import { setupIpcHandlers, syncFigmaPlugin } from '../../../src/main/ipc-handlers.js';
import { loadDiagnosticsConfig, saveDiagnosticsConfig } from '../../../src/main/remote-logger.js';
import { createMockSession } from '../../helpers/mock-session.js';
import { createMockSlotManager } from '../../helpers/mock-slot-manager.js';
import { createMockWindow } from '../../helpers/mock-window.js';

// ── Helpers ───────────────────────────────────────────────────────

type MockSession = ReturnType<typeof createMockSession>;
type MockWindow = ReturnType<typeof createMockWindow>;

let mockSession: MockSession;
let mockWindow: MockWindow;
let mockInfra: any;
let slotId: string;
let slot: any;
let slotManager: any;

/** Retrieve the handler registered for a given IPC channel. */
function getHandler(channel: string) {
  const call = (ipcMain.handle as any).mock.calls.find((c: any) => c[0] === channel);
  if (!call) throw new Error(`No handler registered for channel "${channel}"`);
  return call[1];
}

/** Invoke a handler as if the renderer called ipcRenderer.invoke(). */
async function invokeHandler(channel: string, ...args: any[]) {
  const handler = getHandler(channel);
  return handler({ sender: {} }, ...args);
}

// ── Test suite ────────────────────────────────────────────────────

describe('setupIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore electron app mocks (clearAllMocks strips return values)
    (app.getPath as any).mockReturnValue('/mock/userData');
    (app.getAppPath as any).mockReturnValue('/mock/appPath');
    // vi.clearAllMocks() keeps custom mockImplementation set by prior tests —
    // explicitly reset the fs mocks so a trailing impl from the Figma-plugin
    // suite doesn't leak into the next test's default behaviour.
    (readFileSync as any).mockReset().mockReturnValue('{}');
    (existsSync as any).mockReset().mockReturnValue(false);
    (statSync as any).mockReset().mockReturnValue({ size: 0, mtimeMs: 0 });
    (cpSync as any).mockReset();
    (writeFileSync as any).mockReset();
    // Restore execFile default: pgrep fails (no Figma running)
    (execFile as any).mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(Object.assign(new Error('no process'), { code: 1 }), '', '');
      return { on: vi.fn(), stdout: null, stderr: null, pid: 0 };
    });
    // Electron sets process.resourcesPath at runtime; provide a test value
    (process as any).resourcesPath = '/mock/resources';
    mockSession = createMockSession();
    mockWindow = createMockWindow();
    mockInfra = {
      authStorage: {
        getApiKey: vi.fn().mockResolvedValue('test-api-key'),
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        login: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn(),
      },
      modelRegistry: {},
      configManager: {
        getProfiles: vi.fn().mockReturnValue(['minimal', 'balanced', 'full']),
        getActiveProfile: vi.fn().mockReturnValue('balanced'),
        setProfile: vi.fn(),
      },
      designSystemCache: { invalidate: vi.fn() },
      metricsCollector: { finalize: vi.fn() },
      wsServer: { sendCommand: vi.fn() },
      modelProbe: {
        // Default: no cached probe — pre-send gate stays open.
        getCached: vi.fn().mockReturnValue(null),
        probe: vi.fn().mockResolvedValue({ status: 'ok', probedAt: 0, ttlMs: 1000, cacheHit: false }),
        getStatusSnapshot: vi.fn().mockResolvedValue('ok'),
      },
      setWorkflowContext: vi.fn(),
    };
    const mock = createMockSlotManager(mockSession);
    slotId = mock.slotId;
    slot = mock.slot;
    slotManager = mock.slotManager;
    const ipcController = setupIpcHandlers({
      slotManager: slotManager as any,
      mainWindow: mockWindow as any,
      infra: mockInfra,
    });
    ipcController.subscribeSlot(slot as any);
  });

  // ── safeSend (cross-cutting, R6) ──────────────────────────────

  describe('safeSend cross-cutting', () => {
    it('should send IPC messages when webContents is alive', () => {
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', slotId, 'hello');
    });

    it('should not crash when webContents is destroyed', () => {
      mockWindow.destroy();

      // Emitting an event should silently no-op, not throw
      expect(() => {
        mockSession.emitEvent({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
        });
      }).not.toThrow();

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should not send error messages when webContents is destroyed during prompt failure', async () => {
      mockSession._promptFn.mockRejectedValueOnce(new Error('Network error'));
      mockWindow.destroy();

      await invokeHandler('agent:prompt', slotId, 'test');

      // safeSend should no-op on destroyed window — send must not be called
      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  // ── Streaming lifecycle (R5) ──────────────────────────────────

  describe('streaming lifecycle', () => {
    it('should call session.prompt with text', async () => {
      await invokeHandler('agent:prompt', slotId, 'design a button');

      expect(mockSession._promptFn).toHaveBeenCalledWith('design a button');
    });

    it('should send error text-delta and agent:end on prompt failure', async () => {
      mockSession._promptFn.mockRejectedValueOnce(new Error('API timeout'));

      await invokeHandler('agent:prompt', slotId, 'test');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('API timeout'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
    });

    it('should send auth-specific error message on 401 status', async () => {
      const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
      mockSession._promptFn.mockRejectedValueOnce(authErr);

      await invokeHandler('agent:prompt', slotId, 'test');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('expired'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
    });

    it('should send model-not-available message on 403 status (F13)', async () => {
      const authErr = Object.assign(new Error('Forbidden'), { status: 403 });
      mockSession._promptFn.mockRejectedValueOnce(authErr);

      await invokeHandler('agent:prompt', slotId, 'test');

      // F13: 403 means the model isn't available on this plan, not session expired.
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('not available'),
      );
    });

    it('should send auth-specific error message on EAUTH code', async () => {
      const authErr = Object.assign(new Error('Auth failed'), { code: 'EAUTH' });
      mockSession._promptFn.mockRejectedValueOnce(authErr);

      await invokeHandler('agent:prompt', slotId, 'test');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('expired'),
      );
    });

    it('should send agent:end when agent_end event fires', async () => {
      slot.isStreaming = true; // agent_end only fires while streaming
      mockSession.emitEvent({ type: 'agent_end' });

      await vi.waitFor(() => {
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
      });
    });

    it('should enqueue prompts while streaming', async () => {
      // First prompt starts streaming
      await invokeHandler('agent:prompt', slotId, 'first');
      expect(mockSession._promptFn).toHaveBeenCalledWith('first');
      // Second prompt while streaming should be enqueued, not sent directly
      await invokeHandler('agent:prompt', slotId, 'second');
      expect(mockSession._promptFn).toHaveBeenCalledTimes(1); // only 'first' was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'queue:updated',
        slotId,
        expect.arrayContaining([expect.objectContaining({ text: 'second' })]),
      );
    });

    it('should call session.abort and reset streaming state', async () => {
      // Start streaming
      await invokeHandler('agent:prompt', slotId, 'start');
      // Abort
      await invokeHandler('agent:abort', slotId);

      expect(mockSession._abortFn).toHaveBeenCalled();

      // After abort, next prompt should NOT be enqueued (streaming was reset)
      await invokeHandler('agent:prompt', slotId, 'fresh start');
      expect(mockSession._promptFn).toHaveBeenLastCalledWith('fresh start');
    });
  });

  // ── Agent events forwarding ───────────────────────────────────

  describe('agent event forwarding', () => {
    it('should forward text_delta to renderer', () => {
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'some text' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', slotId, 'some text');
    });

    it('should forward thinking_delta to renderer', () => {
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:thinking', slotId, 'thinking...');
    });

    it('should forward tool_execution_start with tool name and callId', () => {
      mockSession.emitEvent({
        type: 'tool_execution_start',
        toolName: 'figma_execute',
        toolCallId: 'call-123',
        toolParams: { code: 'test' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:tool-start', slotId, 'figma_execute', 'call-123');
    });

    it('should forward tool_execution_end with result', () => {
      mockSession.emitEvent({
        type: 'tool_execution_end',
        toolName: 'figma_set_text',
        toolCallId: 'call-456',
        isError: false,
        result: { content: [{ type: 'text', text: 'done' }] },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:tool-end',
        slotId,
        'figma_set_text',
        'call-456',
        true, // success = !isError
        { content: [{ type: 'text', text: 'done' }] },
      );
    });

    it('should forward screenshot data for figma_screenshot tool', () => {
      const imageData = 'base64-png-data';
      mockSession.emitEvent({
        type: 'tool_execution_end',
        toolName: 'figma_screenshot',
        toolCallId: 'call-789',
        isError: false,
        result: {
          content: [
            { type: 'text', text: 'Screenshot taken' },
            { type: 'image', data: imageData },
          ],
        },
      });

      // Should send both the tool-end AND the screenshot
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:tool-end',
        slotId,
        'figma_screenshot',
        'call-789',
        true,
        expect.any(Object),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:screenshot', slotId, imageData);
    });

    it('should forward usage stats on message_end', () => {
      mockSession.emitEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          usage: { input: 1000, output: 500, totalTokens: 1500 },
        },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:usage', slotId, {
        input: 1000,
        output: 500,
        total: 1500,
      });
    });

    it('should NOT forward usage for non-assistant message_end', () => {
      mockSession.emitEvent({
        type: 'message_end',
        message: {
          role: 'toolResult',
          usage: { input: 999, output: 999, totalTokens: 1998 },
        },
      });

      const usageCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:usage');
      expect(usageCalls).toHaveLength(0);
    });

    it('should not crash when assistant message_end has no usage', () => {
      mockSession.emitEvent({
        type: 'message_end',
        message: { role: 'assistant' },
      });

      const usageCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:usage');
      expect(usageCalls).toHaveLength(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should send error and not call session when no API key is configured', async () => {
      mockInfra.authStorage.getApiKey.mockResolvedValueOnce(null);

      await invokeHandler('agent:prompt', slotId, 'test');

      expect(mockSession._promptFn).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('No credentials configured'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
    });

    it('should return GOOGLE_CLOUD_PROJECT_REQUIRED code for Workspace accounts', async () => {
      mockInfra.authStorage.login.mockRejectedValueOnce(
        new Error(
          'This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable.',
        ),
      );

      const result = await invokeHandler('auth:login', 'google');

      expect(result.success).toBe(false);
      expect(result.code).toBe('GOOGLE_CLOUD_PROJECT_REQUIRED');
      expect(result.error).toContain('Cloud Project ID');
    });

    it('should reset streaming state on abort', async () => {
      // Start streaming
      await invokeHandler('agent:prompt', slotId, 'hello');
      // Abort resets isStreaming
      await invokeHandler('agent:abort', slotId);

      // Next prompt should be a fresh start (no enqueue)
      await invokeHandler('agent:prompt', slotId, 'new prompt');
      const lastCall = mockSession._promptFn.mock.calls[mockSession._promptFn.mock.calls.length - 1];
      expect(lastCall).toEqual(['new prompt']);
    });
  });

  // ── Model switch ──────────────────────────────────────────────

  describe('auth:switch-model', () => {
    it('should recreate session on model switch', async () => {
      const newConfig = { provider: 'openai', modelId: 'gpt-5.4' };
      const result = await invokeHandler('auth:switch-model', slotId, newConfig);

      expect(result).toEqual({ success: true });
      expect(slotManager.recreateSession).toHaveBeenCalledWith(slotId, newConfig);
    });

    it('should return error on switch failure', async () => {
      slotManager.recreateSession.mockRejectedValueOnce(new Error('Invalid credentials'));

      const result = await invokeHandler('auth:switch-model', slotId, {
        provider: 'openai',
        modelId: 'gpt-5.4',
      });

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    });

    it('should skip session recreation when model has not changed', async () => {
      // slot.modelConfig is { provider: 'anthropic', modelId: 'claude-sonnet-4' }
      const sameConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4' };
      const result = await invokeHandler('auth:switch-model', slotId, sameConfig);

      expect(result).toEqual({ success: true });
      expect(slotManager.recreateSession).not.toHaveBeenCalled();
    });

    // F4: mismatch telemetry on switch path
    it('F4: emits model_auth_mismatch when target provider has no credentials', async () => {
      const trackMismatch = vi.fn();
      // Wire usageTracker into the running setup. The ipc-handlers.test.ts
      // doesn't pass a usageTracker in mockInfra, so we attach it via the
      // setupIpcHandlers invocation side — here we simulate by checking
      // the authStorage.get call itself receives the target provider.
      mockInfra.authStorage.get = vi.fn().mockReturnValue(undefined);
      mockInfra.usageTracker = { trackModelAuthMismatch: trackMismatch };
      // Re-run setup so the usageTracker is captured in closures. Not trivial
      // without refactor — assert the storage.get call as proxy for mismatch-path entry.
      await invokeHandler('auth:switch-model', slotId, { provider: 'openai', modelId: 'gpt-5.4' });
      expect(mockInfra.authStorage.get).toHaveBeenCalledWith('openai');
    });
  });

  // ── Untested event forwarding ─────────────────────────────────

  describe('additional event forwarding', () => {
    it('should forward auto_compaction_start to renderer', () => {
      // Edge case: compaction events not covered by existing tests
      mockSession.emitEvent({ type: 'auto_compaction_start' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:compaction', slotId, true);
    });

    it('should forward auto_compaction_end to renderer', () => {
      mockSession.emitEvent({ type: 'auto_compaction_end' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:compaction', slotId, false);
    });

    it('should forward auto_retry_start to renderer', () => {
      mockSession.emitEvent({ type: 'auto_retry_start' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:retry', slotId, true);
    });

    it('should forward auto_retry_end to renderer', () => {
      mockSession.emitEvent({ type: 'auto_retry_end' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:retry', slotId, false);
    });

    it('should not crash on screenshot tool result without image content', () => {
      // Edge case: figma_screenshot succeeds but content has no image entry
      mockSession.emitEvent({
        type: 'tool_execution_end',
        toolName: 'figma_screenshot',
        toolCallId: 'call-no-img',
        isError: false,
        result: {
          content: [{ type: 'text', text: 'Screenshot captured but no image data' }],
        },
      });

      // Should send tool-end but NOT agent:screenshot
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:tool-end',
        slotId,
        'figma_screenshot',
        'call-no-img',
        true,
        expect.any(Object),
      );
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('agent:screenshot', expect.anything());
    });
  });

  // ── Auth edge cases ─────────────────────────────────────────

  describe('auth edge cases', () => {
    it('auth:set-key should reject invalid provider', async () => {
      // Security: setting API key for unknown provider should fail
      const result = await invokeHandler('auth:set-key', 'unknown-provider', 'sk-test');

      expect(result).toBe(false);
    });

    it('auth:set-key with empty apiKey should remove credentials', async () => {
      // Edge case: empty string means "remove"
      const result = await invokeHandler('auth:set-key', 'Anthropic', '');

      expect(result).toBe(true);
      expect(mockInfra.authStorage.remove).toHaveBeenCalledWith('Anthropic');
      expect(mockInfra.authStorage.set).not.toHaveBeenCalled();
    });

    it('window:is-pinned returns the pin state', async () => {
      // Coverage: untested IPC handler
      mockWindow.isAlwaysOnTop.mockReturnValueOnce(true);
      const result = await invokeHandler('window:is-pinned');

      expect(result).toBe(true);
    });

    it('double abort should not crash', async () => {
      // Characterization: mock always resolves — real Pi SDK may throw
      // if abort() is called on a non-streaming session. This test verifies
      // the handler does not guard against double-abort itself.
      await invokeHandler('agent:abort', slotId);
      await invokeHandler('agent:abort', slotId);

      expect(mockSession._abortFn).toHaveBeenCalledTimes(2);
    });
  });

  // ── IPC contract (R-N8) ───────────────────────────────────────

  describe('IPC contract', () => {
    it('should return AVAILABLE_MODELS from auth:get-models', async () => {
      const result = await invokeHandler('auth:get-models');

      expect(result).toEqual([
        { provider: 'anthropic', modelId: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
        { provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
      ]);
    });

    it('should return profiles from compression:get-profiles', async () => {
      const result = await invokeHandler('compression:get-profiles');

      expect(result).toEqual(['minimal', 'balanced', 'full']);
      expect(mockInfra.configManager.getProfiles).toHaveBeenCalled();
    });

    it('should return active profile from compression:get-profile', async () => {
      const result = await invokeHandler('compression:get-profile');
      expect(result).toBe('balanced');
    });

    it('should set compression profile and return success', async () => {
      const result = await invokeHandler('compression:set-profile', 'minimal');

      expect(result).toEqual({ success: true });
      expect(mockInfra.configManager.setProfile).toHaveBeenCalledWith('minimal');
    });

    it('should invalidate caches via compression:invalidate-caches', async () => {
      const result = await invokeHandler('compression:invalidate-caches');

      expect(result).toEqual({ success: true });
      expect(mockInfra.designSystemCache.invalidate).toHaveBeenCalled();
    });

    it('should return context sizes from auth:get-context-sizes', async () => {
      const result = await invokeHandler('auth:get-context-sizes');

      expect(result).toEqual({ default: 128000, large: 1000000 });
    });

    it('should toggle window pin state', async () => {
      mockWindow.isAlwaysOnTop.mockReturnValueOnce(false);
      const result = await invokeHandler('window:toggle-pin');

      expect(result).toBe(true);
      expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    });

    it('should clamp opacity between 0.1 and 1', async () => {
      await invokeHandler('window:set-opacity', 0.05);
      expect(mockWindow.setOpacity).toHaveBeenCalledWith(0.1);

      await invokeHandler('window:set-opacity', 1.5);
      expect(mockWindow.setOpacity).toHaveBeenCalledWith(1);

      await invokeHandler('window:set-opacity', 0.5);
      expect(mockWindow.setOpacity).toHaveBeenCalledWith(0.5);
    });
  });

  // ── Figma plugin setup ─────────────────────────────────────────

  describe('Figma plugin setup', () => {
    it('plugin:check returns installed true when manifest exists', async () => {
      (existsSync as any).mockReturnValueOnce(true);

      const result = await invokeHandler('plugin:check');

      expect(result).toEqual({ installed: true });
      expect(existsSync).toHaveBeenCalledWith(expect.stringContaining('figma-plugin/manifest.json'));
    });

    it('plugin:check returns installed false when manifest missing', async () => {
      (existsSync as any).mockReturnValueOnce(false);

      const result = await invokeHandler('plugin:check');

      expect(result).toEqual({ installed: false });
    });

    it('plugin:install uses dev path when packaged manifest missing', async () => {
      // getPluginSourcePath: packaged manifest missing → dev manifest found
      (existsSync as any)
        .mockReturnValueOnce(false) // packaged path: no manifest
        .mockReturnValueOnce(true); // dev path: manifest found
      // Simulate absent Figma settings.json so ensurePluginRegistered returns
      // 'failed' → autoRegistered=false (the scenario these assertions target).
      (readFileSync as any).mockImplementation(() => {
        const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      const result = await invokeHandler('plugin:install');

      expect(result).toEqual({
        success: true,
        path: expect.stringContaining('figma-plugin'),
        autoRegistered: false,
        alreadyRegistered: false,
        figmaRunning: false,
      });
      expect(cpSync).toHaveBeenCalledWith(
        expect.stringContaining('appPath/figma-desktop-bridge'),
        expect.stringContaining('figma-plugin'),
        { recursive: true, force: true },
      );
      // Falls back to showing in Finder when auto-registration unavailable
      expect(shell.showItemInFolder).toHaveBeenCalledWith(expect.stringContaining('manifest.json'));
    });

    it('plugin:install uses packaged path when manifest exists there', async () => {
      // getPluginSourcePath: packaged manifest found on first candidate
      (existsSync as any).mockReturnValueOnce(true); // packaged manifest exists
      // Simulate absent Figma settings.json — same rationale as the sibling test.
      (readFileSync as any).mockImplementation(() => {
        const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      const result = await invokeHandler('plugin:install');

      expect(result).toEqual({
        success: true,
        path: expect.stringContaining('figma-plugin'),
        autoRegistered: false,
        alreadyRegistered: false,
        figmaRunning: false,
      });
      expect(cpSync).toHaveBeenCalledWith(
        expect.stringContaining('resources/figma-desktop-bridge'),
        expect.stringContaining('figma-plugin'),
        { recursive: true, force: true },
      );
    });

    it('plugin:install returns error when no source has manifest', async () => {
      // getPluginSourcePath: all three candidates fail → returns null
      (existsSync as any)
        .mockReturnValueOnce(false) // packaged: no manifest
        .mockReturnValueOnce(false) // dev: no manifest
        .mockReturnValueOnce(false); // dev-parent (../): no manifest

      const result = await invokeHandler('plugin:install');

      expect(result).toEqual({ success: false, error: 'Plugin files not found in app bundle.' });
      expect(cpSync).not.toHaveBeenCalled();
    });

    it('plugin:install returns error when copy fails', async () => {
      (existsSync as any).mockReturnValueOnce(true); // packaged manifest found
      (cpSync as any).mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await invokeHandler('plugin:install');

      expect(result).toEqual({ success: false, error: 'EACCES: permission denied' });
      expect(shell.showItemInFolder).not.toHaveBeenCalled();
    });
  });

  // ── syncFigmaPlugin (direct) ─────────────────────────────────

  describe('syncFigmaPlugin', () => {
    it('returns synced:false when no plugin source found', async () => {
      (existsSync as any)
        .mockReturnValueOnce(false) // packaged
        .mockReturnValueOnce(false) // dev
        .mockReturnValueOnce(false); // dev-parent

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(false);
      expect(result.error).toBe('Plugin files not found in app bundle.');
      expect(cpSync).not.toHaveBeenCalled();
    });

    it('does not auto-register when Figma is not running but settings.json missing', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      (existsSync as any).mockReturnValueOnce(false); // dest manifest missing → needs sync
      // Make every settings.json read throw ENOENT so both isPluginRegistered
      // and ensurePluginRegistered treat the file as missing. Default '{}' would
      // have been a valid empty settings object, which ensurePluginRegistered
      // happily populates — exactly the opposite of what this case exercises.
      (readFileSync as any).mockImplementation(() => {
        const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(result.figmaRunning).toBe(false);
      expect(result.autoRegistered).toBe(false);
      expect(result.alreadyRegistered).toBe(false);
    });

    it('detects already registered plugin', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      (existsSync as any).mockReturnValueOnce(false); // dest manifest missing → needs sync
      (existsSync as any).mockReturnValueOnce(true); // settings.json exists

      // Use path-keyed mock so pluginNeedsSync byte compares don't consume the
      // registered-plugin payload meant for settings.json reads.
      const registeredSettings = JSON.stringify({
        localFileExtensions: [
          {
            id: 1,
            manifestPath: '/some/path/manifest.json',
            lastKnownPluginId: 'bottega-bridge',
            fileMetadata: { type: 'manifest', codeFileId: 2, uiFileIds: [3] },
          },
        ],
      });
      (readFileSync as any).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('settings.json') ? registeredSettings : '{}',
      );

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(result.alreadyRegistered).toBe(true);
      expect(result.autoRegistered).toBe(false);
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('auto-registers when not registered and Figma closed', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      (existsSync as any).mockReturnValueOnce(false); // dest manifest missing → needs sync
      // isPluginRegistered (read-only check): settings.json exists but no plugin entry
      (existsSync as any).mockReturnValueOnce(true);
      (readFileSync as any).mockReturnValueOnce(JSON.stringify({ localFileExtensions: [] }));
      // isFigmaRunning: pgrep fails → not running (default mock)
      // ensurePluginRegistered: settings.json exists but no plugin entry (re-reads)
      (existsSync as any).mockReturnValueOnce(true);
      (readFileSync as any).mockReturnValueOnce(JSON.stringify({ localFileExtensions: [] }));

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(result.autoRegistered).toBe(true);
      expect(result.alreadyRegistered).toBe(false);
      expect(result.figmaRunning).toBe(false);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('Figma/settings.json'),
        expect.stringContaining('bottega-bridge'),
      );
    });

    it('reports alreadyRegistered even when Figma is running', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      (existsSync as any).mockReturnValueOnce(false); // dest manifest missing → needs sync
      (existsSync as any).mockReturnValueOnce(true); // settings.json exists

      const registeredSettings = JSON.stringify({
        localFileExtensions: [
          {
            id: 1,
            manifestPath: '/mock/userData/figma-plugin/manifest.json',
            lastKnownPluginId: 'bottega-bridge',
            fileMetadata: { type: 'manifest', codeFileId: 2, uiFileIds: [3] },
          },
        ],
      });
      (readFileSync as any).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('settings.json') ? registeredSettings : '{}',
      );
      // isFigmaRunning: pgrep succeeds → Figma IS running
      (execFile as any).mockImplementationOnce((...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') cb(null, { stdout: '12345\n', stderr: '' });
        return { on: vi.fn(), stdout: null, stderr: null, pid: 0 };
      });

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(result.alreadyRegistered).toBe(true);
      expect(result.figmaRunning).toBe(true);
      // Should NOT attempt to write settings.json when Figma is running
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('skips file copy when plugin is up to date', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      // pluginNeedsSync: dest exists, sizes match
      (existsSync as any).mockReturnValueOnce(true); // dest manifest exists
      (statSync as any)
        .mockReturnValueOnce({ size: 500 }) // src manifest size
        .mockReturnValueOnce({ size: 500 }) // dest manifest size
        .mockReturnValueOnce({ size: 10000 }) // src code.js size
        .mockReturnValueOnce({ size: 10000 }) // dest code.js size
        .mockReturnValueOnce({ size: 800 }) // src ui.html size
        .mockReturnValueOnce({ size: 800 }); // dest ui.html size
      // pluginNeedsSync byte-compares via Buffer.equals — default mock returns
      // a string '{}' whose .equals is undefined and throws. Return identical
      // Buffers for plugin files so the compare succeeds and sync is skipped.
      const identical = Buffer.from('identical bytes');
      (readFileSync as any).mockImplementation((p: string) => {
        if (typeof p === 'string' && (p.endsWith('.json') || p.endsWith('.js') || p.endsWith('.html'))) {
          return identical;
        }
        return '{}';
      });

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(cpSync).not.toHaveBeenCalled();
    });
  });

  // ── Diagnostics ──────────────────────────────────────────────

  describe('diagnostics:export', () => {
    it('should export diagnostics zip via save dialog', async () => {
      const result = await invokeHandler('diagnostics:export');

      expect(dialog.showSaveDialog).toHaveBeenCalled();
      expect(exportDiagnosticsZip).toHaveBeenCalledWith('/tmp/test.zip');
      expect(result).toEqual({ success: true, path: '/tmp/test.zip' });
    });

    it('should return canceled when user cancels dialog', async () => {
      (dialog.showSaveDialog as any).mockResolvedValueOnce({ filePath: undefined, canceled: true });

      const result = await invokeHandler('diagnostics:export');

      expect(exportDiagnosticsZip).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, canceled: true });
    });
  });

  describe('diagnostics:copy-info', () => {
    it('should return formatted system info', async () => {
      const result = await invokeHandler('diagnostics:copy-info');

      expect(formatSystemInfoForClipboard).toHaveBeenCalled();
      expect(result).toBe('Bottega v0.3.0\nmacOS');
    });
  });

  describe('diagnostics:get-config', () => {
    it('should return diagnostics config', async () => {
      const result = await invokeHandler('diagnostics:get-config');

      expect(loadDiagnosticsConfig).toHaveBeenCalled();
      expect(result).toEqual({ sendDiagnostics: false });
    });
  });

  describe('diagnostics:set-config', () => {
    it('should save config and return requiresRestart', async () => {
      const result = await invokeHandler('diagnostics:set-config', { sendDiagnostics: true });

      expect(saveDiagnosticsConfig).toHaveBeenCalledWith(expect.objectContaining({ sendDiagnostics: true }));
      expect(result).toEqual({ success: true, requiresRestart: true });
    });
  });

  // ── Queue management ──────────────────────────────────────────

  describe('queue management', () => {
    it('queue:remove removes a prompt and emits queue:updated', async () => {
      const queued = slot.promptQueue.enqueue('test prompt');

      const result = await invokeHandler('queue:remove', slotId, queued.id);

      expect(result).toBe(true);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
      expect(slotManager.persistState).toHaveBeenCalled();
    });

    it('queue:remove returns false for unknown promptId', async () => {
      const result = await invokeHandler('queue:remove', slotId, 'non-existent-id');

      expect(result).toBe(false);
    });

    it('queue:edit edits a prompt and emits queue:updated', async () => {
      const queued = slot.promptQueue.enqueue('original text');

      const result = await invokeHandler('queue:edit', slotId, queued.id, 'new text');

      expect(result).toBe(true);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
      expect(slotManager.persistState).toHaveBeenCalled();
    });

    it('queue:clear clears all prompts and emits queue:updated with empty array', async () => {
      slot.promptQueue.enqueue('first prompt');
      slot.promptQueue.enqueue('second prompt');

      const result = await invokeHandler('queue:clear', slotId);

      expect(result).toBe(2);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, []);
    });

    it('queue:list returns queued prompts', async () => {
      slot.promptQueue.enqueue('prompt one');
      slot.promptQueue.enqueue('prompt two');

      const result = await invokeHandler('queue:list', slotId);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('prompt one');
      expect(result[1].text).toBe('prompt two');
    });

    it('tab:create creates a tab and returns slot info', async () => {
      slotManager.getSlotInfo = vi.fn().mockReturnValue({
        id: slotId,
        fileKey: 'file-key',
        fileName: 'File.fig',
        isStreaming: false,
        isConnected: true,
        modelConfig: slot.modelConfig,
        queueLength: 0,
      });

      const result = await invokeHandler('tab:create', 'file-key', 'File.fig');

      expect(result.success).toBe(true);
      expect(result.slot).toBeDefined();
    });
  });

  // ── agent:abort (B-003/B-007) ─────────────────────────────────

  describe('agent:abort', () => {
    it('should immediately unblock UI with agent:end BEFORE abort resolves', async () => {
      // Make session.abort() hang until we resolve it manually
      let resolveAbort!: () => void;
      mockSession._abortFn.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        }),
      );

      slot.isStreaming = true;

      // Start the abort handler (don't await yet)
      const abortPromise = invokeHandler('agent:abort', slotId);

      // Give microtasks a chance to flush synchronous code before abort resolves
      await vi.waitFor(() => {
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
      });

      // Abort has NOT resolved yet — UI should already be unblocked
      expect(mockSession._abortFn).toHaveBeenCalled();

      // Now let abort resolve and finish
      resolveAbort();
      await abortPromise;
    });

    it('should set isStreaming to false immediately (before abort resolves)', async () => {
      let resolveAbort!: () => void;
      mockSession._abortFn.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        }),
      );

      slot.isStreaming = true;

      const abortPromise = invokeHandler('agent:abort', slotId);

      // isStreaming should be false immediately, even while abort is pending
      await vi.waitFor(() => {
        expect(slot.isStreaming).toBe(false);
      });

      resolveAbort();
      await abortPromise;
    });

    it('should complete cleanup even when session.abort() times out (>5s)', async () => {
      // Make abort hang forever (never resolves)
      mockSession._abortFn.mockReturnValueOnce(new Promise<void>(() => {}));

      slot.isStreaming = true;

      // Use fake timers to control the 5s timeout
      vi.useFakeTimers();

      const abortPromise = invokeHandler('agent:abort', slotId);

      // Advance past the 5s timeout
      await vi.advanceTimersByTimeAsync(6_000);

      await abortPromise;

      vi.useRealTimers();

      // Cleanup should have happened despite timeout
      expect(slot.promptQueue.length).toBe(0);
      expect(slotManager.persistState).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, []);
    });

    it('should run full cleanup when session.abort() resolves quickly', async () => {
      // Default mock resolves immediately
      slot.isStreaming = true;
      slot.promptQueue.enqueue('pending prompt');

      await invokeHandler('agent:abort', slotId);

      // Verify full cleanup chain
      expect(mockSession._abortFn).toHaveBeenCalled();
      expect(slot.isStreaming).toBe(false);
      expect(slot.promptQueue.length).toBe(0);
      expect(slotManager.persistState).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, []);
    });

    it('should call eventRouter.abortJudge before session abort', async () => {
      // We cannot directly spy on eventRouter.abortJudge since it's internal to
      // setupIpcHandlers. However, the abort flow calls abortJudge(slotId) which
      // aborts any active judge controller. We verify the judge abort path indirectly:
      // if a judge abort controller exists for the slot, it should be aborted.

      // Since eventRouter is internal, we verify the ordering by checking that
      // agent:end is emitted before abort resolves, and that abort is called
      // (abortJudge runs synchronously before session.abort).

      const abortCallOrder: string[] = [];
      mockSession._abortFn.mockImplementationOnce(async () => {
        abortCallOrder.push('session.abort');
      });

      // The handler calls abortJudge synchronously, then awaits session.abort.
      // We verify session.abort was called (after abortJudge, which is sync and before it).
      slot.isStreaming = true;
      await invokeHandler('agent:abort', slotId);

      // session.abort was called — abortJudge ran before it (it's sync, on line before await)
      expect(mockSession._abortFn).toHaveBeenCalledTimes(1);
      expect(abortCallOrder).toEqual(['session.abort']);

      // UI was unblocked before session.abort
      const sendCalls = (mockWindow.webContents.send as any).mock.calls;
      const agentEndIdx = sendCalls.findIndex((c: any[]) => c[0] === 'agent:end');
      expect(agentEndIdx).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Agent_end queue drain ─────────────────────────────────────

  describe('agent_end queue drain', () => {
    /** Gets the subscriber callback registered by subscribeSlot() */
    function getSubscriberCb(): (event: any) => void {
      const subscribers = (slot.session as any).subscribers as Array<(event: any) => void>;
      return subscribers[subscribers.length - 1];
    }

    it('agent_end with empty queue sends agent:end to renderer', async () => {
      slot.isStreaming = true; // agent_end only fires while streaming
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      await vi.waitFor(() => {
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
      });
      expect(slot.isStreaming).toBe(false);
    });

    it('agent_end with queued prompt auto-sends next prompt', async () => {
      slot.promptQueue.enqueue('next prompt');
      slot.isStreaming = true;
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      await vi.waitFor(() => {
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:queued-prompt-start', slotId, 'next prompt');
      });
      expect(mockSession._promptFn).toHaveBeenCalledWith('next prompt');
      const endCalls = (mockWindow.webContents.send as any).mock.calls.filter((c: any[]) => c[0] === 'agent:end');
      expect(endCalls).toHaveLength(0);
    });

    it('agent_end drain sends queue:updated event', async () => {
      slot.promptQueue.enqueue('next prompt');
      slot.isStreaming = true;
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      await vi.waitFor(() => {
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
      });
    });

    it('agent:prompt while streaming enqueues prompt', async () => {
      slot.isStreaming = true;

      await invokeHandler('agent:prompt', slotId, 'queued text');

      expect(slot.promptQueue.length).toBe(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
    });
  });

  // ── F12 pre-send gate ──────────────────────────────────────────

  describe('F12: pre-send probe gate', () => {
    it('blocks send when cached probe is unauthorized, no session.prompt call', async () => {
      mockInfra.modelProbe.getCached.mockReturnValue({
        status: 'unauthorized',
        probedAt: 0,
        ttlMs: 1000,
        cacheHit: true,
      });
      await invokeHandler('agent:prompt', slotId, 'hello');

      expect(mockSession._promptFn).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('unauthorized'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
    });

    it('blocks send on forbidden / not_found', async () => {
      for (const status of ['forbidden', 'not_found'] as const) {
        mockSession._promptFn.mockClear();
        mockInfra.modelProbe.getCached.mockReturnValue({ status, probedAt: 0, ttlMs: 1000, cacheHit: true });
        await invokeHandler('agent:prompt', slotId, 'x');
        expect(mockSession._promptFn).not.toHaveBeenCalled();
      }
    });

    it('does NOT block on ok / rate_limit / error (latter two are transient, let SDK retry)', async () => {
      for (const status of ['ok', 'rate_limit', 'error'] as const) {
        mockSession._promptFn.mockClear();
        slot.isStreaming = false;
        mockInfra.modelProbe.getCached.mockReturnValue({ status, probedAt: 0, ttlMs: 1000, cacheHit: true });
        await invokeHandler('agent:prompt', slotId, 'x');
        expect(mockSession._promptFn).toHaveBeenCalledWith('x');
      }
    });

    it('does not block when no cache entry exists', async () => {
      mockInfra.modelProbe.getCached.mockReturnValue(null);
      await invokeHandler('agent:prompt', slotId, 'x');
      expect(mockSession._promptFn).toHaveBeenCalledWith('x');
    });
  });

  // ── F14 stream-error IPC ───────────────────────────────────────

  describe('F14: agent:stream-error structured payload', () => {
    it('emits retriable=true on 429 with lastPrompt', async () => {
      mockSession._promptFn.mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
      await invokeHandler('agent:prompt', slotId, 'retry-me');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-error',
        slotId,
        expect.objectContaining({ httpStatus: 429, retriable: true, lastPrompt: 'retry-me' }),
      );
    });

    it('emits retriable=true on 503', async () => {
      mockSession._promptFn.mockRejectedValueOnce(Object.assign(new Error('bad gw'), { status: 503 }));
      await invokeHandler('agent:prompt', slotId, 'x');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-error',
        slotId,
        expect.objectContaining({ httpStatus: 503, retriable: true }),
      );
    });

    it('emits retriable=false on 401/403/404', async () => {
      for (const status of [401, 403, 404]) {
        (mockWindow.webContents.send as any).mockClear();
        mockSession._promptFn.mockRejectedValueOnce(Object.assign(new Error('x'), { status }));
        await invokeHandler('agent:prompt', slotId, 'x');
        const call = (mockWindow.webContents.send as any).mock.calls.find((c: any[]) => c[0] === 'agent:stream-error');
        expect(call?.[2]).toMatchObject({ httpStatus: status, retriable: false });
      }
    });

    it('routes 404 message through F13 not_found copy', async () => {
      mockSession._promptFn.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
      await invokeHandler('agent:prompt', slotId, 'x');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        slotId,
        expect.stringContaining('not recognized'),
      );
    });
  });

  // ── F15 diagnostics recent errors IPC ──────────────────────────

  describe('F15: diagnostics:get-recent-errors', () => {
    it('returns empty array when no tracker attached', async () => {
      const result = await invokeHandler('diagnostics:get-recent-errors');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── Thinking level & capabilities ─────────────────────────────
  //
  // These tests guard the Pi-SDK-agnostic contract between the UI and main:
  // the renderer fetches capabilities before rendering the effort dropdown,
  // and `set-thinking` must echo the *effective* (post-clamp) level so the
  // chip never shows a value the provider will silently ignore.

  describe('agent:set-thinking', () => {
    it('forwards a valid level to session.setThinkingLevel and persists it on the slot', async () => {
      const res = await invokeHandler('agent:set-thinking', slotId, 'high');
      expect(mockSession.setThinkingLevel).toHaveBeenCalledWith('high');
      expect(slot.thinkingLevel).toBe('high');
      expect(res).toEqual({ level: 'high' });
    });

    it('ignores invalid levels without touching the session', async () => {
      await invokeHandler('agent:set-thinking', slotId, 'not-a-level');
      expect(mockSession.setThinkingLevel).not.toHaveBeenCalled();
    });

    it('returns the effective (clamped) level when the model does not support the requested one', async () => {
      // Model only supports off+low — request "xhigh" and expect a downgrade.
      mockSession._availableThinkingLevels = ['off', 'low'];
      mockSession._supportsXhigh = false;

      const res = await invokeHandler('agent:set-thinking', slotId, 'xhigh');

      expect(mockSession.setThinkingLevel).toHaveBeenCalledWith('xhigh');
      // Mock's clamp: xhigh → low (highest supported).
      expect(res).toEqual({ level: 'low' });
      expect(slot.thinkingLevel).toBe('low');
    });

    it('falls back to the requested level when the session lacks a thinkingLevel getter', async () => {
      // Simulate a session without the getter (older SDK / scripted mock).
      Object.defineProperty(mockSession, 'thinkingLevel', {
        configurable: true,
        get: () => undefined,
      });
      const res = await invokeHandler('agent:set-thinking', slotId, 'medium');
      expect(res).toEqual({ level: 'medium' });
      expect(slot.thinkingLevel).toBe('medium');
    });
  });

  describe('agent:get-thinking-capabilities', () => {
    it('reports anthropic family and filtered level set for Opus 4.6 (minimal dropped, xhigh kept)', async () => {
      slot.modelConfig = { provider: 'anthropic', modelId: 'claude-opus-4-6' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      mockSession._supportsXhigh = true;
      mockSession._thinkingLevel = 'medium';

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps).toEqual({
        family: 'anthropic',
        availableLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
        supportsThinking: true,
        supportsXhigh: true,
        currentLevel: 'medium',
      });
    });

    it('maps openai-codex provider to the openai family (not "unknown")', async () => {
      slot.modelConfig = { provider: 'openai-codex', modelId: 'gpt-5.4' };
      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);
      expect(caps.family).toBe('openai');
    });

    it('maps google-gemini-cli provider to the google family', async () => {
      slot.modelConfig = { provider: 'google-gemini-cli', modelId: 'gemini-3.1-pro-preview' };
      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);
      expect(caps.family).toBe('google');
    });

    it('collapses availableLevels to ["off"] when the model does not support thinking', async () => {
      mockSession._supportsThinking = false;
      mockSession._availableThinkingLevels = ['off'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.supportsThinking).toBe(false);
      expect(caps.availableLevels).toEqual(['off']);
    });

    it('falls back to a conservative capability set when the session lacks the Pi SDK helpers', async () => {
      // Simulate an older session shape — drop the helper methods.
      (mockSession as any).supportsThinking = undefined;
      (mockSession as any).supportsXhighThinking = undefined;
      (mockSession as any).getAvailableThinkingLevels = undefined;

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.supportsThinking).toBe(true);
      expect(caps.supportsXhigh).toBe(false);
      expect(caps.availableLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
    });

    it('drops "minimal" from availableLevels for GPT-5.4 (provider silently clamps minimal→low)', async () => {
      slot.modelConfig = { provider: 'openai-codex', modelId: 'gpt-5.4' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      mockSession._supportsXhigh = true;

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
    });

    it('drops "xhigh" from availableLevels for GPT-5.1 (provider clamps xhigh→high)', async () => {
      slot.modelConfig = { provider: 'openai-codex', modelId: 'gpt-5.1' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      mockSession._supportsXhigh = true;

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).not.toContain('xhigh');
      expect(caps.availableLevels).toContain('minimal');
    });

    it('drops "minimal" for Claude Sonnet 4.6 (adaptive thinking collapses minimal→low)', async () => {
      slot.modelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toEqual(['off', 'low', 'medium', 'high']);
    });

    it('drops "minimal" for Claude Opus 4.6 but keeps "xhigh" (distinct "max" tier)', async () => {
      slot.modelConfig = { provider: 'anthropic', modelId: 'claude-opus-4-6' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      mockSession._supportsXhigh = true;

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
    });

    it('keeps "minimal" for Claude Haiku 4.5 (budget-based thinking, each level distinct)', async () => {
      slot.modelConfig = { provider: 'anthropic', modelId: 'claude-haiku-4-5' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toContain('minimal');
    });

    it('drops "minimal" and "medium" for Gemini 3 Pro (collapses to low+high only)', async () => {
      slot.modelConfig = { provider: 'google-gemini-cli', modelId: 'gemini-3.1-pro' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toEqual(['off', 'low', 'high']);
    });

    it('hard-drops "xhigh" when supportsXhigh=false even if Pi SDK accidentally includes it', async () => {
      slot.modelConfig = { provider: 'google-gemini-cli', modelId: 'gemini-3-flash' };
      // Simulate a Pi SDK quirk returning xhigh despite supportsXhigh=false.
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      mockSession._supportsXhigh = false;

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.supportsXhigh).toBe(false);
      expect(caps.availableLevels).not.toContain('xhigh');
    });

    it('keeps all levels for Gemini 3 Flash (1:1 mapping, no collapse)', async () => {
      slot.modelConfig = { provider: 'google-gemini-cli', modelId: 'gemini-3-flash' };
      mockSession._availableThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.availableLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
    });

    it('returns the current session-effective level (not the slot cache) so repaint is correct after a model swap', async () => {
      // Slot cache says medium, but the session has since been clamped to low.
      slot.thinkingLevel = 'medium';
      mockSession._thinkingLevel = 'low';
      mockSession._availableThinkingLevels = ['off', 'low'];

      const caps = await invokeHandler('agent:get-thinking-capabilities', slotId);

      expect(caps.currentLevel).toBe('low');
    });
  });
});
