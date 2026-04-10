---
title: "DE-05 — Product Card Design Eval"
category: design-eval
type: B
requires_figma: true
rubric: card
---

# DE-05 — Product Card Design Eval

Open-brief design evaluation for an e-commerce fashion product card. Focus on visual appeal, imagery handling, and conversion.

**Estimated time**: 5-8 min
**Context stress**: Low
**Evaluation type**: Tipo B — Design Eval (vision model + rubric)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for design_crit evaluator

## Steps

### 1. Design brief
Send: "Design a product card for an e-commerce fashion store. The card should display: a product image area (placeholder), product name, brand name, price with a strikethrough original price showing the discount, a color swatch selector (3 dots), and an 'Add to Cart' button. Make it visually appealing and conversion-focused."

**Evaluate:**
- Does the card feel like a fashion e-commerce product?
- Is the price/discount hierarchy clear?
- Is the image area prominent (fashion is visual-first)?
- Does the CTA encourage action?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Product
floor_check:
  find: Product
  rules:
    default_names: 0
    nesting_depth: 4
    wcag_smoke: 10
design_crit:
  brief: "Product card for an e-commerce fashion store. Image area, product name, brand name, price with strikethrough discount, color swatch selector (3 dots), Add to Cart button. Visually appealing and conversion-focused."
  rubric: card
  threshold: 6
```

### Overall assessment
- **Visual appeal**: Does it feel like a fashion store (not generic)?
- **Price hierarchy**: Is the discount clearly communicated?
- **Conversion**: Does the Add to Cart button stand out?
- **Gate**: Floor pass AND mean design_crit score >= 6/10
