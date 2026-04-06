/**
 * Tests for extractNodeIds and buildRetryPrompt — enriched retry prompt construction.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/subagent/orchestrator.js', () => ({
  runSubagentBatch: vi.fn(),
  runMicroJudgeBatch: vi.fn(),
}));

vi.mock('../../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn(() => []),
}));

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn(),
  formatBriefing: vi.fn(() => ''),
  prefetchForMicroJudges: vi.fn().mockResolvedValue({
    screenshot: null,
    fileData: null,
    designSystem: null,
    lint: null,
    libraryComponents: null,
    componentAnalysis: null,
  }),
}));

import { buildRetryPrompt, extractNodeIds, JUDGE_RETRY_MARKER } from '../../../../src/main/subagent/judge-harness.js';
import type { MicroVerdict } from '../../../../src/main/subagent/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeVerdict(overrides: Partial<MicroVerdict> & Pick<MicroVerdict, 'judgeId'>): MicroVerdict {
  return {
    pass: true,
    finding: 'Looks good',
    evidence: 'screenshot',
    actionItems: [],
    status: 'evaluated',
    durationMs: 100,
    ...overrides,
  };
}

// ── extractNodeIds ───────────────────────────────────────────────────

describe('extractNodeIds', () => {
  it('extracts "nodeId:128:445" format', () => {
    expect(extractNodeIds('nodeId:128:445')).toEqual(['128:445']);
  });

  it('extracts "id: 128:445" format with space after colon', () => {
    expect(extractNodeIds('id: 128:445 and id:200:10')).toEqual(['128:445', '200:10']);
  });

  it('extracts parenthesized format "(128:445)"', () => {
    expect(extractNodeIds('Node (128:445) has bad fill')).toEqual(['128:445']);
  });

  it('returns empty array for empty string', () => {
    expect(extractNodeIds('')).toEqual([]);
  });

  it('returns empty array when no node IDs present', () => {
    expect(extractNodeIds('The alignment is off by 4px on the left side')).toEqual([]);
  });

  it('deduplicates node IDs found by multiple patterns', () => {
    // nodeId:128:445 matches first pattern, (128:445) matches third pattern — same ID
    const result = extractNodeIds('nodeId:128:445 is also referenced as (128:445)');
    expect(result).toEqual(['128:445']);
  });

  it('extracts multiple unique IDs from mixed formats', () => {
    const result = extractNodeIds('nodeId:10:20, id: 30:40, (50:60)');
    expect(result).toEqual(['10:20', '30:40', '50:60']);
  });
});

// ── buildRetryPrompt ─────────────────────────────────────────────────

describe('buildRetryPrompt', () => {
  it('returns minor-issues message when all verdicts pass', () => {
    const verdicts: MicroVerdict[] = [makeVerdict({ judgeId: 'alignment' }), makeVerdict({ judgeId: 'naming' })];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt).toContain(JUDGE_RETRY_MARKER);
    expect(prompt).toContain('minor issues');
    expect(prompt).toContain('Take a screenshot');
  });

  it('includes node IDs and tool hint for single fail with evidence containing nodeId', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'alignment',
        pass: false,
        finding: 'Button misaligned',
        evidence: 'nodeId:128:445 is 4px off',
        actionItems: ['Fix button alignment'],
      }),
      makeVerdict({ judgeId: 'naming' }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt).toContain(JUDGE_RETRY_MARKER);
    expect(prompt).toContain('128:445');
    expect(prompt).toContain('figma_move');
    expect(prompt).toContain('Fix button alignment');
  });

  it('produces numbered list for multiple fails', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'alignment',
        pass: false,
        finding: 'Bad alignment',
        evidence: '',
        actionItems: ['Fix padding'],
      }),
      makeVerdict({
        judgeId: 'naming',
        pass: false,
        finding: 'Bad names',
        evidence: '',
        actionItems: ['Rename frame'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt).toContain('1.');
    expect(prompt).toContain('2.');
    expect(prompt).toContain('[alignment]');
    expect(prompt).toContain('[naming]');
  });

  it('starts with JUDGE_RETRY_MARKER', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'completeness',
        pass: false,
        finding: 'Missing element',
        evidence: '',
        actionItems: ['Add header'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt.startsWith(JUDGE_RETRY_MARKER)).toBe(true);
  });

  it('includes "Do NOT re-screenshot" instruction', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'consistency',
        pass: false,
        finding: 'Inconsistent colors',
        evidence: '',
        actionItems: ['Unify fills'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt).toContain('Do NOT re-screenshot');
  });

  it('skips non-evaluated verdicts (timeout/error)', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'alignment',
        status: 'timeout',
        pass: false,
        actionItems: ['Should be ignored'],
      }),
      makeVerdict({
        judgeId: 'naming',
        status: 'error',
        pass: false,
        actionItems: ['Also ignored'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    // All non-evaluated, so no specific action items — minor issues message
    expect(prompt).toContain('minor issues');
  });

  it('includes correct tool hint per criterion', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'token_compliance',
        pass: false,
        finding: 'Missing tokens',
        evidence: '',
        actionItems: ['Bind color token'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    expect(prompt).toContain('figma_bind_variable');
  });

  it('handles fails with multiple action items', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'visual_hierarchy',
        pass: false,
        finding: 'Hierarchy issues',
        evidence: 'nodeId:10:20',
        actionItems: ['Increase heading size', 'Reduce body weight'],
      }),
    ];

    const prompt = buildRetryPrompt(verdicts);

    // Each action item becomes a separate numbered entry
    expect(prompt).toContain('1.');
    expect(prompt).toContain('2.');
    expect(prompt).toContain('Increase heading size');
    expect(prompt).toContain('Reduce body weight');
    // Both should reference the same node IDs from the verdict's evidence
    expect(prompt).toContain('10:20');
  });
});
