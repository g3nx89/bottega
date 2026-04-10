---
title: "DE-01 — Profile Card Design Eval"
category: design-eval
type: B
requires_figma: true
rubric: card
---

# DE-01 — Profile Card Design Eval

Open-brief design evaluation. The agent receives a design brief with NO prescribed tools or layout. Evaluated on design quality via vision model + calibrated rubric.

**Estimated time**: 5-8 min
**Context stress**: Low
**Evaluation type**: Tipo B — Design Eval (vision model + rubric)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for design_crit evaluator

## Steps

### 1. Design brief
Send: "Design a user profile card for a professional networking app. The card should show the person's avatar, name, role, company, and key stats (connections, endorsements). Make it look polished and professional."

**Evaluate:**
- Does the agent work freely without tool prescription?
- Does it create a complete card with all requested elements?
- Is the result visually professional?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: ProfileCard
floor_check:
  find: ProfileCard
  rules:
    default_names: 0
    nesting_depth: 4
    wcag_smoke: 10
design_crit:
  brief: "User profile card for a professional networking app showing avatar, name, role, company, and key stats (connections, endorsements). Should look polished and professional."
  rubric: card
  threshold: 6
```

### Overall assessment
- **Intent match**: Does the card communicate "professional networking"?
- **Visual craft**: Is spacing systematic, are effects subtle and appropriate?
- **Design decisions**: Are colors, typography, and hierarchy intentional?
- **Floor check**: Zero default names, zero WCAG critical, auto-layout present?
- **Gate**: Floor pass AND mean design_crit score >= 6/10
