# 15 — Multi-Model Testing

Test switching between AI providers and verifying responses across Claude, GPT, and Gemini.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- OAuth configured for at least 2 providers (check Settings > Accounts)
- Reset session + clean page before each model switch

## Steps

### 1. Check available models
Open Settings and note all available models.

**Evaluate:**
- Are all 3 providers listed (Anthropic, OpenAI, Google)?
- Are the models current (Sonnet 4.6, GPT-5.4, Gemini 3 Flash, etc.)?
- Does each provider show "Logged in"?

### 2. Test with Claude (default)
Ensure model is Claude Sonnet 4.6. Send: "Create a 200x200 purple square with the text 'Claude' centered inside it"

**Evaluate:**
- Does the agent respond and execute correctly?
- What tools does it choose?
- Note the response time and style.

### 3. Switch to GPT
Via Settings or toolbar, switch to GPT-5.4. Reset session.
Send the same prompt: "Create a 200x200 purple square with the text 'GPT' centered inside it"

**Evaluate:**
- Does the model switch take effect?
- Does the toolbar label update to show GPT?
- Does the agent respond correctly with GPT?
- Does GPT use the same tools as Claude?
- Note any differences in response style, speed, or tool selection.

### 4. Switch to Gemini
Switch to Gemini 3 Flash. Reset session.
Send the same prompt with "Gemini" text.

**Evaluate:**
- Does Gemini work with the same tool set?
- Are there any errors or tool compatibility issues?
- Note differences in response quality.

### 5. Cross-model context isolation
Switch back to Claude. Send: "What was my last request?"

**Evaluate:**
- Does the agent correctly NOT know about the GPT/Gemini sessions?
- Is context properly isolated per session (not per model)?

### 6. Tab-level model assignment
If two tabs exist (Bottega-Test_A and Bottega-Test_B):
- Set Tab A to Claude
- Set Tab B to GPT
- Send prompts on both

**Evaluate:**
- Do tabs maintain independent model assignments?
- Is the toolbar label correct when switching tabs?

### Overall assessment
- Is model switching seamless and reliable?
- Do all models work with all tools?
- Are there quality differences worth noting?
- Does the UI clearly indicate which model is active?
