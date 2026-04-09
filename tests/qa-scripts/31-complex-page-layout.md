---
title: "31 — Complex Page Layout"
category: design-quality
requires_figma: true
---

# 31 — Complex Page Layout

Build a multi-section landing page iteratively, then refine typography and contrast, finishing with a judge-evaluated screenshot. Tests complex layout composition and iterative refinement across turns.

**Estimated time**: 20-30 min
**Context stress**: High (multi-section, iterative)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Hero section
Send: "Create a hero section frame (1440x720) for a SaaS product called 'FlowBase'. Include: a top navigation bar with logo text on the left and 3 nav links on the right, a large headline 'Build Faster, Ship Smarter' centered in the frame, a subtitle 'The all-in-one workflow platform for modern teams' below the headline, and a primary CTA button 'Get Started Free' with a dark background and white text."

**Evaluate:**
- Does the agent create a full-width frame?
- Is the navigation properly structured?
- Is text hierarchy clear (headline > subtitle > button)?
- Does a screenshot appear?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 120000
```

### 2. Three-column features section
Send: "Below the hero, add a features section (1440x480). Create three equal columns, each with: a simple icon placeholder (64x64 square), a feature title, and 2 lines of body text. Use these features: 'Automated Workflows' — automate repetitive tasks with no-code rules; 'Real-time Analytics' — track team performance with live dashboards; 'Seamless Integrations' — connect your favorite tools in one click. Add a centered section headline 'Why teams love FlowBase' above the columns."

**Evaluate:**
- Are three columns evenly spaced?
- Is the section headline above the columns?
- Does auto-layout or JSX create a balanced grid?
- Screenshot after creation.

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child, figma_auto_layout]
screenshots_min: 1
duration_max_ms: 120000
```

### 3. Refine title and contrast
Send: "The headline in the hero section needs refinement: increase it to 72px, make it bold, and ensure it has sufficient contrast — use #0D0D0D on the current background. Also update the features section headline to 40px semibold #111111. Check that both text elements pass WCAG AA contrast requirements with their backgrounds."

**Evaluate:**
- Does the agent target the correct text elements?
- Are font size and weight applied correctly?
- Does the response mention contrast or accessibility?

```assert
tools_called_any_of: [figma_set_text, figma_set_fills, figma_execute, figma_batch_set_text]
response_contains:
  any_of: [contrast, accessible, bold, semibold, headline, updated]
  case_sensitive: false
duration_max_ms: 90000
```

### 4. Screenshot and review
Send: "Take a screenshot of the full page layout and do a quality review. Does the visual hierarchy work? Are the sections well-proportioned? Is the typography readable?"

JudgeMode: auto

**Evaluate:**
- Does the agent capture a screenshot?
- Is the judge quality check triggered?
- Does the agent provide a thoughtful review of the layout?
- Are any specific issues identified?

```assert
tools_called_any_of: [figma_screenshot, figma_execute]
judge_triggered: true
screenshots_min: 1
duration_max_ms: 90000
```

### Overall assessment
- **Composition**: Are hero and features sections well-structured?
- **Iterative quality**: Did refinement in step 3 genuinely improve the design?
- **Judge value**: Did the quality check surface any real issues?
- **Typography**: Is the text hierarchy clear and readable?
