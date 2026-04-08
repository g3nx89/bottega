import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

vi.mock('../../../src/main/compression/metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/compression/metrics.js')>();
  return {
    ...actual,
    categorizeToolName: vi.fn((name: string) => (name.includes('screenshot') ? 'screenshot' : 'core')),
  };
});

vi.mock('../../../src/main/subagent/config.js', () => ({
  loadSubagentSettings: vi.fn(() => ({ judgeMode: 'off', autoRetry: false, maxRetries: 2, models: {} })),
}));

vi.mock('../../../src/main/subagent/judge-harness.js', () => ({
  runJudgeHarness: vi.fn().mockResolvedValue(null),
  abortActiveJudge: vi.fn(),
  READ_ONLY_CATEGORIES: new Set(['discovery', 'screenshot', 'task', 'other']),
}));

vi.mock('../../../src/main/messages.js', () => ({
  MSG_REQUEST_FAILED_FALLBACK: 'Request failed',
  MSG_EMPTY_TURN_WARNING: 'Empty turn warning',
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
    sessionToolHistory: new Set<string>(),
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
    trackContextLevel: vi.fn(),
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
    contextSizes: { 'claude-sonnet-4-6': 1_000_000 },
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

    it('accumulates response char length from text_delta events', async () => {
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
      });
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'world' },
      });

      // agent_end is async (judge harness) — flush microtasks
      eventHandler({ type: 'agent_end' });
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          responseCharLength: 11,
        }),
      );
    });

    it('emits usage:turn_end with full metrics on agent_end', async () => {
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
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

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

    it('sets hasAction false for text-only turns', async () => {
      eventHandler({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Just some explanation.' },
      });
      eventHandler({ type: 'agent_end' });
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          hasAction: false,
          toolCallCount: 0,
          toolNames: [],
        }),
      );
    });

    it('preserves lastCompletedPromptId after finalizeTurn', async () => {
      eventHandler({ type: 'agent_end' });
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(slot.lastCompletedPromptId).toBe('prompt-abc');
      expect(slot.lastCompletedTurnIndex).toBe(1);
      expect(slot.currentPromptId).toBeNull();
      expect(slot.promptStartTime).toBeNull();
    });

    it('resets per-turn state after agent_end', async () => {
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
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

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
      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      // Second turn should have its own data, not carry over from first
      const secondCall = deps.usageTracker.trackTurnEnd.mock.calls[1][0];
      expect(secondCall.promptId).toBe('prompt-def');
      expect(secondCall.responseCharLength).toBe('second turn'.length);
      expect(secondCall.toolCallCount).toBe(0);
    });

    it('does not emit agent:end if user aborted during judge harness', async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { runJudgeHarness } = await import('../../../src/main/subagent/judge-harness.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      const { safeSend } = await import('../../../src/main/safe-send.js');

      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: false, maxRetries: 0, models: {} });
      (categorizeToolName as any).mockReturnValue('mutation');

      const judgeSlot = makeSlot();
      let capturedSlot: any = null;

      // Simulate: judge resolves, but during the await user has aborted (slot.isStreaming = false)
      (runJudgeHarness as any).mockImplementation(async () => {
        capturedSlot.isStreaming = false;
        return null;
      });

      const mockConnector = {};
      const judgeDeps = makeDeps({
        infra: {},
        getConnectorForSlot: () => mockConnector,
      });
      judgeDeps.slotManager.getSlot.mockReturnValue(judgeSlot);
      capturedSlot = judgeSlot;

      const { subscribeToSlot } = createEventRouter(judgeDeps as any);
      subscribeToSlot(judgeSlot);
      const judgeEventHandler = judgeSlot.session.subscribe.mock.calls[0][0];

      // Clear accumulated calls from previous tests
      (safeSend as any).mockClear();

      // Fire a mutation tool then agent_end
      judgeEventHandler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-judge-1' });
      judgeEventHandler({ type: 'agent_end' });

      // Give the async handleAgentEnd time to complete (it returns early because isStreaming=false)
      await new Promise((r) => process.nextTick(r));

      // agent:end should NOT have been sent (user aborted during judge)
      const safeSendCalls = (safeSend as any).mock.calls;
      const agentEndCalls = safeSendCalls.filter((c: any) => c[1] === 'agent:end');
      expect(agentEndCalls).toHaveLength(0);

      // trackTurnEnd should NOT have been called (early return because isStreaming=false)
      expect(judgeDeps.usageTracker.trackTurnEnd).not.toHaveBeenCalled();
    });

    it('suppresses agent:usage during judge retry (message_end)', async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { runJudgeHarness } = await import('../../../src/main/subagent/judge-harness.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      const { safeSend } = await import('../../../src/main/safe-send.js');

      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: false, maxRetries: 0, models: {} });
      (categorizeToolName as any).mockReturnValue('mutation');

      let capturedEventHandler: (event: any) => void;

      // During judge execution, fire a message_end event (simulating retry turn usage)
      (runJudgeHarness as any).mockImplementation(async () => {
        // While judge is in progress, simulate a message_end event
        capturedEventHandler({
          type: 'message_end',
          message: {
            role: 'assistant',
            usage: { input: 100, cacheRead: 50, cacheWrite: 0, output: 200, totalTokens: 350 },
          },
        });
        return null;
      });

      const judgeSlot = makeSlot();
      const judgeDeps = makeDeps({
        infra: {},
        getConnectorForSlot: () => ({}),
      });
      judgeDeps.slotManager.getSlot.mockReturnValue(judgeSlot);

      const { subscribeToSlot } = createEventRouter(judgeDeps as any);
      subscribeToSlot(judgeSlot);
      capturedEventHandler = judgeSlot.session.subscribe.mock.calls[0][0];

      // Clear safeSend calls from setup
      (safeSend as any).mockClear();

      // Fire a mutation tool start, then agent_end (triggers judge)
      capturedEventHandler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      capturedEventHandler({ type: 'agent_end' });

      // agent_end fires async handleAgentEnd as fire-and-forget — poll for completion
      await vi.waitFor(() => expect(judgeDeps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      // agent:usage should NOT have been sent during judge
      const usageCalls = (safeSend as any).mock.calls.filter((c: any) => c[1] === 'agent:usage');
      expect(usageCalls).toHaveLength(0);
    });

    describe('B-011: suggestion race condition guard', () => {
      let suggestResolve: (value: string[]) => void;
      let safeSendMock: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { safeSend } = await import('../../../src/main/safe-send.js');
        safeSendMock = safeSend as ReturnType<typeof vi.fn>;
        safeSendMock.mockClear();
      });

      function setupSuggestionSlot(overrides: Partial<any> = {}) {
        // Create a slot with a suggest() that returns a controllable promise
        const suggestPromise = new Promise<string[]>((resolve) => {
          suggestResolve = resolve;
        });
        return makeSlot({
          suggester: {
            appendAssistantText: vi.fn(),
            resetAssistantText: vi.fn(),
            suggest: vi.fn().mockReturnValue(suggestPromise),
          },
          promptQueue: {
            dequeue: vi.fn().mockReturnValue(null),
            list: vi.fn().mockReturnValue([]),
            length: 0,
            clear: vi.fn(),
          },
          ...overrides,
        });
      }

      it('emits suggestions when turnIndex has not changed', async () => {
        const suggestSlot = setupSuggestionSlot({ turnIndex: 3 });
        const suggestDeps = makeDeps();
        suggestDeps.slotManager.getSlot.mockReturnValue(suggestSlot);

        const { subscribeToSlot } = createEventRouter(suggestDeps as any);
        subscribeToSlot(suggestSlot);
        const handler = suggestSlot.session.subscribe.mock.calls[0][0];

        handler({ type: 'agent_end' });
        // Wait for finalizeTurn to complete (async handleAgentEnd)
        await vi.waitFor(() => expect(suggestDeps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

        // Resolve suggest() without changing turnIndex — suggestions should be emitted
        suggestResolve(['Try changing the color', 'Add a border']);
        await vi.waitFor(
          () => {
            const suggestionCalls = safeSendMock.mock.calls.filter((c: any) => c[1] === 'agent:suggestions');
            expect(suggestionCalls).toHaveLength(1);
            expect(suggestionCalls[0][3]).toEqual(['Try changing the color', 'Add a border']);
          },
          { timeout: 500 },
        );
      });

      it('suppresses suggestions after session reset (turnIndex resets to 0)', async () => {
        const suggestSlot = setupSuggestionSlot({ turnIndex: 5 });
        const suggestDeps = makeDeps();
        suggestDeps.slotManager.getSlot.mockReturnValue(suggestSlot);

        const { subscribeToSlot } = createEventRouter(suggestDeps as any);
        subscribeToSlot(suggestSlot);
        const handler = suggestSlot.session.subscribe.mock.calls[0][0];

        handler({ type: 'agent_end' });
        await vi.waitFor(() => expect(suggestDeps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

        // Simulate session reset: turnIndex goes back to 0 BEFORE suggest resolves
        suggestSlot.turnIndex = 0;

        suggestResolve(['Stale suggestion']);
        // Give the .then() callback time to execute
        await new Promise((r) => process.nextTick(r));

        const suggestionCalls = safeSendMock.mock.calls.filter((c: any) => c[1] === 'agent:suggestions');
        expect(suggestionCalls).toHaveLength(0);
      });

      it('suppresses suggestions when a new turn starts before suggest resolves', async () => {
        const suggestSlot = setupSuggestionSlot({ turnIndex: 2 });
        const suggestDeps = makeDeps();
        suggestDeps.slotManager.getSlot.mockReturnValue(suggestSlot);

        const { subscribeToSlot } = createEventRouter(suggestDeps as any);
        subscribeToSlot(suggestSlot);
        const handler = suggestSlot.session.subscribe.mock.calls[0][0];

        handler({ type: 'agent_end' });
        await vi.waitFor(() => expect(suggestDeps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

        // Simulate new turn starting: turnIndex increments BEFORE suggest resolves
        suggestSlot.turnIndex = 3;

        suggestResolve(['Outdated suggestion']);
        await new Promise((r) => process.nextTick(r));

        const suggestionCalls = safeSendMock.mock.calls.filter((c: any) => c[1] === 'agent:suggestions');
        expect(suggestionCalls).toHaveLength(0);
      });
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

  // ── Fase 4: MetricsRegistry hook wiring ────────────────────────────────
  //
  // The 8 hook points in session-events.ts are easy to typo (e.g.
  // 'no_connector' vs 'no-connector') and have no other test coverage.
  // These tests inject a fake MetricsRegistry and assert that each path
  // through handleAgentEnd / handleToolEnd / finalizeTurn fires the right
  // record* call. The fake records calls in arrays keyed by method name so
  // assertions stay readable.

  describe('MetricsRegistry hook wiring', () => {
    type FakeRegistry = ReturnType<typeof makeFakeRegistry>;

    function makeFakeRegistry() {
      return {
        turnStarts: 0,
        turnEnds: 0,
        triggered: 0,
        skipped: [] as string[],
        verdicts: [] as string[],
        toolCalls: [] as Array<{ name: string; ms: number; success: boolean }>,
        recordTurnStart() {
          this.turnStarts++;
        },
        recordTurnEnd() {
          this.turnEnds++;
        },
        recordJudgeTriggered() {
          this.triggered++;
        },
        recordJudgeSkipped(reason: string) {
          this.skipped.push(reason);
        },
        recordJudgeVerdict(v: string) {
          this.verdicts.push(v);
        },
        recordToolCall(name: string, ms: number, success: boolean) {
          this.toolCalls.push({ name, ms, success });
        },
      };
    }

    function makeMetricsDeps(registry: FakeRegistry, overrides: Partial<any> = {}) {
      const deps = makeDeps({
        infra: { metricsRegistry: registry },
        getConnectorForSlot: () => ({}),
        ...overrides,
      });
      // makeTracker() doesn't include trackJudgeVerdict — add it so the
      // onVerdict callback doesn't throw before reaching recordJudgeVerdict.
      deps.usageTracker.trackJudgeVerdict = vi.fn();
      return deps;
    }

    it('recordToolCall fires on tool_execution_end with name + duration + success', () => {
      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot();
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [] },
      });

      expect(registry.toolCalls).toHaveLength(1);
      expect(registry.toolCalls[0].name).toBe('figma_set_fills');
      expect(registry.toolCalls[0].success).toBe(true);
      expect(registry.toolCalls[0].ms).toBeGreaterThanOrEqual(0);
    });

    it('recordToolCall reports success=false when isError is true', () => {
      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot();
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-err' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-err',
        isError: true,
        result: { content: [] },
      });

      expect(registry.toolCalls[0].success).toBe(false);
    });

    it('recordTurnEnd fires when finalizeTurn runs (via agent_end)', async () => {
      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot();
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(registry.turnEnds).toBe(1);
    });

    it("recordJudgeSkipped('disabled') fires when judge is off and override is null", async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'off', autoRetry: false, maxRetries: 0, models: {} });

      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot({ judgeOverride: null });
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(registry.skipped).toContain('disabled');
      expect(registry.skipped).not.toContain('no-connector');
      expect(registry.triggered).toBe(0);
    });

    it("recordJudgeSkipped('no-mutations') fires when judge is on but turn had no mutations", async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: false, maxRetries: 0, models: {} });
      // Force every tool to read-only — `hasMutations` will be false.
      (categorizeToolName as any).mockReturnValue('discovery');

      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot({ judgeOverride: null });
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_screenshot', toolCallId: 'tc-1' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_screenshot',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [] },
      });
      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(registry.skipped).toContain('no-mutations');
      expect(registry.skipped).not.toContain('disabled');
      expect(registry.triggered).toBe(0);
    });

    it("recordJudgeSkipped('no-connector') fires when judge would run but no connector available", async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: false, maxRetries: 0, models: {} });
      (categorizeToolName as any).mockReturnValue('mutation');

      const registry = makeFakeRegistry();
      // getConnectorForSlot returns null → judge skipped with no-connector reason
      const deps = makeDeps({
        infra: { metricsRegistry: registry },
        getConnectorForSlot: () => null,
      });
      const metricsSlot = makeSlot({ judgeOverride: null });
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [] },
      });
      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(registry.skipped).toContain('no-connector');
      expect(registry.triggered).toBe(0);
    });

    it('recordJudgeTriggered + recordJudgeVerdict fire when judge actually runs', async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { runJudgeHarness } = await import('../../../src/main/subagent/judge-harness.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: false, maxRetries: 0, models: {} });
      (categorizeToolName as any).mockReturnValue('mutation');
      // Judge harness invokes the onVerdict callback once with PASS.
      // Args order matches runJudgeHarness signature:
      // (infra, connector, slot, settings, toolNames, mutatedIds, signal, callbacks)
      (runJudgeHarness as any).mockReset();
      (runJudgeHarness as any).mockImplementation(async (..._args: any[]) => {
        // 8th positional arg is the JudgeHarnessCallbacks object.
        const callbacks = _args[7];
        const verdict = { verdict: 'PASS', criteria: [] };
        callbacks?.onVerdict(verdict, 1, 1);
        return verdict;
      });

      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot({ judgeOverride: null });
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [] },
      });
      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      expect(registry.triggered).toBe(1);
      expect(registry.verdicts).toEqual(['PASS']);
      expect(registry.skipped).not.toContain('no-connector');
    });

    it('recordJudgeVerdict records ONLY the terminal outcome on retry (no double-count)', async () => {
      const { loadSubagentSettings } = await import('../../../src/main/subagent/config.js');
      const { runJudgeHarness } = await import('../../../src/main/subagent/judge-harness.js');
      const { categorizeToolName } = await import('../../../src/main/compression/metrics.js');
      (loadSubagentSettings as any).mockReturnValue({ judgeMode: 'auto', autoRetry: true, maxRetries: 2, models: {} });
      (categorizeToolName as any).mockReturnValue('mutation');
      // Simulate retry loop: FAIL on attempt 1, PASS on attempt 2.
      // Pre-fix behavior would record ['FAIL', 'PASS'] — polluting verdictCounts
      // with the intermediate FAIL. Post-fix must record only the terminal ['PASS'].
      (runJudgeHarness as any).mockReset();
      (runJudgeHarness as any).mockImplementation(async (..._args: any[]) => {
        const callbacks = _args[7];
        callbacks?.onVerdict({ verdict: 'FAIL', criteria: [] }, 1, 2);
        callbacks?.onVerdict({ verdict: 'PASS', criteria: [] }, 2, 2);
        return { verdict: 'PASS', criteria: [] };
      });

      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const metricsSlot = makeSlot({ judgeOverride: null });
      deps.slotManager.getSlot.mockReturnValue(metricsSlot);
      const { subscribeToSlot } = createEventRouter(deps as any);
      subscribeToSlot(metricsSlot);
      const handler = metricsSlot.session.subscribe.mock.calls[0][0];

      handler({ type: 'tool_execution_start', toolName: 'figma_set_fills', toolCallId: 'tc-1' });
      handler({
        type: 'tool_execution_end',
        toolName: 'figma_set_fills',
        toolCallId: 'tc-1',
        isError: false,
        result: { content: [] },
      });
      handler({ type: 'agent_end' });
      await vi.waitFor(() => expect(deps.usageTracker.trackTurnEnd).toHaveBeenCalled(), { timeout: 500 });

      // Registry sees exactly one terminal verdict, not the intermediate FAIL.
      expect(registry.verdicts).toEqual(['PASS']);
      // usageTracker still sees per-attempt history for analytics.
      expect(deps.usageTracker.trackJudgeVerdict).toHaveBeenCalledTimes(2);
    });

    it('exposes getJudgeInProgress as a ReadonlySet on the EventRouter', () => {
      const registry = makeFakeRegistry();
      const deps = makeMetricsDeps(registry);
      const router = createEventRouter(deps as any);
      const set = router.getJudgeInProgress();
      // Idle: empty Set
      expect(set instanceof Set).toBe(true);
      expect(set.size).toBe(0);
    });
  });
});
