/**
 * F17: Last-known-good model per provider.
 *
 * Persists the last model that completed a successful turn for each provider
 * at ~/.bottega/last-good-model.json. Used by launch-time auto-fallback logic
 * when the currently-selected model's probe returns non-ok.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';

const log = createChildLogger({ component: 'last-known-good' });
const DEFAULT_PATH = path.join(os.homedir(), '.bottega', 'last-good-model.json');

export interface LastGoodRecord {
  version: 1;
  providers: Record<string, { modelId: string; updatedAt: string }>;
}

export function getLastGoodPath(): string {
  return DEFAULT_PATH;
}

const LAST_GOOD_VERSION = 1;

export function readLastGood(
  filePath: string = DEFAULT_PATH,
  onDrop?: (reason: 'corrupt' | 'version_higher' | 'version_lower') => void,
): LastGoodRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LastGoodRecord>;
    if (typeof parsed.version !== 'number' || typeof parsed.providers !== 'object') {
      onDrop?.('corrupt');
      return null;
    }
    if (parsed.version > LAST_GOOD_VERSION) {
      log.warn({ filePath, version: parsed.version }, 'last-good-model.json newer than supported');
      onDrop?.('version_higher');
      return null;
    }
    if (parsed.version < LAST_GOOD_VERSION) {
      log.warn({ filePath, version: parsed.version }, 'last-good-model.json older — migration not implemented');
      onDrop?.('version_lower');
      return null;
    }
    return parsed as LastGoodRecord;
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to read last-good-model.json');
    onDrop?.('corrupt');
    return null;
  }
}

export function writeLastGood(record: LastGoodRecord, filePath: string = DEFAULT_PATH): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(tmp, filePath);
}

export function recordLastGood(
  provider: string,
  modelId: string,
  filePath: string = DEFAULT_PATH,
  now: number = Date.now(),
): void {
  const existing = readLastGood(filePath) ?? { version: 1 as 1, providers: {} };
  const current = existing.providers[provider];
  if (current && current.modelId === modelId) return; // no-op
  existing.providers[provider] = { modelId, updatedAt: new Date(now).toISOString() };
  writeLastGood(existing, filePath);
}

export function getLastGood(provider: string, filePath: string = DEFAULT_PATH): string | null {
  const record = readLastGood(filePath);
  return record?.providers[provider]?.modelId ?? null;
}
