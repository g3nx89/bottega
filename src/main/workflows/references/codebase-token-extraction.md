# Codebase Token Extraction Guide

How to extract design tokens from existing codebases for use in Figma.

## CSS Custom Properties

### Standard (CSS Variables)
```css
:root {
  --color-primary: #A259FF;
  --color-secondary: #4A90D9;
  --color-background: #FFFFFF;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --border-radius-md: 8px;
}
```

### Tailwind v4 (`@theme` directive)
```css
@theme {
  --color-primary: oklch(65% 0.3 290);
  --spacing-md: 1rem;
}
```

**Extraction**: Look for `:root { }` and `@theme { }` blocks. Group variables by prefix (`--color-*`, `--spacing-*`, `--radius-*`).

## Tailwind Config (v3)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: { 50: '#F3EAFF', 500: '#A259FF', 900: '#3D1A7A' },
        secondary: '#4A90D9',
      },
      spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px' },
      borderRadius: { sm: '4px', md: '8px', lg: '16px' },
    }
  }
}
```

**Extraction**: Read `theme.extend.colors`, `theme.extend.spacing`, `theme.extend.borderRadius`. Flatten nested color scales into separate tokens: `color/primary-50`, `color/primary-500`.

## DTCG Format (Design Token Community Group)

```json
{
  "color": {
    "primary": { "$type": "color", "$value": "#A259FF" },
    "background": {
      "default": { "$type": "color", "$value": "#FFFFFF" },
      "dark": { "$type": "color", "$value": "#1A1A1A" }
    }
  },
  "spacing": {
    "md": { "$type": "dimension", "$value": "16px" }
  }
}
```

Files to look for: `*.tokens.json`, `tokens/*.json`, `design-tokens.json`, `src/tokens/**/*.json`

**Extraction**: Traverse `$type`/`$value` pairs. Use key path as token name: `color/primary`, `spacing/md`.

## CSS-in-JS

### Stitches / Vanilla Extract
```ts
export const theme = createTheme({
  colors: { primary: '#A259FF', background: '$white' },
  space: { 1: '4px', 2: '8px', 4: '16px' },
  radii: { sm: '4px', md: '8px' },
});
```

### Styled Components / Emotion
```ts
const theme = {
  colors: { primary: '#A259FF', text: '#1A1A1A' },
  spacing: [0, 4, 8, 16, 24, 32],
};
```

**Extraction**: Import or read the theme object. For array-based spacing (`spacing[2] = 8`), name tokens `spacing/2` or map to semantic names if documented.

## iOS

### Asset Catalogs (`.xcassets`)
```
Assets.xcassets/
  Colors/
    Primary.colorset/Contents.json
    Background.colorset/Contents.json
```

Each `Contents.json` has `components` for Light and Dark appearances.

### Swift Color Extensions
```swift
extension Color {
  static let primary = Color("Primary")
  static let background = Color("Background")
}
```

**Extraction**: Parse `.colorset/Contents.json` for color values. Extract both `"any"` (light) and `"dark"` appearance values for dual-mode tokens.

## Android

### XML Colors
```xml
<!-- res/values/colors.xml -->
<resources>
  <color name="color_primary">#A259FF</color>
  <color name="color_background">#FFFFFF</color>
</resources>

<!-- res/values-night/colors.xml (dark mode) -->
<resources>
  <color name="color_background">#1A1A1A</color>
</resources>
```

### Compose Material Theme
```kotlin
MaterialTheme(
  colorScheme = lightColorScheme(
    primary = Color(0xFFA259FF),
    background = Color(0xFFFFFFFF),
  )
)
```

**Extraction**: Parse both `values/colors.xml` and `values-night/colors.xml`. Map to Light/Dark modes in Figma.

## Dark Mode Detection

When extracting tokens, always look for dark mode counterparts:

| Pattern | Location |
|---------|----------|
| `@media (prefers-color-scheme: dark) { }` | CSS files |
| `.dark { --color-*: ...; }` | CSS class-based dark mode |
| `darkMode: 'class'` | Tailwind config |
| `darkMode: 'media'` | Tailwind config |
| `[data-theme="dark"] { }` | CSS attribute-based |

Create matching Figma variable modes: name them `"Light"` and `"Dark"` (not `"Mode 1"` and `"Mode 2"`).

## Shadow Extraction

CSS `box-shadow` → Figma Effect Style:

```css
/* CSS */
box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.12);
/* Multiple shadows */
box-shadow: 0px 1px 2px rgba(0,0,0,0.06), 0px 4px 8px rgba(0,0,0,0.12);
```

Map to Figma Effect Style (not a variable — see variable-binding.md Decision D21):
```js
{
  type: "DROP_SHADOW",
  offset: { x: 0, y: 4 },
  radius: 8,
  spread: 0,
  color: { r: 0, g: 0, b: 0, a: 0.12 }
}
```

Name shadows semantically: `shadow/sm`, `shadow/md`, `shadow/lg`.

## Extraction Summary Checklist

- [ ] CSS custom properties in `:root` / `@theme`
- [ ] Tailwind `theme.extend` (colors, spacing, borderRadius, fontFamily, fontSize)
- [ ] DTCG `*.tokens.json` files
- [ ] CSS-in-JS theme objects (`createTheme`, `ThemeProvider`)
- [ ] iOS `.xcassets` color sets
- [ ] Android `res/values/colors.xml` + night variant
- [ ] Dark mode overrides (media query / class / attribute)
- [ ] CSS `box-shadow` → Effect Styles
- [ ] Typography: `font-family`, `font-size`, `font-weight`, `line-height`
