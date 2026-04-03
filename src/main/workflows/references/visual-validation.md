# Visual Validation Guide

How and when to validate design work in Figma.

## Two-Tier Validation Strategy

### Tier 1: Structural Check (CHEAP)
- **Tool**: `figma_get_file_data`
- **Cost**: Low — no screenshot, pure data
- **When**: After EVERY mutation
- **What it checks**: Node hierarchy, names, types, layout properties, fill/stroke assignments

### Tier 2: Visual Check (EXPENSIVE)
- **Tool**: `figma_screenshot`
- **Cost**: High — generates image, uses tokens
- **When**: At milestones only (component complete, section complete, full layout done)
- **What it checks**: Actual rendered appearance

## Validation Workflow

```
1. Mutation → figma_get_file_data (structural check — always)
2. Milestone → figma_screenshot (visual check — once per milestone)
3. Defect found → fix → figma_screenshot again
4. Stop after 3 screenshot/fix loops — accept or escalate
```

**Most tasks need only 1 screenshot.** Multiple screenshots only when a visible defect needs confirmation after a fix.

## Defect Categories to Check in Screenshots

| Defect | What to look for |
|--------|-----------------|
| Clipped text | Text cut off at container boundary |
| Overlapping content | Elements stacking on top of each other unexpectedly |
| Placeholder text | "Lorem ipsum", "Text", "Label" still showing |
| Wrong colors | Colors that don't match intent or DS tokens |
| Misaligned elements | Items not aligned along the expected axis |
| Collapsed frames | Frames showing as 0×0 (forgot `resize()` or children) |
| Floating elements | Nodes not inside a parent Frame/Section |

## Screenshot Loop Rules

- **Max 3 screenshot/fix cycles per section** — stop after 3 even if imperfect
- Do NOT take a screenshot if the previous one already looks correct
- Never take a screenshot before making mutations — inspect only when needed
- After the final screenshot confirms success, move to the next section

## figma_lint vs figma_screenshot

| `figma_lint` | `figma_screenshot` |
|---|---|
| DS compliance (naming, token usage) | Rendered visual appearance |
| Quality gate before handoff | Verification after mutations |
| Fast, returns structured issues | Slow, returns image |
| Use at end of design task | Use after each mutation milestone |

## When figma_get_file_data Is Enough

Use structural check only (skip screenshot) when:
- Checking that a node was renamed correctly
- Verifying fill/stroke assignments by property value
- Confirming hierarchy (parent-child relationships)
- Counting children after batch operations
- Verifying layout properties (layoutMode, sizing, padding)

## Screenshot Best Practices

- Call `figma_screenshot` with a specific node ID to focus on the relevant area
- After a full page build, screenshot the top-level frame, not individual components
- If the screenshot shows a layout collapse, check `layoutMode` and sizing mode settings before fixing visuals
