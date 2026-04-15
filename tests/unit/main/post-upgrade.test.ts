import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import { type AuthSnapshot, shouldShowPostUpgrade } from '../../../src/main/auth-snapshot.js';

function snap(version: string, providers: Record<string, 'none' | 'api_key' | 'oauth'> = {}): AuthSnapshot {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    appVersion: version,
    providers,
  };
}

describe('F21: shouldShowPostUpgrade', () => {
  it('null on first launch (no prev)', () => {
    expect(shouldShowPostUpgrade(null, snap('0.15.0'), [])).toBeNull();
  });

  it('null when version unchanged', () => {
    const same = snap('0.14.0');
    expect(
      shouldShowPostUpgrade(same, snap('0.14.0'), [
        { provider: 'anthropic', previousType: 'oauth', currentType: 'none', userInitiated: false },
      ]),
    ).toBeNull();
  });

  it('null when version changed but no regressions', () => {
    expect(shouldShowPostUpgrade(snap('0.14.0'), snap('0.15.0'), [])).toBeNull();
  });

  it('null when all regressions are user-initiated', () => {
    expect(
      shouldShowPostUpgrade(snap('0.14.0'), snap('0.15.0'), [
        { provider: 'anthropic', previousType: 'oauth', currentType: 'none', userInitiated: true },
      ]),
    ).toBeNull();
  });

  it('returns payload when version changed AND non-user-initiated regression exists', () => {
    const payload = shouldShowPostUpgrade(snap('0.14.0'), snap('0.15.0'), [
      { provider: 'anthropic', previousType: 'oauth', currentType: 'none', userInitiated: false },
      { provider: 'openai', previousType: 'api_key', currentType: 'none', userInitiated: true },
    ]);
    expect(payload).not.toBeNull();
    expect(payload?.previousVersion).toBe('0.14.0');
    expect(payload?.currentVersion).toBe('0.15.0');
    expect(payload?.regressions).toEqual([{ provider: 'anthropic', previousType: 'oauth' }]);
  });
});
