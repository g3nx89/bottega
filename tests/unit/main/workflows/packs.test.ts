import { describe, expect, it } from 'vitest';
import { getCapability } from '../../../../src/main/workflows/capabilities.js';
import { buildDesignSystemPack } from '../../../../src/main/workflows/packs/build-design-system.js';
import { buildScreenPack } from '../../../../src/main/workflows/packs/build-screen.js';
import { updateScreenPack } from '../../../../src/main/workflows/packs/update-screen.js';

describe('build-screen pack', () => {
  it('has 5 phases', () => {
    expect(buildScreenPack.phases).toHaveLength(5);
  });

  it('has user checkpoint in plan phase', () => {
    const planPhase = buildScreenPack.phases.find((p) => p.id === 'plan');
    expect(planPhase?.userCheckpoint).toBe(true);
  });

  it('all capabilities are valid', () => {
    for (const capId of buildScreenPack.capabilities) {
      expect(getCapability(capId)).toBeDefined();
    }
  });

  it('includes ds-read and component-reuse', () => {
    expect(buildScreenPack.capabilities).toContain('ds-read');
    expect(buildScreenPack.capabilities).toContain('component-reuse');
  });

  it('build phase has anti-patterns', () => {
    const buildPhase = buildScreenPack.phases.find((p) => p.id === 'build');
    expect(buildPhase!.antiPatterns.length).toBeGreaterThan(0);
  });
});

describe('update-screen pack', () => {
  it('has 4 phases', () => {
    expect(updateScreenPack.phases).toHaveLength(4);
  });

  it('includes targeted-diff capability', () => {
    expect(updateScreenPack.capabilities).toContain('targeted-diff');
  });

  it('does not require state ledger', () => {
    expect(updateScreenPack.requiresStateLedger).toBe(false);
  });
});

describe('build-design-system pack', () => {
  it('has 5 phases', () => {
    expect(buildDesignSystemPack.phases).toHaveLength(5);
  });

  it('requires state ledger', () => {
    expect(buildDesignSystemPack.requiresStateLedger).toBe(true);
  });

  it('includes ds-bootstrap and ds-write', () => {
    expect(buildDesignSystemPack.capabilities).toContain('ds-bootstrap');
    expect(buildDesignSystemPack.capabilities).toContain('ds-write');
  });

  it('QA phase has user checkpoint', () => {
    const qaPhase = buildDesignSystemPack.phases.find((p) => p.id === 'qa');
    expect(qaPhase?.userCheckpoint).toBe(true);
  });

  it('foundations phase validates with lint', () => {
    const foundationsPhase = buildDesignSystemPack.phases.find((p) => p.id === 'foundations');
    expect(foundationsPhase?.validationType).toBe('both');
  });

  it('discovery phase requires user checkpoint', () => {
    const discoveryPhase = buildDesignSystemPack.phases.find((p) => p.id === 'discovery');
    expect(discoveryPhase?.userCheckpoint).toBe(true);
  });

  it('has governance anti-patterns', () => {
    const allAntiPatterns = buildDesignSystemPack.phases.flatMap((p) => p.antiPatterns);
    expect(allAntiPatterns.length).toBeGreaterThanOrEqual(6);
  });
});

describe('all packs', () => {
  const packs = [buildScreenPack, updateScreenPack, buildDesignSystemPack];

  it('have unique IDs', () => {
    const ids = packs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have at least one trigger', () => {
    for (const pack of packs) {
      expect(pack.triggers.length).toBeGreaterThan(0);
    }
  });

  it('have valid validation policies', () => {
    for (const pack of packs) {
      expect(pack.validationPolicy.maxScreenshotLoops).toBeLessThanOrEqual(5);
      expect(pack.validationPolicy.maxScreenshotLoops).toBeGreaterThan(0);
    }
  });
});
