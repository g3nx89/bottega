# Context Compression Strategy for Figma Cowork

## Technical Design Document — v2

> **Review history**: Initial draft → Claude Opus analysis → Codex GPT-5 review → Codex GPT-5.4 (high effort) review → critical validation against codebase. All Pi SDK APIs verified against source code.

---

## 1. Context Anatomy Analysis

Every token entering the Figma Cowork agent's context window falls into one of the categories below. Token estimates are calibrated against the known system prompt size (~4,500 tokens ≈ 284 lines) and real-world Figma document structures.

### 1.1 Context Budget Reference

| Model | Context Window | Effective Budget (after system prompt + tool schemas) | Headroom Class |
|---|---|---|---|
| Haiku 4.5 | 200K | ~177K | **Floor** (smallest supported) |
| Sonnet 4.6 | 1M | ~977K | Generous |
| Opus 4.6 | 1M | ~977K | Generous |
| GPT-5.4 / Mini / Nano | 1M | ~977K | Generous |
| GPT-5.3 Codex | 1M | ~977K | Generous |
| Gemini 3 Flash / 3.1 Pro / 3.1 Flash Lite | 1M | ~977K | Generous |

**The constraint landscape is bimodal.** One 200K model and eight 1M models — nothing in between.

**Expected session profile**: Design pair-programming sessions of 10-30+ turns are the normal use case. A 30-turn session on a complex file can reach 150-200K tokens without compression, which:
- **Fills the 200K floor** on Haiku — compaction becomes likely
- **Uses 15-20% of 1M models** — fits but with degraded signal-to-noise
- **Costs significantly more** in API fees (30 turns × large discovery results)

**The compression strategy serves three goals:**
1. **Quality** — maximize signal-to-noise ratio so the LLM reasons better at any session length
2. **Capacity** — ensure 30+ turn sessions fit comfortably on 200K models without compaction
3. **Cost** — reduce API spend proportional to token savings

### 1.2 Category Inventory

| # | Category | Est. Tokens | Criticality | Compressibility |
|---|---|---|---|---|
| **S1** | System prompt: workflow + tool selection guide | ~1,800 | HIGH | Low |
| **S2** | System prompt: Plugin API reference | ~1,200 | MEDIUM (only for `figma_execute`) | HIGH |
| **S3** | System prompt: JSX shorthand reference | ~500 | MEDIUM (only for `figma_render_jsx`) | HIGH |
| **S4** | System prompt: critical rules + anti-patterns | ~700 | HIGH | Low |
| **S5** | System prompt: component workflow + design principles | ~300 | LOW-MEDIUM | MEDIUM |
| **T1** | Tool schemas (28 tools × TypeBox) | ~8,000–12,000 | HIGH | LOW priority (~5% of window) |
| **D1** | `figma_get_file_data` results | 2,000–80,000+ | HIGH for navigation | **VERY HIGH — #1 target** |
| **D2** | `figma_design_system` results | 1,000–15,000 | HIGH for token-aware ops | HIGH |
| **D3** | Component search/details results | 500–10,000 per call | MEDIUM | HIGH |
| **D4** | `figma_get_selection` results | 200–5,000 | HIGH — primary scope signal | MEDIUM |
| **I1** | Screenshots (`figma_screenshot`) | 1,000–6,000 vision tok/image | HIGH — visual verification | LOW |
| **M1** | Mutation tool results (set_fills, set_text, etc.) | 50–300 per call | LOW individually | **VERY HIGH** |
| **M2** | Component tool results (instantiate, etc.) | 100–500 per call | MEDIUM | HIGH |
| **M3** | Token/lint tool results | 100–2,000 per call | MEDIUM | MEDIUM |
| **M4** | JSX render results | 100–800 per call | MEDIUM | HIGH |
| **E1** | `figma_execute` results (free-form JSON) | 100–10,000+ | HIGH | MEDIUM (free-form) |
| **H1** | User messages | 50–500 per message | HIGH | LOW |
| **H2** | Assistant text responses | 100–1,000 per response | MEDIUM | HIGH |
| **H3** | Accumulated tool call/result pairs | 500–5,000 per turn | MEDIUM | VERY HIGH |

### 1.3 Context Growth Model

A typical 10-turn design session (create a card component, style it, add content, verify):

| Turn | Action | Incremental Tokens | Cumulative |
|---|---|---|---|
| 0 | System prompt + tool schemas loaded | ~16,500 | ~16,500 |
| 1 | User: "Create a login form" + `figma_get_selection` | ~600 | ~17,100 |
| 2 | `figma_get_file_data` (discover page structure) | ~8,000 | ~25,100 |
| 3 | `figma_design_system` (fetch tokens) | ~4,000 | ~29,100 |
| 4 | `figma_render_jsx` (create form) + screenshot | ~3,500 | ~32,600 |
| 5 | `figma_set_fills` × 3 + `figma_set_text` × 4 + screenshot | ~3,200 | ~35,800 |
| 6 | `figma_execute` (font weight change) + screenshot | ~2,500 | ~38,300 |
| 7 | User feedback + adjustments + screenshot | ~3,000 | ~41,300 |
| 8 | `figma_search_components` + `figma_instantiate` + screenshot | ~4,500 | ~45,800 |
| 9 | Final polish + `figma_lint` + screenshot | ~4,000 | ~49,800 |
| 10 | Summary response | ~500 | ~50,300 |

**At turn 10: ~50K tokens — 25% of the 200K floor.**

#### Extended 30-Turn Session (realistic design iteration)

| Turn | Action | Incremental Tokens | Cumulative |
|---|---|---|---|
| 10 | (from above) | — | ~50,300 |
| 11-15 | User refinements: 5× (feedback + set_fills/text/move + screenshot) | ~15,000 | ~65,300 |
| 16 | Second `figma_get_file_data` (re-discover after changes) | ~8,000 | ~73,300 |
| 17-20 | Component work: search + instantiate + configure + screenshot ×2 | ~12,000 | ~85,300 |
| 21-25 | Token binding: design_system + bind_variable ×5 + screenshot | ~10,000 | ~95,300 |
| 26-28 | Responsive variant: clone + resize + adjust ×4 + screenshot | ~9,000 | ~104,300 |
| 29-30 | Final lint + polish + screenshot + summary | ~6,000 | ~110,300 |

**At turn 30: ~110K tokens without compression — 55% of 200K.** With heavy files and multiple discovery calls, this can reach 150-180K.

**Key compression targets:**
- **D1**: A 500+ node page produces 80,000+ tokens in a single `figma_get_file_data` — 40% of 200K
- **M1-M4**: 50+ mutation calls × 200 tokens each = 10,000 tokens of pure noise
- **I1**: 10+ screenshots × 3-6K each = 30-60K vision tokens
- **H3**: Accumulated old tool results from turns 1-20 = 40-60K tokens the LLM must re-process every turn

### 1.4 Verified Tool Result Shapes

All 28 tools use `textResult()` wrapper → `{ content: [{ type: 'text', text: JSON.stringify(data) }], details: {} }`. Screenshot is the only exception (image content block).

**Mutation tools** (verified pattern):
```json
{"success":true,"node":{"id":"123:456","name":"Button","width":200,"height":48}}
```

**Delete tool**:
```json
{"success":true,"deleted":{"id":"123:456","name":"Old Button"}}
```

**JSX render**:
```json
{"success":true,"nodeId":"123:456","childIds":["234:567","345:678"]}
```

Node IDs are **always** in `"X:Y"` format (colon-delimited numbers). No exceptions across all 28 tools.

---

## 2. Verified Pi SDK Integration Points

All APIs below have been verified against Pi SDK source code (`@mariozechner/pi-coding-agent` v current).

### 2.1 Extension Factory Registration

```typescript
const resourceLoader = new DefaultResourceLoader({
  cwd: os.tmpdir(),
  systemPrompt: buildSystemPrompt(modelLabel),
  noExtensions: true,    // disables filesystem discovery ONLY
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  extensionFactories: [  // runs UNCONDITIONALLY, even with noExtensions: true
    (pi: ExtensionAPI) => {
      pi.on("tool_result", async (event) => { /* ... */ });
      pi.on("context", async (event) => { /* ... */ });
      pi.on("session_before_compact", async (event) => { /* ... */ });
      pi.on("before_agent_start", async (event) => { /* ... */ });
    }
  ],
});
```

**Verified**: `loadExtensionFactories()` in `resource-loader.js:259` runs unconditionally after path-based loading. `noExtensions` only gates filesystem discovery.

### 2.2 Available Events

| Event | When | Can Modify? | Use Case |
|---|---|---|---|
| `tool_result` | After tool executes, before result stored | **Yes** — return `{ content, details, isError }` | Ingestion-time compression |
| `context` | Before each LLM call | **Yes** — return `{ messages }` (filtered/modified) | Age-based stripping, screenshot eviction |
| `session_before_compact` | When auto-compaction triggers | **Yes** — return `{ compaction: { summary } }` | Domain-aware compaction |
| `before_agent_start` | Before each agent turn | **Yes** — modify prompt | Context injection after model switch |
| `tool_call` | Before tool executes | **Yes** — can block | Tool gating (not used for compression) |

### 2.3 Message Structure in `context` Event

```typescript
interface ToolResultMessage {
  role: "toolResult";      // reliable discriminator
  toolName: string;        // e.g., "figma_screenshot", "figma_set_fills"
  toolCallId: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;       // Unix ms — usable for age-based filtering
}
```

- Screenshots identifiable via `toolName === "figma_screenshot"` + `content[].type === "image"`
- Safe to filter/remove messages from array (no index dependencies, correlation is via `toolCallId`)
- `tool_result` modifications chain like middleware across extensions

### 2.4 Existing WebSocket Events (for cache invalidation)

`documentChange` event is **already fully wired**: `figma.on('documentchange')` → plugin postMessage → ui.html relay → WebSocket → `FigmaWebSocketServer.emit('documentChange')`.

Available fields:
- `hasStyleChanges: boolean` — covers variable/style edits
- `hasNodeChanges: boolean` — covers node creates/deletes/renames (including components)
- `changedNodeIds: string[]` — up to 50 changed node IDs
- `changeCount: number`

**Note**: `figma_design_system` returns both variables AND local components. Cache invalidation must check `hasStyleChanges || hasNodeChanges` to cover both.

---

## 3. Compression Strategy per Category

### 3.1 System Prompt: Keep Monolithic (S1–S5)

**Decision: Keep the full system prompt as a single monolithic block.** At 200K floor, ~4,500 tokens is 2.25% of the window. Splitting into on-demand segments saves ~2,000 tokens (~1%) with real risk of the agent lacking reference material.

### 3.2 Tool Schemas: Keep All 28, Consider Description Trimming (T1)

**Decision: Keep all 28 tool schemas always loaded.** ~10K tokens is 5% of the floor. Dynamic loading risks the agent not being able to call needed tools.

**Optional optimization**: Trim verbose/duplicated parameter descriptions across tools. Estimated savings: ~1,500–2,500 tokens. One-time edit, zero risk.

### 3.3 Discovery Result Compression (D1–D4) — Phase 1

#### D1: Tree Projection for `figma_get_file_data`

**Mechanism**: In the tool's `execute()` function, transform raw Figma JSON into a compact projected representation.

**Projected format** (readable keys, relationship metadata included):

```typescript
interface ProjectedNode {
  id: string;                        // Figma node ID ("X:Y")
  type: string;                      // "FRAME"|"TEXT"|"RECT"|"ELLIPSE"|"COMPONENT"|"INSTANCE"|"GROUP"|"VECTOR"|"LINE"
  name: string;
  box?: string;                      // "WxH" (only if set)
  layout?: string;                   // "H"|"V"|"WRAP" (auto-layout mode)
  gap?: number;                      // itemSpacing (only if auto-layout)
  padding?: string;                  // "T,R,B,L" (only if non-zero)
  fill?: string;                     // "#RRGGBB" or "img" or "grad"
  stroke?: string;                   // "#RRGGBB/W"
  text?: string;                     // text content (first 100 chars, TEXT nodes only)
  fontSize?: number;                 // TEXT nodes only
  parentId?: string;                 // parent node ID (for flat representations)
  componentKey?: string;             // INSTANCE nodes — which component
  componentRef?: string;             // COMPONENT nodes — component key
  hidden?: true;                     // only included if visible=false
  hasEffects?: true;                 // flag when effects exist (details omitted)
  hasComplexFill?: true;             // flag when gradient/image fill (details omitted)
  children?: ProjectedNode[];
}
```

**What gets stripped**: Default values (opacity:1, visible:true, blendMode:NORMAL), plugin data, prototype data, geometry vectors, detailed paint/effect definitions, absolute bounding boxes.

**Compression ratio**: 80–90% reduction. 14-node tree: ~8,200 → ~1,000 tokens.

**Implementation**: New `projectTree()` function in tool wrapper, called from `figma_get_file_data`'s `execute()`. Raw tree cached in Electron memory for re-expansion.

#### D2: Design System Cache + Compact

**Mechanism**: Cache in Electron memory after first call. Return compact representation on subsequent calls.

```typescript
interface CompactDesignSystem {
  vars: CompactVariableCollection[];
  styles: CompactStyle[];
  components: CompactComponent[];
}

interface CompactVariableCollection {
  name: string;
  modes: string[];
  vars: Record<string, { type: "BOOL"|"FLOAT"|"STRING"|"COLOR"; values: Record<string, string | number | boolean> }>;
}

interface CompactStyle {
  name: string;
  type: "FILL"|"TEXT"|"EFFECT"|"GRID";
  key: string;
}

interface CompactComponent {
  name: string;
  key: string;
  variants?: string[];
  props?: string[];
}
```

**Compression ratio**: ~85% (4,200 → 620 tokens). Colors: RGBA → hex. Components: full definitions → name+key+variant summary.

**Cache invalidation**: `wsServer.on('documentChange')` → invalidate on `hasStyleChanges || hasNodeChanges`. Fallback TTL: 60 seconds.

#### D3: Component Search Caching

In-memory LRU cache for component search results, keyed by query string. TTL: 5 minutes. Components don't change during a session unless the user publishes library updates.

### 3.4 Mutation Result Compression (M1–M4) — Phase 1

**Mechanism**: In `tool_result` event handler, compress success results to minimal form.

```typescript
// In extension factory
pi.on("tool_result", async (event) => {
  if (isMutationTool(event.toolName) && !event.isError) {
    const data = JSON.parse(event.content[0]?.text || '{}');
    const nodeId = data.node?.id || data.nodeId || data.deleted?.id;
    return {
      content: [{ type: "text", text: nodeId ? `OK node=${nodeId}` : "OK" }]
    };
  }
});
```

**Applicable tools** (16): `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_set_image_fill`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`, `figma_rename`, `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable`, `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`.

**Compression ratio**: ~95% per result (200 → 10 tokens). Session total: ~5,400 tokens saved.

**Errors pass through uncompressed** for debugging.

### 3.5 `figma_execute` Result Processing (E1) — Phase 1

**Node ID extraction**: Parse returned JSON for node IDs (pattern: `"X:Y"`) and prepend summary:
```
Returned IDs: 42:15, 42:16, 42:17
[Full response follows...]
```

**Size-gated truncation**: If result exceeds ~8,000 tokens (~20,000 chars), truncate with marker. Node ID extraction runs BEFORE truncation.

### 3.6 History Management (H1–H3) — Phase 2

Essential for sessions beyond 15 turns. Prevents linear context growth that degrades LLM reasoning quality and risks compaction on 200K models.

#### Pre-Compaction Result Stripping (`context` event)

Before each LLM call, compress old tool results using **tool-type-aware thresholds**:

```typescript
const STRIP_POLICY: Record<string, { maxAgeTurns: number; minTokens: number }> = {
  // Re-fetchable discovery → strip aggressively
  figma_get_file_data:       { maxAgeTurns: 2, minTokens: 200 },
  figma_design_system:       { maxAgeTurns: 2, minTokens: 200 },
  figma_search_components:   { maxAgeTurns: 3, minTokens: 200 },
  figma_get_component_details: { maxAgeTurns: 3, minTokens: 200 },

  // Screenshots → handled by dedicated eviction (see below)
  figma_screenshot:          { maxAgeTurns: Infinity, minTokens: Infinity },

  // figma_execute → conservative, may contain critical IDs
  figma_execute:             { maxAgeTurns: 6, minTokens: 1000 },

  // Default for unlisted tools
  _default:                  { maxAgeTurns: 4, minTokens: 500 },
};
```

**Compressed form**: `[toolName OK: nodes=X:Y,Z:W]` or `[toolName ERROR: first 200 chars]`.

**Idempotency**: Mark compressed messages to prevent re-compression on subsequent turns.

#### Screenshot History Eviction (`context` event)

Keep last N screenshots in full resolution. Replace older ones with text placeholder.

- 200K models: keep last 3
- 1M models: keep last 5

**Placeholder**: `"[Screenshot of node 'NodeName' at turn N]"` — no status inference (verified/failed/unknown). The agent can re-screenshot if needed.

### 3.7 Session Continuity — Phase 3

Preserves agent coherence across model switches and auto-compaction events. Critical for sessions where users switch between models (e.g., Sonnet for speed → Opus for complex reasoning) or sessions that trigger compaction on 200K models.

#### OperationLog (Electron-side)

Structured log in Electron main process memory. Survives model switches and compaction (not in LLM context).

```typescript
interface OperationEntry {
  turn: number;
  tool: string;
  action: "C" | "M" | "D" | "R" | "Q";  // Create, Modify, Delete, Read, Query
  nodeId?: string;
  nodeIds?: string[];
  name?: string;
  error?: string;  // first 100 chars if failed
}

interface OperationLog {
  fileKey: string;
  entries: OperationEntry[];
  nodeRegistry: Record<string, {
    name: string;
    type: string;
    status: "live" | "deleted";
    lastTouchedTurn: number;
  }>;
  designDecisions: string[];
  scopeStack: string[];          // current working frame path
}
```

**Recording**: In `tool_result` event handler, append to OperationLog after compression.

**Model switch recovery**: In `before_agent_start` event, inject `operationLog.toCompactSummary()` as context when the session was just created (first turn after model switch).

#### Thin Custom Compaction (`session_before_compact`)

When Pi SDK auto-compaction triggers, emit OperationLog as structured state instead of relying on generic summarizer:

```typescript
pi.on("session_before_compact", async (event) => {
  return {
    compaction: {
      summary: operationLog.toCompactSummary(),
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
    }
  };
});
```

**This is NOT a conversation summarizer.** It serializes the OperationLog (~300-500 tokens), which preserves node IDs, operation history, and design decisions without parsing conversation text or calling an LLM.

---

## 4. Implementation Phases

All three phases are planned for implementation. Phasing reflects implementation order and dependency, not conditionality — each phase builds on the previous and all are needed for 30+ turn sessions.

### Phase 1: Ingestion-Time Compression + Metrics (~13h)

Reduces noise at the source. Improves quality for ALL sessions. Also establishes the metrics collection infrastructure that informs tuning of Phase 2-3.

| # | Component | Where | Effort | Savings/Session | Risk |
|---|---|---|---|---|---|
| 1.1 | Mutation result compression | Extension factory (`tool_result`) | 2h | ~5,400 tok | Zero |
| 1.2 | Tree projection | `tools/discovery.ts` + new `project-tree.ts` | 4h | 7K–72K tok | Low-Med |
| 1.3 | Design system cache + compact | `tools/discovery.ts` + new `design-system-cache.ts` | 3h | 3K–12K tok | Low |
| 1.4 | `figma_execute` size-gate + ID extraction | Extension factory (`tool_result`) | 2h | 0–10K tok | Low |
| 1.5 | Cache invalidation via documentChange | `figma-core.ts` or `index.ts` | 1h | N/A (correctness) | Zero |
| 1.6 | Metrics system (see Section 9) | New `compression-metrics.ts` + IPC + renderer | 1h | N/A (observability) | Zero |

**Expected result at turn 10**: ~50K → ~30K tokens (40% reduction).
**Expected result at turn 30**: ~110K → ~65K tokens (41% reduction on non-history content).
**Edge case 500-node file**: ~80K → ~8K single-call reduction (90%).

### Phase 2: History Management (~6h)

Prevents linear context growth. Without this, a 30-turn session accumulates ~60K of old tool results the LLM must re-process every turn. Implement after Phase 1 is stable and metrics confirm baseline compression ratios.

| # | Component | Where | Effort | Savings/Session (30 turns) | Risk |
|---|---|---|---|---|---|
| 2.1 | Context stripping (tool-type-aware) | Extension factory (`context`) | 4h | 30K–50K tok | Medium |
| 2.2 | Screenshot eviction | Extension factory (`context`) | 2h | 15K–30K tok | Low |

**Expected result at turn 30 (with Phase 1+2)**: ~110K → ~35K tokens (68% total reduction).

**Tuning via metrics**: The `STRIP_POLICY` thresholds (maxAgeTurns, minTokens per tool type) will be calibrated using real session data from Phase 1 metrics. Initial values are conservative estimates.

### Phase 3: Session Continuity (~6h)

Preserves agent coherence across model switches and compaction events. Implement after Phase 2 is stable. On 200K models with Phase 1+2 active, compaction may still fire at turn 35+ — this phase ensures node IDs and design decisions survive.

| # | Component | Where | Effort | Risk |
|---|---|---|---|---|
| 3.1 | OperationLog | New `operation-log.ts` + wiring in extension factory | 3h | Low |
| 3.2 | Model switch recovery | Extension factory (`before_agent_start`) | 1h | Low |
| 3.3 | Thin custom compaction | Extension factory (`session_before_compact`) | 1h | Low |
| 3.4 | `figma_session_context` tool | `tools/core.ts` | 1h | Low |

### Implementation Timeline

```
Phase 1 (~13h)  ████████████████  Ingestion compression + metrics
  ↓ stabilize, collect data, tune
Phase 2 (~6h)   ████████          History management
  ↓ stabilize, observe compaction frequency
Phase 3 (~6h)   ████████          Session continuity
                                  ─────────────────────
                Total: ~25h
```

---

## 5. Architecture

### 5.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FIGMA DESKTOP                                 │
│  Desktop Bridge Plugin (code.js + ui.html)                           │
│    ├── figma.on('documentchange') → DOCUMENT_CHANGE                  │
│    │   (hasStyleChanges, hasNodeChanges, changedNodeIds)              │
│    ├── EXECUTE_CODE, SCREENSHOT, GET_SELECTION, ...                  │
│    └── CREATE_FROM_JSX, CREATE_ICON, BIND_VARIABLE                  │
└────────┬────────────────────────────────────────────────────────────┘
         │ WebSocket ws://localhost:9223
┌────────▼────────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐          │
│  │  Cache Layer (Phase 1)                                  │          │
│  │  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐ │          │
│  │  │ TreeCache     │  │ DesignSystem  │  │ Component   │ │          │
│  │  │ raw tree by   │  │ Cache         │  │ SearchCache │ │          │
│  │  │ nodeId        │  │ TTL: 60s      │  │ TTL: 5min   │ │          │
│  │  │ TTL: 30s      │  │ invalidate on │  │ LRU         │ │          │
│  │  │               │  │ style+node chg│  │             │ │          │
│  │  └──────────────┘  └───────────────┘  └─────────────┘ │          │
│  └────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐          │
│  │  OperationLog (Phase 3 — Electron memory)               │          │
│  │  Survives model switch. Records tool calls + node IDs.  │          │
│  └────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐          │
│  │  Tool Wrappers (tools/*.ts) — Phase 1                   │          │
│  │                                                         │          │
│  │  figma_get_file_data.execute():                         │          │
│  │    → TreeCache check → fetch via WS → projectTree()     │          │
│  │    → cache raw → return projected                       │          │
│  │                                                         │          │
│  │  figma_design_system.execute():                         │          │
│  │    → DesignSystemCache check → fetch → compact → return │          │
│  └────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐          │
│  │  Extension Factory (extensionFactories in agent.ts)      │          │
│  │                                                         │          │
│  │  Phase 1:                                               │          │
│  │    tool_result → mutation compression ("OK node=X:Y")   │          │
│  │                → metrics logging                        │          │
│  │                                                         │          │
│  │  Phase 2:                                               │          │
│  │    context → strip old tool results (type-aware)        │          │
│  │           → evict old screenshots (keep last N)         │          │
│  │                                                         │          │
│  │  Phase 3:                                               │          │
│  │    tool_result → OperationLog recording                 │          │
│  │    before_agent_start → model switch recovery           │          │
│  │    session_before_compact → OperationLog snapshot       │          │
│  └────────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐          │
│  │  Pi SDK AgentSession                                    │          │
│  │                                                         │          │
│  │  LLM Context Window:                                    │          │
│  │  ├── Full system prompt (S1-S5)        ~4,500 tok       │          │
│  │  ├── All 28 tool schemas               ~10,000 tok      │          │
│  │  ├── Compressed discovery results     ~1,000-3,000 tok  │          │
│  │  ├── Compressed mutation results      ~10 tok each      │          │
│  │  ├── Recent screenshots               ~3,000 tok each   │          │
│  │  ├── User messages + assistant text   varies             │          │
│  │  └── [Phase 2] Old results stripped to summaries         │          │
│  └────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Cache Invalidation

```
Event Source                   → Cache Action
───────────────────────────────────────────────────────
WS documentChange (hasNodeChanges)
  + changedNodeIds             → TreeCache.invalidateNodes(changedNodeIds)
WS documentChange (hasStyleChanges)
                               → DesignSystemCache.invalidate()
WS documentChange (hasNodeChanges)
                               → DesignSystemCache.invalidate() (components)
figma_execute(*)               → TreeCache.invalidateAll() (unpredictable scope)
TTL expiry (30s)               → TreeCache entry expires
TTL expiry (60s)               → DesignSystemCache entry expires
TTL expiry (5min)              → ComponentSearchCache entry expires
Model switch                   → Caches survive (Electron memory persists)
```

---

## 6. Failure Mode Analysis

| # | Failure Mode | Severity | Mitigation |
|---|---|---|---|
| **F1** | Agent creates duplicate nodes after compression loses track | MEDIUM | OperationLog (Phase 3) preserves node registry. Phase 1: agent can re-fetch via `figma_get_file_data`. |
| **F2** | Agent targets stale node ID (user deleted in Figma) | MEDIUM | On "Node not found" error from plugin, invalidate TreeCache. Error passes through uncompressed. |
| **F3** | Projected tree omits property agent needs | LOW | `hasComplexFill`/`hasEffects` flags signal details available. Agent re-inspects via `figma_execute`. |
| **F4** | DesignSystemCache stale after user adds variables | MEDIUM | Invalidated by `documentChange` with `hasStyleChanges \|\| hasNodeChanges`. Fallback: 60s TTL. |
| **F5** | Screenshot eviction loses visual comparison | LOW | Agent can re-screenshot. [Phase 2 only] |
| **F6** | `figma_execute` truncation loses data | LOW | Node ID extraction runs BEFORE truncation. IDs prepended as summary. |
| **F7** | Context stripping corrupts Pi SDK state | CRITICAL | `context` event receives deep copy. Validate filtered array structure. Idempotency markers prevent re-compression. [Phase 2 only] |
| **F8** | Model switch loses all context | HIGH | Caches survive in Electron memory. OperationLog provides recovery. [Phase 3] |
| **F9** | Over-compression causes agent to stop asking for detail | MEDIUM | Metrics track compression ratios. Flags (`hasEffects`, `hasComplexFill`) preserve signal that detail exists. |

---

## 7. Projected Savings

### Turn 10 — Short Session

| Component | No Compression | Phase 1 | Phase 1+2 |
|---|---|---|---|
| System prompt + tools | ~16,500 | ~16,500 | ~16,500 |
| `figma_get_file_data` (turn 2) | ~8,000 | ~1,000 | ~1,000 |
| `figma_design_system` (turn 3) | ~4,000 | ~620 | ~620 |
| Mutation results (~30 calls) | ~6,000 | ~300 | ~300 |
| Screenshots (5 taken) | ~20,000 | ~20,000 | ~14,000 (3 kept) |
| Old tool results (turns 1-6) | ~12,000 | ~12,000 | ~1,000 (stripped) |
| User/assistant text | ~13,500 | ~13,500 | ~13,500 |
| **Total** | **~80,000** | **~63,920** | **~46,920** |
| **% of 200K** | **40%** | **32%** | **23%** |

### Turn 30 — Full Design Session

| Component | No Compression | Phase 1 | Phase 1+2 | Phase 1+2+3 |
|---|---|---|---|---|
| System prompt + tools | ~16,500 | ~16,500 | ~16,500 | ~16,500 |
| Discovery results (2× file_data, 1× design_system, 2× search) | ~28,000 | ~3,500 | ~3,500 | ~3,500 |
| Mutation results (~60 calls) | ~12,000 | ~600 | ~600 | ~600 |
| Screenshots (12 taken) | ~48,000 | ~48,000 | ~12,000 (3 kept) | ~12,000 |
| Old tool results (turns 1-24) | ~45,000 | ~45,000 | ~3,000 (stripped) | ~3,000 |
| User/assistant text | ~30,000 | ~30,000 | ~30,000 | ~30,000 |
| **Total** | **~179,500** | **~143,600** | **~65,600** | **~65,600** |
| **% of 200K** | **90%** ⚠️ | **72%** | **33%** | **33%** + recovery |
| **Compaction risk (200K)** | **High** | **Moderate** | **None** | **None + resilient** |

**Key insight**: Phase 1 alone is insufficient for 30-turn sessions on 200K models (72% → compaction likely with large files). Phase 2 is essential to bring it to 33%.

### Edge Case: 500-Node File at Turn 15

| Scenario | No Compression | Phase 1 | Phase 1+2 |
|---|---|---|---|
| `figma_get_file_data` on full page | ~80,000 | ~8,000 | ~8,000 |
| Cumulative context at turn 15 | ~145,000 | ~73,000 | ~48,000 |
| % of 200K | **73%** ⚠️ | **37%** | **24%** |

---

## 8. Deferred Proposals

The following were proposed during the review process and evaluated as valuable but premature for the current project stage. They are documented here for future reference.

### 8.1 SessionState / World Model (from GPT-5.4 review)

A maintained world model outside the transcript: `userPreferences`, `openGoals`, `verifiedArtifacts`, `nodeAliases`, `searchMemory`. Injected as a brief each turn.

**Why deferred**: For sessions <15 turns, the conversation itself IS the world model. No evidence of sessions long enough to benefit from external state maintenance. The OperationLog (Phase 3) covers the critical subset (node registry + design decisions).

**Revisit when**: Sessions regularly exceed 25+ turns, or users report the agent "losing track" of stated preferences.

### 8.2 Facet-Based / Layered Tree Projection (from GPT-5.4 review)

Split projection into `NodeCore` (always) + `NodeFacets` (on-demand): navigation view vs style details.

**Why deferred**: Requires either two tool calls per exploration or a tool parameter for "expand this node." The flat projection with flags (`hasEffects`, `hasComplexFill`) provides a simpler "expand via figma_execute" escape hatch.

**Revisit when**: Metrics show agents frequently need style details that the flat projection omits.

### 8.3 Reference-Based Exemption (from GPT-5.4 review)

In context stripping, keep old results whose node IDs are referenced by later turns.

**Why deferred**: Requires parsing node IDs from all messages to build a dependency graph. For sessions <20 turns, the full-fidelity window (4-6 turns) already covers most back-references.

**Revisit when**: Phase 2 context stripping causes demonstrable loss of referenced state.

### 8.4 Narrower Read Tools (from GPT-5 review)

Replace broad `figma_get_file_data` with `get_subtree`, `inspect_node_style`, `list_children`, `resolve_ids`.

**Why deferred**: Requires new tool definitions, plugin modifications, and system prompt updates. High effort for incremental benefit over tree projection.

**Revisit when**: Tree projection alone doesn't solve the large-file edge case, or tool schema count isn't a concern.

### 8.5 Delta-Based Reads (from GPT-5 review)

After first tree fetch, subsequent reads return only changes keyed off `changedNodeIds`.

**Why deferred**: Requires diff computation between cached and current tree. TreeCache with TTL-based invalidation is simpler and sufficient for Phase 1.

**Revisit when**: Sessions involve rapid iteration on the same subtree with many re-fetches.

---

## 9. Metrics & Observability System

### 9.1 Rationale

Compression thresholds (strip policy, screenshot retention, execute size-gate) need calibration against real usage data. The metrics system is built in Phase 1 and collects data that informs tuning of Phase 2-3 parameters.

### 9.2 Existing Infrastructure

The app already has observability hooks:
- `agent:usage` IPC event sends `{ input, output, total }` token counts per message from Pi SDK
- `agent:compaction` IPC event signals compaction start/end
- Renderer has a context bar (`#context-bar`) showing `inputTokens / maxTokens` with color-coded fill
- `pino` logger in main process (`createChildLogger`)

### 9.3 What to Collect

#### Per-Tool-Call Metrics (in `tool_result` handler)

```typescript
interface ToolCompressionEvent {
  toolName: string;
  category: "mutation" | "discovery" | "screenshot" | "execute" | "jsx" | "other";
  charsBefore: number;     // JSON.stringify(original).length
  charsAfter: number;      // JSON.stringify(compressed).length
  estimatedTokensBefore: number;  // charsBefore / 4
  estimatedTokensAfter: number;   // charsAfter / 4
  compressionRatio: number;       // 1 - (after/before)
  hadError: boolean;
  timestamp: number;
}
```

**Collection point**: Extension factory `tool_result` handler, after compression, before returning.

#### Per-Turn Metrics (in `context` handler — Phase 2)

```typescript
interface ContextShapingEvent {
  turnNumber: number;
  totalMessagesBefore: number;
  totalMessagesAfter: number;
  messagesStripped: number;
  screenshotsEvicted: number;
  estimatedTokensBefore: number;  // sum of all message content lengths / 4
  estimatedTokensAfter: number;
  timestamp: number;
}
```

**Collection point**: Extension factory `context` handler, after filtering, before returning.

#### Per-Session Aggregates (on session end / model switch)

```typescript
interface SessionMetrics {
  sessionId: string;
  modelId: string;
  contextWindowSize: number;
  totalTurns: number;
  totalToolCalls: number;
  totalTokensSaved: number;        // sum of all compression savings
  peakContextTokens: number;       // highest input token count seen via agent:usage
  compactionTriggered: boolean;
  modelSwitchCount: number;
  durationMs: number;
  toolCallsByCategory: Record<string, number>;
  compressionByCategory: Record<string, { totalBefore: number; totalAfter: number }>;
}
```

**Collection point**: `agent_end` event in extension factory + IPC `agent:usage` tracking in main process.

### 9.4 Storage & Persistence

```
~/.figma-cowork/
├── sessions/          (existing — Pi SDK session JSONL files)
└── metrics/
    ├── sessions.jsonl           ← one SessionMetrics per line, append-only
    └── compression-events.jsonl ← one ToolCompressionEvent per line, append-only
```

**Format**: JSONL (one JSON object per line). Append-only, no reads during normal operation.

**Rotation**: Files are rotated when they exceed 10MB (simple rename with date suffix). Old files can be deleted manually.

**Privacy**: No user content or Figma data is stored — only tool names, token counts, and timing.

### 9.5 Implementation

#### Main Process: `CompressionMetricsCollector`

New file: `src/main/compression-metrics.ts`

```typescript
import { createChildLogger } from '../figma/logger.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const log = createChildLogger({ component: 'metrics' });
const METRICS_DIR = path.join(os.homedir(), '.figma-cowork', 'metrics');

export class CompressionMetricsCollector {
  private sessionMetrics: Partial<SessionMetrics> = {};
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(sessionId: string, modelId: string, contextWindowSize: number) {
    this.sessionMetrics = {
      sessionId, modelId, contextWindowSize,
      totalTurns: 0, totalToolCalls: 0, totalTokensSaved: 0,
      peakContextTokens: 0, compactionTriggered: false,
      modelSwitchCount: 0, durationMs: 0,
      toolCallsByCategory: {}, compressionByCategory: {},
    };
  }

  recordToolCompression(event: ToolCompressionEvent) {
    this.sessionMetrics.totalToolCalls!++;
    this.sessionMetrics.totalTokensSaved! += event.estimatedTokensBefore - event.estimatedTokensAfter;

    const cat = event.category;
    this.sessionMetrics.toolCallsByCategory![cat] = (this.sessionMetrics.toolCallsByCategory![cat] || 0) + 1;

    const cc = this.sessionMetrics.compressionByCategory![cat] ||= { totalBefore: 0, totalAfter: 0 };
    cc.totalBefore += event.estimatedTokensBefore;
    cc.totalAfter += event.estimatedTokensAfter;

    this.bufferLine('compression-events.jsonl', JSON.stringify(event));
  }

  recordContextUsage(inputTokens: number) {
    if (inputTokens > (this.sessionMetrics.peakContextTokens || 0)) {
      this.sessionMetrics.peakContextTokens = inputTokens;
    }
  }

  recordTurn() { this.sessionMetrics.totalTurns!++; }
  recordCompaction() { this.sessionMetrics.compactionTriggered = true; }
  recordModelSwitch() { this.sessionMetrics.modelSwitchCount!++; }

  async flush() {
    // Write buffered events
    if (this.buffer.length > 0) {
      await fs.mkdir(METRICS_DIR, { recursive: true });
      const eventsFile = path.join(METRICS_DIR, 'compression-events.jsonl');
      await fs.appendFile(eventsFile, this.buffer.join('\n') + '\n');
      this.buffer = [];
    }
  }

  async finalize(durationMs: number) {
    this.sessionMetrics.durationMs = durationMs;
    await this.flush();
    // Append session summary
    await fs.mkdir(METRICS_DIR, { recursive: true });
    const sessionsFile = path.join(METRICS_DIR, 'sessions.jsonl');
    await fs.appendFile(sessionsFile, JSON.stringify(this.sessionMetrics) + '\n');
    log.info(this.sessionMetrics, 'Session metrics finalized');
  }

  private bufferLine(file: string, line: string) {
    this.buffer.push(line);
    // Auto-flush every 20 events
    if (this.buffer.length >= 20) {
      this.flush().catch(err => log.warn({ err }, 'Metrics flush failed'));
    }
  }
}
```

#### Integration Points

1. **`agent.ts`**: Create `CompressionMetricsCollector` instance alongside `AgentInfra`. Pass to extension factory.

2. **Extension factory** (`tool_result` handler): After compression, call `metrics.recordToolCompression()`.

3. **`ipc-handlers.ts`**: On `agent:usage` event, call `metrics.recordContextUsage(usage.input)`. On `agent:compaction`, call `metrics.recordCompaction()`. On model switch, call `metrics.recordModelSwitch()`.

4. **Renderer context bar** (optional enhancement): Show compression savings alongside context usage. E.g., `"32K / 200K (saved 18K)"`.

### 9.6 Analysis

Metrics files can be analyzed offline with simple scripts:

```bash
# Average session length
cat ~/.figma-cowork/metrics/sessions.jsonl | jq -s 'map(.totalTurns) | add / length'

# Compression ratio by category
cat ~/.figma-cowork/metrics/sessions.jsonl | jq -s '
  map(.compressionByCategory | to_entries[]) | group_by(.key) |
  map({ category: .[0].key,
         ratio: (1 - (map(.value.totalAfter) | add) / (map(.value.totalBefore) | add)) })'

# Sessions where compaction fired
cat ~/.figma-cowork/metrics/sessions.jsonl | jq 'select(.compactionTriggered == true)'

# Peak context usage distribution
cat ~/.figma-cowork/metrics/sessions.jsonl | jq -s 'map(.peakContextTokens) | sort'
```

### 9.7 Decision Points from Metrics

| Metric | Threshold | Action |
|---|---|---|
| Avg turns/session | > 15 | Confirms Phase 2 priority |
| Peak context > 120K (200K model) | Any occurrence | Phase 2 is urgent |
| Compaction triggered | Any occurrence | Phase 3 is urgent |
| Model switch count > 0 with > 10 turns | Any occurrence | Phase 3.2 (recovery) is urgent |
| Discovery compression ratio < 70% | Consistent | Revisit `projectTree()` — missing key properties |
| Mutation compression ratio < 90% | Consistent | Bug in compression — some tools returning unexpected format |
| Screenshot eviction saves < 10K/session | Consistent | Phase 2.2 ROI may not justify risk — tune retention count |

---

## Appendix A: Compression Configuration

Single configuration for all models initially. Two-tier (moderate/relaxed) to be introduced only if metrics show meaningful difference in behavior between 200K and 1M models.

```typescript
interface CompressionConfig {
  // Phase 1
  compressMutationResults: boolean;
  projectTreeResults: boolean;
  compactDesignSystem: boolean;
  executeResultMaxTokens: number;

  // Phase 2
  fullFidelityTurns: number;
  maxScreenshotsInContext: number;
  stripPolicy: Record<string, { maxAgeTurns: number; minTokens: number }>;

  // Phase 3
  useOperationLog: boolean;
  useCustomCompaction: boolean;
  operationLogMaxEntries: number;

  // Caching
  treeCacheTtlMs: number;
  designSystemCacheTtlMs: number;
  componentCacheTtlMs: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
  compressMutationResults: true,
  projectTreeResults: true,
  compactDesignSystem: true,
  executeResultMaxTokens: 8_000,

  fullFidelityTurns: 4,
  maxScreenshotsInContext: 3,
  stripPolicy: {
    figma_get_file_data:         { maxAgeTurns: 2, minTokens: 200 },
    figma_design_system:         { maxAgeTurns: 2, minTokens: 200 },
    figma_search_components:     { maxAgeTurns: 3, minTokens: 200 },
    figma_get_component_details: { maxAgeTurns: 3, minTokens: 200 },
    figma_screenshot:            { maxAgeTurns: Infinity, minTokens: Infinity },
    figma_execute:               { maxAgeTurns: 6, minTokens: 1000 },
    _default:                    { maxAgeTurns: 4, minTokens: 500 },
  },

  useOperationLog: true,
  useCustomCompaction: true,
  operationLogMaxEntries: 200,

  treeCacheTtlMs: 30_000,
  designSystemCacheTtlMs: 60_000,
  componentCacheTtlMs: 300_000,
};
```
