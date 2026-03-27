/**
 * Diagnostics — local log export (.zip) and log retention cleanup.
 *
 * Collects app.log, crash dumps, metrics, and system info into a single
 * zip archive for easy sharing during support conversations.
 */

import { createWriteStream, existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import { app } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { getDiskStats } from './vitals.js';

const log = createChildLogger({ component: 'diagnostics' });

// ── Data source locations ────────────────────────

const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'Bottega');
const CRASHES_DIR = path.join(LOG_DIR, 'crashes');
const BOTTEGA_DIR = path.join(os.homedir(), '.bottega');
const METRICS_DIR = path.join(BOTTEGA_DIR, 'metrics');

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — skip oversized files
const RETENTION_DAYS = 30;

// ── System info ──────────────────────────────────

export interface SystemInfo {
  app: { version: string; electron: string; node: string; chrome: string };
  os: { platform: string; release: string; arch: string };
  cpu: { model: string; cores: number };
  ram: { totalGB: number; freeGB: number };
  disk: { totalGB: number; freeGB: number };
  uptime: { system: number; process: number };
  locale: string;
  timezone: string;
  timestamp: string;
}

export function collectSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const disk = getDiskStats();

  return {
    app: {
      version: __APP_VERSION__,
      electron: process.versions.electron || 'unknown',
      node: process.versions.node,
      chrome: process.versions.chrome || 'unknown',
    },
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    cpu: {
      model: cpus[0]?.model?.trim() || 'unknown',
      cores: cpus.length,
    },
    ram: {
      totalGB: Math.round((os.totalmem() / 1e9) * 10) / 10,
      freeGB: Math.round((os.freemem() / 1e9) * 10) / 10,
    },
    disk,
    uptime: {
      system: Math.round(os.uptime()),
      process: Math.round(process.uptime()),
    },
    locale: app.getLocale(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };
}

// ── Clipboard-friendly system info ───────────────

export function formatSystemInfoForClipboard(): string {
  const info = collectSystemInfo();
  return [
    `Bottega v${info.app.version}`,
    `Electron ${info.app.electron} / Node ${info.app.node} / Chrome ${info.app.chrome}`,
    `${info.os.platform} ${info.os.release} (${info.os.arch})`,
    `CPU: ${info.cpu.model} (${info.cpu.cores} cores)`,
    `RAM: ${info.ram.freeGB} GB free / ${info.ram.totalGB} GB total`,
    `Disk: ${info.disk.freeGB} GB free / ${info.disk.totalGB} GB total`,
    `Uptime: system ${formatDuration(info.uptime.system)}, app ${formatDuration(info.uptime.process)}`,
    `Locale: ${info.locale} (${info.timezone})`,
    `Timestamp: ${info.timestamp}`,
  ].join('\n');
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Zip export ───────────────────────────────────

export function exportDiagnosticsZip(destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      log.info({ bytes: archive.pointer(), destPath }, 'Diagnostics zip created');
      resolve();
    });

    output.on('error', (err) => {
      archive.destroy();
      reject(err);
    });

    archive.on('error', (err) => {
      log.error({ err }, 'Archiver error');
      reject(err);
    });

    archive.pipe(output);

    // 1. app.log
    const appLog = path.join(LOG_DIR, 'app.log');
    if (existsSync(appLog) && safeSize(appLog) < MAX_FILE_BYTES) {
      archive.file(appLog, { name: 'logs/app.log' });
    }

    // Also include rotated log files (app.log.2026-03-24, etc.)
    appendGlob(archive, LOG_DIR, /^app\.log\.\d/, 'logs');

    // 2. Crash dumps
    appendDir(archive, CRASHES_DIR, 'crashes');

    // 3. Metrics
    appendDir(archive, METRICS_DIR, 'metrics');

    // 4. System info snapshot
    const info = collectSystemInfo();
    archive.append(JSON.stringify(info, null, 2), { name: 'system-info.json' });

    void archive.finalize();
  });
}

/** Append all files in a directory (non-recursive) that are under the size cap. */
function appendDir(archive: archiver.Archiver, dirPath: string, prefix: string): void {
  if (!existsSync(dirPath)) return;
  try {
    for (const file of readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, file);
      const stat = lstatSync(fullPath);
      if (stat.isFile() && stat.size < MAX_FILE_BYTES) {
        archive.file(fullPath, { name: `${prefix}/${file}` });
      }
    }
  } catch (err: unknown) {
    log.warn({ err, dirPath }, 'Failed to read directory for diagnostics');
  }
}

/** Append files matching a regex pattern from a directory. */
function appendGlob(archive: archiver.Archiver, dirPath: string, pattern: RegExp, prefix: string): void {
  if (!existsSync(dirPath)) return;
  try {
    for (const file of readdirSync(dirPath)) {
      if (pattern.test(file) && safeSize(path.join(dirPath, file)) < MAX_FILE_BYTES) {
        archive.file(path.join(dirPath, file), { name: `${prefix}/${file}` });
      }
    }
  } catch (err: unknown) {
    log.warn({ err, dirPath }, 'Failed to read rotated logs for diagnostics');
  }
}

function safeSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return Infinity;
  }
}

// ── Log retention cleanup ────────────────────────

/**
 * Delete log and metric files older than RETENTION_DAYS.
 * Called once at app startup. Non-blocking, best-effort.
 */
export async function cleanOldLogs(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const dir of [LOG_DIR, CRASHES_DIR, METRICS_DIR]) {
    if (!existsSync(dir)) continue;
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        // Only clean rotated/old files, not the active app.log
        if (file === 'app.log') continue;
        const fullPath = path.join(dir, file);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.mtimeMs < cutoff) {
            await fs.unlink(fullPath);
            cleaned++;
          }
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  if (cleaned > 0) {
    log.info({ cleaned, retentionDays: RETENTION_DAYS }, 'Old log files cleaned up');
  }
}
