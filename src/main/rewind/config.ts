import os from 'node:os';
import path from 'node:path';

export const MAX_CHECKPOINTS = 20;
const DEFAULT_STORAGE_ROOT = path.join(os.homedir(), '.bottega', 'state', 'rewind');
export const STORAGE_ROOT = process.env.BOTTEGA_STATE_DIR || DEFAULT_STORAGE_ROOT;
export const SCHEMA_VERSION = 1;
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const PRE_STATE_TIMEOUT_MS = parsePositiveInt(process.env.BOTTEGA_REWIND_PROBE_TIMEOUT_MS, 1500);
export const PROBE_TIMEOUT_MS = parsePositiveInt(process.env.BOTTEGA_REWIND_VERSION_PROBE_TIMEOUT_MS, 2000);
