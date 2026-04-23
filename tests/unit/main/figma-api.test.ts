/**
 * Unit tests for FigmaAPI — focused on setAccessToken() runtime behavior.
 *
 * Ensures that:
 * 1. A fresh token sets the header and makes requests go through.
 * 2. After 3 consecutive "Invalid token" 403s, the client disables itself.
 * 3. `setAccessToken('fresh')` recovers from the disabled state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  registerSecret: vi.fn(),
  unregisterSecret: vi.fn(),
}));

import { FigmaAPI } from '../../../src/figma/figma-api.js';

describe('FigmaAPI.setAccessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function mockInvalidToken403() {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
      text: async () => '{"err":"Invalid token"}',
      json: async () => ({ err: 'Invalid token' }),
    });
  }

  function mockOk(body: unknown = { ok: true }) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  it('uses X-Figma-Token header for PAT tokens (non-figu_ prefix)', async () => {
    const api = new FigmaAPI('plain_pat');
    mockOk({ document: {} });

    await api.getFile('abc123');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers['X-Figma-Token']).toBe('plain_pat');
    expect((init as any).headers.Authorization).toBeUndefined();
  });

  it('uses Bearer header for OAuth-style tokens (figu_ prefix)', async () => {
    const api = new FigmaAPI('figu_xyz');
    mockOk({ document: {} });

    await api.getFile('abc123');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers.Authorization).toBe('Bearer figu_xyz');
    expect((init as any).headers['X-Figma-Token']).toBeUndefined();
  });

  it('disables itself after 3 consecutive Invalid token 403s', async () => {
    const api = new FigmaAPI('badtoken');
    mockInvalidToken403();

    for (let i = 0; i < 3; i++) {
      await expect(api.getFile('abc123')).rejects.toThrow();
    }

    // 4th call should short-circuit without hitting fetch
    const callsBefore = fetchMock.mock.calls.length;
    await expect(api.getFile('abc123')).rejects.toThrow(/disabled/i);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('setAccessToken resets the disabled flag and 403 counter', async () => {
    const api = new FigmaAPI('badtoken');
    mockInvalidToken403();

    for (let i = 0; i < 3; i++) {
      await expect(api.getFile('abc123')).rejects.toThrow();
    }
    await expect(api.getFile('abc123')).rejects.toThrow(/disabled/i);

    // Recovery: new token + next call succeeds
    api.setAccessToken('freshtoken');
    fetchMock.mockReset();
    mockOk({ document: { id: '0:0' } });

    const result = await api.getFile('abc123');
    expect(result).toEqual({ document: { id: '0:0' } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers['X-Figma-Token']).toBe('freshtoken');
  });

  it('setAccessToken("") causes subsequent requests to fail fast without hitting fetch', async () => {
    // HIGH 1 fix: after clear, in-flight tools must stop immediately instead
    // of wasting 3x403 round-trips on the way to the circuit breaker.
    const api = new FigmaAPI('initial');
    api.setAccessToken('');

    await expect(api.getFile('abc123')).rejects.toThrow(/token not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('constructor without token also fast-fails on first request', async () => {
    const api = new FigmaAPI();
    await expect(api.getFile('abc123')).rejects.toThrow(/token not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FigmaAPI.validateToken (static)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('returns ok + handle on 200', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ handle: 'alessandro', id: '1234', email: 'a@b.c' }),
      text: async () => '',
    });

    const result = await FigmaAPI.validateToken('figd_ok');
    expect(result).toEqual({ ok: true, handle: 'alessandro' });

    // Sanity: email never bubbles up into the return value (PII regression guard).
    expect(JSON.stringify(result)).not.toContain('a@b.c');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers['X-Figma-Token']).toBe('figd_ok');
  });

  it('trims whitespace before sending the header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ handle: 'alex' }),
      text: async () => '',
    });
    await FigmaAPI.validateToken('  figd_padded  ');
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as any).headers['X-Figma-Token']).toBe('figd_padded');
  });

  it('falls back to id when handle is missing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user_42' }),
      text: async () => '',
    });
    const result = await FigmaAPI.validateToken('figd_x');
    expect(result).toEqual({ ok: true, handle: 'user_42' });
  });

  it('returns Invalid token on 401/403', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized',
    });
    expect(await FigmaAPI.validateToken('bad')).toEqual({
      ok: false,
      error: 'Invalid token',
      status: 401,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'forbidden',
    });
    expect(await FigmaAPI.validateToken('bad')).toEqual({
      ok: false,
      error: 'Invalid token',
      status: 403,
    });
  });

  it('surfaces server error body for non-401/403 failures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'service unavailable',
    });
    const result = await FigmaAPI.validateToken('figd_x');
    expect(result).toEqual({
      ok: false,
      error: 'Figma API error (503): service unavailable',
      status: 503,
    });
  });

  it('wraps network errors in an ok:false result', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await FigmaAPI.validateToken('figd_x')).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('rejects empty or whitespace-only tokens without calling fetch', async () => {
    expect(await FigmaAPI.validateToken('')).toEqual({ ok: false, error: 'Token is required' });
    expect(await FigmaAPI.validateToken('   ')).toEqual({ ok: false, error: 'Token is required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
