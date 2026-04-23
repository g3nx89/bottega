import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Minimal Response mock for fetch-based tests. Provides the subset of the
 * Response interface that Bottega's `FigmaAPI.request()` consumes:
 * `ok`, `status`, `statusText`, `headers`, `json()`, `text()`.
 */
export function mockResponse(
  status: number,
  body: unknown = {},
  opts: { statusText?: string; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: opts.statusText ?? '',
    headers: new Headers(opts.headers),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Install a vi.fn() as `globalThis.fetch` for the duration of a describe block.
 * Returns a handle whose `.fetchMock` is refreshed before each test and restored
 * on teardown. Consolidates the three-line beforeEach/afterEach scaffold shared
 * by every fetch-based unit test.
 *
 * Usage:
 *   const h = setupFetchMock();
 *   it('...', () => { h.fetchMock.mockResolvedValue(mockResponse(200, {})); ... });
 */
export function setupFetchMock(): { fetchMock: ReturnType<typeof vi.fn> } {
  const holder = { fetchMock: vi.fn() };
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    holder.fetchMock = vi.fn();
    globalThis.fetch = holder.fetchMock as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  return holder;
}

/**
 * Await a promise that MUST reject, return the caught value. Using this
 * instead of ad-hoc try/catch avoids the failure mode where the test body
 * never triggers the rejection and silently passes on the trailing throw.
 */
export async function captureRejection<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject');
}
