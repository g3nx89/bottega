import { describe, expect, it } from 'vitest';
import { CAPABILITIES, getCapability } from '../../../../src/main/workflows/capabilities.js';
import { composeCapabilities } from '../../../../src/main/workflows/capability-composer.js';
import { getAllPacks } from '../../../../src/main/workflows/registry.js';
import type { WorkflowCapabilityId } from '../../../../src/main/workflows/types.js';

const ALL_CAPABILITY_IDS: WorkflowCapabilityId[] = [
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

describe('capabilities', () => {
  it('all 10 capabilities registered', () => {
    expect(Object.keys(CAPABILITIES)).toHaveLength(10);
    for (const id of ALL_CAPABILITY_IDS) {
      expect(CAPABILITIES[id]).toBeDefined();
    }
  });

  it('each promptFragment under 200 tokens (~800 chars)', () => {
    for (const id of ALL_CAPABILITY_IDS) {
      const cap = CAPABILITIES[id];
      expect(cap.promptFragment.length).toBeLessThan(800);
    }
  });

  it('no conflicts: no tool in both preferred AND forbidden within same capability', () => {
    for (const id of ALL_CAPABILITY_IDS) {
      const cap = CAPABILITIES[id];
      const prefSet = new Set(cap.toolGuidance.preferred);
      for (const forbidden of cap.toolGuidance.forbidden) {
        expect(prefSet.has(forbidden)).toBe(false);
      }
    }
  });

  it('getCapability returns correct capability', () => {
    const cap = getCapability('ds-read');
    expect(cap.id).toBe('ds-read');
    expect(cap.toolGuidance.preferred).toContain('figma_design_system');
  });

  it('ds-write has figma_execute as forbidden', () => {
    const cap = getCapability('ds-write');
    expect(cap.toolGuidance.forbidden).toContain('figma_execute');
  });

  it('documentation has figma_execute and figma_set_text as forbidden', () => {
    const cap = getCapability('documentation');
    expect(cap.toolGuidance.forbidden).toContain('figma_execute');
    expect(cap.toolGuidance.forbidden).toContain('figma_set_text');
  });

  // ─── composeCapabilities ───────────────────────────────────────────────────

  it('composeCapabilities concatenates fragments', () => {
    const composed = composeCapabilities(['ds-read', 'ds-write']);
    const dsRead = getCapability('ds-read').promptFragment;
    const dsWrite = getCapability('ds-write').promptFragment;
    expect(composed.promptFragment).toContain(dsRead);
    expect(composed.promptFragment).toContain(dsWrite);
  });

  it('composeCapabilities: forbidden wins over preferred', () => {
    // ds-bootstrap has figma_execute in forbidden
    // (verify no ds-write-style conflict within composition)
    const composed = composeCapabilities(['ds-write', 'ds-bootstrap']);
    // figma_execute is in ds-write forbidden, should NOT be in preferred
    expect(composed.toolGuidance.preferred).not.toContain('figma_execute');
    expect(composed.toolGuidance.forbidden).toContain('figma_execute');
  });

  it('composeCapabilities deduplicates preferred tools', () => {
    // ds-read and ds-bootstrap both prefer figma_design_system
    const composed = composeCapabilities(['ds-read', 'ds-bootstrap']);
    const dsInstances = composed.toolGuidance.preferred.filter((t) => t === 'figma_design_system');
    expect(dsInstances).toHaveLength(1);
  });

  it('composeCapabilities deduplicates referenceDocIds', () => {
    // Call compose with same capability twice (edge case)
    const composed = composeCapabilities(['ds-write', 'ds-write']);
    const unique = new Set(composed.referenceDocIds);
    expect(composed.referenceDocIds.length).toBe(unique.size);
  });

  it('composeCapabilities with empty array returns empty result', () => {
    const composed = composeCapabilities([]);
    expect(composed.promptFragment).toBe('');
    expect(composed.toolGuidance.preferred).toEqual([]);
    expect(composed.toolGuidance.forbidden).toEqual([]);
  });

  it('composed token budget under 1500 tokens for any pack', () => {
    const CHARS_PER_TOKEN = 4;
    const MAX_TOKENS = 1500;
    const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

    for (const pack of getAllPacks()) {
      const composed = composeCapabilities(pack.capabilities);
      expect(composed.promptFragment.length).toBeLessThan(MAX_CHARS);
    }
  });

  it('visual-validation has maxLoops constraint set to 3', () => {
    const cap = getCapability('visual-validation');
    expect(cap.toolGuidance.constraints.maxLoops).toBe('3');
  });

  it('each capability has a non-empty name and description', () => {
    for (const id of ALL_CAPABILITY_IDS) {
      const cap = CAPABILITIES[id];
      expect(cap.name.length).toBeGreaterThan(0);
      expect(cap.description.length).toBeGreaterThan(0);
    }
  });
});
