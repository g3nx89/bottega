---
name: bottega-observatory
description: >
  Bottega-specific observability skill for investigating production issues, analyzing user feedback,
  debugging crashes, and monitoring app health via Axiom logs. Use this skill whenever working with
  Bottega telemetry — crash investigation, session replay, feedback analysis, tool error debugging,
  performance degradation, or generating compact issue reports. Triggers on: "crash", "feedback",
  "session replay", "axiom logs", "bottega logs", "debug production", "investigate issue",
  "what crashed", "why did it fail", "user reported", "error analysis", "tool errors",
  "memory leak", "event loop lag", "health check", "issue report", "crash list".
  Also use when the user asks about Bottega app behavior in production, wants to understand
  what happened during a specific session, or needs aggregated views of problems.
---

# Bottega Observatory

Investigate Bottega production telemetry on Axiom. Bottega is a macOS Electron desktop app
for design pair-programming — AI agent operates on Figma Desktop via WebSocket.

**Dataset**: `bottega-logs`. **Output language**: Italian (match the user's language).

Read `references/schema.md` for the full event taxonomy. Read `references/queries.md` for
ready-to-use APL templates. Read `references/domain-knowledge.md` for tool failure signatures,
timeout reference, visibility gaps, and WebSocket lifecycle patterns.
Do NOT read the codebase to discover schema — it's all here.

## Tools

Use Axiom MCP tools directly — no scripts needed:
- `mcp__axiom__queryDataset` — Run APL against `bottega-logs`
- `mcp__axiom__getDatasetFields` — Field discovery (only if schema.md seems outdated)

Fallback: `axiom-sre`'s `scripts/axiom-query` if MCP unavailable.

## Correlation Model

```
system.anonymousId (user) → sid (app launch) → slotId (tab) → promptId (turn) → turnIndex
```

Every record has `sid`. Agent interaction events add `slotId`, `promptId`, `turnIndex`.
Navigate outward from what you have: `promptId` → `sid` → `system.anonymousId`.

## Known Issues Database

Before investigating, check if the issue matches a known pattern. If it does, confirm
it's still happening and skip the discovery phase.

### KI-001: "Object has been destroyed" at quit
- **Signature**: `TypeError: Object has been destroyed` in `FigmaWebSocketServer.<anonymous>`
- **Mechanism**: Electron destroys BrowserWindow before WS disconnect handler fires.
  `if (mainWindow)` passes because the JS reference exists, but `.webContents` throws.
- **Impact**: Low — fires after `app_quit`, no data loss, no mid-session disruption
- **Status**: Present since v0.6.0. Fix: add `!mainWindow.isDestroyed()` guard in index.ts
- **When you see it**: Shortcut the investigation — confirm it's still the same signature,
  report count/frequency, note it's a known P3.

### KI-002: Figma API 403 "Invalid token"
- **Signature**: `figma_get_library_components` returns `{"status":403,"err":"Invalid token"}`
- **Mechanism**: User's Figma API token expired or never configured
- **Impact**: Medium — blocks library component browsing entirely (100% failure rate)
- **Status**: Needs proactive token validation at session start

### KI-003: Icon hallucination
- **Signature**: `figma_create_icon` fails with "not found on Iconify"
- **Mechanism**: LLM generates non-existent icon set/name combinations
- **Impact**: Medium — design intent not fulfilled
- **Status**: Needs icon catalog in system prompt or fuzzy search fallback

### KI-004: SET_IMAGE_FILL WebSocket timeout
- **Signature**: `figma_set_image_fill` timeout after 60000ms
- **Mechanism**: Large images or WS instability cause plugin to not respond within 60s
- **Impact**: High UX — user waits 60s for nothing
- **Status**: Needs retry with backoff or progressive timeout notification

### KI-005: JSX parse errors (esbuild)
- **Signature**: `figma_render_jsx` fails with `Expected identifier but found "!"`
- **Mechanism**: LLM generates invalid JSX syntax → esbuild transform fails
- **Impact**: Medium — design rendering fails, agent gets error feedback
- **Status**: Tolerable at ~2% error rate. Monitor for trend increase.

### KI-006: Renderer crash killed/SIGTERM (macOS OOM)
- **Signature**: `usage:renderer_crash` with `reason: "killed"`, `exitCode: 15`
- **Mechanism**: macOS OOM killer terminates Electron renderer when system RAM exhausted.
  Bottega itself is lightweight (heap ~40MB) — other apps consume the memory.
- **Impact**: High — session lost, user-facing crash
- **Status**: Seen on v0.9.0. Needs proactive low-RAM warning from heartbeat data.
- **Investigation shortcut**: Check `freeRamGB` from heartbeats — if near 0, system-level OOM.

### KI-007: Gemini API content safety rejection
- **Signature**: `figma_generate_*` fails with "violate content safety policies" (400)
- **Mechanism**: Gemini safety filter rejects the generation prompt
- **Impact**: Low — user can rephrase. No retry helps.
- **Status**: Expected behavior, not a bug.

### KI-008: Gemini API quota exceeded
- **Signature**: `figma_generate_*` fails with "quota exceeded" (429)
- **Mechanism**: Google Cloud API quota hit for the configured key
- **Impact**: High — blocks all image generation until quota resets
- **Status**: User needs to check Google Cloud usage limits

## Investigation Protocols

Each protocol is a decision tree. Follow the branches — don't run all queries.

### Protocol 1: Crash Investigation

```
START → Query crash events (last 24h or specified window)
  │
  ├─ 0 crashes → Report "nessun crash nel periodo" → END
  │
  └─ N crashes found
      │
      ├─ Deduplicate by errorName+errorMessage
      │   ├─ Single signature → Check Known Issues Database
      │   │   ├─ Known issue → Confirm count, note status → REPORT (compact)
      │   │   └─ New issue → Full RCA (steps below)
      │   └─ Multiple signatures → Rank by frequency, RCA top 2-3
      │
      ├─ For each unknown signature:
      │   1. Pull stack trace (project _time, sid, errorName, errorMessage, stack)
      │   2. Check inline vitals on crash events (processRssMB, eventLoopLagMs)
      │   3. Version correlation (join with usage:app_launch on sid)
      │   4. Pre-crash activity (all events for crash sid, last 30s before crash)
      │   5. IF vitals show high heap → check heartbeat trend for that sid (memory leak?)
      │   6. IF vitals show high lag → check concurrent tool calls (main thread blocking?)
      │
      └─ Cross-check: any negative feedback from crash sessions?
          (join crash sids with usage:feedback)
```

**Output template:**

```markdown
# Crash Investigation — [data]

## Riepilogo
| Metrica | Valore |
|---------|--------|
| Crash totali | N |
| Sessioni coinvolte | M |
| Firme distinte | K |
| Crash rate | N/launches × 100% |

## [Per ogni firma, in ordine di frequenza]
### [errorName]: [errorMessage breve]
| | |
|---|---|
| Occorrenze | N |
| Sessioni | M |
| Versioni | [lista] |
| Ultima occorrenza | [timestamp] |
| Known Issue | [KI-XXX o "Nuovo"] |
| Severità | [Critical/High/Medium/Low] |

**Stack trace:**
[prima riga significativa]

**Vitals al crash:**
[tabella o "non disponibili"]

**Attività pre-crash:**
[sequenza eventi negli ultimi 30s]

**Pattern identificato:**
[1-2 frasi sul meccanismo]

**Fix suggerito:**
[azione concreta]

## Cross-correlazione
- Feedback negativo da sessioni crash: [sì/no, dettagli]
- Tool errors co-occorrenti: [lista]
```

### Protocol 2: Feedback Drill-Down

```
START → Query usage:feedback where sentiment=="negative" (last 7d)
  │
  ├─ 0 negative feedback → Check if ANY feedback exists
  │   ├─ No feedback at all → Report "feedback non utilizzato dagli utenti"
  │   └─ Only positive → Report "nessun feedback negativo, N positivi"
  │
  └─ N negative feedback found
      │
      ├─ IF N ≤ 5 → Reconstruct EVERY turn (full detail)
      │   For each feedback event:
      │   1. Get promptId, turnIndex, issueType, details
      │   2. Query all events with that promptId (turn reconstruction)
      │   3. Check for tool_error/agent_error in the same turn
      │   4. Check vitals ±60s around feedback timestamp
      │   5. Get session context (usage:app_launch for that sid)
      │
      ├─ IF N > 5 → Aggregate first, then drill into top patterns
      │   1. Group by issueType → table with counts
      │   2. Group by toolName co-occurrence (which tools ran in negative turns?)
      │   3. Group by model (does one model get more negative feedback?)
      │   4. Pick top 2-3 representative cases → full reconstruction
      │
      └─ ALWAYS: Cross-correlate with tool errors
          Query usage:tool_error for same period.
          Compare: are tools that fail often also present in negative feedback turns?
          → "Leading indicators" section in output
```

**Output template:**

```markdown
# Analisi Feedback — [periodo]

## Panoramica
| Metrica | Valore |
|---------|--------|
| Feedback positivi | N |
| Feedback negativi | M |
| Tasso negativo | M/(N+M) × 100% |
| Issue type più frequente | [tipo] |

## Distribuzione per issue type
| Issue Type | Count | % |
|-----------|-------|---|
| [tipo] | N | X% |

## Ricostruzione turni [per ogni feedback negativo analizzato]
### Feedback #K — [issueType] ([timestamp])
**Sessione**: sid=[sid], v[versione], modello=[model]
**Turno**: promptId=[id], turnIndex=[N]

Timeline del turno:
```
[HH:MM:SS] usage:prompt — [charLength] chars
[HH:MM:SS] usage:tool_call — [toolName] [SUCCESS/FAIL] ([durationMs]ms)
...
[HH:MM:SS] usage:turn_end — [toolCallCount] tools, [responseDurationMs]ms
[HH:MM:SS] usage:feedback — [sentiment] ([issueType])
```

Errori nel turno: [lista o "nessuno"]
Vitals: [normali/anomale + dettagli]
Diagnosi: [1-2 frasi]

## Leading Indicators (errori tool come predittori)
| Tool | Errori (7d) | Error Rate | Correlazione con feedback neg |
|------|-------------|------------|-------------------------------|
| [tool] | N | X% | [sì: N casi / no] |

## Azioni suggerite
| # | Azione | Priorità | Impatto atteso |
|---|--------|----------|----------------|
```

### Protocol 3: Compact Issue Report

```
START → Run 4 queries in parallel:
  1. Crash summary: deduplicate by errorName+errorMessage (7d)
  2. Tool error summary: aggregate by toolName+errorMessage (7d)
  3. Negative feedback summary: group by issueType (7d)
  4. Health metrics: launches, prompts, tool calls, crash rate, error rate (7d)
  │
  ├─ Check Known Issues: mark any matching KI-XXX
  │
  ├─ IF crashes found → add version correlation query
  │
  ├─ IF tool errors found → add error rate query (errors/total per tool)
  │
  └─ IF performance requested → add anomalous heartbeats query
      (eventLoopLagMs > 100 or processHeapMB > 500)
```

**Output template:**

```markdown
# Issue Report — [periodo]

## Health Summary
| Metrica | Valore | Trend |
|---------|--------|-------|
| Avvii app | N | — |
| Prompt utente | N | — |
| Tool call | N | — |
| Crash rate | X% (N/launches) | [↑↓→] |
| Tool error rate | X% (N/calls) | [↑↓→] |
| Feedback negativo | N | — |

## Critical — Crash
[Per ogni firma, formato compatto]
1. **[errorName]: [messaggio]** — N occorrenze, M sessioni
   - Versioni: [lista] | Ultimo: [data] | Known: [KI-XXX o nuovo]
   - Impatto: [breve]

## High — Errori tool ricorrenti
1. **[toolName]** — N errori (X% error rate)
   - Errore: [messaggio] | Sessioni: M | Known: [KI-XXX o nuovo]
   - Azione: [suggerimento]

## Medium — Feedback negativo
1. **[issueType]** — N segnalazioni
   - Pattern: [breve dal drill-down]

## Low — Anomalie performance
1. **[tipo anomalia]** — N sessioni
   - Dettaglio: [breve]

## Priorità intervento
| # | Issue | Sev | Impatto | Effort |
|---|-------|-----|---------|--------|
| 1 | [desc] | Critical | [desc] | [B/M/A] |
```

### Protocol 4: Session Replay

```
START → Need a sid?
  ├─ Have sid → skip to step 2
  └─ Don't have sid → search by symptoms:
      - Crash: query crash events in time window → extract sid
      - Error: query tool_error in time window → extract sid
      - Time-based: query all events in narrow window → pick session
  │
  1. Get system context: usage:app_launch WHERE sid=="[sid]"
  2. Get full timeline: all usage:* events WHERE sid=="[sid]" ORDER BY _time
  3. IF specific turn requested → filter by promptId
  4. IF vitals requested → filter heartbeats ±60s around incident
  5. Flag anomalies inline (errors, lag >100ms, heap >300MB, WS disconnects)
```

### Protocol 5: Tool Error Investigation

```
START → Query tool error landscape (aggregate by toolName, 7d)
  │
  ├─ For each failing tool:
  │   1. Check Known Issues (KI-002, KI-003, KI-004)
  │   2. Calculate error rate (errors / total calls for that tool)
  │   3. IF error rate > 50% → flag as "tool broken"
  │   4. IF error rate < 5% → flag as "tolerable, monitor"
  │   5. Pull error messages for unknown patterns
  │
  └─ Cross-check: do tool errors correlate with negative feedback?
```

## Query Efficiency Rules

1. **Do NOT run getschema first** — you already know the schema from references/schema.md.
   Only run it if a query returns unexpected field errors.
2. **Run independent queries in parallel** — crash summary + tool error summary + feedback
   summary can all run at once for the issue report.
3. **Project early** — always use `| project` with only the fields you need.
4. **Narrow time windows** — start with 24h or 7d, don't scan wider unless needed.
5. **Use the Known Issues database** — if a crash matches KI-001, don't run 9 queries to
   rediscover the same root cause. Confirm the signature, report the count, move on.

## Cross-Correlation (ALWAYS DO THIS)

After completing any investigation, check for connections:
- **After crash investigation** → "Ci sono feedback negativi dalle sessioni con crash?"
- **After feedback drill-down** → "Quali tool errors si verificano nei turni con feedback negativo?"
- **After tool error investigation** → "I tool con più errori compaiono nelle sessioni con feedback negativo o crash?"

This catches systemic issues that single-workflow investigation misses.

## Issue Type Taxonomy (from renderer UI)

| Value | Meaning |
|-------|---------|
| `did_not_follow_request` | Agent ignored the user's instruction |
| `wrong_design_action` | Agent executed a different design action |
| `did_not_use_tools` | Agent talked instead of using Figma tools |
| `not_factually_correct` | Agent made factual errors |
| `incomplete_response` | Agent stopped before completing the task |
| `made_unwanted_changes` | Agent modified things the user didn't ask to change |
| `slow_response` | Response took too long |
| `other` | Uncategorized |
