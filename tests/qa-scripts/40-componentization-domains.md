# 40 — Componentization Across Design Domains

Extended sampling: test component creation across 6 design domains to measure baseline rates. Each prompt naturally requires repeated elements. Run sequentially, clean page between prompts.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- Judge enabled (auto mode)
- **Recommended timeout**: 480s (`--timeout 480000`) — steps with 4+ AI image generations
  (Portfolio team, E-commerce products) take ~180-240s for Gemini calls alone, plus
  agent design time and judge retry cycle. Default 300s is insufficient.

## Steps

### 1. Restaurant — Menu grid
Send: "Design a restaurant menu page with a header, and a grid of 6 dish cards. Each card: dish photo, name, description, price. Use warm colors and clean typography."

**Evaluate:**
- Did the agent use figma_create_component + figma_instantiate?
- Are the dish cards INSTANCE nodes or FRAME nodes?
- Did the componentization judge PASS or FAIL?

### 2. E-commerce — Product grid
Send: "Create a product listing page for a clothing store. Show 4 product cards in a 2x2 grid. Each card has: product image, name, price, and an 'Add to Cart' button."

**Evaluate:**
- Component creation: figma_create_component used?
- Judge verdict for componentization?

### 3. SaaS — Pricing tiers
Send: "Design a SaaS pricing page with 3 tiers: Starter ($9/mo), Professional ($29/mo), Enterprise ($99/mo). Each tier shows the plan name, price, feature list with checkmarks, and a CTA button."

**Evaluate:**
- Component creation: figma_create_component used?
- Judge verdict for componentization?

### 4. Portfolio — Team page
Send: "Create a team section for a design agency website. Show 4 team members in a row. Each member has: circular photo placeholder, name, role title, and a short bio."

**Evaluate:**
- Component creation: figma_create_component used?
- Judge verdict for componentization?

### 5. Mobile — Tab navigation
Send: "Design a mobile app bottom navigation bar with 5 tabs: Home, Search, Favorites, Cart, Profile. Each tab has an icon placeholder and label text."

**Evaluate:**
- Component creation: figma_create_component used?
- Judge verdict for componentization?

### 6. Dashboard — Stat cards
Send: "Create a dashboard header with 4 stat cards in a row. Each card shows: metric label, large number value, percentage change badge, and a small sparkline placeholder."

**Evaluate:**
- Component creation: figma_create_component used?
- Judge verdict for componentization?

## Scoring

| Prompt | Components Used? | Judge Correct? | Retry Worked? |
|--------|-----------------|----------------|---------------|
| Restaurant menu | | | |
| E-commerce products | | | |
| SaaS pricing | | | |
| Portfolio team | | | |
| Mobile nav | | | |
| Dashboard stats | | | |

**Baseline metrics:**
- Component creation rate: ___ / 6
- Judge detection accuracy: ___ / 6
- Retry convergence: ___ / N
- Average tool calls per prompt: ___

### Log analysis
```
grep "Componentization analysis summary" ~/Library/Logs/bottega/app.log | tail -20
grep "componentization" ~/Library/Logs/bottega/app.log | grep -E "fast-path|PASS|FAIL" | tail -20
```
