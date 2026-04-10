---
title: "DE-03 — Login Form Design Eval"
category: design-eval
type: B
requires_figma: true
rubric: form
---

# DE-03 — Login Form Design Eval

Open-brief design evaluation for a mobile banking login form. Focus on trust, accessibility, and clarity.

**Estimated time**: 5-8 min
**Context stress**: Low
**Evaluation type**: Tipo B — Design Eval (vision model + rubric)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for design_crit evaluator

## Steps

### 1. Design brief
Send: "Design a login form for a mobile banking app. It should feel trustworthy and secure. Include email and password fields, a 'Sign In' button, a 'Forgot password?' link, and a subtle security indicator. The form should be clean and accessible."

**Evaluate:**
- Does the design communicate trust and security?
- Are the inputs well-proportioned and accessible?
- Is there a clear primary action?
- Does the layout feel appropriate for banking (not playful)?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 120000
canvas_screenshot: Login
floor_check:
  find: Login
  rules:
    default_names: 0
    nesting_depth: 4
design_crit:
  brief: "Login form for a mobile banking app. Should feel trustworthy and secure. Email field, password field, Sign In button, Forgot password link, security indicator. Clean and accessible."
  rubric: form
  threshold: 6
```

### Overall assessment
- **Trust signals**: Does the form feel secure and professional?
- **Accessibility**: Are inputs well-labeled, contrast sufficient, touch targets adequate?
- **Hierarchy**: Clear path from fields to primary action?
- **Gate**: Floor pass AND mean design_crit score >= 6/10
