# Calibration Workflow

**Status**: Day 5 Fase 2 deliverable
**Used by**: engineers tightening or loosening assertion thresholds in `tests/qa-scripts/*.md`
**Spec**: `QA-PIANO-MIGLIORAMENTO.md` §4.8 (Calibration step)

---

## Why calibrate

LLM agents are non-deterministic. Two runs of the same prompt against the same app version can produce:

- Different tool selections (e.g. `figma_render_jsx` vs `figma_execute` for the same creation intent)
- Different durations (network latency, model warm-up, judge overhead)
- Different response phrasings (within the same semantic content)

If we hardcode an assertion like `tools_called: [figma_render_jsx]` based on a single observation, the runner will produce **false positives** the next time the agent picks `figma_execute` instead — even though the behaviour is correct.

**Calibration runs each migrated script N times against a fixed app version**, aggregates the per-step variance, and outputs a JSON report (`<NN>-calibration.json`) that the engineer reads to set safe thresholds.

---

## When to calibrate

- **Before merging** a newly migrated script (Fase 2 Day 4 acceptance criterion).
- **After upgrading** `pi-coding-agent` or `pi-ai` (different model behaviour may shift tool selection).
- **After changing the system prompt** in `src/main/system-prompt.ts`.
- **After tightening an assertion** that started producing false positives.
- **NOT after every regular QA run** — calibration is opt-in only (`--calibrate N`), the default is single-run mode.

---

## How to run

```bash
# Calibrate Script 02 with 3 sequential runs
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --calibrate 3

# Calibrate multiple scripts in one invocation
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --script 04 --calibrate 3

# Custom output dir
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 14 --calibrate 5 --output /tmp/qa-cal-14
```

**Output structure**:

```
/tmp/bottega-qa/
├── run-1/
│   ├── 02-metadata.json
│   ├── 02-assertions.json
│   ├── 02-step-1.png
│   └── ...
├── run-2/
│   └── ... (same shape)
├── run-3/
│   └── ...
└── 02-calibration.json   ← THE FILE YOU READ
```

**Default N**: 3. Less than 3 is statistically meaningless. More than 5 is overkill for non-stress tests.

**Time cost**: each run takes ~5-10 minutes for a small script (02), up to ~25 minutes for a stress script (25). Calibration multiplies this by N. Plan accordingly.

---

## Reading `<NN>-calibration.json`

The aggregated report has this shape:

```json
{
  "script": "02",
  "runs": 3,
  "timestamp": "2026-04-08T10:30:00.000Z",
  "steps": [
    {
      "step": 4,
      "stepTitle": "Send a creation prompt",
      "assertionMode": "strict",
      "runs": 3,
      "durationMs": [48210, 51430, 49012],
      "durationP95": 51430,
      "durationRecommendedCap": 77145,
      "toolsCalledUnion": ["figma_render_jsx", "figma_screenshot"],
      "toolsCalledIntersection": ["figma_render_jsx"],
      "assertionsEvery": ["tools_called", "screenshots_min", "duration_max_ms"],
      "assertionsFlaky": []
    }
  ]
}
```

### Field decoder

| Field | Meaning | What to do |
|---|---|---|
| `runs` | How many runs aggregated (= `--calibrate N`) | Should match the flag value |
| `durationMs` | Array of wall-clock durations for this step across runs | Inspect outliers — a 4× spike on one run hints at a flaky tool or network blip |
| `durationP95` | 95th percentile of `durationMs` | Reference point for cap |
| `durationRecommendedCap` | `ceil(p95 × 1.5)` | **Use this as `duration_max_ms` in the assertion** |
| `toolsCalledUnion` | Set of all tools called across at least one run (lowercased) | All members are *possible* tool choices |
| `toolsCalledIntersection` | Set of tools called in **every** run | All members are *guaranteed* tool choices |
| `assertionsEvery` | Assertions that passed in every run (= stable) | Safe to keep as-is |
| `assertionsFlaky` | Assertions with mixed pass/fail across runs (= unstable) | Investigate and fix or relax |

### Decision tree

```
For each step in the calibration JSON:

  1. Check assertionsFlaky:
     - If non-empty → there's a problem. Either the assertion is wrong, or the
       step's behaviour is genuinely non-deterministic. INVESTIGATE before
       merging. Do NOT just relax — figure out why one run differs.

  2. Check toolsCalledUnion vs toolsCalledIntersection:
     - First, exclude AMBIENT/VERIFICATION tools (e.g. figma_screenshot called
       after every creation, figma_status called optionally for sanity) from
       both sets — these are side-effects, not intent-carrying choices, and
       leaving them in pollutes the comparison. Document the exclusion in the
       step comment so future calibrators know why.
     - If they're EQUAL (after exclusion) → the agent always picks the same
       tools. Keep `tools_called: [intersection]`.
     - If union > intersection → the agent picks different tools across runs.
       → Switch to `tools_called_any_of: [union]` (NOT `tools_called`).
       → If a tool is in union but rarely used (1/N runs), it's optional —
         probably safe to keep in any_of.

  3. Check durationP95:
     - If `durationRecommendedCap` > current `duration_max_ms` → the cap is too
       tight. Update the assertion to `durationRecommendedCap`.
     - If `durationRecommendedCap` is much less than current cap (e.g. 2x less)
       → consider tightening, but only if the step is reliably fast across all
       observed runs.

  4. Check assertionsEvery:
     - If a P1 assertion is missing from this list → it's not consistently
       applicable. Relax or remove.
```

### Examples

**Example 1** — Script 02 step 4 (creation):

```json
{
  "step": 4,
  "toolsCalledUnion": ["figma_render_jsx", "figma_execute", "figma_screenshot"],
  "toolsCalledIntersection": ["figma_screenshot"],
  "durationMs": [48210, 51430, 49012],
  "durationP95": 51430,
  "durationRecommendedCap": 77145,
  "assertionsEvery": ["tools_called_any_of", "screenshots_min", "duration_max_ms", "tools_NOT_called_more_than"],
  "assertionsFlaky": []
}
```

Decisions:
- `toolsCalledUnion ⊃ toolsCalledIntersection` → keep `tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]`. The intersection is `[figma_screenshot]` only because the agent always takes a verification screenshot — that's a separate concern, not the creation tool.
- `durationRecommendedCap = 77145 ms` ≈ 77s → current cap is `90000 ms`. Slightly loose — could tighten to `80000`, but the buffer is fine.
- `assertionsFlaky: []` → all stable. No action.

**Example 2** — Script 14 step 2 (judge sentinel — B-018):

```json
{
  "step": 2,
  "toolsCalledUnion": ["figma_render_jsx", "figma_screenshot"],
  "toolsCalledIntersection": ["figma_render_jsx", "figma_screenshot"],
  "durationMs": [85120, 89540, 91230],
  "durationP95": 91230,
  "durationRecommendedCap": 136845,
  "assertionsEvery": ["tools_called_any_of", "screenshots_min", "response_contains", "duration_max_ms"],
  "assertionsFlaky": []
}
```

Decisions:
- Tools stable across all 3 runs → keep `tools_called_any_of` (still safer for forward compat).
- `durationRecommendedCap = 137s` > current cap `120000`. The cap is **too tight**! Apply the canonical formula `ceil(p95 × 1.5) = 137s` and round up to `140000` (140s). The 1.5× rule documented at line 102 is the canonical default — do NOT use a tighter buffer (e.g. 1.1×) without explicit justification, since that hides genuine flake.
- `response_contains: [quality check]` is in `assertionsEvery` → B-018 sentinel is reliable across runs. ✅

**Example 3** — flaky assertion to investigate:

```json
{
  "step": 6,
  "toolsCalledUnion": ["figma_execute", "figma_render_jsx", "figma_screenshot"],
  "toolsCalledIntersection": ["figma_execute"],
  "assertionsEvery": ["tools_called", "duration_max_ms"],
  "assertionsFlaky": [
    {"name": "tools_NOT_called_more_than", "results": [true, true, false]}
  ]
}
```

Decisions:
- `tools_NOT_called_more_than` failed 1 out of 3 runs. **Do not just relax the cap** — investigate: did the agent call `figma_screenshot` 3 times instead of 2 in run 3? Was there a tool result error that triggered a retry? Check `run-3/06-metadata.json` for the actual tool call sequence.
- If the extra call was a one-off retry (e.g. judge re-trigger), the cap is correct and the test is valuable — flakiness is the bug, not the assertion.
- If the extra call is normal variance, raise the cap by 1 (e.g. `figma_screenshot: 3`).

---

## Calibration output is advisory, not authoritative

The calibration JSON is a **starting point for human judgement**, not an automated rewriter. The script does NOT modify your assertions for you. You read the report, decide what to change, edit the markdown manually, and re-run calibration to verify stability.

This is intentional: an automated rewriter would make the assertions drift toward "pass everything" over time, defeating the purpose of the assertion DSL.

---

## Worked example: full calibration of Script 02

```bash
# Step 1: Run calibration
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --calibrate 3

# Step 2: Inspect the report
cat /tmp/bottega-qa/02-calibration.json | jq '.steps[] | {step, durationP95, durationRecommendedCap, assertionsFlaky}'

# Step 3: Compare against current assert blocks
grep -A 10 '```assert' tests/qa-scripts/02-happy-path.md

# Step 4: Update tests/qa-scripts/02-happy-path.md based on findings
#   - Adjust duration_max_ms to durationRecommendedCap
#   - Switch tools_called → tools_called_any_of where union > intersection
#   - Keep notes in CALIBRATION.md (this file) for the script

# Step 5: Re-calibrate to verify stability
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --calibrate 3

# Step 6: Confirm assertionsFlaky is empty for all steps
cat /tmp/bottega-qa/02-calibration.json | jq '.steps[].assertionsFlaky'
# Expected: every step shows []
```

---

## Calibration log

This section records calibration runs done during script migration. Append new entries here for traceability.

### Pending entries

The 5 migrated scripts (02, 04, 09, 11, 14) **have not yet been calibrated**. Calibration requires a live Bottega instance with Figma Desktop Bridge connected — this is the next step before declaring the assertion blocks production-ready. Document the results here:

```markdown
## 02-happy-path — calibrated YYYY-MM-DD against git SHA <sha>
- Step 1: stable, p95=N ms, no changes
- Step 4: union > intersection → switched from `tools_called` to `tools_called_any_of`, cap unchanged
- Step 6: stable, p95=N ms
```

(empty until first calibration session)

---

## References

- `tests/qa-scripts/ASSERTION-DSL.md` — DSL spec
- `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` — `--calibrate N` flag implementation + `writeCalibrationJson`
- `QA-PIANO-MIGLIORAMENTO.md` §4.8 — Calibration step rationale
- `QA-PIANO-MIGLIORAMENTO.md` §4.9 — Rollback strategy if calibration reveals systemic flakiness
