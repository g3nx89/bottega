import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigmaAPI } from '../../../src/figma/figma-api.js';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  registerSecret: vi.fn(),
  unregisterSecret: vi.fn(),
}));

describe('FigmaAPI.validateToken — abort + malformed response branches', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('rejects the hang with a timeout-shaped error after VALIDATE_TIMEOUT_MS (10s)', async () => {
    // Audit row figma-api.ts:139 — user on a flaky network; validateToken
    // must not hang the UI forever.
    globalThis.fetch = vi.fn(
      (_input: any, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        }),
    ) as unknown as typeof fetch;

    const promise = FigmaAPI.validateToken('fake-token');
    // advance past 10s timeout — AbortController fires, fetch rejects.
    await vi.advanceTimersByTimeAsync(10_001);

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aborted/i);
  });

  it('gracefully handles response.text() throwing on a non-2xx response', async () => {
    // Audit row figma-api.ts:149 — Figma returns broken body; .text() rejects
    // but `validateToken` must still resolve, not crash.
    globalThis.fetch = vi.fn(async () => ({
      status: 500,
      ok: false,
      text: async () => {
        throw new Error('body stream already read');
      },
    })) as unknown as typeof fetch;

    const result = await FigmaAPI.validateToken('fake-token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/Figma API error \(500\)/);
    }
  });
});
