# 39 — Componentization Detection

Test whether the agent creates reusable components for repeated UI elements, and whether the judge correctly catches non-componentized duplicates.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Judge enabled (auto mode)

## Steps

### 1. Four identical cards — basic detection
Send: "Create a pizza restaurant menu section with 4 pizza cards. Each card should have: an image placeholder, the pizza name, a short description, and the price. Use auto-layout with consistent spacing."

Wait for full completion (including judge cycle).

**Evaluate:**
- What tool(s) did the agent use? (`figma_render_jsx` vs `figma_instantiate`)
- Are the 4 cards FRAME nodes or COMPONENT/INSTANCE nodes?
- Did the componentization judge trigger? What was the verdict?
- If FAIL: did retry produce actual components?
- Check app.log for: `"Componentization analysis summary"` — what were withinScreen/crossScreen counts?
- Take screenshot of final result.

**Expected:** Either (a) agent proactively creates a Card component + 4 instances, OR (b) judge catches 4 duplicate frames, retry converts to components.

### 2. Two repeated elements — threshold check
Send: "Create a comparison section with two pricing plans side by side. 'Free' plan on the left and 'Pro' plan on the right. Same card structure, different content."

**Evaluate:**
- Are the 2 pricing cards detected as duplicates (threshold is now 2)?
- Did componentization judge FAIL?
- Check log: `withinScreen` count should be >= 1.

### 3. Cross-screen component reuse
Send: "Create a homepage with a navigation bar and hero section. Then create an About page with the same navigation bar style."

**Evaluate:**
- Does the agent reuse the nav component across both pages?
- Does `crossScreen` detection find the shared navigation pattern?
- Is the nav bar a COMPONENT with INSTANCES on each page, or duplicate FRAMEs?

### 4. Mixed elements — no false positives
Send: "Create a landing page with a header, a hero section, a features section with 3 feature blocks, and a footer."

**Evaluate:**
- The 3 feature blocks should be detected as duplicates.
- Header and footer should NOT be flagged (different structure).
- False positive rate: does the judge flag things that shouldn't be components?

### 5. Post-judge retry verification
If any step above resulted in judge FAIL + retry:
- Did the agent call `figma_create_component`?
- Did it call `figma_instantiate` for remaining instances?
- Are the final nodes INSTANCE type?
- Is the component properly structured (not just renamed frames)?

### Log analysis (post-session)
After all steps, check `app.log` for:
```
grep "Componentization analysis summary" ~/Library/Logs/bottega/app.log | tail -10
grep "componentization.*fast-path\|componentization.*PASS\|componentization.*FAIL" ~/Library/Logs/bottega/app.log | tail -10
```

### Overall assessment
- Agent component creation rate: ___ / 5 steps used components
- Judge detection accuracy: ___ / 5 correct verdicts
- Retry convergence rate: ___ / N failed verdicts successfully remediated
- False positive count: ___
- False negative count: ___
