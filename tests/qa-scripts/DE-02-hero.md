---
title: "DE-02 — Landing Page Hero Design Eval"
category: design-eval
type: B
requires_figma: true
rubric: hero
---

# DE-02 — Landing Page Hero Design Eval

Open-brief design evaluation for a SaaS landing page hero section. Evaluated on composition, CTA prominence, and visual interest.

**Estimated time**: 5-8 min
**Context stress**: Low
**Evaluation type**: Tipo B — Design Eval (vision model + rubric)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for design_crit evaluator

## Steps

### 1. Design brief
Send: "Create a landing page hero for a productivity SaaS called FlowBase. The hero should have a compelling headline, a subtitle explaining the value proposition, a primary CTA button, and a visual element (illustration placeholder or abstract shape). Brand color is #4F46E5 (indigo)."

**Evaluate:**
- Does the agent create a complete hero with all requested elements?
- Is the composition visually interesting (not just centered text)?
- Does the CTA stand out in the hierarchy?
- Is the brand color used appropriately?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 120000
canvas_screenshot: Hero
floor_check:
  find: Hero
  rules:
    default_names: 0
    nesting_depth: 4
design_crit:
  brief: "Landing page hero for FlowBase, a productivity SaaS. Headline, subtitle, primary CTA, visual element. Brand color #4F46E5 (indigo). Should be compelling and visually interesting."
  rubric: hero
  threshold: 6
```

### Overall assessment
- **Composition**: Is there visual interest beyond centered text?
- **CTA prominence**: Does the primary action stand out?
- **Brand alignment**: Is #4F46E5 used with intention (not just on everything)?
- **Gate**: Floor pass AND mean design_crit score >= 6/10
