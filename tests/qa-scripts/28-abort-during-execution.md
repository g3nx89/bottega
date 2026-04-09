# 28 — Abort During Tool Execution

Tests the agent's ability to handle an abort (stop button) while tools are actively executing, and recover to a usable state.

**Estimated time**: 5-10 min
**Error injection**: Mid-execution abort, state recovery

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Start complex operation
Send: "Create a full dashboard layout with a header bar, left sidebar navigation, main content area with a grid of 4 cards, and a footer"

### 2. Abort mid-stream
MANUAL: Click the stop button after 5 seconds while tools are executing

### 3. Verify clean state after abort
Send: "Take a screenshot of what's currently on the canvas"
```assert
tools_called: [figma_screenshot]
```

### 4. Verify agent still responsive
Send: "Create a simple red rectangle"
```assert
tools_called_any_of: [figma_render_jsx, figma_create_child, figma_execute]
```

**Overall assessment:**
- Does the abort complete without crashing the app?
- Is the agent responsive after the abort?
- Is the canvas in a consistent (not corrupted) state?
