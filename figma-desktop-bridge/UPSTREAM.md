# Upstream Tracking

## figma-console-mcp (base plugin)
- Repo: https://github.com/southleft/figma-console-mcp
- Commit: ae19af8 (v1.14.0)
- Files: code.js, ui.html, manifest.json (copied as-is as base)

## figma-console-mcp v1.19.0 sync (2026-03-26)
- Synced from: v1.19.0 (commit d567f44, 2026-03-25)
- Handlers ported: DEEP_GET_COMPONENT, ANALYZE_COMPONENT_SET, GET_ANNOTATIONS, SET_ANNOTATIONS, GET_ANNOTATION_CATEGORIES
- Also synced: ui.html relay (window functions, methodMap, result cases)

### Bottega-specific divergences from upstream

| Area | Upstream | Bottega | Reason |
|------|----------|---------|--------|
| DEEP_GET_COMPONENT depth cap | No cap | `maxDepth > 20` capped | Prevent runaway recursion |
| componentProperties cap | No cap | Truncated at 10KB, `_componentPropertiesTruncated` flag | P3a: prevent context overflow from icon swap variants |
| fillGeometry/strokeGeometry | Not included | Included only for VECTOR/BOOLEAN_OPERATION/LINE/REGULAR_POLYGON/STAR/ELLIPSE | P3a: avoid serializing irrelevant geometry on frames |
| Hardcoded value detection | Not present | `variables_used[]`, `hardcoded_values[]`, `token_coverage` % | P3b: design system adherence metric |
| `extractNodeProps` signature | `(n)` | `(n, nodePath)` | P3b needs path tracking for diagnostics |
| Default variant detection | `vName.indexOf('state=default')` (lowercase only) | `vName.toLowerCase().indexOf('state=default')` (case-insensitive) + sizeAxis guard | Handles PascalCase property names in real Figma files |
| fontName property access | `props.fontFamily = n.fontName.family; props.fontStyle = n.fontName.style;` (outside braces) | Wrapped in `{ }` braces | Upstream bug fix: both assignments now conditional on `!== figma.mixed` |
| strokes mixed check | No `figma.mixed` guard | `n.strokes !== figma.mixed` guard added | Edge case: text nodes with mixed stroke styles |
| spacing `figma.mixed` | No guard | `n[spProp] !== figma.mixed` guard added | Edge case: cornerRadius can be mixed |
| Hex color helper | Inline `Math.round(c.r*255).toString(16)...` repeated 5x | Shared `figmaRGBToHex(c)` function | DRY: reduces duplication |

## figma-use (additional handlers)
- Repo: https://github.com/dannote/figma-use
- Commit: 3971ea8
- Code ported: CREATE_FROM_JSX handler (from rpc.ts), CREATE_ICON, BIND_VARIABLE
- Modifications: simplified shorthand expansion, removed Widget API dependency
