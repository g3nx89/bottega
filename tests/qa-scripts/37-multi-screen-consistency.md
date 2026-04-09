---
title: "37 — Multi-Screen Consistency"
category: design-quality
requires_figma: true
---

# 37 — Multi-Screen Consistency

Create 3 separate app frames, add an identical navigation bar to each, then apply global color and typography changes across all screens. Tests the agent's ability to maintain design consistency across multiple frames.

**Estimated time**: 20-30 min
**Context stress**: High (3 frames, cross-screen mutations)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create 3 app frames
Send: "Create 3 mobile app frames side by side (24px gap between them), each 390x844 (iPhone 14 size). Name them: Screen/Home, Screen/Explore, Screen/Profile. Give each a white background (#FFFFFF). Add a simple placeholder content area in each: in Screen/Home add a text 'Home Content'; in Screen/Explore add a text 'Explore Content'; in Screen/Profile add a text 'Profile Content'. Position the text at y=200, x=24 in each frame."

**Evaluate:**
- Are all 3 frames created with correct dimensions?
- Are they named correctly?
- Is placeholder content in each frame?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 120000
```

### 2. Add identical navigation bar to each screen
Send: "Add an identical bottom navigation bar to each of the 3 screens (Screen/Home, Screen/Explore, Screen/Profile). The nav bar should be: 390x82 wide, pinned to the bottom of each frame, background #FFFFFF, 1px top border #E5E7EB, and contain 3 nav items evenly spaced: a home icon placeholder (24x24) with label 'Home', a search icon placeholder with label 'Explore', and a user icon placeholder with label 'Profile'. Use the same exact structure in all 3 screens."

**Evaluate:**
- Is an identical nav bar added to all 3 screens?
- Is the nav bar positioned at the bottom of each frame?
- Are the 3 nav items present in each?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child, figma_clone]
screenshots_min: 1
duration_max_ms: 120000
```

### 3. Change nav color across all screens
Send: "Change the background color of the bottom navigation bar in ALL 3 screens from #FFFFFF to #111827 (dark navy). Also change the nav item label text color to #FFFFFF (white) in all 3 screens. This must be applied to every screen — Screen/Home, Screen/Explore, and Screen/Profile."

**Evaluate:**
- Is the nav background changed on all 3 screens?
- Is the label text color updated on all 3 screens?
- Does the response confirm changes on all screens?

```assert
tools_called_any_of: [figma_set_fills, figma_execute, figma_batch_set_fills, figma_set_text]
response_contains:
  any_of: [all, three, each, screens, updated, applied, Home, Explore, Profile]
  case_sensitive: false
duration_max_ms: 90000
```

### 4. Update font sizes across all screens
Send: "Update the body font size in all 3 screens. Set the placeholder content text ('Home Content', 'Explore Content', 'Profile Content') to 20px, color #374151. Ensure all 3 screens receive the update."

**Evaluate:**
- Is font size updated in all 3 screens?
- Is the color applied consistently?
- Does the response confirm consistency across all screens?

```assert
tools_called_any_of: [figma_set_text, figma_execute, figma_batch_set_text, figma_batch_transform]
response_contains:
  any_of: [all, three, each, screens, 20px, updated, font]
  case_sensitive: false
duration_max_ms: 90000
```

### 5. Screenshot and lint
Send: "Take a screenshot showing all 3 screens together, then run a lint check on all three frames to verify naming conventions, consistency of the nav bar, and no structural violations."

JudgeMode: auto

**Evaluate:**
- Does the agent capture a screenshot with all 3 screens visible?
- Is a lint check performed on the frames?
- Does the judge auto-trigger to evaluate cross-screen consistency?
- Are any inconsistencies flagged by lint or the judge?

```assert
tools_called_any_of: [figma_screenshot, figma_lint, figma_execute]
judge_triggered: true
screenshots_min: 1
duration_max_ms: 120000
```

### Overall assessment
- **Cross-screen consistency**: Are all 3 screens visually identical in nav styling?
- **Global mutation coverage**: Did color and font changes reach all 3 screens?
- **Lint quality**: Did the lint check accurately assess all 3 frames?
- **Judge insight**: Did the quality check surface any real inconsistencies?
- **Naming**: Are frames and layers named according to conventions?
