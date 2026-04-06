# 13 — Design Annotations

Test reading, writing, and categorizing design annotations on Figma nodes.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 0. Setup — Create elements to annotate
Send: "Create a 400x300 frame called 'Login Card' with a text input placeholder (300x40 rectangle named 'Email Input'), a 'Login' button (200x48 purple frame with white text), and a 'Forgot password?' text link below it."

Wait for creation. This gives us meaningful nodes to annotate.

**Evaluate:**
- Are the elements created with proper names?
- Take a screenshot.

### 1. Get annotation categories
Send: "What annotation categories are available?"

**Evaluate:**
- Does the agent call `figma_get_annotation_categories`?
- Are categories listed clearly?
- Do they include design-relevant categories?

### 2. Set an annotation
Send: "Add an annotation to the main frame: category 'Development', label 'This component uses a 8px grid system. All spacing values must be multiples of 8.'"

**Evaluate:**
- Does the agent call `figma_set_annotations`?
- Is the annotation applied to the correct node?
- Is the category correctly set?

### 3. Set annotation with markdown
Send: "Add a detailed annotation with markdown formatting: '## Interaction\n- Hover: background changes to primary-light\n- Click: triggers navigation\n- Disabled: 50% opacity'"

**Evaluate:**
- Is markdown content preserved in the annotation?
- Does the agent handle multiline content correctly?

### 4. Read annotations
Send: "Read all annotations on this page, including children"

**Evaluate:**
- Does the agent call `figma_get_annotations` with depth traversal?
- Are previously set annotations returned?
- Is the output well-formatted?

### 5. Pinned properties
Send: "Add an annotation that pins the width, height, and fill color properties"

**Evaluate:**
- Does the agent use the `pinnedProperties` field?
- Are the correct CSS-like properties referenced?

### Overall assessment
- Are annotations non-destructive (don't alter the design)?
- Does the agent handle nodes without annotations gracefully?
- Is the annotation format useful for design handoff?
