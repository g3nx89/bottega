/**
 * Diagnostics configuration — shared between logger (src/figma/) and main process.
 *
 * Lives in src/shared/ to avoid cross-layer dependency where src/figma/logger.ts
 * would otherwise need to import from src/main/.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Config persistence ───────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'diagnostics.json');

export interface DiagnosticsConfig {
  sendDiagnostics: boolean;
  anonymousId: string;
}

let cachedConfig: DiagnosticsConfig | null = null;

/** Load config synchronously. Cached after first call — use reloadDiagnosticsConfig() to refresh. */
export function loadDiagnosticsConfig(): DiagnosticsConfig {
  if (cachedConfig) return cachedConfig;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!data.anonymousId) {
      data.anonymousId = crypto.randomUUID();
      saveDiagnosticsConfigSync(data);
    }
    cachedConfig = data;
    return data;
  } catch {
    const config: DiagnosticsConfig = {
      sendDiagnostics: false,
      anonymousId: crypto.randomUUID(),
    };
    saveDiagnosticsConfigSync(config);
    cachedConfig = config;
    return config;
  }
}

/** Force reload config from disk (used after saving changes). */
export function reloadDiagnosticsConfig(): DiagnosticsConfig {
  cachedConfig = null;
  return loadDiagnosticsConfig();
}

/** Save config asynchronously (used from IPC handlers). */
export async function saveDiagnosticsConfig(config: DiagnosticsConfig): Promise<void> {
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
}

/** Save config synchronously (used during init). */
function saveDiagnosticsConfigSync(config: DiagnosticsConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
}

// ── Session UID ──────────────────────────────────

/** Short session ID generated per app launch for log correlation. */
export function generateSessionUid(): string {
  return `s_${crypto.randomBytes(4).toString('hex')}`;
}

// ── Axiom transport factory ──────────────────────

/**
 * Axiom ingest token — write-only, scoped to bottega-logs dataset only.
 * Safe to embed: this token can only append data, never read or delete.
 * Override via BOTTEGA_AXIOM_TOKEN env var for development/testing.
 */
const DEFAULT_AXIOM_TOKEN = 'xaat-39a0811f-08b4-47fa-987b-aa7b154673e6';
const AXIOM_TOKEN = process.env.BOTTEGA_AXIOM_TOKEN || DEFAULT_AXIOM_TOKEN;
const AXIOM_DATASET = process.env.BOTTEGA_AXIOM_DATASET || 'bottega-logs';

export function createAxiomTransport(
  config: DiagnosticsConfig,
): { target: string; options: Record<string, unknown>; level: string } | null {
  if (!config.sendDiagnostics || !AXIOM_TOKEN) return null;
  return {
    target: '@axiomhq/pino',
    options: {
      dataset: AXIOM_DATASET,
      token: AXIOM_TOKEN,
    },
    level: 'info',
  };
}

// ── Pino redaction paths ─────────────────────────

export const REDACT_PATHS = [
  'apiKey',
  '*.apiKey',
  'key',
  '*.key',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
];
