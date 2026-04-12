/**
 * Unit tests for evidence-based severity classification.
 *
 * Each test verifies that the severity thresholds correctly distinguish
 * 'major' (blocking) from 'minor' (suggestion) findings. The goal is
 * NOT to lower the quality bar but to focus retry on the most impactful issue.
 */

import { describe, expect, it } from 'vitest';
import type { JudgeEvidence } from '../../../../src/main/subagent/judge-evidence.js';
import { computeDowngradedJudges, computeEvidenceSeverity } from '../../../../src/main/subagent/judge-severity.js';
import type { MicroJudgeId } from '../../../../src/main/subagent/types.js';

// ── Fixture helpers ─────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<JudgeEvidence> = {}): JudgeEvidence {
  return {
    alignment: { verdict: 'aligned', tolerancePx: 4, siblingGroupsChecked: 1, findings: [] },
    visual_hierarchy: {
      verdict: 'hierarchical',
      textCount: 3,
      uniqueFontSizes: [14, 24],
      uniqueFontStyles: ['Regular', 'Bold'],
      allSameStyle: false,
      samples: [],
    },
    consistency: { verdict: 'consistent', siblingGroupsChecked: 1, findings: [] },
    naming: { verdict: 'ok', autoNamedFrames: [], framesWithoutAutoLayout: [] },
    targetNodeId: '1:1',
    nodeCount: 10,
    ...overrides,
  };
}

// ── computeEvidenceSeverity ─────────────────────────────────────────────

describe('computeEvidenceSeverity', () => {
  describe('alignment', () => {
    it('returns null when evidence is null', () => {
      expect(computeEvidenceSeverity('alignment', null)).toBeNull();
    });

    it('returns null when verdict is aligned (no issue)', () => {
      const evidence = makeEvidence();
      expect(computeEvidenceSeverity('alignment', evidence)).toBeNull();
    });

    it('returns minor for misalignment ≤8px', () => {
      const evidence = makeEvidence({
        alignment: {
          verdict: 'misaligned',
          tolerancePx: 4,
          siblingGroupsChecked: 1,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Container',
              axis: 'y',
              values: [0, 6, 0],
              maxDeviation: 6,
              nodeIds: ['1:2', '1:3', '1:4'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('alignment', evidence)).toBe('minor');
    });

    it('returns major for misalignment >8px', () => {
      const evidence = makeEvidence({
        alignment: {
          verdict: 'misaligned',
          tolerancePx: 4,
          siblingGroupsChecked: 1,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Container',
              axis: 'y',
              values: [0, 15, 0],
              maxDeviation: 15,
              nodeIds: ['1:2', '1:3', '1:4'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('alignment', evidence)).toBe('major');
    });

    it('uses the largest deviation across multiple findings', () => {
      const evidence = makeEvidence({
        alignment: {
          verdict: 'misaligned',
          tolerancePx: 4,
          siblingGroupsChecked: 2,
          findings: [
            { parentId: '1:1', parentName: 'Row1', axis: 'y', values: [0, 5], maxDeviation: 5, nodeIds: ['1:2'] },
            { parentId: '2:1', parentName: 'Row2', axis: 'x', values: [0, 12], maxDeviation: 12, nodeIds: ['2:2'] },
          ],
        },
      });
      expect(computeEvidenceSeverity('alignment', evidence)).toBe('major');
    });

    it('returns minor at exactly 8px boundary', () => {
      const evidence = makeEvidence({
        alignment: {
          verdict: 'misaligned',
          tolerancePx: 4,
          siblingGroupsChecked: 1,
          findings: [
            { parentId: '1:1', parentName: 'Container', axis: 'y', values: [0, 8], maxDeviation: 8, nodeIds: ['1:2'] },
          ],
        },
      });
      expect(computeEvidenceSeverity('alignment', evidence)).toBe('minor');
    });
  });

  describe('visual_hierarchy', () => {
    it('returns null when verdict is hierarchical (no issue)', () => {
      const evidence = makeEvidence();
      expect(computeEvidenceSeverity('visual_hierarchy', evidence)).toBeNull();
    });

    it('returns minor for flat typography with 2 text nodes', () => {
      const evidence = makeEvidence({
        visual_hierarchy: {
          verdict: 'flat',
          textCount: 2,
          uniqueFontSizes: [14],
          uniqueFontStyles: ['Regular'],
          allSameStyle: true,
          samples: [],
        },
      });
      expect(computeEvidenceSeverity('visual_hierarchy', evidence)).toBe('minor');
    });

    it('returns minor for flat typography with 3 text nodes', () => {
      const evidence = makeEvidence({
        visual_hierarchy: {
          verdict: 'flat',
          textCount: 3,
          uniqueFontSizes: [14],
          uniqueFontStyles: ['Regular'],
          allSameStyle: true,
          samples: [],
        },
      });
      expect(computeEvidenceSeverity('visual_hierarchy', evidence)).toBe('minor');
    });

    it('returns major for flat typography with 4+ text nodes', () => {
      const evidence = makeEvidence({
        visual_hierarchy: {
          verdict: 'flat',
          textCount: 4,
          uniqueFontSizes: [14],
          uniqueFontStyles: ['Regular'],
          allSameStyle: true,
          samples: [],
        },
      });
      expect(computeEvidenceSeverity('visual_hierarchy', evidence)).toBe('major');
    });

    it('returns major for large flat design (6 text nodes)', () => {
      const evidence = makeEvidence({
        visual_hierarchy: {
          verdict: 'flat',
          textCount: 6,
          uniqueFontSizes: [16],
          uniqueFontStyles: ['Regular'],
          allSameStyle: true,
          samples: [],
        },
      });
      expect(computeEvidenceSeverity('visual_hierarchy', evidence)).toBe('major');
    });
  });

  describe('consistency', () => {
    it('returns null when verdict is consistent', () => {
      const evidence = makeEvidence();
      expect(computeEvidenceSeverity('consistency', evidence)).toBeNull();
    });

    it('returns minor for small padding deviation (2px)', () => {
      const evidence = makeEvidence({
        consistency: {
          verdict: 'inconsistent',
          siblingGroupsChecked: 1,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Cards',
              property: 'paddingTop',
              values: [16, 18, 16],
              nodeIds: ['1:2', '1:3', '1:4'],
              nodeNames: ['Card 1', 'Card 2', 'Card 3'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('consistency', evidence)).toBe('minor');
    });

    it('returns minor at exactly 4px boundary', () => {
      const evidence = makeEvidence({
        consistency: {
          verdict: 'inconsistent',
          siblingGroupsChecked: 1,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Cards',
              property: 'paddingTop',
              values: [16, 20, 16],
              nodeIds: ['1:2', '1:3', '1:4'],
              nodeNames: ['Card 1', 'Card 2', 'Card 3'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('consistency', evidence)).toBe('minor');
    });

    it('returns major for large padding deviation (>4px)', () => {
      const evidence = makeEvidence({
        consistency: {
          verdict: 'inconsistent',
          siblingGroupsChecked: 1,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Cards',
              property: 'paddingTop',
              values: [16, 24, 16],
              nodeIds: ['1:2', '1:3', '1:4'],
              nodeNames: ['Card 1', 'Card 2', 'Card 3'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('consistency', evidence)).toBe('major');
    });

    it('uses the largest deviation across multiple findings', () => {
      const evidence = makeEvidence({
        consistency: {
          verdict: 'inconsistent',
          siblingGroupsChecked: 2,
          findings: [
            {
              parentId: '1:1',
              parentName: 'Cards',
              property: 'paddingTop',
              values: [16, 18],
              nodeIds: ['1:2'],
              nodeNames: ['Card A'],
            },
            {
              parentId: '2:1',
              parentName: 'List',
              property: 'cornerRadius',
              values: [4, 12],
              nodeIds: ['2:2'],
              nodeNames: ['Item A'],
            },
          ],
        },
      });
      expect(computeEvidenceSeverity('consistency', evidence)).toBe('major');
    });
  });

  describe('naming', () => {
    it('returns null when verdict is ok', () => {
      const evidence = makeEvidence();
      expect(computeEvidenceSeverity('naming', evidence)).toBeNull();
    });

    it('returns minor for 1-2 auto-named frames', () => {
      const evidence = makeEvidence({
        naming: {
          verdict: 'hasAutoNames',
          autoNamedFrames: [
            { id: '1:2', name: 'Frame 1' },
            { id: '1:3', name: 'Frame 2' },
          ],
          framesWithoutAutoLayout: [],
        },
      });
      expect(computeEvidenceSeverity('naming', evidence)).toBe('minor');
    });

    it('returns major for 3+ auto-named frames', () => {
      const evidence = makeEvidence({
        naming: {
          verdict: 'hasAutoNames',
          autoNamedFrames: [
            { id: '1:2', name: 'Frame 1' },
            { id: '1:3', name: 'Frame 2' },
            { id: '1:4', name: 'Group 3' },
          ],
          framesWithoutAutoLayout: [],
        },
      });
      expect(computeEvidenceSeverity('naming', evidence)).toBe('major');
    });

    it('returns major for 2+ frames without auto-layout', () => {
      const evidence = makeEvidence({
        naming: {
          verdict: 'hasAutoNames',
          autoNamedFrames: [],
          framesWithoutAutoLayout: [
            { id: '1:2', name: 'Container', childCount: 4 },
            { id: '1:3', name: 'Wrapper', childCount: 3 },
          ],
        },
      });
      expect(computeEvidenceSeverity('naming', evidence)).toBe('major');
    });

    it('returns minor for 1 frame without auto-layout', () => {
      const evidence = makeEvidence({
        naming: {
          verdict: 'hasAutoNames',
          autoNamedFrames: [],
          framesWithoutAutoLayout: [{ id: '1:2', name: 'Container', childCount: 4 }],
        },
      });
      expect(computeEvidenceSeverity('naming', evidence)).toBe('minor');
    });
  });

  describe('non-evidence judges', () => {
    for (const id of ['token_compliance', 'completeness', 'componentization', 'design_quality'] as MicroJudgeId[]) {
      it(`returns null for ${id} (no severity classification)`, () => {
        const evidence = makeEvidence();
        expect(computeEvidenceSeverity(id, evidence)).toBeNull();
      });
    }
  });
});

// ── computeDowngradedJudges ─────────────────────────────────────────────

describe('computeDowngradedJudges', () => {
  it('returns empty set when no judges have minor severity', () => {
    const evidence = makeEvidence();
    const result = computeDowngradedJudges(['alignment', 'visual_hierarchy', 'consistency'], evidence);
    expect(result.size).toBe(0);
  });

  it('returns empty set when evidence is null', () => {
    const result = computeDowngradedJudges(['alignment', 'visual_hierarchy'], null);
    expect(result.size).toBe(0);
  });

  it('downgrades only minor-severity judges', () => {
    const evidence = makeEvidence({
      alignment: {
        verdict: 'misaligned',
        tolerancePx: 4,
        siblingGroupsChecked: 1,
        findings: [{ parentId: '1:1', parentName: 'C', axis: 'y', values: [0, 6], maxDeviation: 6, nodeIds: ['1:2'] }],
      },
      visual_hierarchy: {
        verdict: 'flat',
        textCount: 5,
        uniqueFontSizes: [14],
        uniqueFontStyles: ['Regular'],
        allSameStyle: true,
        samples: [],
      },
    });

    const result = computeDowngradedJudges(['alignment', 'visual_hierarchy', 'naming'], evidence);
    // alignment: 6px = minor → downgraded
    expect(result.has('alignment')).toBe(true);
    // visual_hierarchy: 5 text nodes flat = major → NOT downgraded
    expect(result.has('visual_hierarchy')).toBe(false);
    // naming: verdict is ok → null → NOT downgraded
    expect(result.has('naming')).toBe(false);
  });
});
