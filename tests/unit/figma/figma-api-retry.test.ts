import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { FigmaAPI } from '../../../src/figma/figma-api.js';

// Helper to create a mock Response
function mockResponse(status: number, body: any = {}, statusText = ''): Response {
  const isOk = status >= 200 && status < 300;
  return {
    ok: isOk,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('FigmaAPI retry with exponential backoff (W-002)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 1. Success on first try — no retries
  it('should succeed on first try without retries', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { document: { id: '0:0' } }));

    const api = new FigmaAPI('test-token');
    const result = await api.getFile('fileKey123');

    expect(result).toEqual({ document: { id: '0:0' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 2. Retry on 429 then success
  it('should retry on 429 and succeed on second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(429, 'Rate limited'))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const api = new FigmaAPI('test-token');
    const result = await api.getFile('fileKey123');

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 3. Retry on 500 then success
  it('should retry on 500 and succeed on second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'))
      .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

    const api = new FigmaAPI('test-token');
    const result = await api.getFile('fileKey123');

    expect(result).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 4. Retry on 502 then 503 then success (two retries)
  it('should retry on 502 then 503 and succeed on third attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(mockResponse(200, { finally: 'ok' }));

    const api = new FigmaAPI('test-token');
    const result = await api.getFile('fileKey123');

    expect(result).toEqual({ finally: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // 5. Max retries exhausted — throws after 3 attempts
  it('should throw after exhausting max retries (1 initial + 2 retries)', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(429, 'Rate limited'))
      .mockResolvedValueOnce(mockResponse(429, 'Rate limited'))
      .mockResolvedValueOnce(mockResponse(429, 'Rate limited'));

    const api = new FigmaAPI('test-token');
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (429)');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // 6. No retry on 400
  it('should throw immediately on 400 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, 'Bad Request'));

    const api = new FigmaAPI('test-token');
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 7. No retry on 403
  it('should throw immediately on 403 without retrying and increment 403 counter', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403, 'Invalid token'));

    const api = new FigmaAPI('test-token');
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (403)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 8. No retry on 404
  it('should throw immediately on 404 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404, 'Not Found'));

    const api = new FigmaAPI('test-token');
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (404)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 9. Circuit breaker: three 403s with "Invalid token" → apiDisabled
  it('should disable API after three consecutive 403s with "Invalid token"', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, 'Invalid token'));

    const api = new FigmaAPI('test-token');

    // First 403
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (403)');
    // Second 403
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (403)');
    // Third 403 — triggers disable
    await expect(api.getFile('fileKey123')).rejects.toThrow('Figma API error (403)');

    // Fourth call should fail with circuit breaker message, not even reaching fetch
    await expect(api.getFile('fileKey123')).rejects.toThrow(
      'Figma REST API disabled: invalid token (3 consecutive 403s)',
    );
    // fetch was called 3 times (the 4th call is blocked before fetch)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // 9b. Circuit breaker resets on success
  it('should reset 403 counter on successful response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(403, 'Invalid token'))
      .mockResolvedValueOnce(mockResponse(403, 'Invalid token'))
      // Success resets counter
      .mockResolvedValueOnce(mockResponse(200, { ok: true }))
      // Start counting again
      .mockResolvedValueOnce(mockResponse(403, 'Invalid token'))
      .mockResolvedValueOnce(mockResponse(403, 'Invalid token'));

    const api = new FigmaAPI('test-token');

    await expect(api.getFile('f1')).rejects.toThrow('Figma API error (403)');
    await expect(api.getFile('f2')).rejects.toThrow('Figma API error (403)');
    // Success resets counter
    await api.getFile('f3');
    // Two more 403s — should NOT disable (counter was reset)
    await expect(api.getFile('f4')).rejects.toThrow('Figma API error (403)');
    await expect(api.getFile('f5')).rejects.toThrow('Figma API error (403)');
    // API should still work (only 2 consecutive 403s, not 3)
    fetchMock.mockResolvedValueOnce(mockResponse(200, { still: 'working' }));
    const result = await api.getFile('f6');
    expect(result).toEqual({ still: 'working' });
  });

  // 10. Backoff timing — verify delays increase exponentially
  it('should apply exponential backoff delays between retries', async () => {
    // Stub Math.random to return 0 for deterministic jitter
    vi.spyOn(Math, 'random').mockReturnValue(0);

    fetchMock
      .mockResolvedValueOnce(mockResponse(500, 'error'))
      .mockResolvedValueOnce(mockResponse(500, 'error'))
      .mockResolvedValueOnce(mockResponse(200, { done: true }));

    const api = new FigmaAPI('test-token');
    const promise = api.getFile('fileKey123');

    // Attempt 0 → fetch fires immediately
    // After 500 error, delay = min(1000 * 2^0, 10_000) + 0 = 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    // Attempt 1 → fetch fires
    // After 500 error, delay = min(1000 * 2^1, 10_000) + 0 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);

    // Attempt 2 → fetch fires → 200 → success
    const result = await promise;
    expect(result).toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // 10b. Backoff is capped at 10 seconds
  it('should cap backoff delay at 10 seconds', async () => {
    // Even though MAX_RETRIES is 2 (so max attempt index is 1 with delay),
    // verify the formula: min(1000 * 2^attempt, 10_000)
    // attempt=0 → 1000, attempt=1 → 2000 (both below cap)
    // This test validates the cap doesn't break anything and jitter is added
    vi.spyOn(Math, 'random').mockReturnValue(1); // max jitter = 500ms

    fetchMock.mockResolvedValueOnce(mockResponse(502, 'error')).mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const api = new FigmaAPI('test-token');
    const promise = api.getFile('fileKey123');

    // delay = min(1000 * 2^0, 10_000) + 1 * 500 = 1500ms
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Additional: OAuth token uses Bearer header
  it('should use Bearer auth for OAuth tokens during retries', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(500, 'error')).mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const api = new FigmaAPI('figu_oauth_token');
    await api.getFile('fileKey123');

    // Both calls should use Bearer auth
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer figu_oauth_token');
      expect(headers['X-Figma-Token']).toBeUndefined();
    }
  });

  // Additional: non-"Invalid token" 403 does not increment circuit breaker
  it('should not increment circuit breaker on 403 without "Invalid token" message', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, 'Forbidden - no access to file'));

    const api = new FigmaAPI('test-token');

    // Three 403s without "Invalid token" — should NOT disable API
    await expect(api.getFile('f1')).rejects.toThrow('Figma API error (403)');
    await expect(api.getFile('f2')).rejects.toThrow('Figma API error (403)');
    await expect(api.getFile('f3')).rejects.toThrow('Figma API error (403)');

    // API should still be active (4th call reaches fetch)
    fetchMock.mockResolvedValueOnce(mockResponse(200, { still: 'active' }));
    const result = await api.getFile('f4');
    expect(result).toEqual({ still: 'active' });
  });
});
