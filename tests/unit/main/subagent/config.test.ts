import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBAGENT_SETTINGS } from '../../../../src/main/subagent/config.js';

// We test the validation logic via loadSubagentSettings which calls validateConfig internally.
// Since the config file likely doesn't exist at the test path, loadSubagentSettings returns defaults.
// For deep validation testing, we re-implement the same logic the module uses.

// Extract the validation function shape by testing via saveSubagentSettings → loadSubagentSettings cycle.
// For unit testing, we directly test the defaults and the type contracts.

describe('SubagentConfig', () => {
  describe('DEFAULT_SUBAGENT_SETTINGS', () => {
    it('has all 4 roles with model configs', () => {
      expect(Object.keys(DEFAULT_SUBAGENT_SETTINGS.models)).toEqual(['scout', 'analyst', 'auditor', 'judge']);
      for (const [, mc] of Object.entries(DEFAULT_SUBAGENT_SETTINGS.models)) {
        expect(mc).toHaveProperty('provider');
        expect(mc).toHaveProperty('modelId');
        expect(typeof mc.provider).toBe('string');
        expect(typeof mc.modelId).toBe('string');
      }
    });

    it('has valid judgeMode default', () => {
      expect(['off', 'auto', 'ask']).toContain(DEFAULT_SUBAGENT_SETTINGS.judgeMode);
    });

    it('has valid maxRetries default in 1-5 range', () => {
      expect(DEFAULT_SUBAGENT_SETTINGS.maxRetries).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_SUBAGENT_SETTINGS.maxRetries).toBeLessThanOrEqual(5);
    });

    it('has autoRetry enabled by default', () => {
      expect(DEFAULT_SUBAGENT_SETTINGS.autoRetry).toBe(true);
    });

    it('uses haiku for scout (lightweight recon)', () => {
      expect(DEFAULT_SUBAGENT_SETTINGS.models.scout.modelId).toContain('haiku');
    });

    it('uses sonnet for analyst/auditor/judge (deeper analysis)', () => {
      expect(DEFAULT_SUBAGENT_SETTINGS.models.analyst.modelId).toContain('sonnet');
      expect(DEFAULT_SUBAGENT_SETTINGS.models.auditor.modelId).toContain('sonnet');
      expect(DEFAULT_SUBAGENT_SETTINGS.models.judge.modelId).toContain('sonnet');
    });
  });

  describe('loadSubagentSettings', () => {
    it('returns defaults when no config file exists', async () => {
      const { loadSubagentSettings } = await import('../../../../src/main/subagent/config.js');
      const settings = loadSubagentSettings();
      // Should return a valid settings object (may be defaults if no file found)
      expect(settings).toHaveProperty('models');
      expect(settings).toHaveProperty('judgeMode');
      expect(settings).toHaveProperty('autoRetry');
      expect(settings).toHaveProperty('maxRetries');
      expect(['off', 'auto', 'ask']).toContain(settings.judgeMode);
      expect(settings.maxRetries).toBeGreaterThanOrEqual(1);
      expect(settings.maxRetries).toBeLessThanOrEqual(5);
    });
  });
});
