# 02 — Happy Path

Test the core user journey: ask the agent to do something in Figma and verify the result.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Send a simple prompt
Send: "Take a screenshot and describe what you see"

**Evaluate:**
- Does the user message appear immediately in the chat?
- Does the input field clear after sending?
- Is there a visual indicator that the agent is working (streaming)?
- Does the placeholder change to indicate the agent is busy?

### 2. Wait for the response
Wait for the agent to finish.

**Evaluate:**
- Does the response appear progressively (streaming) or all at once?
- Is the response text well-formatted (markdown rendered correctly)?
- Did a tool card appear for `figma_screenshot`? Does it show success (checkmark)?
- Did a screenshot image appear inline in the chat?
- Is the screenshot showing the actual Figma canvas (not blank/broken)?
- Did follow-up suggestions appear below the response?

### 3. Check context usage
Look at the context bar after the response.

**Evaluate:**
- Did the context counter increase from 0K?
- Does the number seem reasonable (not excessively high for a simple exchange)?

### 4. Send a creation prompt
Send: "Create a blue button with the text 'Click Me', about 200x60 pixels with rounded corners"

**Implementation hint:** The agent may use `figma_render_jsx` (which returns an inline screenshot in its result) instead of `figma_execute`/`figma_create_child`. In that case, 1 screenshot in chat is correct — do NOT require ≥2 screenshots.

**Evaluate:**
- Does the agent use an appropriate creation tool (`figma_render_jsx`, `figma_execute`, or `figma_create_child`)?
- Is there at least 1 screenshot showing the created element (inline from tool result or explicit `figma_screenshot`)?
- Does the agent's description match what was actually created?
- Did the Judge quality check trigger? What did it report?

### 5. Verify in Figma (if possible)
Look at the Figma file directly.

**Evaluate:**
- Does the element exist with the correct properties?
- Is it named reasonably in the layer tree?
- Are the colors/size roughly what was requested?

### 6. Send a modification prompt
Send: "Change the button color to red and make the text white"

**Evaluate:**
- Does the agent find and modify the existing element (not create a new one)?
- Does the verification screenshot show the change?
- Is the response clear about what was changed?

### 7. Test follow-up suggestions
Click one of the suggestion chips (if visible).

**Evaluate:**
- Does clicking a suggestion fill it into the input and send it?
- Does the suggestion lead to a coherent follow-up?

### 8. Final assessment
Take a screenshot of the full conversation.

**Overall assessment:**
- Was the conversation natural and productive?
- Did the agent understand the requests correctly?
- Were the tool calls appropriate (not excessive or missing)?
- Did the visual feedback (tool cards, screenshots) help understand what happened?
- Were there any confusing moments where the user wouldn't know what's happening?
