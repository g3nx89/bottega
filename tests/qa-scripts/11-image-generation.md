# 11 — Image Generation (Slash Commands)

Test all 7 image generation slash commands. Requires a valid Gemini API key.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Gemini API key configured in Settings > Image Generation
- Check settings panel first — if no key is set, these tests will fail gracefully

## Steps

### 1. /generate — Basic image
Send: "/generate a sunset over mountains, photorealistic style"

(Manual variant for qa-tester subagent: type `/generate`, select from the slash menu, then complete with the description.)

**Evaluate:**
- Does the slash menu appear with "/generate" highlighted?
- Does the agent call `figma_generate_image`?
- Is an image generated and placed on the canvas?
- Is the image visible in the screenshot?
- Did the agent report dimensions and placement?

```assert
# Canary for image-gen pipeline: figma_generate_image MUST be called and
# produce at least 1 visible image. duration_max is generous (Gemini latency)
# but bounded so a hung request fails.
tools_called: [figma_generate_image]
screenshots_min: 1
response_contains:
  any_of: [generated, image, sunset, mountain, placed]
  case_sensitive: false
duration_max_ms: 120000
```

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
Send: "/edit change the sky to a night sky with stars"

(Depends on step 1 having created an image; qa-runner relies on sequential step ordering.)

**Evaluate:**
- Does the agent call `figma_edit_image`?
- Does it find the correct node to edit?
- Is the edit applied to the existing image (not a new one)?

```assert
# Anti-regression for "edit, don't regenerate" semantics:
# figma_edit_image MUST be called, figma_generate_image MUST NOT be called.
# A common drift is the agent generating a fresh image instead of editing.
# NOTE: response_contains is intentionally OMITTED here. The user prompt
# ("/edit change the sky to a night sky with stars") would be echoed by the
# agent in any natural reply, making any_of: [night, stars, sky, ...] a
# tautology that adds noise without signal. The tools_called + cap on
# generate_image carry the substantive check.
tools_called: [figma_edit_image]
tools_NOT_called_more_than:
  figma_generate_image: 0
screenshots_min: 1
duration_max_ms: 120000
```

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

```assert
# Negative test: empty /generate MUST NOT call figma_generate_image (would
# waste a Gemini call) and MUST ask the user for a description in natural
# language. The cap of 0 enforces "no premature generation".
# Token tightening: dropped "what" and "please" — they're ambient polite
# English that match almost any agent reply. Kept the substantive
# clarification-asking tokens.
tools_NOT_called_more_than:
  figma_generate_image: 0
response_contains:
  any_of: [description, missing, prompt, provide, specify]
  case_sensitive: false
duration_max_ms: 30000
```

### Overall assessment
- Do all 7 slash commands work end-to-end?
- Is the image quality acceptable?
- Are images properly placed on the canvas (not floating at origin)?
- Does the agent handle missing Gemini key gracefully?
- Are generation times communicated to the user?
