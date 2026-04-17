/**
 * Guardrails user-facing config. Persisted as JSON in ~/.bottega/guardrails.json.
 * Mirrors the subagent/config.ts pattern (in-memory cache, readJsonOrQuarantine).
 *
 * v1 exposes a single toggle — `enabled` — since rules are hardcoded.
 * Future versions may add per-rule enable/disable here.
 */

import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../../figma/logger.js';
import { atomicWriteJsonSync, readJsonOrQuarantine } from '../fs-utils.js';

const log = createChildLogger({ component: 'guardrails-config' });

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'guardrails.json');

/** Bump when the schema grows incompatible fields so future load paths can migrate explicitly. */
export const GUARDRAILS_CONFIG_VERSION = 1;

export interface GuardrailsSettings {
  version: number;
  enabled: boolean;
}

export const DEFAULT_GUARDRAILS_SETTINGS: GuardrailsSettings = {
  version: GUARDRAILS_CONFIG_VERSION,
  enabled: true, // opt-out per decisione utente
};

function validate(raw: unknown): GuardrailsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GUARDRAILS_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    version: typeof obj.version === 'number' ? obj.version : GUARDRAILS_CONFIG_VERSION,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_GUARDRAILS_SETTINGS.enabled,
  };
}

let cached: GuardrailsSettings | null = null;

export function loadGuardrailsSettings(): GuardrailsSettings {
  if (cached) return cached;
  const raw = readJsonOrQuarantine<unknown>(CONFIG_PATH, (v): v is unknown => v !== null && typeof v === 'object');
  cached = validate(raw);
  return cached;
}

export function saveGuardrailsSettings(settings: GuardrailsSettings): void {
  const validated = validate(settings);
  try {
    atomicWriteJsonSync(CONFIG_PATH, validated);
    cached = validated;
  } catch (err) {
    log.warn({ err, path: CONFIG_PATH }, 'Failed to save guardrails settings');
    throw err;
  }
}

/** Test-only: reset cache so next load() reads from disk (or defaults). */
export function __resetCacheForTests(): void {
  cached = null;
}
