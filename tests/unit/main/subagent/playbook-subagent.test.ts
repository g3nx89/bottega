/**
 * 10l. Playbook tests — subagent scenarios with scripted LLM responses.
 *
 * Uses the existing playbook harness (tests/helpers/) to test subagent scenarios
 * with deterministic scripted responses instead of real LLM calls.
 *
 * These tests verify the read-only tool filtering and tool result shapes
 * used by subagents, using the existing playbook infrastructure.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { CATEGORY_MAP } from '../../../../src/main/compression/metrics.js';
import { aggregateResults } from '../../../../src/main/subagent/orchestrator.js';
import { READ_ONLY_TOOL_NAMES } from '../../../../src/main/subagent/read-only-tools.js';
import { getSystemPrompt } from '../../../../src/main/subagent/system-prompts.js';
import type { JudgeVerdict, SubagentResult } from '../../../../src/main/subagent/types.js';

describe('Playbook: Subagent Scenarios', () => {
  describe('Scout playbook', () => {
    it('scout uses only read-only tools for file structure scan', () => {
      // Scripted scenario: scout calls get_file_data + search_components
      const scoutTools = ['figma_get_file_data', 'figma_search_components', 'figma_design_system'];
      for (const tool of scoutTools) {
        expect(READ_ONLY_TOOL_NAMES.has(tool)).toBe(true);
      }
    });

    it('scout system prompt directs structured output', () => {
      const prompt = getSystemPrompt('scout');
      expect(prompt).toContain('Structure');
      expect(prompt).toContain('Components');
      expect(prompt).toContain('Design System');
      expect(prompt).toContain('Layout');
      expect(prompt).toContain('Notable');
    });
  });

  describe('Auditor playbook', () => {
    it('auditor uses lint + design_system for compliance report', () => {
      const auditorTools = ['figma_lint', 'figma_design_system', 'figma_screenshot'];
      for (const tool of auditorTools) {
        expect(READ_ONLY_TOOL_NAMES.has(tool)).toBe(true);
      }
    });

    it('auditor cannot access mutation tools', () => {
      const mutationTools = Object.entries(CATEGORY_MAP)
        .filter(([, cat]) => cat === 'mutation')
        .map(([name]) => name);
      for (const tool of mutationTools) {
        expect(READ_ONLY_TOOL_NAMES.has(tool)).toBe(false);
      }
    });
  });

  describe('Judge PASS playbook', () => {
    it('judge PASS verdict aggregates correctly', () => {
      const passVerdict: JudgeVerdict = {
        verdict: 'PASS',
        criteria: [
          { name: 'alignment', pass: true, finding: 'All aligned', evidence: 'auto-layout verified' },
          { name: 'token_compliance', pass: true, finding: 'All tokens', evidence: 'lint clean' },
          { name: 'visual_hierarchy', pass: true, finding: 'Clear hierarchy', evidence: 'H1>H2>body' },
          { name: 'completeness', pass: true, finding: 'All present', evidence: 'all 4 cards found' },
          { name: 'consistency', pass: true, finding: 'Uniform styling', evidence: '16px padding throughout' },
        ],
        actionItems: [],
        summary: 'All 5 criteria pass. Design is production-ready.',
      };

      const results: SubagentResult[] = [
        {
          role: 'judge',
          subagentId: 'j1',
          status: 'completed',
          output: JSON.stringify(passVerdict),
          verdict: passVerdict,
          durationMs: 8000,
        },
      ];

      const agg = aggregateResults(results);
      expect(agg.summary.completed).toBe(1);
      expect(agg.results[0].verdict?.verdict).toBe('PASS');
      expect(agg.results[0].verdict?.actionItems).toHaveLength(0);
    });
  });

  describe('Judge FAIL playbook', () => {
    it('judge FAIL verdict with action items aggregates correctly', () => {
      const failVerdict: JudgeVerdict = {
        verdict: 'FAIL',
        criteria: [
          { name: 'alignment', pass: true, finding: 'OK', evidence: 'verified' },
          {
            name: 'token_compliance',
            pass: false,
            finding: '2 hardcoded hex',
            evidence: 'CTA=#A259FF, Divider=#E5E5E5',
          },
          { name: 'visual_hierarchy', pass: true, finding: 'OK', evidence: 'verified' },
          { name: 'completeness', pass: true, finding: 'OK', evidence: 'verified' },
          {
            name: 'consistency',
            pass: false,
            finding: 'Inconsistent padding',
            evidence: 'Primary=12/24, Secondary=8/16',
          },
        ],
        actionItems: [
          'Fix CTA fill: #A259FF → --color-primary',
          'Fix Divider stroke: #E5E5E5 → --color-border',
          'Standardize button padding to 12px 24px',
        ],
        summary: 'FAIL: 2 criteria failed.',
      };

      const results: SubagentResult[] = [
        {
          role: 'judge',
          subagentId: 'j1',
          status: 'completed',
          output: JSON.stringify(failVerdict),
          verdict: failVerdict,
          durationMs: 10000,
        },
      ];

      const agg = aggregateResults(results);
      expect(agg.results[0].verdict?.verdict).toBe('FAIL');
      expect(agg.results[0].verdict?.actionItems).toHaveLength(3);
      expect(agg.results[0].verdict?.criteria.filter((c) => !c.pass)).toHaveLength(2);
    });
  });

  describe('Multi-agent batch playbook', () => {
    it('2 agents with interleaved results both collected', () => {
      const results: SubagentResult[] = [
        {
          role: 'scout',
          subagentId: 's1',
          status: 'completed',
          output: 'Found 10 components, 3 pages',
          durationMs: 3000,
        },
        {
          role: 'auditor',
          subagentId: 's2',
          status: 'completed',
          output: '85% token compliance, 3 violations',
          durationMs: 5000,
        },
      ];

      const agg = aggregateResults(results);
      expect(agg.results).toHaveLength(2);
      expect(agg.summary.completed).toBe(2);
      // No merging — both outputs preserved independently
      expect(agg.results[0].output).toContain('10 components');
      expect(agg.results[1].output).toContain('85% token compliance');
    });

    it('mixed status batch (completed + error) correctly aggregated', () => {
      const results: SubagentResult[] = [
        { role: 'scout', subagentId: 's1', status: 'completed', output: 'Done', durationMs: 2000 },
        { role: 'analyst', subagentId: 's2', status: 'error', error: 'Auth failed', durationMs: 500 },
        { role: 'auditor', subagentId: 's3', status: 'aborted', durationMs: 100 },
      ];

      const agg = aggregateResults(results);
      expect(agg.summary.total).toBe(3);
      expect(agg.summary.completed).toBe(1);
      expect(agg.summary.errors).toBe(1);
      expect(agg.summary.aborted).toBe(1);
    });
  });

  describe('Pre-fetch deduplication', () => {
    it('pre-fetch tools are a subset of read-only tools', () => {
      const prefetchTools = ['figma_screenshot', 'figma_get_file_data', 'figma_design_system'];
      for (const tool of prefetchTools) {
        expect(READ_ONLY_TOOL_NAMES.has(tool)).toBe(true);
      }
    });
  });
});
