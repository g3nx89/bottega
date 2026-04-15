import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

import {
  type AuthStorageLike,
  checksumToken,
  META_VERSION,
  readMeta,
  reconcileMeta,
  removeMetaEntry,
  touchMetaEntry,
  writeMeta,
} from '../../../src/main/auth-meta.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `bottega-meta-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  filePath = path.join(tmpDir, 'auth-meta.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeStorage(state: Record<string, { type: 'api_key' | 'oauth'; token?: string }>): AuthStorageLike {
  return {
    get(provider: string) {
      const entry = state[provider];
      if (!entry) return undefined;
      return entry.type === 'api_key' ? { type: 'api_key', key: entry.token } : { type: 'oauth', access: entry.token };
    },
  };
}

describe('checksumToken', () => {
  it('produces stable 16-char hash', () => {
    expect(checksumToken('abc').length).toBe(16);
    expect(checksumToken('abc')).toBe(checksumToken('abc'));
    expect(checksumToken('abc')).not.toBe(checksumToken('def'));
  });
});

describe('readMeta / writeMeta', () => {
  it('returns null when file missing', () => {
    expect(readMeta(filePath)).toBeNull();
  });

  it('round-trips meta with 0600 perms', () => {
    const meta = {
      version: META_VERSION as 1,
      bottegaVersion: '0.14.1',
      providers: { openai: { savedAt: 'now', sdkProvider: 'openai', kind: 'api_key' as const, checksum: 'abc' } },
    };
    writeMeta(meta, filePath);
    const read = readMeta(filePath);
    expect(read).toMatchObject(meta);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('returns null on corrupt JSON', () => {
    writeFileSync(filePath, '{bad json');
    expect(readMeta(filePath)).toBeNull();
  });

  it('returns null on version mismatch', () => {
    writeFileSync(filePath, JSON.stringify({ version: 99, providers: {} }));
    expect(readMeta(filePath)).toBeNull();
  });
});

describe('reconcileMeta', () => {
  it('adds meta entries for SDK creds when prev is null', () => {
    const storage = makeStorage({ anthropic: { type: 'oauth', token: 'tok' } });
    const { next, events } = reconcileMeta(null, storage, ['anthropic', 'openai'], '0.14.1');
    expect(events).toEqual([]);
    expect(next.providers.anthropic.kind).toBe('oauth');
    expect(next.providers.anthropic.checksum).toBe(checksumToken('tok'));
    expect(next.providers.openai).toBeUndefined();
  });

  it('emits failed migration when SDK lost a token present in meta', () => {
    const prev = {
      version: META_VERSION as 1,
      bottegaVersion: '0.13.0',
      providers: {
        anthropic: { savedAt: 's', sdkProvider: 'anthropic', kind: 'oauth' as const, checksum: 'c' },
      },
    };
    const storage = makeStorage({}); // empty
    const { next, events } = reconcileMeta(prev, storage, ['anthropic'], '0.14.1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'anthropic',
      fromVersion: '0.13.0',
      toVersion: '0.14.1',
      result: 'failed',
      reason: 'sdk_missing',
    });
    expect(next.providers.anthropic).toBeUndefined();
  });

  it('stays silent when SDK and meta agree', () => {
    const prev = {
      version: META_VERSION as 1,
      bottegaVersion: '0.14.1',
      providers: {
        anthropic: {
          savedAt: 's',
          sdkProvider: 'anthropic',
          kind: 'oauth' as const,
          checksum: checksumToken('tok'),
        },
      },
    };
    const storage = makeStorage({ anthropic: { type: 'oauth', token: 'tok' } });
    const { events } = reconcileMeta(prev, storage, ['anthropic'], '0.14.1');
    expect(events).toEqual([]);
  });

  it('preserves savedAt on rewrite', () => {
    const prev = {
      version: META_VERSION as 1,
      bottegaVersion: '0.13.0',
      providers: {
        openai: { savedAt: '2024-01-01T00:00:00.000Z', sdkProvider: 'openai', kind: 'api_key' as const, checksum: 'x' },
      },
    };
    const storage = makeStorage({ openai: { type: 'api_key', token: 'tok' } });
    const { next } = reconcileMeta(prev, storage, ['openai'], '0.14.1');
    expect(next.providers.openai.savedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(next.providers.openai.checksum).toBe(checksumToken('tok'));
  });
});

describe('touchMetaEntry / removeMetaEntry', () => {
  it('creates meta on first touch', () => {
    touchMetaEntry('openai', 'api_key', 'tok', '0.14.1', filePath);
    const meta = readMeta(filePath);
    expect(meta?.providers.openai.kind).toBe('api_key');
    expect(meta?.providers.openai.checksum).toBe(checksumToken('tok'));
    expect(existsSync(filePath)).toBe(true);
  });

  it('removes entry without touching unrelated providers', () => {
    touchMetaEntry('openai', 'api_key', 'tok', '0.14.1', filePath);
    touchMetaEntry('anthropic', 'oauth', 'tok2', '0.14.1', filePath);
    removeMetaEntry('openai', filePath);
    const meta = readMeta(filePath);
    expect(meta?.providers.openai).toBeUndefined();
    expect(meta?.providers.anthropic).toBeDefined();
  });

  it('removeMetaEntry is no-op when file missing', () => {
    expect(() => removeMetaEntry('openai', filePath)).not.toThrow();
  });
});
