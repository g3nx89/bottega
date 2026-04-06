# 22 — Multi-Screen Refactor

Systematically refactor multiple screens to fix design inconsistencies. Tests cross-element awareness, systematic updates, and the agent's ability to maintain a holistic view across many elements.

**Estimated time**: 25-35 min
**Context stress**: Very high (many elements, cross-references, systematic changes)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Create 4 "screens" with intentional inconsistencies
Send: "Create 4 mobile app screens side by side (375x812 each, 40px gap between them):

Screen 1 - 'Login': White background, a logo placeholder at top, email and password text inputs (different sizes: 320x44 and 300x48), a blue login button (#3498DB, 280x50), and a 'Forgot password?' link

Screen 2 - 'Home': Light gray background (#F0F0F0), a header bar (375x60, dark blue #2C3E50), 3 card items vertically stacked (cards are 340x120 with 8px corners, white fill, the text is #333333), a bottom navigation with 4 icon placeholders

Screen 3 - 'Profile': White background, a circular avatar (80x80), user name in 18px bold, 4 settings rows (each 375x56 with a label and a right arrow), a red logout button (#E74C3C, 300x48, 4px corners)

Screen 4 - 'Settings': Gray background (#EBEBEB), a header bar (375x56, same dark blue but slightly different: #2D3E50), toggle rows for 'Notifications', 'Dark Mode', 'Location', each with a label and a circle toggle placeholder, a 'Delete Account' text in red at the bottom

Note: I've intentionally included inconsistencies — different input sizes, slightly different blues, different corner radii, inconsistent spacing. We'll fix these in the next steps."

**Evaluate:**
- Does the agent create all 4 screens?
- Are they placed side by side?
- Take a screenshot of the baseline layout.

### 2. Audit inconsistencies
Send: "Now analyze all 4 screens and list every design inconsistency you can find. Compare: colors, spacing, button sizes, corner radii, typography, input field dimensions, header heights."

**Evaluate:**
- Does the agent use discovery tools (get_file_data, lint) to analyze?
- Does it identify the intentional inconsistencies?
  - Input sizes: 320x44 vs 300x48
  - Blues: #3498DB vs #2C3E50 vs #2D3E50
  - Corner radii: 8px (cards) vs 4px (logout button) vs none specified
  - Header heights: 60 vs 56
  - Background grays: #F0F0F0 vs #EBEBEB
- Is the report comprehensive and organized by category?

### 3. Define the standard
Send: "Let's standardize. The design system rules are:
- Primary blue: #3498DB, Dark blue: #2C3E50, Error red: #E74C3C
- Background white: #FFFFFF, Background gray: #F5F5F5
- Text primary: #2C3E50, Text secondary: #7F8C8D
- Inputs: always 340x48, 8px corners
- Buttons: always 340x50, 12px corners
- Header: always 375x64
- Card: always 8px corners
- Spacing between elements: 16px standard
Apply these standards across all 4 screens."

**Evaluate:**
- Does the agent apply changes systematically (all inputs → 340x48, all buttons → 340x50)?
- Does it fix all the intentional inconsistencies?
- Does it process screen by screen or by element type?
- How many tool calls does it make?

### 4. Verify Screen 1 (Login)
Send: "Show me Screen 1 now. Are the inputs both 340x48 with 8px corners? Is the button 340x50 with 12px corners?"

**Evaluate:**
- Does the agent verify the specific elements?
- Are the sizes correct?
- Does the screenshot confirm the changes?

### 5. Verify Screen 2 (Home)
Send: "Show me Screen 2. Is the header exactly 64px tall with #2C3E50? Are all cards consistent?"

**Evaluate:**
- Header height corrected to 64?
- Background changed to #F5F5F5?
- Cards consistent?

### 6. Verify Screen 3 (Profile)
Send: "Check Screen 3. Is the logout button now 340x50 with 12px corners and matching the standard?"

**Evaluate:**
- Button dimensions fixed?
- Corner radius updated to 12px?

### 7. Verify Screen 4 (Settings)
Send: "And Screen 4. Is the header matching the others? Is the background gray consistent (#F5F5F5)?"

**Evaluate:**
- Header fixed: 64px height, exact #2C3E50?
- Background gray unified?
- Dark blue corrected from #2D3E50 → #2C3E50?

### 8. Re-audit
Send: "Run another analysis. Are there any remaining inconsistencies across the 4 screens?"

**Evaluate:**
- Does the agent do a thorough re-check?
- Were all issues fixed?
- Are there any regressions (things that were correct but got broken)?

### 9. Cross-screen spacing check
Send: "Check the vertical spacing between elements within each screen. Is it consistently 16px everywhere?"

**Evaluate:**
- Does the agent check intra-screen spacing?
- Does it find and fix any spacing issues?

### Overall assessment
- **Completeness**: Were ALL inconsistencies identified and fixed?
- **Accuracy**: Were changes applied to the right elements (no wrong targets)?
- **Non-destructive**: Did fixing inconsistencies break anything else?
- **Systematic vs ad-hoc**: Did the agent approach this methodically or haphazardly?
- **Context across screens**: Could it maintain awareness of all 4 screens simultaneously?
- **Verification quality**: Did it actually verify changes or just claim success?
