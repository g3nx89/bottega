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
import { getErrorMeta, redactErrorStrings } from './errors.js';

/**
 * Module-level registry of known secret strings (PATs, OAuth tokens, API
 * keys) that the pino serializer MUST scrub from error `message`/`stack`
 * before the record reaches file/Axiom transports. Registering here is the
 * last line of defense against upstream code constructing an Error whose
 * message interpolates a secret (undici internals, proxy wrappers,
 * third-party libs).
 */
const registeredSecrets = new Set<string>();

/** Register a secret so the error serializer scrubs it from log strings. */
export function registerSecret(secret: string | undefined): void {
  if (secret && secret.trim()) registeredSecrets.add(secret);
}

/** Unregister a secret (e.g. on token clear/rotation). */
export function unregisterSecret(secret: string | undefined): void {
  if (secret) registeredSecrets.delete(secret);
}

/**
 * Pure helper: serialize an error for structured logging. Scrubs the provided
 * secrets (plus token-shaped patterns via the errors.ts fallback regex) from
 * message/stack, and merges ErrorMeta under a dedicated `error_meta`
 * namespace so Axiom can group logs by `error_meta.category` without
 * colliding with pino core fields.
 *
 * Exported so tests can exercise the serialization logic directly without
 * spinning up a pino transport.
 */
export function serializeLoggedError(err: unknown, secrets: string[] = []): Record<string, unknown> {
  const base = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>;
  const scrubbedMessage = redactErrorStrings(base.message, secrets);
  const scrubbedStack = redactErrorStrings(base.stack, secrets);
  const meta = getErrorMeta(err);
  // Enumerate via Object.values so new ErrorMeta fields auto-flow without
  // requiring a manual update here.
  const hasMeta = Object.values(meta).some((v) => v !== undefined);
  return {
    ...base,
    message: scrubbedMessage,
    stack: scrubbedStack,
    ...(hasMeta && { error_meta: meta }),
  };
}

/**
 * Pino adapter — snapshots the live `registeredSecrets` set and delegates
 * to the pure `serializeLoggedError`. Kept private; no external importers.
 */
function errSerializer(err: unknown): Record<string, unknown> {
  return serializeLoggedError(err, [...registeredSecrets]);
}

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
    // Enrich error records with ErrorMeta (category, http_status, etc.) so
    // Axiom dashboards can break down by error_category.
    serializers: {
      err: errSerializer,
      error: errSerializer,
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
