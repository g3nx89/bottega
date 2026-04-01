import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from '../../../../src/main/subagent/system-prompts.js';
import type { SubagentRole } from '../../../../src/main/subagent/types.js';

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

    it('judge prompt contains anti-leniency language', () => {
      const prompt = getSystemPrompt('judge');
      expect(prompt).toContain('demanding design critic');
      expect(prompt).toContain('borderline');
      expect(prompt).toContain('FAIL');
      expect(prompt).toContain('Do not justify defects');
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
});
