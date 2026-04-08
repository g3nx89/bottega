# Test Metrics Schema (v1)

> Wire contract for the `MetricsRegistry` snapshot exposed via the
> `BOTTEGA_AGENT_TEST=1` IPC channel. Implemented in Fase 4 of the QA pipeline
> rebuild. See `src/main/metrics-registry.ts` for the source of truth.

## Purpose

`MetricsRegistry` is a synchronous, test-observable view of Bottega's runtime
state. It is **not** part of the production analytics path — production
telemetry stays in `UsageTracker` (Axiom). The registry exists so QA tests can
make hard, deterministic assertions on judge behavior, tool counts, slot state,
and process memory **without** scraping logs or polling DOM.

The two consumers are:

1. **`tests/helpers/metrics-client.mjs`** — Playwright client used by E2E tests
   and the QA runner.
2. **`metric` / `metric_growth` assertions** in the QA DSL
   (`tests/qa-scripts/ASSERTION-DSL.md` §3.2).

## Activation

The IPC handlers and preload bindings are gated on `process.env.BOTTEGA_AGENT_TEST`
at build time (esbuild bakes the env var into both `dist/main.js` and
`dist/preload.js`). To enable:

```bash
BOTTEGA_AGENT_TEST=1 npm run build
BOTTEGA_AGENT_TEST=1 npm start
```

In production builds (no env var), `window.api.__testGetMetrics` is `undefined`
and the IPC handlers `test:get-metrics` / `test:reset-metrics` are not
registered. There is **no** runtime path to read the registry from production.

## Snapshot Schema (`schemaVersion: 1`)

```typescript
interface MetricsSnapshot {
  schemaVersion: 1;
  capturedAt: number;          // Date.now() at capture
  captureElapsedMs: number;    // self-reported snapshot duration
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    uptimeSec: number;         // process.uptime() rounded
  };
  slots: Array<{
    id: string;
    fileKey: string | null;
    fileName: string | null;
    isStreaming: boolean;
    queueLength: number;
    turnIndex: number;
    lastCompletedTurnIndex: number;
    lastContextTokens: number | null;     // null when never updated
    sessionToolHistorySize: number;
    lastTurnToolNames: string[];
    lastTurnMutatedNodeIdCount: number;
    judgeOverride: boolean | null;
    judgeInProgress: boolean;
  }>;
  judge: {
    inProgressSlotIds: string[];
    triggeredTotal: number;                       // judge actually invoked
    skippedTotal: number;                         // sum of skippedByReason
    skippedByReason: Partial<Record<JudgeSkipReason, number>>; // sparse: key absent until first fire
    verdictCounts: { PASS: number; FAIL: number; UNKNOWN: number };
    // verdictCounts records ONLY terminal verdicts — one entry per judge turn
    // after all retries resolve. Intermediate FAILs in a retry loop do not
    // contribute (e.g. FAIL attempt 1 → PASS attempt 2 increments PASS by 1,
    // FAIL by 0). This keeps the counter baseline-diff friendly: two runs of
    // the same script should produce identical verdictCounts regardless of
    // how many retries happened internally. Per-attempt history lives in
    // usageTracker (analytics-oriented) instead.
  };
  tools: {
    callCount: number;
    errorCount: number;
    byName: Record<string, { calls: number; errors: number; totalDurationMs: number }>;
  };
  turns: {
    totalStarted: number;
    totalEnded: number;
  };
  ws: {
    activeFileKey: string | null;
    connectedFiles: Array<{ fileKey: string | null; fileName: string; isActive: boolean }>;
  };
}
```

## Versioning rules

- **`schemaVersion`** is bumped on **any** breaking change: removed field,
  renamed field, or changed type.
- The client (`metrics-client.mjs#EXPECTED_METRICS_SCHEMA`) holds the version
  it was written against and **throws loudly** on mismatch. There is no
  graceful fallback — schema drift fails fast.
- Adding new fields is **non-breaking** if existing fields keep their shape.
- Test scripts that depend on a specific shape should reference the field via
  `metric` / `metric_growth` paths so the test failure points at the missing
  field, not at runtime crashes.

## Common use cases

### B-018 regression sentinel

The original B-018 bug was a silently-skipped judge: when `slot.fileKey` was
null and the user requested a judge run, the harness logged a warning and
returned without telling the renderer. The metric path makes this observable:

```yaml
# Step expected to trigger the judge
assert:
  metric:
    path: "judge.skippedByReason['no-connector']"
    op: "=="
    value: 0
  metric_growth:
    path: "judge.triggeredTotal"
    minGrowth: 1
```

If the regression returns, `skippedByReason['no-connector']` increments and
the assertion fails with a precise error message instead of a vague DOM check.

### Memory leak detection

```javascript
import { snapshotMetrics, diffMetrics } from './metrics-client.mjs';

const before = await snapshotMetrics(page, 'before-batch');
// ... 25 prompts ...
const after = await snapshotMetrics(page, 'after-batch');
const delta = diffMetrics(before, after);
expect(delta['process.heapUsedBytes']).toBeLessThan(50 * 1024 * 1024); // < 50 MB
```

### Judge coverage

Track that every mutating step actually invokes the judge:

```yaml
assert:
  metric_growth:
    path: "judge.verdictCounts.PASS"
    minGrowth: 1
```

### Queue saturation

Detect when the OperationQueue isn't draining between turns:

```yaml
assert:
  metric:
    path: "slots.0.queueLength"
    op: "<="
    value: 2
```

(Indexed slot access uses bracket syntax: `slots[0].queueLength` and
`slots.0.queueLength` both work.)

### Tool usage budget

Catch agent loops that fire one tool way too many times:

```yaml
assert:
  metric_growth:
    path: "tools.byName.figma_screenshot.calls"
    maxGrowth: 3
```

## Performance

`snapshot()` is constant-time in the number of slots and tool names — both are
small (≤4 slots, ~50 distinct tools in a long session). Measured perf budget:

- **Mean**: < 10 ms per call (target), measured ~0.07 ms on M-series MacBooks
- **p99**: < 25 ms per call (target), measured ~1.8 ms

The QA runner calls `getMetrics()` twice per step. For a 25-step script that's
50 calls per run × ~0.1 ms = 5 ms total. Negligible compared to the prompt
latency.

See `tests/unit/main/metrics-registry.perf.test.ts` for the perf gate.
