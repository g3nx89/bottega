import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be before imports) ─────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getAppPath: vi.fn().mockReturnValue('/mock/appPath'),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, cpSync: vi.fn() };
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
  AVAILABLE_MODELS: [],
  CONTEXT_SIZES: {},
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  OAUTH_PROVIDER_MAP: {} as Record<string, string>,
  OAUTH_PROVIDER_INFO: {} as Record<string, { description: string }>,
  createFigmaAgent: vi.fn(),
  safeReloadAuth: vi.fn(),
  wrapPromptWithErrorCapture: vi.fn(async (session: any, text: string) => {
    return session.prompt(text);
  }),
}));

vi.mock('../../../src/main/image-gen/config.js', () => ({
  effectiveApiKey: vi.fn().mockReturnValue('test-key'),
  saveImageGenSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/main/image-gen/image-generator.js', () => ({
  DEFAULT_IMAGE_MODEL: 'gemini-2.0-flash',
  IMAGE_GEN_MODELS: ['gemini-2.0-flash'],
  ImageGenerator: class {
    model = 'gemini-2.0-flash';
  },
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

// ── Imports (after mocks) ─────────────────────────────────────────

import { app, ipcMain } from 'electron';
import { setupIpcHandlers } from '../../../src/main/ipc-handlers.js';
import { SessionStore } from '../../../src/main/session-store.js';
import { createMockSession } from '../../helpers/mock-session.js';
import { createMockSlotManager } from '../../helpers/mock-slot-manager.js';
import { createMockWindow } from '../../helpers/mock-window.js';

// ── Helpers ───────────────────────────────────────────────────────

type MockSession = ReturnType<typeof createMockSession>;
type MockWindow = ReturnType<typeof createMockWindow>;

function getHandler(channel: string) {
  const call = (ipcMain.handle as any).mock.calls.find((c: any) => c[0] === channel);
  if (!call) throw new Error(`No handler registered for channel "${channel}"`);
  return call[1];
}

async function invokeHandler(channel: string, ...args: any[]) {
  return getHandler(channel)({ sender: {} }, ...args);
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `bottega-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Test suite ────────────────────────────────────────────────────

describe('Session persistence IPC', () => {
  let mockSession: MockSession;
  let mockWindow: MockWindow;
  let mockInfra: any;
  let sessionStore: SessionStore;
  let slotId: string;
  let slot: any;
  let slotManager: any;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    (app.getPath as any).mockReturnValue('/mock/userData');
    (app.getAppPath as any).mockReturnValue('/mock/appPath');
    (process as any).resourcesPath = '/mock/resources';

    tmpDir = makeTmpDir();
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
        getProfiles: vi.fn().mockReturnValue(['balanced']),
        getActiveProfile: vi.fn().mockReturnValue('balanced'),
        setProfile: vi.fn(),
      },
      designSystemCache: { invalidate: vi.fn() },
      metricsCollector: { finalize: vi.fn() },
      setWorkflowContext: vi.fn(),
    };

    sessionStore = new SessionStore(join(tmpDir, 'file-sessions.json'), 100);
    const mock = createMockSlotManager(mockSession, { fileKey: 'file-abc', fileName: 'MyDesign.fig' });
    slotId = mock.slotId;
    slot = mock.slot;
    slotManager = mock.slotManager;

    const ipcController = setupIpcHandlers({
      slotManager: slotManager as any,
      mainWindow: mockWindow as any,
      infra: mockInfra,
      sessionStore,
    });
    ipcController.subscribeSlot(slot as any);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── session:reset ─────────────────────────────────────

  describe('session:reset', () => {
    it('should create a new session and return success', async () => {
      mockSession._sessionFile = '/sessions/reset.jsonl';

      const result = await invokeHandler('session:reset', slotId);

      expect(result.success).toBe(true);
      expect(mockSession._newSessionFn).toHaveBeenCalled();
    });

    it('should abort streaming before reset', async () => {
      mockSession._sessionFile = '/sessions/s.jsonl';
      // Simulate streaming state
      slot.isStreaming = true;

      const result = await invokeHandler('session:reset', slotId);

      expect(result.success).toBe(true);
      expect(mockSession._abortFn).toHaveBeenCalled();
      expect(mockSession._newSessionFn).toHaveBeenCalled();
    });

    it('should not abort when not streaming', async () => {
      mockSession._sessionFile = '/sessions/s.jsonl';
      slot.isStreaming = false;

      const result = await invokeHandler('session:reset', slotId);

      expect(result.success).toBe(true);
      expect(mockSession._abortFn).not.toHaveBeenCalled();
      expect(mockSession._newSessionFn).toHaveBeenCalled();
    });

    it('should return error when session.newSession throws', async () => {
      mockSession._newSessionFn.mockRejectedValueOnce(new Error('disk full'));

      const result = await invokeHandler('session:reset', slotId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
    });

    it('should return error when slot not found', async () => {
      await expect(invokeHandler('session:reset', 'nonexistent-slot-id')).rejects.toThrow('Slot not found');
    });
  });

  // ── session:get-messages ──────────────────────────────

  describe('session:get-messages', () => {
    it('should return renderable turns from session messages', async () => {
      mockSession._messages = [
        { role: 'user', content: [{ type: 'text', text: 'Draw a circle' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      ];

      const turns = await invokeHandler('session:get-messages', slotId);

      expect(turns).toHaveLength(2);
      expect(turns[0]).toEqual({ role: 'user', text: 'Draw a circle' });
      expect(turns[1]).toEqual({ role: 'assistant', text: 'Done!' });
    });

    it('should return empty array when no messages', async () => {
      mockSession._messages = [];
      const turns = await invokeHandler('session:get-messages', slotId);
      expect(turns).toEqual([]);
    });

    it('should return error when slot not found', async () => {
      await expect(invokeHandler('session:get-messages', 'nonexistent-slot-id')).rejects.toThrow('Slot not found');
    });
  });

  // ── persistSessionMapping via agent:prompt ────────────

  describe('mapping persistence after prompt', () => {
    it('should call session.prompt with text', async () => {
      mockSession._sessionFile = '/sessions/prompt-session.jsonl';

      await invokeHandler('agent:prompt', slotId, 'Hello');

      expect(mockSession._promptFn).toHaveBeenCalledWith('Hello');
    });

    it('should persist session mapping via sessionStore after prompt completes', async () => {
      mockSession._sessionFile = '/sessions/prompt-session.jsonl';

      await invokeHandler('agent:prompt', slotId, 'Hello');

      // sessionStore.set is called via persistSlotSession inside ipc-handlers
      // The slot has fileKey='file-abc', fileName='MyDesign.fig'
      const entry = sessionStore.get('file-abc');
      expect(entry).not.toBeNull();
      expect(entry!.sessionPath).toBe('/sessions/prompt-session.jsonl');
      expect(entry!.fileName).toBe('MyDesign.fig');
    });
  });

  // ── SessionStore integration ───────────────────────────

  describe('SessionStore integration', () => {
    it('should store and retrieve session entries', () => {
      const sessionPath = join(tmpDir, 'test-session.jsonl');
      writeFileSync(sessionPath, '{"type":"session"}\n', 'utf-8');

      sessionStore.set('file-xyz', sessionPath, 'Design.fig');
      const entry = sessionStore.get('file-xyz');

      expect(entry).not.toBeNull();
      expect(entry!.sessionPath).toBe(sessionPath);
      expect(entry!.fileName).toBe('Design.fig');
    });

    it('should return null for unknown file keys', () => {
      const entry = sessionStore.get('nonexistent-key');
      expect(entry).toBeNull();
    });

    it('should persist state via slotManager on session reset', async () => {
      const result = await invokeHandler('session:reset', slotId);

      expect(result.success).toBe(true);
      expect(slotManager.persistState).toHaveBeenCalled();
    });
  });

  // ── Tab management ─────────────────────────────────────

  describe('tab handlers', () => {
    it('tab:list should return slot list from slotManager', async () => {
      const result = await invokeHandler('tab:list');

      expect(slotManager.listSlots).toHaveBeenCalled();
      expect(result).toEqual([expect.objectContaining({ id: slotId, fileKey: 'file-abc', fileName: 'MyDesign.fig' })]);
    });

    it('tab:activate should set active slot', async () => {
      const result = await invokeHandler('tab:activate', slotId);

      expect(result).toEqual({ success: true });
      expect(slotManager.setActiveSlot).toHaveBeenCalledWith(slotId);
    });

    it('tab:close should remove slot', async () => {
      const result = await invokeHandler('tab:close', slotId);

      expect(result).toEqual({ success: true });
      expect(slotManager.removeSlot).toHaveBeenCalledWith(slotId);
    });

    it('tab:close should return error when remove fails', async () => {
      slotManager.removeSlot.mockRejectedValueOnce(new Error('slot busy'));

      const result = await invokeHandler('tab:close', slotId);

      expect(result).toEqual({ success: false, error: 'slot busy' });
    });
  });
});
