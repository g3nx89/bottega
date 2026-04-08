/**
 * UX Oracle schema (Fase 3b) — TypeBox definitions for the qualitative
 * regression oracle that consumes Pass 2 ux-reviewer output.
 *
 * This is the complement of qa-baseline:
 *   qa-baseline → objective drift (tool sequences, timings, metrics)
 *   ux-baseline → qualitative drift (LLM reviewer 1-5 scores per dimension)
 *
 * Wire contract: docs/ux-baselines.md
 * Plan reference: Fase 3 Task 3.1 in happy-marinating-sonnet.md §5.3
 *
 * Design notes:
 * - TypeBox over AJV for consistency with qa-baseline and to avoid adding
 *   new devDependencies. The plan allowed AJV; we prefer zero new deps.
 * - Issue IDs are stable: UX-<sha1(script+step+description)[:8]> so the
 *   same issue across runs maps to the same row in the diff.
 * - Severity enum matches the existing BUG-REPORT.md vocabulary
 *   (alta/media/bassa) for continuity with functional bugs.
 * - Category enum is a closed set so the differ can count new/fixed
 *   issues by category without string normalization.
 * - Dimension scores are floats 1-5 (not integers) because the variance
 *   calibration documented in Fase 3 Task 3.2a measures std deviation
 *   against a 0.3 threshold — integer snapping would hide that.
 */

import { type Static, Type } from '@sinclair/typebox';

// ─── Enums ──────────────────────────────────────────────────────────────

export const UXSeverity = Type.Union([Type.Literal('alta'), Type.Literal('media'), Type.Literal('bassa')]);
export type UXSeverity = Static<typeof UXSeverity>;

export const UXCategory = Type.Union([
  Type.Literal('tool_selection'),
  Type.Literal('response_quality'),
  Type.Literal('visual'),
  Type.Literal('feedback'),
  Type.Literal('performance'),
]);
export type UXCategory = Static<typeof UXCategory>;

// ─── Dimension scores ───────────────────────────────────────────────────

/**
 * The 5 review dimensions documented in bottega-dev-debug/SKILL.md Pass 2.
 * Each score is on a 1-5 scale; float allowed so variance can be computed.
 */
export const UXDimensionScores = Type.Object(
  {
    visualQuality: Type.Number({ minimum: 1, maximum: 5 }),
    responseClarity: Type.Number({ minimum: 1, maximum: 5 }),
    toolSelection: Type.Number({ minimum: 1, maximum: 5 }),
    uxCoherence: Type.Number({ minimum: 1, maximum: 5 }),
    feedbackQuality: Type.Number({ minimum: 1, maximum: 5 }),
  },
  { $id: 'UXDimensionScores', additionalProperties: false },
);
export type UXDimensionScores = Static<typeof UXDimensionScores>;

export const UX_DIMENSION_KEYS = [
  'visualQuality',
  'responseClarity',
  'toolSelection',
  'uxCoherence',
  'feedbackQuality',
] as const;

// ─── Issue ──────────────────────────────────────────────────────────────

export const UXIssue = Type.Object(
  {
    // UX-<sha1(script+step+description)[:8]>
    id: Type.String({ pattern: '^UX-[0-9a-f]{8}$' }),
    severity: UXSeverity,
    script: Type.String({ minLength: 1 }),
    step: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    category: UXCategory,
  },
  { $id: 'UXIssue', additionalProperties: false },
);
export type UXIssue = Static<typeof UXIssue>;

// ─── Per-script scores ──────────────────────────────────────────────────

export const UXScriptScore = Type.Object(
  {
    script: Type.String({ minLength: 1 }),
    score: Type.Number({ minimum: 1, maximum: 5 }),
    stepCount: Type.Integer({ minimum: 0 }),
    issueCount: Type.Integer({ minimum: 0 }),
    dimensionScores: UXDimensionScores,
  },
  { additionalProperties: false },
);
export type UXScriptScore = Static<typeof UXScriptScore>;

// ─── UX Review (single run, produced by Pass 2 reviewer) ────────────────

export const UXReview = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    timestamp: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}' }),
    appVersion: Type.String({ minLength: 1 }),
    overallScore: Type.Number({ minimum: 1, maximum: 5 }),
    scriptScores: Type.Record(Type.String(), UXScriptScore),
    issues: Type.Array(UXIssue),
  },
  { $id: 'UXReview', additionalProperties: false },
);
export type UXReview = Static<typeof UXReview>;

export const CURRENT_UX_REVIEW_SCHEMA_VERSION = 1 as const;

// ─── UX Baseline (committed anchor, same shape as UXReview) ─────────────

/**
 * A UX baseline is just a UXReview that has been blessed as the "healthy
 * steady-state" anchor. Storing it with the same schema makes the
 * ux-baseline-diff a single-file comparison instead of two types.
 */
export const UXBaseline = UXReview;
export type UXBaseline = UXReview;

// ─── Diff rules ─────────────────────────────────────────────────────────

export const UXDiffRules = Type.Object(
  {
    // Regression thresholds (plan §5: REGRESSION_OVERALL=0.3, REGRESSION_SCRIPT=0.5)
    regressionOverall: Type.Number({ minimum: 0 }),
    regressionScript: Type.Number({ minimum: 0 }),
    // Regression on individual dimension scores (per-dimension granularity
    // lets the reviewer catch "visual quality tanked on one script" without
    // the overall being pulled enough to trip the global threshold).
    regressionDimension: Type.Number({ minimum: 0 }),
  },
  { $id: 'UXDiffRules', additionalProperties: false },
);
export type UXDiffRules = Static<typeof UXDiffRules>;

export const DEFAULT_UX_DIFF_RULES: UXDiffRules = {
  regressionOverall: 0.3,
  regressionScript: 0.5,
  regressionDimension: 0.5,
};

// ─── Diff report ────────────────────────────────────────────────────────

export const UXDiffFinding = Type.Object(
  {
    category: Type.Union([
      Type.Literal('overall_score_drop'),
      Type.Literal('script_score_drop'),
      Type.Literal('dimension_score_drop'),
      Type.Literal('new_issue'),
      Type.Literal('fixed_issue'),
      Type.Literal('changed_severity'),
    ]),
    script: Type.Optional(Type.String()),
    dimension: Type.Optional(Type.String()),
    issueId: Type.Optional(Type.String()),
    baseline: Type.Optional(Type.Number()),
    current: Type.Optional(Type.Number()),
    delta: Type.Optional(Type.Number()),
    message: Type.String(),
    // Issue-level findings carry the severity of the affected issue so the
    // report can be scanned without re-lookups against the issue table.
    severity: Type.Optional(UXSeverity),
  },
  { additionalProperties: false },
);
export type UXDiffFinding = Static<typeof UXDiffFinding>;

export const UXDiffReport = Type.Object(
  {
    baselineRunId: Type.String(),
    baselineTimestamp: Type.String(),
    currentRunId: Type.String(),
    currentTimestamp: Type.String(),
    verdict: Type.Union([
      Type.Literal('OK'),
      Type.Literal('DRIFT'),
      Type.Literal('BASELINE_MISSING'),
      Type.Literal('SCHEMA_MISMATCH'),
    ]),
    overallDelta: Type.Number(),
    findings: Type.Array(UXDiffFinding),
    summary: Type.Object(
      {
        newIssues: Type.Integer({ minimum: 0 }),
        fixedIssues: Type.Integer({ minimum: 0 }),
        changedSeverity: Type.Integer({ minimum: 0 }),
        regressionCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'UXDiffReport', additionalProperties: false },
);
export type UXDiffReport = Static<typeof UXDiffReport>;
