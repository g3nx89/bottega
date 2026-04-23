/**
 * F17: Last-known-good model per provider.
 *
 * Persists the last model that completed a successful turn for each provider
 * at ~/.bottega/last-good-model.json. Used by launch-time auto-fallback logic
 * when the currently-selected model's probe returns non-ok.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSchemaVersion, readJsonOrQuarantine } from './fs-utils.js';

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
  const parsed = readJsonOrQuarantine<Partial<LastGoodRecord>>(
    filePath,
    (v): v is Partial<LastGoodRecord> =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as any).version === 'number' &&
      typeof (v as any).providers === 'object',
  );
  if (!parsed) {
    if (existsSync(filePath)) onDrop?.('corrupt');
    return null;
  }
  if (!checkSchemaVersion(filePath, parsed.version!, LAST_GOOD_VERSION, onDrop, 'last-good-model.json')) {
    return null;
  }
  return parsed as LastGoodRecord;
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
  const existing = readLastGood(filePath) ?? { version: 1 as const, providers: {} };
  const current = existing.providers[provider];
  if (current && current.modelId === modelId) return; // no-op
  existing.providers[provider] = { modelId, updatedAt: new Date(now).toISOString() };
  writeLastGood(existing, filePath);
}

export function getLastGood(provider: string, filePath: string = DEFAULT_PATH): string | null {
  const record = readLastGood(filePath);
  return record?.providers[provider]?.modelId ?? null;
}
