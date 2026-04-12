---
title: "38 — Judge Evidence Pipeline Regression"
category: design-quality
requires_figma: true
---

# 38 — Judge Evidence Pipeline Regression

**Goal**: Verify the judge evidence pipeline correctly FAILs on designs with real defects AND correctly PASSes on good designs. Tests both false positives AND false negatives to catch regressions in evidence extraction, analysis, blocking criteria, and subtree separation.

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

### 3. NEGATIVE: Flat typography (visual_hierarchy MUST FAIL)
JudgeMode: auto
Send: "Create a simple notification card with a title, a description paragraph, and a timestamp. Use 14px regular weight for ALL text elements. Make the card 300px wide with 16px padding. Do NOT use different font sizes - keep everything at 14px Regular."

**Evaluate**:
- Agent creates the card with uniform 14px text
- Evidence: TypographyAnalysis.verdict=flat, allSameStyle=true, textCount=3
- visual_hierarchy criterion MUST FAIL
- Overall verdict MUST be FAIL (visual_hierarchy is blocking)
- Action items should suggest fontSize/fontStyle changes with specific nodeIds

```assert
dom_visible: .judge-verdict-card
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

### 5. NEGATIVE: Inconsistent styling (consistency MUST FAIL)
JudgeMode: auto
Send: "Create a row of three pricing cards. First card: 16px padding, 8px corner radius. Second card: 24px padding, 12px corner radius. Third card: 16px padding, 8px corner radius. Each card should have a title and price. Do NOT make them consistent - use the exact values I specified for each card."

**Evaluate**:
- Cards 1 and 3 match, card 2 differs (padding 24 vs 16, radius 12 vs 8)
- consistency criterion MUST FAIL (now active in standard tier)
- Evidence: ConsistencyAnalysis.verdict=inconsistent, findings include paddingTop and cornerRadius
- Overall verdict MUST be FAIL (consistency is blocking)

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
Send: "Create three 100x40 rectangles inside a single container frame (400x60). Place them at: first at x=10, y=10; second at x=150, y=25; third at x=290, y=10. Use different colors: red, blue, green. The container should NOT use auto-layout."

**Evaluate**:
- Second rectangle is 15px off on y-axis (y=25 vs y=10)
- alignment criterion MUST FAIL (maxDeviation=15, threshold=4px)
- Elements are inside a shared container so groupByParent finds the sibling group
- Overall verdict MUST be FAIL (alignment is blocking)

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
- Count PASS vs FAIL verdicts across 7 judged steps (step 1 is cleanup)
- Expected: 4 PASS (steps 2, 4, 6, 8), 3 FAIL (steps 3, 5, 7)
- Each FAIL must fire the CORRECT blocking criterion:
  - Step 3: visual_hierarchy FAIL (flat typography)
  - Step 5: consistency FAIL (inconsistent padding/radius)
  - Step 7: alignment FAIL (15px y-offset)
- Each PASS must have 0 failed blocking criteria
- Step 4 PASS is critical: validates subtree separation (flat card on same page must not contaminate hero analysis)
- If ALL 7 PASS: evidence pipeline regression (judges not receiving evidence)
- If PASS steps FAIL: false positive regression (blocking criteria too aggressive or cross-design contamination)
