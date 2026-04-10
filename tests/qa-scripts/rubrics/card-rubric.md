# Card Rubric

Calibrated rubric for card-type design evaluations. Used by the `design_crit` and `iteration_delta` evaluators.

## Dimensions

### Intent Match (does the design respond to the brief?)
- **3**: Elements present but no coherence with the specified context
- **5**: Functional card with logical structure, but generic — could be for any app
- **7**: Card communicates the intended context — appropriate typography, colors, hierarchy (e.g. name > role > stats for a profile card)
- **9**: Card with personality — thoughtful details (avatar ring, badge, hover state implied, contextual iconography)

### Visual Craft (is it curated?)
- **3**: Random spacing, flat colors, no attention to detail
- **5**: Reasonable spacing, coherent palette but basic
- **7**: Systematic spacing (8px grid), subtle effects (shadow, border), curated typography
- **9**: Micro-details (progressive radii, color temperature, optical alignment)

### Design Decisions (are choices intentional and reasoned?)
- **3**: Default choices (black on white, no accent, system font)
- **5**: Some intentional choices (an accent color, a non-default font)
- **7**: Color system with roles (primary, secondary, surface), type scale with 3+ levels
- **9**: Sophisticated decisions (density appropriate to context, hierarchy through weight+size+color)

### Hierarchy (does the visual hierarchy guide the eye?)
- **3**: Everything has equal visual weight — impossible to distinguish primary from secondary
- **5**: Basic distinction (title larger) but reading flow is not clear
- **7**: Natural reading flow: avatar > name > role > stats > action
- **9**: Hierarchy guides the eye effortlessly, every element has a distinct importance level

### Consistency (is it cohesive?)
- **3**: Mix of styles, spacing values, alignments
- **5**: Internally consistent but wouldn't reflect a system
- **7**: Everything follows an implicit system (spacing, colors, radii uniform)
- **9**: Could be a design system component — everything parametrized and systematic
