# figma_execute Safety Guide

Complete Plugin API reference for safe, correct Figma scripting.

## Required Pattern: Async IIFE with outer return

The outer `return` is REQUIRED for the Desktop Bridge to await the Promise and capture the resolved value.

```js
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
```

**Side-effect-only form** (no data needed back): `(async () => { ... })()` without outer `return`.

## Operation Order (ALWAYS follow this sequence)

```
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
```

## Auto-Layout Property Reference

**Frame-level (set AFTER layoutMode):**
| Property | Values | Description |
|----------|--------|-------------|
| `layoutMode` | `"NONE"` / `"HORIZONTAL"` / `"VERTICAL"` | Set FIRST — all below require this |
| `layoutWrap` | `"NO_WRAP"` / `"WRAP"` | Flex-wrap (set before counterAxisAlignContent) |
| `primaryAxisSizingMode` | `"FIXED"` / `"AUTO"` | AUTO = hug contents |
| `counterAxisSizingMode` | `"FIXED"` / `"AUTO"` | AUTO = hug contents |
| `primaryAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` / `"SPACE_BETWEEN"` | justify-content |
| `counterAxisAlignItems` | `"MIN"` / `"CENTER"` / `"MAX"` / `"BASELINE"` | align-items |
| `paddingTop/Bottom/Left/Right` | number | Padding in px |
| `itemSpacing` | number | Gap along primary axis |
| `counterAxisSpacing` | number or null | Wrap row/col gap (WRAP frames only) |

**Child-level (set AFTER appendChild):**
| Property | Values | Description |
|----------|--------|-------------|
| `layoutSizingHorizontal` | `"FIXED"` / `"HUG"` / `"FILL"` | Shorthand (preferred) |
| `layoutSizingVertical` | `"FIXED"` / `"HUG"` / `"FILL"` | Shorthand (preferred) |
| `layoutAlign` | `"INHERIT"` / `"STRETCH"` | Cross-axis stretch |
| `layoutGrow` | 0 or 1 | 1 = fill remaining primary space |
| `layoutPositioning` | `"AUTO"` / `"ABSOLUTE"` | ABSOLUTE enables x/y positioning |

**Axis mapping:**
- HORIZONTAL layout: primary = X (width), counter = Y (height)
- VERTICAL layout: primary = Y (height), counter = X (width)
- Prefer `layoutSizingHorizontal/Vertical` over lower-level properties to avoid axis confusion

## Node Creation Quick Reference

| Node | Method | Notes |
|------|--------|-------|
| Frame | `figma.createFrame()` | Supports auto-layout, children |
| Rectangle | `figma.createRectangle()` | No children. Supports cornerRadius |
| Ellipse | `figma.createEllipse()` | Equal w/h = circle |
| Line | `figma.createLine()` | Height MUST be 0: `line.resize(200, 0)` |
| Text | `figma.createText()` | MUST load font first |
| Vector | `figma.createVector()` | Set `vectorPaths` with SVG path data |
| Component | `figma.createComponent()` | Like Frame + component features |
| Instance | `component.createInstance()` | On COMPONENT, NOT COMPONENT_SET |
| Group | `figma.group(nodes, parent)` | No createGroup(). Auto-resizes |
| SVG | `figma.createNodeFromSvg(str)` | Returns FrameNode |

`width` and `height` are READ-ONLY — always use `resize(w, h)`.

## Returning Data from figma_execute

Always return serializable JSON — never return raw Figma node objects:
```js
// CORRECT
return JSON.stringify({ id: frame.id, name: frame.name, width: frame.width });

// WRONG — causes silent failure
return frame;
```

## Cross-Call Node References

Each figma_execute call is stateless. Return IDs, then retrieve in the next call:
```js
// Call 1: create and return ID
return JSON.stringify({ containerId: container.id });

// Call 2: retrieve by ID (ALWAYS use async variant)
const container = await figma.getNodeByIdAsync("RETURNED_ID");
if (!container) return JSON.stringify({ error: "Node not found" });
```

## Idempotency

Before creating a named node, check if it already exists:
```js
const existing = figma.currentPage.findOne(n => n.name === "MyComponent");
if (existing) return JSON.stringify({ id: existing.id, reused: true });
// only create if not found
```

## Plugin API Gotchas by Category

### Color & Paint
- Colors use **0-1 range, NOT 0-255**: `{ r: 0.65, g: 0.35, b: 1.0 }` for purple
- COLOR variable values include alpha `{r,g,b,a}`, paint colors do NOT `{r,g,b}` — handle the difference
- Fills/strokes arrays are **IMMUTABLE** — clone, modify, reassign: `node.fills = [...node.fills.map(f => ({...f, ...changes}))]`
- `setBoundVariableForPaint()` returns a **NEW paint object** — capture the return value and reassign to fills/strokes array
- `figma.util.solidPaint("#hex")` is the preferred shorthand for solid paints inside figma_execute

### Layout
- **Set `layoutMode` BEFORE any layout props** — padding, spacing, sizing, alignment all require auto-layout active first
- **`counterAxisAlignItems` does NOT support `'STRETCH'`** — use `'MIN'` + child `layoutSizingHorizontal = "FILL"`
- **`appendChild` BEFORE setting `FILL`** — `layoutSizingHorizontal = "FILL"` throws if child is not inside an auto-layout parent
- **`primaryAxisSizingMode = "FILL"`** — INVALID enum value that fails silently. Use `"AUTO"` or `"FIXED"` on frames; use `child.layoutSizingHorizontal = "FILL"` on children
- New nodes appear at (0,0) — scan parent children for maxX, position with offset to avoid overlap

### Text
- **Load fonts BEFORE text** — `await figma.loadFontAsync({family, style})` before any `.characters` assignment
- **Set `fontName` BEFORE `characters`** — on text nodes: `fontName = {family, style}` → then `characters = "text"`
- `lineHeight` and `letterSpacing` must be **objects**: `{ value: 1.5, unit: "PIXELS" }`, not plain numbers

### Components
- **`createInstance()` on COMPONENT, NOT COMPONENT_SET** — find the variant child first, then call `createInstance()` on it
- `addComponentProperty()` returns a **STRING key** (e.g. `"label#206:8"`) — never hardcode property keys; always use the returned key
- `combineAsVariants()` requires **ComponentNode** inputs, not frames — convert first
- `combineAsVariants()` does **NOT** create auto-layout — manually set grid layout after combining
- `detachInstance()` invalidates ancestor IDs — re-discover nodes by traversal after detaching

### Node & Navigation
- **Use `getNodeByIdAsync`** — the sync variant `getNodeById()` throws in dynamic-page mode
- **`figma.currentPage = page` does NOT work** — use `await figma.setCurrentPageAsync(page)`
- `getPluginData()/setPluginData()` not available — use `setSharedPluginData(namespace, key, value)`
- **Splitting page-switch and data-read across calls** — `setCurrentPageAsync()` only affects the current IIFE; the next call reverts to the Figma Desktop active page. Do both in the same IIFE

### Return Values
- **ALWAYS return JSON with ALL created/mutated node IDs** from figma_execute — never return void
- **Never return raw Figma nodes** — return `{ id: node.id }`, never the node object
- **Calling `group.remove()` after moving all children** — GROUP auto-deletes when empty; explicit `remove()` throws
- **Never set constraints on GROUP** — GROUPs don't support `constraints`; the assignment silently fails. Convert to FRAME first
- **Use fills as arrays** — `node.fills = [paint]` not `node.fills = paint`

## Error Recovery

- figma_execute is **ATOMIC**: if a script fails, NO changes are made. Retry after fix is safe.
- On error: STOP → Read error message → If unclear, inspect state with `figma_get_file_data` → Fix → Retry
- **Recoverable**: layout issues, naming, missing font, wrong variable binding — fix and retry
- **Structural corruption**: component cycles, wrong `combineAsVariants` input — clean up, restart from scratch
- **Monolithic scripts fail loudly** — break into single-responsibility calls and verify each with a screenshot
