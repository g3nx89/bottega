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

### 2. Typography styling
Send: "Style the first item as a heading: 32px, bold, uppercase, with 1.2 line height"

**Evaluate:**
- Does the agent call `figma_set_text_style`?
- Are letterSpacing, lineHeight, textCase, fontWeight all correct?
- Is only the first item affected?

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

### Overall assessment
- Does the agent handle auto-layout property ordering correctly?
- Are batch operations truly batched (single call, not sequential)?
- Does the agent understand layout constraints vs absolute positioning?
