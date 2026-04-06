# 06 — Discovery & File Analysis

Test all read-only discovery tools that inspect Figma file structure.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 0. Setup — Create content to discover
Send: "Create a frame called 'Header' (1440x80) with a text layer 'Logo' inside it. Then create another frame called 'Card' (300x400) with a text layer 'Title' and a rectangle 'Image Placeholder' inside it."

Wait for creation to complete. This gives discovery tools something meaningful to analyze.

**Evaluate:**
- Are both frames created with children?
- Take a screenshot to confirm baseline state.

### 1. File data — structure mode
Send: "Show me the structure of the current page"

**Evaluate:**
- Does the agent call `figma_get_file_data` with mode "structure"?
- Is the output a readable tree with layout info (layoutMode, itemSpacing, padding)?
- Are node names and types clearly shown?

### 2. File data — content mode
Send: "List all the text content on this page"

**Evaluate:**
- Does the agent use mode "content"?
- Are text values displayed clearly?
- Are empty/placeholder texts noted?

### 3. Component search
Send: "Search for components with 'button' in the name"

**Evaluate:**
- Does the agent call `figma_search_components`?
- Does it report found components with names and keys?
- If none found, does it say so clearly instead of erroring?

### 4. Design system overview
Send: "Show me the design system for this file"

**Evaluate:**
- Does the agent call `figma_design_system`?
- Does it report variables/tokens, naming conventions, component counts?
- If no DS exists, does it say so clearly?

### 5. Component deep inspection
If components exist from previous tests, send: "Inspect the [component name] component in detail — show me all its variants and properties"

**Evaluate:**
- Does the agent call `figma_get_component_details` or `figma_get_component_deep`?
- Are variant properties listed?
- Is token coverage reported?

### 6. Text node scan
Send: "Scan all text nodes on the page and list their fonts and sizes"

**Evaluate:**
- Does the agent call `figma_scan_text_nodes`?
- Is font info (family, size, weight) shown for each text node?

### 7. Selection awareness
Select something in Figma, then send: "What do I have selected?"

**Evaluate:**
- Does the agent call `figma_get_selection`?
- Does it correctly describe the selected node(s)?
- If nothing is selected, does it say so?

### 8. Status check
Send: "What's the connection status?"

**Evaluate:**
- Does the agent call `figma_status`?
- Does it report the connected file name and key?
- Is the info accurate vs what the tab shows?

### Overall assessment
- Are discovery operations fast and non-destructive?
- Is the output format readable and useful for a designer?
- Does the agent choose the right discovery tool for each question?
