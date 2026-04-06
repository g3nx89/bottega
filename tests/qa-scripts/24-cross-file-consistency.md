# 24 — Cross-File Consistency Check

Work across both Figma test files to ensure design consistency. Tests tab switching under load, cross-file awareness, and the agent's ability to compare and synchronize designs.

**Estimated time**: 20-25 min
**Context stress**: Very high (two files, tab switching, comparison)

## Prerequisites
- Connected to Bottega-Test_A and Bottega-Test_B, session reset, clean pages on both files

## Steps

### 1. Create a design in File A
Switch to Bottega-Test_A tab.
Send: "Create a simple mobile app header bar: 375x64, background #2C3E50, white logo text 'MyApp' on the left, a notification bell icon on the right, and a user avatar circle (32x32) far right. Use 16px horizontal padding."

**Evaluate:**
- Is the header created correctly on File A?
- Take a screenshot.

### 2. Create a similar (but inconsistent) design in File B
Switch to Bottega-Test_B tab.
Send: "Create a mobile app header bar: 375x56, background #2D3E50, white logo text 'My App' (with space) on the left, a bell icon on the right, and a user avatar circle (36x36) far right. Use 12px horizontal padding."

**Evaluate:**
- Does the tab switch work?
- Is the header on File B different from File A?
- Take a screenshot.

### 3. Compare the two files
Send: "Compare the header bar in Bottega-Test_A with the one in Bottega-Test_B. What are the differences?"

**Evaluate:**
- Does the agent switch between tabs to inspect both?
- Does it identify ALL differences?
  - Height: 64 vs 56
  - Color: #2C3E50 vs #2D3E50
  - Logo text: 'MyApp' vs 'My App'
  - Avatar size: 32x32 vs 36x36
  - Padding: 16px vs 12px
- Is the comparison report clear and complete?

### 4. Standardize File B to match File A
Send: "Update Bottega-Test_B's header to exactly match Bottega-Test_A. Fix all differences."

**Evaluate:**
- Does the agent apply all 5 fixes on File B?
- Does it switch to the correct tab?
- Take a screenshot of File B after changes.

### 5. Verify both match
Send: "Take screenshots of both file headers and confirm they now match exactly."

**Evaluate:**
- Does the agent switch between tabs and screenshot each?
- Do the screenshots show matching designs?
- Does it confirm all differences are resolved?

### 6. Add content to both files
Send: "On File A, add 3 card items below the header (each 343x100, 16px margin, 8px corners, white background). Then switch to File B and add the same 3 cards, making sure they match File A exactly."

**Evaluate:**
- Does the agent create cards on File A first?
- Does it replicate them on File B accurately?
- Are dimensions, margins, and styles consistent across files?

### 7. Cross-file audit
Send: "Do a final consistency audit across both files. Are all shared elements (headers, cards) identical?"

**Evaluate:**
- Does the agent systematically compare elements across files?
- Is the audit report accurate?
- Are any remaining differences caught?

### Overall assessment
- **Tab switching reliability**: Did switching between files work consistently?
- **Cross-file comparison**: Could the agent effectively compare elements across files?
- **Accuracy of replication**: Were elements on File B truly matching File A?
- **Context across files**: Did the agent remember File A's properties while working on File B?
- **Efficiency**: Did it minimize unnecessary tab switches?
