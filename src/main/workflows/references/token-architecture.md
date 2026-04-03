# Token Architecture Guide

How to structure Figma variable collections for different project scales.

## Pattern 1: Simple — Single Collection, 2 Modes

**Best for**: Small projects, single-brand apps, quick prototypes

```
Collection: "Design Tokens"
  Modes: Light | Dark
  Variables:
    color/background    → Light: #FFFFFF  Dark: #1A1A1A
    color/surface       → Light: #F5F5F5  Dark: #2A2A2A
    color/primary       → Light: #A259FF  Dark: #A259FF
    color/text          → Light: #1A1A1A  Dark: #FFFFFF
    spacing/xs          → 4
    spacing/sm          → 8
    spacing/md          → 16
    spacing/lg          → 24
    spacing/xl          → 32
    radius/sm           → 4
    radius/md           → 8
    radius/lg           → 16
```

Use `figma_setup_tokens` to create this in one call.

## Pattern 2: Standard — Separate Primitive/Semantic Collections

**Best for**: Medium projects, team design systems, apps with theming

```
Collection: "Primitives" (no modes)
  color/purple-50     → #F3EAFF
  color/purple-500    → #A259FF
  color/purple-900    → #3D1A7A
  color/gray-50       → #FAFAFA
  color/gray-900      → #1A1A1A
  spacing/4           → 4
  spacing/8           → 8
  ...

Collection: "Semantic" (Modes: Light | Dark)
  color/background    → Light: {Primitives/color/gray-50}   Dark: {Primitives/color/gray-900}
  color/primary       → Light: {Primitives/color/purple-500} Dark: {Primitives/color/purple-500}
  color/text/default  → Light: {Primitives/color/gray-900}  Dark: {Primitives/color/gray-50}
  space/component-gap → {Primitives/spacing/16}
```

Aliases (references to other variables) are set via `figma_execute`:
```js
const semanticVar = collection.createVariable("color/background", "COLOR");
semanticVar.setValueForMode(lightModeId, { type: "VARIABLE_ALIAS", id: primitiveVar.id });
```

## Pattern 3: Advanced — Multi-Brand with Extended Collections

**Best for**: Large design systems, multiple brands, platform-specific tokens

```
Collection: "Primitives"        — Raw values, no modes
Collection: "Global Semantic"   — Modes: Light | Dark
Collection: "Brand A"           — Modes: Light | Dark (overrides Global)
Collection: "Brand B"           — Modes: Light | Dark (overrides Global)
Collection: "Component"         — Per-component scoped tokens
```

## Variable Scopes Best Practices

**NEVER use `ALL_SCOPES`** — it pollutes all pickers with unrelated variables.

Set specific scopes per variable type:
```js
// Color variables
colorVar.scopes = ["FILL_COLOR", "STROKE_COLOR", "EFFECT_COLOR"];

// Spacing variables
spacingVar.scopes = ["GAP", "WIDTH_HEIGHT", "FRAME_FILL"];

// Corner radius
radiusVar.scopes = ["CORNER_RADIUS"];

// Font size
fontSizeVar.scopes = ["FONT_SIZE"];
```

## Code Syntax for Codegen

Add code syntax to enable accurate CSS/Swift/Kotlin export:
```js
variable.setVariableCodeSyntax("WEB", "--color-primary");
variable.setVariableCodeSyntax("ANDROID", "ColorPrimary");
variable.setVariableCodeSyntax("iOS", "Color.primary");
```

## Collection Architecture Guidelines

1. **Keep primitives mode-free** — raw values that don't change between themes
2. **Keep semantic layer thin** — only alias to primitives, no magic values
3. **Scope variables precisely** — each variable type has its relevant scopes
4. **Name with slash groups** — `"color/primary"` not `"primaryColor"` for proper grouping in Figma
5. **Document modes clearly** — `"Light"` and `"Dark"` not `"Mode 1"` and `"Mode 2"`
6. **Shadow = Effect Style, NOT variable** — see Decision D21: use Effect Styles for shadows

## When to Use figma_setup_tokens

- Starting a new project with no DS
- Bootstrapping when `dsStatus === "none"` or `"partial"`
- Adding a new collection to an existing DS

`figma_setup_tokens` creates an entire collection with modes and variables in one atomic call. Prefer it over multiple `figma_execute` calls for initial setup.
