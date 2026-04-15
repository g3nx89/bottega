/**
 * F11: Capability probe with TTL cache.
 *
 * Per-provider HTTP probe against a cheap endpoint (GET /models) to classify
 * whether a given (provider, modelId) combo can actually be used. Results
 * cached by (provider, modelId, authHash) — re-login bumps the auth hash so
 * stale 401s clear automatically.
 *
 * Providers without a real fetcher fall back to auth-presence only: if
 * getApiKey resolves, status='ok'; else 'unauthorized'.
 */

import crypto from 'node:crypto';

export type ProbeStatus = 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limit' | 'error';

export interface ProbeResult {
  status: ProbeStatus;
  httpStatus?: number;
  errorBody?: string;
  probedAt: number;
  ttlMs: number;
  cacheHit: boolean;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;

import type { AuthType } from './auth-snapshot.js';

export interface AuthStorageGetKey {
  getApiKey(provider: string): Promise<string | null | undefined>;
  /**
   * Optional credential-type hook. When the credential is an OAuth token,
   * the probe skips the HTTP call (Pi SDK already validated it at login,
   * and the Anthropic /v1/models endpoint rejects OAuth bearer tokens
   * sent as x-api-key with a misleading 401).
   */
  getCredentialType?(provider: string): AuthType;
}

/**
 * A ProbeFetcher performs the actual HTTP request. Separated per-provider so
 * tests can mock the network and so new providers only need a fetcher entry.
 * Returning `null` means "delegate to auth-presence fallback".
 */
export type ProbeFetcher = (
  apiKey: string,
  modelId: string,
  signal: AbortSignal,
) => Promise<{ httpStatus: number; body?: string } | null>;

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Default fetchers for well-known providers. Use GET /models where available. */
export const DEFAULT_FETCHERS: Record<string, ProbeFetcher> = {
  anthropic: async (apiKey, _modelId, signal) => {
    const res = await fetchWithTimeout(
      'https://api.anthropic.com/v1/models',
      {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
      signal,
    );
    const body = res.ok ? '' : await res.text().catch(() => '');
    return { httpStatus: res.status, body };
  },
  openai: async (apiKey, _modelId, signal) => {
    const res = await fetchWithTimeout(
      'https://api.openai.com/v1/models',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      signal,
    );
    const body = res.ok ? '' : await res.text().catch(() => '');
    return { httpStatus: res.status, body };
  },
};

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Map an HTTP response into a ProbeStatus enum. */
export function classifyProbe(httpStatus: number, body = ''): ProbeStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'ok';
  if (httpStatus === 401) return 'unauthorized';
  if (httpStatus === 403) return 'forbidden';
  if (httpStatus === 404) return 'not_found';
  if (httpStatus === 429) return 'rate_limit';
  // Heuristic: 400 with "model" in body → treat as not_found
  if (httpStatus === 400 && /model/i.test(body)) return 'not_found';
  return 'error';
}

/** Observability sink — wired to UsageTracker.trackModelProbe in production. */
export interface ProbeTelemetrySink {
  trackModelProbe(data: {
    provider: string;
    modelId: string;
    result: ProbeStatus;
    httpStatus?: number;
    durationMs: number;
    cacheHit: boolean;
  }): void;
}

export interface ModelProbeOptions {
  fetchers?: Record<string, ProbeFetcher>;
  ttlMs?: number;
  now?: () => number;
  telemetry?: ProbeTelemetrySink;
}

export class ModelProbe {
  private cache = new Map<string, ProbeResult>();
  private inflight = new Map<string, Promise<ProbeResult>>();
  private fetchers: Record<string, ProbeFetcher>;
  private ttlMs: number;
  private now: () => number;
  private telemetry?: ProbeTelemetrySink;

  constructor(
    private authStorage: AuthStorageGetKey,
    opts: ModelProbeOptions = {},
  ) {
    this.fetchers = opts.fetchers ?? DEFAULT_FETCHERS;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.telemetry = opts.telemetry;
  }

  private cacheKey(provider: string, modelId: string, authHash: string): string {
    return `${provider}:${modelId}:${authHash}`;
  }

  getCached(provider: string, modelId: string, authHash: string): ProbeResult | null {
    const hit = this.cache.get(this.cacheKey(provider, modelId, authHash));
    if (!hit) return null;
    if (this.now() - hit.probedAt > hit.ttlMs) return null;
    return { ...hit, cacheHit: true };
  }

  /**
   * Synchronous status lookup without triggering a probe. Returns 'unknown' if
   * never probed (renderer shows yellow dot). Callers treat 'ok' as green,
   * unauthorized/forbidden/not_found as red.
   */
  async getStatusSnapshot(provider: string, modelId: string): Promise<ProbeStatus | 'unknown'> {
    const apiKey = await this.authStorage.getApiKey(provider);
    if (!apiKey) return 'unauthorized';
    // OAuth credentials are validated by Pi SDK at login. The probe HTTP
    // call would 401 (wrong endpoint for bearer tokens), so skip the cache
    // lookup entirely and report ok — matches runProbe's OAuth shortcut.
    if (this.authStorage.getCredentialType?.(provider) === 'oauth') return 'ok';
    const hit = this.getCached(provider, modelId, hashApiKey(apiKey));
    return hit?.status ?? 'unknown';
  }

  async probe(provider: string, modelId: string, signal?: AbortSignal): Promise<ProbeResult> {
    // Inflight dedup by (provider, modelId) — must run synchronously before
    // any await so concurrent callers share the same task.
    const prelimKey = `prelim:${provider}:${modelId}`;
    const existing = this.inflight.get(prelimKey);
    if (existing) return existing;

    const startedAt = this.now();
    const task = (async (): Promise<ProbeResult> => {
      const apiKey = await this.authStorage.getApiKey(provider);
      if (!apiKey) {
        const r: ProbeResult = { status: 'unauthorized', probedAt: this.now(), ttlMs: this.ttlMs, cacheHit: false };
        this.telemetry?.trackModelProbe({
          provider,
          modelId,
          result: r.status,
          durationMs: this.now() - startedAt,
          cacheHit: false,
        });
        return r;
      }
      const authHash = hashApiKey(apiKey);
      const cached = this.getCached(provider, modelId, authHash);
      if (cached) {
        this.telemetry?.trackModelProbe({
          provider,
          modelId,
          result: cached.status,
          httpStatus: cached.httpStatus,
          durationMs: this.now() - startedAt,
          cacheHit: true,
        });
        return cached;
      }
      const result = await this.runProbe(provider, modelId, apiKey, signal);
      this.cache.set(this.cacheKey(provider, modelId, authHash), { ...result, cacheHit: false });
      this.telemetry?.trackModelProbe({
        provider,
        modelId,
        result: result.status,
        httpStatus: result.httpStatus,
        durationMs: this.now() - startedAt,
        cacheHit: false,
      });
      return result;
    })().finally(() => this.inflight.delete(prelimKey));
    this.inflight.set(prelimKey, task);
    return task;
  }

  private async runProbe(
    provider: string,
    modelId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<ProbeResult> {
    const fetcher = this.fetchers[provider];
    const probedAt = this.now();
    // OAuth credentials cannot be validated against /v1/models endpoints
    // that expect an API key. Pi SDK already validated the token at login
    // — treat presence as 'ok' rather than producing a misleading 401.
    if (this.authStorage.getCredentialType?.(provider) === 'oauth') {
      return { status: 'ok', probedAt, ttlMs: this.ttlMs, cacheHit: false };
    }
    if (!fetcher) {
      // Auth-presence only (we already have apiKey)
      return { status: 'ok', probedAt, ttlMs: this.ttlMs, cacheHit: false };
    }
    try {
      const effectiveSignal = signal ?? new AbortController().signal;
      const raw = await fetcher(apiKey, modelId, effectiveSignal);
      if (!raw) return { status: 'ok', probedAt, ttlMs: this.ttlMs, cacheHit: false };
      return {
        status: classifyProbe(raw.httpStatus, raw.body),
        httpStatus: raw.httpStatus,
        errorBody: raw.body ? raw.body.slice(0, 200) : undefined,
        probedAt,
        ttlMs: this.ttlMs,
        cacheHit: false,
      };
    } catch (err: any) {
      return {
        status: 'error',
        errorBody: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err).slice(0, 200),
        probedAt,
        ttlMs: this.ttlMs,
        cacheHit: false,
      };
    }
  }

  /** Testing/admin: drop all cached entries. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Attach telemetry after construction (avoids circular dep with UsageTracker). */
  setTelemetry(sink: ProbeTelemetrySink): void {
    this.telemetry = sink;
  }
}
