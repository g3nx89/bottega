/**
 * Session logger — JSONL logs per subagent run for diagnostics.
 * Best-effort: never throws, only warns on failure.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../../figma/logger.js';

const log = createChildLogger({ component: 'subagent-logger' });

export const SUBAGENT_RUNS_DIR = path.join(os.homedir(), '.bottega', 'subagent-runs');

/**
 * Write JSONL log for a subagent run.
 * Creates batch directory if needed. Best-effort — never throws.
 */
export async function writeSubagentLog(batchId: string, role: string, events: unknown[]): Promise<void> {
  try {
    const dir = path.join(SUBAGENT_RUNS_DIR, batchId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const lines: string[] = [];
    for (const event of events) {
      try {
        lines.push(JSON.stringify(event));
      } catch {
        // Skip non-serializable entries
      }
    }

    if (lines.length === 0) return;

    await fs.writeFile(path.join(dir, `${role}.jsonl`), lines.join('\n') + '\n', { mode: 0o600, flag: 'a' });
  } catch (err) {
    log.warn({ err, batchId, role }, 'Failed to write subagent log');
  }
}
