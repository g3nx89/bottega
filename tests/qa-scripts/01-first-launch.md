# 01 — First Launch

Test the experience of opening the app for the first time (or after a clean state).

## Prerequisites
- Build the app: `npm run build`
- Figma Desktop open with at least one file and Bridge plugin active

## Steps

### 1. Launch the app
```bash
npm run build
```
Use `launchBottega()` from helpers or launch manually. Take a screenshot.

**Evaluate:**
- Does the window appear quickly (< 3s)?
- Is the title "Bottega" visible?
- Is there any flash of unstyled content or blank screen?

### 2. Check the initial state
Use `getAppState(page)` or inspect visually.

**Evaluate:**
- Is the status dot green (connected) or showing a clear "disconnected" state?
- If disconnected, is there a clear message telling the user what to do?
- Is the input field enabled and focused?
- Does the placeholder text make sense for a new user?
- Is the toolbar showing a model name?

### 3. Check tab auto-creation
**Evaluate:**
- Did tabs appear automatically for connected Figma files?
- Do tab labels show the file names (not generic "New Tab")?
- Are the tab dots showing the correct connection status?
- Is the visual distinction between active and inactive tabs clear?

### 4. Check the context bar
**Evaluate:**
- Does it show "0K / 1M" (or similar) for a fresh session?
- Is the text readable and clear?

### 5. Try to type (don't send)
Type something in the input field.

**Evaluate:**
- Does the textarea expand as you type?
- Is the cursor visible and in the right place?
- Does the send button look clickable?

### 6. Check the settings panel
Open settings (click gear icon).

**Evaluate:**
- Does it open smoothly?
- Are all sections visible (Accounts, Model, Compression, etc.)?
- Are logged-in accounts showing "Logged in" with green dots?
- Can you close it with the X button?
- Can you close it with Escape?

### 7. Screenshot and assess
Take a final screenshot.

**Overall assessment:**
- Would a new user understand what to do next?
- Is the visual design polished and consistent?
- Are there any visual glitches, overlapping elements, or cut-off text?
