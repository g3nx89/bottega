import { describe, expect, it } from 'vitest';
import { getPackById } from '../../../../src/main/workflows/registry.js';
import {
  buildJudgeCriteria,
  checkRequiredDiscovery,
  getMaxScreenshotLoops,
  getRulesByTrigger,
  getValidationRules,
  UNIVERSAL_RULES,
} from '../../../../src/main/workflows/validation-policy.js';

describe('UNIVERSAL_RULES', () => {
  it('has 4 base rules', () => {
    expect(UNIVERSAL_RULES).toHaveLength(4);
  });

  it('includes no-duplicate-creation', () => {
    expect(UNIVERSAL_RULES.find((r) => r.id === 'no-duplicate-creation')).toBeDefined();
  });

  it('includes discovery-before-create', () => {
    expect(UNIVERSAL_RULES.find((r) => r.id === 'discovery-before-create')).toBeDefined();
  });

  it('includes visual-defect-check as after-milestone', () => {
    const rule = UNIVERSAL_RULES.find((r) => r.id === 'visual-defect-check');
    expect(rule?.trigger).toBe('after-milestone');
  });

  it('each rule has required fields', () => {
    for (const rule of UNIVERSAL_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(rule.trigger).toBeTruthy();
      expect(rule.type).toBeTruthy();
      expect(rule.check).toBeTruthy();
    }
  });
});

describe('getValidationRules', () => {
  it('returns only universal rules when no pack', () => {
    const rules = getValidationRules(null);
    expect(rules).toHaveLength(UNIVERSAL_RULES.length);
  });

  it('includes pack mutation rules', () => {
    const pack = getPackById('build-screen')!;
    const rules = getValidationRules(pack);
    expect(rules.length).toBeGreaterThan(UNIVERSAL_RULES.length);
  });

  it('includes phase exit criteria when phaseId given', () => {
    const pack = getPackById('build-screen')!;
    const rules = getValidationRules(pack, 'build');
    const phaseRules = rules.filter((r) => r.id.startsWith('phase-exit-'));
    expect(phaseRules.length).toBeGreaterThan(0);
  });

  it('does not add phase rules for unknown phaseId', () => {
    const pack = getPackById('build-screen')!;
    const rules = getValidationRules(pack, 'nonexistent');
    const phaseRules = rules.filter((r) => r.id.startsWith('phase-exit-'));
    expect(phaseRules).toHaveLength(0);
  });
});

describe('getRulesByTrigger', () => {
  it('filters rules by trigger', () => {
    const rules = getValidationRules(null);
    const mutationRules = getRulesByTrigger(rules, 'after-mutation');
    expect(mutationRules.every((r) => r.trigger === 'after-mutation')).toBe(true);
    expect(mutationRules.length).toBeGreaterThan(0);
  });

  it('returns empty for no matches', () => {
    const rules = [UNIVERSAL_RULES[0]!]; // after-mutation
    const milestoneRules = getRulesByTrigger(rules, 'after-milestone');
    expect(milestoneRules).toHaveLength(0);
  });
});

describe('getMaxScreenshotLoops', () => {
  it('returns pack value when available', () => {
    const pack = getPackById('build-screen')!;
    expect(getMaxScreenshotLoops(pack)).toBe(3);
  });

  it('returns default 3 when no pack', () => {
    expect(getMaxScreenshotLoops(null)).toBe(3);
  });
});

describe('buildJudgeCriteria', () => {
  it('returns empty string for no pack and no rules', () => {
    // With null pack, there are universal milestone rules
    const criteria = buildJudgeCriteria(null);
    expect(criteria).toContain('Validation criteria');
  });

  it('includes pack name in header', () => {
    const pack = getPackById('build-screen')!;
    const criteria = buildJudgeCriteria(pack);
    expect(criteria).toContain('Build Screen');
  });

  it('includes phase in header when provided', () => {
    const pack = getPackById('build-screen')!;
    const criteria = buildJudgeCriteria(pack, 'build');
    expect(criteria).toContain('phase: build');
  });

  it('includes milestone and checkpoint rules', () => {
    const pack = getPackById('build-screen')!;
    const criteria = buildJudgeCriteria(pack, 'validate');
    expect(criteria.includes('[visual]') || criteria.includes('[structural]')).toBe(true);
  });
});

describe('checkRequiredDiscovery', () => {
  it('returns empty when discovery was done', () => {
    const pack = getPackById('build-screen')!;
    const unsatisfied = checkRequiredDiscovery(
      ['figma_design_system', 'figma_search_components', 'figma_render_jsx'],
      pack,
    );
    expect(unsatisfied).toEqual([]);
  });

  it('flags missing discovery before creation', () => {
    const pack = getPackById('build-screen')!;
    const unsatisfied = checkRequiredDiscovery(['figma_render_jsx', 'figma_set_fills'], pack);
    expect(unsatisfied).toContain('no-duplicate-creation');
  });

  it('returns empty when no pack', () => {
    expect(checkRequiredDiscovery(['figma_render_jsx'], null)).toEqual([]);
  });

  it('passes when search done before create', () => {
    const pack = getPackById('build-screen')!;
    const unsatisfied = checkRequiredDiscovery(['figma_search_components', 'figma_create_child'], pack);
    expect(unsatisfied).not.toContain('no-duplicate-creation');
  });
});
