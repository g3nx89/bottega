# 08 — Component Workflow

Test component search, instantiation, property setting, and variant management.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 0. Setup — Create a local component to work with
Send: "Create a button component: a 200x48 frame with auto-layout horizontal, 16px horizontal padding, 12px vertical padding, 8px corner radius, purple (#A259FF) fill, containing white text 'Button Label'."

Wait for completion. If the agent can't create components directly (Figma API limitation), note this as a finding and proceed with step 1 using library search instead.

**Evaluate:**
- Does the element appear on the canvas?
- Take a screenshot.

### 1. Search for components
Send: "Search for all available components in this file"

**Evaluate:**
- Does the agent call `figma_search_components`?
- Are component names and keys listed?
- Does it distinguish local vs library components?

### 2. Instantiate a component
If components exist: "Create an instance of [component name]"

**Evaluate:**
- Does the agent call `figma_instantiate` with the component key?
- Is the instance created on the canvas?
- Does it look like the original component?

### 3. Set instance properties
If the instance has text/boolean properties: "Change the text on this component to 'Updated Label' and toggle any boolean properties"

**Evaluate:**
- Does the agent call `figma_set_instance_properties`?
- Are text overrides applied correctly?
- Do boolean property changes take effect?

### 4. Switch variant
If the component has variants: "Switch to the 'Hover' state variant"

**Evaluate:**
- Does the agent call `figma_set_variant`?
- Does the instance visually change to the new variant?
- Is the variant property correctly identified?

### 5. Analyze component set
If component sets exist: "Analyze the structure of the [component] component set — show me all variants and their differences"

**Evaluate:**
- Does the agent call `figma_analyze_component_set`?
- Are variant dimensions and values listed?
- Are visual differences between variants noted?

### 6. Library components
Send: "List all published components from any connected libraries"

**Evaluate:**
- Does the agent call `figma_get_library_components`?
- Does it handle the case where no libraries are connected?

### 7. Arrange component set
If variant sets exist: "Arrange the variants into a clean grid layout"

**Evaluate:**
- Does the agent call `figma_arrange_component_set`?
- Is the layout organized by variant dimensions?

### Overall assessment
- Does the agent handle "no components found" gracefully?
- Does it correctly identify component keys vs node IDs?
- Are instance property overrides applied without breaking the component link?
