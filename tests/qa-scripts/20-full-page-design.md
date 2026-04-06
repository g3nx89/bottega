# 20 — Full Page Design Session

Build a complete landing page from scratch through iterative conversation. Tests the agent's ability to handle a long, multi-turn design session with accumulating complexity.

**Estimated time**: 20-30 min
**Context stress**: High (many turns, growing context)

## Prerequisites
- Connected to Bottega-Test_A, session reset, clean page

## Steps

### 1. Brief the agent
Send: "I want to design a landing page for a design tool called 'Pixelflow'. The brand color is #6C5CE7 (purple), secondary is #00CEC9 (teal). The page should have: a navigation bar, a hero section with headline + CTA, a 3-column features section, a testimonial area, and a footer. Let's build it section by section. Start with the navigation bar."

**Evaluate:**
- Does the agent acknowledge the full brief?
- Does it start with just the nav bar (not everything at once)?
- Does it ask clarifying questions or proceed directly?
- Screenshot after nav bar creation.

### 2. Hero section
Send: "Great. Now create the hero section below the nav bar. Big headline 'Design at the Speed of Thought', a subtitle explaining the tool, and a purple CTA button 'Start Free Trial'. Add a placeholder for a hero image on the right side."

**Evaluate:**
- Does it place the hero BELOW the nav bar (correct spatial awareness)?
- Are the brand colors used correctly (#6C5CE7)?
- Is the layout reasonable (text left, image right)?
- Does the text hierarchy make sense (headline > subtitle > button)?
- Screenshot.

### 3. Features section
Send: "Now add a features section. Three columns with icons and descriptions: 'AI-Powered Layout' with a sparkles icon, 'Real-time Collaboration' with a users icon, and 'Design System Sync' with a sync icon. Use a section title 'Why Pixelflow?' above the columns."

**Evaluate:**
- Does the agent use figma_render_jsx or individual creation calls?
- Are icons created (Iconify) or just placeholders?
- Is the 3-column layout evenly spaced?
- Is the section title properly positioned above?
- Are the brand colors consistently applied?
- Screenshot.

### 4. Testimonial section
Send: "Add a testimonial: a quote card with italic text 'Pixelflow transformed our design workflow. We ship 3x faster now.', the author name 'Sarah Chen, Design Lead at Stripe', and a small avatar placeholder circle."

**Evaluate:**
- Is the quote visually distinct (larger text, italic)?
- Is the attribution properly formatted?
- Does the card feel integrated with the rest of the page?
- Screenshot.

### 5. Footer
Send: "Finally, create a footer with: the Pixelflow logo text on the left, 3 columns of links (Product: Features, Pricing, Changelog; Company: About, Careers, Blog; Support: Docs, Community, Contact), and social media icon placeholders on the right."

**Evaluate:**
- Is the footer properly structured with columns?
- Does it span the full width?
- Is the overall page now complete and scrollable/tall?
- Screenshot of full page.

### 6. Global review
Send: "Take a screenshot of the complete page and review it. Are the sections properly spaced? Is the visual hierarchy clear? Are all colors consistent with our brand palette?"

**Evaluate:**
- Does the agent provide a thoughtful self-review?
- Does it identify real issues (if any)?
- Is the overall design cohesive?
- Does the page look professional?

### 7. Revision
Send: "The features section feels cramped. Increase the vertical spacing between the section title and the columns, and add more padding around each feature card. Also make the CTA button in the hero bigger."

**Evaluate:**
- Does the agent find the correct elements to modify?
- Does it apply changes without breaking the rest of the page?
- Context retention: does it remember which elements are which?
- Screenshot after changes.

### 8. Context check
Send: "What brand colors are we using? How many sections does the page have?"

**Evaluate:**
- Does the agent remember the brand colors from step 1?
- Does it correctly list all sections?
- Has context degraded over the long session?

### Overall assessment
- **Session length**: How many turns did the agent handle before issues?
- **Context retention**: Did it remember the brief, colors, and structure throughout?
- **Design quality**: Is the final result something a designer would accept as a draft?
- **Consistency**: Are colors, spacing, and typography consistent across sections?
- **Efficiency**: Did the agent use appropriate tools (JSX for complex, individual for simple)?
