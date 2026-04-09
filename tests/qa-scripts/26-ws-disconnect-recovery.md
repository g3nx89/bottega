# 26 — WebSocket Disconnect Recovery

Tests the agent's ability to recover from a WebSocket disconnection mid-session and resume normal operation without data loss.

**Estimated time**: 5-10 min
**Error injection**: WebSocket resilience

## Prerequisites
- Connected to Bottega-Test_A, session reset, Figma Bridge plugin loaded

## Steps

### 1. Establish baseline
Send: "Take a screenshot of the current canvas"
```assert
tools_called_any_of: [figma_screenshot, figma_status]
```

### 2. Simulate disconnect
MANUAL: Close the Figma Bridge plugin window in Figma Desktop, wait 5 seconds, then reopen it

### 3. Verify recovery
Send: "Take another screenshot to check the canvas"
```assert
tools_called_any_of: [figma_screenshot, figma_status, figma_execute]
response_contains:
  any_of: ["screenshot", "canvas", "here", "current"]
```

### 4. Verify no data loss
Send: "What elements are currently on the canvas?"
```assert
tools_called_any_of: [figma_get_file_data, figma_screenshot, figma_execute]
response_contains:
  any_of: ["canvas", "elements", "frame", "page", "empty", "nothing"]
```

**Overall assessment:**
- Does the agent detect the disconnection and reconnect?
- Are tool calls after reconnection successful?
- Is the agent's conversational state preserved across the disconnect?
