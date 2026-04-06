# 23 — Component Extraction & Reuse

Start with a design full of repeated patterns, then extract components and replace instances. Tests pattern recognition, component creation workflow, and systematic refactoring.

**Estimated time**: 20-25 min
**Context stress**: High (pattern matching, systematic replacement)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create a design with repeated patterns
Send: "Create a notifications panel (400x600) containing 5 notification items stacked vertically. Each notification should have:
- A colored circle on the left (32x32) — use different colors for each
- A title text in bold 14px
- A description text in regular 12px gray
- A timestamp text in 11px light gray on the right
- A thin bottom border line

Make each notification slightly different in content but keep the SAME visual structure. Use these:
1. Blue circle, 'New comment on your design', 'Sarah left feedback on Dashboard v2', '2m ago'
2. Green circle, 'Design approved', 'Team lead approved the login flow', '15m ago'
3. Purple circle, 'New team member', 'Alex joined the design team', '1h ago'
4. Orange circle, 'Review requested', 'Please review the settings page', '3h ago'
5. Red circle, 'Deadline approaching', 'Presentation design due tomorrow', '5h ago'"

**Evaluate:**
- Are all 5 notifications created with consistent structure?
- Do they look like a real notification panel?
- Take a screenshot.

### 2. Identify the repeated pattern
Send: "Analyze the notification panel. Can you identify the repeated visual pattern? What elements are consistent across all 5 items?"

**Evaluate:**
- Does the agent recognize the pattern without being told?
- Does it correctly list the common elements (circle, title, description, timestamp, border)?
- Does it identify what varies (content, circle color)?

### 3. Suggest componentization
Send: "If we were to extract this as a reusable component, what properties should it expose?"

**Evaluate:**
- Does the agent suggest meaningful properties?
  - Text overrides (title, description, timestamp)
  - Color override for the circle
  - Boolean for the border (show/hide)
- Is the suggestion practical and complete?

### 4. Create the component
Send: "Create the notification item as a component with those properties. Name it 'Notification Item'."

**Evaluate:**
- Does the agent create a proper component structure?
- Are auto-layout and spacing correct?
- Are component properties defined?
- Note: if the agent can't create components directly via Figma API, document this limitation.

### 5. Test instantiation
If component was created: "Create 3 instances of the Notification Item component and customize each with different content and circle colors."

**Evaluate:**
- Does the agent use `figma_instantiate`?
- Does it set instance properties correctly?
- Do instances inherit the component's structure?

### 6. Create a second repeated pattern
Send: "Now create a simple card grid — a 2x2 grid of product cards. Each card: 180x240, white background, 8px corners, contains a 180x140 image placeholder, a product name in bold, a price in teal (#00CEC9), and a small heart icon placeholder. Use 4 different products."

**Evaluate:**
- Another repeated pattern created?
- Are cards visually consistent?

### 7. Identify and extract second pattern
Send: "Identify the repeated pattern in the card grid and suggest what component to extract."

**Evaluate:**
- Does the agent recognize this as a second extraction opportunity?
- Are suggested properties appropriate (image, name, price, favorited)?

### 8. Assess overall componentization
Send: "Looking at the whole page now, give me a componentization report: what's already a component, what should be, and what's unique (no need to componentize)."

**Evaluate:**
- Is the report accurate?
- Does it distinguish between "should be a component" vs "one-off element"?
- Does the agent show awareness of both patterns?

### Overall assessment
- **Pattern recognition**: Did the agent see the patterns without hints?
- **Component design**: Were suggested properties practical and complete?
- **Execution**: Could it actually create and instantiate components?
- **Systematic thinking**: Did it approach both patterns consistently?
- **API limitations**: Note any Figma API limitations that blocked component creation
