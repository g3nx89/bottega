/**
 * Subagent configuration — load/save settings for parallel subagents.
 * Follows the same pattern as image-gen/config.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL_MICRO_JUDGE_IDS, getJudgeDefinition } from './judge-registry.js';
import type { MicroJudgeId, SubagentRole } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'subagent.json');

export interface SubagentModelConfig {
  provider: string;
  modelId: string;
}

export interface MicroJudgeConfig {
  enabled: boolean;
  model: SubagentModelConfig;
}

export interface SubagentSettings {
  models: Record<SubagentRole, SubagentModelConfig>;
  judgeMode: 'off' | 'auto';
  autoRetry: boolean;
  maxRetries: number;
  microJudges: Record<MicroJudgeId, MicroJudgeConfig>;
}

const VALID_JUDGE_MODES = new Set(['off', 'auto']);

/** Build default microJudges config from the registry. */
function buildDefaultMicroJudges(): Record<MicroJudgeId, MicroJudgeConfig> {
  const result = {} as Record<MicroJudgeId, MicroJudgeConfig>;
  for (const id of ALL_MICRO_JUDGE_IDS) {
    const def = getJudgeDefinition(id);
    result[id] = {
      enabled: true,
      model: { provider: 'anthropic', modelId: def.defaultModel },
    };
  }
  return result;
}

export const DEFAULT_SUBAGENT_SETTINGS: SubagentSettings = {
  models: {
    scout: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    analyst: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    auditor: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    judge: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  },
  judgeMode: 'auto',
  autoRetry: false,
  maxRetries: 2,
  microJudges: buildDefaultMicroJudges(),
};

/** Validate a single MicroJudgeConfig entry. */
function validateMicroJudgeConfig(raw: any, defaultConfig: MicroJudgeConfig): MicroJudgeConfig {
  if (!raw || typeof raw !== 'object') return { ...defaultConfig };
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : defaultConfig.enabled;
  let model = defaultConfig.model;
  if (
    raw.model &&
    typeof raw.model === 'object' &&
    typeof raw.model.provider === 'string' &&
    typeof raw.model.modelId === 'string'
  ) {
    model = { provider: raw.model.provider, modelId: raw.model.modelId };
  }
  return { enabled, model };
}

/** Validate and clamp a parsed config, returning defaults for invalid fields. */
function validateConfig(raw: any): SubagentSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SUBAGENT_SETTINGS };

  const defaults = DEFAULT_SUBAGENT_SETTINGS;
  const roles: SubagentRole[] = ['scout', 'analyst', 'auditor', 'judge'];

  const models = { ...defaults.models };
  if (raw.models && typeof raw.models === 'object') {
    for (const role of roles) {
      const m = raw.models[role];
      if (m && typeof m === 'object' && typeof m.provider === 'string' && typeof m.modelId === 'string') {
        models[role] = { provider: m.provider, modelId: m.modelId };
      }
    }
  }

  // Migration: 'ask' → 'auto' (toggle is the new paradigm, 'ask' users had judge active)
  let judgeMode: 'off' | 'auto';
  if (raw.judgeMode === 'ask') {
    judgeMode = 'auto';
  } else {
    judgeMode = VALID_JUDGE_MODES.has(raw.judgeMode) ? (raw.judgeMode as 'off' | 'auto') : defaults.judgeMode;
  }

  const autoRetry = typeof raw.autoRetry === 'boolean' ? raw.autoRetry : defaults.autoRetry;
  const maxRetries =
    typeof raw.maxRetries === 'number' && Number.isFinite(raw.maxRetries)
      ? Math.max(1, Math.min(5, Math.round(raw.maxRetries)))
      : defaults.maxRetries;

  // Migrate or validate microJudges
  const microJudges = { ...defaults.microJudges };
  if (raw.microJudges && typeof raw.microJudges === 'object') {
    for (const id of ALL_MICRO_JUDGE_IDS) {
      if (raw.microJudges[id]) {
        microJudges[id] = validateMicroJudgeConfig(raw.microJudges[id], defaults.microJudges[id]);
      }
    }
  }

  return { models, judgeMode, autoRetry, maxRetries, microJudges };
}

/** In-memory cache — avoids synchronous disk reads on every agent turn. */
let cachedSettings: SubagentSettings | null = null;

/** Load settings from cache (or disk on first call). Auto-persists if migration occurred. */
export function loadSubagentSettings(): SubagentSettings {
  if (cachedSettings) return cachedSettings;
  let needsMigration = false;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    needsMigration = raw.judgeMode === 'ask' || !raw.microJudges;
    cachedSettings = validateConfig(raw);
  } catch {
    cachedSettings = { ...DEFAULT_SUBAGENT_SETTINGS };
  }
  // Persist migrated config so old formats don't re-migrate on every load
  if (needsMigration) {
    saveSubagentSettings(cachedSettings).catch(() => {});
  }
  return cachedSettings;
}

/** Save settings asynchronously. Invalidates cache. */
export async function saveSubagentSettings(settings: SubagentSettings): Promise<void> {
  const validated = validateConfig(settings);
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(validated, null, 2), { encoding: 'utf8', mode: 0o600 });
  cachedSettings = validated;
}
