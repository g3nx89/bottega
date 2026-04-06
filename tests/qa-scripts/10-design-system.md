# 10 — Design System: Tokens, Binding & Linting

Test the design system tools: token creation, variable binding, and design linting.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create a token system
Send: "Set up a design token system with: colors (primary=#A259FF, secondary=#1ABCFE, background=#1E1E1E, surface=#2C2C2C, text=#FFFFFF), spacing (sm=8, md=16, lg=24, xl=32), and corner radius (sm=4, md=8, lg=16). Use a collection called 'Bottega Tokens'."

**Evaluate:**
- Does the agent call `figma_setup_tokens`?
- Are all variables created with correct types (COLOR, FLOAT)?
- Is the collection named correctly?
- Does idempotency work (running again doesn't create duplicates)?

### 2. Bind variables to elements
First create a frame: "Create a 300x200 card with the surface background color"
Then: "Bind the card's fill to the 'surface' token and its corner radius to the 'md' radius token"

**Evaluate:**
- Does the agent call `figma_bind_variable`?
- Are the bindings applied (not just raw values)?
- Does the node show variable references in Figma?

### 3. Multi-mode tokens
Send: "Add a 'Dark' mode to the token collection where primary=#BB86FC and background=#121212"

**Evaluate:**
- Does the agent handle multi-mode token creation?
- Are mode values correctly applied?
- Is the existing 'Default' mode preserved?

### 4. Design system overview
Send: "Give me an overview of the current design system"

**Evaluate:**
- Does the agent call `figma_design_system`?
- Does it report the tokens we just created?
- Are variable collections, modes, and values listed?

### 5. Design lint
Send: "Lint the current page for design system compliance"

**Evaluate:**
- Does the agent call `figma_lint`?
- Does it report DS adherence (token usage)?
- Does it report best practices (auto-layout, naming)?
- Are issues categorized by severity?

### 6. Create a DS documentation page
Send: "Create a Design System page that documents all our tokens with visual samples"

**Evaluate:**
- Does the agent call `figma_update_ds_page`?
- Is a new page created with color swatches?
- Are typography and spacing documented?
- Does it include a visual key?

### 7. Lint after proper token usage
Send: "Now create a properly tokenized card using only our design tokens — bind every color and spacing value"

**Evaluate:**
- Does re-running lint show improved compliance?
- Does the card use variable bindings (not hardcoded values)?

### Overall assessment
- Is the token workflow end-to-end coherent (create → bind → lint → fix)?
- Does idempotent setup work without side effects?
- Is the lint output actionable and clear?
- Does the DS page look professional?
