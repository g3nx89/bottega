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

```assert
# Canary test: this is the most basic flow. If this step fails, something
# fundamental is broken (WS bridge, screenshot tool, basic streaming).
# We want a loud failure on regression, not SOFT_PASS.
tools_called: [figma_screenshot]
screenshots_min: 1
response_contains:
  any_of: [see, canvas, screen, page, figma]
  case_sensitive: false
duration_max_ms: 30000
```

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

```assert
# Creation step: any of three creation tools is valid per the prompt's intent.
# tools_called_any_of expresses the domain truth without forcing arbitrary
# pre-calibration choice (the agent's pick depends on prompt phrasing + model).
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
response_contains:
  any_of: [button, created, rendered]
  case_sensitive: false
duration_max_ms: 90000
tools_NOT_called_more_than:
  figma_screenshot: 2
```

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

```assert
# Modification step: must use a mutation tool, must NOT create a new node.
# figma_create_child cap=0 enforces "modify, don't create".
# Calibration (2026-04-08) found the agent uses figma_set_fills more often
# than figma_execute for color changes — any_of accepts both.
#
# B-021 sentinel note: the prior dom_visible: "#suggestions:not(.hidden)"
# check was dropped because the prompt-suggester is an ASYNC post-turn LLM
# call that may land after the runner's settle window — produced 0/3 PASS in
# calibration. B-021 coverage is maintained by the playbook unit test
# (tests/unit/main/*.test.ts) which stubs the suggester deterministically.
# A future P2 `dom_wait_visible` with explicit timeout would let us re-add
# the sentinel here without depending on settle timing.
tools_called_any_of: [figma_execute, figma_set_fills, figma_set_text]
tools_NOT_called_more_than:
  figma_create_child: 0
  figma_render_jsx: 0
response_contains:
  any_of: [red, white, changed, updated]
  case_sensitive: false
screenshots_min: 1
duration_max_ms: 60000
```

### 7. Test follow-up suggestions
Click one of the suggestion chips (if visible).

**Evaluate:**
- Does clicking a suggestion fill it into the input and send it?
- Does the suggestion lead to a coherent follow-up?

> **Note**: this step is **manual** (no `Send:` line) — the qa-runner skips it
> with `isManual: true`. The B-021 sentinel for suggestion chip visibility
> lives in step 6's `assert` block, because chips appear as a side-effect of
> step 6's agent response, before the manual click happens here.

### 8. Final assessment
Take a screenshot of the full conversation.

**Overall assessment:**
- Was the conversation natural and productive?
- Did the agent understand the requests correctly?
- Were the tool calls appropriate (not excessive or missing)?
- Did the visual feedback (tool cards, screenshots) help understand what happened?
- Were there any confusing moments where the user wouldn't know what's happening?
