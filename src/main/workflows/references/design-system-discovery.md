# Design System Discovery Guide

How to find, evaluate, and use an existing design system in Figma.

## Discovery Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| `figma_design_system` | Full DS overview: variables, collections, styles, components | Always start here |
| `figma_search_components` | Find components by name in local file | When looking for specific UI components |
| `figma_get_library_components` | Browse all components in a linked library | When a library file key is available |
| `figma_get_component_details` | Inspect properties, variants, structure | Before instantiating a component |

## Discovery Workflow

### Step 1: Check if DS exists
```
figma_design_system()
```
Returns `dsStatus`: `"none"` | `"partial"` | `"active"`

### Step 2: Interpret dsStatus

| Status | Meaning | Action |
|--------|---------|--------|
| `"none"` | No tokens or DS structure found | Suggest bootstrapping with `figma_setup_tokens` |
| `"partial"` | Some tokens exist but incomplete | Suggest extending: identify gaps and fill with `figma_setup_tokens` |
| `"active"` | Full DS in place | Use existing tokens for all new elements |

### Step 3: Inspect component library
```
figma_search_components("Button")    // local search — no libraryFileKey
figma_get_library_components(libraryFileKey)  // full library browse
```

### Step 4: Inspect a component before instantiating
```
figma_get_component_details(key)     // shows properties, variants, accepted overrides
figma_get_component_deep(key)        // full structure tree
figma_analyze_component_set(key)     // variant matrix for COMPONENT_SET
```

## Codebase Inspection

When a codebase exists alongside the Figma file, scan it for token definitions:

### CSS Custom Properties
```css
:root { --color-primary: #A259FF; }         /* Standard */
@theme { --color-primary: #A259FF; }        /* Tailwind v4 */
```
Look for `--color-*`, `--spacing-*`, `--radius-*`, `--font-*`

### Tailwind Config
```js
theme.extend.colors     // color palette
theme.extend.spacing    // spacing scale
theme.extend.borderRadius
```

### DTCG Format
```json
{ "$type": "color", "$value": "#A259FF" }
```
Files: `*.tokens.json`, `tokens/*.json`

### CSS-in-JS
```ts
createTheme({ colors: { primary: '...' } })
ThemeProvider value={theme}
```

### iOS
`.xcassets` color sets, `Color()` extensions in Swift

### Android
`res/values/colors.xml`, Compose `MaterialTheme.colorScheme`

## When to Call forceRefresh

Call `figma_design_system(forceRefresh: true)` after:
- Running `figma_setup_tokens`
- Modifying variables via `figma_execute`
- Adding new collections or modes
- Switching Figma pages that have DS content

## Dark Mode Detection

When extracting tokens from code, look for dark mode pairs:
```css
@media (prefers-color-scheme: dark) { ... }
.dark { --color-background: #1A1A1A; }
```
Tailwind: `darkMode: 'class'` or `darkMode: 'media'`

Create matching Figma variable modes: `Light` + `Dark`.
