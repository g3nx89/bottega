/**
 * QA Baseline schema (Fase 3) — TypeBox definitions for the runtime
 * regression oracle. Used by recorder (aggregates N qa-runner runs into
 * one baseline) and differ (compares a single run against a baseline).
 *
 * Wire contract: docs/qa-baselines.md
 * Related:       docs/test-metrics-schema.md (MetricsSnapshot, consumed here)
 *
 * Design notes:
 * - TypeBox chosen over plain JSON Schema for consistency with Bottega's
 *   tool definitions (src/main/tools/*). Schemas live as runtime values so
 *   recorder/differ validate at load time.
 * - schemaVersion is a literal 1, bumped only on breaking changes.
 * - metricDeltas uses a permissive Record<string, QuantileStats> because
 *   the set of interesting paths depends on what MetricsSnapshot fields
 *   vary during the run — enumerating them here would duplicate the
 *   MetricsSnapshot contract and drift.
 */

import { type Static, Type } from '@sinclair/typebox';

// ─── Reusable primitives ────────────────────────────────────────────────

export const QuantileStats = Type.Object(
  {
    min: Type.Number(),
    p50: Type.Number(),
    p90: Type.Number(),
    p95: Type.Number(),
    max: Type.Number(),
    mean: Type.Number(),
    stddev: Type.Number(),
    samples: Type.Integer({ minimum: 1 }),
  },
  { $id: 'QuantileStats', additionalProperties: false },
);
export type QuantileStats = Static<typeof QuantileStats>;

export const ToolSequenceVariant = Type.Object(
  {
    sequence: Type.Array(Type.String()),
    count: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type ToolSequenceVariant = Static<typeof ToolSequenceVariant>;

export const ToolSequenceStats = Type.Object(
  {
    modal: Type.Array(Type.String()),
    variants: Type.Array(ToolSequenceVariant),
  },
  { additionalProperties: false },
);
export type ToolSequenceStats = Static<typeof ToolSequenceStats>;

// ─── Drift rules ───────────────────────────────────────────────────────

export const DriftRules = Type.Object(
  {
    durationToleranceP95: Type.Number({ minimum: 0 }),
    toolCountTolerance: Type.Integer({ minimum: 0 }),
    metricDeltaTolerance: Type.Number({ minimum: 0 }),
    toolSequencePolicy: Type.Union([Type.Literal('exact'), Type.Literal('variant'), Type.Literal('superset')]),
    assertionPassRateFloor: Type.Number({ minimum: 0, maximum: 1 }),
    metricDeltaToleranceOverrides: Type.Optional(Type.Record(Type.String(), Type.Number({ minimum: 0 }))),
  },
  { $id: 'DriftRules', additionalProperties: false },
);
export type DriftRules = Static<typeof DriftRules>;

export const DEFAULT_DRIFT_RULES: DriftRules = {
  durationToleranceP95: 0.3,
  toolCountTolerance: 2,
  metricDeltaTolerance: 0.5,
  toolSequencePolicy: 'variant',
  assertionPassRateFloor: 1.0,
  metricDeltaToleranceOverrides: { 'process.rssBytes': 2.0, 'process.heapUsedBytes': 2.0 },
};

// ─── Baseline step ─────────────────────────────────────────────────────

// Manual steps and automated steps share the same outer type but the
// automated-only fields (toolCallCount / durationMs / metricDeltas) are
// null when isManual is true. Runtime checks enforce this invariant; the
// schema keeps them nullable to avoid a discriminated-union explosion.

export const BaselineStep = Type.Object(
  {
    stepNumber: Type.Integer({ minimum: 1 }),
    stepTitle: Type.String({ minLength: 1 }),
    isManual: Type.Boolean(),
    assertionMode: Type.Union([Type.Literal('strict'), Type.Literal('soft_pass')]),

    toolSequences: Type.Union([ToolSequenceStats, Type.Null()]),
    toolCallCount: Type.Union([QuantileStats, Type.Null()]),
    durationMs: Type.Union([QuantileStats, Type.Null()]),
    metricDeltas: Type.Record(Type.String(), QuantileStats),

    assertionPassRate: Type.Number({ minimum: 0, maximum: 1 }),
    assertionCount: Type.Integer({ minimum: 0 }),

    // Perceptual hash map: stepKey (e.g. "screenshot") → 16-char hex pHash.
    // Null when no screenshots were captured during baseline recording.
    screenshotHashes: Type.Optional(Type.Union([Type.Record(Type.String(), Type.String()), Type.Null()])),
  },
  { $id: 'BaselineStep', additionalProperties: false },
);
export type BaselineStep = Static<typeof BaselineStep>;

// ─── Baseline root ─────────────────────────────────────────────────────

export const Baseline = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    script: Type.String({ minLength: 1 }),
    // ISO-8601 timestamp. TypeBox format validators aren't wired up in this
    // project, so we use a pattern. Not hermetic but catches typos.
    recordedAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}' }),
    appVersion: Type.String({ minLength: 1 }),
    sampleSize: Type.Integer({ minimum: 1 }),
    driftRules: DriftRules,
    steps: Type.Array(BaselineStep),
  },
  { $id: 'Baseline', additionalProperties: false },
);
export type Baseline = Static<typeof Baseline>;

export const CURRENT_BASELINE_SCHEMA_VERSION = 1 as const;

// ─── Drift report ──────────────────────────────────────────────────────

export const DriftFinding = Type.Object(
  {
    category: Type.Union([
      Type.Literal('tool_sequence'),
      Type.Literal('tool_count'),
      Type.Literal('duration'),
      Type.Literal('metric_delta'),
      Type.Literal('assertion_pass_rate'),
      Type.Literal('visual_drift'),
    ]),
    // For metric_delta the path is the dotted path into MetricsSnapshot;
    // absent for other categories.
    path: Type.Optional(Type.String()),
    // Baseline reference shape (p95 for numeric, modal for tool_sequence).
    baseline: Type.Object(
      {
        p95: Type.Optional(Type.Number()),
        modal: Type.Optional(Type.Array(Type.String())),
      },
      { additionalProperties: false },
    ),
    // Current value (number for numeric categories, string[] for tool_sequence).
    current: Type.Union([Type.Number(), Type.Array(Type.String())]),
    rule: Type.String(),
    severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('regression')]),
  },
  { additionalProperties: false },
);
export type DriftFinding = Static<typeof DriftFinding>;

export const StepDriftResult = Type.Object(
  {
    stepNumber: Type.Integer({ minimum: 1 }),
    stepTitle: Type.String(),
    verdict: Type.Union([Type.Literal('OK'), Type.Literal('DRIFT'), Type.Literal('SKIPPED_MANUAL')]),
    findings: Type.Array(DriftFinding),
  },
  { additionalProperties: false },
);
export type StepDriftResult = Static<typeof StepDriftResult>;

export const DriftReport = Type.Object(
  {
    script: Type.String(),
    baselineRecordedAt: Type.String(),
    comparedAt: Type.String(),
    verdict: Type.Union([
      Type.Literal('OK'),
      Type.Literal('DRIFT'),
      Type.Literal('BASELINE_MISSING'),
      Type.Literal('SCHEMA_MISMATCH'),
    ]),
    steps: Type.Array(StepDriftResult),
    summary: Type.Object(
      {
        totalSteps: Type.Integer({ minimum: 0 }),
        driftedSteps: Type.Integer({ minimum: 0 }),
        newFindings: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'DriftReport', additionalProperties: false },
);
export type DriftReport = Static<typeof DriftReport>;
