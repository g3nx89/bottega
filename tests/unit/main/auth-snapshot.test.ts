import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  type AuthSnapshot,
  diffSnapshots,
  readSnapshot,
  recordLogout,
  SNAPSHOT_VERSION,
  writeSnapshot,
} from '../../../src/main/auth-snapshot.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `bottega-snap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  filePath = path.join(tmpDir, 'snap.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function snapshot(providers: AuthSnapshot['providers'], lastLogoutAt?: Record<string, number>): AuthSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    appVersion: '0.14.1',
    providers,
    lastLogoutAt,
  };
}

describe('readSnapshot / writeSnapshot', () => {
  it('returns null when file missing', () => {
    expect(readSnapshot(filePath)).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const snap = snapshot({ anthropic: 'oauth', openai: 'api_key', google: 'none' });
    writeSnapshot(snap, filePath);
    const read = readSnapshot(filePath);
    expect(read).toMatchObject({ providers: snap.providers, version: 1 });
  });

  it('writes with 0600 permissions', () => {
    writeSnapshot(snapshot({ anthropic: 'oauth' }), filePath);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null on corrupt JSON', () => {
    writeFileSync(filePath, '{not json');
    expect(readSnapshot(filePath)).toBeNull();
  });

  it('returns null on version mismatch', () => {
    writeFileSync(filePath, JSON.stringify({ version: 999, providers: {} }));
    expect(readSnapshot(filePath)).toBeNull();
  });
});

describe('diffSnapshots', () => {
  it('returns [] when prev is null (first launch)', () => {
    expect(diffSnapshots(null, snapshot({ anthropic: 'oauth' }))).toEqual([]);
  });

  it('flags oauth → none as regression', () => {
    const prev = snapshot({ anthropic: 'oauth' });
    const curr = snapshot({ anthropic: 'none' });
    const out = diffSnapshots(prev, curr);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: 'anthropic', previousType: 'oauth', currentType: 'none' });
  });

  it('flags api_key → none as regression', () => {
    const prev = snapshot({ openai: 'api_key' });
    const curr = snapshot({ openai: 'none' });
    expect(diffSnapshots(prev, curr)).toHaveLength(1);
  });

  it('flags oauth → api_key as regression', () => {
    const prev = snapshot({ openai: 'oauth' });
    const curr = snapshot({ openai: 'api_key' });
    expect(diffSnapshots(prev, curr)).toHaveLength(1);
  });

  it('does NOT flag none → oauth (progression)', () => {
    const prev = snapshot({ anthropic: 'none' });
    const curr = snapshot({ anthropic: 'oauth' });
    expect(diffSnapshots(prev, curr)).toEqual([]);
  });

  it('does NOT flag api_key → oauth (progression)', () => {
    expect(diffSnapshots(snapshot({ openai: 'api_key' }), snapshot({ openai: 'oauth' }))).toEqual([]);
  });

  it('marks userInitiated when lastLogoutAt is recent', () => {
    const now = Date.now();
    const prev = snapshot({ anthropic: 'oauth' });
    const curr = snapshot({ anthropic: 'none' }, { anthropic: now - 60_000 });
    const out = diffSnapshots(prev, curr, now);
    expect(out[0].userInitiated).toBe(true);
  });

  it('does NOT mark userInitiated when logout is older than 5 min', () => {
    const now = Date.now();
    const prev = snapshot({ anthropic: 'oauth' });
    const curr = snapshot({ anthropic: 'none' }, { anthropic: now - 6 * 60 * 1000 });
    expect(diffSnapshots(prev, curr, now)[0].userInitiated).toBe(false);
  });

  it('treats missing provider in prev as none', () => {
    const prev = snapshot({});
    const curr = snapshot({ openai: 'oauth' });
    // none → oauth is progression, no event
    expect(diffSnapshots(prev, curr)).toEqual([]);
  });
});

describe('recordLogout', () => {
  it('creates a snapshot with lastLogoutAt when none exists', () => {
    const now = 1_700_000_000_000;
    recordLogout('openai', filePath, now);
    const snap = readSnapshot(filePath);
    expect(snap?.lastLogoutAt?.openai).toBe(now);
  });

  it('merges into existing snapshot without overwriting providers', () => {
    writeSnapshot(snapshot({ anthropic: 'oauth' }), filePath);
    recordLogout('openai', filePath, 123);
    const snap = readSnapshot(filePath);
    expect(snap?.providers.anthropic).toBe('oauth');
    expect(snap?.lastLogoutAt?.openai).toBe(123);
  });
});

describe('file path', () => {
  it('writeSnapshot creates parent dirs if missing', () => {
    const deep = path.join(tmpDir, 'a', 'b', 'snap.json');
    writeSnapshot(snapshot({ anthropic: 'oauth' }), deep);
    expect(existsSync(deep)).toBe(true);
    expect(readFileSync(deep, 'utf8')).toContain('"oauth"');
  });
});
