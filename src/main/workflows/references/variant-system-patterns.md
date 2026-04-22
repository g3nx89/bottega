# Variant System Patterns

Advanced patterns for large component sets, variant grids, mode-bound variables, and font discovery.

## When This Reference Applies

- Creating 10+ variants (size × state × theme matrices)
- Binding variants to variable collection modes (dark/light, compact/comfortable)
- Font-heavy designs requiring fallback strategies

## Pattern 1 — Large ComponentSet with Grid Layout

`combineAsVariants()` stacks all children at (0,0). Manual grid layout required.

### Algorithm

1. Collect ComponentNode[] (one per variant combo)
2. Parse each `name` into variant props: `"Size=Large, State=Hover"` → `{ Size: "Large", State: "Hover" }`
3. Assign axis: primary prop → column, secondary prop → row
4. Position: `child.x = col * (width + gap); child.y = row * (height + gap)`
5. After combineAsVariants, resize set from child bounds: scan maxX/maxY, call `set.resizeWithoutConstraints(maxX + padding, maxY + padding)`

### Example

```js
return (async () => {
  const variants = await Promise.all(variantIds.map(id => figma.getNodeByIdAsync(id)));
  const parsed = variants.map(v => {
    const props = Object.fromEntries(v.name.split(', ').map(p => p.split('=')));
    return { node: v, ...props };
  });
  const sizes = [...new Set(parsed.map(p => p.Size))];
  const states = [...new Set(parsed.map(p => p.State))];
  const W = 200, H = 60, GAP = 24;
  for (const p of parsed) {
    p.node.x = sizes.indexOf(p.Size) * (W + GAP);
    p.node.y = states.indexOf(p.State) * (H + GAP);
  }
  const set = figma.combineAsVariants(variants, figma.currentPage);
  set.name = "Button";
  const maxX = Math.max(...parsed.map(p => p.node.x + p.node.width));
  const maxY = Math.max(...parsed.map(p => p.node.y + p.node.height));
  set.resizeWithoutConstraints(maxX + 24, maxY + 24);
  return JSON.stringify({ setId: set.id });
})()
```

## Pattern 2 — Variant × Variable Mode Binding

Bind a variant axis to a variable collection mode so the variant switch propagates theme changes.

### Steps

1. Create/find variable collection with modes: `collection.modes = [{ modeId, name: "Light" }, ...]`
2. Create variants (one per mode)
3. For each variant, call `variant.setExplicitVariableModeForCollection(collection, modeId)`
4. Bind child fills via `setBoundVariableForPaint()` to the collection variables
5. Variant switch now remaps colors through the mode

### Gotchas

- `setExplicitVariableModeForCollection` is per-node, NOT cascaded — set on the variant ComponentNode, not its children
- Mode IDs are string keys from `collection.modes[i].modeId` — never hardcode
- Unsetting: pass `null` instead of modeId

## Pattern 3 — Font Discovery & Fallback

Font style names are per-file. Always discover before loading.

```js
async function loadFontSafe(family, preferredStyles = ["Regular"]) {
  const all = await figma.listAvailableFontsAsync();
  const familyFonts = all.filter(f => f.fontName.family === family);
  if (familyFonts.length === 0) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    return { family: "Inter", style: "Regular" };
  }
  for (const pref of preferredStyles) {
    const match = familyFonts.find(f => f.fontName.style === pref);
    if (match) {
      await figma.loadFontAsync(match.fontName);
      return match.fontName;
    }
  }
  const first = familyFonts[0].fontName;
  await figma.loadFontAsync(first);
  return first;
}
```

### Common Style Variants

| Nominal | Actual in file (varies) |
|---------|------------------------|
| Regular | Regular, Roman, Book |
| SemiBold | SemiBold, Semi Bold, Demi, Demibold |
| ExtraBold | ExtraBold, Extra Bold, Heavy, Black |
| Italic | Italic, Oblique |

Never assume; always verify via `listAvailableFontsAsync()`.

## Pattern 4 — Batched Variant Generation

For 50+ variants, break across multiple `figma_execute` calls to respect Plugin API perf envelope.

- Per-call budget: ≤ 20 variant creations or ≤ 3s wall time
- Return created IDs each call
- Subsequent call: retrieve via `getNodeByIdAsync`, continue

### Chunking Strategy

```
Call 1: create base variant, return { baseId }
Call 2: clone × 10, set variant props, return { ids: [...] }
Call 3: clone × 10, ...
Call N: combineAsVariants + grid layout + resize
```

Do NOT combineAsVariants mid-sequence — only at the end, once all variants exist. Combining partial sets corrupts the ComponentSet.

## Common Failure Modes

1. **All variants overlap at (0,0)** → skipped manual grid layout after combineAsVariants
2. **Variant switch doesn't change colors** → missed `setExplicitVariableModeForCollection` on variant node
3. **"Font unavailable" throw** → assumed style name instead of discovering via `listAvailableFontsAsync`
4. **ComponentSet has 0×0 size** → didn't resize from child bounds after combine
5. **Variant props don't appear in property panel** → variants named without `Prop=Value, Prop=Value` convention
