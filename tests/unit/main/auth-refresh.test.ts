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

import { AuthRefresher, type RefreshAuthStorage } from '../../../src/main/auth-refresh.js';

function makeStorage(overrides: Partial<RefreshAuthStorage> = {}): RefreshAuthStorage {
  return {
    get: vi.fn().mockReturnValue({ type: 'oauth' }),
    getApiKey: vi.fn().mockResolvedValue('fresh-key'),
    drainErrors: vi.fn().mockReturnValue([]),
    remove: vi.fn(),
    ...overrides,
  };
}

describe('AuthRefresher', () => {
  it('outcome=ok when getApiKey succeeds and no errors drained', async () => {
    const storage = makeStorage();
    const refresher = new AuthRefresher(storage);
    const result = await refresher.refresh('anthropic');
    expect(result.outcome).toBe('ok');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('outcome=no_creds when provider has no oauth', async () => {
    const storage = makeStorage({ get: vi.fn().mockReturnValue(undefined) });
    const result = await new AuthRefresher(storage).refresh('anthropic');
    expect(result.outcome).toBe('no_creds');
  });

  it('outcome=no_creds when provider has api_key (not oauth)', async () => {
    const storage = makeStorage({ get: vi.fn().mockReturnValue({ type: 'api_key' }) });
    const result = await new AuthRefresher(storage).refresh('openai');
    expect(result.outcome).toBe('no_creds');
  });

  it('clears cred only when refresh produces NEW errors AND no key', async () => {
    // Simulate: noise in buffer → pre-drain clears it; second drain during
    // getApiKey call returns a fresh 401 → that's a real refresh failure.
    let callCount = 0;
    const storage = makeStorage({
      drainErrors: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? [new Error('stale unrelated error')] : [new Error('refresh 401')];
      }),
      getApiKey: vi.fn().mockResolvedValue(undefined),
    });
    const result = await new AuthRefresher(storage).refresh('anthropic');
    expect(result.outcome).toBe('failed');
    expect(result.errorMessage).toContain('refresh 401');
    expect(storage.remove).toHaveBeenCalledWith('anthropic');
  });

  it('CRITICAL BUG REGRESSION: unrelated errors in buffer do NOT wipe valid cred', async () => {
    // Pre-existing noise (from some earlier code path) is in the drain buffer.
    // getApiKey succeeds, returns a valid key. Fixed AuthRefresher must NOT
    // delete the cred just because the buffer had stale entries.
    let callCount = 0;
    const storage = makeStorage({
      drainErrors: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? [new Error('stale from auth-snapshot.get')] : [];
      }),
      getApiKey: vi.fn().mockResolvedValue('valid-fresh-token'),
    });
    const result = await new AuthRefresher(storage).refresh('anthropic');
    expect(result.outcome).toBe('ok');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('outcome=failed when getApiKey returns empty with no correlated error — does NOT wipe cred', async () => {
    // Ambiguous signal: no key but also no fresh error. Refuse to delete —
    // prefer "stale" status so later refresh attempts can succeed.
    const storage = makeStorage({ getApiKey: vi.fn().mockResolvedValue(undefined) });
    const result = await new AuthRefresher(storage).refresh('anthropic');
    expect(result.outcome).toBe('failed');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('rate-limits consecutive calls within 5 minutes', async () => {
    const storage = makeStorage();
    const clock = 1000;
    const refresher = new AuthRefresher(storage, () => clock);
    await refresher.refresh('anthropic');
    const second = await refresher.refresh('anthropic');
    expect(second.outcome).toBe('skipped_recent');
    expect(storage.getApiKey).toHaveBeenCalledTimes(1);
  });

  it('allows refresh after rate-limit window', async () => {
    const storage = makeStorage();
    let clock = 1000;
    const refresher = new AuthRefresher(storage, () => clock);
    await refresher.refresh('anthropic');
    clock += 6 * 60 * 1000;
    await refresher.refresh('anthropic');
    expect(storage.getApiKey).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent refreshes for same provider', async () => {
    let resolveFn: ((v: string) => void) | undefined;
    const storage = makeStorage({
      getApiKey: vi.fn().mockImplementation(
        () =>
          new Promise<string>((res) => {
            resolveFn = res;
          }),
      ),
    });
    const refresher = new AuthRefresher(storage);
    const a = refresher.refresh('anthropic');
    const b = refresher.refresh('anthropic');
    await new Promise((r) => setImmediate(r));
    resolveFn?.('fresh');
    await Promise.all([a, b]);
    expect(storage.getApiKey).toHaveBeenCalledTimes(1);
  });

  it('refreshAll hits each provider sequentially', async () => {
    const storage = makeStorage();
    const refresher = new AuthRefresher(storage);
    const results = await refresher.refreshAll(['anthropic', 'openai-codex']);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === 'ok')).toBe(true);
  });
});
