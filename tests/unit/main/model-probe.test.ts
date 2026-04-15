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

import { classifyProbe, hashApiKey, ModelProbe } from '../../../src/main/model-probe.js';

function makeStorage(key: string | null = 'k'): { getApiKey: () => Promise<string | null> } {
  return { getApiKey: vi.fn().mockResolvedValue(key) };
}

describe('classifyProbe', () => {
  it('maps 2xx → ok', () => {
    expect(classifyProbe(200)).toBe('ok');
    expect(classifyProbe(204)).toBe('ok');
  });
  it('maps 401/403/404/429 to matching statuses', () => {
    expect(classifyProbe(401)).toBe('unauthorized');
    expect(classifyProbe(403)).toBe('forbidden');
    expect(classifyProbe(404)).toBe('not_found');
    expect(classifyProbe(429)).toBe('rate_limit');
  });
  it('maps 400 containing "model" to not_found', () => {
    expect(classifyProbe(400, 'model gpt-5.4-foo not available')).toBe('not_found');
  });
  it('maps 400 without model hint to error', () => {
    expect(classifyProbe(400, 'bad request')).toBe('error');
  });
  it('maps 5xx to error', () => {
    expect(classifyProbe(503)).toBe('error');
  });
});

describe('ModelProbe cache', () => {
  it('returns unauthorized immediately when no api key', async () => {
    const probe = new ModelProbe(makeStorage(null));
    const result = await probe.probe('anthropic', 'claude-sonnet-4-6');
    expect(result.status).toBe('unauthorized');
  });

  it('falls back to ok when no fetcher is registered for provider', async () => {
    const probe = new ModelProbe(makeStorage('key'), { fetchers: {} });
    const result = await probe.probe('weird-provider', 'modelX');
    expect(result.status).toBe('ok');
  });

  it('caches successful probe within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ httpStatus: 200, body: '' });
    const probe = new ModelProbe(makeStorage('key'), { fetchers: { anthropic: fetcher }, ttlMs: 10_000 });
    const first = await probe.probe('anthropic', 'a');
    const second = await probe.probe('anthropic', 'a');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
  });

  it('bypasses cache after TTL expires', async () => {
    let clock = 1000;
    const fetcher = vi.fn().mockResolvedValue({ httpStatus: 200 });
    const probe = new ModelProbe(makeStorage('key'), {
      fetchers: { anthropic: fetcher },
      ttlMs: 100,
      now: () => clock,
    });
    await probe.probe('anthropic', 'a');
    clock += 200;
    await probe.probe('anthropic', 'a');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache when api key changes (hash diff)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ httpStatus: 200 });
    let key: string | null = 'k1';
    const probe = new ModelProbe({ getApiKey: async () => key }, { fetchers: { anthropic: fetcher } });
    await probe.probe('anthropic', 'a');
    key = 'k2';
    await probe.probe('anthropic', 'a');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('getCached respects auth hash scoping', async () => {
    const fetcher = vi.fn().mockResolvedValue({ httpStatus: 200 });
    const probe = new ModelProbe(makeStorage('key'), { fetchers: { anthropic: fetcher } });
    await probe.probe('anthropic', 'a');
    expect(probe.getCached('anthropic', 'a', hashApiKey('key'))).not.toBeNull();
    expect(probe.getCached('anthropic', 'a', hashApiKey('other'))).toBeNull();
  });

  it('classifies 401 responses as unauthorized', async () => {
    const fetcher = vi.fn().mockResolvedValue({ httpStatus: 401, body: 'bad' });
    const probe = new ModelProbe(makeStorage('key'), { fetchers: { anthropic: fetcher } });
    const result = await probe.probe('anthropic', 'a');
    expect(result.status).toBe('unauthorized');
    expect(result.httpStatus).toBe(401);
  });

  it('dedupes inflight probes (single call for concurrent requests)', async () => {
    let resolveFn: ((v: any) => void) | undefined;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveFn = res;
        }),
    );
    const probe = new ModelProbe(makeStorage('key'), { fetchers: { anthropic: fetcher } });
    const a = probe.probe('anthropic', 'm');
    const b = probe.probe('anthropic', 'm');
    // Drain microtasks so fetcher gets invoked and captures resolveFn.
    await new Promise((r) => setImmediate(r));
    resolveFn?.({ httpStatus: 200 });
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('getStatusSnapshot returns unauthorized when no key', async () => {
    const probe = new ModelProbe(makeStorage(null));
    expect(await probe.getStatusSnapshot('anthropic', 'm')).toBe('unauthorized');
  });

  it('getStatusSnapshot returns unknown when no probe has run', async () => {
    const probe = new ModelProbe(makeStorage('k'));
    expect(await probe.getStatusSnapshot('anthropic', 'm')).toBe('unknown');
  });
});
