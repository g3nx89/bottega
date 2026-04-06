# 25 — Iterative Design Refinement

Start with a rough design and progressively refine it through many rounds of feedback. Tests the agent's ability to handle continuous corrections, subjective feedback, and incremental improvement without losing quality.

**Estimated time**: 25-35 min
**Context stress**: Very high (many turns, subjective requirements, accumulated changes)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create a rough first draft
Send: "Create a mobile settings screen (375x812). Include: a back arrow and 'Settings' title at top, followed by these sections: 'Account' (with avatar, name, email), 'Preferences' (with toggles for Notifications, Dark Mode, Language), 'Privacy' (with toggles for Location, Analytics), and a 'Log Out' button at the bottom. Just get the structure right, don't worry about polish."

**Evaluate:**
- Is the structure correct (all sections present)?
- Does it look like a rough draft (not over-polished)?
- Take a screenshot.

### 2. First round — Spacing
Send: "The spacing feels uneven. Make all section headers consistently 24px below the previous section. Items within a section should have 12px between them. The back arrow area should be 16px from the top."

**Evaluate:**
- Does the agent identify and fix spacing systematically?
- Does it use auto-layout or manual positioning?
- Is the result more consistent?

### 3. Second round — Typography
Send: "The text hierarchy isn't clear enough. Make section headers 16px semibold in #333. Item labels should be 15px regular in #444. The user's name should be 18px semibold, email 13px regular #888. The 'Log Out' button text should be 15px in red #E74C3C."

**Evaluate:**
- Does the agent find each text element correctly?
- Are all font sizes and colors applied?
- Does the hierarchy feel better visually?

### 4. Third round — Visual refinement
Send: "Add subtle visual separators — thin 1px #EEEEEE lines between sections. Give the account area a light gray (#F8F8FA) background card with 12px corners and 16px padding. Make the toggle placeholders more visible — use a 48x28 rounded rectangle for each with #DDD fill."

**Evaluate:**
- Are separators, card background, and toggle shapes created?
- Does the design feel more polished now?
- Screenshot comparison vs step 1.

### 5. Fourth round — Contradictory feedback (test adaptability)
Send: "Actually, I changed my mind about the separators. Remove them — they make it feel too busy. Instead, add 32px spacing between sections to visually separate them. Also, make the 'Log Out' button a full-width pill shape instead."

**Evaluate:**
- Does the agent remove the separators it just added?
- Does it handle the contradiction gracefully (no frustration, no confusion)?
- Does it apply the new spacing and button changes?
- Is the result better or worse? (Agent should comment on the tradeoff)

### 6. Fifth round — Alignment check
Send: "Everything should be left-aligned with 20px margin from the screen edge. Check every element and fix any misalignment."

**Evaluate:**
- Does the agent check ALL elements systematically?
- Does it fix any that were off?
- Is the result precisely aligned?

### 7. Sixth round — Vague feedback
Send: "It still doesn't feel right. Something about the account section looks off. Can you figure out what's wrong and fix it?"

**Evaluate:**
- How does the agent handle vague feedback?
- Does it take a screenshot and analyze?
- Does it suggest specific issues (spacing, proportion, alignment)?
- Does it propose and make fixes?
- Is the self-assessment reasonable?

### 8. Final comparison
Send: "Take screenshots showing the evolution: take one now and compare it to how it started. What's improved? What could still be better?"

**Evaluate:**
- Can the agent articulate what changed?
- Is the final design significantly better than the start?
- Does it identify remaining opportunities for improvement?
- Is the self-critique honest?

### 9. Context test
Send: "Without looking, list all the sections on this screen and what's in each one."

**Evaluate:**
- Can the agent recall the full structure from memory?
- Is its recall accurate after 8+ turns?
- Does it mention both the current state AND changes that were made?

### Overall assessment
- **Iteration tolerance**: Did the agent handle 8+ rounds without quality degradation?
- **Contradiction handling**: Did it handle "undo what you just did" gracefully?
- **Vague feedback**: Could it interpret and act on subjective/vague direction?
- **Progressive quality**: Did the design genuinely improve with each round?
- **Accumulated context**: Did it maintain awareness of all changes made?
- **Self-assessment**: Was its final review honest and useful?
