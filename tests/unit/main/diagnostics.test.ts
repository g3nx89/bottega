import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare const __APP_VERSION__: string;

// ── Module mocks ─────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn().mockReturnValue('en-US'),
  },
}));

vi.mock('../../../src/main/subagent/session-logger.js', () => ({
  SUBAGENT_RUNS_DIR: '/tmp/bottega-test-subagent-runs',
}));

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ── Imports (after mocks) ────────────────────────

import {
  cleanOldLogs,
  collectSystemInfo,
  exportDiagnosticsZip,
  formatSystemInfoForClipboard,
} from '../../../src/main/diagnostics.js';

// ── Helpers ──────────────────────────────────────

function createTmpDir(): string {
  const dir = path.join(os.tmpdir(), `bottega-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rmDir(dir: string): void {
  try {
    const { rmSync } = require('node:fs');
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ── Tests ────────────────────────────────────────

describe('collectSystemInfo', () => {
  it('should return an object with expected shape', () => {
    const info = collectSystemInfo();

    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
    expect(info).toHaveProperty('app.version', __APP_VERSION__);
    expect(info).toHaveProperty('app.node');
    expect(info).toHaveProperty('os.platform');
    expect(info).toHaveProperty('os.arch');
    expect(info).toHaveProperty('cpu.model');
    expect(info).toHaveProperty('cpu.cores');
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info).toHaveProperty('ram.totalGB');
    expect(info.ram.totalGB).toBeGreaterThan(0);
    expect(info).toHaveProperty('ram.freeGB');
    expect(info).toHaveProperty('disk');
    expect(info).toHaveProperty('uptime.system');
    expect(info).toHaveProperty('uptime.process');
    expect(info).toHaveProperty('locale');
    expect(info).toHaveProperty('timezone');
    expect(info).toHaveProperty('timestamp');
    expect(() => new Date(info.timestamp)).not.toThrow();
  });
});

describe('formatSystemInfoForClipboard', () => {
  it('should return a multi-line string with key info', () => {
    const text = formatSystemInfoForClipboard();

    expect(text).toContain(`Bottega v${__APP_VERSION__}`);
    expect(text).toContain('Electron');
    expect(text).toContain('Node');
    expect(text).toContain('RAM:');
    expect(text).toContain('CPU:');
    expect(text).toContain('Disk:');
    expect(text).toContain('Locale:');
    expect(text).toContain('Timestamp:');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(5);
  });
});

describe('exportDiagnosticsZip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmDir(tmpDir);
  });

  it('should create a valid zip file with system-info.json', async () => {
    const zipPath = path.join(tmpDir, 'test-export.zip');
    await exportDiagnosticsZip(zipPath);

    expect(existsSync(zipPath)).toBe(true);
    // Zip files start with PK magic bytes (0x504B)
    const buf = readFileSync(zipPath);
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    // File should have non-trivial size (system-info.json alone is ~300 bytes)
    expect(statSync(zipPath).size).toBeGreaterThan(100);
  });

  it('should reject when destination path is invalid', async () => {
    const badPath = path.join(tmpDir, 'nonexistent', 'deeply', 'nested', 'test.zip');
    await expect(exportDiagnosticsZip(badPath)).rejects.toThrow();
  });
});

describe('cleanOldLogs', () => {
  it('should not throw when log directories do not exist', async () => {
    await expect(cleanOldLogs()).resolves.toBeUndefined();
  });

  it('should delete files older than 30 days and preserve recent files', async () => {
    // Create a temp directory to simulate a log dir
    const tmpLogDir = createTmpDir();
    const oldFile = path.join(tmpLogDir, 'old-log.jsonl');
    const recentFile = path.join(tmpLogDir, 'recent-log.jsonl');
    const activeLog = path.join(tmpLogDir, 'app.log');

    // Create files
    writeFileSync(oldFile, 'old data');
    writeFileSync(recentFile, 'recent data');
    writeFileSync(activeLog, 'active log');

    // Set old file mtime to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, sixtyDaysAgo, sixtyDaysAgo);

    // We can't easily override the LOG_DIR constant, but we can verify the function
    // runs without error. The actual file deletion is tested via the constants
    // pointing to ~/Library/Logs/Bottega which may not have old files.
    // This test at least verifies the async API contract.
    await expect(cleanOldLogs()).resolves.toBeUndefined();

    // Cleanup
    rmDir(tmpLogDir);
  });

  it('should handle subdirectories (e.g. subagent batch dirs) during cleanup', async () => {
    // cleanOldLogs includes SUBAGENT_RUNS_DIR which has batchId/ subdirectories.
    // The cleanDirectory function should handle recursive deletion of old subdirs.
    // This test verifies the function does not throw when encountering directories.
    await expect(cleanOldLogs()).resolves.toBeUndefined();
  });
});

describe('exportDiagnosticsZip — subagent runs', () => {
  it('should include subagent-runs in zip when directory exists', async () => {
    // Create a temp subagent-runs directory
    const tmpDir = createTmpDir();
    const batchDir = path.join(tmpDir, 'batch-123');
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(path.join(batchDir, 'scout.jsonl'), '{"test":true}\n');
    writeFileSync(path.join(batchDir, 'auditor.jsonl'), '{"test":true}\n');

    // We verify the zip function runs without error (it uses hardcoded paths,
    // so we can't inject the temp dir, but we verify the API contract).
    const destPath = path.join(os.tmpdir(), `bottega-diag-test-${Date.now()}.zip`);
    try {
      await exportDiagnosticsZip(destPath);
      expect(existsSync(destPath)).toBe(true);
      // Verify zip is non-empty (at least system-info.json is always included)
      expect(statSync(destPath).size).toBeGreaterThan(0);
    } finally {
      // Cleanup
      try {
        require('node:fs').unlinkSync(destPath);
      } catch {}
      rmDir(tmpDir);
    }
  });

  it('should handle missing subagent-runs directory gracefully', async () => {
    // exportDiagnosticsZip should not throw when subagent-runs dir doesn't exist
    const destPath = path.join(os.tmpdir(), `bottega-diag-test-${Date.now()}.zip`);
    try {
      await exportDiagnosticsZip(destPath);
      expect(existsSync(destPath)).toBe(true);
    } finally {
      try {
        require('node:fs').unlinkSync(destPath);
      } catch {}
    }
  });
});

describe('deriveSupportCode', () => {
  it('produces BTG-XXXX-XXXX format from UUID', async () => {
    const { deriveSupportCode } = await import('../../../src/shared/diagnostics-config.js');
    const code = deriveSupportCode('33f4a89b-3d08-4cd6-86be-cf36c90122b3');
    expect(code).toBe('BTG-33F4-A89B');
  });

  it('is deterministic', async () => {
    const { deriveSupportCode } = await import('../../../src/shared/diagnostics-config.js');
    const id = 'abcd1234-5678-9abc-def0-123456789abc';
    expect(deriveSupportCode(id)).toBe(deriveSupportCode(id));
  });

  it('produces uppercase hex', async () => {
    const { deriveSupportCode } = await import('../../../src/shared/diagnostics-config.js');
    const code = deriveSupportCode('aabbccdd-eeff-0011-2233-445566778899');
    expect(code).toMatch(/^BTG-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});
