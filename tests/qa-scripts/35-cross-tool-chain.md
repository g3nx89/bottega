---
title: "35 — Cross-Tool Chain"
category: design-quality
requires_figma: true
---

# 35 — Cross-Tool Chain

Exercise a full 5-step tool chain: discover components → instantiate → modify → screenshot → lint. Each step must use the expected tool category. Tests inter-tool coordination and that the agent correctly chains discovery output into subsequent operations.

**Estimated time**: 15-20 min
**Context stress**: Medium

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- At least one component available in the file or library (or agent should create one)

## Steps

### 1. Discover available components
Send: "Search for any available button or card components in the current file and any connected libraries. List the component names and their node IDs."

**Evaluate:**
- Does the agent call a discovery tool?
- Are component names and IDs returned?
- Is the output actionable for the next step?

```assert
tools_called_any_of: [figma_search_components, figma_get_library_components, figma_get_file_data, figma_design_system]
response_contains:
  any_of: [component, button, card, found, available]
  case_sensitive: false
duration_max_ms: 150000
```

### 2. Instantiate a component
Send: "Instantiate the first button or card component you found. Place it at position x=100, y=100 on the current page. Name the instance 'ChainTest/Instance'."

**Evaluate:**
- Does the agent call figma_instantiate or figma_execute to place the component?
- Is the instance created at the specified position?
- Is the naming applied?

```assert
tools_called_any_of: [figma_instantiate, figma_execute, figma_render_jsx]
response_contains:
  any_of: [instantiate, placed, created, instance, ChainTest]
  case_sensitive: false
duration_max_ms: 60000
```

### 3. Modify the instance
Send: "Modify ChainTest/Instance: change the primary fill color to #E11D48 (red), resize it to 240x56, and rename any visible text inside to 'Chain Test Label'."

**Evaluate:**
- Does the agent use manipulation tools (set_fills, resize, set_text)?
- Are all three modifications applied?
- Does the response confirm the changes?

```assert
tools_called_any_of: [figma_set_fills, figma_resize, figma_set_text, figma_execute, figma_set_instance_properties]
response_contains:
  any_of: [modified, updated, changed, applied, red, resized]
  case_sensitive: false
duration_max_ms: 90000
```

### 4. Screenshot the result
Send: "Take a screenshot showing ChainTest/Instance with the modifications applied."

**Evaluate:**
- Does the agent call figma_screenshot?
- Is the screenshot visible in the response?
- Does the instance show the red fill and correct dimensions?

```assert
tools_called: [figma_screenshot]
screenshots_min: 1
duration_max_ms: 90000
```

### 5. Lint the instance
Send: "Run a lint check on ChainTest/Instance to verify it follows naming conventions and has no structural issues."

**Evaluate:**
- Does the agent call figma_lint?
- Does the lint result mention the instance?
- Are any violations surfaced (naming, layer structure, etc.)?

```assert
tools_called_any_of: [figma_lint, figma_execute]
response_contains:
  any_of: [lint, check, pass, clean, issue, violation, naming]
  case_sensitive: false
duration_max_ms: 120000
```

### Overall assessment
- **Tool chain completeness**: Did all 5 steps use the expected tool category?
- **Data flow**: Did component discovery output feed correctly into instantiation?
- **Modification accuracy**: Were all 3 modifications in step 3 applied?
- **Lint coverage**: Did the lint step evaluate the correct element?
