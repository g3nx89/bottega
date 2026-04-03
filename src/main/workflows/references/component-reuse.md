# Component Reuse Guide

Patterns for finding, instantiating, and working with Figma components.

## Core Rule: Search Before Creating

ALWAYS search for existing components before building from raw frames:
```
figma_search_components("Button")         // local file — omit libraryFileKey
figma_get_library_components(fileKey)     // linked library
```

If a suitable component exists, instantiate it. Only build from scratch when nothing matches.

## Instantiation Workflow

```
1. figma_search_components("Button") → get component key
2. figma_get_component_details(key)  → inspect properties and variants
3. figma_instantiate(key)            → place instance
4. figma_set_instance_properties(nodeId, { props }) → configure overrides
```

## Component Property System

### addComponentProperty (on COMPONENT)
```js
// Returns a DISAMBIGUATED KEY like "label#206:8"
const key = comp.addComponentProperty("label", "TEXT", "Default Label");
// Use returned key for componentPropertyReferences
node.componentPropertyReferences = { characters: key };
// Use BASE NAME ("label") for setProperties() on instances
```

### setProperties (on INSTANCE)
```js
instance.setProperties({ label: "New Text", icon: false });
// Use base property name — NOT the disambiguated key
```

## createInstance: COMPONENT not COMPONENT_SET

```js
// WRONG — throws or returns undefined
const instance = componentSet.createInstance();

// CORRECT — find a specific variant first
const variant = componentSet.children.find(
  c => c.name.includes("State=Default,Size=Large")
);
const instance = variant.createInstance();
```

For default variant when unsure: use the first child
```js
const variant = componentSet.children[0];
const instance = variant.createInstance();
```

## Deep Traversal for Variants

When you need a specific variant combination:
```js
const set = await figma.getNodeByIdAsync("COMPONENT_SET_ID");
// Find by exact name match
const variant = set.children.find(c => c.name === "Type=Primary, State=Default");
// Find by partial match
const variant = set.children.find(
  c => c.name.includes("Primary") && c.name.includes("Default")
);
```

## Instance Text Overrides

For text in component instances managed by a property:
```js
// CORRECT — use setProperties
instance.setProperties({ label: "New button text" });

// WRONG for property-managed text — bypasses component property system
const textNode = instance.findOne(n => n.type === "TEXT");
textNode.characters = "New button text";
```

Use direct `node.characters` only for text nodes NOT managed by a component property.

## combineAsVariants

Requirements and caveats:
- Input nodes must be **ComponentNode**, not FrameNode
- Convert frames to components first: `figma.createComponentFromNode(frame)`
- After combining: manually set grid layout — `combineAsVariants()` does NOT add auto-layout
- Result is a COMPONENT_SET — use `set.children` to access individual variants

```js
// Correct pattern
const comps = frames.map(f => figma.createComponentFromNode(f));
const set = figma.combineAsVariants(comps, figma.currentPage);
// Manually lay out the set
set.layoutMode = "HORIZONTAL";
set.itemSpacing = 8;
```

## detachInstance

After detaching, ancestor IDs are invalidated:
```js
const frame = instance.detachInstance();
// Do NOT use old instance ID — re-discover by traversal
const btn = frame.findOne(n => n.name === "Button/Label");
```

## Repeated Structures → Extract to Component

If a structure appears 3+ times in the design, extract it into a reusable component:
```js
const comp = figma.createComponentFromNode(originalFrame);
// Then create instances
const inst1 = comp.createInstance();
const inst2 = comp.createInstance();
```
