---
title: "DE-04 — Settings Screen Design Eval"
category: design-eval
type: B
requires_figma: true
rubric: screen
---

# DE-04 — Settings Screen Design Eval

Open-brief design evaluation for a dark-themed music player settings screen. Focus on theming, density, and navigation.

**Estimated time**: 5-8 min
**Context stress**: Low
**Evaluation type**: Tipo B — Design Eval (vision model + rubric)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for design_crit evaluator

## Steps

### 1. Design brief
Send: "Create a settings screen for a dark-themed music player app. Include sections for: Audio Quality (toggle for high-res audio, equalizer preset selector), Playback (crossfade slider, gapless playback toggle), and Account (profile name, subscription tier badge, sign out button). Use a dark background with light text."

**Evaluate:**
- Does the screen feel like a music player (immersive, dark, focused)?
- Are the settings logically grouped and scannable?
- Is the density appropriate (not too sparse, not too cramped)?
- Are interactive elements (toggles, sliders) visually distinct?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 120000
canvas_screenshot: Settings
floor_check:
  find: Settings
  rules:
    default_names: 0
    nesting_depth: 5
design_crit:
  brief: "Settings screen for a dark-themed music player app. Audio Quality section (high-res toggle, EQ selector), Playback section (crossfade slider, gapless toggle), Account section (profile, subscription badge, sign out). Dark background, light text."
  rubric: screen
  threshold: 6
```

### Overall assessment
- **Theming**: Does the dark theme feel intentional and immersive?
- **Information density**: Appropriate for a settings screen?
- **Section grouping**: Logical and scannable?
- **Gate**: Floor pass AND mean design_crit score >= 6/10
