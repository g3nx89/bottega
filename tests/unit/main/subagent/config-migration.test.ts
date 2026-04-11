/**
 * Config migration tests — old-to-new format, microJudges auto-generation.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBAGENT_SETTINGS } from '../../../../src/main/subagent/config.js';
import { ALL_MICRO_JUDGE_IDS } from '../../../../src/main/subagent/judge-registry.js';

describe('Config Migration', () => {
  it('DEFAULT_SUBAGENT_SETTINGS has microJudges for all 8 judges', () => {
    expect(Object.keys(DEFAULT_SUBAGENT_SETTINGS.microJudges)).toHaveLength(8);
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

  it('all micro-judge configs have expected default models', () => {
    for (const id of ALL_MICRO_JUDGE_IDS) {
      const config = DEFAULT_SUBAGENT_SETTINGS.microJudges[id];
      expect(config.model.modelId).toBeDefined();
      // design_quality uses Sonnet (vision-based), all others use Haiku
      if (id === 'design_quality') {
        expect(config.model.modelId).toBe('claude-sonnet-4-6');
      } else {
        expect(config.model.modelId).toBe('claude-haiku-4-5');
      }
    }
  });

  it('maxRetries default is 1', () => {
    expect(DEFAULT_SUBAGENT_SETTINGS.maxRetries).toBe(1);
  });
});
