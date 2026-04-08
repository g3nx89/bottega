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
# We assert on the LITERAL judge-footer prefix "Quality Check ·" (with the
# middle-dot glyph), not the bare phrase "quality check" — the agent can
# legitimately mention "quality check" in conversational prose without the
# judge running, which would silently false-pass the sentinel. The middle-dot
# anchor is rendered by judge-harness.ts only when the harness fires.
# case_sensitive: true tightens the match to the canonical header form
# (capital Q, capital C). This catches both PASS and FAIL verdict variants
# because the prefix is identical.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
response_contains:
  any_of: ["Quality Check ·"]
  case_sensitive: true
duration_max_ms: 120000
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
# Caveat: P1 has no `response_NOT_contains` for asserting absence of "Quality
# Check" — that becomes a P2 assertion. Step 6 (re-enable) carries its own
# assert block that re-checks the judge footer presence, completing the
# off → on cycle coverage.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
response_contains:
  any_of: [red, rectangle, created]
  case_sensitive: false
duration_max_ms: 60000
```

### 6. Force re-run judge
Toggle judge back on by clicking `#bar-judge-btn` until `classList.contains('active')` is true (may need 1-2 clicks to cycle through `null` → `true`).

Send: "Re-run the quality check on the current state"

**Evaluate:**
- Does the agent or UI provide a way to manually trigger the judge?
- Can you use the IPC `forceRerunJudge` if no UI exists?
- Does it evaluate the current canvas state?

```assert
# Re-enable cycle: closes the judge-disabled (step 5) → judge-enabled (step 6)
# loop. After toggling back ON, the next mutation MUST produce the Quality Check
# footer again. We do not require a specific creation tool — the prompt is
# explicit ("re-run the quality check"), the agent may use any approach.
# This sentinel is the partner of step 2 (initial fire) and step 5 (off path),
# completing coverage of the three-state judge cycle.
response_contains:
  any_of: ["Quality Check ·"]
  case_sensitive: true
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
# triggered for cards). The Quality Check footer MUST appear because this is a
# multi-element mutation — same B-018 sentinel as step 2 (literal "Quality Check ·"
# prefix, case-sensitive) but on a complex flow. Generous duration cap (180s)
# for a multi-step creation + judge evaluation.
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child, figma_auto_layout]
screenshots_min: 1
response_contains:
  any_of: ["Quality Check ·"]
  case_sensitive: true
duration_max_ms: 180000
```

### Overall assessment
- Does the judge provide value (catches real issues)?
- Is the judge overhead acceptable (time/cost)?
- Are false positives rare?
- Does the retry loop converge or loop endlessly?
- Is the judge output visible and readable in the chat UI?
