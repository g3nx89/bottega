---
title: "33 — Judge Convergence"
category: design-quality
requires_figma: true
---

# 33 — Judge Convergence

Validate that the judge auto-triggers after a mutating creation, that the screenshot step captures the result, and that an improvement prompt driven by judge feedback actually applies changes. Tests the full judge-feedback-improvement loop.

**Estimated time**: 10-15 min
**Context stress**: Medium

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Judge enabled (toolbar judge button must be active)

## Steps

### 1. Create a professional card with judge on auto
JudgeMode: auto
Send: "Create a professional card component (360x240) for a user profile. Include: a 48x48 avatar circle with a light gray fill, the user name 'Alex Rivera' in 16px semibold, the role 'Product Designer' in 13px regular #666, a horizontal divider, and two stats at the bottom — '142 Projects' and '38 Reviews' — in 12px with #888 color. Use auto-layout and proper spacing."

**Evaluate:**
- Does the agent create the card using a creation tool?
- Does the judge auto-trigger after the mutating turn?
- Is the judge triggered at least once (metric growth)?
- Does a screenshot appear with the card?

```assert
judge_triggered: true
metric_growth:
  - path: "judge.triggeredTotal"
    minGrowth: 1
screenshots_min: 1
duration_max_ms: 150000
```

### 2. Screenshot the result
Send: "Take a screenshot of the card so we can review it clearly."

**Evaluate:**
- Does the agent call figma_screenshot?
- Is the screenshot of the profile card visible in the response?

```assert
tools_called: [figma_screenshot]
screenshots_min: 1
duration_max_ms: 30000
```

### 3. Improve based on judge feedback
Send: "Based on the quality review feedback, improve the card. Address any alignment issues, spacing inconsistencies, or visual balance problems the judge flagged. Make the card look more polished and professional."

**Evaluate:**
- Does the agent apply concrete changes (fills, layout, or rendering)?
- Are the tools appropriate for visual corrections?
- Does the response describe what was improved?

```assert
tools_called_any_of: [figma_execute, figma_set_fills, figma_render_jsx, figma_auto_layout, figma_set_text, figma_resize]
response_contains:
  any_of: [improved, updated, fixed, adjusted, refined, polished]
  case_sensitive: false
duration_max_ms: 90000
```

### Overall assessment
- **Judge auto-trigger**: Did the judge fire without manual intervention?
- **Feedback loop**: Did the improvement prompt use judge output as guidance?
- **Convergence**: Is the card visually better after step 3 than after step 1?
- **Metric accuracy**: Did `judge.triggeredTotal` increase as expected?
