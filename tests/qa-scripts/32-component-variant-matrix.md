---
title: "32 — Component Variant Matrix"
category: design-quality
requires_figma: true
---

# 32 — Component Variant Matrix

Create a button component, expand it into a 3-size component set, add states for each size, then analyze and screenshot the full variant matrix. Tests the agent's ability to manage component sets and variant properties.

**Estimated time**: 15-20 min
**Context stress**: Medium-High (multi-variant composition)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create base button component
Send: "Create a base button component named 'Button/Base' with: background #4F46E5, white text 'Label', 14px font size, 12px vertical padding, 24px horizontal padding, and 8px corner radius. Use auto-layout so it hugs its content."

**Evaluate:**
- Does the agent use JSX render or execute to create the component?
- Is auto-layout applied?
- Does the button look like a standard filled button?
- Screenshot.

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 90000
```

### 2. Create component set with 3 sizes
Send: "Take the Button/Base and create a component set with 3 size variants: Small (12px text, 8px/16px padding), Medium (14px text, 12px/24px padding — use the base values), and Large (16px text, 16px/32px padding). Name each variant with a 'Size' property: sm, md, lg. Arrange them horizontally with 24px gap."

**Evaluate:**
- Does the agent create a component set with variant properties?
- Are the three sizes visually distinct?
- Is the Size property correctly named?
- Screenshot.

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_arrange_component_set, figma_set_variant]
screenshots_min: 1
duration_max_ms: 120000
```

### 3. Add 3 states per size
Send: "For each size (sm, md, lg), add 3 state variants: Default (current background #4F46E5), Hover (#4338CA slightly darker), and Disabled (#9CA3AF gray, 40% opacity text). This gives a 3×3 matrix of 9 variants total. Use a 'State' property with values: default, hover, disabled."

**Evaluate:**
- Does the agent expand the component set to 9 variants?
- Are the State property values correctly named?
- Are color/opacity differences applied?
- Screenshot of the full matrix.

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_set_fills, figma_set_variant, figma_arrange_component_set]
screenshots_min: 1
duration_max_ms: 180000
```

### 4. Analyze and screenshot
Send: "Analyze the Button component set and take a screenshot. Verify that all 9 variants are present, the Size and State properties are correctly defined, and the visual matrix is well-organized."

JudgeMode: auto

**Evaluate:**
- Does the agent call figma_analyze_component_set?
- Is the full 9-variant matrix visible in the screenshot?
- Does the analysis confirm all variants?
- Does the judge trigger to evaluate quality?

```assert
tools_called_any_of: [figma_analyze_component_set, figma_get_component_details, figma_screenshot]
judge_triggered: true
screenshots_min: 1
duration_max_ms: 150000
```

### Overall assessment
- **Variant completeness**: Are all 9 variants (3 sizes × 3 states) present?
- **Property naming**: Are Size and State properties correctly defined?
- **Visual clarity**: Is the matrix visually organized and easy to read?
- **Component integrity**: Does each variant correctly represent its size + state combination?
