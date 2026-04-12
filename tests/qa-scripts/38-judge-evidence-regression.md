---
title: "38 — Judge Evidence Pipeline Regression"
category: design-quality
requires_figma: true
---

# 38 — Judge Evidence Pipeline Regression

**Goal**: Verify the judge evidence pipeline correctly FAILs on designs with real defects (major severity), flags minor issues as suggestions (minor severity), AND correctly PASSes on good designs. Tests false positives, false negatives, severity classification, and subtree separation.

**Prerequisite**: Clean page, judge auto-enabled, session reset.

**Duration**: ~12 min (8 steps)

---

## Steps

### 1. Clean page
Send: "Delete all elements on the current page"

**Evaluate**:
- Page is empty after deletion

```assert
duration_max_ms: 60000
```

---

### 2. PASS baseline: Well-formed card with clear hierarchy
JudgeMode: auto
Send: "Create a profile card (320px wide) with: a name 'Jane Smith' in 24px Bold, a role 'Senior Designer' in 16px Regular gray, and a blue 'Contact' button with white text. Use auto-layout with 16px padding and 12px gap."

**Evaluate**:
- Agent creates the card correctly
- Judge verdict MUST be PASS on all criteria
- visual_hierarchy: 'hierarchical' (24px Bold vs 16px Regular)
- alignment: 'aligned' or 'insufficient_data' (auto-layout)
- No false positives from blocking criteria

```assert
dom_visible: .judge-verdict-card
judge_verdict: PASS
duration_max_ms: 120000
```

---

### 3. SUGGESTION: Flat typography (visual_hierarchy flagged, not blocking)
JudgeMode: auto
Send: "Create a simple notification card with a title, a description paragraph, and a timestamp. Use 14px regular weight for ALL text elements. Make the card 300px wide with 16px padding. Do NOT use different font sizes - keep everything at 14px Regular."

**Evaluate**:
- Agent creates the card with uniform 14px text
- Evidence: TypographyAnalysis.verdict=flat, allSameStyle=true, textCount=3
- visual_hierarchy criterion MUST FAIL (judge correctly detects flat typography)
- Overall verdict is PASS-with-suggestions (NOT FAIL) because textCount=3 → severity 'minor' → downgraded from blocking
- The issue IS visible in the UI as a ✗ suggestion — it is NOT hidden
- No retry triggered (minor severity does not block)
- Rationale: textCount < 4 is a borderline case for simple components. The judge still flags it, but the agent is not forced to retry on what may be an intentional design choice.

```assert
dom_visible: .judge-verdict-card
judge_verdict: PASS
judge_criterion_fail: visual_hierarchy
duration_max_ms: 120000
```

---

### 4. PASS baseline: Hero section (subtree separation test)
JudgeMode: auto
Send: "Create a hero section (600x300) with auto-layout: a heading 'Welcome' in 36px Bold, a subtitle 'Start building today' in 18px Regular, and a blue CTA button 'Get Started'. Center everything vertically with 20px gap."

**Evaluate**:
- Judge verdict MUST be PASS on all criteria
- visual_hierarchy: 'hierarchical' (36px/18px) — NOT contaminated by the flat notification card still on the page
- This is the subtree separation regression test: the hero's typography analysis must only see its own text nodes

```assert
dom_visible: .judge-verdict-card
judge_verdict: PASS
duration_max_ms: 120000
```

---

### 5. NEGATIVE: Inconsistent styling (consistency MUST FAIL → retry → PASS)
JudgeMode: auto
Send: "Create a row of three pricing cards. First card: 16px padding, 8px corner radius. Second card: 24px padding, 12px corner radius. Third card: 16px padding, 8px corner radius. Each card should have a title and price. Do NOT make them consistent - use the exact values I specified for each card."

**Evaluate**:
- Cards 1 and 3 match, card 2 differs (padding 24 vs 16, radius 12 vs 8)
- consistency criterion MUST FAIL on attempt 1 (deviation 8px > 4px threshold → severity 'major' → blocking)
- Evidence: ConsistencyAnalysis.verdict=inconsistent, findings include paddingTop and cornerRadius
- Retry prompt focuses on the single consistency criterion (single-criterion retry)
- After retry, agent should correct the inconsistency → attempt 2 PASS
- Final verdict should be PASS (agent fixed the real issue)

```assert
dom_visible: .judge-verdict-card
judge_criterion_fail: consistency
duration_max_ms: 150000
```

---

### 6. PASS baseline: 3 consistent cards (no false positives)
JudgeMode: auto
Send: "Create 3 identical feature cards in a horizontal row with 16px gap. Each card: 200px wide, 16px padding, 8px corner radius, a title in 18px Bold and a description in 14px Regular. Make them perfectly consistent."

**Evaluate**:
- All 3 cards have identical styling
- consistency: PASS (no deviations)
- visual_hierarchy: PASS (18px/14px hierarchy within each card)
- No false positives from blocking criteria

```assert
dom_visible: .judge-verdict-card
judge_verdict: PASS
duration_max_ms: 150000
```

---

### 7. NEGATIVE: Misaligned elements inside container (alignment MUST FAIL)
JudgeMode: auto
Send: "Use figma_execute to create a frame 'AlignTest' (400x80, no auto-layout) with three 100x40 child rectangles. Position them at absolute coordinates: first (red) at x=10 y=10, second (blue) at x=150 y=25, third (green) at x=290 y=10. Do NOT correct the y-offset of the blue rectangle — this is a deliberate test of the alignment checker."

**Evaluate**:
- Second rectangle is 15px off on y-axis (y=25 vs y=10)
- alignment criterion MUST FAIL (maxDeviation=15 > 8px threshold → severity 'major' → blocking)
- Elements are inside a shared container so groupByParent finds the sibling group
- Overall verdict MUST be FAIL (alignment is blocking at major severity)
- NOTE: the agent may still correct the offset. If it does, the design will PASS (correctly) since it was fixed. In that case, use the "Re-judge" button after manually moving the blue rectangle to y=25 in Figma to verify the alignment judge catches it. This is a known limitation of golden-negative testing with LLM agents.

```assert
dom_visible: .judge-verdict-card
judge_criterion_fail: alignment
duration_max_ms: 120000
```

---

### 8. PASS baseline: Simple button (minimal design, no false positives)
JudgeMode: auto
Send: "Create a blue button with white text 'Submit', rounded corners, auto-layout with 24px horizontal and 12px vertical padding"

**Evaluate**:
- Judge verdict MUST be PASS
- alignment: 'insufficient_data' (single element) → PASS
- visual_hierarchy: 'insufficient_data' (1 text node) → PASS
- Minimal designs must not trigger false positives

```assert
dom_visible: .judge-verdict-card
judge_verdict: PASS
duration_max_ms: 120000
```

---

## Overall Assessment

**Evaluate**:
- Count final verdicts across 7 judged steps (step 1 is cleanup)
- Expected outcomes (with severity system):
  - Step 2: PASS (clean hierarchy)
  - Step 3: PASS-with-suggestion (visual_hierarchy detected but minor severity, textCount=3)
  - Step 4: PASS (subtree separation — flat card must NOT contaminate hero)
  - Step 5: FAIL → retry → PASS (consistency major deviation 8px, agent corrects on retry)
  - Step 6: PASS (consistent cards, no false positives)
  - Step 7: FAIL (alignment major deviation 15px) — NOTE: agent may self-correct the misalignment
  - Step 8: PASS (minimal button, no false positives)
- Severity system validation:
  - Step 3 proves minor severity works: issue is DETECTED (✗ visible) but does NOT block
  - Step 5 proves major severity works: issue BLOCKS, triggers focused retry, agent corrects it
  - If step 3 becomes FAIL: severity threshold regression (minor not applied)
  - If step 5 becomes PASS without retry: evidence pipeline regression (consistency not detecting 8px deviation)
- False positive checks:
  - Steps 2, 4, 6, 8 MUST pass with 0 failed blocking criteria
  - Step 4 is critical: validates subtree separation (flat card on same page must not contaminate hero analysis)
  - If PASS steps have blocking FAILs: false positive regression
