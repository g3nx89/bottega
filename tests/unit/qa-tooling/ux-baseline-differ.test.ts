// Fase 3b — UX differ tests.
// Covers: OK path, overall/script/dimension drops, new/fixed/escalated
// issues, baseline missing/schema mismatch, stable ID computation.

import { describe, expect, it } from 'vitest';

import { computeUXIssueId, diffUXReview } from '../../../tests/helpers/ux-baseline/differ.js';
import {
  CURRENT_UX_REVIEW_SCHEMA_VERSION,
  DEFAULT_UX_DIFF_RULES,
  type UXIssue,
  type UXReview,
} from '../../../tests/helpers/ux-baseline/schema.js';

function mkReview(overrides: Partial<UXReview> = {}): UXReview {
  return {
    schemaVersion: CURRENT_UX_REVIEW_SCHEMA_VERSION,
    runId: overrides.runId ?? 'run-x',
    timestamp: overrides.timestamp ?? '2026-04-09T10:00:00.000Z',
    appVersion: overrides.appVersion ?? '0.18.0',
    overallScore: overrides.overallScore ?? 4.0,
    scriptScores: overrides.scriptScores ?? {
      '02-happy-path': {
        script: '02-happy-path',
        score: 4.0,
        stepCount: 5,
        issueCount: 0,
        dimensionScores: {
          visualQuality: 4.0,
          responseClarity: 4.0,
          toolSelection: 4.0,
          uxCoherence: 4.0,
          feedbackQuality: 4.0,
        },
      },
    },
    issues: overrides.issues ?? [],
  };
}

function mkIssue(overrides: Partial<UXIssue> = {}): UXIssue {
  return {
    id: overrides.id ?? 'UX-11111111',
    severity: overrides.severity ?? 'media',
    script: overrides.script ?? '02-happy-path',
    step: overrides.step ?? '1',
    description: overrides.description ?? 'placeholder',
    category: overrides.category ?? 'response_quality',
  };
}

describe('diffUXReview — trivial cases', () => {
  it('returns BASELINE_MISSING when baseline is null', () => {
    const r = diffUXReview({ baseline: null, current: mkReview() });
    expect(r.verdict).toBe('BASELINE_MISSING');
  });

  it('returns SCHEMA_MISMATCH on version mismatch', () => {
    const baseline = { ...mkReview(), schemaVersion: 999 as unknown as 1 };
    const r = diffUXReview({ baseline, current: mkReview() });
    expect(r.verdict).toBe('SCHEMA_MISMATCH');
  });

  it('returns OK when current matches baseline exactly', () => {
    const baseline = mkReview();
    const current = mkReview();
    const r = diffUXReview({ baseline, current });
    expect(r.verdict).toBe('OK');
    expect(r.findings).toHaveLength(0);
    expect(r.overallDelta).toBe(0);
  });
});

describe('diffUXReview — overall score drop', () => {
  it('flags regression when overall drops by > 0.3', () => {
    const baseline = mkReview({ overallScore: 4.5 });
    const current = mkReview({ overallScore: 4.1 });
    const r = diffUXReview({ baseline, current });
    expect(r.verdict).toBe('DRIFT');
    expect(r.overallDelta).toBe(-0.4);
    const f = r.findings.find((f) => f.category === 'overall_score_drop');
    expect(f).toBeDefined();
  });

  it('no finding when drop is within tolerance', () => {
    const baseline = mkReview({ overallScore: 4.5 });
    const current = mkReview({ overallScore: 4.25 });
    const r = diffUXReview({ baseline, current });
    expect(r.findings.find((f) => f.category === 'overall_score_drop')).toBeUndefined();
  });

  it('no finding on positive delta (improvement)', () => {
    const baseline = mkReview({ overallScore: 3.5 });
    const current = mkReview({ overallScore: 4.5 });
    const r = diffUXReview({ baseline, current });
    expect(r.findings.find((f) => f.category === 'overall_score_drop')).toBeUndefined();
    expect(r.overallDelta).toBeCloseTo(1.0, 2);
  });
});

describe('diffUXReview — per-script drops', () => {
  it('flags script_score_drop beyond 0.5 threshold', () => {
    const baseline = mkReview({
      scriptScores: {
        '02-happy-path': {
          script: '02-happy-path',
          score: 4.5,
          stepCount: 5,
          issueCount: 0,
          dimensionScores: {
            visualQuality: 4.5,
            responseClarity: 4.5,
            toolSelection: 4.5,
            uxCoherence: 4.5,
            feedbackQuality: 4.5,
          },
        },
      },
    });
    const current = mkReview({
      scriptScores: {
        '02-happy-path': {
          script: '02-happy-path',
          score: 3.8,
          stepCount: 5,
          issueCount: 1,
          dimensionScores: {
            visualQuality: 3.8,
            responseClarity: 3.8,
            toolSelection: 3.8,
            uxCoherence: 3.8,
            feedbackQuality: 3.8,
          },
        },
      },
    });
    const r = diffUXReview({ baseline, current });
    expect(r.verdict).toBe('DRIFT');
    const script = r.findings.find((f) => f.category === 'script_score_drop');
    expect(script?.script).toBe('02-happy-path');
  });

  it('flags dimension_score_drop per dimension', () => {
    const baseline = mkReview({
      scriptScores: {
        '02-happy-path': {
          script: '02-happy-path',
          score: 4.0,
          stepCount: 5,
          issueCount: 0,
          dimensionScores: {
            visualQuality: 4.5,
            responseClarity: 4.0,
            toolSelection: 4.0,
            uxCoherence: 4.0,
            feedbackQuality: 4.0,
          },
        },
      },
    });
    // Only visualQuality drops; other dimensions stay.
    const current = mkReview({
      scriptScores: {
        '02-happy-path': {
          script: '02-happy-path',
          score: 3.9,
          stepCount: 5,
          issueCount: 0,
          dimensionScores: {
            visualQuality: 3.8, // drop of 0.7 > threshold 0.5
            responseClarity: 4.0,
            toolSelection: 4.0,
            uxCoherence: 4.0,
            feedbackQuality: 4.0,
          },
        },
      },
    });
    const r = diffUXReview({ baseline, current });
    const dim = r.findings.find((f) => f.category === 'dimension_score_drop');
    expect(dim).toBeDefined();
    expect(dim?.script).toBe('02-happy-path');
    expect(dim?.dimension).toBe('visualQuality');
  });
});

describe('diffUXReview — issue diff', () => {
  it('reports new issues', () => {
    const baseline = mkReview();
    const current = mkReview({
      issues: [mkIssue({ id: 'UX-aaaaaaaa', severity: 'media' })],
    });
    const r = diffUXReview({ baseline, current });
    expect(r.summary.newIssues).toBe(1);
    // New media issue alone doesn't trip the verdict.
    expect(r.verdict).toBe('OK');
  });

  it('new alta issue trips verdict to DRIFT', () => {
    const baseline = mkReview();
    const current = mkReview({
      issues: [mkIssue({ id: 'UX-aaaaaaaa', severity: 'alta' })],
    });
    const r = diffUXReview({ baseline, current });
    expect(r.verdict).toBe('DRIFT');
    expect(r.summary.regressionCount).toBeGreaterThan(0);
  });

  it('reports fixed issues', () => {
    const baseline = mkReview({
      issues: [mkIssue({ id: 'UX-bbbbbbbb', severity: 'media' })],
    });
    const current = mkReview({ issues: [] });
    const r = diffUXReview({ baseline, current });
    expect(r.summary.fixedIssues).toBe(1);
    expect(r.verdict).toBe('OK'); // fixing is not a regression
  });

  it('reports severity escalation as regression', () => {
    const baseline = mkReview({
      issues: [mkIssue({ id: 'UX-cccccccc', severity: 'bassa' })],
    });
    const current = mkReview({
      issues: [mkIssue({ id: 'UX-cccccccc', severity: 'alta' })],
    });
    const r = diffUXReview({ baseline, current });
    expect(r.summary.changedSeverity).toBe(1);
    expect(r.verdict).toBe('DRIFT');
  });

  it('does NOT regress on severity de-escalation', () => {
    const baseline = mkReview({
      issues: [mkIssue({ id: 'UX-cccccccc', severity: 'alta' })],
    });
    const current = mkReview({
      issues: [mkIssue({ id: 'UX-cccccccc', severity: 'bassa' })],
    });
    const r = diffUXReview({ baseline, current });
    expect(r.summary.changedSeverity).toBe(1);
    // Severity went down → not a regression
    expect(r.verdict).toBe('OK');
  });
});

describe('diffUXReview — rules override', () => {
  it('stricter thresholds catch smaller drops', () => {
    const baseline = mkReview({ overallScore: 4.5 });
    const current = mkReview({ overallScore: 4.35 }); // 0.15 drop
    // Default 0.3: no finding.
    const defaultRun = diffUXReview({ baseline, current });
    expect(defaultRun.findings.find((f) => f.category === 'overall_score_drop')).toBeUndefined();
    // Strict 0.1: finding.
    const strictRun = diffUXReview({
      baseline,
      current,
      rulesOverride: { ...DEFAULT_UX_DIFF_RULES, regressionOverall: 0.1 },
    });
    expect(strictRun.findings.find((f) => f.category === 'overall_score_drop')).toBeDefined();
  });
});

describe('computeUXIssueId', () => {
  it('produces UX-<8 hex chars>', () => {
    const id = computeUXIssueId('02-happy-path', '1. Send a prompt', 'Response too verbose');
    expect(id).toMatch(/^UX-[0-9a-f]{8}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = computeUXIssueId('s', 'st', 'd');
    const b = computeUXIssueId('s', 'st', 'd');
    expect(a).toBe(b);
  });

  it('differs when inputs differ', () => {
    const a = computeUXIssueId('s', 'st', 'd');
    const b = computeUXIssueId('s', 'st', 'different');
    expect(a).not.toBe(b);
  });

  it('is case-insensitive in description (trim + lowercase)', () => {
    const a = computeUXIssueId('s', 'st', 'Hello World');
    const b = computeUXIssueId('s', 'st', '  hello world  ');
    expect(a).toBe(b);
  });
});
