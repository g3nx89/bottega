# 19 — Deep Component Discovery

Test detailed component inspection, deep analysis, and component set analysis tools.

## Prerequisites
- Connected to Bottega-Test_A, session reset
- File must contain at least one component (or library components must be available)

## Steps

### 1. Search for components
Send: "Search for all button components in this file"

**Implementation hint:** The agent should use `figma_search_components` with a search term.

**Evaluate:**
- Does the agent use `figma_search_components`?
- Are results returned with component names and IDs?
- Does the response list the found components clearly?

### 2. Get component details
Send: "Show me the detailed properties and structure of the first button component you found"

**Implementation hint:** The agent should use `figma_get_component_details` with the component's node ID from step 1.

**Evaluate:**
- Does the agent use `figma_get_component_details` with a valid nodeId?
- Does the response include component properties (variants, text, boolean, instance swap)?
- Is the internal structure (children, layers) described?

### 3. Deep component analysis
Send: "Do a deep analysis of that component — show me all its variants, nested instances, and property definitions"

**Implementation hint:** The agent should use `figma_get_component_deep` for exhaustive inspection.

**Evaluate:**
- Does the agent use `figma_get_component_deep`?
- Does the response include more detail than step 2 (deeper nesting, all variants)?
- Are variant properties and their possible values listed?
- Is the information actionable for development?

### 4. Analyze a component set
Send: "Analyze the full component set that contains this button — show variant matrix and property combinations"

**Implementation hint:** The agent should use `figma_analyze_component_set` on the parent component set.

**Evaluate:**
- Does the agent use `figma_analyze_component_set`?
- Is the variant matrix (property dimensions x values) clearly presented?
- Does it identify all property combinations?
- Are any inconsistencies or missing variants flagged?

### 5. Get library components
Send: "Show me what library components are available from connected libraries"

**Implementation hint:** The agent should use `figma_get_library_components`.

**Evaluate:**
- Does the agent use `figma_get_library_components`?
- Are library components listed with names and keys?
- Is the library source identified?
- Does the agent handle the case where no libraries are connected gracefully?

### 6. Get design system overview
Send: "Give me an overview of the design system in this file — tokens, components, and styles"

**Implementation hint:** The agent should use `figma_design_system` for a comprehensive overview.

**Evaluate:**
- Does the agent use `figma_design_system`?
- Does the response cover variables/tokens, component counts, and styles?
- Is the information structured and scannable?

### Overall assessment
- Do discovery tools provide progressively deeper detail (search → details → deep → analyze)?
- Is the information formatted clearly for a developer audience?
- Does the agent choose the right level of discovery tool for each question?
- Are edge cases handled (no components, no library, empty file)?
