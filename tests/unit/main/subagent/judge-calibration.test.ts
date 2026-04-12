/**
 * Golden-file calibration tests for micro-judge criterion prompts.
 *
 * These tests verify that the criterion prompts + system prompt produce the correct
 * PASS/FAIL guidance for known input scenarios. They test prompt content and structure,
 * not actual LLM output (that requires agent-level tests).
 *
 * Each scenario represents a real-world case where judges previously failed incorrectly.
 * The test verifies that the prompt now contains language that would guide the judge
 * to the correct verdict.
 */
import { describe, expect, it } from 'vitest';
import { getJudgeDefinition } from '../../../../src/main/subagent/judge-registry.js';
import {
  getMicroJudgeCriterionPrompt,
  getMicroJudgeSystemPrompt,
} from '../../../../src/main/subagent/system-prompts.js';
import type { MicroJudgeId } from '../../../../src/main/subagent/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function getFullPrompt(judgeId: MicroJudgeId): string {
  return getMicroJudgeSystemPrompt() + '\n\n' + getMicroJudgeCriterionPrompt(judgeId);
}

// ── Golden-File Scenarios ────────────────────────────────────────────

describe('Judge Calibration — Golden-File Scenarios', () => {
  describe('token_compliance: no token system = PASS', () => {
    it('prompt explicitly says no design system = PASS', () => {
      const prompt = getFullPrompt('token_compliance');
      expect(prompt).toContain('no design system section is provided');
      expect(prompt).toContain('no variables/tokens defined');
      // The prompt should NOT encourage failing just because hex values exist
      expect(prompt).toContain('Do NOT fail just because hex values exist');
    });

    it('few-shot PASS example shows no-token-system scenario', () => {
      const prompt = getMicroJudgeCriterionPrompt('token_compliance');
      expect(prompt).toContain('Example PASS');
      expect(prompt).toContain('No design token system is configured');
    });
  });

  describe('completeness: vague request = PASS', () => {
    it('prompt says PASS for vague requests with reasonable structure', () => {
      const prompt = getFullPrompt('completeness');
      expect(prompt).toContain('task context is vague');
      expect(prompt).toContain('PASS as long as a reasonable');
    });

    it('prompt does NOT fail for missing hover/error states unless requested', () => {
      const prompt = getMicroJudgeCriterionPrompt('completeness');
      expect(prompt).toContain('missing hover/error/loading states unless specifically requested');
    });

    it('few-shot examples show task-scoped evaluation', () => {
      const prompt = getMicroJudgeCriterionPrompt('completeness');
      expect(prompt).toContain('Example PASS');
      expect(prompt).toContain('Example FAIL');
      // FAIL example should reference specific missing element from task
      expect(prompt).toContain('explicitly requested');
    });
  });

  describe('alignment: tolerance + coordinate checking', () => {
    it('delegates to pre-computed AlignmentAnalysis report (no manual coordinate math)', () => {
      const prompt = getFullPrompt('alignment');
      expect(prompt).toContain('AlignmentAnalysis');
      expect(prompt).toContain('Pre-Computed Evidence');
      // Judge is explicitly told not to re-compute from file data
      expect(prompt).toContain('do NOT re-compute');
    });

    it('uses the report verdict as the PASS/FAIL signal', () => {
      const prompt = getMicroJudgeCriterionPrompt('alignment');
      expect(prompt).toContain("verdict === 'aligned'");
      expect(prompt).toContain("verdict === 'misaligned'");
    });
  });

  describe('consistency: sibling comparison', () => {
    it('delegates to pre-computed ConsistencyAnalysis report', () => {
      const prompt = getFullPrompt('consistency');
      expect(prompt).toContain('ConsistencyAnalysis');
      expect(prompt).toContain('Pre-Computed Evidence');
    });

    it('uses the report verdict and allows intentional role differences', () => {
      const prompt = getMicroJudgeCriterionPrompt('consistency');
      expect(prompt).toContain("verdict === 'consistent'");
      expect(prompt).toContain("verdict === 'inconsistent'");
      expect(prompt).toContain('different roles');
    });
  });

  describe('componentization: single screen = PASS', () => {
    it('dismisses LOW-confidence findings', () => {
      const prompt = getFullPrompt('componentization');
      expect(prompt).toContain('Dismiss LOW-confidence');
    });

    it('requires 3+ HIGH-confidence duplicates to FAIL', () => {
      const prompt = getMicroJudgeCriterionPrompt('componentization');
      expect(prompt).toContain('3+ HIGH-confidence');
    });

    it('no component analysis data = PASS', () => {
      const prompt = getMicroJudgeCriterionPrompt('componentization');
      expect(prompt).toContain('no component analysis data is provided');
    });
  });

  describe('naming: leaf nodes can keep default names', () => {
    it('delegates to pre-computed NamingAnalysis report', () => {
      const prompt = getFullPrompt('naming');
      expect(prompt).toContain('NamingAnalysis');
      // Judge reads the report fields, not the raw file data
      expect(prompt).toContain('autoNamedFrames');
      expect(prompt).toContain('framesWithoutAutoLayout');
    });

    it('uses the report verdict as the PASS/FAIL signal', () => {
      const prompt = getMicroJudgeCriterionPrompt('naming');
      expect(prompt).toContain("verdict === 'ok'");
      expect(prompt).toContain('autoNamedFrames.length > 0');
    });
  });

  describe('visual_hierarchy: typography verification', () => {
    it('delegates to pre-computed TypographyAnalysis report', () => {
      const prompt = getFullPrompt('visual_hierarchy');
      expect(prompt).toContain('TypographyAnalysis');
      expect(prompt).toContain('do NOT re-compute');
    });

    it('fails when the report shows allSameStyle=true with ≥2 text nodes', () => {
      const prompt = getMicroJudgeCriterionPrompt('visual_hierarchy');
      expect(prompt).toContain('allSameStyle === true');
      expect(prompt).toContain('textCount >= 2');
    });
  });

  describe('design_quality: vision-based scoring', () => {
    it('evaluates 5 visual dimensions from screenshot', () => {
      const prompt = getFullPrompt('design_quality');
      expect(prompt).toContain('Intent Match');
      expect(prompt).toContain('Visual Craft');
      expect(prompt).toContain('Design Decisions');
      expect(prompt).toContain('Layout Precision');
      expect(prompt).toContain('Aesthetic Cohesion');
    });

    it('PASS threshold is mean >= 5', () => {
      const prompt = getMicroJudgeCriterionPrompt('design_quality');
      expect(prompt).toContain('mean >= 5');
      expect(prompt).toContain('mean < 5');
    });

    it('scores generously for simple designs', () => {
      const prompt = getMicroJudgeCriterionPrompt('design_quality');
      expect(prompt).toContain('simple designs');
      expect(prompt).toContain('at least 5/10');
    });

    it('output format includes per-dimension scores', () => {
      const prompt = getMicroJudgeCriterionPrompt('design_quality');
      expect(prompt).toContain('mean=');
      expect(prompt).toContain('intent:');
      expect(prompt).toContain('craft:');
    });

    it('defers structural checks to other judges', () => {
      const prompt = getMicroJudgeCriterionPrompt('design_quality');
      expect(prompt).toContain('Other judges already check');
      expect(prompt).toContain('VISUAL qualities only');
    });
  });
});

// ── Model & Thinking Level Configuration ─────────────────────────────

describe('Judge Registry — Model & Thinking Level Calibration', () => {
  const REASONING_JUDGES: MicroJudgeId[] = [
    'alignment',
    'visual_hierarchy',
    'completeness',
    'consistency',
    'design_quality',
  ];
  const PATTERN_JUDGES: MicroJudgeId[] = ['token_compliance', 'naming', 'componentization'];

  for (const id of REASONING_JUDGES) {
    it(`${id} uses sonnet model (reasoning-heavy)`, () => {
      const def = getJudgeDefinition(id);
      expect(def.defaultModel).toBe('claude-sonnet-4-6');
    });

    it(`${id} uses medium thinking level`, () => {
      const def = getJudgeDefinition(id);
      expect(def.defaultThinking).toBe('medium');
    });
  }

  for (const id of PATTERN_JUDGES) {
    it(`${id} uses haiku model (pattern-matching)`, () => {
      const def = getJudgeDefinition(id);
      expect(def.defaultModel).toBe('claude-haiku-4-5');
    });

    it(`${id} uses low thinking level`, () => {
      const def = getJudgeDefinition(id);
      expect(def.defaultThinking).toBe('low');
    });
  }
});

// ── Few-Shot Example Structure ───────────────────────────────────────

describe('Judge Calibration — Few-Shot Examples', () => {
  const JUDGES_WITH_EXAMPLES: MicroJudgeId[] = [
    'alignment',
    'token_compliance',
    'visual_hierarchy',
    'completeness',
    'consistency',
    'naming',
    'componentization',
  ];

  for (const id of JUDGES_WITH_EXAMPLES) {
    it(`${id} has both PASS and FAIL few-shot examples`, () => {
      const prompt = getMicroJudgeCriterionPrompt(id);
      expect(prompt).toContain('Example PASS:');
      expect(prompt).toContain('Example FAIL:');
    });

    it(`${id} PASS example contains valid JSON structure`, () => {
      const prompt = getMicroJudgeCriterionPrompt(id);
      const passMatch = prompt.match(/Example PASS:\s*(\{[^}]+\})/);
      expect(passMatch).not.toBeNull();
      const parsed = JSON.parse(passMatch![1]);
      expect(parsed.pass).toBe(true);
      expect(typeof parsed.finding).toBe('string');
      expect(typeof parsed.evidence).toBe('string');
      expect(Array.isArray(parsed.actionItems)).toBe(true);
      expect(parsed.actionItems).toHaveLength(0);
    });

    it(`${id} FAIL example contains valid JSON structure with actionItems`, () => {
      const prompt = getMicroJudgeCriterionPrompt(id);
      const failMatch = prompt.match(/Example FAIL:\s*(\{[^}]+\})/);
      expect(failMatch).not.toBeNull();
      const parsed = JSON.parse(failMatch![1]);
      expect(parsed.pass).toBe(false);
      expect(typeof parsed.finding).toBe('string');
      expect(typeof parsed.evidence).toBe('string');
      expect(Array.isArray(parsed.actionItems)).toBe(true);
      expect(parsed.actionItems.length).toBeGreaterThan(0);
    });
  }
});

// ── System Prompt Calibration ────────────────────────────────────────

describe('Judge System Prompt — Balanced Evaluation Directives', () => {
  it('instructs objective evaluation', () => {
    const prompt = getMicroJudgeSystemPrompt();
    expect(prompt).toContain('Evaluate OBJECTIVELY');
    expect(prompt).toContain('Do not assume or infer');
  });

  it('FAILs on clear violations, PASSes on compliance', () => {
    const prompt = getMicroJudgeSystemPrompt();
    expect(prompt).toContain('clearly shows a violation');
    expect(prompt).toContain('shows compliance, PASS');
  });

  it('handles insufficient data gracefully', () => {
    const prompt = getMicroJudgeSystemPrompt();
    expect(prompt).toContain('insufficient to evaluate');
    expect(prompt).toContain('Insufficient data');
  });

  it('action items must be concrete', () => {
    const prompt = getMicroJudgeSystemPrompt();
    expect(prompt).toContain('concrete and actionable');
    expect(prompt).toContain('node names and target values');
  });
});
