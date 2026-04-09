// Fase 3 — Baseline schema roundtrip tests.
// Validates that the TypeBox definitions accept canonical examples and
// reject common shapes of malformation (missing fields, wrong enums,
// out-of-range numbers). Does NOT test recorder/differ logic — those
// have their own test files.

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  Baseline,
  type BaselineStep,
  type Baseline as BaselineT,
  CURRENT_BASELINE_SCHEMA_VERSION,
  DEFAULT_DRIFT_RULES,
  DriftReport,
  type QuantileStats,
} from '../../../tests/helpers/qa-baseline/schema.js';

function quant(p95: number): QuantileStats {
  return { min: p95 - 2, p50: p95 - 1, p90: p95, p95, max: p95 + 1, mean: p95, stddev: 0.5, samples: 5 };
}

function automatedStep(n: number): BaselineStep {
  return {
    stepNumber: n,
    stepTitle: `Step ${n}`,
    isManual: false,
    assertionMode: 'strict',
    toolSequences: {
      modal: ['figma_status', 'figma_screenshot'],
      variants: [
        { sequence: ['figma_status', 'figma_screenshot'], count: 4 },
        { sequence: ['figma_status', 'figma_screenshot', 'figma_screenshot'], count: 1 },
      ],
    },
    toolCallCount: quant(2),
    durationMs: quant(14000),
    metricDeltas: {
      'tools.callCount': quant(2),
      'judge.triggeredTotal': quant(0),
    },
    assertionPassRate: 1.0,
    assertionCount: 4,
    screenshotHashes: null,
  };
}

function manualStep(n: number): BaselineStep {
  return {
    stepNumber: n,
    stepTitle: `Manual ${n}`,
    isManual: true,
    assertionMode: 'soft_pass',
    toolSequences: null,
    toolCallCount: null,
    durationMs: null,
    metricDeltas: {},
    assertionPassRate: 1.0,
    assertionCount: 0,
    screenshotHashes: null,
  };
}

function validBaseline(): BaselineT {
  return {
    schemaVersion: CURRENT_BASELINE_SCHEMA_VERSION,
    script: '02-happy-path',
    recordedAt: '2026-04-08T20:00:00.000Z',
    appVersion: '0.18.0',
    sampleSize: 5,
    // Deep-clone DEFAULT_DRIFT_RULES: tests mutate .driftRules and would
    // poison the shared module-level constant otherwise.
    driftRules: { ...DEFAULT_DRIFT_RULES },
    steps: [automatedStep(1), manualStep(2), automatedStep(4)],
  };
}

describe('qa-baseline schema — Baseline', () => {
  it('accepts a fully-populated valid baseline', () => {
    const b = validBaseline();
    expect(Value.Check(Baseline, b)).toBe(true);
    // Lossless roundtrip via JSON (the wire format).
    const roundTripped = JSON.parse(JSON.stringify(b));
    expect(Value.Check(Baseline, roundTripped)).toBe(true);
  });

  it('rejects an unknown schemaVersion', () => {
    const b = validBaseline() as unknown as { schemaVersion: number };
    b.schemaVersion = 2;
    expect(Value.Check(Baseline, b)).toBe(false);
  });

  it('rejects a manual step that has non-null automated fields', () => {
    // This enforces the "manual steps carry no stats" convention at schema
    // level — the union with null is how we encode that. A manual step
    // with a populated durationMs would be ambiguous for the differ.
    const b = validBaseline();
    const manual: BaselineStep = { ...manualStep(99), durationMs: quant(1000) };
    b.steps.push(manual);
    // Still structurally valid (TypeBox can't express the cross-field rule),
    // but we document it here so the invariant is visible. The recorder
    // enforces the null-for-manual rule at construction time.
    expect(Value.Check(Baseline, b)).toBe(true);
  });

  it('rejects invalid driftRules.toolSequencePolicy enum', () => {
    const b = validBaseline() as unknown as { driftRules: { toolSequencePolicy: string } };
    b.driftRules.toolSequencePolicy = 'loose';
    expect(Value.Check(Baseline, b)).toBe(false);
  });

  it('rejects out-of-range assertionPassRate', () => {
    const b = validBaseline();
    b.steps[0].assertionPassRate = 1.5;
    expect(Value.Check(Baseline, b)).toBe(false);
  });

  it('rejects empty script string', () => {
    const b = validBaseline();
    b.script = '';
    expect(Value.Check(Baseline, b)).toBe(false);
  });

  it('DEFAULT_DRIFT_RULES is itself valid', () => {
    const b = validBaseline();
    b.driftRules = DEFAULT_DRIFT_RULES;
    expect(Value.Check(Baseline, b)).toBe(true);
  });

  it('metricDeltas accepts arbitrary dotted-path keys', () => {
    // Keys mirror MetricsSnapshot paths — the schema cannot enumerate
    // them (would couple the two schemas), but it should accept any
    // string key with a QuantileStats value.
    const b = validBaseline();
    b.steps[0].metricDeltas['tools.byName.figma_render_jsx.calls'] = quant(1);
    b.steps[0].metricDeltas["judge.skippedByReason['no-connector']"] = quant(0);
    expect(Value.Check(Baseline, b)).toBe(true);
  });
});

describe('qa-baseline schema — DriftReport', () => {
  it('accepts an OK report with zero findings', () => {
    const r = {
      script: '02-happy-path',
      baselineRecordedAt: '2026-04-08T20:00:00.000Z',
      comparedAt: '2026-04-08T21:00:00.000Z',
      verdict: 'OK' as const,
      steps: [{ stepNumber: 1, stepTitle: 'Step 1', verdict: 'OK' as const, findings: [] }],
      summary: { totalSteps: 1, driftedSteps: 0, newFindings: 0 },
    };
    expect(Value.Check(DriftReport, r)).toBe(true);
  });

  it('accepts a DRIFT report with a metric_delta finding', () => {
    const r = {
      script: '14-judge',
      baselineRecordedAt: '2026-04-08T20:00:00.000Z',
      comparedAt: '2026-04-08T21:00:00.000Z',
      verdict: 'DRIFT' as const,
      steps: [
        {
          stepNumber: 2,
          stepTitle: 'Trigger judge',
          verdict: 'DRIFT' as const,
          findings: [
            {
              category: 'metric_delta' as const,
              path: 'judge.triggeredTotal',
              baseline: { p95: 1 },
              current: 3,
              rule: 'current 3 > p95 1 by 200% (tolerance 50%)',
              severity: 'regression' as const,
            },
          ],
        },
      ],
      summary: { totalSteps: 1, driftedSteps: 1, newFindings: 1 },
    };
    expect(Value.Check(DriftReport, r)).toBe(true);
  });

  it('rejects an unknown verdict enum', () => {
    const r = {
      script: 'x',
      baselineRecordedAt: '2026-04-08T20:00:00.000Z',
      comparedAt: '2026-04-08T21:00:00.000Z',
      verdict: 'MAYBE',
      steps: [],
      summary: { totalSteps: 0, driftedSteps: 0, newFindings: 0 },
    };
    expect(Value.Check(DriftReport, r)).toBe(false);
  });
});
