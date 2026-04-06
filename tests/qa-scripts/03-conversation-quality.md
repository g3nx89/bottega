# 03 — Conversation Quality

Test the quality of agent responses, context retention, and multi-turn coherence.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Multi-turn context retention
Send a sequence of related prompts:
1. "Create a frame called 'Header' that is 1440x80 pixels"
2. "Add a logo placeholder on the left side of the Header"
3. "Now add navigation links on the right side"

**Evaluate:**
- Does the agent remember the Header from step 1?
- Does it place elements inside the Header (not on the root page)?
- Does each response reference previous context naturally?
- Are the elements spatially coherent (left/right positioning)?

### 2. Ambiguity handling
Send: "Make it bigger"

**Evaluate:**
- Does the agent ask for clarification or make a reasonable guess?
- If it guesses, is the guess reasonable (resize the last element)?
- Does the response acknowledge the ambiguity?

### 3. Error in request
Send: "Change the color to #GGHHII"

**Evaluate:**
- Does the agent recognize the invalid color code?
- Does it suggest a valid alternative or ask for correction?
- Does it NOT crash or produce an error toast?

### 4. Complex request
Send: "Create a card component with a 300x400 frame, an image placeholder at the top (300x200), a title below it, a description text, and a button at the bottom. Use a clean modern style."

**Evaluate:**
- Does the agent break this into multiple tool calls?
- Is the visual result well-structured (proper hierarchy)?
- Are elements aligned and spaced sensibly?
- Does the agent show the result with a screenshot?

### 5. Response format quality
Review all responses in the conversation.

**Evaluate:**
- Is markdown rendered correctly (bold, lists, code)?
- Are responses concise or overly verbose?
- Does the agent use appropriate formatting (not walls of text)?
- Are tool cards readable and informative?

### 6. Final assessment
**Overall assessment:**
- Does the conversation feel natural and productive?
- Would a designer find the agent helpful or frustrating?
- Are there moments where context is lost or responses are incoherent?
