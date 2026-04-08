# Test Scripts — Agent-Driven Manual QA

Step-by-step test scripts that the coding agent follows while using the live app.
The agent IS the tester: it launches the app, follows the steps, takes screenshots,
and uses its judgment to evaluate results and find subtle issues.

## Execution Constraints

**SEQUENTIAL ONLY** — Scripts must be executed one at a time. No parallel execution.

Why:
- Only one Electron instance can run (singleton lock)
- Port 9280 is exclusive to one WebSocket server
- Figma test files (Bottega-Test_A, Bottega-Test_B) are shared state
- Concurrent canvas mutations would produce unpredictable results

**CLEAN STATE** — Before starting any script:
1. Reset the session (`resetSession(page)` or click New Chat)
2. Clear the Figma canvas on Bottega-Test_A (delete all children of current page)
3. If the script uses Bottega-Test_B, clear that too

The `clearFigmaPage` helper from the agent test harness handles canvas cleanup:
```javascript
import { clearFigmaPage } from '../helpers/agent-harness.mjs';
await clearFigmaPage(win, fileKey);
```

Or via the helpers library:
```javascript
import { launchBottega, resetSession } from '../.claude/skills/bottega-dev-debug/scripts/helpers.mjs';
const { app, page } = await launchBottega();
await resetSession(page);
// Canvas cleanup requires figma_execute via the agent or test oracle IPC
```

## Environment

- **Figma files**: Bottega-Test_A and Bottega-Test_B (always open with Bridge plugin)
- **Auth**: OAuth configured for Anthropic, OpenAI, Google
- **Gemini key**: Required for image generation tests (script 11)

## How to run

There are **two execution modes**:

### Mode A: Deterministic runner (`qa-runner.mjs` — default for CI/automated)

The qa-runner is a Playwright-based deterministic harness that parses each
script's markdown, executes the `Send:` steps automatically, and evaluates
embedded assertion blocks. Use this for automated PASS/FAIL gating and
regression detection.

```bash
# Build first (the runner launches the built Electron binary)
npm run build

# Run a single script
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02

# Run a predefined suite (smoke|pre-release|targeted|full|stress)
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite pre-release

# Calibration mode (run each script N times, aggregate variance)
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --calibrate 3

# Dry run (parse only, no Electron launch — useful for validating script structure)
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02 --dry-run
```

**Output per script** (in `/tmp/bottega-qa/` by default):
- `result-NN.txt` — PASS/FAIL summary with `FAILURES:` block
- `NN-metadata.json` — full step metadata (response, tool cards, screenshot path, assertion mode/results)
- `NN-assertions.json` — structured per-step assertion verdicts
- `NN-step-K.png` — screenshots
- `NN-calibration.json` — only in calibration mode, aggregated variance report

### Mode B: Manual exploratory (`qa-tester` subagent — Sonnet)

Use the `qa-tester` subagent for exploratory testing where the runner can't
go: visual inspection, multi-tab orchestration, stress scenarios, or any
step that requires human-like judgement on quality.

```
Agent tool:
  subagent_type: "qa-tester"
  model: "sonnet"
  prompt: "Build the app, then follow test script 02-happy-path.md
           from tests/qa-scripts/. Clean Figma canvas before starting.
           Figma Desktop is open with Bottega-Test_A and Bottega-Test_B,
           Bridge plugin active."
```

The subagent reads the same markdown scripts but **ignores assertion blocks**
— it follows the human-readable Evaluate bullets and the optional manual
variant notes. Both modes coexist on the same source files.

### Run multiple scripts via qa-tester
```
Agent tool:
  subagent_type: "qa-tester"
  model: "sonnet"
  prompt: "Build the app, then execute these test scripts IN ORDER,
           cleaning state between each: 01-first-launch.md, 02-happy-path.md,
           05-settings-and-controls.md. Scripts are in tests/qa-scripts/."
```

## Assertion DSL (Fase 2)

Migrated scripts contain ` ```assert ` YAML blocks inside selected steps that
the qa-runner evaluates deterministically. See:

- **`ASSERTION-DSL.md`** — full DSL spec, 7 P1 assertion types, parser rules
- **`CALIBRATION.md`** — workflow for tuning assertion thresholds via `--calibrate N`

### PASS / FAIL / SOFT_PASS matrix

| Step has assertions? | Parse error? | Transport success? | `QA_RUNNER_LEGACY_MODE` | Outcome |
|---|---|---|---|---|
| no | no | yes | unset | **SOFT_PASS** (legacy binary heuristic) |
| no | no | no | unset | **FAIL** (transport) |
| yes | no | yes | unset | evaluate → **PASS** or **FAIL** |
| yes | no | no | unset | **FAIL** + assertions evaluated for diagnostic data |
| no | yes | any | unset | **FAIL** loud (parse error in detail) |
| any | any | any | `1` | legacy SOFT_PASS, all assert blocks ignored |

### Migration status

| Script | Auto steps | Migrated steps | Notes |
|---|---|---|---|
| 02-happy-path | 3 | 3 (1, 4, 6) | Step 6 has the **B-021 sentinel** (`#suggestions:not(.hidden)`) |
| 04-error-resilience | 2 | 2 (4, 6) | Error path + tool spam guard |
| 09-styling-and-layout | 8 | 4 (1, 2, 6, 8) | Anti-sequential pattern: `tools_NOT_called_more_than: {figma_set_text: 0}` etc. |
| 11-image-generation | 8 | 3 (1, 6, 8) | `/edit` MUST NOT call `figma_generate_image` (anti-regenerate) |
| 14-judge-and-subagents | 4 | 3 (2, 5, 8) | Steps 2 & 8 have the **B-018 sentinel** (`response_contains: [quality check]`) |
| **Total** | **25** | **15** | **15 assertion blocks** across 5 scripts |

The remaining 20 QA scripts run in legacy SOFT_PASS mode until migrated.
Migration is incremental — adding an assert block to a script does not
require touching any other script.

### Rollback / emergency bypass

If the assertion runner produces a >20% false-positive rate in production:

**Per-script rollback**: delete the `assert` block from the offending script.
The step automatically reverts to SOFT_PASS.

```bash
# Strip all assert blocks from a script (creates .bak)
sed -i.bak '/^```assert$/,/^```$/d' tests/qa-scripts/02-happy-path.md
```

**Global bypass**: set the env var to ignore all assert blocks at runtime
(parser still reads them but evaluator never runs).

```bash
QA_RUNNER_LEGACY_MODE=1 node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02
```

In legacy mode the runner falls back to the binary success heuristic (PASS
if `sendPromptAndWait` returned `success=true`, otherwise FAIL). Useful for
emergency bypass without touching files.

### Regression-detection validation (task 2.13)

The Fase 2 plan requires a one-shot validation that the assertion runner
actually FAILS when a known bug regresses. Because B-018 (judge
auto-trigger) and B-021 (suggestion chips) are both fixed in production,
validation requires a scratch branch that temporarily reverts the fix.

There are two validation forms, both already executed once:

**Simulated (permanent, in CI)** — `tests/unit/qa-tooling/assertion-evaluators.test.ts`
contains a `describe('B-018 regression sentinel (task 2.13 simulated)')`
block that replays the exact step-2 and step-8 assert blocks from
`14-judge-and-subagents.md` through `evaluateAssertions` with two
`stepData` shapes:

- **Healthy**: `responseText` contains "Quality Check · PASS ✓" → all
  four assertions pass.
- **B-018 active**: identical state minus the judge footer → only
  `response_contains` fails, the other three pass. This is the precise
  signature: mutation tools ran, screenshot taken, duration fine, but no
  judge footer.

If this test ever stops failing on the B-018 shape, the sentinel has lost
its teeth and must be re-tuned.

**Live (manual, one-shot)** — executed once during Fase 2 validation.
Procedure for future re-validation (e.g., after major session-events.ts
refactor):

```bash
# 1. Safeguard any uncommitted work
git stash push -u -m "phase2-wip-pre-validation"

# 2. Create scratch branch and re-apply the stash
git checkout -b qa/validate-sentinel
git stash apply   # keeps stash as safety net

# 3. Patch src/main/session-events.ts to disable the auto-judge block.
#    Minimal revert — find the shouldRun assignment in handleAgentEnd:
#    - const shouldRun = slot.judgeOverride === true || (slot.judgeOverride !== false && settings.judgeMode === 'auto');
#    + const shouldRun = false && (slot.judgeOverride === true || ...);

# 4. Rebuild
npm run build

# 5. Run script 14 only (Figma Desktop + Bottega Bridge + Bottega-Test_A required)
mkdir -p /tmp/bottega-qa-validation
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs \
  --script 14 --output /tmp/bottega-qa-validation

# 6. Verify the assertion failure signature — cat the file and confirm:
#    - Step 2: response_contains "quality check" → FAIL
#    - Step 8: response_contains "quality check" → FAIL
#    - tools_called_any_of, screenshots_min, duration_max_ms → all PASS
cat /tmp/bottega-qa-validation/14-assertions.json

# 7. Revert the patch (edit session-events.ts back to the original line)
#    VERIFY with `git status` that session-events.ts is no longer modified
#    before proceeding — checkout main carries uncommitted edits across.

# 8. Return to main and clean up.
#    Note: git branches share the working tree, so the Phase 2 WIP applied
#    in step 2 carries over to main automatically. We use `git stash drop`
#    (NOT `git stash pop`), because the stash content is already in the
#    working tree — popping would conflict on every modified file.
git checkout main
git status                # confirm: phase 2 files modified, no session-events.ts
git stash drop            # WIP already present, discard the safety stash
git branch -D qa/validate-sentinel
```

**Expected outcome** (from the one-shot run on 2026-04-08):

```
SUMMARY 14: 2 passed, 2 failed, 5 manual
Step 2: assertions failed: response_contains (none of any_of matched:
        [quality check] (case_sensitive=false))
Step 8: assertions failed: response_contains (none of any_of matched:
        [quality check] (case_sensitive=false))
```

Two non-obvious points from the validation:

1. The qa-runner script lives under `.claude/` which is gitignored — branch
   switches do not affect it, so `qa-runner.mjs` and `assertion-evaluators.mjs`
   stay in the working tree regardless of the scratch branch. Only the 8
   tracked files under `tests/qa-scripts/` plus the 3 new files under
   `tests/unit/qa-tooling/` need to be stashed.
2. The minimal patch is `shouldRun = false && (...)` not `shouldRun = false`
   alone — the short-circuit preserves type inference and leaves the
   original expression as self-documenting context for the reviewer.

## Scripts

### Core UX (run these first)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 01 | `01-first-launch.md` | First impression, onboarding, connection | Yes | 3m |
| 02 | `02-happy-path.md` | Core creation flow end-to-end | Yes | 5m |
| 03 | `03-conversation-quality.md` | Agent responses, context retention, multi-turn | Yes | 5m |
| 04 | `04-error-resilience.md` | Abort, disconnect, edge cases | Yes | 5m |
| 05 | `05-settings-and-controls.md` | Settings panel, toolbar, keyboard shortcuts | No | 3m |

### Tool Coverage (verify each tool category works)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 06 | `06-discovery-and-analysis.md` | file_data, search, design_system, selection, status | Yes | 5m |
| 07 | `07-creation-and-manipulation.md` | create_child, fills, strokes, text, move, resize, clone, delete | Yes | 8m |
| 08 | `08-components.md` | search, instantiate, set_properties, set_variant, arrange | Yes | 5m |
| 09 | `09-styling-and-layout.md` | auto_layout, text_style, effects, opacity, batch ops | Yes | 8m |
| 10 | `10-design-system.md` | setup_tokens, bind_variable, lint, DS page | Yes | 10m |

### Advanced Features

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 11 | `11-image-generation.md` | All 7 slash commands (/generate, /edit, /icon, etc.) | Yes | 10m |
| 12 | `12-jsx-rendering.md` | render_jsx, create_icon, Tailwind props, nested JSX | Yes | 8m |
| 13 | `13-annotations.md` | get/set annotations, categories, pinned properties | Yes | 3m |
| 14 | `14-judge-and-subagents.md` | Judge auto-trigger, micro-judges, retry, subagent config | Yes | 8m |

### System

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 15 | `15-multi-model.md` | Claude/GPT/Gemini switching, per-tab model, isolation | Yes | 10m |
| 16 | `16-session-persistence-and-queue.md` | Queue edge cases, session reset, app restart, tab isolation | Yes | 8m |
| 17 | `17-image-editing.md` | Image gen/edit/restore, icon gen, pattern gen (Gemini) | Yes | 12m |
| 18 | `18-advanced-creation.md` | Auto-layout, image fills, batch transforms, component set arrange | Yes | 12m |
| 19 | `19-deep-discovery.md` | Component details/deep, component set analysis, library, design system | Yes | 10m |

### Extended Design Sessions (long, multi-turn, high context stress)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 20 | `20-full-page-design.md` | Build a complete landing page section by section | Yes | 25m |
| 21 | `21-design-system-migration.md` | Migrate hardcoded design to token system | Yes | 25m |
| 22 | `22-multi-screen-refactor.md` | Fix inconsistencies across 4 screens | Yes | 30m |
| 23 | `23-component-extraction.md` | Find repeated patterns, extract components | Yes | 20m |
| 24 | `24-cross-file-consistency.md` | Compare and sync designs across both test files | Both | 25m |
| 25 | `25-iterative-refinement.md` | 8+ rounds of feedback and revision on one screen | Yes | 30m |

**Total: 25 scripts**
- Feature scripts (01-16): ~100 minutes
- Extended sessions (20-25): ~155 minutes
- Full suite: ~255 minutes

## Running strategy

- **Quick smoke test**: Scripts 01 + 02 (~8 min)
- **Pre-release QA**: Scripts 01-05 + 14 (~30 min)
- **Feature coverage**: Scripts 01-16 in order (~100 min)
- **Stability stress test**: Scripts 20-25 (~155 min, tests context limits and long sessions)
- **After a specific change**: Run the relevant script only

## Three-Pass QA Architecture

Every QA run uses three complementary passes:

### Pass 1 — Functional Testing (qa-tester, Sonnet)
Automated PASS/FAIL checks via runner scripts. For each agent-interactive step:
- Send prompt via `sendPromptAndWait()`
- Check DOM state, tool cards, connection status
- Take screenshot
- **Save metadata** to `NN-metadata.json` (prompt, response, tools, screenshot path)

### Log Monitor (nohup process)
Real-time `log-watcher.mjs` tailing `app.log` during the entire session.
Detects anomalies: errors, disconnects, slow operations, memory warnings.

### Pass 2 — UX Quality Review (ux-reviewer, Opus)
Runs AFTER Pass 1 completes. Reviews screenshots + metadata + test script criteria.
Evaluates 5 dimensions per step (1-5 scale):

| Dimension | What to look for |
|-----------|-----------------|
| **Visual Quality** | Spacing, alignment, colors, readability, contrast, polish |
| **Response Clarity** | Is the agent's text helpful? Clear? Not too verbose? |
| **Tool Selection** | Did the agent pick the right tool for the job? |
| **UX Coherence** | Does the result match the user's intent? Natural flow? |
| **Feedback Quality** | Does the user know what's happening at every moment? |

Additional qualitative dimensions (cross-script):
- **Timing**: does anything feel slow, laggy, or jarring?
- **Recovery**: after something goes wrong, can the user continue naturally?
- **Consistency**: do similar actions produce similar results?

### Metadata JSON Format

Pass 1 saves `/tmp/bottega-qa/NN-metadata.json` for each script:
```json
[
  {
    "script": "02-happy-path",
    "step": "1. Send a simple prompt",
    "prompt": "Take a screenshot and describe what you see",
    "response": "I can see the Figma canvas with...",
    "toolCards": ["figma_status", "figma_screenshot"],
    "screenshot": "/tmp/bottega-qa/02-screenshot-response.png",
    "passed": true,
    "timestamp": "2026-04-05T13:45:00Z",
    "evaluateCriteria": ["Does the response appear progressively?", "Is the screenshot showing the actual canvas?"]
  }
]
```

### Writing Test Scripts for Three-Pass

When adding new test scripts, structure each step to support both passes:

```markdown
### N. Step title
Send: "the prompt to send"

**Implementation hint:** (selectors, timing, expected tool names)

**Pass 1 checks:**
- [ ] Agent responded within timeout
- [ ] Expected tool card appeared
- [ ] DOM state matches expectation

**Evaluate (Pass 2):**
- Is the visual result well-structured?
- Does the response explain what was done clearly?
- Was the tool selection appropriate for this task?
```

## Output

After a full QA run, three reports are produced:
1. `/tmp/bottega-qa/result-NN.txt` — Pass 1 PASS/FAIL per step
2. `/tmp/log-monitor-report.md` — Log anomalies with timestamps
3. `/tmp/bottega-qa/ux-review.md` — Pass 2 qualitative scores and UX issues
4. Merged findings in `BUG-REPORT.md` (B-NNN bugs, UX-NNN issues, P-NNN perf, W-NNN warnings)
