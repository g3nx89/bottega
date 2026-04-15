import { describe, expect, it, vi } from 'vitest';

import { runKeychainProbe } from '../../../src/main/startup-guards.js';

describe('runKeychainProbe', () => {
  it('returns available=false when encryption is unavailable', () => {
    const stub = {
      isEncryptionAvailable: () => false,
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    };
    expect(runKeychainProbe(stub)).toEqual({ available: false, probeOk: null });
  });

  it('returns probeOk=true on successful round-trip', () => {
    const stub = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    };
    expect(runKeychainProbe(stub)).toEqual({ available: true, probeOk: true });
  });

  it('returns probeOk=false when decrypt throws', () => {
    const stub = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('enc'),
      decryptString: () => {
        throw new Error('keychain locked');
      },
    };
    const result = runKeychainProbe(stub);
    expect(result.available).toBe(true);
    expect(result.probeOk).toBe(false);
    expect(result.reason).toContain('keychain locked');
  });

  it('returns probeOk=false on round-trip mismatch', () => {
    const stub = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: () => 'tampered',
    };
    const result = runKeychainProbe(stub);
    expect(result.probeOk).toBe(false);
    expect(result.reason).toBe('round-trip mismatch');
  });

  it('handles isEncryptionAvailable throwing', () => {
    const stub = {
      isEncryptionAvailable: () => {
        throw new Error('electron init error');
      },
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    };
    const result = runKeychainProbe(stub);
    expect(result.available).toBe(false);
    expect(result.probeOk).toBeNull();
    expect(result.reason).toContain('electron init error');
  });
});
