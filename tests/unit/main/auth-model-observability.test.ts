/**
 * Sprint A F1/F2/F4 — auth & model observability tests.
 *
 * Covers:
 *   F1: classifyStreamError + wrapPromptWithErrorCapture behavior
 *   F2: UsageTracker.trackEmptyResponse payload shape
 *   F4: UsageTracker.trackModelAuthMismatch payload shape
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  app: { getVersion: vi.fn().mockReturnValue('0.14.1'), getLocale: vi.fn().mockReturnValue('en-US') },
}));

import { classifyStreamError, type ModelConfig, wrapPromptWithErrorCapture } from '../../../src/main/agent.js';
import { UsageTracker } from '../../../src/main/usage-tracker.js';

const MODEL: ModelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

function makeTracker() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const tracker = new UsageTracker(logger as any, { sendDiagnostics: true, anonymousId: 'a' }, {} as any);
  return { tracker, logger };
}

describe('F1: classifyStreamError', () => {
  it('extracts status from err.status', () => {
    expect(classifyStreamError({ status: 401, message: 'unauthorized' })).toMatchObject({
      httpStatus: 401,
      errorBody: 'unauthorized',
    });
  });

  it('extracts status from nested err.response.status', () => {
    expect(classifyStreamError({ response: { status: 403, body: 'forbidden' } })).toMatchObject({
      httpStatus: 403,
      errorBody: 'forbidden',
    });
  });

  it('captures errorCode from err.code', () => {
    expect(classifyStreamError({ code: 'ECONNRESET', message: 'reset' })).toMatchObject({
      httpStatus: null,
      errorCode: 'ECONNRESET',
    });
  });

  it('falls back to message when no body', () => {
    expect(classifyStreamError(new Error('boom')).errorBody).toBe('boom');
  });
});

describe('F1: wrapPromptWithErrorCapture', () => {
  it('emits llm_stream_error on HTTP failure and rethrows', async () => {
    const { tracker, logger } = makeTracker();
    const session = { prompt: vi.fn().mockRejectedValue({ status: 401, message: 'unauthorized' }) };

    await expect(
      wrapPromptWithErrorCapture(session, 'hi', MODEL, tracker, { promptId: 'p1', slotId: 's1', turnIndex: 1 }),
    ).rejects.toMatchObject({ status: 401 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:llm_stream_error',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        httpStatus: 401,
        promptId: 'p1',
        slotId: 's1',
      }),
    );
  });

  it('emits prompt_cancelled (not stream_error) on AbortError', async () => {
    const { tracker, logger } = makeTracker();
    const abortErr = new Error('aborted');
    (abortErr as any).name = 'AbortError';
    const session = { prompt: vi.fn().mockRejectedValue(abortErr) };

    await expect(wrapPromptWithErrorCapture(session, 'hi', MODEL, tracker)).rejects.toBe(abortErr);

    const events = logger.info.mock.calls.map((c: any[]) => c[0].event);
    expect(events).toContain('usage:prompt_cancelled');
    expect(events).not.toContain('usage:llm_stream_error');
  });

  it('does not emit on success', async () => {
    const { tracker, logger } = makeTracker();
    const session = { prompt: vi.fn().mockResolvedValue(undefined) };
    await wrapPromptWithErrorCapture(session, 'hi', MODEL, tracker);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('truncates errorBody to 500 chars', async () => {
    const { tracker, logger } = makeTracker();
    const longBody = 'x'.repeat(1000);
    const session = { prompt: vi.fn().mockRejectedValue({ status: 500, body: longBody }) };
    await expect(wrapPromptWithErrorCapture(session, 'hi', MODEL, tracker)).rejects.toBeDefined();
    const payload = logger.info.mock.calls.find((c: any[]) => c[0].event === 'usage:llm_stream_error')![0];
    expect(payload.errorBody.length).toBe(500);
  });

  it('redacts sensitive tokens in errorBody', async () => {
    const { tracker, logger } = makeTracker();
    const session = {
      prompt: vi.fn().mockRejectedValue({ status: 401, body: 'bad Bearer sk-live-deadbeef1234567890' }),
    };
    await expect(wrapPromptWithErrorCapture(session, 'hi', MODEL, tracker)).rejects.toBeDefined();
    const payload = logger.info.mock.calls.find((c: any[]) => c[0].event === 'usage:llm_stream_error')![0];
    expect(payload.errorBody).not.toContain('sk-live-deadbeef');
    expect(payload.errorBody).toContain('[REDACTED]');
  });
});

describe('F2: trackEmptyResponse', () => {
  it('emits usage:empty_response with suspected_auth when fast', () => {
    const { tracker, logger } = makeTracker();
    tracker.trackEmptyResponse({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      reason: 'suspected_auth',
      durationMs: 400,
      promptId: 'p',
      slotId: 's',
      turnIndex: 2,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:empty_response',
        reason: 'suspected_auth',
        durationMs: 400,
        promptId: 'p',
        slotId: 's',
      }),
    );
  });

  it('no-op when diagnostics disabled', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
    const tracker = new UsageTracker(logger as any, { sendDiagnostics: false, anonymousId: 'a' }, {} as any);
    tracker.trackEmptyResponse({
      provider: 'x',
      modelId: 'y',
      reason: 'unknown',
      durationMs: 10,
    });
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('F4: trackModelAuthMismatch', () => {
  let tracker: UsageTracker;
  let logger: any;

  beforeEach(() => {
    const made = makeTracker();
    tracker = made.tracker;
    logger = made.logger;
  });

  it('emits with attemptedAction=switch when auth missing', () => {
    tracker.trackModelAuthMismatch({
      modelId: 'gpt-5.4-mini',
      sdkProvider: 'openai',
      authType: null,
      attemptedAction: 'switch',
      slotId: 'slot-1',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:model_auth_mismatch',
        modelId: 'gpt-5.4-mini',
        sdkProvider: 'openai',
        authType: 'none',
        attemptedAction: 'switch',
        slotId: 'slot-1',
      }),
    );
  });

  it('emits with attemptedAction=send and preserves authType', () => {
    tracker.trackModelAuthMismatch({
      modelId: 'gpt-5.3-codex',
      sdkProvider: 'openai-codex',
      authType: 'api_key',
      attemptedAction: 'send',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'usage:model_auth_mismatch',
        authType: 'api_key',
        attemptedAction: 'send',
      }),
    );
  });
});
