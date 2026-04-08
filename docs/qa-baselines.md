# QA Baselines — Runtime Regression Oracle

**Status**: Fase 3 of QA pipeline rebuild (2026-04-08)
**Consumes**: `MetricsRegistry.snapshot()` (Fase 4) + qa-runner step metadata
**Companion doc**: `test-metrics-schema.md` (MetricsSnapshot contract)

## Why

Single-step assertions in Fase 2 catch known regressions (a tool missing, a
duration cap exceeded, a specific metric delta). They cannot catch **drift**
— the slow degradation where every individual assertion still passes but
the aggregate behavior has shifted. Examples:

- Step 4 of script 02 used to call 2 tools (`figma_render_jsx` +
  `figma_screenshot`); now it calls 6 because the agent started
  redundantly re-screenshotting. Every assertion passes, but the agent
  is less efficient.
- Step 2 of script 14 used to complete in p95=30s; now p95=75s because of
  a model swap. No assertion caps duration at 60s for this step, so the
  regression is silent.
- `judge.skippedByReason['no-mutations']` used to grow by 0 on a mutating
  step; now it grows by 1 because a refactor introduced a code path that
  wrongly classifies a mutation as read-only. The metric_growth assertion
  `exactGrowth:0` would catch it, but only if it was explicitly authored —
  the baseline catches it automatically.

Runtime baselines solve this by recording the **statistical shape** of a
healthy run once, then comparing every subsequent run against that shape.
Drift beyond configurable thresholds is flagged as a regression.

## Architecture

```
qa-runner.mjs  ──N runs──▶  /tmp/bottega-qa/NN-metadata.json  (per-run array of stepMeta)
                                              │
                                              ▼
                       tests/helpers/qa-baseline/recorder.ts
                                              │
                                              ▼
                tests/qa-scripts/baselines/NN-name.baseline.json  (committed)
                                              │
                                              ▼
                        tests/helpers/qa-baseline/differ.ts
                                              │
                                              ▼
                                Drift report (stdout / JSON)
```

- `recorder.ts` aggregates N runs into one baseline (quantile stats).
- `differ.ts` compares a single run against a committed baseline.
- Both are pure functions (JSON in, JSON out). No side effects beyond the
  output they return.
- The CLI lives in `qa-runner.mjs` (gitignored, per convention), behind
  two flags: `--record-baseline` and `--baseline`.

## Baseline shape (version 1)

```typescript
interface Baseline {
  schemaVersion: 1;
  script: string;                  // e.g. "02-happy-path"
  recordedAt: string;              // ISO timestamp
  appVersion: string;              // from package.json
  sampleSize: number;              // number of runs aggregated (≥ 3 recommended)
  driftRules: DriftRules;          // per-baseline overridable thresholds

  steps: BaselineStep[];
}

interface BaselineStep {
  stepNumber: number;
  stepTitle: string;
  isManual: boolean;               // manual steps get no expectations
  assertionMode: 'strict' | 'soft_pass';

  // Tool sequence: deterministic-ish. Across N runs, the modal sequence
  // is recorded. If runs disagree, all observed variants are kept so the
  // differ can check "current ∈ observedVariants" rather than strict eq.
  toolSequences: {
    modal: string[];               // most frequent sequence
    variants: Array<{ sequence: string[]; count: number }>;  // all observed
  };

  // Tool count aggregated across runs. Catches "agent got chatty".
  toolCallCount: QuantileStats;

  // Duration aggregated across runs. Catches slow-downs.
  durationMs: QuantileStats;       // null for manual steps

  // MetricsRegistry counter deltas per step (after - before), aggregated.
  // Key is a dotted path into MetricsSnapshot; value is quantile stats of
  // the delta. Sparse map: only paths that varied (or were asserted on)
  // are recorded, to keep baseline files small.
  metricDeltas: Record<string, QuantileStats>;

  // Assertion pass rate (0..1). 1.0 is the healthy steady-state.
  assertionPassRate: number;
  assertionCount: number;
}

interface QuantileStats {
  min: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stddev: number;
  samples: number;
}

interface DriftRules {
  // Current value must be within ±tolerance of baseline p95.
  // Expressed as a percentage of the baseline p95 value.
  durationToleranceP95: number;    // default 0.30 (±30%)
  toolCountTolerance: number;      // default 2 (absolute ±)
  metricDeltaTolerance: number;    // default 0.50 (±50% of baseline p95)

  // Tool sequence policy: 'exact' requires modal match; 'variant' allows
  // any observed variant; 'superset' allows current ⊇ modal.
  toolSequencePolicy: 'exact' | 'variant' | 'superset';

  // Assertion pass rate floor. Current must be ≥ this × baseline.
  assertionPassRateFloor: number;  // default 1.0 (no tolerance — any new
                                    // assertion failure is a regression)
}
```

## Drift report shape

```typescript
interface DriftReport {
  script: string;
  baselineRecordedAt: string;
  comparedAt: string;
  verdict: 'OK' | 'DRIFT' | 'BASELINE_MISSING' | 'SCHEMA_MISMATCH';
  steps: StepDriftResult[];
  summary: {
    totalSteps: number;
    driftedSteps: number;
    newFindings: number;        // drift categories triggered across all steps
  };
}

interface StepDriftResult {
  stepNumber: number;
  stepTitle: string;
  verdict: 'OK' | 'DRIFT' | 'SKIPPED_MANUAL';
  findings: DriftFinding[];
}

interface DriftFinding {
  category: 'tool_sequence' | 'tool_count' | 'duration' | 'metric_delta' | 'assertion_pass_rate';
  path?: string;                // e.g. "judge.triggeredTotal" for metric_delta
  baseline: { p95: number; modal?: string[] };
  current: number | string[];
  rule: string;                 // human-readable rule violated
  severity: 'info' | 'warning' | 'regression';
}
```

## Drift rule semantics

For each step, the differ checks:

1. **Tool sequence**: current run's `toolCards` compared to baseline
   `toolSequences` per `driftRules.toolSequencePolicy`.
   - `exact`: `current === modal` (strict).
   - `variant`: `current ∈ variants` (any observed variant OK).
   - `superset`: `current ⊇ modal` (current is allowed to have extras).
   - Mismatch → `regression`.

2. **Tool count**: `|current - baseline.p95| > toolCountTolerance` → `warning`.
   (Warning not regression because a ±2 tool count variance is tolerable.)

3. **Duration**: `|current - baseline.p95| / baseline.p95 > durationToleranceP95`
   → `warning` if within 2× tolerance, `regression` if beyond.

4. **Metric delta**: for each path in `metricDeltas`, if
   `|current_delta - baseline.p95| / max(baseline.p95, 1) > metricDeltaTolerance`
   → `warning`.
   - Special case: if baseline.p95 was 0 and current is non-zero, `regression`.
   - Special case: if baseline.p95 was non-zero and current is 0,
     `regression` (the behavior disappeared).

5. **Assertion pass rate**: `current < baseline * assertionPassRateFloor`
   → `regression`.

## Recording a baseline

```bash
# Capture 5 runs and aggregate into a baseline
BOTTEGA_AGENT_TEST=1 npm run build
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs \
  --script 02 --record-baseline --baseline-runs 5

# Writes tests/qa-scripts/baselines/02-happy-path.baseline.json
```

**When to (re)record a baseline**:
- After the initial Fase 3 rollout (bootstrap).
- After an intentional behavior change (agent prompt update, tool refactor,
  model swap) where drift is expected and desired.
- Never: after a bug or performance regression. The baseline is the
  "healthy state" anchor — refreshing it against a degraded state hides
  the regression instead of fixing it.

**Sample size guidance**: 5 runs minimum to get meaningful p95. Manual
steps are skipped entirely from the baseline — they're aggregated with
`isManual: true` and no stats.

## Running against a baseline

```bash
BOTTEGA_AGENT_TEST=1 npm run build
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs \
  --script 02 --baseline

# Reads tests/qa-scripts/baselines/02-happy-path.baseline.json
# Outputs: stdout drift report + /tmp/bottega-qa/02-drift.json
# Exit code: 0 = OK, 1 = drift detected (any regression), 2 = missing baseline
```

## Versioning

- `schemaVersion: 1` is the current contract. Breaking changes bump this.
- A baseline with a different schemaVersion than the differ expects is
  rejected with `verdict: 'SCHEMA_MISMATCH'` (not a regression, a tooling
  incompat). Fix by re-recording against the new schema.
- MetricsSnapshot schema is independent (`test-metrics-schema.md`) — a
  snapshot bump cascades here only if new fields are added to
  `metricDeltas` paths.

## Failure modes

| Scenario | Verdict | Action |
|---|---|---|
| Baseline file doesn't exist for script | `BASELINE_MISSING` | Record one with `--record-baseline` |
| Baseline schemaVersion != differ version | `SCHEMA_MISMATCH` | Re-record or upgrade differ |
| Current run has a step the baseline doesn't | `DRIFT` (new step) | Re-record if expected |
| Baseline has a step the current run doesn't | `DRIFT` (deleted step) | Re-record if expected |
| Step is manual → baseline has `isManual: true` | `SKIPPED_MANUAL` (per step) | Normal — manual steps get no checks |
| Metrics IPC unreachable (no BOTTEGA_AGENT_TEST) | `metricDeltas` missing from diff | Warning in report, non-fatal |

## Relation to Fase 3b — UX Oracle Baseline

Runtime baselines (this doc) and UX Oracle baselines (`ux-baselines.md`) are
**two complementary sensors**:

| Sensor | Watches | Diff source |
|---|---|---|
| Runtime Baseline | Tool sequences, timings, metrics deltas | `MetricsRegistry.snapshot()` + qa-runner stepMeta |
| UX Oracle Baseline | Qualitative LLM scores (1-5 per dimension), issue list | Pass 2 ux-reviewer JSON output |

A healthy pipeline runs both. A regression in one is not necessarily
visible in the other.
