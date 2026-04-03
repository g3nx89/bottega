# Variable Binding Guide

How to bind Figma variables to node properties.

## Two Binding Mechanisms

| Mechanism | For | Tool |
|-----------|-----|------|
| `setBoundVariable` | FLOAT properties (padding, gap, radius, fontSize) | `figma_bind_variable` |
| `setBoundVariableForPaint` | COLOR properties on fills/strokes | `figma_set_fills` with `bindTo` |

## Binding Float Properties

Use `figma_bind_variable` to bind spacing, corner radius, font size, and other numeric properties:

```
figma_bind_variable(nodeId, "paddingTop", variableId)
figma_bind_variable(nodeId, "paddingBottom", variableId)
figma_bind_variable(nodeId, "paddingLeft", variableId)
figma_bind_variable(nodeId, "paddingRight", variableId)
figma_bind_variable(nodeId, "itemSpacing", variableId)
figma_bind_variable(nodeId, "cornerRadius", variableId)
figma_bind_variable(nodeId, "fontSize", variableId)
```

Supported FLOAT fields via Plugin API `setBoundVariable`:
- `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`
- `itemSpacing`, `counterAxisSpacing`
- `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius`
- `fontSize`, `letterSpacing`, `lineHeight`
- `opacity`

## Binding Color Properties

Use `figma_set_fills` with `bindTo` to bind a color variable to a fill:
```
figma_set_fills(nodeId, "#A259FF", { bindTo: variableId })
```

Or via `figma_execute` for fine-grained control:
```js
const paint = figma.util.solidPaint("#A259FF");
const boundPaint = node.setBoundVariableForPaint(paint, "color", variable);
// setBoundVariableForPaint RETURNS A NEW PAINT — must reassign!
node.fills = [boundPaint];
```

**Critical**: `setBoundVariableForPaint()` returns a NEW paint object. If you don't capture and reassign, the binding is lost.

## Variable Scopes and Aliasing

### Setting Scopes
```js
variable.scopes = ["FILL_COLOR"];              // for color variables used in fills
variable.scopes = ["CORNER_RADIUS"];           // for radius variables
variable.scopes = ["GAP", "WIDTH_HEIGHT"];     // for spacing variables
```

### Aliasing Variables (Semantic → Primitive)
```js
semanticVar.setValueForMode(modeId, {
  type: "VARIABLE_ALIAS",
  id: primitiveVar.id
});
```

## Shadow = Effect Style, NOT Variable (Decision D21)

Shadows are implemented as **Effect Styles**, not variables. This is a deliberate architectural decision:

```js
// CORRECT — create an Effect Style for shadows
const style = figma.createEffectStyle();
style.name = "shadow/md";
style.effects = [{
  type: "DROP_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.12 },
  offset: { x: 0, y: 4 },
  radius: 8,
  spread: 0,
  visible: true,
  blendMode: "NORMAL"
}];
// Apply to node
node.effectStyleId = style.id;

// WRONG — do not try to create a variable for shadow
```

Use `figma_set_effects` tool to apply effect styles to nodes.

## figma_set_fills with bindTo vs figma_bind_variable

| Use case | Tool |
|----------|------|
| Fill color bound to variable | `figma_set_fills(nodeId, color, { bindTo: varId })` |
| Stroke color bound to variable | `figma_set_strokes(nodeId, color, { bindTo: varId })` |
| Padding, gap, radius, fontSize | `figma_bind_variable(nodeId, field, varId)` |
| Multiple bindings at once | `figma_execute` with `setBoundVariable` loop |

## Binding in figma_execute

```js
return (async () => {
  const node = await figma.getNodeByIdAsync("NODE_ID");
  const varCollection = figma.variables.getLocalVariableCollections()[0];
  const variables = figma.variables.getLocalVariables();
  
  // Find variable by name
  const paddingVar = variables.find(v => v.name === "spacing/md");
  const colorVar = variables.find(v => v.name === "color/primary");
  
  // Bind float
  node.setBoundVariable("paddingTop", paddingVar);
  node.setBoundVariable("paddingBottom", paddingVar);
  
  // Bind color to fill
  const paint = figma.util.solidPaint("#000");
  const boundPaint = node.setBoundVariableForPaint(paint, "color", colorVar);
  node.fills = [boundPaint];
  
  return JSON.stringify({ success: true, id: node.id });
})()
```
