# 14 — Judge System & Subagents

Test the quality judge auto-trigger, micro-judge verdicts, retry loop, and subagent configuration.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Judge enabled (check toolbar: Judge button should be active)

## Steps

### 1. Verify judge is enabled
Check `#bar-judge-btn` in the toolbar.

**Implementation hint:** The judge toggle is a **three-state cycle**:
- `judgeOverride = null` → follow settings default (no special class)
- `judgeOverride = true` → forced ON (class `active`)
- `judgeOverride = false` → forced OFF (class `disabled-chip`)

Clicking cycles: `null` → `true` → `false` → `null` → ...
To force ON, click until `classList.contains('active')` is true.

**Evaluate:**
- Is the judge toggle visible in the toolbar?
- What is the current state? Check both `active` and `disabled-chip` classes.
- If not active, toggle it on (may need 1-2 clicks depending on current state).

### 2. Trigger judge via creation
Send: "Create a simple button with text 'Submit' — blue background, white text, rounded corners"

**Evaluate:**
- After the agent creates the button, does the judge auto-trigger?
- Do you see judge-related IPC events (onJudgeRunning, onJudgeVerdict)?
- Is there a "Quality Check" section in the assistant message?
- What criteria were evaluated (alignment, naming, tokens, completeness, etc.)?

```assert
# B-018 SENTINEL — judge auto-trigger after mutation tools.
# Two-layer guarantee:
#  1. dom_visible on `.judge-verdict-card` — the judge harness renders its
#     verdict as a SEPARATE DOM element (sibling of `.message-content`) inside
#     the assistant bubble, NOT inside the response text stream. A
#     response_contains check would always fail since the prose never embeds
#     the rendered footer. Class set in src/renderer/app.js (createJudgeVerdictCard).
#     Empirically validated 2026-04-08.
#  2. metric_growth on `judge.triggeredTotal` (Fase 4) — semantic guarantee
#     that the harness ACTUALLY ran. If a future bug causes the card to render
#     from a stale DOM template, the metric assertion still catches it.
#  3. metric on `judge.skippedByReason['no-connector']` — original B-018 was a
#     silent skip. If the regression returns this delta is > 0.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
dom_visible: ".assistant-message:last-child .judge-verdict-card"
duration_max_ms: 120000
metric_growth:
  - path: "judge.triggeredTotal"
    minGrowth: 1
  - path: "judge.skippedByReason['no-connector']"
    exactGrowth: 0
```

### 3. Judge verdict analysis
Look at the judge output carefully.

**Implementation hint:** The judge output header reads `"Quality Check · PASS ✓"` or `"Quality Check · FAIL ✗"`. Look for terms like "quality check", "issues", "recommendations" — NOT "criteria/score" (the judge uses different terminology).

**Evaluate:**
- Is the verdict PASS or FAIL?
- Are quality issues or recommendations listed?
- Are remediation suggestions specific and actionable?
- Is the assessment fair (does the button actually have the issues reported)?

### 4. Judge retry behavior
If the verdict was FAIL:

**Evaluate:**
- Did the judge retry with only the failed criteria?
- How many attempts were made (check the attempt/maxAttempts)?
- Did subsequent attempts produce different results?
- Was there a timeout or did it complete normally?

### 5. Disable judge and verify
Toggle the judge off by clicking `#bar-judge-btn` until `classList.contains('disabled-chip')` is true (this means `judgeOverride = false`, forced OFF).

Send: "Create a red rectangle"

**Evaluate:**
- Does the response complete WITHOUT a Quality Check section?
- Is the response faster without judge overhead?
- Is the toggle state visually clear (`disabled-chip` class present)?

```assert
# Judge-disabled path: creation tool MUST still run, but the duration cap is
# tighter (60s vs 120s in step 2) — without judge overhead the cycle is faster.
# KNOWN GAP (B-new, 2026-04-08): the metric_growth sub-assertions below fail in
# qa-runner because they depend on the preceding sentence ("Toggle the judge off
# ...") being executed, but that's a manual DOM action the runner cannot perform
# yet. The assertion is semantically correct — it catches a real state mismatch —
# but the gap is in the runner, not the product. Fase 3 (oracle baseline diff)
# will supersede these assertions with a drift check against a recorded baseline,
# so we accept the FAIL for now rather than extending qa-runner with DOM pre-actions.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
response_contains:
  any_of: [red, rectangle, created]
  case_sensitive: false
duration_max_ms: 60000
metric_growth:
  - path: "judge.triggeredTotal"
    exactGrowth: 0
  - path: "judge.skippedByReason['disabled']"
    minGrowth: 1
```

### 6. Force re-run judge (with mutation)
Toggle judge back on by clicking `#bar-judge-btn` until `classList.contains('active')` is true (may need 1-2 clicks to cycle through `null` → `true`).

Send: "Make the red rectangle from step 5 slightly larger (250x150) and add a 2px white border"

**Evaluate:**
- Does the agent perform the mutation (figma_resize / figma_set_strokes / figma_execute)?
- Does the judge auto-trigger AFTER the mutation, now that it's re-enabled?
- Is there a Quality Check verdict card visible?

```assert
# Re-enable cycle: closes the judge-disabled (step 5) → judge-enabled (step 6)
# loop. The prompt MUST be a mutating one — the judge harness only fires
# after a mutating turn, so a read-only "re-run quality check" prompt won't
# trigger the verdict card (calibration 2026-04-08 confirmed this). With a
# real mutation, the .judge-verdict-card MUST appear because we just toggled
# the judge ON. This sentinel is the partner of step 2 (initial fire) and
# step 5 (off path), completing coverage of the three-state cycle.
tools_called_any_of: [figma_resize, figma_set_strokes, figma_execute, figma_render_jsx, figma_set_fills]
screenshots_min: 1
dom_visible: ".assistant-message:last-child .judge-verdict-card"
duration_max_ms: 90000
```

### 7. Subagent configuration
Open Settings and check subagent settings.

**Evaluate:**
- Is the subagent toggle visible?
- Can you change the subagent model?
- Are all subagent types listed (scout, analyst, auditor)?

### 8. Judge with complex creation
Send: "Create a card with a header section (logo + nav), a hero image area, and a footer with social icons. Use proper naming, auto-layout, and design tokens if available."

**Evaluate:**
- Does the judge evaluate more criteria for a complex creation?
- Is the completeness check meaningful?
- Does the naming check verify semantic names?
- Does the componentization check suggest reuse opportunities?

```assert
# Complex creation: any of the creation tools is valid (figma_auto_layout often
# triggered for cards). Same B-018 sentinel as step 2 — dom_visible on the
# judge verdict card class — but on a complex multi-element flow. Generous
# duration cap (180s) for multi-step creation + judge evaluation.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child, figma_auto_layout]
screenshots_min: 1
dom_visible: ".assistant-message:last-child .judge-verdict-card"
duration_max_ms: 180000
```

### Overall assessment
- Does the judge provide value (catches real issues)?
- Is the judge overhead acceptable (time/cost)?
- Are false positives rare?
- Does the retry loop converge or loop endlessly?
- Is the judge output visible and readable in the chat UI?
