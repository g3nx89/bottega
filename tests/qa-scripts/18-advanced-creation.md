# 18 — Advanced Creation & Layout

Test auto-layout, image fills, batch transforms, and component set arrangement.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page
- At least one component set in the file (or in a connected library)

## Steps

### 1. Create a card with auto-layout
Send: "Create a card component: 320px wide, vertical auto-layout with 16px padding and 12px gap. Add a title text 'Product Name' in 18px bold, a description 'A short description of the product' in 14px, and a blue 'Buy Now' button at the bottom."

**Implementation hint:** The agent may use `figma_render_jsx` for the whole card, or `figma_create_child` + `figma_auto_layout`.

**Evaluate:**
- Is auto-layout applied (vertical direction, 16px padding, 12px gap)?
- Are all three child elements present (title, description, button)?
- Does the card respect the 320px width constraint?
- Is the layout visually correct in the screenshot?

### 2. Apply auto-layout to existing elements
Send: "Select the card frame and change the auto-layout to horizontal with 8px gap"

**Implementation hint:** The agent should use `figma_auto_layout` with mode 'HORIZONTAL'.

**Evaluate:**
- Does the agent use `figma_auto_layout`?
- Does the layout switch from vertical to horizontal?
- Are the children rearranged horizontally?

### 3. Set image fill on a shape
Send: "Create a 200x200 circle and set an image fill using this URL: https://picsum.photos/200"

**Implementation hint:** The agent should use `figma_create_child` for the circle, then `figma_set_image_fill`.

**Evaluate:**
- Does the agent use `figma_set_image_fill` with the URL?
- Is the image displayed correctly within the circle?
- Is the circle the correct size (200x200)?

### 4. Batch transform multiple elements
Send: "Create 4 small rectangles (50x50) in a row, then use batch transform to set all their fills to different colors: red, green, blue, yellow"

**Implementation hint:** The agent may use `figma_batch_set_fills` or `figma_batch_transform` if available.

**Evaluate:**
- Are 4 rectangles created?
- Does the agent use a batch operation or individual `figma_set_fills` calls?
- Are all 4 colors correctly applied?
- Is the result visually correct?

### 5. Arrange a component set
Send: "Find a component set in the file and arrange its variants in a grid layout"

**Implementation hint:** The agent should use `figma_search_components` to find a component set, then `figma_arrange_component_set`.

**Evaluate:**
- Does the agent discover and identify a component set?
- Does it use `figma_arrange_component_set`?
- Are variants arranged in a readable grid layout?
- Does the screenshot show the organized arrangement?

### Overall assessment
- Does auto-layout work correctly with padding, gap, and direction?
- Are image fills applied cleanly to shapes?
- Do batch operations work efficiently vs individual calls?
- Does component set arrangement produce a useful layout?
