# 07 — Element Creation & Manipulation

Test creating, modifying, and deleting Figma elements.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page (no elements)

## Steps

### 1. Create basic shapes
Send: "Create a 400x300 frame, a 100x100 blue rectangle inside it, and a red ellipse next to the rectangle"

**Evaluate:**
- Does the agent use `figma_create_child` or `figma_execute`?
- Are all three elements created with correct types?
- Is the rectangle nested inside the frame (parent/child)?
- Screenshot shows correct layout?

### 2. Set fills and strokes
Send: "Change the rectangle's fill to green (#00CC66) and add a 2px black stroke"

**Evaluate:**
- Does the agent use `figma_set_fills` and `figma_set_strokes`?
- Does it find the correct node (not the ellipse)?
- Are the exact colors applied?

### 3. Set text
Send: "Add a text layer inside the frame that says 'Hello Bottega' in 24px bold"

**Evaluate:**
- Does the agent create a TEXT node and set its content?
- Is the font size and weight correct?
- Is the text nested inside the frame?

### 4. Move and resize
Send: "Move the rectangle to position (50, 50) and resize it to 150x150"

**Evaluate:**
- Does the agent use `figma_move` and `figma_resize`?
- Does the screenshot confirm the new position and size?

### 5. Clone and rename
Send: "Clone the ellipse and rename the clone to 'Circle Copy'"

**Evaluate:**
- Does the agent use `figma_clone` and `figma_rename`?
- Does the clone preserve the original's properties (fill, size)?
- Is the clone a separate node with the new name?

### 6. Set image fill
Send: "Set an image fill on the rectangle — use a placeholder image"

**Evaluate:**
- Does the agent call `figma_set_image_fill`?
- Does it handle the image URL/base64 correctly?
- Is the image visible in the screenshot?

### 7. Delete elements
Send: "Delete the circle copy"

**Evaluate:**
- Does the agent use `figma_delete`?
- Is the correct element removed?
- Are other elements untouched?

### 8. Screenshot verification
Send: "Take a screenshot so I can see the current state"

**Evaluate:**
- Does the screenshot accurately reflect all changes?
- Are names, colors, positions correct?

### Overall assessment
- Does the agent handle parent/child relationships correctly?
- Does it find elements by name reliably?
- Are mutations applied to the right nodes?
- Is the tool selection appropriate (create_child vs execute)?
