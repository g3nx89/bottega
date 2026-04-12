import { describe, expect, it } from 'vitest';
import {
  getMicroJudgeCriterionPrompt,
  getMicroJudgeSystemPrompt,
  getSystemPrompt,
} from '../../../../src/main/subagent/system-prompts.js';
import type { MicroJudgeId, SubagentRole } from '../../../../src/main/subagent/types.js';

const ROLES: SubagentRole[] = ['scout', 'analyst', 'auditor', 'judge'];

const COMMON_PREAMBLE_PHRASES = ['read-only specialist', 'do NOT trust', 'direct observation'];

describe('System Prompts', () => {
  describe('common preamble', () => {
    for (const role of ROLES) {
      it(`${role} prompt contains all common preamble elements`, () => {
        const prompt = getSystemPrompt(role);
        for (const phrase of COMMON_PREAMBLE_PHRASES) {
          expect(prompt.toLowerCase()).toContain(phrase.toLowerCase());
        }
      });
    }
  });

  describe('role-specific content', () => {
    it('scout prompt focuses on structure and components', () => {
      const prompt = getSystemPrompt('scout');
      expect(prompt).toContain('Structure');
      expect(prompt).toContain('Components');
      expect(prompt).toContain('Design System');
    });

    it('analyst prompt focuses on variants and properties', () => {
      const prompt = getSystemPrompt('analyst');
      expect(prompt).toContain('Variants');
      expect(prompt).toContain('Properties');
      expect(prompt).toContain('States');
    });

    it('auditor prompt focuses on compliance and tokens', () => {
      const prompt = getSystemPrompt('auditor');
      expect(prompt).toContain('Token Compliance');
      expect(prompt).toContain('figma_lint');
      expect(prompt).toContain('Spacing');
    });

    it('judge prompt contains all 5 criteria', () => {
      const prompt = getSystemPrompt('judge');
      for (const criterion of ['alignment', 'token_compliance', 'visual_hierarchy', 'completeness', 'consistency']) {
        expect(prompt).toContain(criterion);
      }
    });

    it('judge prompt contains fair evaluation language', () => {
      const prompt = getSystemPrompt('judge');
      expect(prompt).toContain('design quality reviewer');
      expect(prompt).toContain('FAIL only when there is a clear');
      expect(prompt).toContain('FAIL');
      expect(prompt).toContain('Evidence MUST include specific node IDs');
    });

    it('judge prompt contains JSON output format', () => {
      const prompt = getSystemPrompt('judge');
      expect(prompt).toContain('"verdict"');
      expect(prompt).toContain('"criteria"');
      expect(prompt).toContain('"actionItems"');
      expect(prompt).toContain('"summary"');
    });

    it('judge prompt contains few-shot examples (1 PASS, 2 FAIL)', () => {
      const prompt = getSystemPrompt('judge');
      const passCount = (prompt.match(/"verdict":\s*"PASS"/g) || []).length;
      const failCount = (prompt.match(/"verdict":\s*"FAIL"/g) || []).length;
      expect(passCount).toBeGreaterThanOrEqual(1);
      expect(failCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('safety', () => {
    for (const role of ROLES) {
      it(`${role} prompt does not contain mutation tool names`, () => {
        const prompt = getSystemPrompt(role);
        const mutationTools = ['figma_set_fills', 'figma_create_child', 'figma_delete', 'figma_render_jsx'];
        for (const tool of mutationTools) {
          expect(prompt).not.toContain(tool);
        }
      });
    }

    for (const role of ROLES) {
      it(`${role} prompt returns a non-empty string`, () => {
        const prompt = getSystemPrompt(role);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
      });
    }
  });

  describe('micro-judge prompts — balanced calibration', () => {
    it('system prompt instructs objective evaluation', () => {
      const prompt = getMicroJudgeSystemPrompt();
      expect(prompt).toContain('Evaluate OBJECTIVELY');
      expect(prompt).toContain('clearly shows a violation');
    });

    const CRITERIA_WITH_EXPLICIT_CONDITIONS: MicroJudgeId[] = [
      'alignment',
      'token_compliance',
      'completeness',
      'consistency',
      'componentization',
      'visual_hierarchy',
      'naming',
    ];

    for (const id of CRITERIA_WITH_EXPLICIT_CONDITIONS) {
      it(`${id} criterion prompt contains explicit PASS and FAIL conditions`, () => {
        const prompt = getMicroJudgeCriterionPrompt(id);
        expect(prompt).toContain('PASS if');
        expect(prompt).toContain('FAIL');
      });
    }

    it('token_compliance criterion explains that missing token system = PASS', () => {
      const prompt = getMicroJudgeCriterionPrompt('token_compliance' as MicroJudgeId);
      expect(prompt).toContain('no design system section is provided');
      expect(prompt).toContain('no variables/tokens defined');
    });

    it('completeness criterion judges against explicit request, not ideal design', () => {
      const prompt = getMicroJudgeCriterionPrompt('completeness' as MicroJudgeId);
      expect(prompt).toContain('EXPLICITLY requested');
      expect(prompt).not.toContain('absent states');
    });

    it('componentization criterion dismisses LOW-confidence findings', () => {
      const prompt = getMicroJudgeCriterionPrompt('componentization' as MicroJudgeId);
      expect(prompt).toContain('Dismiss LOW-confidence');
      expect(prompt).toContain('HIGH-confidence');
    });
  });
});
