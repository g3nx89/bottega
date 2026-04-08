/**
 * Baseline recorder (Fase 3) — aggregates N qa-runner runs of the same
 * script into a single Baseline object. Pure function; no filesystem IO.
 *
 * Input shape: array of "runs", each being the stepMeta[] array produced
 * by qa-runner.mjs for one execution of one script. See
 * `RecorderStepInput` below for the fields consumed.
 *
 * Non-goals:
 *  - No file reading/writing (callers pass already-parsed JSON)
 *  - No drift detection (that's differ.ts)
 *  - No policy decisions (drift rules use DEFAULT_DRIFT_RULES — overridable
 *    via the options arg)
 *
 * Wire contract: docs/qa-baselines.md
 */

import {
  type Baseline,
  type BaselineStep,
  CURRENT_BASELINE_SCHEMA_VERSION,
  DEFAULT_DRIFT_RULES,
  type DriftRules,
  type QuantileStats,
} from './schema.js';
import { computeSequenceStats, computeStats } from './stats.js';

/**
 * Minimum fields the recorder needs from a qa-runner step metadata entry.
 * Matches the stepMeta shape produced by qa-runner.mjs, plus the
 * metrics{Before,After} fields added by the Fase 3 runner extension.
 */
export interface RecorderStepInput {
  step: string; // "4. Send a creation prompt"
  isManual: boolean;
  assertionMode: 'strict' | 'soft_pass';
  toolCards: readonly string[];
  durationMs: number | null;
  assertions: ReadonlyArray<{ passed: boolean }> | null;
  metricsBefore?: unknown | null;
  metricsAfter?: unknown | null;
}

export interface RecorderOptions {
  script: string;
  appVersion: string;
  recordedAt?: string;
  driftRules?: DriftRules;
  metricPaths?: readonly string[];
}

export const DEFAULT_METRIC_PATHS: readonly string[] = [
  'tools.callCount',
  'tools.errorCount',
  'judge.triggeredTotal',
  'judge.skippedTotal',
  'judge.verdictCounts.PASS',
  'judge.verdictCounts.FAIL',
  'judge.verdictCounts.UNKNOWN',
  'turns.totalStarted',
  'turns.totalEnded',
];

/**
 * Build a Baseline by aggregating N runs. Each run is a parallel array
 * of stepMeta — the recorder expects them to line up by index (qa-runner
 * guarantees steps are executed in the same order each run).
 */
export function recordBaseline(runs: ReadonlyArray<readonly RecorderStepInput[]>, options: RecorderOptions): Baseline {
  if (runs.length === 0) {
    throw new Error('recordBaseline: need at least 1 run');
  }

  const stepCount = runs[0].length;
  for (const run of runs) {
    if (run.length !== stepCount) {
      throw new Error(`recordBaseline: all runs must have same step count (expected ${stepCount}, got ${run.length})`);
    }
  }

  const metricPaths = options.metricPaths ?? DEFAULT_METRIC_PATHS;
  const steps: BaselineStep[] = [];

  for (let i = 0; i < stepCount; i++) {
    const entries = runs.map((r) => r[i]);
    steps.push(aggregateStep(entries, i + 1, metricPaths));
  }

  return {
    schemaVersion: CURRENT_BASELINE_SCHEMA_VERSION,
    script: options.script,
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    appVersion: options.appVersion,
    sampleSize: runs.length,
    driftRules: { ...(options.driftRules ?? DEFAULT_DRIFT_RULES) },
    steps,
  };
}

function aggregateStep(
  entries: readonly RecorderStepInput[],
  fallbackNumber: number,
  metricPaths: readonly string[],
): BaselineStep {
  const first = entries[0];
  for (const e of entries) {
    if (e.step !== first.step) {
      throw new Error(`aggregateStep: step title mismatch across runs ("${first.step}" vs "${e.step}")`);
    }
    if (e.isManual !== first.isManual) {
      throw new Error(`aggregateStep: isManual mismatch across runs for step "${first.step}"`);
    }
  }

  const { stepNumber, stepTitle } = parseStepTitle(first.step, fallbackNumber);

  if (first.isManual) {
    return {
      stepNumber,
      stepTitle,
      isManual: true,
      assertionMode: first.assertionMode,
      toolSequences: null,
      toolCallCount: null,
      durationMs: null,
      metricDeltas: {},
      assertionPassRate: 1.0,
      assertionCount: 0,
    };
  }

  const sequences = entries.map((e) => e.toolCards);
  const toolCounts = entries.map((e) => e.toolCards.length);
  const durations = entries.map((e) => e.durationMs).filter((d): d is number => d !== null);

  const toolSequences = computeSequenceStats(sequences);
  const toolCallCount = computeStats(toolCounts);
  const durationMs = computeStats(durations);

  const metricDeltas: Record<string, QuantileStats> = {};
  for (const path of metricPaths) {
    const deltas: number[] = [];
    for (const e of entries) {
      const before = readPath(e.metricsBefore, path);
      const after = readPath(e.metricsAfter, path);
      if (typeof before === 'number' && typeof after === 'number') {
        deltas.push(after - before);
      } else if (before === undefined && after === undefined) {
        // sparse-map convention — skip
      } else {
        deltas.push((typeof after === 'number' ? after : 0) - (typeof before === 'number' ? before : 0));
      }
    }
    if (deltas.length > 0) {
      const stats = computeStats(deltas);
      if (stats) metricDeltas[path] = stats;
    }
  }

  const rates = entries.map((e) => {
    if (!e.assertions || e.assertions.length === 0) return 1.0;
    const passed = e.assertions.filter((a) => a.passed).length;
    return passed / e.assertions.length;
  });
  const assertionPassRate = rates.reduce((acc, r) => acc + r, 0) / rates.length;
  const assertionCount = first.assertions?.length ?? 0;

  return {
    stepNumber,
    stepTitle,
    isManual: false,
    assertionMode: first.assertionMode,
    toolSequences,
    toolCallCount,
    durationMs,
    metricDeltas,
    assertionPassRate,
    assertionCount,
  };
}

function parseStepTitle(raw: string, fallbackNumber: number): { stepNumber: number; stepTitle: string } {
  const match = raw.match(/^(\d+)\.\s*(.+)$/);
  if (match) {
    return { stepNumber: Number.parseInt(match[1], 10), stepTitle: match[2].trim() };
  }
  return { stepNumber: fallbackNumber, stepTitle: raw };
}

/**
 * Read a dotted/bracketed path out of a MetricsSnapshot-shaped object.
 * Supports dot notation (`tools.callCount`) and bracket indexing
 * (`judge.skippedByReason['no-connector']`). Returns undefined if any
 * segment is missing — sparse-map convention, never throws.
 */
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
