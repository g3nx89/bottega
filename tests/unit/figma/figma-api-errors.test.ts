import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  registerSecret: vi.fn(),
  unregisterSecret: vi.fn(),
}));

import { getErrorMeta, HttpError } from '../../../src/figma/errors.js';
import { FigmaAPI } from '../../../src/figma/figma-api.js';
import { captureRejection, mockResponse } from '../../helpers/mock-response.js';

describe('FigmaAPI integration with HttpError', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws HttpError with category tag on 429 + parsed retry-after', async () => {
    fetchMock.mockResolvedValue(mockResponse(429, '{"err":"rate limited"}', { headers: { 'retry-after': '60' } }));
    const err = (await captureRejection(new FigmaAPI('tok').getFile('k'))) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(429);
    expect(err.figmaErr).toBe('rate limited');
    expect(err.message).toContain('Retry after 60s');

    const meta = getErrorMeta(err);
    expect(meta).toMatchObject({ category: 'rate_limit', http_status: 429, is_retryable: true });
  });

  it('surfaces figma err body on 403 + meta auth', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, '{"err":"File not allowed to be exported"}'));
    const err = (await captureRejection(new FigmaAPI('tok').getFile('k'))) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.figmaErr).toBe('File not allowed to be exported');
    expect(getErrorMeta(err).category).toBe('auth');
  });

  it('buildForbiddenMessage output contains proxy hint + docs URL', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, '{"err":"Invalid scope"}'));
    const err = (await captureRejection(new FigmaAPI('tok').getFile('k'))) as HttpError;

    expect(err.message).toContain('HTTP_PROXY');
    expect(err.message).toContain('https://help.figma.com');
    expect(err.message).toContain('Invalid scope');
  });

  it('redacts access token from responseBody', async () => {
    const token = 'figd_secretabcdefghij';
    fetchMock.mockResolvedValue(mockResponse(500, `internal error leaked ${token} here`));
    const err = (await captureRejection(new FigmaAPI(token).getFile('k'))) as HttpError;

    expect(err.responseBody).toContain('[REDACTED]');
    expect(err.responseBody).not.toContain(token);
  });

  it('tags network errors with category:network', async () => {
    const netErr = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    fetchMock.mockRejectedValue(netErr);
    const err = await captureRejection(new FigmaAPI('tok').getFile('k'));

    expect(getErrorMeta(err)).toMatchObject({
      category: 'network',
      network_code: 'ECONNREFUSED',
      is_retryable: true,
    });
  });

  it('tags unknown throws during fetch with category:internal', async () => {
    fetchMock.mockRejectedValue(new Error('mystery'));
    const err = await captureRejection(new FigmaAPI('tok').getFile('k'));

    expect(getErrorMeta(err)).toMatchObject({ category: 'internal', is_retryable: false });
  });

  it('throws HttpError when API is disabled by circuit breaker', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, '{"err":"Invalid token"}'));
    const api = new FigmaAPI('tok');
    for (let i = 0; i < 3; i++) {
      await expect(api.getFile('k')).rejects.toBeInstanceOf(HttpError);
    }
    const err = (await captureRejection(api.getFile('k'))) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(0);
    expect(err.message).toContain('disabled');
    expect(getErrorMeta(err)).toMatchObject({ category: 'auth', is_retryable: false });
  });

  it('throws HttpError when token is missing', async () => {
    const err = (await captureRejection(new FigmaAPI('').getFile('k'))) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(0);
  });

  it('detects null nodes in 200 response from /v1/files/:key/nodes', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { nodes: { 'a:1': null, 'b:2': { id: 'b:2' } } }));
    const err = (await captureRejection(
      new FigmaAPI('tok').getNodes('k', ['a:1', 'b:2'], { missingNodePolicy: 'throw' }),
    )) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.message).toContain('a:1');
    expect(err.message).not.toContain('b:2');
    expect(getErrorMeta(err).category).toBe('not_found');
  });

  it('retries on new 408 and 504 codes (upstream parity)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock
        .mockResolvedValueOnce(mockResponse(408, 'Request Timeout'))
        .mockResolvedValueOnce(mockResponse(504, 'Gateway Timeout'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const res = await new FigmaAPI('tok').getFile('k');
      expect(res).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
