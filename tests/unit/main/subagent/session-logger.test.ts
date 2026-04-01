/**
 * 10h. Session Logger unit tests
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { SUBAGENT_RUNS_DIR, writeSubagentLog } from '../../../../src/main/subagent/session-logger.js';

// Use a temp dir for actual file operations
const TEST_DIR = path.join(os.tmpdir(), `bottega-logger-test-${Date.now()}`);

describe('Session Logger', () => {
  describe('SUBAGENT_RUNS_DIR', () => {
    it('points to ~/.bottega/subagent-runs', () => {
      expect(SUBAGENT_RUNS_DIR).toContain('.bottega');
      expect(SUBAGENT_RUNS_DIR).toContain('subagent-runs');
    });
  });

  describe('writeSubagentLog', () => {
    beforeEach(async () => {
      await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    });

    it('creates batch directory and writes JSONL file', async () => {
      const batchId = `test-batch-${Date.now()}`;
      const events = [
        { type: 'spawned', role: 'scout', timestamp: Date.now() },
        { type: 'completed', role: 'scout', output: 'found 10 components' },
      ];

      await writeSubagentLog(batchId, 'scout', events);

      // Verify the directory and file exist under SUBAGENT_RUNS_DIR
      const dirPath = path.join(SUBAGENT_RUNS_DIR, batchId);
      const filePath = path.join(dirPath, 'scout.jsonl');

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0])).toEqual(events[0]);
        expect(JSON.parse(lines[1])).toEqual(events[1]);
      } finally {
        // Clean up
        await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('handles empty events array without throwing', async () => {
      await expect(writeSubagentLog('empty-batch', 'scout', [])).resolves.toBeUndefined();
    });

    it('skips non-serializable entries without throwing', async () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      const events = [{ type: 'normal' }, circular, { type: 'also-normal' }];
      // Should not throw
      await expect(writeSubagentLog('skip-batch', 'scout', events)).resolves.toBeUndefined();
    });

    it('writes separate files for different roles in the same batch', async () => {
      const batchId = `multi-role-${Date.now()}`;
      await writeSubagentLog(batchId, 'scout', [{ role: 'scout' }]);
      await writeSubagentLog(batchId, 'auditor', [{ role: 'auditor' }]);

      const dirPath = path.join(SUBAGENT_RUNS_DIR, batchId);
      try {
        const files = await fs.readdir(dirPath);
        expect(files).toContain('scout.jsonl');
        expect(files).toContain('auditor.jsonl');
      } finally {
        await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('JSONL format: one JSON object per line, newline-terminated', async () => {
      const batchId = `jsonl-format-${Date.now()}`;
      const events = [{ a: 1 }, { b: 2 }, { c: 3 }];
      await writeSubagentLog(batchId, 'analyst', events);

      const dirPath = path.join(SUBAGENT_RUNS_DIR, batchId);
      try {
        const content = await fs.readFile(path.join(dirPath, 'analyst.jsonl'), 'utf8');
        expect(content.endsWith('\n')).toBe(true);
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(3);
        // Each line is valid JSON
        for (const line of lines) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      } finally {
        await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
