/**
 * Integration test — Issue 1 fix verification
 *
 * Verifies the no-credentials pre-check in runMicroJudgeBatch exercises
 * the full stack: runJudgeHarness → prefetchForMicroJudges →
 * runMicroJudgeBatch → (pre-check fails) → aggregator.
 *
 * Previously: missing API key surfaced as silent vacuous PASS (error
 * caught, pass:true). Now: explicit SKIP with status 'no_credentials',
 * log.warn + progress event visible to UI/logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture any attempts to spawn judge sessions. If pre-check works,
// createSubagentSession must NOT be called when credentials are missing.
vi.mock('../../../src/main/subagent/session-factory.js', () => ({
  createSubagentSession: vi.fn(),
}));

vi.mock('../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn(() => []),
}));

import { createSubagentSession } from '../../../src/main/subagent/session-factory.js';

const createSubagentSessionMock = vi.mocked(createSubagentSession);

import { DEFAULT_SUBAGENT_SETTINGS, type SubagentSettings } from '../../../src/main/subagent/config.js';
import { runJudgeHarness } from '../../../src/main/subagent/judge-harness.js';

function makeConnector() {
  return {
    fileKey: 'test-file',
    // Raw tree fetch — return a structurally-valid empty-ish tree so prefetch
    // doesn't crash. We only care about judge spawning here.
    executeCodeViaUI: vi.fn().mockResolvedValue([
      {
        id: '0:1',
        name: 'Page',
        type: 'PAGE',
        children: [{ id: '1:1', name: 'Frame', type: 'FRAME', children: [] }],
      },
    ]),
  } as any;
}

function makeSlot() {
  return {
    id: 'slot-no-creds',
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
    judgeOverride: null,
    lastTurnToolNames: [],
    sessionToolHistory: new Set<string>(),
    taskStore: { create: vi.fn(), size: 0, list: vi.fn(() => []) },
  } as any;
}

const settings: SubagentSettings = {
  ...DEFAULT_SUBAGENT_SETTINGS,
  judgeMode: 'auto',
  autoRetry: false,
};

describe('Judge harness — no credentials path (Issue 1 fix)', () => {
  beforeEach(() => {
    createSubagentSessionMock.mockReset();
  });

  it('skips judges without spawning a session when authStorage has no API key', async () => {
    const infra = {
      queueManager: { getQueue: () => ({}) },
      wsServer: {},
      figmaAPI: {},
      designSystemCache: {},
      configManager: {},
      // The fix under test: getApiKey returns null/undefined → judge skipped.
      authStorage: { getApiKey: vi.fn().mockResolvedValue(null) },
    } as any;

    const connector = makeConnector();
    const onProgress = vi.fn();
    const onVerdict = vi.fn();

    const verdict = await runJudgeHarness(
      infra,
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'], // structural tool → triggers standard tier judges
      ['1:1'],
      new AbortController().signal,
      { onProgress, onVerdict, onRetryStart: vi.fn() },
    );

    // Primary assertion: session factory never reached
    expect(createSubagentSessionMock).not.toHaveBeenCalled();

    // getApiKey was probed (at least once per judge spawned)
    expect(infra.authStorage.getApiKey).toHaveBeenCalled();

    // Aggregated verdict produced without spawning sessions
    expect(verdict).toBeDefined();

    // At least one progress event surfaced the credential gap
    const errorEvents = onProgress.mock.calls
      .map(([ev]: any[]) => ev)
      .filter((ev) => ev.type === 'error' && /No credentials/i.test(ev.summary ?? ''));
    expect(errorEvents.length).toBeGreaterThan(0);
    // Include the provider name that was probed so the log is actionable
    expect(errorEvents[0].summary).toContain('anthropic');
  });

  it('runs judges normally when authStorage returns a valid key', async () => {
    const infra = {
      queueManager: { getQueue: () => ({}) },
      wsServer: {},
      figmaAPI: {},
      designSystemCache: {},
      configManager: {},
      authStorage: { getApiKey: vi.fn().mockResolvedValue('sk-valid-key') },
    } as any;

    // Stub createSubagentSession to emit a PASS verdict immediately.
    (createSubagentSessionMock as any).mockImplementation(async () => {
      let cb: ((event: any) => void) | null = null;
      return {
        session: {
          subscribe: vi.fn((c: any) => {
            cb = c;
          }),
          prompt: vi.fn().mockImplementation(async () => {
            cb?.({
              assistantMessageEvent: {
                type: 'text_delta',
                delta: JSON.stringify({ pass: true, finding: 'ok', evidence: '', actionItems: [] }),
              },
            });
          }),
          abort: vi.fn().mockResolvedValue(undefined),
        },
      };
    });

    const connector = makeConnector();

    await runJudgeHarness(
      infra,
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'],
      ['1:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    // With a valid key, sessions ARE spawned (one per judge)
    expect(createSubagentSessionMock).toHaveBeenCalled();
    expect(infra.authStorage.getApiKey).toHaveBeenCalled();
  });
});
