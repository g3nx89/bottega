import { describe, expect, it, vi } from 'vitest';

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

import { UsageTracker } from '../../../src/main/usage-tracker.js';

function makeTracker() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
  return new UsageTracker(logger as any, { sendDiagnostics: true, anonymousId: 'a' }, {} as any);
}

describe('F15: recent errors ring buffer', () => {
  it('records llm_stream_error events', () => {
    const t = makeTracker();
    t.trackLlmStreamError({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      httpStatus: 401,
      errorCode: null,
      errorBody: 'unauthorized',
      durationMs: 10,
    });
    const recent = t.getRecentErrors();
    expect(recent).toHaveLength(1);
    expect(recent[0].event).toBe('usage:llm_stream_error');
    expect(recent[0].httpStatus).toBe(401);
  });

  it('records empty_response events', () => {
    const t = makeTracker();
    t.trackEmptyResponse({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      reason: 'suspected_auth',
      durationMs: 5,
    });
    const recent = t.getRecentErrors();
    expect(recent[0].event).toBe('usage:empty_response');
    expect(recent[0].reason).toBe('suspected_auth');
  });

  it('caps at 10 entries (FIFO)', () => {
    const t = makeTracker();
    for (let i = 0; i < 15; i++) {
      t.trackLlmStreamError({
        provider: 'p',
        modelId: `m-${i}`,
        httpStatus: 500,
        errorCode: null,
        errorBody: '',
        durationMs: 1,
      });
    }
    const recent = t.getRecentErrors();
    expect(recent).toHaveLength(10);
    // Oldest dropped: first entry should be m-5
    expect(recent[0].modelId).toBe('m-5');
    expect(recent[9].modelId).toBe('m-14');
  });

  it('returns a fresh copy (caller cannot mutate internal state)', () => {
    const t = makeTracker();
    t.trackEmptyResponse({ provider: 'p', modelId: 'm', reason: 'unknown', durationMs: 1 });
    const snapshot = t.getRecentErrors();
    snapshot.push({} as any);
    expect(t.getRecentErrors()).toHaveLength(1);
  });

  it('end-to-end: stream_error → buffer → getRecentErrors returns same event', () => {
    const t = makeTracker();
    t.trackLlmStreamError({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      httpStatus: 429,
      errorCode: 'RATE',
      errorBody: 'try later',
      durationMs: 50,
      promptId: 'p',
      slotId: 's',
      turnIndex: 3,
    });
    t.trackEmptyResponse({
      provider: 'openai',
      modelId: 'gpt-5.4',
      reason: 'unknown',
      durationMs: 3000,
      promptId: 'p2',
      slotId: 's2',
      turnIndex: 1,
    });
    const recent = t.getRecentErrors();
    expect(recent[0]).toMatchObject({
      event: 'usage:llm_stream_error',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      httpStatus: 429,
    });
    expect(recent[1]).toMatchObject({
      event: 'usage:empty_response',
      provider: 'openai',
      reason: 'unknown',
    });
  });

  it('redacts sensitive tokens in errorBody before storing', () => {
    const t = makeTracker();
    t.trackLlmStreamError({
      provider: 'anthropic',
      modelId: 'x',
      httpStatus: 401,
      errorCode: null,
      errorBody: 'bad Bearer sk-live-1234567890abcdef',
      durationMs: 5,
    });
    const recent = t.getRecentErrors();
    expect(recent[0].message).not.toContain('sk-live');
    expect(recent[0].message).toContain('[REDACTED]');
  });
});
