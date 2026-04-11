---
title: "IE-02 — Hero Iteration Eval"
category: iteration-eval
type: C
requires_figma: true
rubric: hero
---

# IE-02 — Hero Iteration Eval

3-round iterative design evaluation for a fintech hero section. Tests feedback comprehension and iterative convergence.

**Estimated time**: 10-15 min
**Context stress**: Medium (3 turns, accumulating context)
**Evaluation type**: Tipo C — Iteration Eval (multi-round delta scoring)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Vision model configured for iteration_delta evaluator

## Steps

### 1. Round 1 — Open brief
Send: "Create a hero section for a fintech landing page. The product helps people invest smarter with AI-driven portfolio management. Include a headline, subtitle, primary CTA, and a visual element. Brand color is #0EA5E9 (sky blue)."

**Evaluate:**
- Baseline hero created
- All requested elements present
- Brand color used

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Hero
floor_check:
  find: Hero
  rules:
    wcag_smoke: 10
iteration_delta:
  round: 1
  brief: "Hero section for a fintech landing page. AI-driven portfolio management. Headline, subtitle, primary CTA, visual element. Brand color #0EA5E9."
  rubric: hero
```

### 2. Round 2 — Subjective feedback
Send: "It doesn't communicate trust and reliability. A fintech hero needs to feel authoritative and secure, not playful. The CTA isn't prominent enough — it gets lost. Make the overall tone more serious and the value proposition clearer."

**Evaluate:**
- Does the agent understand the trust/authority feedback?
- Is the CTA more prominent?
- Does the tone shift feel appropriate for fintech?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_set_fills, figma_set_text_style, figma_set_effects]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Hero
iteration_delta:
  round: 2
  brief: "Hero section for a fintech landing page. AI-driven portfolio management. Headline, subtitle, primary CTA, visual element. Brand color #0EA5E9."
  rubric: hero
  threshold_delta_total: 1
```

### 3. Round 3 — Specific feedback
Send: "The headline spacing is too tight — give it room to breathe. Add a social proof element below the CTA (e.g. '50,000+ investors trust us' with small avatar circles). The subtitle text is too long — tighten it to one line. And increase the CTA button size, it's still undersized."

**Evaluate:**
- Does the agent address each of the 4 specific issues?
- Is the social proof element added appropriately?
- No regression from Round 2 trust/authority improvements

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_set_fills, figma_resize, figma_set_text]
screenshots_min: 1
duration_max_ms: 600000
canvas_screenshot: Hero
iteration_delta:
  round: 3
  brief: "Hero section for a fintech landing page. AI-driven portfolio management. Headline, subtitle, primary CTA, visual element. Brand color #0EA5E9."
  rubric: hero
  threshold_final: 6
  threshold_delta_total: 1
  threshold_delta_step: 0
```

### Overall assessment
- **R1 baseline**: Was the initial hero functional?
- **R2 tone shift**: Did the fintech trust/authority feedback land?
- **R3 precision**: Were all 4 specific issues addressed? Social proof added?
- **Delta R1->R3**: Improvement >= +2 points?
- **Delta R2->R3**: No regression (>= 0)?
- **Final score**: >= 6/10?
