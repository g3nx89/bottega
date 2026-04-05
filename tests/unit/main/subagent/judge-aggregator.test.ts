import { describe, expect, it } from 'vitest';
import { aggregateVerdicts } from '../../../../src/main/subagent/judge-aggregator.js';
import type { JudgeVerdict, MicroJudgeId, MicroVerdict } from '../../../../src/main/subagent/types.js';

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

const ALL_JUDGES: MicroJudgeId[] = [
  'alignment',
  'token_compliance',
  'visual_hierarchy',
  'completeness',
  'consistency',
  'naming',
  'componentization',
];

// ── Tests ────────────────────────────────────────────────────────────

describe('aggregateVerdicts', () => {
  it('returns PASS when all evaluated criteria pass', () => {
    const verdicts = ALL_JUDGES.map((id) => makeVerdict({ judgeId: id }));

    const result = aggregateVerdicts(verdicts, ALL_JUDGES);

    expect(result.verdict).toBe('PASS');
    expect(result.criteria).toHaveLength(ALL_JUDGES.length);
    expect(result.criteria.every((c) => c.pass)).toBe(true);
    expect(result.actionItems).toEqual([]);
    expect(result.summary).toContain('PASS');
  });

  it('returns FAIL when any evaluated criterion fails', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({ judgeId: 'alignment', pass: false, finding: 'Misaligned button', actionItems: ['Fix button'] }),
      makeVerdict({ judgeId: 'naming' }),
    ];

    const result = aggregateVerdicts(verdicts, ['alignment', 'naming']);

    expect(result.verdict).toBe('FAIL');
    expect(result.summary).toContain('FAIL');
    expect(result.summary).toContain('alignment');
  });

  it('does NOT cause FAIL for timeout criteria (marked as skipped)', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({ judgeId: 'alignment' }),
      makeVerdict({ judgeId: 'naming', status: 'timeout', pass: false }),
    ];

    const result = aggregateVerdicts(verdicts, ['alignment', 'naming']);

    expect(result.verdict).toBe('PASS');
    const timeoutCriterion = result.criteria.find((c) => c.name === 'naming')!;
    expect(timeoutCriterion.pass).toBe(true);
    expect(timeoutCriterion.finding).toContain('skipped');
    expect(timeoutCriterion.finding).toContain('timeout');
  });

  it('does NOT cause FAIL for error criteria (marked as skipped)', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({ judgeId: 'alignment' }),
      makeVerdict({
        judgeId: 'consistency',
        status: 'error',
        pass: false,
        finding: 'Connection reset',
        evidence: 'stack trace',
      }),
    ];

    const result = aggregateVerdicts(verdicts, ['alignment', 'consistency']);

    expect(result.verdict).toBe('PASS');
    const errorCriterion = result.criteria.find((c) => c.name === 'consistency')!;
    expect(errorCriterion.pass).toBe(true);
    expect(errorCriterion.finding).toContain('skipped');
    expect(errorCriterion.finding).toContain('error');
    expect(errorCriterion.finding).toContain('Connection reset');
    expect(errorCriterion.evidence).toBe('stack trace');
  });

  it('creates placeholder entries for missing judges', () => {
    const verdicts: MicroVerdict[] = [makeVerdict({ judgeId: 'alignment' })];

    const result = aggregateVerdicts(verdicts, ['alignment', 'naming', 'completeness']);

    expect(result.verdict).toBe('PASS');
    expect(result.criteria).toHaveLength(3);

    const missing = result.criteria.find((c) => c.name === 'naming')!;
    expect(missing.pass).toBe(true);
    expect(missing.finding).toContain('skipped');
    expect(missing.finding).toContain('not returned');
    expect(missing.evidence).toBe('');

    const missing2 = result.criteria.find((c) => c.name === 'completeness')!;
    expect(missing2.pass).toBe(true);
  });

  it('concatenates actionItems from all failed judges', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({
        judgeId: 'alignment',
        pass: false,
        finding: 'Bad alignment',
        actionItems: ['Fix padding', 'Check margins'],
      }),
      makeVerdict({
        judgeId: 'naming',
        pass: false,
        finding: 'Bad names',
        actionItems: ['Rename frame'],
      }),
      makeVerdict({ judgeId: 'completeness' }), // passes — no action items
    ];

    const result = aggregateVerdicts(verdicts, ['alignment', 'naming', 'completeness']);

    expect(result.verdict).toBe('FAIL');
    expect(result.actionItems).toEqual(['Fix padding', 'Check margins', 'Rename frame']);
  });

  it('summary includes failed criteria names and count', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({ judgeId: 'alignment', pass: false, finding: 'Bad', actionItems: ['A'] }),
      makeVerdict({ judgeId: 'naming', pass: false, finding: 'Bad', actionItems: ['B'] }),
      makeVerdict({ judgeId: 'completeness' }),
    ];

    const result = aggregateVerdicts(verdicts, ['alignment', 'naming', 'completeness']);

    expect(result.summary).toContain('FAIL');
    expect(result.summary).toContain('2/3');
    expect(result.summary).toContain('alignment');
    expect(result.summary).toContain('naming');
    expect(result.summary).toContain('2 action items');
  });

  it('returns output matching the JudgeVerdict interface', () => {
    const verdicts: MicroVerdict[] = [makeVerdict({ judgeId: 'alignment' })];

    const result: JudgeVerdict = aggregateVerdicts(verdicts, ['alignment']);

    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('criteria');
    expect(result).toHaveProperty('actionItems');
    expect(result).toHaveProperty('summary');

    expect(typeof result.verdict).toBe('string');
    expect(Array.isArray(result.criteria)).toBe(true);
    expect(Array.isArray(result.actionItems)).toBe(true);
    expect(typeof result.summary).toBe('string');

    // Each criterion matches JudgeCriterion shape
    for (const c of result.criteria) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('pass');
      expect(c).toHaveProperty('finding');
      expect(c).toHaveProperty('evidence');
    }
  });

  it('handles singular action item phrasing in summary', () => {
    const verdicts: MicroVerdict[] = [
      makeVerdict({ judgeId: 'alignment', pass: false, finding: 'Bad', actionItems: ['Fix it'] }),
    ];

    const result = aggregateVerdicts(verdicts, ['alignment']);

    expect(result.summary).toContain('1 action item.');
    expect(result.summary).not.toContain('1 action items');
  });
});
