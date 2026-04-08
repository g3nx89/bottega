# UX Baselines — Qualitative Regression Oracle

**Status**: Fase 3b of QA pipeline rebuild (2026-04-09)
**Consumes**: Pass 2 `ux-reviewer` (Opus) JSON output
**Companion doc**: `qa-baselines.md` (runtime baseline — the complementary sensor)

## Why

Runtime baselines (`qa-baselines.md`) catch objective drift: a step that used
to call 2 tools now calls 8, durations regress, metric deltas shift. But the
numbers are blind to *qualitative* degradation:

- Agent responses used to be concise and informative; now they're 400 words of
  filler and the user has to scroll past the essay to see the screenshot.
- Visual output used to be pixel-aligned; now elements drift by 3-5 px in a
  subtle way that no assertion catches because the tool call succeeded.
- The "streaming" indicator stopped appearing during long operations — every
  functional assertion still passes, but users think the app is stuck.

These are things only a human (or an Opus-class reviewer looking at
screenshots) catches. UX baselines turn that reviewer into a deterministic
oracle by asking it to score 5 dimensions 1-5 per script and list issues with
stable IDs — then comparing current run against a committed baseline.

## Architecture

```
/tmp/bottega-qa/NN-metadata.json  + screenshots        (from Pass 1 runner)
                    │
                    ▼
      Pass 2 ux-reviewer (Opus via Agent tool)
                    │
                    ├─▶ /tmp/bottega-qa/ux-review.md    (human-readable)
                    └─▶ /tmp/bottega-qa/ux-review.json  (machine-readable, UXReview schema)
                                 │
                                 ▼
           ux-baseline-cli.mjs validate → fails loud on schema violations
                                 │
                                 ▼
                      ux-baseline-cli.mjs diff
                                 │
                                 ▼
             tests/qa-scripts/baselines/ux-baseline.json  (committed anchor)
                                 │
                                 ▼
                     /tmp/bottega-qa/ux-drift.json  (report)
```

All drift detection lives in `tests/helpers/ux-baseline/{schema,differ}.ts`
as pure functions (JSON in, JSON out). The CLI (`.claude/skills/…/scripts/
ux-baseline-cli.mjs`) is a thin orchestrator that loads the TS modules via
the shared `qa-baseline-loader.mjs` esbuild bridge.

## UX Review shape (schemaVersion 1)

```typescript
interface UXReview {
  schemaVersion: 1;
  runId: string;                // 'run-<ISO-timestamp>'
  timestamp: string;            // ISO-8601
  appVersion: string;           // from package.json

  overallScore: number;         // 1-5, mean of per-script scores
  scriptScores: Record<string, {
    script: string;
    score: number;              // 1-5, mean of 5 dimensionScores
    stepCount: number;
    issueCount: number;
    dimensionScores: {
      visualQuality: number;    // 1-5
      responseClarity: number;  // 1-5
      toolSelection: number;    // 1-5
      uxCoherence: number;      // 1-5
      feedbackQuality: number;  // 1-5
    };
  }>;

  issues: Array<{
    id: string;                 // 'UX-<8 hex>' — deterministic from (script,step,desc)
    severity: 'alta' | 'media' | 'bassa';
    script: string;
    step: string;
    description: string;
    category: 'tool_selection' | 'response_quality' | 'visual' | 'feedback' | 'performance';
  }>;
}
```

The `UXBaseline` type is a type alias for `UXReview` — a baseline is just a
blessed review that has been committed as the healthy steady-state anchor.

### Issue IDs

IDs must be `UX-<8 hex chars>` computed deterministically from
`(script, step, description.trim().toLowerCase())`. The `computeUXIssueId`
function in `tests/helpers/ux-baseline/differ.ts` exports the canonical
algorithm (FNV-1a two-pass → 8 hex). The ux-reviewer prompt in `SKILL.md`
instructs the LLM to compute these itself; if the LLM cannot compute
them reliably, sequential IDs are acceptable as a fallback and the
diff will treat them as new/fixed issues every run until stabilized.

### Categories and severities

Categories are a **closed enum**. If an issue doesn't fit, force the closest
match instead of inventing new categories — the differ rejects unknown values.

Severities match BUG-REPORT.md vocabulary (`alta`/`media`/`bassa`) so human
triage is consistent across functional bugs and UX issues.

## Diff rules

```typescript
interface UXDiffRules {
  regressionOverall: number;    // default 0.3 — drop in overallScore
  regressionScript: number;     // default 0.5 — drop in any scriptScore
  regressionDimension: number;  // default 0.5 — drop in any dimension of any script
}
```

A drop is detected when `current - baseline < -threshold`. Improvements (positive
deltas) are never flagged as drift.

Rationale for defaults (Fase 3 plan §5): the regression thresholds must be
strictly greater than the measured LLM variance (Fase 3 Task 3.2a). The 0.3
overall threshold assumes per-dimension variance stays under 0.3 during
calibration. If variance exceeds that, thresholds must be raised or the
reviewer prompt refined.

### Verdict rules

| Condition | Verdict |
|---|---|
| Baseline is null | `BASELINE_MISSING` (exit 2) |
| `schemaVersion` mismatch | `SCHEMA_MISMATCH` (exit 1) |
| Any score drop beyond threshold | `DRIFT` (exit 1) |
| New issue with `severity: 'alta'` | `DRIFT` (exit 1) |
| Severity escalation (bassa→media, media→alta) | `DRIFT` (exit 1) |
| New `media` / `bassa` issues only | `OK` (exit 0) — too noisy |
| Severity de-escalation | `OK` — that's a good thing |
| Fixed issues | `OK` — informational |
| Otherwise | `OK` (exit 0) |

**Why don't new `media`/`bassa` issues trip the verdict?** The LLM reviewer has
intrinsic variance on borderline cases. Flagging every new low-severity finding
as a regression would make the oracle unusable because the steady-state false
positive rate would dwarf the true positives. Instead, they appear in the
report (`summary.newIssues`) so a human can scan them without the pipeline
exiting 1.

## Drift report shape

```typescript
interface UXDiffReport {
  baselineRunId: string;
  baselineTimestamp: string;
  currentRunId: string;
  currentTimestamp: string;
  verdict: 'OK' | 'DRIFT' | 'BASELINE_MISSING' | 'SCHEMA_MISMATCH';
  overallDelta: number;
  findings: UXDiffFinding[];
  summary: {
    newIssues: number;
    fixedIssues: number;
    changedSeverity: number;
    regressionCount: number;
  };
}

interface UXDiffFinding {
  category:
    | 'overall_score_drop'
    | 'script_score_drop'
    | 'dimension_score_drop'
    | 'new_issue'
    | 'fixed_issue'
    | 'changed_severity';
  script?: string;
  dimension?: string;
  issueId?: string;
  baseline?: number;
  current?: number;
  delta?: number;
  message: string;
  severity?: 'alta' | 'media' | 'bassa';
}
```

## CLI usage

All commands are run from the project root:

```bash
# Validate a Pass 2 ux-review JSON against the schema (no baseline needed).
# Exits 1 on schema violations, 0 on valid.
node .claude/skills/bottega-dev-debug/scripts/ux-baseline-cli.mjs \
  validate /tmp/bottega-qa/ux-review.json

# Diff current review against committed baseline.
# Writes /tmp/bottega-qa/ux-drift.json.
# Exit 0=OK, 1=DRIFT, 2=BASELINE_MISSING.
node .claude/skills/bottega-dev-debug/scripts/ux-baseline-cli.mjs \
  diff /tmp/bottega-qa/ux-review.json

# Promote a review to the committed baseline (rare — only when drift is intentional).
node .claude/skills/bottega-dev-debug/scripts/ux-baseline-cli.mjs \
  record /tmp/bottega-qa/ux-review.json
git add tests/qa-scripts/baselines/ux-baseline.json
git commit -m "qa: refresh UX baseline after <reason>"
```

## When to (re)record a baseline

- **Initial bootstrap**: after Fase 3b variance calibration (Task 3.2a) confirms
  per-dimension variance < 0.3, freeze a review as the first baseline.
- **After intentional behavior changes**: model swap, agent prompt rewrite,
  renderer redesign. The drift is expected and desired — refreshing the anchor
  locks it in.
- **Never**: after a regression. The baseline is the "healthy state" anchor.
  Refreshing it against a degraded state hides the regression instead of
  fixing it.

## Variance calibration

Before the oracle is trustworthy, the variance of the LLM reviewer must be
measured. Run the ux-reviewer 3× on the same screenshots (same runId),
compute per-dimension stddev across the three runs, and confirm each
dimension's std deviation is < 0.3. If any dimension exceeds that, refine
the reviewer prompt in `SKILL.md` (more anchoring language, more explicit
scoring rubric) and repeat.

Results are documented in `tests/qa-scripts/baselines/ux-variance-baseline.md`
(not yet created — that's Fase 3b Task 3.2a, a live task deferred from this
code-only session).

## Relation to Runtime Baseline (Fase 3)

| Sensor | Watches | Diff source |
|---|---|---|
| Runtime Baseline | Tool sequences, timings, metrics deltas | `MetricsRegistry.snapshot()` + qa-runner stepMeta |
| UX Oracle Baseline | Qualitative LLM scores, issue list | Pass 2 ux-reviewer JSON output |

A healthy pipeline runs both. A regression in one is not necessarily visible
in the other — e.g., a pure copywriting regression in agent responses won't
move any runtime metric but will show up as a `responseClarity` drop on the
UX oracle; conversely, a silent slowdown where tool count stays stable but
p95 duration doubles won't affect UX scores but will trip the runtime
baseline's `duration` drift check.

Both CLIs share `qa-baseline-loader.mjs` as the esbuild→data-URL bridge that
lets `.mjs` scripts in `.claude/` load committed TypeScript helpers.

## Failure modes

| Scenario | Behavior |
|---|---|
| Reviewer emits malformed JSON | `validate` exits 1 with path/message per error; `diff` refuses to run |
| Reviewer uses unknown severity or category enum | schema rejection |
| Reviewer score is out of 1-5 range | schema rejection |
| New minority script in current (not in baseline) | reported as `new_issue` findings per issue; script-level stays quiet (runtime baseline catches step count) |
| Script removed from current | current run's summary is smaller but no drift finding — runtime baseline differ handles test coverage regressions |
| High variance across runs (>0.3) | pipeline flags false positives; refine reviewer prompt + recalibrate |
