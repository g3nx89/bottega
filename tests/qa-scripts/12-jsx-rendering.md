# 12 — JSX Rendering Pipeline

Test the figma_render_jsx tool for complex UI generation from JSX.

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Simple JSX card
Send: "Render a card component using JSX: a 300x400 frame with white background, 16px padding, 12px rounded corners, containing a 300x200 image placeholder area, a title text 'Product Name' in 18px bold, a description 'Lorem ipsum dolor sit amet' in 14px gray, and a blue button 'Add to Cart'"

**Evaluate:**
- Does the agent call `figma_render_jsx`?
- Is the JSX syntax valid (Frame, Text, Rectangle tags)?
- Does the result match the description?
- Are Tailwind-like props used (bg, p, rounded, gap, flex)?
- Is the hierarchy correct (frame > children)?

### 2. Layout with flexbox
Send: "Create a horizontal navigation bar: a logo area on the left, and 4 navigation links ('Home', 'About', 'Products', 'Contact') on the right, using auto-layout with space-between"

**Evaluate:**
- Does the JSX use flex="row" and justify="between"?
- Are items aligned correctly?
- Does the nav bar fill the width?

### 3. Icon creation
Send: "Create an icon set with 4 icons in a row: a home icon, a settings gear, a user profile, and a search magnifying glass. Use 24px icons with 16px gap."

**Evaluate:**
- Does the agent call `figma_create_icon` for each icon?
- Are Iconify names used correctly (e.g., "mdi:home")?
- Are icons rendered as vectors (not images)?
- Are they aligned in a row with correct spacing?

### 4. Nested JSX structure
Send: "Build a settings form: a vertical layout with 3 rows, each row has a label on the left and a toggle placeholder on the right. Labels: 'Notifications', 'Dark Mode', 'Auto-Save'"

**Evaluate:**
- Is the nesting correct (outer frame > rows > label + toggle)?
- Does each row use horizontal flex layout?
- Are labels aligned consistently?

### 5. Mixed JSX + icons
Send: "Create a sidebar menu with 5 items, each with an icon and label: Home (mdi:home), Dashboard (mdi:view-dashboard), Messages (mdi:message), Settings (mdi:cog), Logout (mdi:logout)"

**Evaluate:**
- Does the JSX combine Icon and Text tags in each row?
- Are icons resolved from Iconify?
- Is the visual result clean and aligned?

### 6. Error handling
Send: "Render this JSX: <Frame><InvalidTag>test</InvalidTag></Frame>"

**Evaluate:**
- Does the agent handle the invalid tag gracefully?
- Does it suggest corrections or valid alternatives?
- No app crash?

### Overall assessment
- Is JSX rendering fast and reliable?
- Do Tailwind-like props translate correctly to Figma properties?
- Are icons fetched and rendered correctly?
- Is the visual output professional-quality?
