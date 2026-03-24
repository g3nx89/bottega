/**
 * Logger for Bottega
 *
 * Writes structured JSON logs to:
 *   - stdout (via pino-pretty in dev)
 *   - ~/Library/Logs/Bottega/app.log (file, always JSON)
 *   - Axiom (remote, opt-in via diagnostics config)
 *
 * When remote diagnostics are enabled, every log carries a `sid` (session UID)
 * for correlation on Axiom. Sensitive fields are redacted via pino's built-in
 * redact option.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import {
  createAxiomTransport,
  generateSessionUid,
  loadDiagnosticsConfig,
  REDACT_PATHS,
} from '../shared/diagnostics-config.js';

const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Bottega');
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'app.log');

// ── Session UID for log correlation ──────────────

const diagnosticsConfig = loadDiagnosticsConfig();
const sid = generateSessionUid();

/** The session UID for this app launch. Used by UsageTracker and log correlation. */
export const sessionUid = sid;

// ── Build transport targets ──────────────────────

const targets: pino.TransportTargetOptions[] = [
  // stdout with pretty print
  { target: 'pino-pretty', level: 'info' },
  // file in JSON format for post-mortem analysis
  { target: 'pino/file', options: { destination: logFile }, level: 'debug' },
];

const axiomTarget = createAxiomTransport(diagnosticsConfig);
if (axiomTarget) {
  targets.push(axiomTarget);
}

// ── Create logger ────────────────────────────────

const isRemoteEnabled = diagnosticsConfig.sendDiagnostics;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    // Redact sensitive fields across all transports
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    // Attach session UID to every log for Axiom correlation
    // Only added when remote diagnostics are enabled to keep local logs clean
    ...(isRemoteEnabled ? { mixin: () => ({ sid }) } : {}),
  },
  pino.transport({ targets }),
);

export const logFilePath = logFile;

export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
