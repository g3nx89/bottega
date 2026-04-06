# 05 — Settings and Controls

Test all UI controls, settings, and toolbar interactions.

## Prerequisites
- App launched (Figma connection optional for most tests)

## Steps

### 1. Toolbar — Model selector
Click on `#bar-model-btn` (the button element, NOT the `#bar-model-label` span inside it).

**Implementation hint:** The dropdown is dynamically created with class `.toolbar-dropdown` — there is no static `#model-popup` ID. Wait for `.toolbar-dropdown` to appear after clicking.

**Evaluate:**
- Does a dropdown/picker appear?
- Are all available models listed?
- Does selecting a different model update the label? (Known bug B-004 via settings)
- Does the model change persist after closing and reopening the app?

### 2. Toolbar — Effort level
Click on `#bar-effort-btn` (the button element, NOT the `#bar-effort-label` span inside it).

**Implementation hint:** Same dropdown mechanism as model — dynamically created `.toolbar-dropdown`, no static `#effort-popup` ID.

**Evaluate:**
- Does a dropdown appear?
- Can you select each level?
- Does the label update?
- Does the selection persist?

### 3. Toolbar — Judge toggle
Click the Judge button.

**Evaluate:**
- Does it toggle on/off visually?
- When on (active class), does the judge actually run after agent turns?
- When off, do agent turns complete without judge checks?

### 4. Toolbar — New Chat
Click the New Chat (reset) button.

**Evaluate:**
- Does it clear the chat immediately?
- Is there a confirmation dialog? (Should there be one if messages exist?)
- After reset, is the session fully usable?

### 5. Pin button
Click `#pin-btn`.

**Implementation hint:** The pin button uses class `pinned` (NOT `active`) to indicate state. Check `classList.contains('pinned')` and `title` attribute (`"Unpin from top"` when pinned, `"Keep on top"` when unpinned).

**Evaluate:**
- Does the window stay on top?
- Does the pin icon change state (class `pinned` toggled)?
- Can you unpin by clicking again?
- Does the title tooltip update?

### 6. Settings — Model switch
Open settings, change the model.

**Evaluate:**
- Does the select show all available models?
- After changing, does the toolbar label update? (Known bug B-004)
- Does the next prompt use the new model?

### 7. Settings — Compression profile
Change the compression profile.

**Evaluate:**
- Can you switch between all profiles (Balanced, Creative, Exploration, Minimal)?
- Does the change take effect on subsequent agent responses?
- Does the profile persist after app restart?

### 8. Settings — Subagent toggle
Toggle subagents on/off.

**Evaluate:**
- Does the toggle have clear on/off state?
- When off, do subagent cards stop appearing after agent turns?
- When on, do they resume?

### 9. Settings — Background transparency
Adjust the transparency slider (if present).

**Evaluate:**
- Does the window transparency change in real-time?
- Is the slider smooth?
- Does the app remain usable at low opacity?

### 10. Keyboard shortcuts
Test:
- Enter → send message
- Shift+Enter → new line in input
- Escape → close settings (if open)
- Ctrl/Cmd+K → focus input (if implemented)

**Evaluate:**
- Do all shortcuts work?
- Are there any conflicts?
- Does Shift+Enter properly add a newline without sending?

### 11. Final assessment
**Overall assessment:**
- Are all controls discoverable and intuitive?
- Do changes take effect immediately or is there a delay?
- Is the visual feedback for toggles and selections clear?
- Are there any controls that don't work or produce no visible effect?
