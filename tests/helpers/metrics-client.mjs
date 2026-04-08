/**
 * MetricsRegistry test client (Fase 4 / Task 4.8).
 *
 * Thin wrapper over `window.api.__testGetMetrics` / `__testResetMetrics`,
 * exposed by preload.ts only when the app is built with BOTTEGA_AGENT_TEST=1.
 *
 * Used by:
 *   • qa-runner.mjs to capture metricsBefore/metricsAfter around each step
 *   • Playwright agent tests to assert on judge counters and tool counts
 *   • metric / metric_growth assertions in the QA DSL
 *
 * Usage:
 *   import { getMetrics, resetMetrics, snapshotMetrics, diffMetrics } from './metrics-client.mjs';
 *
 *   await resetMetrics(page);
 *   const before = await snapshotMetrics(page, 'before');
 *   // ...trigger work...
 *   const after = await snapshotMetrics(page, 'after');
 *   const delta = diffMetrics(before, after);
 *   expect(delta['judge.triggeredTotal']).toBeGreaterThan(0);
 */

/**
 * Wire-format version. Bumped in lockstep with `MetricsSnapshot.schemaVersion`
 * in src/main/metrics-registry.ts. If a snapshot returns a different version
 * the helpers throw loudly so test failures point at the schema drift, not at
 * a downstream "undefined property" stack trace.
 */
export const EXPECTED_METRICS_SCHEMA = 1;

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('../../src/main/metrics-registry.js').MetricsSnapshot>}
 */
export async function getMetrics(page) {
  const snap = await page.evaluate(() => {
    if (typeof window === 'undefined' || !window.api?.__testGetMetrics) {
      return { __missing: true };
    }
    return window.api.__testGetMetrics();
  });
  if (snap?.__missing) {
    throw new Error(
      'getMetrics: window.api.__testGetMetrics is undefined. ' +
        'Rebuild the app with BOTTEGA_AGENT_TEST=1 (esbuild bakes the env var).',
    );
  }
  if (!snap || typeof snap !== 'object') {
    throw new Error(`getMetrics: snapshot is not an object (got ${typeof snap})`);
  }
  if (snap.schemaVersion !== EXPECTED_METRICS_SCHEMA) {
    throw new Error(
      `getMetrics: schema mismatch — runner expects v${EXPECTED_METRICS_SCHEMA}, ` +
        `got v${snap.schemaVersion}. Bump EXPECTED_METRICS_SCHEMA in metrics-client.mjs ` +
        'and re-read docs/test-metrics-schema.md for the new contract.',
    );
  }
  return snap;
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ ok: true }>}
 */
export async function resetMetrics(page) {
  const result = await page.evaluate(() => {
    if (typeof window === 'undefined' || !window.api?.__testResetMetrics) {
      return { __missing: true };
    }
    return window.api.__testResetMetrics();
  });
  if (result?.__missing) {
    throw new Error(
      'resetMetrics: window.api.__testResetMetrics is undefined. Rebuild with BOTTEGA_AGENT_TEST=1.',
    );
  }
  return result;
}

/**
 * Poll the registry until `predicate(snapshot)` returns truthy or timeout.
 * Throws with the last snapshot attached if it never converges.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(snap: any) => boolean} predicate
 * @param {{ timeoutMs?: number, intervalMs?: number, label?: string }} [opts]
 */
export async function waitForMetric(page, predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 100;
  const label = opts.label ?? 'predicate';
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await getMetrics(page);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const err = new Error(`waitForMetric: ${label} did not converge in ${timeoutMs}ms`);
  err.lastSnapshot = last;
  throw err;
}

/**
 * Snapshot with a label, returned in a small wrapper so callers can pass it
 * straight to diffMetrics() without losing context in failure messages.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
export async function snapshotMetrics(page, label) {
  const snap = await getMetrics(page);
  return { label, snap };
}

/**
 * Shallow scalar diff between two snapshots. Returns a flat object keyed by
 * dotted path so test assertions can be written as:
 *   expect(diff['judge.triggeredTotal']).toBe(1);
 *
 * Only counters and process.* are diffed — slots/ws are point-in-time state,
 * not deltas. To assert on slot/ws state, read the after snapshot directly.
 *
 * Accepts either bare snapshots or {label, snap} wrappers from snapshotMetrics.
 */
export function diffMetrics(before, after) {
  const a = before?.snap ?? before;
  const b = after?.snap ?? after;
  if (!a || !b) throw new Error('diffMetrics: both snapshots required');

  const diff = {};
  const scalarPaths = [
    ['judge.triggeredTotal', a.judge.triggeredTotal, b.judge.triggeredTotal],
    ['judge.skippedTotal', a.judge.skippedTotal, b.judge.skippedTotal],
    ['judge.verdictCounts.PASS', a.judge.verdictCounts.PASS, b.judge.verdictCounts.PASS],
    ['judge.verdictCounts.FAIL', a.judge.verdictCounts.FAIL, b.judge.verdictCounts.FAIL],
    ['judge.verdictCounts.UNKNOWN', a.judge.verdictCounts.UNKNOWN, b.judge.verdictCounts.UNKNOWN],
    ['tools.callCount', a.tools.callCount, b.tools.callCount],
    ['tools.errorCount', a.tools.errorCount, b.tools.errorCount],
    ['turns.totalStarted', a.turns.totalStarted, b.turns.totalStarted],
    ['turns.totalEnded', a.turns.totalEnded, b.turns.totalEnded],
    ['process.rssBytes', a.process.rssBytes, b.process.rssBytes],
    ['process.heapUsedBytes', a.process.heapUsedBytes, b.process.heapUsedBytes],
  ];
  for (const [path, av, bv] of scalarPaths) {
    diff[path] = bv - av;
  }

  // Per-reason judge skip deltas — union of keys.
  const reasons = new Set([
    ...Object.keys(a.judge.skippedByReason || {}),
    ...Object.keys(b.judge.skippedByReason || {}),
  ]);
  for (const reason of reasons) {
    const av = a.judge.skippedByReason[reason] ?? 0;
    const bv = b.judge.skippedByReason[reason] ?? 0;
    diff[`judge.skippedByReason.${reason}`] = bv - av;
  }

  return diff;
}

/**
 * Resolve a dotted path against a snapshot. Returns undefined for missing
 * paths so assertion evaluators can distinguish "0" from "not present".
 *
 * Examples:
 *   readPath(snap, 'judge.triggeredTotal')                   → number
 *   readPath(snap, "judge.skippedByReason['no-connector']")  → number
 *   readPath(snap, 'tools.byName.figma_set_fills.calls')     → number
 */
export function readPath(snap, path) {
  if (!snap || typeof path !== 'string') return undefined;
  // Normalize bracket-quoted segments to dot segments: foo['bar-baz'] → foo.bar-baz
  const normalized = path.replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1').replace(/\[(\d+)\]/g, '.$1');
  let cur = snap;
  for (const seg of normalized.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Sample the registry at a fixed interval for `durationMs`. Useful for
 * stress tests that want to detect counter drift or memory growth over time.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} durationMs
 * @param {number} [intervalMs=500]
 */
export async function recordMetricsTimeline(page, durationMs, intervalMs = 500) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    samples.push({ t: Date.now() - start, snap: await getMetrics(page) });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return samples;
}
