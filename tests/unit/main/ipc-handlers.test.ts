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
  ipcMain: { handle: vi.fn() },
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
  execFile: vi.fn().mockImplementation((_cmd: string, _args: string[], _opts: any, cb?: Function) => {
    // promisify calls with 3 args (no callback) — return a ChildProcess-like object
    // When promisified, execFile rejects on non-zero exit (pgrep: no match)
    if (!cb) {
      // promisify style: return value is ignored, the promisified wrapper handles it
    }
    const err = new Error('no process') as any;
    err.code = 1;
    if (cb) cb(err, '', '');
    return { on: vi.fn(), stdout: null, stderr: null, pid: 0 };
  }),
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

    it('should send agent:end when agent_end event fires', () => {
      slot.isStreaming = true; // agent_end only fires while streaming
      mockSession.emitEvent({ type: 'agent_end' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
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
      // subsequent existsSync calls (Figma settings check) return default false

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
      // subsequent existsSync calls (Figma settings check) return default false

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
      // isFigmaRunning: default mock (pgrep fails → not running)
      // ensurePluginRegistered: settings.json does NOT exist (default false)

      const result = await syncFigmaPlugin();

      expect(result.synced).toBe(true);
      expect(result.figmaRunning).toBe(false);
      expect(result.autoRegistered).toBe(false);
      expect(result.alreadyRegistered).toBe(false);
    });

    it('detects already registered plugin', async () => {
      (existsSync as any).mockReturnValueOnce(true); // source found
      (existsSync as any).mockReturnValueOnce(false); // dest manifest missing → needs sync
      // isFigmaRunning: pgrep fails → not running (default mock)
      // ensurePluginRegistered: settings.json exists
      (existsSync as any).mockReturnValueOnce(true);
      (readFileSync as any).mockReturnValueOnce(
        JSON.stringify({
          localFileExtensions: [
            {
              id: 1,
              manifestPath: '/some/path/manifest.json',
              lastKnownPluginId: 'bottega-bridge',
              fileMetadata: { type: 'manifest', codeFileId: 2, uiFileIds: [3] },
            },
          ],
        }),
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
      // isPluginRegistered: settings.json exists with plugin entry
      (existsSync as any).mockReturnValueOnce(true);
      (readFileSync as any).mockReturnValueOnce(
        JSON.stringify({
          localFileExtensions: [
            {
              id: 1,
              manifestPath: '/mock/userData/figma-plugin/manifest.json',
              lastKnownPluginId: 'bottega-bridge',
              fileMetadata: { type: 'manifest', codeFileId: 2, uiFileIds: [3] },
            },
          ],
        }),
      );
      // isFigmaRunning: pgrep succeeds → Figma IS running
      // Generic promisify resolves single-arg callbacks as-is, so pass an object
      // with { stdout } to match the destructuring in isFigmaRunning.
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
        .mockReturnValueOnce({ size: 10000 }); // dest code.js size

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

  // ── Agent_end queue drain ─────────────────────────────────────

  describe('agent_end queue drain', () => {
    /** Gets the subscriber callback registered by subscribeSlot() */
    function getSubscriberCb(): (event: any) => void {
      const subscribers = (slot.session as any).subscribers as Array<(event: any) => void>;
      return subscribers[subscribers.length - 1];
    }

    it('agent_end with empty queue sends agent:end to renderer', () => {
      slot.isStreaming = true; // agent_end only fires while streaming
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end', slotId);
      expect(slot.isStreaming).toBe(false);
    });

    it('agent_end with queued prompt auto-sends next prompt', async () => {
      slot.promptQueue.enqueue('next prompt');
      slot.isStreaming = true;
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      // Flush the microtask queue so the .catch handler in handleAgentEnd settles
      await Promise.resolve();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:queued-prompt-start', slotId, 'next prompt');
      expect(mockSession._promptFn).toHaveBeenCalledWith('next prompt');
      const endCalls = (mockWindow.webContents.send as any).mock.calls.filter((c: any[]) => c[0] === 'agent:end');
      expect(endCalls).toHaveLength(0);
    });

    it('agent_end drain sends queue:updated event', async () => {
      slot.promptQueue.enqueue('next prompt');
      slot.isStreaming = true;
      const subscriberCb = getSubscriberCb();

      subscriberCb({ type: 'agent_end' });

      await Promise.resolve();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
    });

    it('agent:prompt while streaming enqueues prompt', async () => {
      slot.isStreaming = true;

      await invokeHandler('agent:prompt', slotId, 'queued text');

      expect(slot.promptQueue.length).toBe(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('queue:updated', slotId, expect.any(Array));
    });
  });
});
