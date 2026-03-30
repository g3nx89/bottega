import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

vi.mock('../../../src/main/compression/metrics.js', () => ({
  categorizeToolName: (name: string) => (name.includes('screenshot') ? 'screenshot' : 'core'),
}));

vi.mock('../../../src/main/messages.js', () => ({
  MSG_REQUEST_FAILED_FALLBACK: 'Request failed',
}));

vi.mock('../../../src/main/safe-send.js', () => ({
  safeSend: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────

import { createEventRouter } from '../../../src/main/session-events.js';

// ── Helpers ──────────────────────────────────────

function makeSlot(overrides: Partial<any> = {}): any {
  return {
    id: 'slot-1',
    session: { subscribe: vi.fn(), prompt: vi.fn().mockResolvedValue(undefined) },
    isStreaming: true,
    modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    suggester: {
      appendAssistantText: vi.fn(),
      resetAssistantText: vi.fn(),
      suggest: vi.fn().mockResolvedValue([]),
    },
    promptQueue: {
      dequeue: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
      length: 0,
      clear: vi.fn(),
    },
    turnIndex: 1,
    currentPromptId: 'prompt-abc',
    promptStartTime: Date.now() - 2000,
    lastCompletedPromptId: null,
    lastCompletedTurnIndex: 0,
    ...overrides,
  };
}

function makeTracker(): any {
  return {
    trackToolCall: vi.fn(),
    trackToolError: vi.fn(),
    trackImageGen: vi.fn(),
    trackSuggestionsGenerated: vi.fn(),
    trackPromptDequeued: vi.fn(),
    trackTurnEnd: vi.fn(),
    trackPrompt: vi.fn(),
    trackCompaction: vi.fn(),
  };
}

function makeDeps(overrides: Partial<any> = {}) {
  const slotManager = {
    getSlot: vi.fn().mockReturnValue(null),
    persistState: vi.fn(),
  };
  const mainWindow = { webContents: {} };
  const usageTracker = makeTracker();
  const persistSlotSession = vi.fn();

  return {
    slotManager,
    mainWindow,
    usageTracker,
    persistSlotSession,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────

describe('createEventRouter', () => {
  it('returns an object with subscribeToSlot and finalizeTurn', () => {
    const deps = makeDeps();
    const router = createEventRouter(deps as any);
    expect(router.subscribeToSlot).toBeTypeOf('function');
    expect(router.finalizeTurn).toBeTypeOf('function');
  });

  describe('event handling', () => {
    let deps: ReturnType<typeof makeDeps>;
    let slot: any;
    let eventHandler: (event: any) => void;

    beforeEach(() => {
      deps = makeDeps();
      slot = makeSlot();
      deps.slotManager.getSlot.mockReturnValue(slot);

      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(slot);

      // Capture the event handler passed to session.subscribe
      eventHandler = slot.session.subscribe.mock.calls[0][0];
    });

    it('tracks tool names for turn accumulation on tool_execution_start', () => {
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_screenshot', toolCallId: 'tc-2' });

      // Tool names are accumulated internally — verified via turn_end
    });

    it('passes promptId context to trackToolCall on tool_execution_end', () => {
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      eventHandler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [{ type: 'text', text: 'done' }] },
      });

      expect(deps.usageTracker.trackToolCall).toHaveBeenCalledWith(
        'figma_set_fills',
        'core',
        true,
        expect.any(Number),
        expect.objectContaining({
          promptId: 'prompt-abc',
          slotId: 'slot-1',
          turnIndex: 1,
        }),
      );
    });

    it('includes screenshotMeta for figma_screenshot tool calls', () => {
      eventHandler({
        type: 'tool_execution_start',
        toolName: 'figma_screenshot',
        toolCallId: 'tc-ss',
        toolInput: { nodeId: '1:42', scale: 2, format: 'PNG' },
      });
      eventHandler({
        type: 'tool_execution_end',
        toolName: 'figma_screenshot',
        toolCallId: 'tc-ss',
        isError: false,
        result: { content: [{ type: 'image', data: 'base64...' }] },
      });

      expect(deps.usageTracker.trackToolCall).toHaveBeenCalledWith(
        'figma_screenshot',
        'screenshot',
        true,
        expect.any(Number),
        expect.objectContaining({
          screenshotMeta: { nodeId: '1:42', scale: 2, format: 'PNG' },
        }),
      );
    });

    it('accumulates response char length from text_delta events', () => {
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
      });
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'world' },
      });

      // Verified via turn_end event
      eventHandler({ type: 'agent_end' });

      expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          responseCharLength: 11,
        }),
      );
    });

    it('emits usage:turn_end with full metrics on agent_end', () => {
      // Simulate a turn: text + 2 tool calls
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Let me change that.' },
      });
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      eventHandler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [{ type: 'text', text: 'ok' }] },
      });
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_screenshot', toolCallId: 'tc-2' });
      eventHandler({
        type: 'tool_execution_end',
        toolName: 'figma_screenshot',
        toolCallId: 'tc-2',
        isError: false,
        result: { content: [{ type: 'image', data: 'abc' }] },
      });

      eventHandler({ type: 'agent_end' });

      expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: 'prompt-abc',
          slotId: 'slot-1',
          turnIndex: 1,
          responseCharLength: 'Let me change that.'.length,
          toolCallCount: 2,
          toolNames: expect.arrayContaining(['figma_set_fills', 'figma_screenshot']),
          hasAction: true,
          responseDurationMs: expect.any(Number),
        }),
      );
    });

    it('sets hasAction false for text-only turns', () => {
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Just some explanation.' },
      });
      eventHandler({ type: 'agent_end' });

      expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          hasAction: false,
          toolCallCount: 0,
          toolNames: [],
        }),
      );
    });

    it('preserves lastCompletedPromptId after finalizeTurn', () => {
      eventHandler({ type: 'agent_end' });

      expect(slot.lastCompletedPromptId).toBe('prompt-abc');
      expect(slot.lastCompletedTurnIndex).toBe(1);
      expect(slot.currentPromptId).toBeNull();
      expect(slot.promptStartTime).toBeNull();
    });

    it('resets per-turn state after agent_end', () => {
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'first turn' },
      });
      eventHandler({ type: 'tool_execution_start', toolName: 'figma_status', toolCallId: 'tc-a' });
      eventHandler({
        type: 'tool_execution_end',
        toolName: 'figma_status',
        toolCallId: 'tc-a',
        isError: false,
        result: { content: [{ type: 'text', text: 'connected' }] },
      });
      eventHandler({ type: 'agent_end' });

      // Set up a second turn
      slot.currentPromptId = 'prompt-def';
      slot.turnIndex = 2;
      slot.promptStartTime = Date.now();
      slot.isStreaming = true;

      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'second turn' },
      });
      eventHandler({ type: 'agent_end' });

      // Second turn should have its own data, not carry over from first
      const secondCall = deps.usageTracker.trackTurnEnd.mock.calls[1][0];
      expect(secondCall.promptId).toBe('prompt-def');
      expect(secondCall.responseCharLength).toBe('second turn'.length);
      expect(secondCall.toolCallCount).toBe(0);
    });

    it('does not subscribe to same session twice with same router', () => {
      // beforeEach already subscribed once — calling again with a fresh router
      // but same session object should be guarded by the WeakSet
      const freshDeps = makeDeps();
      freshDeps.slotManager.getSlot.mockReturnValue(slot);
      const router = createEventRouter(freshDeps as any);
      router.subscribeToSlot(slot);
      router.subscribeToSlot(slot); // second call — same session

      expect(slot.session.subscribe).toHaveBeenCalledTimes(2); // 1 from beforeEach + 1 from first router() call
    });
  });
});
