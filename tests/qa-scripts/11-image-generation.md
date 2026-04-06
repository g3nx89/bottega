# 11 — Image Generation (Slash Commands)

Test all 7 image generation slash commands. Requires a valid Gemini API key.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Gemini API key configured in Settings > Image Generation
- Check settings panel first — if no key is set, these tests will fail gracefully

## Steps

### 1. /generate — Basic image
Type `/generate` and select from the menu, then complete with: "a sunset over mountains, photorealistic style"

**Evaluate:**
- Does the slash menu appear with "/generate" highlighted?
- Does the agent call `figma_generate_image`?
- Is an image generated and placed on the canvas?
- Is the image visible in the screenshot?
- Did the agent report dimensions and placement?

### 2. /icon — App icon
Send: "/icon a minimalist chat bubble icon in purple, flat design"

**Evaluate:**
- Does the agent call `figma_generate_icon`?
- Is the icon generated with appropriate dimensions?
- Is it clean and usable as a UI element?

### 3. /pattern — Seamless pattern
Send: "/pattern geometric triangles in blue and white, seamless tile"

**Evaluate:**
- Does the agent call `figma_generate_pattern`?
- Is the pattern applied or placed on canvas?
- Does it mention tiling/seamlessness?

### 4. /diagram — Flowchart
Send: "/diagram a user login flow: start → enter credentials → validate → success/failure → redirect"

**Evaluate:**
- Does the agent call `figma_generate_diagram`?
- Is the diagram readable with clear flow?
- Are nodes and connections visible?

### 5. /story — Visual story
Send: "/story a 4-step onboarding flow for a design app"

**Evaluate:**
- Does the agent call `figma_generate_story`?
- Are multiple frames created (one per step)?
- Is there visual consistency across frames?

### 6. /edit — Edit existing image
After creating an image in step 1, send: "/edit change the sky to a night sky with stars"

**Evaluate:**
- Does the agent call `figma_edit_image`?
- Does it find the correct node to edit?
- Is the edit applied to the existing image (not a new one)?

### 7. /restore — Image enhancement
Send: "/restore enhance the image quality and upscale"

**Evaluate:**
- Does the agent call `figma_restore_image`?
- Is the image quality improved?
- Is the result applied back to the node?

### 8. Error handling
Send: "/generate" without any description (just the command)

**Evaluate:**
- Does the agent ask for a description?
- Does it NOT crash or error?

### Overall assessment
- Do all 7 slash commands work end-to-end?
- Is the image quality acceptable?
- Are images properly placed on the canvas (not floating at origin)?
- Does the agent handle missing Gemini key gracefully?
- Are generation times communicated to the user?
