/**
 * Launch-time auth orchestration extracted from index.ts for testability.
 *
 * Each step is a small pure-ish function accepting its side-effect deps
 * explicitly. The orchestrator composes them; index.ts just wires and calls.
 */

import { createChildLogger } from '../figma/logger.js';
import { type AuthMeta, reconcileMeta } from './auth-meta.js';
import { AuthRefresher, type RefreshAuthStorage } from './auth-refresh.js';
import {
  type AuthSnapshot,
  type AuthType,
  diffSnapshots,
  type PostUpgradePayload,
  shouldShowPostUpgrade,
} from './auth-snapshot.js';
import {
  classifyKeychain,
  type KeychainProbeResult,
  runKeychainProbe,
  type SafeStorageLike,
} from './startup-guards.js';

const log = createChildLogger({ component: 'startup-auth' });

// ── Types ──────────────────────────────────────────────────────

// StartupAuthStorage is just an alias — all consumers use the shared
// StoredCredential shape via RefreshAuthStorage.
export type StartupAuthStorage = RefreshAuthStorage;

export interface StartupAuthTracker {
  trackAuthInvalidated(data: {
    provider: string;
    previousType: AuthType;
    currentType: AuthType;
    userInitiated: boolean;
    reason?: string;
  }): void;
  trackKeychainStatus(data: { available: boolean; probeOk: boolean | null; reason?: string }): void;
  trackAuthMigration(data: {
    provider: string;
    fromVersion: string;
    toVersion: string;
    result: 'ok' | 'failed';
    reason?: string;
  }): void;
}

export interface StartupAuthEmitter {
  emitKeychainUnavailable(payload: KeychainProbeResult): void;
  emitPostUpgrade(payload: PostUpgradePayload): void;
}

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Build a fresh AuthSnapshot by querying the auth storage for each display
 * group. 'oauth' takes precedence over 'api_key' when both are present.
 */
export function buildAuthSnapshot(
  storage: StartupAuthStorage,
  providerMap: Record<string, string>,
  appVersion: string,
  previousLogoutAt?: Record<string, number>,
): AuthSnapshot {
  const providers: Record<string, AuthType> = {};
  for (const [displayGroup, oauthId] of Object.entries(providerMap)) {
    const oauthCred = storage.get(oauthId);
    const apiKeyCred = storage.get(displayGroup);
    providers[displayGroup] =
      oauthCred?.type === 'oauth'
        ? 'oauth'
        : apiKeyCred?.type === 'api_key' || oauthCred?.type === 'api_key'
          ? 'api_key'
          : 'none';
  }
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    appVersion,
    providers,
    lastLogoutAt: previousLogoutAt,
  };
}

// ── Step orchestrators ────────────────────────────────────────

export interface KeychainStepDeps {
  safeStorage: SafeStorageLike;
  tracker: StartupAuthTracker;
  emitter: StartupAuthEmitter;
}

/** F6: probe keychain, record status, surface banner on decrypt failure. */
export function runKeychainStep(deps: KeychainStepDeps): KeychainProbeResult {
  const probe = runKeychainProbe(deps.safeStorage);
  deps.tracker.trackKeychainStatus(probe);
  if (classifyKeychain(probe) === 'broken') {
    deps.emitter.emitKeychainUnavailable(probe);
  }
  return probe;
}

export interface SnapshotStepDeps {
  storage: StartupAuthStorage;
  providerMap: Record<string, string>;
  appVersion: string;
  readSnapshot: () => AuthSnapshot | null;
  writeSnapshot: (snap: AuthSnapshot) => void;
  tracker: StartupAuthTracker;
  emitter: StartupAuthEmitter;
}

/**
 * F3 + F21: snapshot current auth, diff vs previous, emit auth_invalidated for
 * regressions, emit post-upgrade modal payload when version changed w/ regressions.
 */
export function runSnapshotStep(deps: SnapshotStepDeps): {
  current: AuthSnapshot;
  regressions: ReturnType<typeof diffSnapshots>;
} {
  const prev = deps.readSnapshot();
  const current = buildAuthSnapshot(deps.storage, deps.providerMap, deps.appVersion, prev?.lastLogoutAt);
  // Compute once — previously called twice with identical args, causing
  // wasted work and divergence risk if the `now` default drifted between calls.
  const allTransitions = diffSnapshots(prev, current);
  const regressions = allTransitions.filter((t) => !t.userInitiated);
  for (const t of regressions) {
    deps.tracker.trackAuthInvalidated({
      provider: t.provider,
      previousType: t.previousType,
      currentType: t.currentType,
      userInitiated: false,
    });
  }
  deps.writeSnapshot(current);
  const postUpgrade = shouldShowPostUpgrade(prev, current, allTransitions);
  if (postUpgrade) deps.emitter.emitPostUpgrade(postUpgrade);
  return { current, regressions };
}

export interface RefreshStepDeps {
  storage: StartupAuthStorage;
  oauthIds: string[];
  tracker: StartupAuthTracker;
  refresherFactory?: (storage: StartupAuthStorage) => { refreshAll: (ids: string[]) => Promise<any[]> };
}

/** F7: proactively refresh OAuth tokens at launch and emit auth_invalidated on refresh_failed. */
export async function runRefreshStep(deps: RefreshStepDeps): Promise<void> {
  const refresher = deps.refresherFactory ? deps.refresherFactory(deps.storage) : new AuthRefresher(deps.storage);
  const results = await refresher.refreshAll(deps.oauthIds);
  for (const r of results) {
    if (r.outcome === 'failed') {
      deps.tracker.trackAuthInvalidated({
        provider: r.provider,
        previousType: 'oauth',
        currentType: 'none',
        userInitiated: false,
        reason: `refresh_failed: ${r.errorMessage ?? 'unknown'}`,
      });
    }
  }
}

export interface MetaStepDeps {
  storage: StartupAuthStorage;
  providerMap: Record<string, string>;
  appVersion: string;
  readMeta: () => AuthMeta | null;
  writeMeta: (meta: AuthMeta) => void;
  tracker: StartupAuthTracker;
}

/** F5: reconcile versioned auth meta with SDK state, emit auth_migration events. */
export function runMetaStep(deps: MetaStepDeps): void {
  const providers = [...new Set([...Object.keys(deps.providerMap), ...Object.values(deps.providerMap)])];
  const { next, events } = reconcileMeta(deps.readMeta(), deps.storage, providers, deps.appVersion);
  for (const evt of events) {
    deps.tracker.trackAuthMigration(evt);
  }
  deps.writeMeta(next);
}

/** Top-level orchestrator invoked from index.ts. Each step isolated via try/catch. */
export async function runStartupAuth(deps: {
  keychain: KeychainStepDeps;
  snapshot: SnapshotStepDeps;
  refresh: RefreshStepDeps;
  meta: MetaStepDeps;
}): Promise<void> {
  try {
    runKeychainStep(deps.keychain);
  } catch (err) {
    log.warn({ err }, 'Keychain step failed');
  }
  try {
    runSnapshotStep(deps.snapshot);
  } catch (err) {
    log.warn({ err }, 'Snapshot step failed');
  }
  try {
    await runRefreshStep(deps.refresh);
  } catch (err) {
    log.warn({ err }, 'Refresh step failed');
  }
  try {
    runMetaStep(deps.meta);
  } catch (err) {
    log.warn({ err }, 'Meta step failed');
  }
}
