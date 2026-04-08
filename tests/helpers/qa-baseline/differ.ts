/**
 * Baseline differ (Fase 3) — compares a single qa-runner run against a
 * committed Baseline and produces a DriftReport. Pure function; no IO.
 *
 * Decision logic lives here; wire contract in docs/qa-baselines.md.
 *
 * Drift rule semantics (in order of increasing severity):
 *   - info       → worth noting but doesn't affect verdict
 *   - warning    → slight deviation (within 2× tolerance)
 *   - regression → beyond tolerance, flags the step as DRIFT
 *
 * Any regression in any step → report verdict = 'DRIFT'.
 */

import type { RecorderStepInput } from './recorder.js';
import {
  type Baseline,
  type BaselineStep,
  CURRENT_BASELINE_SCHEMA_VERSION,
  type DriftFinding,
  type DriftReport,
  type DriftRules,
  type StepDriftResult,
} from './schema.js';

export interface DifferInput {
  /** Parsed baseline JSON (or null if the file didn't exist). */
  baseline: Baseline | null;
  /** One run's stepMeta[] — same shape the recorder consumes. */
  run: readonly RecorderStepInput[];
  /** Optional override for driftRules; defaults to baseline.driftRules. */
  driftRulesOverride?: DriftRules;
  /** Timestamp for the comparedAt field; defaults to now. */
  comparedAt?: string;
}

export function diffRun(input: DifferInput): DriftReport {
  const comparedAt = input.comparedAt ?? new Date().toISOString();

  if (input.baseline === null) {
    return {
      script: '(unknown)',
      baselineRecordedAt: '(none)',
      comparedAt,
      verdict: 'BASELINE_MISSING',
      steps: [],
      summary: { totalSteps: 0, driftedSteps: 0, newFindings: 0 },
    };
  }

  if (input.baseline.schemaVersion !== CURRENT_BASELINE_SCHEMA_VERSION) {
    return {
      script: input.baseline.script,
      baselineRecordedAt: input.baseline.recordedAt,
      comparedAt,
      verdict: 'SCHEMA_MISMATCH',
      steps: [],
      summary: { totalSteps: 0, driftedSteps: 0, newFindings: 0 },
    };
  }

  const rules = input.driftRulesOverride ?? input.baseline.driftRules;
  const stepResults: StepDriftResult[] = [];

  const maxSteps = Math.max(input.baseline.steps.length, input.run.length);
  let driftedSteps = 0;
  let newFindings = 0;

  for (let i = 0; i < maxSteps; i++) {
    const baselineStep = input.baseline.steps[i];
    const runStep = input.run[i];

    // Step count mismatch (steps added/removed since baseline).
    if (!baselineStep && runStep) {
      stepResults.push({
        stepNumber: i + 1,
        stepTitle: runStep.step,
        verdict: 'DRIFT',
        findings: [
          {
            category: 'tool_sequence',
            baseline: {},
            current: [...runStep.toolCards],
            rule: 'step exists in run but not in baseline (added since baseline recorded)',
            severity: 'regression',
          },
        ],
      });
      driftedSteps += 1;
      newFindings += 1;
      continue;
    }
    if (baselineStep && !runStep) {
      stepResults.push({
        stepNumber: baselineStep.stepNumber,
        stepTitle: baselineStep.stepTitle,
        verdict: 'DRIFT',
        findings: [
          {
            category: 'tool_sequence',
            baseline: baselineStep.toolSequences ? { modal: baselineStep.toolSequences.modal } : {},
            current: [],
            rule: 'step exists in baseline but not in run (removed since baseline recorded)',
            severity: 'regression',
          },
        ],
      });
      driftedSteps += 1;
      newFindings += 1;
      continue;
    }

    // Both present (narrowed for TS).
    if (!baselineStep || !runStep) continue;

    const result = diffStep(baselineStep, runStep, rules);
    stepResults.push(result);
    if (result.verdict === 'DRIFT') {
      driftedSteps += 1;
      newFindings += result.findings.filter((f) => f.severity === 'regression').length;
    }
  }

  const verdict = driftedSteps > 0 ? 'DRIFT' : 'OK';

  return {
    script: input.baseline.script,
    baselineRecordedAt: input.baseline.recordedAt,
    comparedAt,
    verdict,
    steps: stepResults,
    summary: {
      totalSteps: stepResults.length,
      driftedSteps,
      newFindings,
    },
  };
}

function diffStep(baseline: BaselineStep, run: RecorderStepInput, rules: DriftRules): StepDriftResult {
  if (baseline.isManual) {
    return {
      stepNumber: baseline.stepNumber,
      stepTitle: baseline.stepTitle,
      verdict: 'SKIPPED_MANUAL',
      findings: [],
    };
  }

  const findings: DriftFinding[] = [];

  // 1. Tool sequence
  const seqFinding = checkToolSequence(baseline, run, rules);
  if (seqFinding) findings.push(seqFinding);

  // 2. Tool count
  const countFinding = checkToolCount(baseline, run, rules);
  if (countFinding) findings.push(countFinding);

  // 3. Duration
  const durFinding = checkDuration(baseline, run, rules);
  if (durFinding) findings.push(durFinding);

  // 4. Metric deltas
  findings.push(...checkMetricDeltas(baseline, run, rules));

  // 5. Assertion pass rate
  const asrFinding = checkAssertionPassRate(baseline, run, rules);
  if (asrFinding) findings.push(asrFinding);

  const hasRegression = findings.some((f) => f.severity === 'regression');
  return {
    stepNumber: baseline.stepNumber,
    stepTitle: baseline.stepTitle,
    verdict: hasRegression ? 'DRIFT' : 'OK',
    findings,
  };
}

function checkToolSequence(baseline: BaselineStep, run: RecorderStepInput, rules: DriftRules): DriftFinding | null {
  if (!baseline.toolSequences) return null;
  const current = [...run.toolCards];
  const { modal, variants } = baseline.toolSequences;

  let matches = false;
  switch (rules.toolSequencePolicy) {
    case 'exact':
      matches = arraysEqual(current, modal);
      break;
    case 'variant':
      matches = variants.some((v) => arraysEqual(current, v.sequence));
      break;
    case 'superset':
      matches = isSuperset(current, modal);
      break;
  }

  if (matches) return null;

  return {
    category: 'tool_sequence',
    baseline: { modal },
    current,
    rule: `tool sequence policy '${rules.toolSequencePolicy}' violated (current does not match baseline)`,
    severity: 'regression',
  };
}

function checkToolCount(baseline: BaselineStep, run: RecorderStepInput, rules: DriftRules): DriftFinding | null {
  if (!baseline.toolCallCount) return null;
  const current = run.toolCards.length;
  const delta = Math.abs(current - baseline.toolCallCount.p95);
  if (delta <= rules.toolCountTolerance) return null;

  return {
    category: 'tool_count',
    baseline: { p95: baseline.toolCallCount.p95 },
    current,
    rule: `|${current} - p95 ${baseline.toolCallCount.p95}| = ${delta} > tolerance ${rules.toolCountTolerance}`,
    severity: delta <= rules.toolCountTolerance * 2 ? 'warning' : 'regression',
  };
}

function checkDuration(baseline: BaselineStep, run: RecorderStepInput, rules: DriftRules): DriftFinding | null {
  if (!baseline.durationMs || run.durationMs === null) return null;
  const current = run.durationMs;
  const p95 = baseline.durationMs.p95;
  if (p95 === 0) {
    // Degenerate baseline (shouldn't happen in practice). Skip to avoid div-by-zero.
    return null;
  }
  const ratio = Math.abs(current - p95) / p95;
  if (ratio <= rules.durationToleranceP95) return null;

  return {
    category: 'duration',
    baseline: { p95 },
    current,
    rule: `|${current} - p95 ${p95}| / p95 = ${(ratio * 100).toFixed(1)}% > tolerance ${(rules.durationToleranceP95 * 100).toFixed(0)}%`,
    severity: ratio <= rules.durationToleranceP95 * 2 ? 'warning' : 'regression',
  };
}

function checkMetricDeltas(baseline: BaselineStep, run: RecorderStepInput, rules: DriftRules): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const [path, stats] of Object.entries(baseline.metricDeltas)) {
    const before = readPath(run.metricsBefore, path);
    const after = readPath(run.metricsAfter, path);
    let currentDelta: number;
    if (typeof before === 'number' && typeof after === 'number') {
      currentDelta = after - before;
    } else if (before === undefined && after === undefined) {
      // Sparse-map: if neither side has the path this run, treat as 0.
      currentDelta = 0;
    } else {
      currentDelta = (typeof after === 'number' ? after : 0) - (typeof before === 'number' ? before : 0);
    }

    const p95 = stats.p95;

    // Special case: baseline says "always 0" but current is non-zero → regression.
    if (p95 === 0 && currentDelta !== 0) {
      findings.push({
        category: 'metric_delta',
        path,
        baseline: { p95: 0 },
        current: currentDelta,
        rule: `baseline p95 was 0 (counter never grew in baseline runs), current delta ${currentDelta}`,
        severity: 'regression',
      });
      continue;
    }

    // Special case: baseline says "non-zero" but current is 0 → regression
    // (the behavior disappeared).
    if (p95 !== 0 && currentDelta === 0 && stats.min > 0) {
      findings.push({
        category: 'metric_delta',
        path,
        baseline: { p95 },
        current: 0,
        rule: `baseline min > 0 (counter always grew in baseline runs), current delta 0 — behavior disappeared`,
        severity: 'regression',
      });
      continue;
    }

    if (p95 === 0) continue; // no ratio math if baseline is zero
    const ratio = Math.abs(currentDelta - p95) / Math.max(Math.abs(p95), 1);
    if (ratio <= rules.metricDeltaTolerance) continue;

    findings.push({
      category: 'metric_delta',
      path,
      baseline: { p95 },
      current: currentDelta,
      rule: `|${currentDelta} - p95 ${p95}| / p95 = ${(ratio * 100).toFixed(1)}% > tolerance ${(rules.metricDeltaTolerance * 100).toFixed(0)}%`,
      severity: ratio <= rules.metricDeltaTolerance * 2 ? 'warning' : 'regression',
    });
  }
  return findings;
}

function checkAssertionPassRate(
  baseline: BaselineStep,
  run: RecorderStepInput,
  rules: DriftRules,
): DriftFinding | null {
  if (!run.assertions || run.assertions.length === 0) return null;
  const passed = run.assertions.filter((a) => a.passed).length;
  const current = passed / run.assertions.length;
  const threshold = baseline.assertionPassRate * rules.assertionPassRateFloor;
  if (current >= threshold) return null;

  return {
    category: 'assertion_pass_rate',
    baseline: { p95: baseline.assertionPassRate },
    current,
    rule: `assertion pass rate ${(current * 100).toFixed(0)}% < baseline * floor ${(threshold * 100).toFixed(0)}%`,
    severity: 'regression',
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSuperset(current: readonly string[], required: readonly string[]): boolean {
  // Preserves order: required must appear as a subsequence of current.
  let ri = 0;
  for (let ci = 0; ci < current.length && ri < required.length; ci++) {
    if (current[ci] === required[ri]) ri += 1;
  }
  return ri === required.length;
}

function readPath(root: unknown, path: string): unknown {
  if (root == null || typeof root !== 'object') return undefined;
  const tokens: string[] = [];
  const tokenRe = /[^.[\]'"]+|\[['"]?([^\]'"]+)['"]?\]/g;
  for (const m of path.matchAll(tokenRe)) {
    tokens.push(m[1] ?? m[0]);
  }
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}
