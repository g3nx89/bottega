/**
 * Reference document loader.
 *
 * Reference content is inlined as string constants so there is no filesystem
 * dependency at runtime (esbuild bundles the source; markdown files would not
 * be present inside dist/ unless explicitly copied).
 *
 * setReferencesDir() is kept for backwards-compatibility with tests that call
 * it, but it is a no-op when the inlined content map already has the doc.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Inlined reference content (populated from src/main/workflows/references/)
// ---------------------------------------------------------------------------

/* eslint-disable */
const INLINED_REFERENCES: Record<string, string> = {
  'figma-execute-safety': `# figma_execute Safety Guide

Complete Plugin API reference for safe, correct Figma scripting.

## Required Pattern: Async IIFE with outer return

The outer \`return\` is REQUIRED for the Desktop Bridge to await the Promise and capture the resolved value.

\`\`\`js
// CORRECT — outer return makes the bridge await the Promise
return (async () => {
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const frame = figma.createFrame();
    frame.name = "MyFrame";
    frame.layoutMode = "VERTICAL";
    frame.resize(375, 1);
    figma.currentPage.appendChild(frame);
    return JSON.stringify({ success: true, id: frame.id });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
})()
\`\`\`

**Side-effect-only form** (no data needed back): \`(async () => { ... })()\` without outer \`return\`.

## Operation Order (ALWAYS follow this sequence)

\`\`\`
1. LOAD FONTS         → await Promise.all([figma.loadFontAsync(...), ...])
2. CREATE FRAME       → const f = figma.createFrame(); f.name = "Name"
3. SET layoutMode     → f.layoutMode = "VERTICAL"  ← BEFORE any layout props!
4. SET SIZING         → f.layoutSizingHorizontal = "FIXED"; f.resize(375, 1)
5. SET PADDING/GAP    → f.paddingTop = 24; f.itemSpacing = 16
6. SET ALIGNMENT      → f.primaryAxisAlignItems = "MIN"
7. SET VISUAL PROPS   → f.fills = [...]; f.cornerRadius = 8
8. FOR EACH CHILD:
   a. Create + name + visual props
   b. Text: set fontName → characters → fontSize (in this order)
   c. f.appendChild(child)
   d. child.layoutSizingHorizontal = "FILL"  ← MUST be AFTER appendChild!
9. SET MIN/MAX        → f.minHeight = 100 (last, after layoutMode)
10. POSITION          → figma.viewport.scrollAndZoomIntoView([f])
\`\`\`

## Auto-Layout Property Reference

**Frame-level (set AFTER layoutMode):**
| Property | Values | Description |
|----------|--------|-------------|
| \`layoutMode\` | \`"NONE"\` / \`"HORIZONTAL"\` / \`"VERTICAL"\` | Set FIRST |
| \`primaryAxisSizingMode\` | \`"FIXED"\` / \`"AUTO"\` | AUTO = hug contents |
| \`counterAxisSizingMode\` | \`"FIXED"\` / \`"AUTO"\` | AUTO = hug contents |
| \`primaryAxisAlignItems\` | \`"MIN"\` / \`"CENTER"\` / \`"MAX"\` / \`"SPACE_BETWEEN"\` | justify-content |
| \`counterAxisAlignItems\` | \`"MIN"\` / \`"CENTER"\` / \`"MAX"\` / \`"BASELINE"\` | align-items |
| \`paddingTop/Bottom/Left/Right\` | number | Padding in px |
| \`itemSpacing\` | number | Gap along primary axis |

**Child-level (set AFTER appendChild):**
| Property | Values | Description |
|----------|--------|-------------|
| \`layoutSizingHorizontal\` | \`"FIXED"\` / \`"HUG"\` / \`"FILL"\` | Shorthand (preferred) |
| \`layoutSizingVertical\` | \`"FIXED"\` / \`"HUG"\` / \`"FILL"\` | Shorthand (preferred) |

## Node Creation Quick Reference

| Node | Method | Notes |
|------|--------|-------|
| Frame | \`figma.createFrame()\` | Supports auto-layout, children |
| Rectangle | \`figma.createRectangle()\` | No children |
| Text | \`figma.createText()\` | MUST load font first |
| Component | \`figma.createComponent()\` | Like Frame + component features |
| Instance | \`component.createInstance()\` | On COMPONENT, NOT COMPONENT_SET |

\`width\` and \`height\` are READ-ONLY — always use \`resize(w, h)\`.

## Plugin API Gotchas

- Colors use **0-1 range, NOT 0-255**
- Fills/strokes arrays are **IMMUTABLE** — clone, modify, reassign
- **Set \`layoutMode\` BEFORE any layout props**
- **\`appendChild\` BEFORE setting \`FILL\`**
- **Load fonts BEFORE text**
- **Use \`getNodeByIdAsync\`** — sync variant throws in dynamic-page mode
- figma_execute is **ATOMIC**: if a script fails, NO changes are made`,

  'design-system-discovery': `# Design System Discovery Guide

How to find, evaluate, and use an existing design system in Figma.

## Discovery Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| \`figma_design_system\` | Full DS overview: variables, collections, styles, components | Always start here |
| \`figma_search_components\` | Find components by name in local file | When looking for specific UI components |
| \`figma_get_library_components\` | Browse all components in a linked library | When a library file key is available |
| \`figma_get_component_details\` | Inspect properties, variants, structure | Before instantiating a component |

## Discovery Workflow

### Step 1: Check if DS exists
\`\`\`
figma_design_system()
\`\`\`
Returns \`dsStatus\`: \`"none"\` | \`"partial"\` | \`"active"\`

### Step 2: Interpret dsStatus

| Status | Meaning | Action |
|--------|---------|--------|
| \`"none"\` | No tokens or DS structure found | Suggest bootstrapping with \`figma_setup_tokens\` |
| \`"partial"\` | Some tokens exist but incomplete | Suggest extending |
| \`"active"\` | Full DS in place | Use existing tokens for all new elements |

## When to Call forceRefresh

Call \`figma_design_system(forceRefresh: true)\` after:
- Running \`figma_setup_tokens\`
- Modifying variables via \`figma_execute\`
- Adding new collections or modes`,

  'visual-validation': `# Visual Validation Guide

How and when to validate design work in Figma.

## Two-Tier Validation Strategy

### Tier 1: Structural Check (CHEAP)
- **Tool**: \`figma_get_file_data\`
- **When**: After EVERY mutation
- **What it checks**: Node hierarchy, names, types, layout properties, fill/stroke assignments

### Tier 2: Visual Check (EXPENSIVE)
- **Tool**: \`figma_screenshot\`
- **When**: At milestones only (component complete, section complete, full layout done)

## Validation Workflow

\`\`\`
1. Mutation → figma_get_file_data (structural check — always)
2. Milestone → figma_screenshot (visual check — once per milestone)
3. Defect found → fix → figma_screenshot again
4. Stop after 3 screenshot/fix loops — accept or escalate
\`\`\`

**Most tasks need only 1 screenshot.**

## Defect Categories to Check in Screenshots

| Defect | What to look for |
|--------|-----------------|
| Clipped text | Text cut off at container boundary |
| Overlapping content | Elements stacking unexpectedly |
| Placeholder text | "Lorem ipsum", "Text", "Label" still showing |
| Wrong colors | Colors that don't match DS tokens |
| Collapsed frames | Frames showing as 0×0 |

## Screenshot Loop Rules

- **Max 3 screenshot/fix cycles per section**
- Do NOT take a screenshot if the previous one already looks correct
- Never take a screenshot before making mutations`,

  'component-reuse': `# Component Reuse Guide

Patterns for finding, instantiating, and working with Figma components.

## Core Rule: Search Before Creating

ALWAYS search for existing components before building from raw frames:
\`\`\`
figma_search_components("Button")         // local file
figma_get_library_components(fileKey)     // linked library
\`\`\`

## Instantiation Workflow

\`\`\`
1. figma_search_components("Button") → get component key
2. figma_get_component_details(key)  → inspect properties and variants
3. figma_instantiate(key)            → place instance
4. figma_set_instance_properties(nodeId, { props }) → configure overrides
\`\`\`

## createInstance: COMPONENT not COMPONENT_SET

\`\`\`js
// WRONG — throws or returns undefined
const instance = componentSet.createInstance();

// CORRECT — find a specific variant first
const variant = componentSet.children[0];
const instance = variant.createInstance();
\`\`\`

## Instance Text Overrides

\`\`\`js
// CORRECT — use setProperties
instance.setProperties({ label: "New button text" });

// WRONG for property-managed text
const textNode = instance.findOne(n => n.type === "TEXT");
textNode.characters = "New button text";
\`\`\`

## Repeated Structures → Extract to Component

If a structure appears 3+ times in the design, extract it into a reusable component.`,

  'token-architecture': `# Token Architecture Guide

How to structure Figma variable collections for different project scales.

## Pattern 1: Simple — Single Collection, 2 Modes

**Best for**: Small projects, single-brand apps, quick prototypes

\`\`\`
Collection: "Design Tokens"
  Modes: Light | Dark
  Variables:
    color/background    → Light: #FFFFFF  Dark: #1A1A1A
    color/primary       → Light: #A259FF  Dark: #A259FF
    spacing/xs          → 4
    spacing/sm          → 8
    spacing/md          → 16
    radius/sm           → 4
    radius/md           → 8
\`\`\`

## Pattern 2: Standard — Separate Primitive/Semantic Collections

**Best for**: Medium projects, team design systems

\`\`\`
Collection: "Primitives" (no modes)
  color/purple-500    → #A259FF

Collection: "Semantic" (Modes: Light | Dark)
  color/primary       → Light: {Primitives/color/purple-500}
\`\`\`

## Variable Scopes Best Practices

**NEVER use \`ALL_SCOPES\`** — it pollutes all pickers.

\`\`\`js
colorVar.scopes = ["FILL_COLOR", "STROKE_COLOR", "EFFECT_COLOR"];
spacingVar.scopes = ["GAP", "WIDTH_HEIGHT", "FRAME_FILL"];
radiusVar.scopes = ["CORNER_RADIUS"];
\`\`\`

## Code Syntax for Codegen

\`\`\`js
variable.setVariableCodeSyntax("WEB", "--color-primary");
variable.setVariableCodeSyntax("ANDROID", "ColorPrimary");
variable.setVariableCodeSyntax("iOS", "Color.primary");
\`\`\`

## Guidelines

1. Keep primitives mode-free — raw values that don't change between themes
2. Keep semantic layer thin — only alias to primitives
3. Scope variables precisely
4. Name with slash groups — \`"color/primary"\` not \`"primaryColor"\`
5. Shadow = Effect Style, NOT variable (Decision D21)`,

  'variable-binding': `# Variable Binding Guide

How to bind Figma variables to node properties.

## Two Binding Mechanisms

| Mechanism | For | Tool |
|-----------|-----|------|
| \`setBoundVariable\` | FLOAT properties (padding, gap, radius, fontSize) | \`figma_bind_variable\` |
| \`setBoundVariableForPaint\` | COLOR properties on fills/strokes | \`figma_set_fills\` with \`bindTo\` |

## Binding Float Properties

\`\`\`
figma_bind_variable(nodeId, "paddingTop", variableId)
figma_bind_variable(nodeId, "cornerRadius", variableId)
figma_bind_variable(nodeId, "fontSize", variableId)
\`\`\`

## Binding Color Properties

\`\`\`
figma_set_fills(nodeId, "#A259FF", { bindTo: variableId })
\`\`\`

**Critical**: \`setBoundVariableForPaint()\` returns a NEW paint object. If you don't capture and reassign, the binding is lost.

## Shadow = Effect Style, NOT Variable (Decision D21)

Shadows are implemented as **Effect Styles**, not variables.

\`\`\`js
const style = figma.createEffectStyle();
style.name = "shadow/md";
style.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true, blendMode: "NORMAL" }];
node.effectStyleId = style.id;
\`\`\``,

  'codebase-token-extraction': `# Codebase Token Extraction Guide

How to extract design tokens from existing codebases for use in Figma.

## CSS Custom Properties

\`\`\`css
:root {
  --color-primary: #A259FF;
  --spacing-md: 16px;
  --border-radius-md: 8px;
}
\`\`\`

## Tailwind Config (v3)

Read \`theme.extend.colors\`, \`theme.extend.spacing\`, \`theme.extend.borderRadius\`. Flatten nested color scales: \`color/primary-50\`, \`color/primary-500\`.

## DTCG Format

\`\`\`json
{ "color": { "primary": { "$type": "color", "$value": "#A259FF" } } }
\`\`\`

Files: \`*.tokens.json\`, \`tokens/*.json\`

## Dark Mode Detection

Always look for dark mode counterparts:
- \`@media (prefers-color-scheme: dark) { }\`
- \`.dark { --color-*: ...; }\`
- Tailwind \`darkMode: 'class'\`

Create matching Figma variable modes: \`"Light"\` and \`"Dark"\`.

## Extraction Summary Checklist

- [ ] CSS custom properties in \`:root\` / \`@theme\`
- [ ] Tailwind \`theme.extend\` (colors, spacing, borderRadius)
- [ ] DTCG \`*.tokens.json\` files
- [ ] CSS-in-JS theme objects
- [ ] Dark mode overrides
- [ ] CSS \`box-shadow\` → Effect Styles
- [ ] Typography: font-family, font-size, font-weight`,
};
/* eslint-enable */

// ---------------------------------------------------------------------------
// Runtime filesystem override (optional — kept for test compatibility)
// ---------------------------------------------------------------------------

/** Cache of filesystem-loaded reference docs (loaded once, immutable). */
const fsCache = new Map<string, string>();

/** Map reference IDs to filenames. */
const ID_TO_FILE: Record<string, string> = {
  'figma-execute-safety': 'figma-execute-safety.md',
  'design-system-discovery': 'design-system-discovery.md',
  'visual-validation': 'visual-validation.md',
  'component-reuse': 'component-reuse.md',
  'token-architecture': 'token-architecture.md',
  'variable-binding': 'variable-binding.md',
  'codebase-token-extraction': 'codebase-token-extraction.md',
};

let _referencesDir = '';

/**
 * Set the directory where reference markdown files are stored.
 * When set, filesystem files take precedence over inlined content.
 * Clears the filesystem cache when called.
 */
export function setReferencesDir(dir: string): void {
  _referencesDir = dir;
  fsCache.clear();
}

/**
 * Load a reference document by ID. Returns the markdown content
 * or an empty string if not found.
 *
 * Priority: filesystem (if _referencesDir set) → inlined content.
 * Results are cached in memory after the first read.
 */
export function loadReferenceDoc(id: string): string {
  // Try filesystem first (if a dir was configured)
  if (_referencesDir) {
    if (fsCache.has(id)) return fsCache.get(id)!;
    const filename = ID_TO_FILE[id];
    if (filename) {
      try {
        const content = readFileSync(join(_referencesDir, filename), 'utf-8');
        fsCache.set(id, content);
        return content;
      } catch {
        // Fall through to inlined content
      }
    }
  }

  // Fall back to inlined content
  return INLINED_REFERENCES[id] ?? '';
}

/**
 * Load all reference documents for a list of IDs.
 * Returns a map of id → content for all docs that were successfully loaded.
 */
export function loadReferenceDocs(ids: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of ids) {
    const content = loadReferenceDoc(id);
    if (content) result.set(id, content);
  }
  return result;
}

/** Clear the in-memory cache (useful for testing). */
export function clearReferenceCache(): void {
  fsCache.clear();
}

/** Return all known reference IDs. */
export function knownReferenceIds(): string[] {
  return Object.keys(ID_TO_FILE);
}
