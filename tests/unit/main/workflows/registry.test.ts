import { describe, expect, it } from 'vitest';
import { getAllPacks, getPackById } from '../../../../src/main/workflows/registry.js';
import type { WorkflowCapabilityId } from '../../../../src/main/workflows/types.js';

const VALID_CAPABILITY_IDS: WorkflowCapabilityId[] = [
  'ds-read',
  'ds-write',
  'ds-lint',
  'ds-proactive',
  'ds-bootstrap',
  'component-reuse',
  'library-fork',
  'targeted-diff',
  'visual-validation',
  'documentation',
];

describe('registry', () => {
  it('returns all 3 packs', () => {
    const packs = getAllPacks();
    expect(packs).toHaveLength(3);
  });

  it('pack IDs are build-screen, update-screen, build-design-system', () => {
    const ids = getAllPacks().map((p) => p.id);
    expect(ids).toContain('build-screen');
    expect(ids).toContain('update-screen');
    expect(ids).toContain('build-design-system');
  });

  it('getPackById returns correct pack', () => {
    const pack = getPackById('build-screen');
    expect(pack).toBeDefined();
    expect(pack?.id).toBe('build-screen');
    expect(pack?.name).toBe('Build Screen');
  });

  it('getPackById("update-screen") returns correct pack', () => {
    const pack = getPackById('update-screen');
    expect(pack?.id).toBe('update-screen');
  });

  it('getPackById("build-design-system") returns correct pack', () => {
    const pack = getPackById('build-design-system');
    expect(pack?.id).toBe('build-design-system');
  });

  it('unknown id returns undefined', () => {
    const pack = getPackById('non-existent-pack');
    expect(pack).toBeUndefined();
  });

  it('each pack has valid capabilities', () => {
    for (const pack of getAllPacks()) {
      for (const capId of pack.capabilities) {
        expect(VALID_CAPABILITY_IDS).toContain(capId);
      }
    }
  });

  it('each pack has at least 1 trigger', () => {
    for (const pack of getAllPacks()) {
      expect(pack.triggers.length).toBeGreaterThan(0);
    }
  });

  it('each pack has at least 1 phase', () => {
    for (const pack of getAllPacks()) {
      expect(pack.phases.length).toBeGreaterThan(0);
    }
  });

  it('build-screen has 5 phases', () => {
    const pack = getPackById('build-screen');
    expect(pack?.phases).toHaveLength(5);
  });

  it('update-screen has 4 phases', () => {
    const pack = getPackById('update-screen');
    expect(pack?.phases).toHaveLength(4);
  });

  it('build-design-system has 5 phases', () => {
    const pack = getPackById('build-design-system');
    expect(pack?.phases).toHaveLength(5);
  });

  it('build-design-system requiresStateLedger is true', () => {
    const pack = getPackById('build-design-system');
    expect(pack?.requiresStateLedger).toBe(true);
  });

  it('build-screen requiresStateLedger is false', () => {
    const pack = getPackById('build-screen');
    expect(pack?.requiresStateLedger).toBe(false);
  });

  it('all packs require user checkpoints', () => {
    for (const pack of getAllPacks()) {
      expect(pack.requiresUserCheckpoints).toBe(true);
    }
  });
});
