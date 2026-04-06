# 17 — Image Editing & Restoration

Test image editing, restoration, and image-based manipulation tools.

## Prerequisites
- Connected to Bottega-Test_A, session reset
- At least one frame or rectangle on the canvas to apply images to
- Gemini API key configured in settings (required for image generation)

## Steps

### 1. Generate an image on canvas
Send: "Generate an image of a sunset over mountains and place it on the canvas"

**Implementation hint:** The agent should use `figma_generate_image` which creates a new frame with the generated image as fill.

**Evaluate:**
- Does the agent use `figma_generate_image`?
- Is a new element created with an image fill?
- Does the screenshot show the generated image on canvas?
- Is the image relevant to the prompt (sunset/mountains)?

### 2. Edit the generated image
Send: "Edit that image to add a lake in the foreground reflecting the sunset"

**Implementation hint:** The agent should use `figma_edit_image` referencing the node from step 1.

**Evaluate:**
- Does the agent use `figma_edit_image` with the correct nodeId?
- Does the edited image show the requested modification?
- Is it applied to the same node (not a new one)?

### 3. Restore the original image
Send: "Restore the original image before the edit"

**Implementation hint:** The agent should use `figma_restore_image` to revert to the pre-edit version.

**Evaluate:**
- Does the agent use `figma_restore_image`?
- Does the image revert to the original (no lake)?
- Is the restoration applied to the correct node?

### 4. Generate an icon
Send: "Create a settings gear icon, 48x48 pixels, using a dark gray color"

**Implementation hint:** The agent should use `figma_generate_icon` or `figma_create_icon`.

**Evaluate:**
- Does the agent generate a recognizable gear icon?
- Is the size approximately 48x48?
- Is the color dark gray as requested?

### 5. Generate a pattern
Send: "Create a repeating chevron pattern in blue and white, 200x200 pixels"

**Implementation hint:** The agent should use `figma_generate_pattern`.

**Evaluate:**
- Does the agent use `figma_generate_pattern`?
- Is the pattern repeating and recognizable as chevrons?
- Are the colors blue and white?

### Overall assessment
- Do the image generation tools produce usable visual results?
- Does the agent correctly reference nodes between edit/restore operations?
- Are error messages clear if the Gemini API key is missing or invalid?
