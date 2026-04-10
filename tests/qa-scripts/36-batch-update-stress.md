---
title: "36 — Batch Update Stress"
category: design-quality
requires_figma: true
---

# 36 — Batch Update Stress

Create 5 distinct card variants, then batch-update their padding and primary color, finishing with a judge-evaluated screenshot. Tests the agent's ability to manage bulk mutations without losing track of multiple elements.

**Estimated time**: 20-30 min
**Context stress**: High (5 elements, batch ops)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create 5 different cards
Send: "Create 5 different card components in a horizontal row (32px gap between each), each 240px wide and 160px tall. Name them Card01 through Card05. Give each a distinct background color: Card01=#FAFAFA, Card02=#EFF6FF, Card03=#F0FDF4, Card04=#FFF7ED, Card05=#FDF4FF. Each card should have a 16px title text and 12px body text placeholder, with 16px padding all around. Use auto-layout for each card's internal layout."

**Evaluate:**
- Does the agent create all 5 cards?
- Are the distinct colors applied correctly?
- Is the row layout created within 120 seconds?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
duration_max_ms: 120000
```

### 2. Batch update padding to 24px
Send: "Update the padding on ALL five cards (Card01 through Card05) to 24px on all sides. Use batch operations if possible."

**Evaluate:**
- Does the agent use batch tools or systematic single calls?
- Are all 5 cards updated (not just 1-2)?
- Does the response confirm all cards were modified?

```assert
tools_called_any_of: [figma_batch_transform, figma_execute, figma_auto_layout, figma_batch_set_fills]
response_contains:
  any_of: [all, five, each, "24", padding, updated]
  case_sensitive: false
duration_max_ms: 150000
```

### 3. Change primary color across all cards
Send: "Change the title text color on all five cards to #1E40AF (dark blue). Update each card's bottom border to a 2px stroke in #3B82F6 (blue). Apply these changes to all five cards."

**Evaluate:**
- Does the agent modify text color on all cards?
- Are strokes applied to all cards?
- Is the batch approach efficient (not excessive individual calls)?

```assert
tools_called_any_of: [figma_set_text, figma_set_fills, figma_set_strokes, figma_execute, figma_batch_set_fills, figma_batch_set_text]
duration_max_ms: 120000
```

### 4. Screenshot and verify
Send: "Take a screenshot of all five cards and verify the batch updates were applied correctly — 24px padding, dark blue title text, blue bottom strokes on each."

JudgeMode: auto

**Evaluate:**
- Does the agent capture a screenshot showing all 5 cards?
- Does the judge trigger to evaluate the batch result?
- Does the response confirm the updates are visible?

```assert
tools_called: [figma_screenshot]
judge_triggered: true
screenshots_min: 1
response_contains:
  any_of: [all, five, cards, updated, padding, blue]
  case_sensitive: false
duration_max_ms: 90000
```

### Overall assessment
- **Batch coverage**: Were all 5 cards updated in each batch step?
- **Padding accuracy**: Is padding 24px on all cards?
- **Color accuracy**: Is title text #1E40AF and strokes #3B82F6 on each card?
- **Performance**: Did the agent handle 5-card batches without excessive tool calls?
- **Judge quality**: Did the quality check surface any batch inconsistencies?
