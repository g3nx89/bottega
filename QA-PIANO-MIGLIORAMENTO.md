# QA Piano di Miglioramento

**Data**: 2026-04-07
**Versione**: 1.1 (post code review — 2026-04-07)
**Contesto**: QA Run 3 ha rivelato che il qa-runner attuale ha 100% PASS rate mentre l'app ha 28 bug aperti. L'automazione massiccia ha aumentato la copertura ma ridotto la profondità. Questo documento definisce il piano per trasformare il pipeline QA da "esecutore cieco" a "sistema di verifica deterministico".

**Effort totale**: 8-11 giorni di lavoro dedicato (aggiornato post-review: Fase 3 da 1 a 2 gg, +1 gg per CI integration)
**Ordine**: Fase 2 (assertion runner) → Fase 4 (instrumentation) → Fase 3 (oracle) → CI wiring

> **Terminologia**: per evitare ambiguità, il documento usa **numeri di fase** (Fase 2, 3, 4) come identificatori univoci. Le sezioni del documento sono numerate 3, 4, 5 in ordine di esecuzione, con cross-reference esplicite: Sezione 3 = Fase 4 (Instrumentation, eseguita seconda), Sezione 4 = Fase 2 (Assertion Runner, eseguita prima), Sezione 5 = Fase 3 (Oracle, eseguita terza).

---

## 1. Executive Summary

### Il problema

I dati di QA Run 3 raccontano una storia chiara:

| Tipo test | Step | PASS | Bug trovati | Bug/ora |
|-----------|------|------|-------------|---------|
| Automated (Pass 1) | 78 | 78 (100%) | 4 | ~5/h |
| UX Review (Pass 2) | 78 rivisti | n/a | 18 | ~180/h |
| Manual (agent Sonnet) | 65 | 53 | 12 (incl. unico Alta) | ~15/h |

**78 step automatizzati hanno trovato 4 bug. 65 step manuali ne hanno trovati 12**, incluso B-018 (judge auto-trigger rotto) — l'unico bug Alta severità della sessione.

Il qa-runner dichiara PASS quando: l'agent risponde senza eccezione, le tool card sono renderizzate, lo screenshot è catturato. Non verifica:
- Se la risposta è **corretta**
- Se le tool call sono **appropriate**
- Se lo state risultante è **quello atteso**
- Se il comportamento è **regredito** rispetto a una baseline

### La soluzione

Quattro fasi incrementali, ognuna con valore standalone:

| Fase | Durata | Sblocca |
|------|--------|---------|
| **Fase 2**: Assertion Runner | 3-5 gg | qa-runner che FAIL quando i bug ci sono |
| **Fase 4**: Instrumentation | 2-3 gg | Stress test finalmente utili |
| **Fase 3**: Pass 2 → Oracle | 2 gg | Regression detection cross-run |
| **Fase 5**: CI Integration | 1 gg | Enforcement automatico, no manual triggering |

### Il nuovo ruolo dei manual test

I manual test non scompaiono: cambiano ruolo. Da "esecuzione scripted" diventano **exploratory missions** mirate, eseguite pre-release o post-bug-fix. Ogni bug trovato manualmente produce un'assertion automatizzata per i run futuri.

---

## 1.1 Design Decisions Verified (post code review)

Questa sezione riporta le decisioni di design verificate rispetto al codice reale, per evitare assumption errate durante l'implementazione.

### DD-1: Env var gating del test mode

**Problema**: Il preload.ts gira in contesto sandboxed Electron. `process.env` nel preload è letto **al build time** (bundled da esbuild), non runtime-dinamico.

**Verifica nel codice**:
- `src/main/preload.ts:255`: esiste già pattern `...(process.env.BOTTEGA_AGENT_TEST ? { ... } : {})`
- `src/main/index.ts:154`: `BOTTEGA_AGENT_TEST` usato per singleton lock bypass
- `src/main/index.ts:174`: `BOTTEGA_AGENT_TEST` usato per WS port assignment (uso diverso)
- `src/main/index.ts:408-409`: `BOTTEGA_AGENT_TEST` gating di test IPC handlers

**Decisione**: Usare **`BOTTEGA_AGENT_TEST`** (pattern esistente) per il gating del `test:get-metrics` handler. Non introdurre un terzo env var. Il pattern funziona perché esbuild legge `process.env.BOTTEGA_AGENT_TEST` a build-time e il binary di preload viene rebuildato quando l'env var cambia — in pratica significa che il test mode si attiva avviando l'app con `BOTTEGA_AGENT_TEST=1 npm start`.

**Impatto sul piano**: ogni riferimento a `BOTTEGA_AGENT_TEST` in questo documento va letto come `BOTTEGA_AGENT_TEST`.

### DD-2: MetricsRegistry via DI, non singleton

**Problema**: Un module-level singleton rompe il pattern DI del codebase (`infra`/`deps` object).

**Verifica nel codice**:
- `src/main/ipc-handlers.ts:283-292`: `createEventRouter` riceve deps via parameter object
- `src/main/session-events.ts:26-29`: `EventRouterDeps` interface con `infra?` optional
- `src/main/tools/index.ts:32-36`: `ToolDeps` con `wsServer`, `operationQueue`, `designSystemCache`, `configManager`

**Decisione**: `MetricsRegistry` è una classe che si istanzia in `src/main/index.ts` e si passa come proprietà di `infra`:
```typescript
// src/main/index.ts
const metricsRegistry = new MetricsRegistry();
const infra: AgentInfra = {
  wsServer, configManager, designSystemCache,
  operationQueue, getImageGenerator, authStorage,
  metricsRegistry,  // ← aggiunto
};
```
Ogni consumer riceve `infra.metricsRegistry` via prop drilling, consistente con il pattern esistente.

### DD-3: Metriche Pi SDK AgentSession

**Verifica**: `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts`:

| Proprietà proposta | Verificato | Note |
|-------------------|-----------|------|
| `slot.session.messages` | ✅ ESISTE (`get messages(): AgentMessage[]`) | `messages.length` utilizzabile |
| `slot.session.contextSize` | ❌ NON ESISTE | Va computato da usage events |

**Decisione**: La metrica `contextSize` va implementata aggiungendo un campo **`slot.lastContextTokens`** (mutabile sul `SessionSlot`). Il valore viene aggiornato in `session-events.ts:159` dove `contextTokens` è già calcolato:

```typescript
// session-events.ts handler for usage events (linea ~159)
const contextTokens = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
slot.lastContextTokens = contextTokens;  // ← aggiungere
```

Richiede modifica a `src/main/slot-manager.ts` per aggiungere il field `lastContextTokens?: number` a `SessionSlot`.

### DD-4: No duplicazione con usage-tracker.ts

**Verifica nel codice**: `src/main/usage-tracker.ts:200` già espone `trackToolCall(toolName, category, success, durationMs, ...)`.

**Decisione**: Il `MetricsRegistry` **NON** duplica `tools.callCounts/errorCounts/durations`. Invece, espone un metodo `snapshot()` su `UsageTracker` che ritorna i counter aggregati (richiede aggiungere metodo `UsageTracker.getSnapshot()`). Il `MetricsRegistry.snapshot()` chiama questo metodo e incorpora il risultato:

```typescript
// MetricsRegistry.snapshot() estratto
tools: deps.usageTracker.getSnapshot(),  // riusa, non duplica
```

Questo elimina il rischio bitrot: una sola fonte di verità per tool metrics.

### DD-5: subagent.activeRuns source

**Decisione**: Rimuovere dalla tabella metriche in v1. Aggiungere in v2 solo se serve per stress test specifici (richiederebbe aggiungere counter al subagent orchestrator, lavoro non in scope).

### DD-6: Assertion DSL parser robustness

**Decisione**: Sostituire il regex fragile con un parser che:
- Matcha fence sia ` ``` ` che `~~~~` con `\s*$` (trailing whitespace tollerato)
- Fa `yaml.parse()` in try/catch
- Logga `[qa-runner] WARN: invalid assertion YAML in ${file}:${stepIndex}: ${err.message}` se fallisce
- FAIL lo step (non SOFT_PASS) se il YAML è malformato — errore loud, non silenzioso

### DD-7: DOM selector stabilità per B-018/B-021

**Verifica**: I selector `#suggestions`, `#bar-judge-btn`, `.assistant-message` sono già usati stabilmente nei manual test di Run 3. Quality Check section è renderizzata dentro `.assistant-message .message-content` quando `judge:verdict` IPC arriva.

**Decisione**: Usare `dom_text_contains` con selector `.assistant-message:last-child .message-content` e pattern "Quality Check" per catturare B-018, invece di un selector dedicato. Meno fragile.

---

## 2. Situazione attuale

### Cosa funziona

- **Playbook tests (vitest)** — 15 test deterministici da recording QA, 64 assertion, tutti PASS
- **Pass 2 UX Review (Opus)** — cattura qualitativo con rate di 180 bug/ora, identifica pattern ricorrenti
- **Log monitor** — cattura anomalie runtime (API errors, WS disconnects, slow ops)
- **Infrastruttura di launch/orchestration** — helpers.mjs, qa-runner parser, subagent coordination

### Cosa non funziona

- **qa-runner PASS criterion** — "no exception" non verifica alcunché di funzionale
- **Nessuna verifica di state** — il runner non legge il canvas Figma né lo stato interno dell'app
- **Nessuna baseline** — ogni run è isolato, impossibile detectare regressioni
- **Coverage di test rotto** — 100% PASS rate con 28 bug aperti è la prova
- **Stress test inutilizzabili** — durano 25 min ciascuno, nessuna metric di osservabilità

### Bug noti che devono guidare il design

Questi bug NON sono stati catturati dall'automazione attuale. Il nuovo sistema deve catturarli:

- **B-018** (Alta) — Judge auto-trigger non si attiva dopo mutazioni (root cause: `slot.fileKey` null → connector null → skip silenzioso)
- **B-021** (Media) — Suggestion chips mai visibili dopo risposte agent
- **B-025** (Media) — Model per-tab non persistito al restart
- **B-022** (Bassa) — Task panel count non resettato su New Chat
- **B-023** (Bassa) — Cross-tab file context mismatch

---

## 3. Fase 4 — Instrumentation runtime (2-3 giorni)

> **Da eseguire per prima**: Fase 2 dipende da queste metriche per le assertion `metric:*`. Saltarla significa scrivere assertion che leggono solo il DOM.

### 3.1 Obiettivo

Esporre via IPC un set di metriche strutturate sullo stato interno dell'app, leggibili dal test runner. Le metriche devono essere deterministiche, leggere (<10ms overhead), versioned.

### 3.2 Set di metriche

| Metric | Tipo | Source | Use case |
|--------|------|--------|----------|
| `memory.heapUsed` | gauge (bytes) | `process.memoryUsage()` | Memory leak detection |
| `memory.rss` | gauge (bytes) | `process.memoryUsage()` | Process bloat |
| `slots[].id` | string | `slotManager` | Identifier |
| `slots[].fileKey` | string\|null | `slot.fileKey` | **Cattura root cause B-018** |
| `slots[].isStreaming` | bool | `slot.isStreaming` | State machine |
| `slots[].contextTokens` | int | `slot.lastContextTokens` (nuovo campo, vedi DD-3) | Saturation tracking |
| `slots[].messageCount` | int | `slot.session.messages.length` (Pi SDK, verificato) | Session depth |
| `slots[].queueDepth` | int | `slot.promptQueue.length` | Queue under load |
| `slots[].judgeOverride` | enum | `slot.judgeOverride` | Toggle state |
| `slots[].modelProvider` | string | `slot.modelConfig.provider` | Model assignment |
| `slots[].modelId` | string | `slot.modelConfig.modelId` | Model assignment |
| `slots[].turnCount` | int | counter incrementato | Session length |
| `slots[].taskCount` | int | `slot.taskStore?.size` | Task panel state (B-022) |
| `judge.activeRuns` | gauge | `judgeInProgress.size` | Judge concurrency |
| `judge.totalTriggers` | counter | incrementato in session-events | Coverage |
| `judge.totalSkipped` | counter | incrementato quando connector null | **Cattura B-018** |
| `judge.skipReasons` | object | `{reason: count}` | Diagnostica |
| `tools.*` | object | **Delegato a `UsageTracker.getSnapshot()`** (vedi DD-4) | Tool usage stats (no duplicate tracking) |
| `ws.connectedFiles` | int | `wsServer.getConnectedFiles().length` | Bridge state |
| `ws.fileKeys` | string[] | `wsServer.getConnectedFiles()` | Connected files |
| ~~`subagent.activeRuns`~~ | — | **Rimosso in v1** (vedi DD-5) | Rimandato a v2 |

### 3.3 Deliverables

1. `src/main/metrics-registry.ts` — singleton collector
2. IPC handler `test:get-metrics` (gated su `BOTTEGA_AGENT_TEST=1`)
3. IPC handler `test:reset-metrics`
4. Preload bridge `window.api.testMode.getMetrics()`
5. Helper `tests/helpers/metrics-client.mjs` per il runner
6. Documentazione schema in `docs/test-metrics-schema.md`
7. Unit test: `tests/unit/main/metrics-registry.test.ts`

### 3.4 Task breakdown

#### Day 1: MetricsRegistry + collection points

**Task 4.1** — Creare `src/main/metrics-registry.ts` con classe `MetricsRegistry` (**no singleton** — DI via `infra`, vedi DD-2). Include metodi:
- `recordJudgeTriggered()`
- `recordJudgeSkipped(reason: string)`
- `recordTurn(slotId: string)`
- `snapshot(deps): MetricsSnapshot`
- `reset()`

**Non include** `recordToolCall` — tool metrics sono delegate a `UsageTracker.getSnapshot()` (vedi DD-4).

**Integration nel codebase**:
```typescript
// src/main/index.ts (dove infra è costruito)
const metricsRegistry = new MetricsRegistry();
const infra: AgentInfra = {
  wsServer, configManager, designSystemCache,
  operationQueue, getImageGenerator, authStorage,
  metricsRegistry,  // ← aggiungere al type AgentInfra in agent.ts
};
```

**Modifica richiesta a `src/main/agent.ts`**: aggiungere `metricsRegistry: MetricsRegistry` al type `AgentInfra`.

**Task 4.2** — Wire up nei punti di raccolta. Tutti gli hook accedono a `deps.infra.metricsRegistry` (no module singleton):

| File | Riga (verificata) | Hook |
|------|-------------------|------|
| `src/main/session-events.ts` | ~159 | `slot.lastContextTokens = contextTokens` (aggiunge campo, vedi DD-3) |
| `src/main/session-events.ts` | ~248 | `deps.infra?.metricsRegistry?.recordTurn(slot.id)` dopo check `shouldRun` |
| `src/main/session-events.ts` | ~251 | `deps.infra?.metricsRegistry?.recordJudgeTriggered()` prima di `runJudgeHarness` |
| `src/main/session-events.ts` | ~250 (else branch nuovo) | `metricsRegistry.recordJudgeSkipped(slot.fileKey ? 'no-mutations' : 'no-fileKey')` |
| `src/main/slot-manager.ts` | interface `SessionSlot` | aggiungere campo `lastContextTokens?: number` |
| `src/main/agent.ts` | interface `AgentInfra` | aggiungere `metricsRegistry: MetricsRegistry` |

**Nessuna modifica a `compression/extension-factory.ts`** — tool metrics delegate a `UsageTracker` (DD-4).

**Task 4.3** — Unit test base (Vitest): verifica che snapshot ritorni JSON valido conforme a schema.

#### Day 2: IPC handler + preload + helper API

**Task 4.4** — Aggiungere IPC handler in `src/main/ipc-handlers.ts` (pattern consistente con gating esistente a ipc-handlers.ts:408-409 e preload.ts:255):

```typescript
if (process.env.BOTTEGA_AGENT_TEST) {
  ipcMain.handle('test:get-metrics', () =>
    infra.metricsRegistry.snapshot({
      slotManager,
      wsServer: infra.wsServer,
      usageTracker,  // per DD-4: tool metrics delegate
      judgeInProgress: getJudgeInProgressSet(),  // export da session-events
    }),
  );
  ipcMain.handle('test:reset-metrics', () => {
    infra.metricsRegistry.reset();
    return { success: true };
  });
}
```

Note:
- Il check `process.env.BOTTEGA_AGENT_TEST` (no `=== '1'`) segue il pattern esistente in index.ts:154 e preload.ts:255 (truthy check).
- `getJudgeInProgressSet()` richiede export da `session-events.ts` (nuova funzione che ritorna `judgeInProgress` Set).

**Task 4.5** — Aggiungere preload bridge in `src/main/preload.ts`, estendendo il pattern esistente a riga 255:

```typescript
// In src/main/preload.ts — estendere il blocco esistente BOTTEGA_AGENT_TEST
...(process.env.BOTTEGA_AGENT_TEST
  ? {
      __testFigmaExecute: (code: string, timeoutMs?: number, fileKey?: string) =>
        ipcRenderer.invoke('test:figma-execute', code, timeoutMs, fileKey),
      // ── Aggiunte Fase 4 ──
      __testGetMetrics: () => ipcRenderer.invoke('test:get-metrics'),
      __testResetMetrics: () => ipcRenderer.invoke('test:reset-metrics'),
    }
  : {}),
```

**Convenzione**: i metodi usano prefisso `__test` come `__testFigmaExecute` già esistente. Il helper runtime espone API più leggibili (vedi Task 4.6).

**Importante**: `process.env.BOTTEGA_AGENT_TEST` nel preload è letto **al build time** (esbuild bundling). Per abilitare il test mode, avviare con `BOTTEGA_AGENT_TEST=1 npm run build && BOTTEGA_AGENT_TEST=1 npm start`. Questo è consistente con come il pattern esistente funziona oggi.

**Task 4.6** — Creare `tests/helpers/metrics-client.mjs` con:
- `getMetrics(page)` — snapshot corrente (wraps `window.api.__testGetMetrics()`)
- `resetMetrics(page)` — reset counters
- `waitForMetric(page, predicate, opts)` — polling fino a condizione
- `snapshotMetrics(page, label)` — snapshot con label per diff
- `diffMetrics(before, after)` — compute delta
- `recordMetricsTimeline(page, durationMs, intervalMs)` — per stress test

Esempio:
```javascript
export async function getMetrics(page) {
  return await page.evaluate(() =>
    /** @type {any} */ (window.api).__testGetMetrics?.() ?? null
  );
}
```

Il null check su `__testGetMetrics` previene crash se test mode non è abilitato, facilitando il debug ("BOTTEGA_AGENT_TEST not set — metrics unavailable").

#### Day 3: Documentation + validation

**Task 4.7** — Creare `docs/test-metrics-schema.md`:
- Schema JSON commentato
- Esempi di snapshot
- Casi d'uso (memory leak, judge coverage, queue saturation)
- Versioning rules

**Task 4.8** — Verificare performance: snapshot deve essere <10ms. Misurare con `performance.now()` in un test.

**Task 4.9** — Verificare gating: senza `BOTTEGA_AGENT_TEST=1`, `window.api.testMode` deve essere `undefined`.

### 3.5 Acceptance criteria Fase 4

- [ ] `BOTTEGA_AGENT_TEST=1 npm run build && BOTTEGA_AGENT_TEST=1 npm start` espone `window.api.__testGetMetrics()`
- [ ] In production build (no env var al build time), `window.api.__testGetMetrics` è `undefined`
- [ ] Snapshot ritorna JSON conforme a schema (versione `schemaVersion: 1`)
- [ ] `judge.totalSkipped` incrementa quando `slot.fileKey` è null (cattura B-018)
- [ ] `slot.lastContextTokens` è aggiornato dopo ogni usage event
- [ ] Tool metrics sono esposte via `UsageTracker.getSnapshot()` (no duplicazione)
- [ ] Snapshot completo <10ms in test locale (misurato con `performance.now()`)
- [ ] Unit test passa: `tests/unit/main/metrics-registry.test.ts`
- [ ] `infra.metricsRegistry` è null-safe: app funziona normalmente anche se `BOTTEGA_AGENT_TEST` non è settato (con `metricsRegistry` stub no-op)

### 3.6 Rischi e mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Schema drift cross-version | Versionare con `schemaVersion`, mai breaking change |
| Performance overhead in production | Gating su `BOTTEGA_AGENT_TEST` env var al build time, stub no-op in production |
| Memory leak nel collector stesso | `reset()` chiamato a slot removal; `Map` mai unbounded |
| ~~Conflitto con remote-logger~~ ~~MetricsRegistry separato~~ | **Risolto via DD-4**: tool metrics delegate a `UsageTracker`, no duplicazione |
| Rebuild richiesto per test mode | Documentato: `BOTTEGA_AGENT_TEST=1 npm run build` una volta, poi start normali |

---

## 4. Fase 2 — Assertion Runner (3-5 giorni)

> **Dipende da Fase 4** per le assertion `metric:*`.

### 4.1 Obiettivo

Sostituire il PASS criterion attuale ("no exception") con un sistema di assertion dichiarative per ogni step. Lo step diventa PASS solo se TUTTE le assertion valutano true.

### 4.2 Assertion DSL

**Sintassi**: code block YAML dopo ogni step, prefissato con marker ` ```assert `:

````markdown
### 4. Send a creation prompt
Send: "Create a blue button with the text 'Click Me', 200x60 pixels with rounded corners"

**Evaluate:**
- Does the agent use an appropriate creation tool?

```assert
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
tools_NOT_called_more_than:
  figma_status: 1
response_contains_any: [created, button, blue]
response_NOT_contains: [I can't, disconnect, not connected]
screenshots_min: 1
duration_max_ms: 90000
metric:
  path: judge.totalTriggers
  op: '>'
  sinceStep: start
  value: 0
```
````

### 4.3 Assertion types

| Type | Sintassi | Verifica |
|------|----------|----------|
| `tools_called` | `[tool1, tool2]` | Tutti chiamati (AND) |
| `tools_called_any_of` | `[tool1, tool2]` | Almeno uno (OR) |
| `tools_NOT_called` | `[tool1, tool2]` | Nessuno chiamato |
| `tools_NOT_called_more_than` | `{tool: max}` | Max N volte |
| `tools_called_in_order` | `[t1, t2, t3]` | Sequence |
| `response_contains` | `[str1, str2]` | AND case-insensitive |
| `response_contains_any` | `[str1, str2]` | OR case-insensitive |
| `response_NOT_contains` | `[str1, str2]` | Nessuna presente |
| `response_min_chars` | `int` | Lunghezza minima |
| `response_max_chars` | `int` | Lunghezza massima |
| `screenshots_min` | `int` | Almeno N screenshot |
| `duration_max_ms` | `int` | Completato entro N ms |
| `dom_visible` | `selector` | Elemento visibile |
| `dom_NOT_visible` | `selector` | Elemento nascosto |
| `dom_class_present` | `{selector: class}` | Classe presente |
| `dom_text_contains` | `{selector: text}` | Testo contenuto |
| `context_increased` | `bool` | Context bar aumentata |
| `judge_section_present` | `bool` | Quality Check section visibile |
| `metric` | `{path, op, value}` | Valore metric matches |
| `metric_growth` | `{path, maxGrowth, sinceStep}` | Crescita entro limite |
| `error_thrown` | `bool` | Eccezione catturata (negative test) |

### 4.4 Deliverables

1. `tests/qa-scripts/ASSERTION-DSL.md` — spec del DSL con esempi
2. `.claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs` — evaluator per ogni type
3. `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` — refactor per parse+execute assertion
4. 5 script migrati: 02, 04, 09, 11, 14
5. `tests/unit/qa-tooling/assertion-evaluators.test.ts` — unit test degli evaluator
6. Output strutturato `/tmp/bottega-qa/NN-assertions.json`

### 4.5 Task breakdown

#### Day 1: Design + DSL spec

**Task 2.1** — Scrivere `tests/qa-scripts/ASSERTION-DSL.md`:
- Grammatica completa
- Esempi per ogni type
- Best practices (quando usare strict vs permissive)
- Migration guide dai blocchi "Evaluate" legacy

**Task 2.2** — Migrare manualmente Script 02 come esempio pilota. Deve:
- Avere assertion per tutti gli step automatizzabili (steps 3-7)
- Produrre almeno 2 FAIL sull'app attuale (B-021 suggestion chips, judge section)

**Task 2.3** — Review e approvazione del DSL prima di procedere.

#### Day 2: Assertion evaluators

**Task 2.4** — Creare `assertion-evaluators.mjs` con signature:

```javascript
/**
 * @param {StepData} stepData - { toolsCalled, responseText, screenshotCount, durationMs, page, metricsBefore, metricsAfter }
 * @param {Object} assertions - parsed YAML block
 * @returns {AssertionResult[]} - array di { passed, message, type }
 */
export function evaluateStep(stepData, assertions) { ... }
```

**Task 2.5** — Implementare i 20 assertion types. Ordinare per priorità:
1. Priority 1 (per MVP): `tools_called`, `tools_called_any_of`, `response_contains`, `response_NOT_contains`, `metric`, `dom_visible`
2. Priority 2: `tools_NOT_called_more_than`, `duration_max_ms`, `screenshots_min`, `dom_class_present`
3. Priority 3: il resto

**Task 2.6** — Unit test `tests/unit/qa-tooling/assertion-evaluators.test.ts`:
- Happy path per ogni assertion type **implementato in MVP** (Priority 1: 6 tipi)
- Edge cases: empty arrays, null values, missing metrics
- Case-insensitivity per string matching
- Target MVP: ≥18 test (3 per ognuno dei 6 P1 tipi: happy, edge, negative)
- Target post-MVP (quando P2+P3 vengono implementati): ≥60 test, coverage ≥80% dei 20 tipi

**Nota sulla inconsistency**: il piano originale diceva "≥80% di 20 tipi" nell'MVP — questo era inconsistente con "6 tipi P1 per MVP". La metrica corretta per MVP è: 100% copertura sui 6 P1 tipi. I P2/P3 si aggiungono progressivamente.

#### Day 3: Refactor qa-runner

**Task 2.7** — Aggiungere `parseAssertionBlock(stepBody)` al parser (vedi DD-6 per la robustness):

```javascript
import { parse as parseYaml } from 'yaml';

/**
 * Parse an assertion YAML block from a step body.
 * @returns {Object | null | 'invalid'} — null if no block, 'invalid' if YAML parse error
 */
function parseAssertionBlock(stepBody, stepContext) {
  // Tollera trailing whitespace sia su ``` che ~~~~
  const match = stepBody.match(/(?:```|~~~~)assert\s*\n([\s\S]*?)\n(?:```|~~~~)\s*$/m);
  if (!match) return null;

  try {
    const parsed = parseYaml(match[1]);
    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`[qa-runner] ERROR: assertion block in ${stepContext} is not an object: ${typeof parsed}`);
      return 'invalid';
    }
    return parsed;
  } catch (err) {
    console.error(`[qa-runner] ERROR: invalid assertion YAML in ${stepContext}: ${err.message}`);
    return 'invalid';
  }
}
```

**Importante**: quando il parser ritorna `'invalid'`, lo step viene marcato **FAIL** (non SOFT_PASS). Errore loud, non silenzioso. Gli script legacy senza blocco assert ritornano `null` → SOFT_PASS (backward compat).

**Task 2.8** — Capture dei dati durante step execution:
- `toolsCalled`: estratto da `state.toolCards.map(tc => tc.name)`
- `metricsBefore`: snapshot prima dello step (da Fase 4)
- `metricsAfter`: snapshot dopo lo step
- `page`: reference Playwright per DOM evaluators

**Task 2.9** — PASS/FAIL logic con backward compat:

```javascript
let stepStatus;
if (hasAssertions) {
  stepStatus = allPassed ? 'PASS' : 'FAIL';
} else {
  stepStatus = result.success ? 'SOFT_PASS' : 'FAIL';  // legacy mode
}
```

#### Day 4: Migration + reporting

**Task 2.10** — Migrare i 4 script rimanenti: 04, 09, 11, 14. Priorità basata sui bug catturati:
- 02: B-021 (suggestion chips), B-018 (judge section)
- 04: abort, queue, cross-tab
- 09: styling, batch operations
- 11: B-016 (auto-place), B-013 (restore)
- 14: B-018 (judge auto-trigger) in profondità

Stima: ~30-60 min per script.

**Task 2.11** — Output reporting strutturato:

```json
{
  "script": "02-happy-path",
  "totalSteps": 8,
  "automatedSteps": 7,
  "passed": 5,
  "failed": 2,
  "softPassed": 0,
  "manual": 1,
  "failures": [
    {
      "step": 4,
      "stepTitle": "Send a creation prompt",
      "failedAssertions": [
        {
          "type": "judge_section_present",
          "expected": true,
          "actual": false,
          "message": "Quality Check section not found — possible B-018 regression"
        }
      ]
    }
  ]
}
```

**Task 2.12** — Update result-NN.txt con summary delle failures:

```
Script 02 — Happy Path
Total: 8 steps (7 automated, 1 manual)
PASS: 5 | FAIL: 2 | SOFT_PASS: 0

FAILURES:
  Step 4: judge_section_present expected true, was false (B-018?)
  Step 7: dom_visible '#suggestions' expected true, was false (B-021?)
```

#### Day 5 (buffer): End-to-end + iterazione

- Eseguire pipeline contro app pre-fix (deve FAIL su bug noti)
- Eseguire pipeline post-fix (deve PASS)
- Verificare backward compat con script non migrati
- Documentare migration workflow in `tests/qa-scripts/README.md`

### 4.6 Acceptance criteria Fase 2

- [ ] Almeno 1 script (02) ha assertion eseguibili al 100% delle check
- [ ] qa-runner produce FAIL specifici con messaggi actionable
- [ ] Script senza assertion restano SOFT_PASS (no break)
- [ ] Script **con assertion YAML malformato** diventano FAIL (non SOFT_PASS) con error loud
- [ ] Script 02 contro app attuale produce ≥2 FAIL noti (B-021, judge-related)
- [ ] Script 14 contro app attuale produce FAIL su B-018 via `dom_text_contains` su "Quality Check" (DD-7)
- [ ] 5 script migrati e funzionanti
- [ ] Unit test evaluator: 100% dei 6 P1 tipi (target MVP), non 80% dei 20 tipi

### 4.7 Rischi e mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Assertion troppo strette → false positive | Soglie permissive iniziali, **calibration step obbligatorio** (vedi 4.8) |
| Migration di 19 script è troppo lavoro | Migrare solo i 5 prioritari, altri in SOFT_PASS |
| DOM selectors fragili | Documentare selector stabili, usare data-test attributes |
| YAML parsing → dipendenza nuova | Usare `yaml` package (già transitive in node_modules) |
| LLM non-determinism: stesso prompt → tool diversi | `tools_called_any_of` invece di `tools_called` per tool intercambiabili; calibration step 4.8 |
| Selector DOM cambia tra release | Usare `dom_text_contains` invece di selector specifici dove possibile (DD-7) |
| Regression false positive blocca CI | Rollback strategy documentata in 4.9 |

### 4.8 Calibration step (nuovo, obbligatorio prima di blocking)

**Problema**: Run multipli dello stesso script possono produrre tool call diversi (es. `render_jsx` vs `execute`) per lo stesso prompt. Le assertion `tools_called` produrrebbero false positive.

**Procedura di calibration**:

1. **Eseguire ogni script migrato 3 volte consecutive** contro un'app version fissa (git SHA noto)
2. **Identificare variance** nelle tool call e nelle response:
   - Quali tool sono STABILI (chiamati in 3/3 run) → OK per `tools_called`
   - Quali tool sono INTERCAMBIABILI (2/3 o 1/3) → usare `tools_called_any_of`
   - Quali response string sono STABILI → OK per `response_contains`
3. **Documentare calibration** in `tests/qa-scripts/CALIBRATION.md`:
   ```markdown
   ## Script 02 — calibration notes (2026-04-07)
   - Step 4 creation: render_jsx chiamato 3/3 run → stable
   - Step 4 screenshot: 1-2 screenshot chiamate → variance, usare `screenshots_min: 1`
   - Response contains "created": 3/3 stable
   ```
4. **Rivedere assertion** basandosi sui dati reali, non su intuizione
5. Ripetere per ogni script migrato prima di considerarlo "production-ready"

**Costo**: ~15 min per script × 5 script = 1.25 ore aggiuntive durante Day 4. Non trivial, ma previene settimane di debug false positive.

### 4.9 Rollback strategy

**Se Fase 2 in produzione genera >20% false positive**:

1. **Rollback per-script**: rimuovere il blocco ```assert``` dallo script — torna automaticamente in SOFT_PASS (backward compat)
2. **Rollback globale**: impostare env var `QA_RUNNER_LEGACY_MODE=1`; il runner ignora TUTTI i blocchi assert e usa il criterio legacy
3. **Debug diagnostico**: il runner logga ogni assertion FAIL con actual vs expected. Facile triare quali sono regression e quali sono miscalibration.
4. **Recalibration rapida**: un singolo run in modalità `--recalibrate` raccoglie i valori effettivi e propone aggiornamenti alle assertion (emit diff in `/tmp/bottega-qa/calibration-diff.md`)

**Workflow rollback per uno script**:
```bash
# Rimuovere assertion da uno script problematico
sed -i.bak '/^```assert$/,/^```$/d' tests/qa-scripts/02-happy-path.md
# Re-run per verificare
node qa-runner.mjs --script 02
```

---

## 5. Fase 3 — Pass 2 da Review a Oracle (2 giorni)

> **Nota**: aggiornato da 1 a 2 giorni post-review. Il prompt engineering per ottenere JSON strutturato stabile da Opus richiede iterazione empirica, non è feasible in single-pass.

### 5.1 Obiettivo

Trasformare Pass 2 da "markdown bello" a "verdetti machine-readable + diff vs baseline + blocking decisions".

### 5.2 Deliverables

1. `tests/baselines/ux-review.schema.json` — JSON schema
2. Update del prompt ux-reviewer per forzare output JSON
3. `.claude/skills/bottega-dev-debug/scripts/validate-ux-review.mjs` — schema validator
4. `.claude/skills/bottega-dev-debug/scripts/ux-baseline-diff.mjs` — regression detector
5. `tests/baselines/ux-baseline.json` — baseline versionato in git
6. Integrazione nel comando `/qa` skill

### 5.3 Schema JSON

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["runId", "timestamp", "overallScore", "scriptScores", "issues"],
  "properties": {
    "runId": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "appVersion": { "type": "string" },
    "overallScore": { "type": "number", "minimum": 1, "maximum": 5 },
    "scriptScores": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["score", "stepCount", "issueCount"],
        "properties": {
          "script": { "type": "string" },
          "score": { "type": "number" },
          "stepCount": { "type": "integer" },
          "issueCount": { "type": "integer" },
          "dimensionScores": {
            "type": "object",
            "properties": {
              "visualQuality": { "type": "number" },
              "responseClarity": { "type": "number" },
              "toolSelection": { "type": "number" },
              "uxCoherence": { "type": "number" },
              "feedbackQuality": { "type": "number" }
            }
          }
        }
      }
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "severity", "script", "step", "description"],
        "properties": {
          "id": { "type": "string", "pattern": "^UX-[a-f0-9]{8}$" },
          "severity": { "enum": ["alta", "media", "bassa"] },
          "script": { "type": "string" },
          "step": { "type": "integer" },
          "description": { "type": "string" },
          "category": {
            "enum": ["tool_selection", "response_quality", "visual", "feedback", "performance"]
          }
        }
      }
    }
  }
}
```

### 5.4 Task breakdown

#### Day 1: Schema + prompt iteration

**Task 3.1** — Definire schema JSON in `tests/baselines/ux-review.schema.json`.

**Task 3.2** — Update del prompt ux-reviewer nel comando QA skill. **Iterazione empirica richiesta**: eseguire almeno 3 run consecutivi contro gli stessi screenshot/metadata per verificare la stability dei score (variance attesa <0.3 per dimensione). Se la variance è troppo alta, raffinare il prompt.

```
CRITICAL: Output your review as TWO files:
1. /tmp/bottega-qa/ux-review.md — human-readable markdown (existing format)
2. /tmp/bottega-qa/ux-review.json — machine-readable JSON conforming to schema

For each issue:
- Generate stable ID: UX-<sha1(script+step+description)[:8]>
- Map severity to alta/media/bassa
- Categorize using the enum

Score each script on 5 dimensions (1-5):
- visualQuality, responseClarity, toolSelection, uxCoherence, feedbackQuality

Overall script score = avg of 5 dimensions.
Overall pipeline score = avg of script scores (manual-only excluded).

Be as deterministic as possible. Same input should produce same scores
within ±0.2 variance per dimension.
```

**Nota tecnica**: Il Pi SDK agent non espone `temperature` come parametro diretto per Opus. L'istruzione "be deterministic" è guidance, non un parametro API. Per questo serve calibrazione empirica (Task 3.2a).

**Task 3.3** — Creare `validate-ux-review.mjs`:

```javascript
#!/usr/bin/env node
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync('tests/baselines/ux-review.schema.json'));
const review = JSON.parse(readFileSync(process.argv[2]));

const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(review)) {
  console.error('Invalid UX review:', validate.errors);
  process.exit(1);
}
console.log('UX review JSON valid ✓');
```

**Task 3.2a** — Calibrazione empirica variance (nuovo, Day 1 pomeriggio):
- Eseguire Pass 2 3× sui medesimi screenshot
- Misurare variance tra run per ogni script (per-dimension std deviation)
- Se variance > 0.3 su qualsiasi dimensione, rivedere prompt e ripetere
- Documentare la variance misurata in `tests/baselines/ux-variance-baseline.md` per riferimento futuro
- **La soglia di regression (`REGRESSION_OVERALL = 0.3`) deve essere > della variance misurata** per evitare false positive da rumore

#### Day 2: Baseline + diff + integration

**Task 3.4** — Creare `ux-baseline-diff.mjs`:

Logica principale:
- Se `--update-baseline`: copia current come nuovo baseline
- Altrimenti: carica baseline, computa diff, stampa report
- Exit code 0 = no regression, 1 = regression, 2 = baseline missing

Soglie di regression:
- `REGRESSION_OVERALL = 0.3` (score complessivo)
- `REGRESSION_SCRIPT = 0.5` (per-script)

**Task 3.5** — Integrazione nel pipeline QA:

```bash
# Step 3: Quality gates
node .claude/skills/bottega-dev-debug/scripts/validate-ux-review.mjs /tmp/bottega-qa/ux-review.json || exit 1
node .claude/skills/bottega-dev-debug/scripts/ux-baseline-diff.mjs /tmp/bottega-qa/ux-review.json
DIFF_EXIT=$?
if [ $DIFF_EXIT -eq 1 ]; then
  echo "❌ UX REGRESSION DETECTED"
  exit 1
fi
```

**Task 3.6** — Bootstrapping del baseline (dopo Fase 2 stabile):

```bash
node ux-baseline-diff.mjs --update-baseline /tmp/bottega-qa/ux-review.json
git add tests/baselines/ux-baseline.json
git commit -m "qa: establish UX baseline from Run 4"
```

### 5.5 Acceptance criteria Fase 3

- [ ] Pass 2 produce JSON conforme a schema
- [ ] Baseline persistito in `tests/baselines/ux-baseline.json` (versionato in git)
- [ ] Diff vs baseline stampa report con delta e new/fixed issues
- [ ] Pipeline ha exit 1 se regression detected
- [ ] Workflow `--update-baseline` documentato

### 5.6 Rischi e mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Opus ID non stabili cross-run | SHA1 deterministico di script+step+description normalized |
| Score variance ±0.2 per stessi screenshot | Calibration empirica (Task 3.2a), soglia regression > variance misurata |
| Baseline stale quando l'app migliora | Workflow esplicito `--update-baseline` con review umana |

---

## 5.5 Fase 5 — CI Integration (1 giorno, NEW)

> Aggiunto post-review. Senza CI, il pipeline continua a girare solo quando un umano lo lancia — lo stesso failure mode di oggi.

### 5.5.1 Obiettivo

Wireare il pipeline QA assertion-based in GitHub Actions come workflow nightly con baseline enforcement.

### 5.5.2 Deliverables

1. `.github/workflows/qa-nightly.yml` — workflow GitHub Actions
2. `.github/workflows/qa-on-demand.yml` — workflow manuale via `workflow_dispatch`
3. Update `README.md` con status badge
4. Documentazione troubleshooting in `docs/qa-ci.md`

### 5.5.3 Task breakdown

**Task 5.1** — Workflow nightly (`.github/workflows/qa-nightly.yml`):
- Trigger: `schedule: cron '0 3 * * *'` (3am UTC ogni notte)
- Runner: `macos-latest` (Electron + Figma Desktop dependency)
- Steps:
  1. Checkout + `npm ci`
  2. `BOTTEGA_AGENT_TEST=1 npm run build`
  3. Launch Figma Desktop Bridge in test mode (TBD: mock o real)
  4. Execute: `node qa-runner.mjs --suite pre-release`
  5. Execute: validate-ux-review + ux-baseline-diff
  6. Upload artifacts: `/tmp/bottega-qa/*.json`, screenshots
  7. Exit 1 se assertion FAIL o UX regression

**Task 5.2** — Workflow on-demand (`.github/workflows/qa-on-demand.yml`):
- Trigger: `workflow_dispatch` con input `suite` (smoke/pre-release/full/stress)
- Resto identico al nightly ma con suite parametrica

**Task 5.3** — Baseline update workflow:
- Trigger: `workflow_dispatch` con confirmation input
- Steps:
  1. Run full pipeline
  2. Copy ux-review.json → ux-baseline.json
  3. Commit + push con messaggio `chore: update UX baseline from CI run ${GITHUB_SHA}`
  4. Richiede approval manuale

**Task 5.4** — Status badge + docs:
- Badge in README: `![QA](https://github.com/.../actions/workflows/qa-nightly.yml/badge.svg)`
- Doc: come debuggare CI failures (download artifacts, leggere `/tmp/bottega-qa/` locali, riprodurre)

### 5.5.4 Acceptance criteria Fase 5

- [ ] Workflow nightly eseguito su CI con success rate ≥80% nelle prime 2 settimane
- [ ] Workflow on-demand permette di lanciare suite arbitrarie
- [ ] Baseline update workflow richiede approval manuale (no auto-bless)
- [ ] Badge in README mostra status corrente
- [ ] Documentazione troubleshooting pubblicata

### 5.5.5 Rischi

| Rischio | Mitigazione |
|---------|-------------|
| macOS runner costoso (~$0.08/min × 50min × 30 run = ~$120/mese) | Accettabile per una pre-release weekly; smoke test possono girare su Linux |
| Figma Desktop Bridge non disponibile in CI | Fase iniziale: skip script che richiedono Bridge reale; investigate virtual display per future |
| Flakiness da LLM non-determinism | Allow-list di retry (max 2) per test che falliscono una volta |

---

## 6. Posizionamento dei Manual Test post-fasi

### 6.1 Il cambio di ruolo

I manual test agent-driven (eseguiti oggi con qa-tester Sonnet) **non scompaiono**, ma **cambiano ruolo**:

| Oggi | Post Fase 2-4 |
|------|---------------|
| Backbone della scoperta bug | Scout in territorio sconosciuto |
| Esecuzione scripted di ogni step | Missioni esplorative mirate |
| Eseguiti ad ogni QA run | Eseguiti pre-release o post-bug-fix |
| 65 step per run | 30-60 min per missione |
| Trovano i bug | Trovano NUOVI bug classes (poi diventano assertion) |

### 6.2 Tassonomia finale dei test

| Tier | Strumento | Cosa testa | Quando | Costo |
|------|-----------|-----------|--------|-------|
| **T1: Unit** | vitest playbook | Tool correctness, IPC handlers | Pre-commit, CI per PR | Centesimi |
| **T2: Assertion** | qa-runner + assertions | Behavior flow + state transitions | Pre-release, CI nightly | ~$1-2/run |
| **T3: Oracle** | Pass 2 (Opus) structured | Quality giudizio | Pre-release | ~$3-5/run |
| **T4: Manual exploratory** | Sonnet agent | Discovery, edge cases | Pre-major-release, post-bug | ~$5-15/run |

### 6.3 Cosa NON dovranno più fare i manual test

~70% dello scope attuale passa al runner deterministico:

| Task di oggi | Sostituito da |
|-------------|---------------|
| Verificare che `#bar-judge-btn` toggla la classe `active` | Assertion `dom_class_present` |
| Verificare che context bar mostra >0K dopo prompt | Assertion `metric: slot.contextSize > 0` |
| Verificare N tool chiamati in ordine | Assertion `tools_called_in_order` |
| "Click bottone, verifica apre menu" | Assertion `dom_visible` |
| Capture screenshot per Pass 2 | Pass 1 automatico già lo fa |

### 6.4 Cosa SOLO i manual test possono fare

#### 1. Discovery di nuovi bug class

Bug come B-018 sono stati scoperti perché un agent ha **notato l'assenza di qualcosa che si aspettava di vedere**. Assertion runner cattura solo ciò che gli dici di cercare.

#### 2. Multi-restart / multi-state scenarios

Test tipo "chiudi app, riapri, verifica persistence" sono fragili da automatizzare. Un agent li gestisce con resilienza naturale.

#### 3. Free-form exploratory testing

> "Prova a rompere il prompt queue in 5 modi diversi"

Adversarial testing. L'agent improvvisa combinazioni che nessuno script copre.

#### 4. Judgment validation cross-run

> "L'agent ha scelto i tool giusti? Le risposte sono migliorate?"

Pass 2 oracle cattura parte di questo ma solo da screenshot statici. Un exploratory agent può **interagire** e fare follow-up.

### 6.5 Workflow manual test exploratorio

**Format del brief** (non più script):

```markdown
# Manual Exploratory Mission: Judge Auto-Trigger Reliability

## Context
B-018 was just fixed (commit abc1234). The judge auto-trigger should now fire
when slot.fileKey is set and a mutation tool is used.

## Mission
Validate the fix in scenarios that the assertion runner doesn't cover:
1. Edge case: judge fires when slot.fileKey changes mid-session
2. Edge case: judge NOT fires when user explicitly disables it then mutates
3. Edge case: judge handles concurrent mutations on Tab A and Tab B
4. Anti-regression: 5 random complex creation prompts, count judge triggers

## Tools
- Playwright helpers
- Metric IPC (window.api.testMode.getMetrics())
- App running, Bridge connected

## Output
Report anomalies. If new bug found, write draft assertion to catch it
(so we can add it to assertion runner).

## Budget
30 minutes max. Stop and report if blocked.
```

### 6.6 Il loop generativo

Questo è il meccanismo chiave post-Fase 2-4:

```
Manual exploratory finds bug
     ↓
Bug entry in BUG-REPORT.md
     ↓
Assertion aggiunta nello script qa-runner pertinente
     ↓
qa-runner cattura regressione automaticamente in futuro
     ↓
Manual test non deve più ri-trovare lo stesso bug
```

**Senza questo loop**, i manual test diventano costo ricorrente. **Con questo loop**, ogni run riduce il costo dei run futuri.

### 6.7 Stima costi/benefici

**Setup attuale (oggi)**:

| Componente | Tempo | Bug catturati | Costo LLM |
|-----------|-------|---------------|-----------|
| Pass 1 automated | 50 min | 4 | ~$2 |
| Pass 2 review | 6 min | 18 | ~$3 |
| Manual scripted (5 batch) | 38 min | 12 | ~$8 |
| **Totale** | **94 min** | **~28 (con overlap)** | **~$13** |

**Post Fase 2-4**:

| Componente | Tempo | Bug catturati | Costo LLM |
|-----------|-------|---------------|-----------|
| Tier 2 assertion runner | 40 min | ~20 (incl. 12 oggi manuali) | ~$1 (no LLM) |
| Tier 3 oracle | 6 min | 18 | ~$3 |
| Tier 4 exploratory (mirato) | 30 min | 3-5 nuovi | ~$4 |
| **Totale** | **76 min** | **~25-30** | **~$8** |

**Miglioramento netto**: -19% tempo, -38% costo, **stessa quantità di bug con regression detection**.

---

## 7. Timeline e sequencing

### 7.1 Sequenza raccomandata

```
Settimana 1 (lun-ven): FASE 2 — Assertion Runner (5 gg)
  ├─ Day 1: DSL design + Script 02 pilota
  ├─ Day 2: Assertion evaluators + unit test (6 tipi P1)
  ├─ Day 3: Refactor qa-runner con robust parser (DD-6)
  ├─ Day 4: Migration 4 script + reporting + CALIBRATION step
  └─ Day 5: Buffer + end-to-end testing + rollback validation

Settimana 2 lun-mer: FASE 4 — Instrumentation (3 gg)
  ├─ Day 6: MetricsRegistry via DI (DD-2) + slot.lastContextTokens (DD-3) + hooks
  ├─ Day 7: IPC (DD-1) + preload extension + helper API + UsageTracker.getSnapshot (DD-4)
  └─ Day 8: Docs + unit test metrics-registry + performance validation

Settimana 2 gio-ven: FASE 3 — Oracle (2 gg)
  ├─ Day 9: Schema + prompt iteration + variance calibration (Task 3.2a)
  └─ Day 10: Baseline + diff + integration + bootstrapping

Settimana 3 lun: FASE 5 — CI Integration (1 gg, NEW)
  └─ Day 11: GitHub Actions workflow + baseline workflow + docs + badge

Settimana 3 mar: Final validation
  ├─ Esegui pipeline completo su CI
  ├─ Cattura baseline UX iniziale via workflow approval
  └─ Verifica FAIL su bug noti (sanity check)
```

**Effort totale**: 11 giorni (aggiornato da 9 per includere Fase 3 +1 gg e Fase 5 nuova).

### 7.2 Nota sull'ordine

Il piano originale suggeriva **Fase 4 → 2 → 3**. Questa sequenza riordinata (**2 → 4 → 3**) è più pragmatica perché:

1. **Fase 2 parte con solo DOM assertion** (senza `metric:` types) e migra gli script base. Cattura già 5-8 bug noti.
2. **Fase 4** aggiunge le metric assertion quando il runner è stabile.
3. **Fase 3** chiude con quality gating.

Trade-off: alcune assertion in Fase 2 iniziali dovranno essere rewrite per usare metric quando Fase 4 arriva. Accettabile: ~10 assertion toccate.

**Se il team preferisce l'ordine originale** (Fase 4 → 2 → 3), è ugualmente valido ma più lento a vedere valore.

### 7.3 Checkpoint dopo ogni fase

**Dopo Fase 2**: eseguire qa-runner contro app attuale. Deve produrre almeno 5 FAIL specifici sui bug noti. Se non li cattura, fermare e iterare sulle assertion.

**Dopo Fase 4**: eseguire `getMetrics()` manualmente. Deve ritornare snapshot valido con `judge.totalSkipped > 0` se B-018 non è ancora fixato.

**Dopo Fase 3**: eseguire pipeline completo. Deve exit 1 se si introduce artificialmente una regression (test: temporaneamente break uno script e verificare che diff detector lo cattura).

---

## 8. Successo: come lo misuriamo

### 8.1 Metriche di successo del piano

| Metric | Baseline (oggi) | Target (post piano) |
|--------|----------------|---------------------|
| Bug catturati automaticamente | 4/28 (~14%) | ≥22/28 (~80%) |
| Tempo per regression detection | Nessuna (manuale) | <50 min (nightly CI via Fase 5) |
| False positive rate (FAIL senza bug reale) | N/A | <5% (post calibration 4.8) |
| Costo per QA run completo | ~$13 | ~$8 (-38%) |
| Stress test utilizzabili | No | Sì (script 20-25 instrumentati) |
| Time to detect new bug class | 94 min (run completo) | 30 min (exploratory mission) |
| CI enforcement | Nessuno | Workflow nightly GitHub Actions (Fase 5) |

### 8.2 Definition of Done complessiva

- [ ] Fase 2, 3, 4, 5 complete con acceptance criteria rispettati
- [ ] 5 script migrati con assertion + calibration documentata
- [ ] Baseline UX versionato in git
- [ ] Pipeline CI nightly configurato (Fase 5 — **ora in scope**)
- [ ] Almeno 1 stress test (Script 25) eseguito con successo producendo metriche timeline
- [ ] Rollback strategy documentata e validata (Section 4.9)
- [ ] Calibration baseline per variance Opus documentata (Task 3.2a)
- [ ] Documentation:
  - [ ] `tests/qa-scripts/ASSERTION-DSL.md`
  - [ ] `tests/qa-scripts/CALIBRATION.md`
  - [ ] `docs/test-metrics-schema.md`
  - [ ] `docs/qa-ci.md` (troubleshooting CI)
  - [ ] `tests/qa-scripts/INSTRUMENTATION.md`
  - [ ] Update `tests/qa-scripts/README.md` con nuovo workflow
- [ ] BUG-REPORT.md aggiornato con nuovo workflow QA

---

## 9. Rischi complessivi

| Rischio | Impatto | Probabilità | Mitigazione |
|---------|---------|-------------|-------------|
| Scope creep durante migration | Medio | Alta | Migrare solo 5 script, resto in SOFT_PASS |
| Assertion troppo fragili | Alto | Media | Calibrazione con 2-3 run, soglie permissive iniziali |
| Opus changes quando update API | Alto | Bassa | Baseline versionato permette rollback |
| Metrics overhead in production | Alto | Bassa | Gating su env var, test di performance |
| Team non ha 6-9 giorni consecutivi | Medio | Media | Fasi indipendenti, possibile spezzare |
| Bug fix durante sviluppo piano invalidano le assertion | Basso | Alta | Accettabile: assertion devono seguire l'app, non vincolarla |

---

## 10. Prossimi passi immediati

Prima di iniziare il piano, raccomando:

1. **Fixare B-018** (judge auto-trigger) — il fix è 10 righe, root cause già verificata. Bloccarlo per ora sarebbe sporco: il piano deve partire da un'app "pulita" almeno sui bug Alta.

2. **Fixare B-021** (suggestion chips) — l'assertion runner lo userà come test di validazione della Fase 2 (deve rilevare il bug prima del fix, passare dopo).

3. **Design decisions già verificate** (vedi Section 1.1): non serve decidere env var / singleton / Pi SDK properties — le decisioni DD-1..DD-7 sono state prese e documentate post-review.

4. **Allocare il tempo**: 11 giorni totali ora (post-review), idealmente ~2.5 settimane. Si può spezzare ma non superare 4 settimane totali (rischio drift).

5. **Iniziare con Day 1 Fase 2**: DSL design + migrazione Script 02 come pilota. Se il DSL non convince, è meglio saperlo subito.

6. **Prerequisito tecnico**: verificare che `yaml` package sia disponibile:
   ```bash
   node -e "console.log(require('yaml').parse('a: 1'))"
   ```
   Se fallisce, aggiungere con `npm install --save-dev yaml`.

---

## Appendice A: Mappa dei file toccati

### File nuovi da creare

| Path | Fase | Scopo |
|------|------|-------|
| `tests/qa-scripts/ASSERTION-DSL.md` | 2 | Spec del DSL |
| `tests/qa-scripts/CALIBRATION.md` | 2 | Calibration notes per variance LLM |
| `.claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs` | 2 | Evaluators |
| `tests/unit/qa-tooling/assertion-evaluators.test.ts` | 2 | Unit test |
| `src/main/metrics-registry.ts` | 4 | Collector (via DI, no singleton) |
| `tests/helpers/metrics-client.mjs` | 4 | Helper client |
| `docs/test-metrics-schema.md` | 4 | Docs metriche |
| `tests/qa-scripts/INSTRUMENTATION.md` | 4 | Docs stress test |
| `tests/unit/main/metrics-registry.test.ts` | 4 | Unit test |
| `tests/baselines/ux-review.schema.json` | 3 | JSON schema |
| `tests/baselines/ux-variance-baseline.md` | 3 | Variance misurata empiricamente (3 run) |
| `tests/baselines/ux-baseline.json` | 3 | Baseline (bootstrappato) |
| `.claude/skills/bottega-dev-debug/scripts/validate-ux-review.mjs` | 3 | Validator |
| `.claude/skills/bottega-dev-debug/scripts/ux-baseline-diff.mjs` | 3 | Diff detector |
| `.github/workflows/qa-nightly.yml` | 5 | CI nightly workflow |
| `.github/workflows/qa-on-demand.yml` | 5 | CI manual workflow |
| `.github/workflows/qa-update-baseline.yml` | 5 | Baseline update workflow |
| `docs/qa-ci.md` | 5 | Troubleshooting CI |

### File da modificare

| Path | Fasi | Modifica |
|------|------|----------|
| `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` | 2, 4 | Parser assertion robusto (DD-6), metric capture |
| `.claude/skills/bottega-dev-debug/scripts/helpers.mjs` | 4 | Export metrics helpers |
| `src/main/session-events.ts` | 4 | Hook metricsRegistry via `deps.infra`; slot.lastContextTokens update |
| `src/main/slot-manager.ts` | 4 | Aggiungere `lastContextTokens?: number` a SessionSlot (DD-3) |
| `src/main/agent.ts` | 4 | Aggiungere `metricsRegistry` a AgentInfra (DD-2) |
| `src/main/usage-tracker.ts` | 4 | Aggiungere metodo `getSnapshot()` per delegare tool metrics (DD-4) |
| `src/main/ipc-handlers.ts` | 4 | IPC handler test:get-metrics (DD-1: BOTTEGA_AGENT_TEST) |
| `src/main/preload.ts` | 4 | Estendere blocco BOTTEGA_AGENT_TEST esistente (DD-1) |
| `src/main/index.ts` | 4 | Init metricsRegistry in infra (DD-2, no singleton) |
| `tests/qa-scripts/02-happy-path.md` | 2 | Aggiungi assertion |
| `tests/qa-scripts/04-error-resilience.md` | 2 | Aggiungi assertion |
| `tests/qa-scripts/09-styling-and-layout.md` | 2 | Aggiungi assertion |
| `tests/qa-scripts/11-image-generation.md` | 2 | Aggiungi assertion |
| `tests/qa-scripts/14-judge-and-subagents.md` | 2 | Aggiungi assertion per B-018 via dom_text_contains (DD-7) |
| `tests/qa-scripts/25-iterative-refinement.md` | 4 | Aggiungi metric assertion |
| `tests/qa-scripts/README.md` | 2, 3, 4, 5 | Update workflow |
| `.claude/skills/bottega-dev-debug/SKILL.md` | 2, 3, 4, 5 | Update QA commands |
| `README.md` | 5 | Aggiungi status badge CI |
| `BUG-REPORT.md` | — | Aggiornare status bug quando fixati |

---

## Appendice B: Risorse

- **BUG-REPORT.md** — Bug noti, root cause verificate, UX backlog
- **tests/qa-scripts/README.md** — Catalogo script attuale
- **.claude/skills/bottega-dev-debug/SKILL.md** — Workflow QA corrente
- **tests/unit/main/agent-playbook-recorded.test.ts** — Esempio di playbook tests
- **tests/fixtures/timing-baselines.json** — Baseline timing esistente (da Fase 4 Run 3)

---

**Ultimo aggiornamento**: 2026-04-07 (v1.1 post code review)
**Autore**: Derivato da QA Run 3 analysis
**Status**: Proposto — in attesa di approvazione e allocazione tempo
**Changelog**:
- v1.1 (2026-04-07): Applicate 12 correzioni post-review. Aggiunta Sezione 1.1 Design Decisions Verified (DD-1..DD-7). Fase 3 estesa da 1 a 2 gg. Aggiunta Fase 5 (CI Integration, 1 gg). Total effort 9 → 11 gg. Sezione 4.8 Calibration step. Sezione 4.9 Rollback strategy. Env var gating corretto (BOTTEGA_AGENT_TEST). MetricsRegistry via DI (no singleton). tools.* delegato a UsageTracker.
- v1.0 (2026-04-07): Prima versione.
