# 27 — Rapid Prompt Queue

Tests the prompt queue under stress by sending multiple prompts in rapid succession before the agent finishes processing.

**Estimated time**: 5-10 min
**Error injection**: Queue saturation, concurrent prompt handling

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. First prompt triggers streaming
Send: "Create a blue circle with a 100px diameter"
```assert
tools_called_any_of: [figma_render_jsx, figma_create_child, figma_execute]
```

### 2. Queue stress with rapid prompts
SendNoWait: "Make the circle red"
SendNoWait: "Make the circle bigger, 200px"
Send: "Add a text label below the circle saying 'Hello'"
```assert
tools_called_any_of: [figma_set_fills, figma_resize, figma_set_text, figma_render_jsx, figma_execute, figma_create_child]
duration_max_ms: 120000
```

### 3. Verify all changes applied
Send: "Take a screenshot to show the final result"
```assert
tools_called: [figma_screenshot]
```

**Overall assessment:**
- Are queued prompts processed in order?
- Does the agent handle rapid input without crashing or dropping messages?
- Are all requested changes reflected on the canvas?
