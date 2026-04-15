/**
 * F3: Auth transition detector.
 *
 * Persists a snapshot of auth state per-provider at ~/.bottega/last-auth-snapshot.json.
 * At app launch, diffs the previous snapshot against current state to detect regressions
 * (e.g. oauth → none) that signal silent token loss. A recent logout timestamp suppresses
 * the invalidated event to avoid false positives from user-initiated logouts.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';

const log = createChildLogger({ component: 'auth-snapshot' });

export const SNAPSHOT_VERSION = 1;
export type AuthType = 'none' | 'api_key' | 'oauth';

export interface AuthSnapshot {
  version: 1;
  capturedAt: string;
  appVersion: string;
  providers: Record<string, AuthType>;
  /** Epoch ms of last explicit user logout, per provider. Used to suppress false invalidated events. */
  lastLogoutAt?: Record<string, number>;
}

export interface AuthTransition {
  provider: string;
  previousType: AuthType;
  currentType: AuthType;
  userInitiated: boolean;
}

const DEFAULT_PATH = path.join(os.homedir(), '.bottega', 'last-auth-snapshot.json');
const USER_INITIATED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function getSnapshotPath(): string {
  return DEFAULT_PATH;
}

export function readSnapshot(
  filePath: string = DEFAULT_PATH,
  onDrop?: (reason: 'corrupt' | 'version_higher' | 'version_lower') => void,
): AuthSnapshot | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AuthSnapshot>;
    if (typeof parsed.providers !== 'object' || typeof parsed.version !== 'number') {
      log.warn({ filePath }, 'Auth snapshot malformed, ignoring');
      onDrop?.('corrupt');
      return null;
    }
    if (parsed.version > SNAPSHOT_VERSION) {
      // Future version — preserve the file (don't rewrite) and alert telemetry.
      log.warn({ filePath, version: parsed.version }, 'Auth snapshot newer than supported');
      onDrop?.('version_higher');
      return null;
    }
    if (parsed.version < SNAPSHOT_VERSION) {
      // Future-proof: add explicit migrators here when bumping SNAPSHOT_VERSION.
      log.warn({ filePath, version: parsed.version }, 'Auth snapshot older — migration not implemented');
      onDrop?.('version_lower');
      return null;
    }
    return parsed as AuthSnapshot;
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to read auth snapshot, treating as missing');
    onDrop?.('corrupt');
    return null;
  }
}

export function writeSnapshot(snapshot: AuthSnapshot, filePath: string = DEFAULT_PATH): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  renameSync(tmp, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort; Windows / non-POSIX may not honor chmod
  }
}

/**
 * A regression is a transition that *loses* capability:
 *   oauth → none, api_key → none, oauth → api_key
 * Progressions (none → oauth, none → api_key, api_key → oauth) are not regressions.
 */
function isRegression(prev: AuthType, curr: AuthType): boolean {
  if (prev === curr) return false;
  if (curr === 'none' && prev !== 'none') return true;
  if (prev === 'oauth' && curr === 'api_key') return true;
  return false;
}

/**
 * Compare previous vs current snapshot; return transitions worth reporting.
 * If prev is null, returns []. userInitiated is true if lastLogoutAt for the
 * provider falls within the 5-minute window ending at `now`.
 */
export function diffSnapshots(
  prev: AuthSnapshot | null,
  current: AuthSnapshot,
  now: number = Date.now(),
): AuthTransition[] {
  if (!prev) return [];
  const out: AuthTransition[] = [];
  const providers = new Set([...Object.keys(prev.providers), ...Object.keys(current.providers)]);
  for (const provider of providers) {
    const previousType = prev.providers[provider] ?? 'none';
    const currentType = current.providers[provider] ?? 'none';
    if (!isRegression(previousType, currentType)) continue;
    const logoutAt = current.lastLogoutAt?.[provider] ?? prev.lastLogoutAt?.[provider];
    const userInitiated = typeof logoutAt === 'number' && now - logoutAt <= USER_INITIATED_WINDOW_MS;
    out.push({ provider, previousType, currentType, userInitiated });
  }
  return out;
}

/**
 * F21: Pure helper — decide whether a post-upgrade "check-in" modal should
 * fire. Requires a version delta AND at least one non-user-initiated regression.
 */
export interface PostUpgradePayload {
  previousVersion: string;
  currentVersion: string;
  regressions: { provider: string; previousType: AuthType }[];
}

export function shouldShowPostUpgrade(
  prev: AuthSnapshot | null,
  current: AuthSnapshot,
  regressions: AuthTransition[],
): PostUpgradePayload | null {
  if (!prev) return null;
  if (prev.appVersion === current.appVersion) return null;
  const visible = regressions.filter((r) => !r.userInitiated);
  if (visible.length === 0) return null;
  return {
    previousVersion: prev.appVersion,
    currentVersion: current.appVersion,
    regressions: visible.map((r) => ({ provider: r.provider, previousType: r.previousType })),
  };
}

/** Record a logout timestamp to suppress the next-launch invalidated event. */
export function recordLogout(provider: string, filePath: string = DEFAULT_PATH, now: number = Date.now()): void {
  const existing = readSnapshot(filePath);
  const snapshot: AuthSnapshot = existing ?? {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date(now).toISOString(),
    appVersion: 'unknown',
    providers: {},
  };
  snapshot.lastLogoutAt = { ...(snapshot.lastLogoutAt ?? {}), [provider]: now };
  writeSnapshot(snapshot, filePath);
}
