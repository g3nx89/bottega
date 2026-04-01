/**
 * Subagent configuration — load/save settings for parallel subagents.
 * Follows the same pattern as image-gen/config.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SubagentRole } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'subagent.json');

export interface SubagentModelConfig {
  provider: string;
  modelId: string;
}

export interface SubagentSettings {
  models: Record<SubagentRole, SubagentModelConfig>;
  judgeMode: 'off' | 'auto' | 'ask';
  autoRetry: boolean;
  maxRetries: number;
}

const VALID_JUDGE_MODES = new Set(['off', 'auto', 'ask']);

export const DEFAULT_SUBAGENT_SETTINGS: SubagentSettings = {
  models: {
    scout: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    analyst: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    auditor: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    judge: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  },
  judgeMode: 'ask',
  autoRetry: false,
  maxRetries: 2,
};

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

  const judgeMode = VALID_JUDGE_MODES.has(raw.judgeMode) ? raw.judgeMode : defaults.judgeMode;
  const autoRetry = typeof raw.autoRetry === 'boolean' ? raw.autoRetry : defaults.autoRetry;
  const maxRetries =
    typeof raw.maxRetries === 'number' && Number.isFinite(raw.maxRetries)
      ? Math.max(1, Math.min(5, Math.round(raw.maxRetries)))
      : defaults.maxRetries;

  return { models, judgeMode, autoRetry, maxRetries };
}

/** In-memory cache — avoids synchronous disk reads on every agent turn. */
let cachedSettings: SubagentSettings | null = null;

/** Load settings from cache (or disk on first call). */
export function loadSubagentSettings(): SubagentSettings {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cachedSettings = validateConfig(raw);
  } catch {
    cachedSettings = { ...DEFAULT_SUBAGENT_SETTINGS };
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
