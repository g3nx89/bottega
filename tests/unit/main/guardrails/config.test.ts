/**
 * guardrails/config.ts — persistence + cache.
 * fs-utils is mocked so we can drive load/save without touching ~/.bottega.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readJsonMock = vi.fn();
const writeJsonMock = vi.fn();

vi.mock('../../../../src/main/fs-utils.js', () => ({
  atomicWriteJsonSync: (...args: any[]) => writeJsonMock(...args),
  readJsonOrQuarantine: (...args: any[]) => readJsonMock(...args),
}));

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import {
  __resetCacheForTests,
  DEFAULT_GUARDRAILS_SETTINGS,
  GUARDRAILS_CONFIG_VERSION,
  loadGuardrailsSettings,
  saveGuardrailsSettings,
} from '../../../../src/main/guardrails/config.js';

beforeEach(() => {
  readJsonMock.mockReset();
  writeJsonMock.mockReset();
  __resetCacheForTests();
});

afterEach(() => {
  __resetCacheForTests();
});

describe('guardrails/config — load', () => {
  it('returns defaults when the file does not exist (readJsonOrQuarantine returns null)', () => {
    readJsonMock.mockReturnValueOnce(null);
    const s = loadGuardrailsSettings();
    expect(s).toEqual(DEFAULT_GUARDRAILS_SETTINGS);
    expect(s.enabled).toBe(true); // opt-out invariant
  });

  it('returns defaults when corrupt payload is quarantined (readJsonOrQuarantine returns null)', () => {
    // readJsonOrQuarantine swallows SyntaxError and returns null — we inherit that behavior.
    readJsonMock.mockReturnValueOnce(null);
    expect(loadGuardrailsSettings()).toEqual(DEFAULT_GUARDRAILS_SETTINGS);
  });

  it('coerces invalid enabled to default (true)', () => {
    readJsonMock.mockReturnValueOnce({ enabled: 'yes', version: 1 });
    const s = loadGuardrailsSettings();
    expect(s.enabled).toBe(true);
  });

  it('preserves stored version number', () => {
    readJsonMock.mockReturnValueOnce({ enabled: false, version: 42 });
    const s = loadGuardrailsSettings();
    expect(s.version).toBe(42);
    expect(s.enabled).toBe(false);
  });

  it('uses default version when field missing', () => {
    readJsonMock.mockReturnValueOnce({ enabled: false });
    const s = loadGuardrailsSettings();
    expect(s.version).toBe(GUARDRAILS_CONFIG_VERSION);
  });

  it('caches subsequent loads (no second disk read)', () => {
    readJsonMock.mockReturnValueOnce({ enabled: false, version: 1 });
    loadGuardrailsSettings();
    loadGuardrailsSettings();
    loadGuardrailsSettings();
    expect(readJsonMock).toHaveBeenCalledTimes(1);
  });
});

describe('guardrails/config — save', () => {
  it('writes validated settings and updates cache', () => {
    readJsonMock.mockReturnValueOnce(null);
    loadGuardrailsSettings(); // primes cache at defaults

    saveGuardrailsSettings({ version: 1, enabled: false });

    expect(writeJsonMock).toHaveBeenCalledTimes(1);
    const [, payload] = writeJsonMock.mock.calls[0];
    expect(payload).toEqual({ version: 1, enabled: false });

    // Next load hits cache, returns the just-saved value
    const s = loadGuardrailsSettings();
    expect(s.enabled).toBe(false);
    expect(readJsonMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows on write failure', () => {
    writeJsonMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => saveGuardrailsSettings({ version: 1, enabled: false })).toThrow(/disk full/);
  });

  it('strips unknown keys via validate()', () => {
    saveGuardrailsSettings({ version: 1, enabled: true, extra: 'ignored' } as any);
    const [, payload] = writeJsonMock.mock.calls[0];
    expect(payload).toEqual({ version: 1, enabled: true });
    expect(payload).not.toHaveProperty('extra');
  });
});
