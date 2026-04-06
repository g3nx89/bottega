# 21 — Design System Migration

Migrate an existing design from hardcoded values to a proper design token system. Tests multi-step refactoring, token binding, and systematic updates across many elements.

**Estimated time**: 20-30 min
**Context stress**: High (many elements, systematic changes)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create the "legacy" design
Send: "Create a mock dashboard with these elements, using HARDCODED colors (no tokens):
- A sidebar (250px wide, dark background #1A1A2E) with 5 menu items in white text
- A top bar (full width, #16213E background) with a search input and user avatar circle
- A main content area with 3 stat cards in a row (white background, #0F3460 text, #E94560 accent for numbers)
- Below the cards, a simple table with 4 rows of data
Use specific hex colors, not variables."

**Evaluate:**
- Is the dashboard created with multiple sections?
- Are colors hardcoded (not bound to variables)?
- Take a screenshot of the baseline.

### 2. Audit the current state
Send: "Run a design lint on the current page. How many hardcoded colors are there? Are there any design system violations?"

**Evaluate:**
- Does the agent call `figma_lint`?
- Does it report hardcoded colors and missing tokens?
- Is the report accurate (reflecting what we just created)?

### 3. Create the token system
Send: "Now let's migrate to a proper design system. Create these tokens:
- Colors: background-primary (#1A1A2E), background-secondary (#16213E), background-card (#FFFFFF), text-primary (#E8E8E8), text-secondary (#A0A0B0), accent (#E94560), accent-hover (#FF6B6B)
- Spacing: xs (4), sm (8), md (16), lg (24), xl (32), 2xl (48)
- Radius: sm (4), md (8), lg (16)
Name the collection 'Dashboard Tokens'."

**Evaluate:**
- Does the agent call `figma_setup_tokens`?
- Are all variables created correctly?
- Is the collection named properly?

### 4. Migrate sidebar colors
Send: "Now bind all sidebar elements to the token system. The sidebar background should use 'background-primary', the menu text should use 'text-primary'."

**Evaluate:**
- Does the agent call `figma_bind_variable` for each element?
- Does it find all sidebar children correctly?
- Are the bindings applied (not just color values changed)?

### 5. Migrate top bar
Send: "Bind the top bar to 'background-secondary', the search input text to 'text-primary', and the avatar border to 'accent'."

**Evaluate:**
- Does the agent continue finding elements by name/position?
- Are the bindings correct?
- Does the top bar visually stay the same (same colors, now tokenized)?

### 6. Migrate stat cards
Send: "Bind all 3 stat cards: backgrounds to 'background-card', text to appropriate text tokens, and numbers to 'accent'. Also bind spacing and border radius to the spacing/radius tokens."

**Evaluate:**
- Does the agent handle multiple cards systematically?
- Does it use batch operations or process one at a time?
- Are spacing/radius bindings applied (not just colors)?

### 7. Re-lint after migration
Send: "Run the lint again. What's improved?"

**Evaluate:**
- Does the lint show fewer violations?
- Does it report improved token coverage?
- Can the agent compare before/after?

### 8. Test theme switching
Send: "Now add a 'Light' mode to the tokens where background-primary becomes #F5F5F5, background-secondary becomes #FFFFFF, text-primary becomes #1A1A2E, and accent stays #E94560."

**Evaluate:**
- Does the agent add a mode correctly?
- Are bound elements ready to switch themes?
- Does the agent explain how modes work?

### 9. Final review
Send: "Take a screenshot and give me a final assessment of the migration. What percentage of elements are now tokenized? What's still hardcoded?"

**Evaluate:**
- Is the assessment accurate?
- Does the dashboard still look correct visually?
- Has the agent maintained context about what was migrated?

### Overall assessment
- **Systematic approach**: Did the agent migrate section by section without missing elements?
- **Token accuracy**: Are bindings correct (right property → right token)?
- **Non-destructive**: Does the design look the same after migration?
- **Context over time**: Did the agent remember which elements were already migrated?
- **Completeness**: What percentage was actually migrated vs missed?
