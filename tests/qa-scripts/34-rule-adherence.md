---
title: "34 — Rule Adherence"
category: design-quality
requires_figma: true
---

# 34 — Rule Adherence

Verify the agent correctly applies auto-layout and custom typography, performs a structural inspection, and passes a design lint check. Tests adherence to layout rules and the lint tool's ability to surface real issues.

**Estimated time**: 10-15 min
**Context stress**: Low-Medium

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create auto-layout card with custom font
Send: "Create an auto-layout card frame (320px wide, hug height) named 'RuleCard'. Apply vertical auto-layout with 20px gap between children and 24px padding on all sides. Inside the card, place: a heading text 'Card Title' using font 'Inter', 18px, semibold, color #1A1A1A; a body paragraph 'This is the card description with enough text to span two lines.' using font 'Inter', 14px, regular, color #555555; a filled button at the bottom with text 'Learn More', 12px/20px padding, 6px corner radius, background #3B82F6, white text."

**Evaluate:**
- Does the agent use figma_execute or similar to create the card?
- Is auto-layout applied (not manual positioning)?
- Does the creation complete within 90 seconds?

```assert
tools_called_any_of: [figma_execute, figma_render_jsx, figma_auto_layout]
duration_max_ms: 90000
```

### 2. Structural check
Send: "Inspect RuleCard's structure. Confirm that: the frame uses auto-layout, padding is 24px on all sides, gap between children is 20px, and the three children (heading, body, button) are in the correct order."

**Evaluate:**
- Does the agent call a data or screenshot tool to inspect the frame?
- Does the response confirm auto-layout is applied?
- Are the structural details accurately reported?

```assert
tools_called_any_of: [figma_get_file_data, figma_screenshot, figma_execute, figma_get_selection]
response_contains:
  any_of: [auto-layout, auto layout, padding, gap, layout]
  case_sensitive: false
duration_max_ms: 60000
```

### 3. Lint the card
Send: "Run a lint check on RuleCard. Confirm that the layout, naming, and spacing pass without issues."

**Evaluate:**
- Does the agent call figma_lint?
- Does the response indicate the card is clean (pass/clean/no issues)?
- Are any violations reported (and are they legitimate)?

```assert
tools_called_any_of: [figma_lint, figma_execute]
response_contains:
  any_of: [pass, clean, no issues, compliant, valid]
  case_sensitive: false
duration_max_ms: 60000
```

### Overall assessment
- **Auto-layout**: Is the card properly using auto-layout, not manual positioning?
- **Typography**: Are the custom font settings (Inter, sizes, weights, colors) applied?
- **Lint**: Does the card pass the lint check without violations?
- **Structural accuracy**: Does the inspection match the intended structure?
