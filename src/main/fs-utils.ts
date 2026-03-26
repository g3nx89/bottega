import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
