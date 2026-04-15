/**
 * Launch-time auth orchestration unit tests — exercises pure step functions
 * of startup-auth.ts without Electron. Covers F3, F5, F6, F7, F21 integration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import type { AuthSnapshot } from '../../../src/main/auth-snapshot.js';
import {
  buildAuthSnapshot,
  runKeychainStep,
  runMetaStep,
  runRefreshStep,
  runSnapshotStep,
  runStartupAuth,
} from '../../../src/main/startup-auth.js';

// ── Helpers ────────────────────────────────────────────────────

function makeStorage(initial: Record<string, any> = {}): any {
  const state = { ...initial };
  return {
    get: vi.fn((p: string) => state[p]),
    set: vi.fn((p: string, v: any) => {
      state[p] = v;
    }),
    remove: vi.fn((p: string) => {
      delete state[p];
    }),
    getApiKey: vi.fn(async (p: string) => state[p]?.key ?? state[p]?.access ?? null),
    drainErrors: vi.fn().mockReturnValue([]),
  };
}

function makeTracker() {
  return {
    trackAuthInvalidated: vi.fn(),
    trackKeychainStatus: vi.fn(),
    trackAuthMigration: vi.fn(),
  };
}

function makeEmitter() {
  return {
    emitKeychainUnavailable: vi.fn(),
    emitPostUpgrade: vi.fn(),
  };
}

const PROVIDER_MAP = {
  anthropic: 'anthropic',
  openai: 'openai-codex',
  'openai-codex': 'openai-codex',
  google: 'google-gemini-cli',
};

// ── buildAuthSnapshot ──────────────────────────────────────────

describe('buildAuthSnapshot', () => {
  it('maps all providers to "none" when storage empty', () => {
    const snap = buildAuthSnapshot(makeStorage(), PROVIDER_MAP, '0.14.1');
    expect(snap.providers).toEqual({
      anthropic: 'none',
      openai: 'none',
      'openai-codex': 'none',
      google: 'none',
    });
    expect(snap.appVersion).toBe('0.14.1');
  });

  it('prefers oauth over api_key when both present', () => {
    const storage = makeStorage({
      anthropic: { type: 'oauth', access: 'tok' },
    });
    const snap = buildAuthSnapshot(storage, PROVIDER_MAP, '0.14.1');
    expect(snap.providers.anthropic).toBe('oauth');
  });

  it('reports api_key when displayGroup holds api_key', () => {
    const storage = makeStorage({ openai: { type: 'api_key', key: 'sk-' } });
    const snap = buildAuthSnapshot(storage, PROVIDER_MAP, '0.14.1');
    expect(snap.providers.openai).toBe('api_key');
  });

  it('carries forward previous lastLogoutAt', () => {
    const snap = buildAuthSnapshot(makeStorage(), PROVIDER_MAP, '0.14.1', { anthropic: 42 });
    expect(snap.lastLogoutAt).toEqual({ anthropic: 42 });
  });
});

// ── runKeychainStep ────────────────────────────────────────────

describe('runKeychainStep (F6)', () => {
  it('emits banner when encryption available but probe fails', () => {
    const tracker = makeTracker();
    const emitter = makeEmitter();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('x'),
      decryptString: () => {
        throw new Error('keychain locked');
      },
    };
    const result = runKeychainStep({ safeStorage, tracker, emitter });
    expect(result.probeOk).toBe(false);
    expect(tracker.trackKeychainStatus).toHaveBeenCalledWith(
      expect.objectContaining({ available: true, probeOk: false }),
    );
    expect(emitter.emitKeychainUnavailable).toHaveBeenCalled();
  });

  it('does NOT emit banner when encryption unavailable (expected on non-macOS)', () => {
    const emitter = makeEmitter();
    runKeychainStep({
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(''),
        decryptString: () => '',
      },
      tracker: makeTracker(),
      emitter,
    });
    expect(emitter.emitKeychainUnavailable).not.toHaveBeenCalled();
  });

  it('does NOT emit banner on successful round-trip', () => {
    const emitter = makeEmitter();
    runKeychainStep({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
      },
      tracker: makeTracker(),
      emitter,
    });
    expect(emitter.emitKeychainUnavailable).not.toHaveBeenCalled();
  });
});

// ── runSnapshotStep ────────────────────────────────────────────

describe('runSnapshotStep (F3 + F21)', () => {
  let readSnapshot: any;
  let writeSnapshot: any;
  let tracker: ReturnType<typeof makeTracker>;
  let emitter: ReturnType<typeof makeEmitter>;

  beforeEach(() => {
    readSnapshot = vi.fn();
    writeSnapshot = vi.fn();
    tracker = makeTracker();
    emitter = makeEmitter();
  });

  it('first launch (no prev) writes snapshot, emits nothing', () => {
    readSnapshot.mockReturnValue(null);
    runSnapshotStep({
      storage: makeStorage({ anthropic: { type: 'oauth', access: 't' } }),
      providerMap: PROVIDER_MAP,
      appVersion: '0.14.1',
      readSnapshot,
      writeSnapshot,
      tracker,
      emitter,
    });
    expect(writeSnapshot).toHaveBeenCalled();
    expect(tracker.trackAuthInvalidated).not.toHaveBeenCalled();
    expect(emitter.emitPostUpgrade).not.toHaveBeenCalled();
  });

  it('regression oauth→none emits auth_invalidated', () => {
    const prev: AuthSnapshot = {
      version: 1,
      capturedAt: '',
      appVersion: '0.14.1',
      providers: { anthropic: 'oauth', openai: 'none', 'openai-codex': 'none', google: 'none' },
    };
    readSnapshot.mockReturnValue(prev);
    runSnapshotStep({
      storage: makeStorage(), // all empty → anthropic becomes 'none'
      providerMap: PROVIDER_MAP,
      appVersion: '0.14.1',
      readSnapshot,
      writeSnapshot,
      tracker,
      emitter,
    });
    expect(tracker.trackAuthInvalidated).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        previousType: 'oauth',
        currentType: 'none',
        userInitiated: false,
      }),
    );
  });

  it('suppresses user-initiated regressions (recent logout)', () => {
    const prev: AuthSnapshot = {
      version: 1,
      capturedAt: '',
      appVersion: '0.14.1',
      providers: { anthropic: 'oauth', openai: 'none', 'openai-codex': 'none', google: 'none' },
      lastLogoutAt: { anthropic: Date.now() - 60_000 },
    };
    readSnapshot.mockReturnValue(prev);
    runSnapshotStep({
      storage: makeStorage(),
      providerMap: PROVIDER_MAP,
      appVersion: '0.14.1',
      readSnapshot,
      writeSnapshot,
      tracker,
      emitter,
    });
    expect(tracker.trackAuthInvalidated).not.toHaveBeenCalled();
  });

  it('F21: version change + regression → emitPostUpgrade', () => {
    const prev: AuthSnapshot = {
      version: 1,
      capturedAt: '',
      appVersion: '0.14.0',
      providers: { anthropic: 'oauth', openai: 'none', 'openai-codex': 'none', google: 'none' },
    };
    readSnapshot.mockReturnValue(prev);
    runSnapshotStep({
      storage: makeStorage(),
      providerMap: PROVIDER_MAP,
      appVersion: '0.15.0',
      readSnapshot,
      writeSnapshot,
      tracker,
      emitter,
    });
    expect(emitter.emitPostUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ previousVersion: '0.14.0', currentVersion: '0.15.0' }),
    );
  });

  it('F21: version change without regression → no modal', () => {
    const prev: AuthSnapshot = {
      version: 1,
      capturedAt: '',
      appVersion: '0.14.0',
      providers: { anthropic: 'oauth', openai: 'none', 'openai-codex': 'none', google: 'none' },
    };
    readSnapshot.mockReturnValue(prev);
    runSnapshotStep({
      storage: makeStorage({ anthropic: { type: 'oauth', access: 'x' } }),
      providerMap: PROVIDER_MAP,
      appVersion: '0.15.0',
      readSnapshot,
      writeSnapshot,
      tracker,
      emitter,
    });
    expect(emitter.emitPostUpgrade).not.toHaveBeenCalled();
  });
});

// ── runRefreshStep ─────────────────────────────────────────────

describe('runRefreshStep (F7)', () => {
  it('emits auth_invalidated with reason refresh_failed for failed outcomes', async () => {
    const tracker = makeTracker();
    const fakeRefresher = {
      refreshAll: vi.fn().mockResolvedValue([
        { provider: 'anthropic', outcome: 'ok' },
        { provider: 'openai-codex', outcome: 'failed', errorMessage: '401 expired' },
      ]),
    };
    await runRefreshStep({
      storage: makeStorage(),
      oauthIds: ['anthropic', 'openai-codex'],
      tracker,
      refresherFactory: () => fakeRefresher,
    });
    expect(tracker.trackAuthInvalidated).toHaveBeenCalledTimes(1);
    expect(tracker.trackAuthInvalidated).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-codex', reason: expect.stringContaining('refresh_failed') }),
    );
  });

  it('no events when all refresh outcomes are ok/skipped', async () => {
    const tracker = makeTracker();
    await runRefreshStep({
      storage: makeStorage(),
      oauthIds: ['anthropic'],
      tracker,
      refresherFactory: () => ({
        refreshAll: vi.fn().mockResolvedValue([{ provider: 'anthropic', outcome: 'skipped_recent' }]),
      }),
    });
    expect(tracker.trackAuthInvalidated).not.toHaveBeenCalled();
  });
});

// ── runMetaStep ────────────────────────────────────────────────

describe('runMetaStep (F5)', () => {
  it('emits auth_migration events for SDK drift', () => {
    const tracker = makeTracker();
    const prevMeta = {
      version: 1 as 1,
      bottegaVersion: '0.13.0',
      providers: {
        anthropic: { savedAt: '', sdkProvider: 'anthropic', kind: 'oauth' as const, checksum: 'x' },
      },
    };
    const writeMeta = vi.fn();
    runMetaStep({
      storage: makeStorage(), // empty → anthropic missing → failed migration
      providerMap: PROVIDER_MAP,
      appVersion: '0.14.1',
      readMeta: () => prevMeta,
      writeMeta,
      tracker,
    });
    expect(tracker.trackAuthMigration).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', result: 'failed', reason: 'sdk_missing' }),
    );
    expect(writeMeta).toHaveBeenCalled();
  });

  it('no events when meta and SDK agree', () => {
    const tracker = makeTracker();
    runMetaStep({
      storage: makeStorage({ anthropic: { type: 'oauth', access: 't' } }),
      providerMap: PROVIDER_MAP,
      appVersion: '0.14.1',
      readMeta: () => null,
      writeMeta: vi.fn(),
      tracker,
    });
    expect(tracker.trackAuthMigration).not.toHaveBeenCalled();
  });
});

// ── runStartupAuth orchestrator ────────────────────────────────

describe('runStartupAuth (top-level orchestrator)', () => {
  it('runs all four steps and survives step failure', async () => {
    const tracker = makeTracker();
    const emitter = makeEmitter();
    const writeSnapshot = vi.fn();
    const writeMeta = vi.fn();
    const storage = makeStorage();

    // F6 with a throwing safeStorage should NOT abort the remaining steps.
    const blowingSafeStorage = {
      isEncryptionAvailable: () => {
        throw new Error('boom');
      },
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    };

    await runStartupAuth({
      keychain: { safeStorage: blowingSafeStorage, tracker, emitter },
      snapshot: {
        storage,
        providerMap: PROVIDER_MAP,
        appVersion: '0.14.1',
        readSnapshot: () => null,
        writeSnapshot,
        tracker,
        emitter,
      },
      refresh: {
        storage,
        oauthIds: ['anthropic'],
        tracker,
        refresherFactory: () => ({ refreshAll: vi.fn().mockResolvedValue([]) }),
      },
      meta: {
        storage,
        providerMap: PROVIDER_MAP,
        appVersion: '0.14.1',
        readMeta: () => null,
        writeMeta,
        tracker,
      },
    });

    // Snapshot + meta still wrote even though keychain threw.
    expect(writeSnapshot).toHaveBeenCalled();
    expect(writeMeta).toHaveBeenCalled();
  });
});
