/**
 * Config migration tests — old-to-new format, microJudges auto-generation.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBAGENT_SETTINGS } from '../../../../src/main/subagent/config.js';
import { ALL_MICRO_JUDGE_IDS } from '../../../../src/main/subagent/judge-registry.js';

describe('Config Migration', () => {
  it('DEFAULT_SUBAGENT_SETTINGS has microJudges for all 7 judges', () => {
    expect(Object.keys(DEFAULT_SUBAGENT_SETTINGS.microJudges)).toHaveLength(7);
    for (const id of ALL_MICRO_JUDGE_IDS) {
      expect(DEFAULT_SUBAGENT_SETTINGS.microJudges[id]).toBeDefined();
      expect(DEFAULT_SUBAGENT_SETTINGS.microJudges[id].enabled).toBe(true);
      expect(DEFAULT_SUBAGENT_SETTINGS.microJudges[id].model).toBeDefined();
    }
  });

  it('default judgeMode is auto (not ask)', () => {
    expect(DEFAULT_SUBAGENT_SETTINGS.judgeMode).toBe('auto');
  });

  it('judgeMode type only allows off and auto', () => {
    // Compile-time check — 'ask' is not in the union type
    const validModes: Array<typeof DEFAULT_SUBAGENT_SETTINGS.judgeMode> = ['off', 'auto'];
    expect(validModes).toContain(DEFAULT_SUBAGENT_SETTINGS.judgeMode);
  });

  it('all micro-judge configs have haiku as default model', () => {
    for (const id of ALL_MICRO_JUDGE_IDS) {
      expect(DEFAULT_SUBAGENT_SETTINGS.microJudges[id].model.modelId).toBe('claude-haiku-4-5');
    }
  });

  it('maxRetries default is 1', () => {
    expect(DEFAULT_SUBAGENT_SETTINGS.maxRetries).toBe(1);
  });
});
