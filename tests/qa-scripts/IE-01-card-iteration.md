---
title: "IE-01 — Card Iteration Eval"
category: iteration-eval
type: C
requires_figma: true
rubric: card
---

# IE-01 — Card Iteration Eval

3-round iterative design evaluation. Tests the agent's ability to understand subjective feedback, iterate meaningfully, and converge on a better design.

**Estimated time**: 10-15 min
**Context stress**: Medium (3 turns, accumulating context)
**Evaluation type**: Tipo C — Iteration Eval (multi-round delta scoring)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for iteration_delta evaluator

## Steps

### 1. Round 1 — Open brief
Send: "Design a professional card component for a team directory app. Show the person's photo area, name, job title, department, and a contact button."

**Evaluate:**
- Baseline design created
- All requested elements present

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Card
floor_check:
  find: Card
  rules:
    wcag_smoke: 10
iteration_delta:
  round: 1
  brief: "Professional card component for a team directory app. Photo area, name, job title, department, contact button."
  rubric: card
```

### 2. Round 2 — Subjective feedback
Send: "It's too generic. Make it more sophisticated — add visual depth, refine the typography hierarchy, and give it more personality. It should feel like something from a premium corporate app, not a template."

**Evaluate:**
- Does the agent understand "sophisticated" and "premium"?
- Are changes meaningful (not just color tweaks)?
- Does the design feel upgraded?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_set_fills, figma_set_text_style, figma_set_effects]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Card
iteration_delta:
  round: 2
  brief: "Professional card component for a team directory app. Photo area, name, job title, department, contact button."
  rubric: card
  threshold_delta_total: 1
```

### 3. Round 3 — Specific feedback
Send: "The photo area is too small — make it more prominent. The contrast between the job title and department text is too low, hard to distinguish them. The spacing between the name and the job title feels tight. And the contact button doesn't stand out enough."

**Evaluate:**
- Does the agent address each specific issue?
- No regression from Round 2 improvements
- Final result is noticeably better than Round 1

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_set_fills, figma_resize, figma_set_text_style]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Card
iteration_delta:
  round: 3
  brief: "Professional card component for a team directory app. Photo area, name, job title, department, contact button."
  rubric: card
  threshold_final: 6
  threshold_delta_total: 1
  threshold_delta_step: 0
```

### Overall assessment
- **R1 baseline**: Was the initial design reasonable?
- **R2 subjective comprehension**: Did "sophisticated" and "premium" translate into meaningful visual changes?
- **R3 precision**: Were all 4 specific issues addressed without regression?
- **Delta R1->R3**: Improvement >= +2 points?
- **Delta R2->R3**: No regression (>= 0)?
- **Final score**: >= 6/10?
