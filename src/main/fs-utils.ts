import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';

const log = pino({ name: 'fs-utils', level: process.env.LOG_LEVEL || 'info' });

/**
 * Atomically write JSON data to a file (write to .tmp then rename).
 * Creates parent directories if needed. The rename is atomic on POSIX/NTFS,
 * so the file is never in a half-written state.
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Root for quarantined files. Env override BOTTEGA_QUARANTINE_ROOT wins
 * (used by tests to avoid polluting global state). Otherwise quarantined
 * files live alongside the source in `<dirname>/.corrupted/<ts>/<basename>`,
 * so each state dir is self-contained.
 */
export function quarantineRoot(sourcePath: string): string {
  return process.env.BOTTEGA_QUARANTINE_ROOT || path.join(path.dirname(sourcePath), '.corrupted');
}

/**
 * Move a file into the quarantine dir under a timestamped subdir, preserving
 * its basename. Best-effort: swallow filesystem errors so callers can always
 * proceed with a fresh default. Returns the destination path on success.
 */
export function quarantineFile(filePath: string, reason: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const destDir = path.join(quarantineRoot(filePath), ts);
    mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(filePath));
    renameSync(filePath, dest);
    log.warn({ from: filePath, to: dest, reason }, 'Quarantined corrupted file');
    return dest;
  } catch (err) {
    log.error({ err, filePath, reason }, 'Failed to quarantine file');
    return null;
  }
}

/**
 * Version-compat outcome for `checkSchemaVersion` — helper shared by every
 * versioned-file loader (auth-meta, auth-snapshot, last-known-good).
 */
export type VersionDropReason = 'corrupt' | 'version_higher' | 'version_lower';

/**
 * Shared version gate for JSON files carrying a `version` field. Handles the
 * three outcomes versioned loaders all re-implement identically: accepted,
 * newer-than-supported, older-than-supported. On a mismatch the file is
 * quarantined so a subsequent load starts clean.
 *
 * Returns true when the file is accepted and caller should proceed; false
 * when the caller must treat the file as absent (onDrop already fired).
 */
export function checkSchemaVersion(
  filePath: string,
  parsedVersion: number,
  expected: number,
  onDrop?: (reason: VersionDropReason) => void,
  label = 'file',
): boolean {
  if (parsedVersion === expected) return true;
  const higher = parsedVersion > expected;
  const reason: VersionDropReason = higher ? 'version_higher' : 'version_lower';
  log.warn(
    { filePath, version: parsedVersion, expected, label },
    higher ? `${label} newer than supported — quarantining` : `${label} older — quarantining (no migration)`,
  );
  quarantineFile(filePath, reason.replace('_', '-'));
  onDrop?.(reason);
  return false;
}

/**
 * Read a JSON file, validate it, and return the parsed value. On parse or
 * validation failure, the file is moved into `~/.bottega/.corrupted/{ts}/`
 * and `null` is returned so the caller can start fresh.
 *
 * `validator` returns true when the parsed value is acceptable. Omit it to
 * accept any well-formed JSON.
 */
export function readJsonOrQuarantine<T = unknown>(
  filePath: string,
  validator?: (value: unknown) => value is T,
): T | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to read file — quarantining');
    quarantineFile(filePath, 'read-failed');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn({ err, filePath }, 'Malformed JSON — quarantining');
    quarantineFile(filePath, 'parse-error');
    return null;
  }
  if (validator && !validator(parsed)) {
    log.warn({ filePath }, 'Validator rejected content — quarantining');
    quarantineFile(filePath, 'validator-rejected');
    return null;
  }
  return parsed as T;
}
