---
name: bottega-tools
description: Use when adding, modifying, or debugging Pi SDK ToolDefinition tools in Bottega. Covers TypeBox schemas, OperationQueue serialization, textResult wrapper, connector/figmaAPI methods, promptSnippet patterns, and the tool registration pipeline. Triggers include "add a tool", "new tool", "modify tool", "fix tool", "tool schema", "ToolDefinition", "TypeBox".
---

# Bottega — Tool Development Guide

## When to Use

- Adding a new Figma tool (e.g. `figma_set_effects`, `figma_export_svg`)
- Modifying an existing tool's schema, behavior, or description
- Debugging tool execution failures (timeout, serialization, abort)
- Understanding the tool→WebSocket→plugin pipeline

## Architecture Overview

```
LLM calls tool → Pi SDK validates TypeBox schema → execute() runs
  → OperationQueue serializes mutations
    → connector method sends WebSocket command to Figma Desktop Bridge plugin
      → plugin executes in Figma Plugin API sandbox
        → result returns as JSON via WebSocket
          → textResult() wraps for Pi SDK content format
```

## Tool File Organization

```
src/main/tools/
├── index.ts          — ToolDeps interface, createFigmaTools(), textResult(), withAbortCheck()
├── core.ts           — figma_execute, figma_screenshot, figma_status, figma_get_selection
├── discovery.ts      — figma_get_file_data, figma_search_components, figma_get_library_components, figma_get_component_details, figma_design_system
├── components.ts     — figma_instantiate, figma_set_instance_properties, figma_arrange_component_set
├── manipulation.ts   — figma_set_fills, figma_set_strokes, figma_set_text, figma_set_image_fill, figma_resize, figma_move, figma_create_child, figma_clone, figma_delete, figma_rename
├── tokens.ts         — figma_setup_tokens, figma_lint
├── jsx-render.ts     — figma_render_jsx, figma_create_icon, figma_bind_variable
└── image-gen.ts      — figma_generate_image, figma_edit_image, figma_restore_image, figma_generate_icon, figma_generate_pattern, figma_generate_story, figma_generate_diagram
```

## ToolDefinition Pattern (MUST follow exactly)

Every tool implements the `ToolDefinition` interface from `@mariozechner/pi-coding-agent`:

```typescript
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

// Tools are created via factory functions that receive shared dependencies
export function createMyTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      // REQUIRED fields:
      name: 'figma_my_tool',            // snake_case, prefixed with figma_
      label: 'Human Readable Label',     // Shown in UI tool cards
      description: 'What this tool does. Include limitations and when to use alternatives.',
      parameters: Type.Object({          // TypeBox schema — NOT Zod, NOT JSON Schema
        nodeId: Type.String({ description: 'Node ID' }),
        optional: Type.Optional(Type.Number({ description: 'Optional param', default: 10 })),
      }),

      // RECOMMENDED fields:
      promptSnippet: 'figma_my_tool: one-line summary for LLM tool selection',
      // promptGuidelines is an optional string[] for multi-line LLM guidance

      // Execute receives params typed as `any` (TypeBox runtime validates)
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        // Mutation tools MUST use operationQueue:
        return operationQueue.execute(async () => {
          const result = await connector.someMethod(params.nodeId, params.optional ?? 10);
          return textResult(result);
        });
        // Read-only tools can skip operationQueue:
        // const result = await connector.readMethod(params.nodeId);
        // return textResult(result);
      },
    },
  ];
}
```

## Critical Rules

### 1. TypeBox Schemas (NOT Zod)

```typescript
import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';  // for string enums

// Primitives
Type.String({ description: '...' })
Type.Number({ description: '...', default: 24 })
Type.Boolean({ description: '...' })
Type.Optional(Type.String({ description: '...' }))

// Enums — use Pi SDK's StringEnum helper
StringEnum(['PNG', 'JPG'] as const, { default: 'PNG' })
StringEnum(['fill', 'stroke'] as const, { description: 'Which property' })

// Complex
Type.Array(Type.String(), { description: '...' })
Type.Array(Type.Any(), { description: '...' })  // for heterogeneous arrays like fills
Type.Record(Type.String(), Type.Any(), { description: '...' })  // for dynamic objects
Type.Object({ nested: Type.String() })

// WRONG — these don't work in this project:
// z.string()  ← Zod
// { type: 'string' }  ← raw JSON Schema
```

### 2. OperationQueue for Mutations

ALL tools that modify Figma state MUST serialize through `operationQueue.execute()`. This prevents concurrent WebSocket commands that corrupt plugin state.

```typescript
// CORRECT — mutation tool
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  return operationQueue.execute(async () => {
    const result = await connector.setNodeFills(params.nodeId, params.fills);
    return textResult(result);
  });
}

// CORRECT — read-only tool (no queue needed)
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  const result = await connector.getLocalComponents();
  return textResult(result);
}

// WRONG — mutation without queue
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  const result = await connector.setNodeFills(params.nodeId, params.fills);
  return textResult(result);  // ← concurrent calls will corrupt state!
}
```

### 3. textResult Wrapper

Every tool MUST return the Pi SDK content format. Use `textResult()` from `./index.js`:

```typescript
// textResult serializes to: { content: [{ type: 'text', text: JSON.stringify(data) }], details: {} }
return textResult(result);
return textResult({ success: true, id: node.id });
return textResult({ error: 'Node not found' });

// For image responses (like figma_screenshot), return directly:
return {
  content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }],
  details: {},
};
```

### 4. Connector Methods (WebSocket Bridge)

The `connector` (`WebSocketConnector`) sends commands to the Figma Desktop Bridge plugin. Key methods:

**Read operations:**
- `connector.getLocalComponents()` — list local components
- `connector.getVariables()` — list variables/tokens
- `connector.captureScreenshot(nodeId, options)` — screenshot
- `connector.getComponentFromPluginUI(nodeId)` — component details

**Mutation operations (MUST use operationQueue):**
- `connector.executeCodeViaUI(code, timeout)` — arbitrary Plugin API code
- `connector.setNodeFills(nodeId, fills)` — set fills
- `connector.setNodeStrokes(nodeId, strokes, weight?)` — set strokes
- `connector.setTextContent(nodeId, text, options?)` — set text
- `connector.setImageFill(nodeIds, imageData, scaleMode)` — image fill
- `connector.resizeNode(nodeId, w, h)` — resize
- `connector.moveNode(nodeId, x, y)` — move
- `connector.createChildNode(parentId, type, props?)` — create node
- `connector.cloneNode(nodeId)` — clone
- `connector.deleteNode(nodeId)` — delete
- `connector.renameNode(nodeId, name)` — rename
- `connector.createFromJsx(tree, options)` — JSX→Figma nodes
- `connector.createIcon(svg, size, color, options)` — icon from SVG
- `connector.bindVariable(nodeId, varName, property)` — bind token

**Figma REST API (via `figmaAPI`):**
- `figmaAPI.searchComponents(fileKey, query)` — search library
- `figmaAPI.getComponents(fileKey)` — list library components
- `figmaAPI.getComponentSets(fileKey)` — list library component sets

### 5. Execute Signature

```typescript
async execute(
  _toolCallId: string,     // unique call ID (rarely needed)
  params: any,             // validated params — cast to any due to ToolDefinition[] inference limitation
  _signal: AbortSignal,    // check signal?.aborted before long ops (withAbortCheck wraps this)
  _onUpdate: Function,     // streaming updates (unused in this project)
  _ctx: any                // context object (unused)
)
```

### 6. Registration Pipeline

New tool files must be:
1. Created in `src/main/tools/` following the factory pattern
2. Imported and spread into `createFigmaTools()` in `src/main/tools/index.ts`
3. Added to the tool count in CLAUDE.md and system-prompt.ts tool selection guide

```typescript
// src/main/tools/index.ts
import { createMyTools } from './my-tools.js';

export function createFigmaTools(deps: ToolDeps): ToolDefinition[] {
  const tools = [
    ...createCoreTools(deps),
    ...createDiscoveryTools(deps),
    // ... existing tools ...
    ...createMyTools(deps),  // ← add here
  ];
  return tools.map(withAbortCheck);
}
```

### 7. ToolDeps — Available Dependencies

```typescript
interface ToolDeps {
  connector: WebSocketConnector;     // WebSocket bridge to Figma plugin
  figmaAPI: FigmaAPI;                // Figma REST API client
  operationQueue: OperationQueue;    // Mutation serialization mutex
  wsServer: FigmaWebSocketServer;    // Raw WS server (connection status, selection)
  getImageGenerator?: () => ImageGenerator | null;  // AI image gen (optional)
  designSystemCache?: DesignSystemCache;            // DS cache for compression
  configManager?: CompressionConfigManager;         // Compression profiles
}
```

If your tool needs a new dependency, add it to `ToolDeps` and pass it from `createAgentInfra()` in `agent.ts`.

### 8. promptSnippet & promptGuidelines

These are injected into the LLM system prompt to guide tool selection:

```typescript
// Single-line summary — appears in the system prompt tool list
promptSnippet: 'figma_my_tool: one-line purpose description',

// Multi-line usage guidelines (optional)
promptGuidelines: [
  'Use figma_my_tool when the user asks to...',
  'Prefer this over figma_execute for...',
],
```

Update `src/main/system-prompt.ts` to add the tool to the appropriate table in the Tool Selection Guide.

## Adding a New Tool — Checklist

1. [ ] Choose the right file in `src/main/tools/` (or create a new one)
2. [ ] Define TypeBox parameters with descriptive field descriptions
3. [ ] Use `operationQueue.execute()` if the tool mutates Figma state
4. [ ] Return via `textResult()` (or image content for screenshots)
5. [ ] Add `promptSnippet` (required) and `promptGuidelines` (if complex)
6. [ ] Register in `createFigmaTools()` in `index.ts`
7. [ ] Update system-prompt.ts tool selection tables
8. [ ] Update CLAUDE.md tool count and category listing
9. [ ] Build: `node scripts/build.mjs`
10. [ ] Test: run the app and verify the tool appears and executes correctly

## Common Patterns

### Plugin Code Tool (like figma_execute)

When wrapping raw Plugin API code:
```typescript
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  return operationQueue.execute(async () => {
    const result = await connector.executeCodeViaUI(params.code, params.timeout ?? 30000);
    return textResult(result);
  });
}
```

### Cached Read Tool (like figma_design_system)

For expensive read operations with caching:
```typescript
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  if (!params.forceRefresh && designSystemCache) {
    const cached = designSystemCache.get(shouldCompact);
    if (cached) return textResult(cached);
  }
  const result = await connector.expensiveRead();
  designSystemCache?.set(result);
  return textResult(result);
}
```

### Parallel Fetch Tool (like figma_get_library_components)

When fetching multiple independent resources:
```typescript
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  const [a, b] = await Promise.all([
    figmaAPI.getComponents(params.fileKey),
    figmaAPI.getComponentSets(params.fileKey),
  ]);
  return textResult({ components: a, componentSets: b });
}
```

### Multi-step Pipeline Tool (like figma_render_jsx)

For tools with preprocessing before the WebSocket call:
```typescript
async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
  return operationQueue.execute(async () => {
    const tree = parseJsx(params.jsx);      // 1. Parse
    await resolveIcons(tree);                // 2. Resolve dependencies
    const result = await connector.createFromJsx(tree, { /* opts */ }); // 3. Execute
    return textResult(result);
  });
}
```
