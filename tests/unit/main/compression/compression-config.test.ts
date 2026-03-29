import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_PROFILES,
  type CompressionConfig,
  CompressionConfigManager,
  type CompressionProfile,
  DEFAULT_PROFILE,
} from '../../../../src/main/compression/compression-config.js';

const ALL_PROFILES: CompressionProfile[] = ['balanced', 'creative', 'exploration', 'minimal'];
const CONFIG_KEYS: (keyof CompressionConfig)[] = [
  'compressMutationResults',
  'compactDesignSystem',
  'treeProjectionDetail',
  'executeIdExtraction',
  'designSystemCacheTtlMs',
];

describe('CompressionConfigManager', () => {
  it('defaults to balanced profile', () => {
    const mgr = new CompressionConfigManager();
    expect(mgr.getActiveProfile()).toBe('balanced');
  });

  it('getActiveConfig returns balanced config by default', () => {
    const mgr = new CompressionConfigManager();
    expect(mgr.getActiveConfig()).toBe(COMPRESSION_PROFILES.balanced.config);
  });

  it('setProfile switches the active profile', () => {
    const mgr = new CompressionConfigManager();
    mgr.setProfile('minimal');
    expect(mgr.getActiveProfile()).toBe('minimal');
  });

  it('getActiveConfig returns the switched profile config', () => {
    const mgr = new CompressionConfigManager();
    mgr.setProfile('exploration');
    expect(mgr.getActiveConfig()).toBe(COMPRESSION_PROFILES.exploration.config);
  });

  it('setProfile throws on invalid profile', () => {
    const mgr = new CompressionConfigManager();
    expect(() => mgr.setProfile('nonexistent' as CompressionProfile)).toThrow('Invalid compression profile');
  });

  it('getProfiles returns all 4 profiles', () => {
    const mgr = new CompressionConfigManager();
    const profiles = mgr.getProfiles();
    expect(profiles).toHaveLength(4);
    expect(profiles.map((p) => p.id).sort()).toEqual([...ALL_PROFILES].sort());
  });

  it('can switch between all profiles', () => {
    const mgr = new CompressionConfigManager();
    for (const profile of ALL_PROFILES) {
      mgr.setProfile(profile);
      expect(mgr.getActiveProfile()).toBe(profile);
      expect(mgr.getActiveConfig()).toBe(COMPRESSION_PROFILES[profile].config);
    }
  });
});

describe('COMPRESSION_PROFILES', () => {
  it('DEFAULT_PROFILE is balanced', () => {
    expect(DEFAULT_PROFILE).toBe('balanced');
  });

  for (const profile of ALL_PROFILES) {
    describe(`${profile} profile`, () => {
      const def = COMPRESSION_PROFILES[profile];

      it('has all required CompressionConfig fields', () => {
        for (const key of CONFIG_KEYS) {
          expect(def.config).toHaveProperty(key);
        }
      });

      it('has non-empty label and description', () => {
        expect(def.label.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(0);
      });

      it('has id matching its key', () => {
        expect(def.id).toBe(profile);
      });

      it('has positive designSystemCacheTtlMs', () => {
        expect(def.config.designSystemCacheTtlMs).toBeGreaterThan(0);
      });
    });
  }
});

describe('Profile-specific config values', () => {
  it('balanced compresses mutations', () => {
    expect(COMPRESSION_PROFILES.balanced.config.compressMutationResults).toBe(true);
  });

  it('balanced compacts design system', () => {
    expect(COMPRESSION_PROFILES.balanced.config.compactDesignSystem).toBe(true);
  });

  it('balanced uses standard tree projection', () => {
    expect(COMPRESSION_PROFILES.balanced.config.treeProjectionDetail).toBe('standard');
  });

  it('minimal does NOT compress mutations', () => {
    expect(COMPRESSION_PROFILES.minimal.config.compressMutationResults).toBe(false);
  });

  it('minimal does NOT compact design system', () => {
    expect(COMPRESSION_PROFILES.minimal.config.compactDesignSystem).toBe(false);
  });

  it('minimal uses detailed tree projection', () => {
    expect(COMPRESSION_PROFILES.minimal.config.treeProjectionDetail).toBe('detailed');
  });

  it('exploration does NOT compact design system', () => {
    expect(COMPRESSION_PROFILES.exploration.config.compactDesignSystem).toBe(false);
  });

  it('exploration uses detailed tree projection', () => {
    expect(COMPRESSION_PROFILES.exploration.config.treeProjectionDetail).toBe('detailed');
  });

  it('exploration still compresses mutations', () => {
    expect(COMPRESSION_PROFILES.exploration.config.compressMutationResults).toBe(true);
  });

  it('creative has shorter designSystemCacheTtlMs than balanced', () => {
    expect(COMPRESSION_PROFILES.creative.config.designSystemCacheTtlMs).toBeLessThan(
      COMPRESSION_PROFILES.balanced.config.designSystemCacheTtlMs,
    );
  });

  it('creative config differs from balanced config', () => {
    const b = COMPRESSION_PROFILES.balanced.config;
    const c = COMPRESSION_PROFILES.creative.config;
    const isDifferent = Object.keys(b).some((k) => (b as any)[k] !== (c as any)[k]);
    expect(isDifferent).toBe(true);
  });

  it('all profiles enable executeIdExtraction', () => {
    for (const profile of ALL_PROFILES) {
      expect(COMPRESSION_PROFILES[profile].config.executeIdExtraction).toBe(true);
    }
  });
});
