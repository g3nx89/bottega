---
name: add-tool
description: Scaffold a new Figma tool following the Pi SDK ToolDefinition pattern with TypeBox schemas, operation queue serialization, and textResult wrapper
---

# Add Tool

Create a new Figma tool for the Pi SDK agent. Tools are the primary way the AI agent interacts with Figma.

## Architecture

Tools live in `src/main/tools/` and follow this structure:

```
src/main/tools/
├── index.ts          ← ToolDeps interface + createFigmaTools aggregator
├── core.ts           ← figma_execute, figma_screenshot, figma_status, figma_get_selection
├── discovery.ts      ← figma_get_file_data, figma_search_components, etc.
├── components.ts     ← figma_instantiate, figma_set_instance_properties, etc.
├── manipulation.ts   ← figma_set_fills, figma_set_text, figma_set_image_fill, etc.
├── tokens.ts         ← figma_setup_tokens, figma_lint
├── jsx-render.ts     ← figma_render_jsx, figma_create_icon, figma_bind_variable
└── image-gen.ts      ← figma_generate_image, figma_edit_image, etc.
```

## Required Pattern

Every tool MUST follow this exact shape:

```typescript
import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { type ToolDeps, textResult } from './index.js';

export function createMyTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_my_tool',              // Always prefix with figma_
      label: 'My Tool',                    // Short human label
      description: 'What the tool does.',  // Full description for LLM
      promptSnippet: 'figma_my_tool: one-line summary for tool selection guide',
      promptGuidelines: [                  // Optional: when/how to use this tool
        'Use this tool when...',
      ],
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Node ID' }),
        // Use Type.Optional() for optional params
        // Use StringEnum([...] as const) for string enums
        // Use Type.Number({ minimum, maximum }) for bounded numbers
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        // Wrap ALL Figma mutations in operationQueue.execute()
        return operationQueue.execute(async () => {
          const result = await connector.someMethod(params.nodeId, ...);
          return textResult(result);  // Always return via textResult()
        });
      },
    },
  ];
}
```

## Key Rules

1. **Name**: Always `figma_` prefix (e.g., `figma_my_tool`)
2. **Schemas**: Use TypeBox (`@sinclair/typebox`), NOT Zod
3. **String enums**: Use `StringEnum([...] as const)` from `@mariozechner/pi-ai`
4. **Mutations**: Wrap in `operationQueue.execute()` to serialize Figma writes
5. **Results**: Always return `textResult(data)` — never raw objects
6. **Params typed as `any`**: TypeBox runtime validation handles type safety
7. **Register**: Add `createMyTools` to `createFigmaTools()` in `tools/index.ts`
8. **System prompt**: Add the tool to the selection guide in `system-prompt.ts`

## Connector Methods Available

Read `src/figma/websocket-connector.ts` for all available methods:
- `executeCodeViaUI(code, timeout)` — run Plugin API code in Figma
- `captureScreenshot(nodeId, opts)` — export node as PNG base64
- `setImageFill(nodeIds, data, scaleMode)` — apply image fill
- `setNodeFills/setNodeStrokes` — set colors
- `setTextContent` — set text
- `createChildNode/cloneNode/deleteNode/renameNode/resizeNode/moveNode`
- `createFromJsx(tree, opts)` — render JSX tree
- `searchComponents/getComponentDetails` — component discovery
