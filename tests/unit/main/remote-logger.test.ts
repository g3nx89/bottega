import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn().mockReturnValue('0.3.0'),
    getLocale: vi.fn().mockReturnValue('en-US'),
  },
}));

// ── Imports (after mocks) ────────────────────────

import {
  captureVitals,
  createAxiomTransport,
  type DiagnosticsConfig,
  generateSessionUid,
  hashFileKey,
  redactMessage,
  UsageTracker,
} from '../../../src/main/remote-logger.js';

// ── Tests ────────────────────────────────────────

describe('generateSessionUid', () => {
  it('should return a string starting with s_', () => {
    const uid = generateSessionUid();
    expect(uid).toMatch(/^s_[0-9a-f]{8}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionUid()));
    expect(ids.size).toBe(100);
  });
});

describe('createAxiomTransport', () => {
  const originalEnv = process.env.BOTTEGA_AXIOM_TOKEN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BOTTEGA_AXIOM_TOKEN = originalEnv;
    } else {
      delete process.env.BOTTEGA_AXIOM_TOKEN;
    }
  });

  it('should return null when sendDiagnostics is false', () => {
    const config: DiagnosticsConfig = { sendDiagnostics: false, anonymousId: 'test' };
    expect(createAxiomTransport(config)).toBeNull();
  });

  it('should return transport config when enabled (default token is embedded)', () => {
    const config: DiagnosticsConfig = { sendDiagnostics: true, anonymousId: 'test' };
    const transport = createAxiomTransport(config);

    expect(transport).not.toBeNull();
    expect(transport!.target).toBe('@axiomhq/pino');
    expect(transport!.level).toBe('info');
    expect(transport!.options).toHaveProperty('dataset', 'bottega-logs-v2');
    expect(transport!.options).toHaveProperty('token');
  });
});

describe('captureVitals', () => {
  it('should return vitals with expected shape', () => {
    const vitals = captureVitals();

    expect(vitals).toHaveProperty('freeRamGB');
    expect(vitals.freeRamGB).toBeGreaterThan(0);
    expect(vitals).toHaveProperty('processRssMB');
    expect(vitals.processRssMB).toBeGreaterThan(0);
    expect(vitals).toHaveProperty('processHeapMB');
    expect(vitals.processHeapMB).toBeGreaterThan(0);
    expect(vitals).toHaveProperty('eventLoopLagMs');
    expect(vitals).toHaveProperty('uptimeSeconds');
    expect(vitals.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('hashFileKey', () => {
  it('should return a 16-char hex string', () => {
    const hash = hashFileKey('abc123');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should be deterministic', () => {
    expect(hashFileKey('test-key')).toBe(hashFileKey('test-key'));
  });

  it('should produce different hashes for different keys', () => {
    expect(hashFileKey('key1')).not.toBe(hashFileKey('key2'));
  });
});

describe('redactMessage', () => {
  it('should redact sk- prefixed API keys', () => {
    expect(redactMessage('Error with key sk-abc123def456xyz')).toContain('[REDACTED]');
    expect(redactMessage('Error with key sk-abc123def456xyz')).not.toContain('sk-abc123def456xyz');
  });

  it('should redact Bearer tokens', () => {
    expect(redactMessage('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test')).toContain('Bearer [REDACTED]');
  });

  it('should redact Google API keys (AIza prefix)', () => {
    expect(redactMessage('key=AIzaSyD1234567890abcdef')).toContain('[REDACTED]');
  });

  it('should redact GitHub tokens (ghp_ prefix)', () => {
    expect(redactMessage('token ghp_abcdefghij1234567890')).toContain('[REDACTED]');
  });

  it('should replace home directory with ~', () => {
    const home = os.homedir();
    expect(redactMessage(`Error at ${home}/Projects/test.js`)).toContain('~/Projects/test.js');
    expect(redactMessage(`Error at ${home}/Projects/test.js`)).not.toContain(home);
  });

  it('should handle empty string', () => {
    expect(redactMessage('')).toBe('');
  });
});

describe('UsageTracker', () => {
  let tracker: UsageTracker;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });

  describe('when disabled', () => {
    beforeEach(() => {
      tracker = new UsageTracker(mockLogger, { sendDiagnostics: false, anonymousId: 'test-anon' }, {});
    });

    it('should not emit events', () => {
      tracker.trackPrompt(100, false);
      tracker.trackToolCall('figma_screenshot', 'screenshot', true, 150);
      tracker.trackModelSwitch({ provider: 'anthropic', modelId: 'a' }, { provider: 'openai', modelId: 'b' });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not start heartbeat', () => {
      tracker.startHeartbeat();
      // No timer should be created — stopHeartbeat should be safe to call
      tracker.stopHeartbeat();
    });
  });

  describe('when enabled', () => {
    beforeEach(() => {
      tracker = new UsageTracker(mockLogger, { sendDiagnostics: true, anonymousId: 'test-anon' }, {});
    });

    afterEach(() => {
      tracker.stopHeartbeat();
    });

    it('should emit prompt event', () => {
      tracker.trackPrompt(42, true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'usage:prompt',
          charLength: 42,
          isFollowUp: true,
        }),
      );
    });

    it('should emit tool_call event', () => {
      tracker.trackToolCall('figma_screenshot', 'screenshot', true, 250);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'usage:tool_call',
          toolName: 'figma_screenshot',
          category: 'screenshot',
          success: true,
          durationMs: 250,
        }),
      );
    });

    it('should emit model_switch with before/after', () => {
      const before = { provider: 'anthropic', modelId: 'claude-sonnet-4' };
      const after = { provider: 'openai', modelId: 'gpt-5' };
      tracker.trackModelSwitch(before, after);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'usage:model_switch',
          before,
          after,
        }),
      );
    });

    it('should include inline vitals on uncaught exception', () => {
      const home = os.homedir();
      tracker.trackUncaughtException({
        name: 'TypeError',
        message: 'Cannot read property x',
        stack: `TypeError: at ${home}/Projects/app.js:10`,
      });

      const call = mockLogger.info.mock.calls[0][0];
      expect(call.event).toBe('usage:uncaught_exception');
      expect(call.vitals).toHaveProperty('freeRamGB');
      expect(call.vitals).toHaveProperty('processRssMB');
      // Stack should have home dir redacted to ~
      expect(call.stack).toContain('~/Projects/app.js');
      expect(call.stack).not.toContain(home);
    });

    it('should hash file keys for figma_connected', () => {
      tracker.trackFigmaConnected('abc123filekey', 500);

      const call = mockLogger.info.mock.calls[0][0];
      expect(call.event).toBe('usage:figma_connected');
      expect(call.fileKeyHash).toMatch(/^[0-9a-f]{16}$/);
      expect(call.fileKeyHash).not.toBe('abc123filekey');
    });

    it('should emit heartbeat events on interval and stop cleanly', () => {
      vi.useFakeTimers();
      try {
        tracker.startHeartbeat();

        // No heartbeat yet at t=0
        const heartbeatCalls = () => mockLogger.info.mock.calls.filter((c: any) => c[0]?.event === 'usage:heartbeat');
        expect(heartbeatCalls()).toHaveLength(0);

        // Advance 10s — one heartbeat
        vi.advanceTimersByTime(10_000);
        expect(heartbeatCalls()).toHaveLength(1);
        const hb = heartbeatCalls()[0][0];
        expect(hb).toHaveProperty('freeRamGB');
        expect(hb).toHaveProperty('processRssMB');
        expect(hb).toHaveProperty('eventLoopLagMs');
        expect(hb).toHaveProperty('figmaWsConnected');
        expect(hb).toHaveProperty('rendererResponsive');

        // Advance another 10s — two total
        vi.advanceTimersByTime(10_000);
        expect(heartbeatCalls()).toHaveLength(2);

        // Stop — no more heartbeats
        tracker.stopHeartbeat();
        vi.advanceTimersByTime(30_000);
        expect(heartbeatCalls()).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should emit all remaining track methods', () => {
      tracker.trackSessionStart({ provider: 'anthropic', modelId: 'test' }, 128000);
      tracker.trackSessionEnd({
        durationMs: 5000,
        totalToolCalls: 10,
        tokensInput: 1000,
        tokensOutput: 500,
        tokensSaved: 200,
        compactionTriggered: false,
      });
      tracker.trackAppQuit(3600, 2);
      tracker.trackToolError('figma_execute', 'test error', 'ERR_01');
      tracker.trackAgentError('network', 'connection failed');
      tracker.trackCompaction(5000, 3000);
      tracker.trackThinkingChange('medium', 'high');
      tracker.trackCompressionProfileChange('balanced', 'minimal');
      tracker.trackFigmaDisconnected('timeout', 60000);
      tracker.trackFigmaPluginInstalled(true);
      tracker.trackImageGen('generate_image', 'gemini', true, 3000);
      tracker.trackSuggestionsGenerated(3, 500);
      tracker.trackSuggestionClicked(1);
      tracker.trackUnhandledRejection({ name: 'Error', code: 'ERR', message: 'test' });
      tracker.trackRendererCrash('killed', 1);

      // Each method should have emitted exactly one log
      expect(mockLogger.info).toHaveBeenCalledTimes(15);

      // Spot-check a few event names
      const events = mockLogger.info.mock.calls.map((c: any) => c[0]?.event);
      expect(events).toContain('usage:session_start');
      expect(events).toContain('usage:session_end');
      expect(events).toContain('usage:app_quit');
      expect(events).toContain('usage:image_gen');
      expect(events).toContain('usage:suggestion_clicked');
      expect(events).toContain('usage:renderer_crash');
    });
  });
});

describe('UsageTracker enhanced logging', () => {
  let tracker: UsageTracker;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    tracker = new UsageTracker(mockLogger, { sendDiagnostics: true, anonymousId: 'test-anon' }, {});
  });

  afterEach(() => {
    tracker.stopHeartbeat();
  });

  it('trackPrompt with context includes promptId, slotId, turnIndex, content', () => {
    tracker.trackPrompt(20, false, {
      promptId: 'p-123',
      slotId: 's-456',
      turnIndex: 3,
      content: 'Make the button blue',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:prompt',
        charLength: 20,
        isFollowUp: false,
        promptId: 'p-123',
        slotId: 's-456',
        turnIndex: 3,
        contentPreview: 'Make the button blue',
      }),
    );
  });

  it('trackPrompt without context omits correlation fields', () => {
    tracker.trackPrompt(10, true);

    const call = mockLogger.info.mock.calls[0][0];
    expect(call.event).toBe('usage:prompt');
    expect(call.charLength).toBe(10);
    expect(call).not.toHaveProperty('promptId');
    expect(call).not.toHaveProperty('slotId');
  });

  it('trackToolCall with context includes promptId and screenshotMeta', () => {
    tracker.trackToolCall('figma_screenshot', 'screenshot', true, 500, {
      promptId: 'p-123',
      slotId: 's-456',
      turnIndex: 2,
      screenshotMeta: { nodeId: '1:42', scale: 2, format: 'PNG' },
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:tool_call',
        toolName: 'figma_screenshot',
        durationMs: 500,
        promptId: 'p-123',
        slotId: 's-456',
        turnIndex: 2,
        screenshotMeta: { nodeId: '1:42', scale: 2, format: 'PNG' },
      }),
    );
  });

  it('trackToolCall without context omits correlation fields', () => {
    tracker.trackToolCall('figma_execute', 'core', true, 100);

    const call = mockLogger.info.mock.calls[0][0];
    expect(call.event).toBe('usage:tool_call');
    expect(call).not.toHaveProperty('promptId');
    expect(call).not.toHaveProperty('screenshotMeta');
  });

  it('trackTurnEnd emits full turn metrics', () => {
    tracker.trackTurnEnd({
      promptId: 'p-abc',
      slotId: 's-def',
      turnIndex: 5,
      responseCharLength: 28,
      responseDurationMs: 3200,
      toolCallCount: 2,
      toolNames: ['figma_set_fills', 'figma_screenshot'],
      hasAction: true,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:turn_end',
        promptId: 'p-abc',
        slotId: 's-def',
        turnIndex: 5,
        responseCharLength: 28,
        responseDurationMs: 3200,
        toolCallCount: 2,
        toolNames: ['figma_set_fills', 'figma_screenshot'],
        hasAction: true,
      }),
    );
  });

  it('trackTurnEnd with hasAction false for text-only turns', () => {
    tracker.trackTurnEnd({
      promptId: 'p-xyz',
      slotId: 's-123',
      turnIndex: 1,
      responseCharLength: 33,
      responseDurationMs: 1500,
      toolCallCount: 0,
      toolNames: [],
      hasAction: false,
    });

    const call = mockLogger.info.mock.calls[0][0];
    expect(call.hasAction).toBe(false);
    expect(call.toolCallCount).toBe(0);
    expect(call.toolNames).toEqual([]);
  });

  it('trackFeedback emits positive feedback', () => {
    tracker.trackFeedback({
      sentiment: 'positive',
      details: 'Great design!',
      promptId: 'p-123',
      slotId: 's-456',
      turnIndex: 2,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:feedback',
        sentiment: 'positive',
        details: 'Great design!',
        promptId: 'p-123',
      }),
    );
  });

  it('trackFeedback emits negative feedback with issueType', () => {
    tracker.trackFeedback({
      sentiment: 'negative',
      issueType: 'did_not_use_tools',
      details: 'Expected action, got text',
      promptId: 'p-789',
      slotId: 's-abc',
      turnIndex: 3,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:feedback',
        sentiment: 'negative',
        issueType: 'did_not_use_tools',
        details: 'Expected action, got text',
      }),
    );
  });

  it('trackToolError with context includes promptId', () => {
    tracker.trackToolError('figma_execute', 'Node not found', 'ERR_404', {
      promptId: 'p-err',
      slotId: 's-err',
      turnIndex: 1,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:tool_error',
        toolName: 'figma_execute',
        promptId: 'p-err',
        slotId: 's-err',
        turnIndex: 1,
      }),
    );
  });
});

describe('UsageTracker multi-tab events', () => {
  let tracker: UsageTracker;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    const config: DiagnosticsConfig = { sendDiagnostics: true, anonymousId: 'test-id' };
    tracker = new UsageTracker(mockLogger, config, {
      getModelConfig: () => ({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' }),
      getCompressionProfile: () => 'balanced',
      getDiagnosticsEnabled: () => true,
      getImageGenInfo: () => ({ hasKey: true, model: 'gemini' }),
    });
  });

  it('trackSlotCreated emits event with fileKeyHash and automatic flag', () => {
    tracker.trackSlotCreated('myfilekey123', true);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:slot_created',
        fileKeyHash: expect.stringMatching(/^[0-9a-f]{16}$/),
        automatic: true,
      }),
    );
  });

  it('trackSlotRemoved emits event with fileKeyHash', () => {
    tracker.trackSlotRemoved('myfilekey123');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:slot_removed',
        fileKeyHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      }),
    );
  });

  it('trackPromptEnqueued emits event with queueLength', () => {
    tracker.trackPromptEnqueued(3);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:prompt_enqueued',
        queueLength: 3,
      }),
    );
  });

  it('trackPromptDequeued emits event with queueLength', () => {
    tracker.trackPromptDequeued(2);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:prompt_dequeued',
        queueLength: 2,
      }),
    );
  });

  it('trackPromptQueueEdited emits event', () => {
    tracker.trackPromptQueueEdited();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:prompt_queue_edited',
      }),
    );
  });

  it('trackPromptQueueCancelled emits event', () => {
    tracker.trackPromptQueueCancelled();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:prompt_queue_cancelled',
      }),
    );
  });

  it('trackAppStateRestored emits event with slotsCount and totalQueuedPrompts', () => {
    tracker.trackAppStateRestored(4, 7);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:app_state_restored',
        slotsCount: 4,
        totalQueuedPrompts: 7,
      }),
    );
  });
});
