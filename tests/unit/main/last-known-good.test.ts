import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { getLastGood, readLastGood, recordLastGood } from '../../../src/main/last-known-good.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `bottega-lkg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  filePath = path.join(tmpDir, 'lkg.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('recordLastGood', () => {
  it('creates file on first write', () => {
    recordLastGood('anthropic', 'claude-sonnet-4-6', filePath);
    expect(existsSync(filePath)).toBe(true);
    expect(getLastGood('anthropic', filePath)).toBe('claude-sonnet-4-6');
  });

  it('preserves other providers when updating one', () => {
    recordLastGood('anthropic', 'claude-sonnet-4-6', filePath);
    recordLastGood('openai', 'gpt-5.4', filePath);
    expect(getLastGood('anthropic', filePath)).toBe('claude-sonnet-4-6');
    expect(getLastGood('openai', filePath)).toBe('gpt-5.4');
  });

  it('is a no-op when same modelId is already recorded', () => {
    recordLastGood('anthropic', 'claude-sonnet-4-6', filePath, 1000);
    recordLastGood('anthropic', 'claude-sonnet-4-6', filePath, 2000);
    const rec = readLastGood(filePath);
    expect(rec?.providers.anthropic.updatedAt).toBe(new Date(1000).toISOString());
  });

  it('updates timestamp when model changes for provider', () => {
    recordLastGood('anthropic', 'claude-opus-4-6', filePath, 1000);
    recordLastGood('anthropic', 'claude-sonnet-4-6', filePath, 2000);
    expect(getLastGood('anthropic', filePath)).toBe('claude-sonnet-4-6');
  });
});

describe('getLastGood', () => {
  it('returns null when file missing', () => {
    expect(getLastGood('anthropic', filePath)).toBeNull();
  });

  it('returns null for provider without entry', () => {
    recordLastGood('openai', 'gpt', filePath);
    expect(getLastGood('anthropic', filePath)).toBeNull();
  });
});
