/**
 * F7: OAuth proactive refresh orchestrator.
 *
 * Pi SDK's `AuthStorage.getApiKey()` auto-refreshes OAuth tokens with lock-based
 * concurrency control. We don't need a manual refresh path — we just need to
 * *trigger* it at launch and observe failures via `authStorage.drainErrors()`.
 *
 * Per-provider mutex and rate limit are enforced here (belt-and-suspenders on
 * top of Pi SDK's file lock).
 */

import { createChildLogger } from '../figma/logger.js';

const log = createChildLogger({ component: 'auth-refresh' });
const RATE_LIMIT_MS = 5 * 60 * 1000;

export type RefreshOutcome = 'ok' | 'skipped_recent' | 'no_creds' | 'failed';

export interface RefreshResult {
  provider: string;
  outcome: RefreshOutcome;
  errorMessage?: string;
}

import type { StoredCredential } from './auth-types.js';

/** Minimal storage surface the refresher needs — keeps tests decoupled from Pi SDK. */
export interface RefreshAuthStorage {
  get(provider: string): StoredCredential | undefined;
  getApiKey(provider: string): Promise<string | undefined>;
  drainErrors?(): Error[];
  remove(provider: string): void;
}

export class AuthRefresher {
  private mutex = new Map<string, Promise<RefreshResult>>();
  private lastAttempt = new Map<string, number>();

  constructor(
    private storage: RefreshAuthStorage,
    private now: () => number = Date.now,
  ) {}

  /**
   * Refresh one provider. Returns the outcome; if the cred was cleared (failed),
   * callers can emit a banner signal. Rate-limited per provider.
   */
  async refresh(provider: string): Promise<RefreshResult> {
    const existing = this.mutex.get(provider);
    if (existing) return existing;

    const lastAt = this.lastAttempt.get(provider);
    if (lastAt !== undefined && this.now() - lastAt < RATE_LIMIT_MS) {
      return { provider, outcome: 'skipped_recent' };
    }

    const task = this.runRefresh(provider).finally(() => this.mutex.delete(provider));
    this.mutex.set(provider, task);
    return task;
  }

  private async runRefresh(provider: string): Promise<RefreshResult> {
    this.lastAttempt.set(provider, this.now());
    const cred = this.storage.get(provider);
    if (!cred || cred.type !== 'oauth') return { provider, outcome: 'no_creds' };

    // CRITICAL bug fix: drainErrors() is process-scoped, not per-provider. Any
    // error left in the buffer by an earlier path (auth:get-auth-status reads,
    // reconcileMeta, previous refresh) would be attributed to THIS provider and
    // trigger storage.remove() — wiping a valid credential. Fix: flush the
    // buffer *before* the refresh call, then drain again and treat only the
    // delta as this refresh's errors.
    this.storage.drainErrors?.(); // discard pre-existing noise

    // Trigger refresh via getApiKey — Pi SDK handles locking + expiry check.
    try {
      const key = await this.storage.getApiKey(provider);
      const newErrors = this.storage.drainErrors?.() ?? [];
      // Refuse to delete a cred on ambiguous signals: require BOTH (a) no key
      // produced AND (b) a fresh error emitted during this call. A successful
      // getApiKey + stray unrelated error → stale.
      if (!key && newErrors.length > 0) {
        const msg = newErrors[0]?.message ?? 'refresh returned no key';
        log.warn({ provider, errors: newErrors.map((e) => e.message) }, 'OAuth refresh failed — clearing cred');
        try {
          this.storage.remove(provider);
        } catch {
          // best-effort
        }
        return { provider, outcome: 'failed', errorMessage: msg };
      }
      if (!key) {
        // Missing key without a correlated error — don't wipe, just mark stale.
        log.warn({ provider }, 'OAuth refresh returned no key but no error — keeping cred');
        return { provider, outcome: 'failed', errorMessage: 'no key returned' };
      }
      return { provider, outcome: 'ok' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ provider, err }, 'OAuth refresh threw');
      try {
        this.storage.remove(provider);
      } catch {
        // best-effort
      }
      return { provider, outcome: 'failed', errorMessage: message };
    }
  }

  /**
   * Refresh all OAuth providers currently in storage. Parallel per-provider —
   * mutex guarantees no double-refresh for the same provider.
   */
  async refreshAll(providers: string[]): Promise<RefreshResult[]> {
    return Promise.all(providers.map((p) => this.refresh(p)));
  }
}
