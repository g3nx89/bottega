// Fase 3 — Baseline differ tests.
// Covers: OK path, each drift category (tool_sequence, tool_count,
// duration, metric_delta, assertion_pass_rate), baseline missing/mismatch,
// step count changes, sequence policies, manual step skipping.

import { describe, expect, it } from 'vitest';

import { diffRun } from '../../../tests/helpers/qa-baseline/differ.js';
import {
  DEFAULT_METRIC_PATHS,
  type RecorderStepInput,
  recordBaseline,
} from '../../../tests/helpers/qa-baseline/recorder.js';
import { type Baseline, DEFAULT_DRIFT_RULES, type DriftRules } from '../../../tests/helpers/qa-baseline/schema.js';

function metrics(overrides: Record<string, number> = {}) {
  return {
    tools: { callCount: overrides['tools.callCount'] ?? 0, errorCount: 0 },
    judge: {
      triggeredTotal: overrides['judge.triggeredTotal'] ?? 0,
      skippedTotal: 0,
      skippedByReason: {},
      verdictCounts: { PASS: 0, FAIL: 0, UNKNOWN: 0 },
    },
    turns: { totalStarted: 0, totalEnded: 0 },
  };
}

function step(n: number, tools: string[], duration: number, metricBase = 10): RecorderStepInput {
  return {
    step: `${n}. Step ${n}`,
    isManual: false,
    assertionMode: 'strict',
    toolCards: tools,
    durationMs: duration,
    assertions: [{ passed: true }, { passed: true }],
    metricsBefore: metrics({ 'tools.callCount': metricBase }),
    metricsAfter: metrics({ 'tools.callCount': metricBase + tools.length }),
  };
}

function baseline(steps: RecorderStepInput[]): Baseline {
  return recordBaseline([steps, steps, steps], { script: 'test', appVersion: '0.18.0' });
}

describe('diffRun — trivial cases', () => {
  it('returns BASELINE_MISSING when baseline is null', () => {
    const r = diffRun({ baseline: null, run: [step(1, ['a'], 1000)] });
    expect(r.verdict).toBe('BASELINE_MISSING');
    expect(r.summary.totalSteps).toBe(0);
  });

  it('returns SCHEMA_MISMATCH when baseline.schemaVersion differs', () => {
    const b = baseline([step(1, ['a'], 1000)]);
    const broken = { ...b, schemaVersion: 999 as unknown as 1 };
    const r = diffRun({ baseline: broken, run: [step(1, ['a'], 1000)] });
    expect(r.verdict).toBe('SCHEMA_MISMATCH');
  });

  it('returns OK when current run matches the baseline exactly', () => {
    const b = baseline([step(1, ['figma_status', 'figma_screenshot'], 14000)]);
    const r = diffRun({ baseline: b, run: [step(1, ['figma_status', 'figma_screenshot'], 14000)] });
    expect(r.verdict).toBe('OK');
    expect(r.summary.driftedSteps).toBe(0);
    expect(r.steps[0].verdict).toBe('OK');
    expect(r.steps[0].findings).toHaveLength(0);
  });

  it('skips manual steps with SKIPPED_MANUAL verdict', () => {
    const manual: RecorderStepInput = {
      step: '1. Manual',
      isManual: true,
      assertionMode: 'soft_pass',
      toolCards: [],
      durationMs: null,
      assertions: null,
    };
    const b = recordBaseline([[manual]], { script: 'test', appVersion: '0.18.0' });
    const r = diffRun({ baseline: b, run: [manual] });
    expect(r.verdict).toBe('OK');
    expect(r.steps[0].verdict).toBe('SKIPPED_MANUAL');
    expect(r.steps[0].findings).toHaveLength(0);
  });
});

describe('diffRun — tool_sequence drift', () => {
  it('reports drift when sequence differs under variant policy', () => {
    const b = baseline([step(1, ['a', 'b'], 1000)]);
    const r = diffRun({ baseline: b, run: [step(1, ['a', 'b', 'c'], 1000)] });
    // 3 tools > p95 2 by 1, within toolCountTolerance=2 → no count finding.
    // But tool_sequence policy 'variant' rejects ['a','b','c'] (not in baseline variants).
    expect(r.verdict).toBe('DRIFT');
    const seqFinding = r.steps[0].findings.find((f) => f.category === 'tool_sequence');
    expect(seqFinding).toBeDefined();
    expect(seqFinding?.severity).toBe('regression');
  });

  it('variant policy accepts any observed variant', () => {
    // Build baseline with two observed variants.
    const b = recordBaseline(
      [[step(1, ['a', 'b'], 1000)], [step(1, ['a', 'b'], 1000)], [step(1, ['a', 'b', 'c'], 1000)]],
      { script: 'test', appVersion: '0.18.0' },
    );
    // Current uses the minority variant — should still pass.
    const r = diffRun({ baseline: b, run: [step(1, ['a', 'b', 'c'], 1000)] });
    expect(r.steps[0].findings.find((f) => f.category === 'tool_sequence')).toBeUndefined();
  });

  it('exact policy rejects anything but the modal', () => {
    const b = recordBaseline(
      [[step(1, ['a', 'b'], 1000)], [step(1, ['a', 'b'], 1000)], [step(1, ['a', 'b', 'c'], 1000)]],
      { script: 'test', appVersion: '0.18.0' },
    );
    const rules: DriftRules = { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'exact' };
    const r = diffRun({
      baseline: b,
      run: [step(1, ['a', 'b', 'c'], 1000)],
      driftRulesOverride: rules,
    });
    expect(r.steps[0].findings.find((f) => f.category === 'tool_sequence')).toBeDefined();
  });

  it('superset policy allows current to have extras (order preserved)', () => {
    const b = baseline([step(1, ['a', 'b'], 1000)]);
    const rules: DriftRules = { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'superset' };
    // ['a','x','b','c'] contains ['a','b'] as subsequence → OK.
    const r = diffRun({
      baseline: b,
      run: [step(1, ['a', 'x', 'b', 'c'], 1000)],
      driftRulesOverride: rules,
    });
    expect(r.steps[0].findings.find((f) => f.category === 'tool_sequence')).toBeUndefined();
  });
});

describe('diffRun — tool_count drift', () => {
  it('no drift within ±tolerance', () => {
    const b = baseline([step(1, ['a', 'b'], 1000)]); // p95 = 2
    // Current 3 tools: |3-2|=1 <= tol 2 → no finding.
    const r = diffRun({
      baseline: b,
      run: [step(1, ['a', 'b', 'd'], 1000)],
      // Use superset so the sequence finding doesn't mask count.
      driftRulesOverride: { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'superset' },
    });
    expect(r.steps[0].findings.find((f) => f.category === 'tool_count')).toBeUndefined();
  });

  it('warning at 2× tolerance, regression beyond', () => {
    const b = baseline([step(1, ['a'], 1000)]); // p95 = 1
    // Current 5 tools: |5-1|=4 > tol 2, > 2*tol 4 → regression.
    const r = diffRun({
      baseline: b,
      run: [step(1, ['a', 'b', 'c', 'd', 'e'], 1000)],
      driftRulesOverride: { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'superset' },
    });
    const f = r.steps[0].findings.find((f) => f.category === 'tool_count');
    expect(f).toBeDefined();
    // 4 > 2*2=4? It's equal — at the boundary. Verify severity.
    expect(f?.severity).toBe('warning');
  });
});

describe('diffRun — duration drift', () => {
  it('no drift within ±30% default tolerance', () => {
    const b = baseline([step(1, ['a'], 10000)]);
    // 12500 is 25% over p95 10000.
    const r = diffRun({ baseline: b, run: [step(1, ['a'], 12500)] });
    expect(r.steps[0].findings.find((f) => f.category === 'duration')).toBeUndefined();
  });

  it('warning at 31-60%, regression beyond 60%', () => {
    const b = baseline([step(1, ['a'], 10000)]);

    const warningRun = diffRun({ baseline: b, run: [step(1, ['a'], 15000)] }); // +50%
    const wf = warningRun.steps[0].findings.find((f) => f.category === 'duration');
    expect(wf?.severity).toBe('warning');

    const regressionRun = diffRun({ baseline: b, run: [step(1, ['a'], 30000)] }); // +200%
    const rf = regressionRun.steps[0].findings.find((f) => f.category === 'duration');
    expect(rf?.severity).toBe('regression');
  });
});

describe('diffRun — metric_delta drift', () => {
  it('regression when baseline says "always 0" but current delta is non-zero', () => {
    // Build baseline where judge.triggeredTotal never grows.
    const runs: RecorderStepInput[][] = [
      [
        {
          ...step(1, ['a'], 1000),
          metricsBefore: metrics({ 'judge.triggeredTotal': 5 }),
          metricsAfter: metrics({ 'judge.triggeredTotal': 5 }),
        },
      ],
    ];
    const b = recordBaseline(runs.concat(runs).concat(runs), {
      script: 'test',
      appVersion: '0.18.0',
    });

    // Current: judge.triggeredTotal jumps by 3 — a new code path introduced the judge fire.
    const current: RecorderStepInput = {
      ...step(1, ['a'], 1000),
      metricsBefore: metrics({ 'judge.triggeredTotal': 5 }),
      metricsAfter: metrics({ 'judge.triggeredTotal': 8 }),
    };
    const r = diffRun({ baseline: b, run: [current] });
    const f = r.steps[0].findings.find((f) => f.category === 'metric_delta' && f.path === 'judge.triggeredTotal');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('regression');
    expect(f?.current).toBe(3);
  });

  it('regression when baseline always grew but current delta is 0 (behavior disappeared)', () => {
    // Baseline: tools.callCount grows by 2 every run (3 tools: figma_status/screenshot/render — no, 2 tools here).
    const runs: RecorderStepInput[][] = [
      [step(1, ['a', 'b'], 1000)],
      [step(1, ['a', 'b'], 1000)],
      [step(1, ['a', 'b'], 1000)],
    ];
    const b = recordBaseline(runs, { script: 'test', appVersion: '0.18.0' });
    expect(b.steps[0].metricDeltas['tools.callCount'].p95).toBe(2);
    expect(b.steps[0].metricDeltas['tools.callCount'].min).toBe(2);

    // Current: zero tools → delta 0.
    const current: RecorderStepInput = {
      ...step(1, [], 1000),
      metricsBefore: metrics({ 'tools.callCount': 10 }),
      metricsAfter: metrics({ 'tools.callCount': 10 }),
    };
    const r = diffRun({
      baseline: b,
      run: [current],
      // Allow superset so we don't also trip tool_sequence.
      driftRulesOverride: { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'superset' },
    });
    const f = r.steps[0].findings.find((f) => f.category === 'metric_delta' && f.path === 'tools.callCount');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('regression');
  });

  it('warning at 51-100% ratio deviation', () => {
    const runs: RecorderStepInput[][] = [
      [step(1, ['a'], 1000)], // delta 1
      [step(1, ['a', 'b'], 1000)], // delta 2
      [step(1, ['a'], 1000)], // delta 1
    ];
    const b = recordBaseline(runs, { script: 'test', appVersion: '0.18.0' });
    // p95 of [1,1,2] = sorted[ceil(0.95*3)-1] = sorted[2] = 2.
    expect(b.steps[0].metricDeltas['tools.callCount'].p95).toBe(2);

    // Current delta = 4, ratio = |4-2|/2 = 100% → > 50% tol, but == 2*tol=100%
    const current: RecorderStepInput = {
      ...step(1, ['a', 'b', 'c', 'd'], 1000),
      metricsBefore: metrics({ 'tools.callCount': 10 }),
      metricsAfter: metrics({ 'tools.callCount': 14 }),
    };
    const r = diffRun({
      baseline: b,
      run: [current],
      driftRulesOverride: { ...DEFAULT_DRIFT_RULES, toolSequencePolicy: 'superset' },
    });
    const f = r.steps[0].findings.find((f) => f.category === 'metric_delta' && f.path === 'tools.callCount');
    expect(f?.severity).toBe('warning');
  });
});

describe('diffRun — assertion_pass_rate drift', () => {
  it('regression when current pass rate drops below baseline * floor', () => {
    const b = baseline([step(1, ['a'], 1000)]); // baseline pass rate 1.0
    const current: RecorderStepInput = {
      ...step(1, ['a'], 1000),
      assertions: [
        { passed: true },
        { passed: false }, // 1/2 = 0.5
      ],
    };
    const r = diffRun({ baseline: b, run: [current] });
    const f = r.steps[0].findings.find((f) => f.category === 'assertion_pass_rate');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('regression');
  });

  it('no finding when current pass rate matches baseline', () => {
    const b = baseline([step(1, ['a'], 1000)]);
    const r = diffRun({ baseline: b, run: [step(1, ['a'], 1000)] });
    expect(r.steps[0].findings.find((f) => f.category === 'assertion_pass_rate')).toBeUndefined();
  });
});

describe('diffRun — step count changes', () => {
  it('DRIFT when run has steps the baseline does not', () => {
    const b = baseline([step(1, ['a'], 1000)]);
    const r = diffRun({
      baseline: b,
      run: [step(1, ['a'], 1000), step(2, ['b'], 2000)],
    });
    expect(r.verdict).toBe('DRIFT');
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].verdict).toBe('DRIFT');
    expect(r.steps[1].findings[0].rule).toMatch(/not in baseline/);
  });

  it('DRIFT when baseline has steps the run does not', () => {
    const b = baseline([step(1, ['a'], 1000), step(2, ['b'], 2000)]);
    const r = diffRun({ baseline: b, run: [step(1, ['a'], 1000)] });
    expect(r.verdict).toBe('DRIFT');
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].verdict).toBe('DRIFT');
    expect(r.steps[1].findings[0].rule).toMatch(/not in run/);
  });
});

describe('diffRun — metric_delta sparse handling', () => {
  it('treats missing metrics as 0 delta (sparse-map convention)', () => {
    const b = baseline([step(1, ['a'], 1000)]);
    const currentNoMetrics: RecorderStepInput = {
      ...step(1, ['a'], 1000),
      metricsBefore: null,
      metricsAfter: null,
    };
    // baseline p95 delta for tools.callCount is 1 (one tool per run).
    // Current has no metrics → delta 0. |0 - 1| / 1 = 100% > 50% tol → warning.
    // Also: baseline.min=1 > 0 and current=0 → hits "behavior disappeared" regression.
    const r = diffRun({ baseline: b, run: [currentNoMetrics] });
    const f = r.steps[0].findings.find((f) => f.category === 'metric_delta' && f.path === 'tools.callCount');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('regression');
  });
});

describe('diffRun — visual_drift', () => {
  it('no finding when both hashes match exactly', () => {
    const s = step(1, ['a'], 1000);
    const hashA = 'a0b1c2d3e4f56789';
    const withHash = { ...s, screenshotHash: hashA };
    const b = recordBaseline([[withHash], [withHash], [withHash]], { script: 'test', appVersion: '0.18.0' });
    const r = diffRun({ baseline: b, run: [{ ...s, screenshotHash: hashA }] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeUndefined();
  });

  it('no finding when neither side has screenshot hash', () => {
    const b = baseline([step(1, ['a'], 1000)]);
    const r = diffRun({ baseline: b, run: [step(1, ['a'], 1000)] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeUndefined();
  });

  it('warning when hamming distance is 11-15', () => {
    const s = step(1, ['a'], 1000);
    // Two hashes that differ by ~12 bits: 0x0000 vs 0x0fff (12 bits in low 3 nibbles)
    const baseHash = '0000000000000000';
    const currHash = '0000000000000fff'; // 12 bits differ
    const withHash = { ...s, screenshotHash: baseHash };
    const b = recordBaseline([[withHash], [withHash], [withHash]], { script: 'test', appVersion: '0.18.0' });
    const r = diffRun({ baseline: b, run: [{ ...s, screenshotHash: currHash }] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('warning');
  });

  it('no finding when baseline has hash but run does not (asymmetric)', () => {
    const s = step(1, ['a'], 1000);
    const withHash = { ...s, screenshotHash: 'a0b1c2d3e4f56789' };
    const b = recordBaseline([[withHash], [withHash], [withHash]], { script: 'test', appVersion: '0.18.0' });
    // Current run has no screenshot hash
    const r = diffRun({ baseline: b, run: [step(1, ['a'], 1000)] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeUndefined();
  });

  it('no finding when run has hash but baseline does not (asymmetric)', () => {
    const b = baseline([step(1, ['a'], 1000)]); // no screenshotHash
    const r = diffRun({ baseline: b, run: [{ ...step(1, ['a'], 1000), screenshotHash: 'a0b1c2d3e4f56789' }] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeUndefined();
  });

  it('regression when hamming distance exceeds 15', () => {
    const s = step(1, ['a'], 1000);
    const baseHash = '0000000000000000';
    const currHash = 'ffffffffffffffff'; // 64 bits differ
    const withHash = { ...s, screenshotHash: baseHash };
    const b = recordBaseline([[withHash], [withHash], [withHash]], { script: 'test', appVersion: '0.18.0' });
    const r = diffRun({ baseline: b, run: [{ ...s, screenshotHash: currHash }] });
    const f = r.steps[0].findings.find((f) => f.category === 'visual_drift');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('regression');
    expect(r.steps[0].verdict).toBe('DRIFT');
  });
});

describe('diffRun — per-path metric tolerance overrides', () => {
  it('uses override tolerance for process.rssBytes', () => {
    const s = step(1, ['a'], 1000);
    // Give baseline a process.rssBytes delta
    const withRss = {
      ...s,
      metricsBefore: { ...metrics(), process: { rssBytes: 100_000_000, heapUsedBytes: 50_000_000, uptimeSec: 10 } },
      metricsAfter: { ...metrics(), process: { rssBytes: 110_000_000, heapUsedBytes: 60_000_000, uptimeSec: 15 } },
    };
    const b = recordBaseline([[withRss], [withRss], [withRss]], {
      script: 'test',
      appVersion: '0.18.0',
      metricPaths: ['process.rssBytes'],
    });
    // Current delta = 30M (3x the baseline 10M delta). With default 0.5 tolerance this would regression.
    // But process.rssBytes has override tolerance 2.0, so |30M - 10M|/10M = 200% <= 200% → OK
    const current = {
      ...s,
      metricsBefore: { ...metrics(), process: { rssBytes: 100_000_000, heapUsedBytes: 50_000_000, uptimeSec: 10 } },
      metricsAfter: { ...metrics(), process: { rssBytes: 130_000_000, heapUsedBytes: 60_000_000, uptimeSec: 15 } },
    };
    const r = diffRun({
      baseline: b,
      run: [current],
      driftRulesOverride: {
        ...DEFAULT_DRIFT_RULES,
        toolSequencePolicy: 'superset',
        metricDeltaToleranceOverrides: { 'process.rssBytes': 2.0 },
      },
    });
    const f = r.steps[0].findings.find((f) => f.category === 'metric_delta' && f.path === 'process.rssBytes');
    // At 200% delta with 2.0 tolerance, this is exactly at the boundary — should not be flagged
    expect(f).toBeUndefined();
  });
});

describe('DEFAULT_METRIC_PATHS sanity', () => {
  it('exports a non-empty default path list for recorder', () => {
    expect(DEFAULT_METRIC_PATHS.length).toBeGreaterThan(0);
  });

  it('includes process memory metrics', () => {
    expect(DEFAULT_METRIC_PATHS).toContain('process.rssBytes');
    expect(DEFAULT_METRIC_PATHS).toContain('process.heapUsedBytes');
    expect(DEFAULT_METRIC_PATHS).toContain('process.uptimeSec');
  });
});
