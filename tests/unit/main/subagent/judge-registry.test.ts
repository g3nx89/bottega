import { describe, expect, it } from 'vitest';
import {
  ALL_MICRO_JUDGE_IDS,
  getActiveJudges,
  getDataNeedsForJudges,
  getJudgeDefinition,
} from '../../../../src/main/subagent/judge-registry.js';

describe('judge-registry', () => {
  describe('ALL_MICRO_JUDGE_IDS', () => {
    it('has 7 entries', () => {
      expect(ALL_MICRO_JUDGE_IDS).toHaveLength(7);
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

    it('throws for unknown judge ID', () => {
      expect(() => getJudgeDefinition('unknown' as any)).toThrow('Unknown micro-judge: unknown');
    });
  });

  describe('getActiveJudges', () => {
    it('full tier with structural tool returns all 7', () => {
      const judges = getActiveJudges('full', ['figma_create_child']);
      expect(judges).toHaveLength(7);
    });

    it('visual tier returns 4 judges', () => {
      const judges = getActiveJudges('visual', ['figma_set_fills']);
      expect(judges).toHaveLength(4);
      expect(judges).toContain('alignment');
      expect(judges).toContain('token_compliance');
      expect(judges).toContain('visual_hierarchy');
      expect(judges).toContain('consistency');
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
      expect(judges).toHaveLength(6);
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
