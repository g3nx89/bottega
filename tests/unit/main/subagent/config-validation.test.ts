/**
 * Regression tests for validateConfig helpers extracted during the complexity
 * refactor (session 2026-04-17). Covers migration, clamping, and malformed
 * payload handling paths that previously lived inside a single high-CCN function.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBAGENT_SETTINGS, validateConfig } from '../../../../src/main/subagent/config.js';

describe('validateConfig', () => {
  describe('judgeMode migration', () => {
    it("migrates legacy 'ask' → 'auto'", () => {
      const out = validateConfig({ judgeMode: 'ask' });
      expect(out.judgeMode).toBe('auto');
    });

    it("accepts 'off'", () => {
      const out = validateConfig({ judgeMode: 'off' });
      expect(out.judgeMode).toBe('off');
    });

    it("accepts 'auto'", () => {
      const out = validateConfig({ judgeMode: 'auto' });
      expect(out.judgeMode).toBe('auto');
    });

    it('falls back to default on invalid value', () => {
      const out = validateConfig({ judgeMode: 'nonsense' });
      expect(out.judgeMode).toBe(DEFAULT_SUBAGENT_SETTINGS.judgeMode);
    });

    it('falls back to default when missing', () => {
      const out = validateConfig({});
      expect(out.judgeMode).toBe(DEFAULT_SUBAGENT_SETTINGS.judgeMode);
    });
  });

  describe('maxRetries clamping', () => {
    it('clamps below 1 to 1', () => {
      expect(validateConfig({ maxRetries: 0 }).maxRetries).toBe(1);
      expect(validateConfig({ maxRetries: -5 }).maxRetries).toBe(1);
    });

    it('clamps above 10 to 10', () => {
      expect(validateConfig({ maxRetries: 50 }).maxRetries).toBe(10);
      expect(validateConfig({ maxRetries: 11 }).maxRetries).toBe(10);
    });

    it('rounds fractional values', () => {
      expect(validateConfig({ maxRetries: 2.7 }).maxRetries).toBe(3);
      expect(validateConfig({ maxRetries: 2.4 }).maxRetries).toBe(2);
    });

    it('falls back to default for non-numeric', () => {
      expect(validateConfig({ maxRetries: 'three' }).maxRetries).toBe(DEFAULT_SUBAGENT_SETTINGS.maxRetries);
      expect(validateConfig({ maxRetries: null }).maxRetries).toBe(DEFAULT_SUBAGENT_SETTINGS.maxRetries);
      expect(validateConfig({ maxRetries: Number.POSITIVE_INFINITY }).maxRetries).toBe(
        DEFAULT_SUBAGENT_SETTINGS.maxRetries,
      );
      expect(validateConfig({ maxRetries: Number.NaN }).maxRetries).toBe(DEFAULT_SUBAGENT_SETTINGS.maxRetries);
    });
  });

  describe('models validation', () => {
    it('accepts valid per-role model config', () => {
      const out = validateConfig({
        models: {
          scout: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
        },
      });
      expect(out.models.scout).toEqual({ provider: 'anthropic', modelId: 'claude-haiku-4-5' });
    });

    it('drops invalid entries (non-string provider/modelId)', () => {
      const out = validateConfig({
        models: {
          scout: { provider: 123, modelId: 'x' },
          analyst: { provider: 'anthropic' }, // missing modelId
        },
      });
      expect(out.models.scout).toEqual(DEFAULT_SUBAGENT_SETTINGS.models.scout);
      expect(out.models.analyst).toEqual(DEFAULT_SUBAGENT_SETTINGS.models.analyst);
    });

    it('returns defaults when models is not an object', () => {
      expect(validateConfig({ models: null }).models).toEqual(DEFAULT_SUBAGENT_SETTINGS.models);
      expect(validateConfig({ models: 'string' }).models).toEqual(DEFAULT_SUBAGENT_SETTINGS.models);
    });
  });

  describe('autoRetry validation', () => {
    it('accepts true/false', () => {
      expect(validateConfig({ autoRetry: true }).autoRetry).toBe(true);
      expect(validateConfig({ autoRetry: false }).autoRetry).toBe(false);
    });

    it('falls back to default for non-boolean', () => {
      expect(validateConfig({ autoRetry: 'yes' }).autoRetry).toBe(DEFAULT_SUBAGENT_SETTINGS.autoRetry);
    });
  });

  describe('microJudges validation', () => {
    it('preserves unrecognized fields from defaults when microJudges missing', () => {
      const out = validateConfig({});
      expect(Object.keys(out.microJudges).length).toBe(Object.keys(DEFAULT_SUBAGENT_SETTINGS.microJudges).length);
    });

    it('merges partial overrides with defaults', () => {
      const out = validateConfig({
        microJudges: { alignment: { enabled: false } },
      });
      expect(out.microJudges.alignment.enabled).toBe(false);
      // Other judges retain defaults
      expect(out.microJudges.completeness).toEqual(DEFAULT_SUBAGENT_SETTINGS.microJudges.completeness);
    });
  });

  describe('top-level fallback', () => {
    it('returns full defaults for null/undefined/non-object raw', () => {
      expect(validateConfig(null)).toEqual(DEFAULT_SUBAGENT_SETTINGS);
      expect(validateConfig(undefined)).toEqual(DEFAULT_SUBAGENT_SETTINGS);
      expect(validateConfig('string')).toEqual(DEFAULT_SUBAGENT_SETTINGS);
      expect(validateConfig(42)).toEqual(DEFAULT_SUBAGENT_SETTINGS);
    });
  });
});
