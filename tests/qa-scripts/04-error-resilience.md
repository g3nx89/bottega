# 04 — Error Resilience

Test how the app handles errors, interruptions, and edge cases.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Abort during streaming
Send a complex prompt: "Analyze every element on the page in detail, list all properties of each node, and create a comprehensive design system report"

Wait 3 seconds for streaming to start, then try to abort.

**Evaluate:**
- Is there a visible stop/abort button? (Known bug B-002: there isn't)
- Can you abort via IPC (`window.api.abort(slotId)`)?
- How long does the abort take to complete?
- After abort, is the input field usable again?
- Is the partial response visible or was it cleaned up?
- Is the app in a usable state (can you send another prompt)?

### 2. Rapid prompt sending
Send 3 prompts in quick succession:
1. "Take a screenshot"
2. "What colors do you see?"
3. "Describe the layout"

**Evaluate:**
- Does the queue mechanism kick in?
- Is the queue visible in the UI?
- Are prompts processed in order?
- Can you remove a queued prompt?
- Do all prompts eventually get responses?

### 3. Session reset during streaming
Send a prompt, then while it's streaming, click "New Chat".

**Evaluate:**
- Does the reset stop the streaming?
- Is the chat area cleared?
- Can you send a new prompt immediately?
- Are there any ghost messages or artifacts left?

### 4. Invalid tool result handling
Send: "Execute this code: figma.currentPage.notAMethod()"

**Evaluate:**
- Does the agent handle the error gracefully?
- Is the error visible to the user in a useful way?
- Does the app remain functional after the error?
- Can you continue the conversation?

### 5. Multiple tabs during operations
If 2 tabs are connected:
1. Send a prompt on Tab A
2. While Tab A is streaming, switch to Tab B
3. Send a prompt on Tab B

**Evaluate:**
- Does Tab B work independently?
- When you switch back to Tab A, is its response complete?
- Are the responses correctly scoped (no cross-tab contamination)?
- Does the context bar update when switching tabs? (Known bug B-001)

### 6. Long response handling
Send: "List every available Figma tool and describe what each one does"

**Evaluate:**
- Does the response stream smoothly for long text?
- Does the chat auto-scroll to follow new content?
- Is the response readable (not cut off or overflowing)?
- Does the send button area remain visible?

### 7. Final assessment
**Overall assessment:**
- How robust does the app feel under stress?
- Would a user lose work or get confused during error scenarios?
- Are error states communicated clearly?
- Can the user always recover to a usable state?
