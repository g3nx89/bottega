# 09 — Styling, Layout & Batch Operations

Test auto-layout, typography, effects, and bulk operations.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- No additional setup needed — step 1 creates its own elements

## Steps

### 1. Auto-layout setup
Send: "Create a vertical auto-layout frame with 3 text items ('Item 1', 'Item 2', 'Item 3'), 16px gap, and 24px padding"

**Evaluate:**
- Does the agent call `figma_auto_layout` with correct properties?
- Are direction, gap, and padding correct in the screenshot?
- Do items stack vertically?
- Does the frame hug its contents?

```assert
# Setup canary: an auto-layout creation tool MUST be called.
# Calibration (2026-04-08) found the agent uses figma_render_jsx with
# auto-layout JSX attributes as often as the dedicated figma_auto_layout tool.
# Both produce a functionally equivalent auto-layout frame. Accept either.
tools_called_any_of: [figma_auto_layout, figma_render_jsx]
screenshots_min: 1
response_contains:
  any_of: [vertical, layout, frame, items]
  case_sensitive: false
duration_max_ms: 90000
```

### 2. Typography styling
Send: "Style the first item as a heading: 32px, bold, uppercase, with 1.2 line height"

**Evaluate:**
- Does the agent call `figma_set_text_style`?
- Are letterSpacing, lineHeight, textCase, fontWeight all correct?
- Is only the first item affected?

```assert
# figma_set_text_style is the canonical typography tool.
# Calibration round 3 (2026-04-08) found 1/3 runs called figma_set_text twice
# (the agent occasionally re-writes the content as part of the styling chain).
# Relaxed cap from 1 to 2 — still blocks the "sequential rewrite N items"
# anti-pattern (which would call set_text 3+ times for the 3-item frame)
# while accepting normal content-write variance.
# Token tightening: replaced bare "32" (matched 32px, 0.32, node ids, etc.) with
# "32px" — the unit suffix anchors it to a font-size value.
tools_called: [figma_set_text_style]
tools_NOT_called_more_than:
  figma_set_text: 2
response_contains:
  any_of: [bold, heading, 32px, uppercase, style]
  case_sensitive: false
screenshots_min: 1
duration_max_ms: 60000
```

### 3. Effects — shadows
Send: "Add a drop shadow to the frame: 4px y-offset, 8px blur, 20% opacity black"

**Evaluate:**
- Does the agent call `figma_set_effects`?
- Is the shadow visible in the screenshot?
- Are the parameters correct (offset, blur, opacity)?

### 4. Corner radius
Send: "Round the frame corners to 12px, but make the top-left corner 24px"

**Evaluate:**
- Does the agent call `figma_set_corner_radius`?
- Does it handle per-corner radius correctly?
- Is the visual result asymmetric as requested?

### 5. Opacity
Send: "Set the second item to 50% opacity"

**Evaluate:**
- Does the agent call `figma_set_opacity` with value 0.5?
- Is the visual effect correct?

### 6. Batch text update
Send: "Update all three items at once: 'Apple', 'Banana', 'Cherry'"

**Evaluate:**
- Does the agent call `figma_batch_set_text`?
- Are all three texts updated in a single call?
- Is the result correct?

```assert
# Anti-sequential pattern: batch op MUST be used, sequential figma_set_text MUST NOT.
# This catches the most common drift — agent falls back to N sequential calls
# instead of one batched call. The cap of 0 on figma_set_text enforces this.
tools_called: [figma_batch_set_text]
tools_NOT_called_more_than:
  figma_set_text: 0
response_contains:
  any_of: [Apple, Banana, Cherry]
  case_sensitive: false
screenshots_min: 1
duration_max_ms: 60000
```

### 7. Batch fill update
Send: "Set all items to different colors: red for Apple, yellow for Banana, green for Cherry"

**Evaluate:**
- Does the agent call `figma_batch_set_fills`?
- Are colors correctly mapped to items?

### 8. Batch transform
Send: "Move all items 50px to the right"

**Evaluate:**
- Does the agent call `figma_batch_transform`?
- Are all items moved uniformly?
- Does auto-layout recalculate correctly?

```assert
# Same anti-sequential pattern as step 6 but for transforms.
# Calibration (2026-04-08) found flakiness: the agent sometimes picks
# figma_batch_transform (correct), sometimes figma_execute with a scripted
# batch (also correct — mutates via Figma API). Both are valid; the anti-
# pattern (sequential figma_move) is still blocked by the cap.
tools_called_any_of: [figma_batch_transform, figma_execute]
tools_NOT_called_more_than:
  figma_move: 0
screenshots_min: 1
duration_max_ms: 60000
```

### Overall assessment
- Does the agent handle auto-layout property ordering correctly?
- Are batch operations truly batched (single call, not sequential)?
- Does the agent understand layout constraints vs absolute positioning?
