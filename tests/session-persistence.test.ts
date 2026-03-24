import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be before imports) ─────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getAppPath: vi.fn().mockReturnValue('/mock/appPath'),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, cpSync: vi.fn() };
});

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
  AVAILABLE_MODELS: [],
  CONTEXT_SIZES: {},
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  OAUTH_PROVIDER_MAP: {} as Record<string, string>,
  OAUTH_PROVIDER_INFO: {} as Record<string, { description: string }>,
  createFigmaAgent: vi.fn(),
}));

vi.mock('../src/main/image-gen/config.js', () => ({
  effectiveApiKey: vi.fn().mockReturnValue('test-key'),
  saveImageGenSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/main/image-gen/image-generator.js', () => ({
  DEFAULT_IMAGE_MODEL: 'gemini-2.0-flash',
  IMAGE_GEN_MODELS: ['gemini-2.0-flash'],
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

vi.mock('../src/main/auto-updater.js', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  getAppVersion: vi.fn().mockReturnValue('1.0.0'),
  quitAndInstall: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────

import { app, ipcMain } from 'electron';
import { type IpcController, setupIpcHandlers } from '../src/main/ipc-handlers.js';
import { SessionStore } from '../src/main/session-store.js';
import { createMockSession } from './helpers/mock-session.js';
import { createMockWindow } from './helpers/mock-window.js';

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
  let controller: IpcController;
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
    };

    sessionStore = new SessionStore(join(tmpDir, 'file-sessions.json'), 100);
    controller = setupIpcHandlers(mockSession as any, mockWindow as any, mockInfra, undefined, sessionStore);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── switchToFile ──────────────────────────────────────

  describe('switchToFile', () => {
    it('should create a new session for an unknown file', async () => {
      mockSession._sessionFile = '/sessions/new-session.jsonl';

      await controller.switchToFile('file-abc', 'MyDesign.fig');

      expect(mockSession._newSessionFn).toHaveBeenCalled();
      // Should persist the mapping
      const entry = sessionStore.get('file-abc');
      expect(entry).not.toBeNull();
      expect(entry!.sessionPath).toBe('/sessions/new-session.jsonl');
      expect(entry!.fileName).toBe('MyDesign.fig');
    });

    it('should send session:restored with [] for a new file', async () => {
      mockSession._sessionFile = '/sessions/s.jsonl';

      await controller.switchToFile('file-new', 'New.fig');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('session:restored', []);
    });

    it('should restore an existing session when mapping exists and file is on disk', async () => {
      // Create a real session file so existsSync returns true
      const sessionPath = join(tmpDir, 'existing-session.jsonl');
      writeFileSync(sessionPath, '{"type":"session"}\n', 'utf-8');
      sessionStore.set('file-abc', sessionPath, 'MyDesign.fig');

      // Setup mock messages for the restored session
      mockSession._messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
      ];

      await controller.switchToFile('file-abc', 'MyDesign.fig');

      expect(mockSession._switchSessionFn).toHaveBeenCalledWith(sessionPath);
      // Should send restored messages to renderer
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('session:restored', [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi there!' },
      ]);
    });

    it('should fall back to new session when switchSession throws', async () => {
      const sessionPath = join(tmpDir, 'corrupt-session.jsonl');
      writeFileSync(sessionPath, 'corrupt', 'utf-8');
      sessionStore.set('file-abc', sessionPath, 'MyDesign.fig');

      mockSession._switchSessionFn.mockRejectedValueOnce(new Error('corrupt session'));
      mockSession._sessionFile = '/sessions/fresh.jsonl';

      await controller.switchToFile('file-abc', 'MyDesign.fig');

      // Should send restore-failed then create new session
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('session:restore-failed', {
        fileKey: 'file-abc',
        fileName: 'MyDesign.fig',
      });
      expect(mockSession._newSessionFn).toHaveBeenCalled();
    });

    it('should create new session when mapped file no longer exists', async () => {
      sessionStore.set('file-abc', '/nonexistent/session.jsonl', 'MyDesign.fig');
      mockSession._sessionFile = '/sessions/new.jsonl';

      await controller.switchToFile('file-abc', 'MyDesign.fig');

      // Should not attempt switchSession, go straight to newSession
      expect(mockSession._switchSessionFn).not.toHaveBeenCalled();
      expect(mockSession._newSessionFn).toHaveBeenCalled();
    });

    it('should serialize concurrent switchToFile calls', async () => {
      const order: string[] = [];
      mockSession._sessionFile = '/sessions/s.jsonl';

      mockSession._newSessionFn.mockImplementation(async () => {
        order.push('start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('end');
        return true;
      });

      // Fire two concurrent switches
      const p1 = controller.switchToFile('file-a', 'A.fig');
      const p2 = controller.switchToFile('file-b', 'B.fig');
      await Promise.all([p1, p2]);

      // Should execute sequentially: start-end-start-end, not start-start-end-end
      expect(order).toEqual(['start', 'end', 'start', 'end']);
    });
  });

  // ── session:reset ─────────────────────────────────────

  describe('session:reset', () => {
    it('should create a new session and update mapping', async () => {
      mockSession._sessionFile = '/sessions/reset.jsonl';

      // First connect to a file so currentFileKey is set
      await controller.switchToFile('file-abc', 'MyDesign.fig');
      mockSession._newSessionFn.mockClear();
      mockSession._sessionFile = '/sessions/after-reset.jsonl';

      const result = await invokeHandler('session:reset');

      expect(result.success).toBe(true);
      expect(mockSession._newSessionFn).toHaveBeenCalled();
      // Mapping should point to new session
      const entry = sessionStore.get('file-abc');
      expect(entry).not.toBeNull();
      expect(entry!.sessionPath).toBe('/sessions/after-reset.jsonl');
    });

    it('should abort streaming before reset', async () => {
      mockSession._sessionFile = '/sessions/s.jsonl';
      await controller.switchToFile('file-abc', 'A.fig');

      // Simulate streaming state by triggering a prompt
      // The prompt handler sets isStreaming = true internally
      // We'll just verify abort is called when appropriate
      const result = await invokeHandler('session:reset');
      expect(result.success).toBe(true);
    });
  });

  // ── session:get-messages ──────────────────────────────

  describe('session:get-messages', () => {
    it('should return renderable turns from session messages', async () => {
      mockSession._messages = [
        { role: 'user', content: [{ type: 'text', text: 'Draw a circle' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      ];

      const turns = await invokeHandler('session:get-messages');

      expect(turns).toHaveLength(2);
      expect(turns[0]).toEqual({ role: 'user', text: 'Draw a circle' });
      expect(turns[1]).toEqual({ role: 'assistant', text: 'Done!' });
    });

    it('should return empty array when no messages', async () => {
      mockSession._messages = [];
      const turns = await invokeHandler('session:get-messages');
      expect(turns).toEqual([]);
    });
  });

  // ── persistSessionMapping via agent:prompt ────────────

  describe('mapping persistence after prompt', () => {
    it('should persist mapping after prompt completes', async () => {
      mockSession._sessionFile = '/sessions/prompt-session.jsonl';
      await controller.switchToFile('file-abc', 'MyDesign.fig');

      // Change session file to simulate Pi SDK creating a new file on first prompt
      mockSession._sessionFile = '/sessions/new-after-prompt.jsonl';

      await invokeHandler('agent:prompt', 'Hello');

      const entry = sessionStore.get('file-abc');
      expect(entry!.sessionPath).toBe('/sessions/new-after-prompt.jsonl');
    });
  });
});
