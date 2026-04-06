# 16 — Session Persistence & Prompt Queue Deep Dive

Test session restore across app restarts, prompt queue edge cases, and context management.

## Prerequisites
- Connected to Bottega-Test_A and Bottega-Test_B, session reset, clean pages on both files
- Both files with Bridge plugin active

## Steps

### 1. Build conversation state
On Tab A, send 2-3 prompts to build context:
1. "Take a screenshot"
2. "Create a small red circle"
3. "What elements are on the page now?"

**Evaluate:**
- Do all prompts get responses?
- Is context maintained across turns (agent remembers the circle)?

### 2. Check context bar
Note the context bar value (e.g., "25K / 1M").

**Evaluate:**
- Is the value non-zero and increasing with each turn?
- Does it seem proportional to the conversation length?

### 3. Queue — rapid fire
While Tab A agent is responding (streaming), send 3 more prompts quickly:
- "Change the circle to blue"
- "Add a square next to it"
- "Take a final screenshot"

**Evaluate:**
- Do prompts 2 and 3 appear in the queue?
- Is the queue panel visible with numbered items?
- Does each queued prompt show its text?

### 4. Queue — edit a queued prompt
While prompts are queued, edit one of them (change text).

**Evaluate:**
- Can you edit via IPC (`window.api.queueEdit(slotId, promptId, newText)`)?
- Does the queue UI update to show the edited text?

### 5. Queue — remove a queued prompt
Remove one queued prompt.

**Evaluate:**
- Can you remove via the UI (click X on queue item)?
- Can you remove via IPC (`window.api.queueRemove(slotId, promptId)`)?
- Does the queue re-number after removal?
- Is the removed prompt truly gone (doesn't get processed)?

### 6. Queue — auto-processing
Wait for all queued prompts to process.

**Evaluate:**
- Are prompts processed in order (FIFO)?
- Does each get a proper user bubble + assistant response?
- Does the queue shrink as prompts are processed?
- Is the queue hidden when empty?

### 7. Session reset (New Chat)
Click New Chat.

**Evaluate:**
- Are all messages cleared?
- Is the context bar reset to 0K?
- Are suggestions hidden?
- Is the task panel cleared?
- Can you send a new prompt immediately?

### 8. Tab B independence
Switch to Tab B.

**Evaluate:**
- Does Tab B have its own independent chat history?
- Is Tab B's context separate from Tab A's?
- Can you send prompts on Tab B without affecting Tab A?

### 9. App restart persistence (if feasible)
Close and relaunch the app.

**Evaluate:**
- Are Tab A and Tab B restored?
- Are the correct file names shown?
- Do tabs reconnect to Figma automatically?
- Is previous conversation history accessible or was it cleared?

### Overall assessment
- Is the queue reliable (no lost prompts, correct ordering)?
- Does session reset fully clear state?
- Is tab isolation complete?
- Does app restart restore a usable state?
