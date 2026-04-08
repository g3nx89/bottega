// Fase 3b — UX baseline schema roundtrip tests.
// Verifies that TypeBox accepts canonical UXReview/UXBaseline examples
// and rejects the most common malformations.

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  CURRENT_UX_REVIEW_SCHEMA_VERSION,
  DEFAULT_UX_DIFF_RULES,
  UXBaseline,
  UXIssue,
  UXReview,
  type UXReview as UXReviewT,
} from '../../../tests/helpers/ux-baseline/schema.js';

function sampleReview(): UXReviewT {
  return {
    schemaVersion: CURRENT_UX_REVIEW_SCHEMA_VERSION,
    runId: 'run-2026-04-09-001',
    timestamp: '2026-04-09T10:00:00.000Z',
    appVersion: '0.18.0',
    overallScore: 4.2,
    scriptScores: {
      '02-happy-path': {
        script: '02-happy-path',
        score: 4.4,
        stepCount: 6,
        issueCount: 1,
        dimensionScores: {
          visualQuality: 4.5,
          responseClarity: 4.0,
          toolSelection: 5.0,
          uxCoherence: 4.0,
          feedbackQuality: 4.0,
        },
      },
    },
    issues: [
      {
        id: 'UX-a1b2c3d4',
        severity: 'media',
        script: '02-happy-path',
        step: '4. Send a creation prompt',
        description: 'Response is slightly verbose',
        category: 'response_quality',
      },
    ],
  };
}

describe('UXReview schema', () => {
  it('accepts a fully populated valid review', () => {
    expect(Value.Check(UXReview, sampleReview())).toBe(true);
  });

  it('UXBaseline accepts the same shape (alias of UXReview)', () => {
    expect(Value.Check(UXBaseline, sampleReview())).toBe(true);
  });

  it('rejects unknown schemaVersion', () => {
    const r = sampleReview() as unknown as { schemaVersion: number };
    r.schemaVersion = 99;
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('rejects unknown severity enum', () => {
    const r = sampleReview();
    (r.issues[0] as unknown as { severity: string }).severity = 'critical';
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('rejects unknown category enum', () => {
    const r = sampleReview();
    (r.issues[0] as unknown as { category: string }).category = 'ergonomics';
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('rejects malformed UX issue id (wrong prefix or length)', () => {
    const r = sampleReview();
    r.issues[0].id = 'BUG-12345678';
    expect(Value.Check(UXReview, r)).toBe(false);

    r.issues[0].id = 'UX-XYZ'; // too short + non-hex
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('rejects dimension score out of 1-5 range', () => {
    const r = sampleReview();
    r.scriptScores['02-happy-path'].dimensionScores.visualQuality = 6;
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('rejects overallScore out of 1-5 range', () => {
    const r = sampleReview();
    r.overallScore = 0.5;
    expect(Value.Check(UXReview, r)).toBe(false);
  });

  it('accepts multiple scripts in scriptScores', () => {
    const r = sampleReview();
    r.scriptScores['14-judge'] = {
      ...r.scriptScores['02-happy-path'],
      script: '14-judge',
    };
    expect(Value.Check(UXReview, r)).toBe(true);
  });

  it('accepts empty issues array', () => {
    const r = sampleReview();
    r.issues = [];
    expect(Value.Check(UXReview, r)).toBe(true);
  });
});

describe('UXIssue schema (standalone)', () => {
  it('accepts canonical issue shape', () => {
    expect(
      Value.Check(UXIssue, {
        id: 'UX-12345678',
        severity: 'alta',
        script: '02',
        step: '1',
        description: 'x',
        category: 'visual',
      }),
    ).toBe(true);
  });
});

describe('DEFAULT_UX_DIFF_RULES sanity', () => {
  it('has the Fase 3 plan thresholds', () => {
    expect(DEFAULT_UX_DIFF_RULES.regressionOverall).toBe(0.3);
    expect(DEFAULT_UX_DIFF_RULES.regressionScript).toBe(0.5);
  });
});
