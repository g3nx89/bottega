import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be before imports) ─────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData'), getAppPath: vi.fn().mockReturnValue('/mock/appPath') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

vi.mock('../../../src/main/agent.js', async () => {
  const actual = await vi.importActual('../../../src/main/agent.js');
  return {
    ...actual,
    createScopedTools: vi.fn().mockReturnValue({
      tools: [{ name: 'mock_tool' }],
      connector: {},
    }),
    createFigmaAgentForSlot: vi.fn().mockResolvedValue({
      session: {
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(),
        newSession: vi.fn().mockResolvedValue(true),
        switchSession: vi.fn().mockResolvedValue(true),
        setThinkingLevel: vi.fn(),
        sessionFile: '/tmp/test-session.jsonl',
        messages: [],
      },
    }),
  };
});

vi.mock('../../../src/main/prompt-suggester.js', () => ({
  PromptSuggester: class {
    trackUserPrompt = vi.fn();
    appendAssistantText = vi.fn();
    resetAssistantText = vi.fn();
    suggest = vi.fn().mockResolvedValue([]);
    reset = vi.fn();
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────

import { createFigmaAgentForSlot, createScopedTools, DEFAULT_MODEL } from '../../../src/main/agent.js';
import { AppStatePersistence } from '../../../src/main/app-state-persistence.js';
import { SessionStore } from '../../../src/main/session-store.js';
import { MAX_SLOTS, SlotManager } from '../../../src/main/slot-manager.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slot-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInfra(overrides: Partial<any> = {}): any {
  return {
    authStorage: {
      getApiKey: vi.fn().mockResolvedValue('test-key'),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn(),
    },
    modelRegistry: {},
    sessionManager: {},
    configManager: {
      getProfiles: vi.fn().mockReturnValue(['minimal', 'balanced', 'full']),
      getActiveProfile: vi.fn().mockReturnValue('balanced'),
      setProfile: vi.fn(),
      getActiveConfig: vi.fn().mockReturnValue({ designSystemCacheTtlMs: 60000 }),
    },
    designSystemCache: { invalidate: vi.fn() },
    metricsCollector: { finalize: vi.fn() },
    compressionExtensionFactory: vi.fn(),
    wsServer: { getConnectedFiles: vi.fn().mockReturnValue([]) },
    figmaAPI: {},
    queueManager: {
      getQueue: vi.fn().mockReturnValue({ execute: vi.fn() }),
      removeQueue: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      size: 0,
    },
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────

describe('SlotManager', () => {
  let tmpDir: string;
  let appState: AppStatePersistence;
  let sessionStore: SessionStore;
  let wsServer: { getConnectedFiles: ReturnType<typeof vi.fn> };
  let infra: any;
  let manager: SlotManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    appState = new AppStatePersistence(join(tmpDir, 'app-state.json'));
    sessionStore = new SessionStore(join(tmpDir, 'file-sessions.json'));
    wsServer = { getConnectedFiles: vi.fn().mockReturnValue([]) };
    infra = makeInfra({ wsServer });

    // Re-apply mocks cleared by vi.clearAllMocks()
    (createScopedTools as ReturnType<typeof vi.fn>).mockReturnValue({
      tools: [{ name: 'mock_tool' }],
      connector: {},
    });
    (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(),
        newSession: vi.fn().mockResolvedValue(true),
        switchSession: vi.fn().mockResolvedValue(true),
        setThinkingLevel: vi.fn(),
        sessionFile: '/tmp/test-session.jsonl',
        messages: [],
      },
    });

    manager = new SlotManager(infra, sessionStore, appState, wsServer as any);
  });

  afterEach(() => {
    appState.cancelPendingSave();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── createSlot ────────────────────────────────────────────────

  describe('createSlot', () => {
    it('creates a slot with fileKey and fileName', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(slot.fileKey).toBe('file-abc');
      expect(slot.fileName).toBe('Design.fig');
    });

    it('returns a SessionSlot with all expected fields', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(slot.id).toBeTypeOf('string');
      expect(slot.fileKey).toBe('file-abc');
      expect(slot.fileName).toBe('Design.fig');
      expect(slot.isStreaming).toBe(false);
      expect(slot.promptQueue).toBeDefined();
      expect(slot.scopedTools).toBeDefined();
      expect(slot.session).toBeDefined();
      expect(slot.createdAt).toBeTypeOf('number');
    });

    it('initializes turn tracking fields', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(slot.turnIndex).toBe(0);
      expect(slot.currentPromptId).toBeNull();
      expect(slot.promptStartTime).toBeNull();
      expect(slot.lastCompletedPromptId).toBeNull();
      expect(slot.lastCompletedTurnIndex).toBe(0);
    });

    it('sets first slot as active automatically', async () => {
      expect(manager.activeSlotId).toBeNull();

      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(manager.activeSlotId).toBe(slot.id);
    });

    it('does not change activeSlotId when second slot is created', async () => {
      const first = await manager.createSlot('file-abc', 'Design.fig');
      await manager.createSlot('file-def', 'Other.fig');

      expect(manager.activeSlotId).toBe(first.id);
    });

    it('throws when duplicate fileKey', async () => {
      await manager.createSlot('file-abc', 'Design.fig');

      await expect(manager.createSlot('file-abc', 'Design.fig')).rejects.toThrow('file-abc');
    });

    it('throws when MAX_SLOTS reached', async () => {
      for (let i = 0; i < MAX_SLOTS; i++) {
        await manager.createSlot(`file-${i}`, `File${i}.fig`);
      }

      await expect(manager.createSlot('file-extra', 'Extra.fig')).rejects.toThrow(
        `Maximum number of tabs (${MAX_SLOTS}) reached`,
      );
    });

    it('calls createScopedTools with correct fileKey', async () => {
      await manager.createSlot('file-abc', 'Design.fig');

      expect(createScopedTools).toHaveBeenCalledWith(infra, 'file-abc');
    });

    it('calls createFigmaAgentForSlot with default model', async () => {
      await manager.createSlot('file-abc', 'Design.fig');

      expect(createFigmaAgentForSlot).toHaveBeenCalledWith(infra, [{ name: 'mock_tool' }], DEFAULT_MODEL);
    });

    it('calls createFigmaAgentForSlot with custom model', async () => {
      const customModel = { provider: 'openai', modelId: 'gpt-4o' };
      await manager.createSlot('file-abc', 'Design.fig', customModel);

      expect(createFigmaAgentForSlot).toHaveBeenCalledWith(infra, [{ name: 'mock_tool' }], customModel);
    });

    it('calls createScopedTools with __unbound__ when no fileKey', async () => {
      await manager.createSlot();

      expect(createScopedTools).toHaveBeenCalledWith(infra, '__unbound__');
    });

    it('tries switchSession when SessionStore has entry for fileKey', async () => {
      sessionStore.set('file-abc', '/sessions/old-session.jsonl', 'Design.fig');

      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(slot.session.switchSession).toHaveBeenCalledWith('/sessions/old-session.jsonl');
    });

    it('falls back to newSession when switchSession fails', async () => {
      sessionStore.set('file-abc', '/sessions/old-session.jsonl', 'Design.fig');

      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(),
        newSession: vi.fn().mockResolvedValue(true),
        switchSession: vi.fn().mockRejectedValue(new Error('session corrupted')),
        setThinkingLevel: vi.fn(),
        sessionFile: '/tmp/test-session.jsonl',
        messages: [],
      };
      (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ session: mockSession });

      const slot = await manager.createSlot('file-abc', 'Design.fig');

      expect(slot.session.switchSession).toHaveBeenCalled();
      expect(slot.session.newSession).toHaveBeenCalled();
    });
  });

  // ── getSlot / getSlotByFileKey ─────────────────────────────────

  describe('getSlot / getSlotByFileKey', () => {
    it('getSlot returns correct slot', async () => {
      const created = await manager.createSlot('file-abc', 'Design.fig');

      const retrieved = manager.getSlot(created.id);

      expect(retrieved).toBe(created);
    });

    it('getSlot returns undefined for unknown ID', () => {
      expect(manager.getSlot('nonexistent-id')).toBeUndefined();
    });

    it('getSlotByFileKey returns correct slot', async () => {
      const created = await manager.createSlot('file-abc', 'Design.fig');

      const retrieved = manager.getSlotByFileKey('file-abc');

      expect(retrieved).toBe(created);
    });

    it('getSlotByFileKey returns undefined for unknown fileKey', () => {
      expect(manager.getSlotByFileKey('unknown-file-key')).toBeUndefined();
    });
  });

  // ── removeSlot ────────────────────────────────────────────────

  describe('removeSlot', () => {
    it('removes slot from map', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');

      await manager.removeSlot(slot.id);

      expect(manager.getSlot(slot.id)).toBeUndefined();
    });

    it('throws for unknown slotId', async () => {
      await expect(manager.removeSlot('nonexistent-id')).rejects.toThrow('Slot not found: nonexistent-id');
    });

    it('aborts session and clears queue if streaming', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');
      slot.isStreaming = true;
      slot.promptQueue.enqueue('pending prompt');

      await manager.removeSlot(slot.id);

      expect(slot.session.abort).toHaveBeenCalled();
      expect(slot.promptQueue.length).toBe(0);
    });

    it('switches activeSlotId to next available slot', async () => {
      const first = await manager.createSlot('file-abc', 'Design.fig');
      const second = await manager.createSlot('file-def', 'Other.fig');

      // first is active; remove it
      await manager.removeSlot(first.id);

      expect(manager.activeSlotId).toBe(second.id);
    });

    it('sets activeSlotId to null when last slot removed', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');

      await manager.removeSlot(slot.id);

      expect(manager.activeSlotId).toBeNull();
    });
  });

  // ── recreateSession ───────────────────────────────────────────

  describe('recreateSession', () => {
    it('creates new session with new model config', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');
      const newConfig = { provider: 'openai', modelId: 'gpt-5.4' };

      await manager.recreateSession(slot.id, newConfig);

      expect(createFigmaAgentForSlot).toHaveBeenLastCalledWith(infra, expect.any(Array), newConfig);
    });

    it('updates slot session and modelConfig, reuses scopedTools', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');
      const originalSession = slot.session;
      const originalTools = slot.scopedTools;
      const newConfig = { provider: 'openai', modelId: 'gpt-5.4' };

      const newSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(),
        newSession: vi.fn().mockResolvedValue(true),
        switchSession: vi.fn().mockResolvedValue(true),
        setThinkingLevel: vi.fn(),
        sessionFile: '/tmp/new-session.jsonl',
        messages: [],
      };
      (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ session: newSession });

      await manager.recreateSession(slot.id, newConfig);

      expect(slot.session).not.toBe(originalSession);
      expect(slot.modelConfig).toEqual(newConfig);
      expect(slot.scopedTools).toBe(originalTools); // reused, not recreated
    });

    it('throws for unknown slotId', async () => {
      await expect(
        manager.recreateSession('nonexistent-id', { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }),
      ).rejects.toThrow('Slot not found: nonexistent-id');
    });

    it('aborts if slot was streaming and resets isStreaming', async () => {
      const slot = await manager.createSlot('file-abc', 'Design.fig');
      const originalSession = slot.session;
      slot.isStreaming = true;
      slot.promptQueue.enqueue('queued text');

      await manager.recreateSession(slot.id, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' });

      expect(originalSession.abort).toHaveBeenCalled();
      expect(slot.isStreaming).toBe(false);
      expect(slot.promptQueue.length).toBe(0);
    });
  });

  // ── listSlots ─────────────────────────────────────────────────

  describe('listSlots', () => {
    it('returns SlotInfo[] with correct fields', async () => {
      wsServer.getConnectedFiles.mockReturnValue([{ fileKey: 'file-abc' }]);
      await manager.createSlot('file-abc', 'Design.fig');

      const list = manager.listSlots();

      expect(list).toHaveLength(1);
      const info = list[0];
      expect(info.id).toBeTypeOf('string');
      expect(info.fileKey).toBe('file-abc');
      expect(info.fileName).toBe('Design.fig');
      expect(info.isStreaming).toBe(false);
      expect(info.isConnected).toBe(true);
      expect(info.modelConfig).toBeDefined();
      expect(info.queueLength).toBe(0);
    });

    it('returns isConnected false when file is not in wsServer', async () => {
      wsServer.getConnectedFiles.mockReturnValue([]);
      await manager.createSlot('file-abc', 'Design.fig');

      const list = manager.listSlots();

      expect(list[0].isConnected).toBe(false);
    });
  });

  // ── persistState / restoreFromDisk ────────────────────────────

  describe('persistState / restoreFromDisk', () => {
    it('persistState writes state via AppStatePersistence', async () => {
      await manager.createSlot('file-abc', 'Design.fig');

      // Force a sync write so we can verify the file was written
      appState.saveSync(
        (manager as any).buildPersistedState
          ? (manager as any).buildPersistedState()
          : AppStatePersistence.createState('file-abc', [
              {
                fileKey: 'file-abc',
                fileName: 'Design.fig',
                modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
                promptQueue: [],
              },
            ]),
      );

      const loaded = appState.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.slots).toHaveLength(1);
      expect(loaded!.slots[0].fileKey).toBe('file-abc');
    });

    it('restoreFromDisk creates slots from saved state and restores prompt queues', async () => {
      // Populate and save state directly
      const savedState = AppStatePersistence.createState('file-abc', [
        {
          fileKey: 'file-abc',
          fileName: 'Saved.fig',
          modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
          promptQueue: [{ id: 'q1', text: 'pending prompt', addedAt: Date.now() }],
        },
      ]);
      appState.saveSync(savedState);

      const freshManager = new SlotManager(infra, sessionStore, appState, wsServer as any);
      const count = await freshManager.restoreFromDisk();

      expect(count).toBe(1);
      const slot = freshManager.getSlotByFileKey('file-abc');
      expect(slot).toBeDefined();
      expect(slot!.fileName).toBe('Saved.fig');
      expect(slot!.promptQueue.length).toBe(1);
    });
  });

  // ── setActiveSlot ─────────────────────────────────────────────

  describe('setActiveSlot', () => {
    it('sets active slot ID', async () => {
      const _first = await manager.createSlot('file-abc', 'Design.fig');
      const second = await manager.createSlot('file-def', 'Other.fig');

      manager.setActiveSlot(second.id);

      expect(manager.activeSlotId).toBe(second.id);
    });

    it('activeSlot getter returns slot matching activeSlotId', async () => {
      const _first = await manager.createSlot('file-abc', 'Design.fig');
      const second = await manager.createSlot('file-def', 'Other.fig');

      manager.setActiveSlot(second.id);

      expect(manager.activeSlot).toBe(second);
    });
  });

  // ── removeSlot with abort rejection ──────────────────────────────

  describe('removeSlot with abort rejection', () => {
    it('propagates abort rejection but slot remains until caller retries', async () => {
      const abortError = new Error('abort failed: stream already closed');
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockRejectedValue(abortError),
        subscribe: vi.fn(),
        newSession: vi.fn().mockResolvedValue(true),
        switchSession: vi.fn().mockResolvedValue(true),
        setThinkingLevel: vi.fn(),
        sessionFile: '/tmp/test-session.jsonl',
        messages: [],
      };
      (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ session: mockSession });

      const slot = await manager.createSlot('file-abort', 'Abort.fig');
      slot.isStreaming = true;
      slot.promptQueue.enqueue('pending prompt');

      // removeSlot propagates the abort() rejection — cleanup after await never runs
      await expect(manager.removeSlot(slot.id)).rejects.toThrow('abort failed');

      // Slot is still present because abort() threw before cleanup
      expect(manager.getSlot(slot.id)).toBeDefined();

      // Caller can recover: mark streaming false and retry removeSlot
      slot.isStreaming = false;
      await manager.removeSlot(slot.id);

      expect(manager.getSlot(slot.id)).toBeUndefined();
      expect(manager.getSlotByFileKey('file-abort')).toBeUndefined();
    });
  });

  // ── recreateSession lock contention ──────────────────────────────

  describe('recreateSession lock contention', () => {
    it('second concurrent recreateSession returns early without duplicating work', async () => {
      // Make createFigmaAgentForSlot slow so the first call is still in-flight
      let resolveFirst!: (value: any) => void;
      const slowAgent = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      const slot = await manager.createSlot('file-lock', 'Lock.fig');
      const originalCallCount = (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mock.calls.length;

      (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mockImplementationOnce(() => slowAgent);

      const newConfig = { provider: 'openai', modelId: 'gpt-5' };

      // First call — will be blocked on slowAgent
      const first = manager.recreateSession(slot.id, newConfig);
      // Second call — should return early due to lock
      const second = manager.recreateSession(slot.id, newConfig);

      // The second call resolves immediately (no-op)
      await second;

      // Now let the first call complete
      resolveFirst({
        session: {
          prompt: vi.fn().mockResolvedValue(undefined),
          abort: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn(),
          newSession: vi.fn().mockResolvedValue(true),
          switchSession: vi.fn().mockResolvedValue(true),
          setThinkingLevel: vi.fn(),
          sessionFile: '/tmp/new-session.jsonl',
          messages: [],
        },
      });
      await first;

      // createFigmaAgentForSlot should have been called only once more (from the first call)
      const newCallCount = (createFigmaAgentForSlot as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(newCallCount - originalCallCount).toBe(1);
    });
  });

  // ── Rapid create/remove cycles ───────────────────────────────────

  describe('rapid create/remove cycles', () => {
    it('4 rapid create/remove cycles leave no stale state', async () => {
      const fileKeys = ['file-r0', 'file-r1', 'file-r2', 'file-r3'];

      for (const fk of fileKeys) {
        const slot = await manager.createSlot(fk, `${fk}.fig`);
        await manager.removeSlot(slot.id);
      }

      // All slots should be gone
      expect(manager.listSlots()).toHaveLength(0);
      expect(manager.activeSlotId).toBeNull();

      // No stale fileKeyIndex entries — re-creating the same keys should succeed
      for (const fk of fileKeys) {
        const slot = await manager.createSlot(fk, `${fk}.fig`);
        expect(manager.getSlotByFileKey(fk)).toBe(slot);
        await manager.removeSlot(slot.id);
      }
    });
  });

  // ── Concurrent removeSlot on different slots ─────────────────────

  describe('concurrent removeSlot on different slots', () => {
    it('Promise.all removeSlot on 4 slots removes all and nulls activeSlotId', async () => {
      const slots = [];
      for (let i = 0; i < 4; i++) {
        slots.push(await manager.createSlot(`file-c${i}`, `Conc${i}.fig`));
      }
      expect(manager.listSlots()).toHaveLength(4);

      // Remove all in parallel
      await Promise.all(slots.map((s) => manager.removeSlot(s.id)));

      expect(manager.listSlots()).toHaveLength(0);
      expect(manager.activeSlotId).toBeNull();

      // Verify no stale fileKeyIndex entries
      for (let i = 0; i < 4; i++) {
        expect(manager.getSlotByFileKey(`file-c${i}`)).toBeUndefined();
      }
    });
  });
});
