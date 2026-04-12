import { describe, expect, it } from 'vitest';
import {
  ALL_MICRO_JUDGE_IDS,
  getActiveJudges,
  getDataNeedsForJudges,
  getJudgeDefinition,
} from '../../../../src/main/subagent/judge-registry.js';

describe('judge-registry', () => {
  describe('ALL_MICRO_JUDGE_IDS', () => {
    it('has 8 entries', () => {
      expect(ALL_MICRO_JUDGE_IDS).toHaveLength(8);
    });
  });

  describe('getJudgeDefinition', () => {
    it('returns a valid definition for alignment', () => {
      const def = getJudgeDefinition('alignment');
      expect(def.id).toBe('alignment');
      expect(def.label).toBe('Alignment');
      expect(def.tiers).toBeInstanceOf(Set);
      expect(def.dataNeeds).toBeInstanceOf(Array);
    });

    it('all judges have a valid defaultThinking level', () => {
      for (const id of ALL_MICRO_JUDGE_IDS) {
        const def = getJudgeDefinition(id);
        expect(['low', 'medium']).toContain(def.defaultThinking);
      }
    });

    it('reasoning-heavy judges use sonnet + medium thinking', () => {
      for (const id of ['alignment', 'visual_hierarchy', 'completeness', 'consistency', 'design_quality'] as const) {
        const def = getJudgeDefinition(id);
        expect(def.defaultModel).toBe('claude-sonnet-4-6');
        expect(def.defaultThinking).toBe('medium');
      }
    });

    it('pattern-matching judges use haiku + low thinking', () => {
      for (const id of ['token_compliance', 'naming', 'componentization'] as const) {
        const def = getJudgeDefinition(id);
        expect(def.defaultModel).toBe('claude-haiku-4-5');
        expect(def.defaultThinking).toBe('low');
      }
    });

    it('throws for unknown judge ID', () => {
      expect(() => getJudgeDefinition('unknown' as any)).toThrow('Unknown micro-judge: unknown');
    });
  });

  describe('getActiveJudges', () => {
    it('full tier with structural tool returns all 8', () => {
      const judges = getActiveJudges('full', ['figma_create_child']);
      expect(judges).toHaveLength(8);
    });

    it('visual tier returns 5 judges', () => {
      const judges = getActiveJudges('visual', ['figma_set_fills']);
      expect(judges).toHaveLength(5);
      expect(judges).toContain('alignment');
      expect(judges).toContain('token_compliance');
      expect(judges).toContain('visual_hierarchy');
      expect(judges).toContain('consistency');
      expect(judges).toContain('design_quality');
    });

    it('narrow tier with rename-only returns naming only (token_compliance filtered by triggerCategories)', () => {
      const judges = getActiveJudges('narrow', ['figma_rename'], undefined, new Set(['mutation']));
      expect(judges).toHaveLength(1);
      expect(judges).toContain('naming');
      expect(judges).not.toContain('token_compliance');
    });

    it('narrow tier with ds tool returns token_compliance', () => {
      const judges = getActiveJudges('narrow', ['figma_setup_tokens'], undefined, new Set(['ds']));
      expect(judges).toContain('token_compliance');
    });

    it('excludes disabled judges', () => {
      const judges = getActiveJudges('full', ['figma_create_child'], new Set(['naming'] as any));
      expect(judges).toHaveLength(7);
      expect(judges).not.toContain('naming');
    });
  });

  describe('getDataNeedsForJudges', () => {
    it('unions fileData + lint + designSystem for alignment + token_compliance (no screenshot)', () => {
      const needs = getDataNeedsForJudges(['alignment', 'token_compliance']);
      expect(needs).toContain('fileData');
      expect(needs).toContain('lint');
      expect(needs).toContain('designSystem');
      expect(needs).not.toContain('screenshot');
    });

    it('includes libraryComponents for componentization', () => {
      const needs = getDataNeedsForJudges(['componentization']);
      expect(needs).toContain('libraryComponents');
    });
  });
});
