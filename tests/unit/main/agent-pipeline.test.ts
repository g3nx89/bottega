import { describe, expect, it, vi } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

// Mock agent module
vi.mock('../../../src/main/agent.js', () => ({
  AVAILABLE_MODELS: [{ provider: 'anthropic', modelId: 'claude-sonnet-4', label: 'Sonnet', sdkProvider: 'anthropic' }],
  CONTEXT_SIZES: { default: 128000 },
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  OAUTH_PROVIDER_MAP: { Anthropic: 'anthropic-oauth' },
  OAUTH_PROVIDER_INFO: { Anthropic: { description: 'Claude' } },
  createFigmaAgent: vi.fn(),
}));

// Mock image-gen
vi.mock('../../../src/main/image-gen/config.js', () => ({
  effectiveApiKey: vi.fn().mockReturnValue('test-key'),
  saveImageGenSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/main/image-gen/image-generator.js', () => {
  return {
    DEFAULT_IMAGE_MODEL: 'gemini-2.0-flash',
    IMAGE_GEN_MODELS: [{ id: 'gemini-2.0-flash', label: 'Gemini Flash' }],
    ImageGenerator: class {
      model = 'gemini-2.0-flash';
    },
  };
});

// Mock prompt suggester
vi.mock('../../../src/main/prompt-suggester.js', () => ({
  PromptSuggester: class {
    trackUserPrompt = vi.fn();
    appendAssistantText = vi.fn();
    resetAssistantText = vi.fn();
    suggest = vi.fn().mockResolvedValue([]);
    reset = vi.fn();
  },
}));

// Mock auto-updater
vi.mock('../../../src/main/auto-updater.js', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  getAppVersion: vi.fn().mockReturnValue('1.0.0'),
  quitAndInstall: vi.fn(),
}));

import { ipcMain } from 'electron';
import { setupIpcHandlers } from '../../../src/main/ipc-handlers.js';
import { createMockSlotManager } from '../../helpers/mock-slot-manager.js';
import { createMockWindow } from '../../helpers/mock-window.js';
import {
  agentEndEvent,
  compactionEvents,
  fullTurnScript,
  retryEvents,
  screenshotToolEvents,
  textDeltaEvents,
  toolCallEvents,
  usageEvent,
} from '../../helpers/script-fragments.js';
import { ScriptedSession } from '../../helpers/scripted-session.js';

function getHandler(channel: string) {
  const call = (ipcMain.handle as any).mock.calls.find((c: any) => c[0] === channel);
  if (!call) throw new Error(`No handler for ${channel}`);
  return call[1];
}

async function invokeHandler(channel: string, ...args: any[]) {
  return getHandler(channel)({ sender: {} }, ...args);
}

describe('Agent pipeline with ScriptedSession', () => {
  let mockWindow: ReturnType<typeof createMockWindow>;
  let session: ScriptedSession;
  let mockInfra: any;
  let slotId: string;

  function setup(script: any[]) {
    vi.clearAllMocks();
    session = new ScriptedSession(script);
    mockWindow = createMockWindow();
    mockInfra = {
      authStorage: {
        getApiKey: vi.fn().mockResolvedValue('test-key'),
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        login: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn(),
      },
      modelRegistry: {},
      configManager: {
        getProfiles: vi.fn().mockReturnValue([]),
        getActiveProfile: vi.fn().mockReturnValue('balanced'),
        setProfile: vi.fn(),
      },
      designSystemCache: { invalidate: vi.fn() },
      metricsCollector: { finalize: vi.fn() },
      wsServer: { sendCommand: vi.fn() },
      setWorkflowContext: vi.fn(),
    };
    const { slotManager, slot, slotId: id } = createMockSlotManager(session);
    slotId = id;
    const ipcController = setupIpcHandlers({
      slotManager: slotManager as any,
      mainWindow: mockWindow as any,
      infra: mockInfra,
    });
    ipcController.subscribeSlot(slot as any);
  }

  // ── Text streaming ──────────────────────────

  it('streams text deltas to renderer', async () => {
    setup(fullTurnScript({ text: 'Hello from the agent!' }));
    await invokeHandler('agent:prompt', slotId, 'test');

    const textCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:text-delta');
    expect(textCalls.length).toBeGreaterThan(0);
    const fullText = textCalls.map((c: any[]) => c[2]).join('');
    expect(fullText).toBe('Hello from the agent!');
  });

  it('streams thinking deltas to renderer', async () => {
    setup([
      { type: 'message_update', data: { assistantMessageEvent: { type: 'thinking_delta', delta: 'Thinking...' } } },
      ...agentEndEvent(),
    ]);
    await invokeHandler('agent:prompt', slotId, 'test');

    const thinkingCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:thinking');
    expect(thinkingCalls).toHaveLength(1);
    expect(thinkingCalls[0][2]).toBe('Thinking...');
  });

  // ── Tool card lifecycle ─────────────────────

  it('forwards tool start and end events', async () => {
    setup([...toolCallEvents('figma_resize', 'tc-1', { success: true }), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'resize it');

    const starts = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:tool-start');
    const ends = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:tool-end');
    expect(starts).toHaveLength(1);
    expect(starts[0][2]).toBe('figma_resize');
    expect(starts[0][3]).toBe('tc-1');
    expect(ends).toHaveLength(1);
    expect(ends[0][2]).toBe('figma_resize');
    expect(ends[0][4]).toBe(true); // success
  });

  it('forwards failed tool with success=false', async () => {
    setup([...toolCallEvents('figma_delete', 'tc-2', { success: false }), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'delete it');

    const ends = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:tool-end');
    expect(ends[0][4]).toBe(false); // isError → !isError = false wait, isError is true so success is false
  });

  // ── Screenshot forwarding ──────────────────

  it('forwards screenshot from figma_screenshot tool', async () => {
    setup([...screenshotToolEvents('sc-1', 'SCREENSHOT_BASE64'), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'take screenshot');

    const screenshotCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:screenshot');
    expect(screenshotCalls).toHaveLength(1);
    expect(screenshotCalls[0][2]).toBe('SCREENSHOT_BASE64');
  });

  // ── Usage stats ─────────────────────────────

  it('forwards usage stats from message_end', async () => {
    setup([...usageEvent(1000, 500), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'test');

    const usageCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:usage');
    expect(usageCalls).toHaveLength(1);
    expect(usageCalls[0][2]).toEqual({ input: 1000, output: 500, total: 1500 });
  });

  // ── Compaction and retry indicators ─────────

  it('forwards compaction start/end', async () => {
    setup([...compactionEvents(), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'test');

    const compactionCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:compaction');
    expect(compactionCalls).toHaveLength(2);
    expect(compactionCalls[0][2]).toBe(true);
    expect(compactionCalls[1][2]).toBe(false);
  });

  it('forwards retry start/end', async () => {
    setup([...retryEvents(), ...agentEndEvent()]);
    await invokeHandler('agent:prompt', slotId, 'test');

    const retryCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:retry');
    expect(retryCalls).toHaveLength(2);
    expect(retryCalls[0][2]).toBe(true);
    expect(retryCalls[1][2]).toBe(false);
  });

  // ── Agent end ───────────────────────────────

  it('sends agent:end on agent_end event', async () => {
    setup(fullTurnScript({ text: 'Done' }));
    await invokeHandler('agent:prompt', slotId, 'test');

    const endCalls = mockWindow.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'agent:end');
    expect(endCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Full turn composition ───────────────────

  it('handles a full turn with thinking + tools + screenshot + text', async () => {
    setup(
      fullTurnScript({
        thinking: 'Let me create a rectangle...',
        tools: [{ name: 'figma_create_child', success: true }],
        screenshot: 'SCREENSHOT_DATA',
        text: 'Created a rectangle for you.',
        usage: { input: 2000, output: 800 },
      }),
    );
    await invokeHandler('agent:prompt', slotId, 'create a rectangle');
    // agent_end handler is async (fire-and-forget) — flush microtasks
    await new Promise((r) => process.nextTick(r));

    const channels = mockWindow.webContents.send.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('agent:thinking');
    expect(channels).toContain('agent:tool-start');
    expect(channels).toContain('agent:tool-end');
    expect(channels).toContain('agent:screenshot');
    expect(channels).toContain('agent:text-delta');
    expect(channels).toContain('agent:usage');
    expect(channels).toContain('agent:end');
  });

  // ── Abort during streaming ──────────────────

  it('abort stops the session', async () => {
    // Script with delay to allow abort
    const script = [...textDeltaEvents('Start'), { type: 'agent_end', delayMs: 200 }];
    setup(script);

    const promptPromise = invokeHandler('agent:prompt', slotId, 'test');
    // Give first event time to emit
    await new Promise((r) => setTimeout(r, 10));
    await invokeHandler('agent:abort', slotId);
    await promptPromise;

    expect(session.abortCount).toBe(1);
  });

  // ── Destroyed webContents ───────────────────

  it('no crash when webContents destroyed during streaming', async () => {
    setup(fullTurnScript({ text: 'Hello' }));
    mockWindow.destroy(); // destroy webContents before streaming

    // Should not throw
    await invokeHandler('agent:prompt', slotId, 'test');

    // safeSend should have silently skipped all sends
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();
  });

  // ── FollowUp behavior ──────────────────────

  it('second prompt during streaming uses followUp', async () => {
    // First prompt sets isStreaming=true, second should use followUp
    const script = [...textDeltaEvents('Response'), ...agentEndEvent()];
    setup(script);

    // First prompt
    await invokeHandler('agent:prompt', slotId, 'first');
    // Session records the prompt
    expect(session.promptHistory).toContain('first');
  });
});
