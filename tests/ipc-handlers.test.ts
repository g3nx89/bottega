import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be before imports) ─────────────────────────

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('../src/main/agent.js', () => ({
  AVAILABLE_MODELS: [
    { provider: 'anthropic', modelId: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  CONTEXT_SIZES: { default: 128000, large: 1000000 },
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  OAUTH_PROVIDER_MAP: { Anthropic: 'anthropic-oauth' } as Record<string, string>,
  OAUTH_PROVIDER_INFO: { Anthropic: { description: 'Claude' } } as Record<string, { description: string }>,
  createFigmaAgent: vi.fn(),
}));

vi.mock('../src/main/image-gen/config.js', () => ({
  effectiveApiKey: vi.fn().mockReturnValue('test-key'),
  saveImageGenSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/main/image-gen/image-generator.js', () => ({
  DEFAULT_IMAGE_MODEL: 'gemini-2.0-flash',
  IMAGE_GEN_MODELS: ['gemini-2.0-flash', 'dall-e-3'],
  ImageGenerator: class {
    model = 'gemini-2.0-flash';
  },
}));

vi.mock('../src/main/prompt-suggester.js', () => ({
  PromptSuggester: class {
    trackUserPrompt = vi.fn();
    appendAssistantText = vi.fn();
    resetAssistantText = vi.fn();
    suggest = vi.fn().mockResolvedValue([]);
    reset = vi.fn();
  },
}));

// safe-send: use the real implementation so we can test destroyed-window behavior
// (it's a pure function that just checks isDestroyed and calls send)

// ── Imports (after mocks) ─────────────────────────────────────────

import { ipcMain } from 'electron';
import { createFigmaAgent } from '../src/main/agent.js';
import { setupIpcHandlers } from '../src/main/ipc-handlers.js';
import { createMockSession } from './helpers/mock-session.js';
import { createMockWindow } from './helpers/mock-window.js';

// ── Helpers ───────────────────────────────────────────────────────

type MockSession = ReturnType<typeof createMockSession>;
type MockWindow = ReturnType<typeof createMockWindow>;

let mockSession: MockSession;
let mockWindow: MockWindow;
let mockInfra: any;

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
    setupIpcHandlers(mockSession as any, mockWindow as any, mockInfra);
  });

  // ── safeSend (cross-cutting, R6) ──────────────────────────────

  describe('safeSend cross-cutting', () => {
    it('should send IPC messages when webContents is alive', () => {
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', 'hello');
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

      await invokeHandler('agent:prompt', 'test');

      // safeSend should no-op on destroyed window — send must not be called
      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  // ── Streaming lifecycle (R5) ──────────────────────────────────

  describe('streaming lifecycle', () => {
    it('should call session.prompt with text', async () => {
      await invokeHandler('agent:prompt', 'design a button');

      expect(mockSession._promptFn).toHaveBeenCalledWith('design a button');
    });

    it('should send error text-delta and agent:end on prompt failure', async () => {
      mockSession._promptFn.mockRejectedValueOnce(new Error('API timeout'));

      await invokeHandler('agent:prompt', 'test');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        expect.stringContaining('API timeout'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end');
    });

    it('should send agent:end when agent_end event fires', () => {
      mockSession.emitEvent({ type: 'agent_end' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end');
    });

    it('should use followUp streamingBehavior for prompts during streaming', async () => {
      // First prompt starts streaming
      await invokeHandler('agent:prompt', 'first');
      // Simulate agent not yet finished (isStreaming stays true until agent_end)
      // Second prompt should use followUp
      await invokeHandler('agent:prompt', 'follow up');

      expect(mockSession._promptFn).toHaveBeenCalledWith('follow up', {
        streamingBehavior: 'followUp',
      });
    });

    it('should call session.abort and reset streaming state', async () => {
      // Start streaming
      await invokeHandler('agent:prompt', 'start');
      // Abort
      await invokeHandler('agent:abort');

      expect(mockSession._abortFn).toHaveBeenCalled();

      // After abort, next prompt should NOT use followUp (streaming was reset)
      await invokeHandler('agent:prompt', 'fresh start');
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

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', 'some text');
    });

    it('should forward thinking_delta to renderer', () => {
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:thinking', 'thinking...');
    });

    it('should forward tool_execution_start with tool name and callId', () => {
      mockSession.emitEvent({
        type: 'tool_execution_start',
        toolName: 'figma_execute',
        toolCallId: 'call-123',
        toolParams: { code: 'test' },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:tool-start', 'figma_execute', 'call-123');
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
        'figma_screenshot',
        'call-789',
        true,
        expect.any(Object),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:screenshot', imageData);
    });

    it('should forward usage stats on message_end', () => {
      mockSession.emitEvent({
        type: 'message_end',
        message: {
          usage: { input: 1000, output: 500, totalTokens: 1500 },
        },
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:usage', {
        input: 1000,
        output: 500,
        total: 1500,
      });
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should send error and not call session when no API key is configured', async () => {
      mockInfra.authStorage.getApiKey.mockResolvedValueOnce(null);

      await invokeHandler('agent:prompt', 'test');

      expect(mockSession._promptFn).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:text-delta',
        expect.stringContaining('No credentials configured'),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:end');
    });

    it('should reset streaming state on abort', async () => {
      // Start streaming
      await invokeHandler('agent:prompt', 'hello');
      // Abort resets isStreaming
      await invokeHandler('agent:abort');

      // Next prompt should be a fresh start (no followUp)
      await invokeHandler('agent:prompt', 'new prompt');
      const lastCall = mockSession._promptFn.mock.calls[mockSession._promptFn.mock.calls.length - 1];
      expect(lastCall).toEqual(['new prompt']);
    });
  });

  // ── Model switch ──────────────────────────────────────────────

  describe('auth:switch-model', () => {
    it('should create a new session on model switch', async () => {
      const newMockSession = createMockSession();
      (createFigmaAgent as any).mockResolvedValueOnce({ session: newMockSession });

      const newConfig = { provider: 'openai', modelId: 'gpt-5.4' };
      const result = await invokeHandler('auth:switch-model', newConfig);

      expect(result).toEqual({ success: true });
      expect(createFigmaAgent).toHaveBeenCalledWith(mockInfra, newConfig);

      // New session should receive events
      newMockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'from new model' },
      });
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', 'from new model');
    });

    it('should return error and preserve old session on switch failure', async () => {
      (createFigmaAgent as any).mockRejectedValueOnce(new Error('Invalid credentials'));

      const result = await invokeHandler('auth:switch-model', {
        provider: 'openai',
        modelId: 'gpt-5.4',
      });

      expect(result).toEqual({ success: false, error: 'Invalid credentials' });

      // Old session should still work
      mockSession.emitEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'still working' },
      });
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:text-delta', 'still working');
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
});
