/**
 * F5: Versioned auth metadata sidecar to Pi SDK's AuthStorage.
 *
 * Pi SDK's on-disk format is opaque to Bottega. auth-meta.json tracks Bottega's
 * expectation per-provider (which SDK slot, when saved, what kind) and lets us
 * detect drift: if a meta entry exists but the SDK no longer returns creds for
 * that provider, emit `usage:auth_migration {result:'failed'}`.
 *
 * The file is advisory — it never overrides Pi SDK state, only observes it.
 */

import crypto from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';

const log = createChildLogger({ component: 'auth-meta' });

export const META_VERSION = 1;

export interface AuthMetaEntry {
  savedAt: string;
  sdkProvider: string;
  kind: 'api_key' | 'oauth';
  checksum: string;
}

export interface AuthMeta {
  version: 1;
  bottegaVersion: string;
  providers: Record<string, AuthMetaEntry>;
}

export interface AuthMigrationEvent {
  provider: string;
  fromVersion: string;
  toVersion: string;
  result: 'ok' | 'failed';
  reason?: string;
}

const DEFAULT_PATH = path.join(os.homedir(), '.bottega', 'auth-meta.json');

export function getMetaPath(): string {
  return DEFAULT_PATH;
}

/** Hash the first N chars of a credential token for drift detection. Never exported to telemetry. */
export function checksumToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function readMeta(
  filePath: string = DEFAULT_PATH,
  onDrop?: (reason: 'corrupt' | 'version_higher' | 'version_lower') => void,
): AuthMeta | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<AuthMeta>;
    if (typeof parsed.version !== 'number' || typeof parsed.providers !== 'object') {
      log.warn({ filePath }, 'auth-meta.json malformed, ignoring');
      onDrop?.('corrupt');
      return null;
    }
    if (parsed.version > META_VERSION) {
      log.warn({ filePath, version: parsed.version }, 'auth-meta.json newer than supported');
      onDrop?.('version_higher');
      return null;
    }
    if (parsed.version < META_VERSION) {
      log.warn({ filePath, version: parsed.version }, 'auth-meta.json older — migration not implemented');
      onDrop?.('version_lower');
      return null;
    }
    return parsed as AuthMeta;
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to read auth-meta.json, treating as missing');
    onDrop?.('corrupt');
    return null;
  }
}

export function writeMeta(meta: AuthMeta, filePath: string = DEFAULT_PATH): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
  renameSync(tmp, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

/**
 * Minimal view Bottega needs from Pi SDK's AuthStorage for reconciliation.
 * Exposed as an interface so tests can stub without importing Pi SDK.
 */
import type { StoredCredential } from './auth-types.js';

export { readToken } from './auth-types.js';

export interface AuthStorageLike {
  get(provider: string): StoredCredential | undefined;
}

/**
 * Reconcile meta against live SDK state.
 * - SDK has cred + meta missing → add meta entry (lazy migration).
 * - SDK missing + meta present → SDK lost the token; emit failed migration.
 * - Both present → update checksum if changed (silent refresh).
 *
 * Returns the events that should be surfaced to the usage tracker, plus the
 * updated meta to persist.
 */
export function reconcileMeta(
  prev: AuthMeta | null,
  storage: AuthStorageLike,
  providers: string[],
  currentAppVersion: string,
): { next: AuthMeta; events: AuthMigrationEvent[] } {
  const events: AuthMigrationEvent[] = [];
  const now = new Date().toISOString();
  const next: AuthMeta = {
    version: META_VERSION,
    bottegaVersion: currentAppVersion,
    providers: {},
  };
  const prevVersion = prev?.bottegaVersion ?? 'unknown';

  for (const provider of providers) {
    const cred = storage.get(provider);
    const prevEntry = prev?.providers[provider];

    if (cred) {
      const tokenRaw = cred.type === 'api_key' ? cred.key : (cred.access ?? cred.accessToken ?? '');
      const checksum = tokenRaw ? checksumToken(tokenRaw) : '';
      next.providers[provider] = {
        savedAt: prevEntry?.savedAt ?? now,
        sdkProvider: provider,
        kind: cred.type,
        checksum,
      };
    } else if (prevEntry) {
      events.push({
        provider,
        fromVersion: prevVersion,
        toVersion: currentAppVersion,
        result: 'failed',
        reason: 'sdk_missing',
      });
      // drop from meta so we don't re-log next launch
    }
  }

  return { next, events };
}

/** Called when an auth change succeeds — persist the new state synchronously. */
export function touchMetaEntry(
  provider: string,
  kind: 'api_key' | 'oauth',
  tokenRaw: string,
  currentAppVersion: string,
  filePath: string = DEFAULT_PATH,
): void {
  const existing = readMeta(filePath);
  const meta: AuthMeta = existing ?? { version: META_VERSION, bottegaVersion: currentAppVersion, providers: {} };
  meta.providers[provider] = {
    savedAt: new Date().toISOString(),
    sdkProvider: provider,
    kind,
    checksum: tokenRaw ? checksumToken(tokenRaw) : '',
  };
  meta.bottegaVersion = currentAppVersion;
  writeMeta(meta, filePath);
}

/** Remove a provider from meta (on logout). */
export function removeMetaEntry(provider: string, filePath: string = DEFAULT_PATH): void {
  const existing = readMeta(filePath);
  if (!existing) return;
  if (!(provider in existing.providers)) return;
  delete existing.providers[provider];
  writeMeta(existing, filePath);
}
