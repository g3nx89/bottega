import { vi } from 'vitest';
import { PromptQueue } from '../../src/main/prompt-queue.js';

/**
 * Creates a mock SlotManager for testing.
 * Accepts a session (e.g., from createMockSession() or ScriptedSession) and wraps it in a slot.
 */
export function createMockSlotManager(session: any, opts?: { fileKey?: string; fileName?: string }) {
  const slotId = 'test-slot-id';
  const slot = {
    id: slotId,
    fileKey: opts?.fileKey ?? 'test-file-key',
    fileName: opts?.fileName ?? 'TestFile.fig',
    session,
    isStreaming: false,
    modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
    suggester: {
      trackUserPrompt: vi.fn(),
      appendAssistantText: vi.fn(),
      resetAssistantText: vi.fn(),
      suggest: vi.fn().mockResolvedValue([]),
      reset: vi.fn(),
    },
    promptQueue: new PromptQueue(),
    scopedTools: [],
    createdAt: Date.now(),
  };

  const slotManager = {
    getSlot: vi.fn((id: string) => (id === slotId ? slot : undefined)),
    getSlotByFileKey: vi.fn((fk: string) => (fk === slot.fileKey ? slot : undefined)),
    createSlot: vi.fn().mockResolvedValue(slot),
    removeSlot: vi.fn().mockResolvedValue(undefined),
    recreateSession: vi.fn().mockResolvedValue(undefined),
    listSlots: vi.fn().mockReturnValue([
      {
        id: slotId,
        fileKey: slot.fileKey,
        fileName: slot.fileName,
        isStreaming: false,
        isConnected: true,
        modelConfig: slot.modelConfig,
        queueLength: 0,
      },
    ]),
    setActiveSlot: vi.fn(),
    get activeSlotId() {
      return slotId;
    },
    get activeSlot() {
      return slot;
    },
    restoreFromDisk: vi.fn().mockResolvedValue(0),
    persistState: vi.fn(),
    persistStateSync: vi.fn(),
  };

  return { slotManager, slot, slotId };
}
