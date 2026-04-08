// Fase 3 — Baseline recorder tests.
// Covers: aggregation across runs, manual step handling, cross-run
// consistency checks, metric delta sparse handling, assertion pass rate.

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_METRIC_PATHS,
  type RecorderStepInput,
  recordBaseline,
} from '../../../tests/helpers/qa-baseline/recorder.js';
import { Baseline } from '../../../tests/helpers/qa-baseline/schema.js';

// Minimal MetricsSnapshot-shaped object for delta computation tests.
function metrics(overrides: Record<string, number> = {}): Record<string, unknown> {
  return {
    tools: { callCount: overrides['tools.callCount'] ?? 0, errorCount: 0 },
    judge: {
      triggeredTotal: overrides['judge.triggeredTotal'] ?? 0,
      skippedTotal: 0,
      skippedByReason: {},
      verdictCounts: {
        PASS: overrides['judge.verdictCounts.PASS'] ?? 0,
        FAIL: overrides['judge.verdictCounts.FAIL'] ?? 0,
        UNKNOWN: overrides['judge.verdictCounts.UNKNOWN'] ?? 0,
      },
    },
    turns: {
      totalStarted: overrides['turns.totalStarted'] ?? 0,
      totalEnded: overrides['turns.totalEnded'] ?? 0,
    },
  };
}

function automatedStep(n: number, tools: string[], duration: number): RecorderStepInput {
  return {
    step: `${n}. Step ${n}`,
    isManual: false,
    assertionMode: 'strict',
    toolCards: tools,
    durationMs: duration,
    assertions: [{ passed: true }, { passed: true }],
    metricsBefore: metrics({ 'tools.callCount': 10 }),
    metricsAfter: metrics({ 'tools.callCount': 10 + tools.length }),
  };
}

function manualStep(n: number): RecorderStepInput {
  return {
    step: `${n}. Manual ${n}`,
    isManual: true,
    assertionMode: 'soft_pass',
    toolCards: [],
    durationMs: null,
    assertions: null,
  };
}

describe('recordBaseline', () => {
  const opts = { script: '02-happy-path', appVersion: '0.18.0' };

  it('throws on empty runs', () => {
    expect(() => recordBaseline([], opts)).toThrow(/at least 1 run/);
  });

  it('throws on runs with different step counts', () => {
    const runA = [automatedStep(1, ['a'], 1000)];
    const runB = [automatedStep(1, ['a'], 1000), automatedStep(2, ['b'], 2000)];
    expect(() => recordBaseline([runA, runB], opts)).toThrow(/same step count/);
  });

  it('throws on step title mismatch across runs', () => {
    const runA = [automatedStep(1, ['a'], 1000)];
    const runB: RecorderStepInput[] = [{ ...automatedStep(1, ['a'], 1000), step: '1. Different title' }];
    expect(() => recordBaseline([runA, runB], opts)).toThrow(/step title mismatch/);
  });

  it('throws on isManual disagreement', () => {
    const runA = [automatedStep(1, ['a'], 1000)];
    const runB: RecorderStepInput[] = [{ ...automatedStep(1, ['a'], 1000), isManual: true }];
    expect(() => recordBaseline([runA, runB], opts)).toThrow(/isManual mismatch/);
  });

  it('produces a schema-valid baseline from 3 identical automated runs', () => {
    const run = [automatedStep(1, ['figma_status', 'figma_screenshot'], 14000)];
    const b = recordBaseline([run, run, run], opts);

    expect(Value.Check(Baseline, b)).toBe(true);
    expect(b.sampleSize).toBe(3);
    expect(b.script).toBe('02-happy-path');
    expect(b.steps).toHaveLength(1);
    expect(b.steps[0].isManual).toBe(false);
    expect(b.steps[0].stepNumber).toBe(1);
    expect(b.steps[0].stepTitle).toBe('Step 1');
    expect(b.steps[0].toolCallCount?.p95).toBe(2);
    expect(b.steps[0].durationMs?.p95).toBe(14000);
  });

  it('records manual steps with null stats and empty metricDeltas', () => {
    const run = [manualStep(2)];
    const b = recordBaseline([run, run], opts);
    expect(b.steps[0].isManual).toBe(true);
    expect(b.steps[0].toolSequences).toBeNull();
    expect(b.steps[0].toolCallCount).toBeNull();
    expect(b.steps[0].durationMs).toBeNull();
    expect(b.steps[0].metricDeltas).toEqual({});
    expect(b.steps[0].assertionPassRate).toBe(1.0);
    expect(b.steps[0].assertionCount).toBe(0);
  });

  it('aggregates tool sequences with modal + variants', () => {
    const runs: RecorderStepInput[][] = [
      [automatedStep(1, ['a', 'b'], 1000)],
      [automatedStep(1, ['a', 'b'], 1000)],
      [automatedStep(1, ['a', 'b'], 1000)],
      [automatedStep(1, ['a', 'b', 'c'], 1500)],
    ];
    const b = recordBaseline(runs, opts);
    expect(b.steps[0].toolSequences?.modal).toEqual(['a', 'b']);
    expect(b.steps[0].toolSequences?.variants).toHaveLength(2);
    expect(b.steps[0].toolSequences?.variants[0]).toEqual({ sequence: ['a', 'b'], count: 3 });
  });

  it('computes metric deltas from metricsBefore/metricsAfter', () => {
    const runs: RecorderStepInput[][] = [
      [automatedStep(1, ['figma_set_fills'], 1000)],
      [automatedStep(1, ['figma_set_fills'], 1000)],
      [automatedStep(1, ['figma_set_fills'], 1000)],
    ];
    const b = recordBaseline(runs, opts);
    // tools.callCount delta = after(11) - before(10) = 1
    expect(b.steps[0].metricDeltas['tools.callCount']).toBeDefined();
    expect(b.steps[0].metricDeltas['tools.callCount'].p95).toBe(1);
  });

  it('skips metric paths that never varied (sparse baseline)', () => {
    const runs: RecorderStepInput[][] = [
      [
        {
          ...automatedStep(1, [], 1000),
          metricsBefore: {}, // no paths at all
          metricsAfter: {},
        },
      ],
    ];
    const b = recordBaseline(runs, opts);
    // DEFAULT_METRIC_PATHS is non-empty but none of them appear in the
    // empty metrics objects — baseline should have zero metricDeltas.
    expect(b.steps[0].metricDeltas).toEqual({});
    // Sanity: we did ask for the default paths.
    expect(DEFAULT_METRIC_PATHS.length).toBeGreaterThan(0);
  });

  it('computes assertionPassRate as mean across runs', () => {
    const runs: RecorderStepInput[][] = [
      [
        {
          ...automatedStep(1, ['a'], 1000),
          assertions: [{ passed: true }, { passed: true }, { passed: true }, { passed: true }], // 4/4 = 1.0
        },
      ],
      [
        {
          ...automatedStep(1, ['a'], 1000),
          assertions: [{ passed: true }, { passed: true }, { passed: true }, { passed: false }], // 3/4 = 0.75
        },
      ],
    ];
    const b = recordBaseline(runs, opts);
    expect(b.steps[0].assertionPassRate).toBeCloseTo((1.0 + 0.75) / 2, 4);
    expect(b.steps[0].assertionCount).toBe(4);
  });

  it('mixed manual/automated steps produce the right structure', () => {
    const run = [automatedStep(1, ['a'], 1000), manualStep(2), automatedStep(3, ['b', 'c'], 2000)];
    const b = recordBaseline([run, run], opts);
    expect(b.steps).toHaveLength(3);
    expect(b.steps[0].isManual).toBe(false);
    expect(b.steps[1].isManual).toBe(true);
    expect(b.steps[2].isManual).toBe(false);
    expect(b.steps[2].toolCallCount?.p95).toBe(2);
    expect(Value.Check(Baseline, b)).toBe(true);
  });

  it('parses bracket-indexed metric paths (sparse map keys)', () => {
    const runs: RecorderStepInput[][] = [
      [
        {
          ...automatedStep(1, ['a'], 1000),
          metricsBefore: { judge: { skippedByReason: { 'no-connector': 2 } } },
          metricsAfter: { judge: { skippedByReason: { 'no-connector': 5 } } },
        },
      ],
    ];
    const b = recordBaseline(runs, {
      ...opts,
      metricPaths: ["judge.skippedByReason['no-connector']"],
    });
    expect(b.steps[0].metricDeltas["judge.skippedByReason['no-connector']"]).toBeDefined();
    expect(b.steps[0].metricDeltas["judge.skippedByReason['no-connector']"].p95).toBe(3);
  });
});
