---
title: "30 — Design System Compliance"
category: design-quality
requires_figma: true
---

# 30 — Design System Compliance

Verify that the agent correctly sets up a token collection, creates a component that uses only those tokens, and binds variables properly. Tests the full token-to-binding pipeline.

**Estimated time**: 10-15 min
**Context stress**: Medium

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- No existing token collections on the file

## Steps

### 1. Setup token collection
Send: "Set up a token collection called 'Brand' with the following tokens: colors primary=#5B4FF5, secondary=#00C9A7, surface=#F5F5F5, text=#1A1A1A; spacing sm=8, md=16, lg=24, xl=40; radii sm=4, md=8, lg=16"

**Evaluate:**
- Does the agent call figma_setup_tokens or figma_execute to create the collection?
- Are all token categories (colors, spacing, radii) created?
- Does the response confirm the Brand collection was established?

```assert
tools_called_any_of: [figma_setup_tokens, figma_execute]
response_contains:
  any_of: [Brand, token, collection, created]
  case_sensitive: false
duration_max_ms: 90000
```

### 2. Create card using Brand tokens
Send: "Create a card component named 'BrandCard' using ONLY Brand tokens. The card should have: surface background color from Brand tokens, lg border radius from Brand tokens, xl padding from Brand tokens, a title text in the Brand text color, and a primary-colored accent bar at the top. Do not use any hardcoded color or spacing values."

JudgeMode: auto

**Evaluate:**
- Does the agent use Brand tokens instead of hardcoded values?
- Is the card structure reasonable (accent bar, title, surface bg)?
- Does a screenshot appear showing the created card?
- Does the judge quality check auto-trigger?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
judge_triggered: true
screenshots_min: 1
duration_max_ms: 120000
```

### 3. Verify variable bindings
Send: "Inspect BrandCard and confirm that all fills, spacing, and corner radii are bound to Brand variables, not hardcoded. List which properties are bound and to which token."

**Evaluate:**
- Does the agent call a discovery or inspection tool?
- Does the response explicitly mention bound variables or tokens?
- Are any unbound properties flagged?

```assert
tools_called_any_of: [figma_get_file_data, figma_get_component_details, figma_execute, figma_screenshot]
response_contains:
  any_of: [bound, variable, token, binding]
  case_sensitive: false
duration_max_ms: 60000
```

### 4. Screenshot and confirm
Send: "Take a screenshot of BrandCard and confirm it looks correct — proper colors, spacing, and rounded corners from the Brand tokens."

**Evaluate:**
- Does the agent capture a screenshot?
- Does the response describe the card in terms of the Brand token values?
- Does the visual result match the expected token-driven design?

```assert
tools_called: [figma_screenshot]
response_contains:
  any_of: [brand, card, confirm, correct, token]
  case_sensitive: false
duration_max_ms: 60000
```

### Overall assessment
- **Token setup**: Were all Brand token categories created correctly?
- **Token adherence**: Did the agent use ONLY Brand tokens (no hardcoded values)?
- **Binding integrity**: Are the properties correctly bound to variables?
- **Visual fidelity**: Does the card look as described, with token-correct colors and spacing?
