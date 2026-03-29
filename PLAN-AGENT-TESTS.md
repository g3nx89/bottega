# Piano: Agent Integration Tests

> Stato: DRAFT v2 (post-critique)
> Data: 2026-03-28

## Obiettivo

Introdurre una nuova categoria di test ("agent tests") che usa API reali (Anthropic)
per verificare il funzionamento end-to-end dell'agente AI nell'operare su Figma Desktop.
I test coprono sistematicamente le criticita' dei 39 tool Bottega.

---

## Inventario tool (39)

| Categoria | Tool | Count |
|-----------|------|-------|
| Core | execute, screenshot, status, get_selection | 4 |
| Discovery | get_file_data, search_components, get_library_components, get_component_details, get_component_deep, analyze_component_set, design_system | 7 |
| Components | instantiate, set_instance_properties, arrange_component_set | 3 |
| Manipulation | set_fills, set_strokes, set_text, set_image_fill, resize, move, create_child, clone, delete, rename | 10 |
| Tokens | setup_tokens, lint | 2 |
| JSX Render | render_jsx, create_icon, bind_variable | 3 |
| Annotations | get_annotations, set_annotations, get_annotation_categories | 3 |
| Image Gen | generate_image, edit_image, restore_image, generate_icon, generate_pattern, generate_story, generate_diagram | 7 |

---

## Architettura

### Directory

```
tests/agent/
  tier0-smoke.spec.mjs             <- Agent risponde senza Figma (2 test)
  tier1-connectivity.spec.mjs      <- Agent usa tool base con Figma (5 test)
  tier2-creation.spec.mjs          <- Agent crea nodi da file vuoto (8 test)
  tier3-resilience.spec.mjs        <- Agent gestisce failure gracefully (6 test)
  tier4-chains.spec.mjs            <- Flussi multi-step end-to-end (5 test)

tests/helpers/
  agent-harness.mjs                <- Helper condiviso per agent tests
```

### Playwright project

```js
// In playwright.config.mjs
{
  name: 'agent',
  testDir: 'tests/agent',
  testMatch: '**/*.spec.mjs',
  timeout: 180_000,   // 3 min per test (LLM puo' essere lento)
  retries: 2,         // 2 retry per non-determinismo LLM
}
```

### Script npm

```json
"test:agent": "npm run build && npx playwright test --project=agent",
"test:agent:smoke": "npm run build && npx playwright test --project=agent --grep @smoke"
```

### Requisiti

- Figma Desktop aperto con file di test vuoto + plugin Bridge attivo (Tier 1-4)
- API key Anthropic configurata (auth reale, NO mock)
- Tier 0 funziona SENZA Figma (solo agent pipeline)
- Opzionale: Gemini API key per test image-gen
- MAI in CI — solo manuale o pre-release

### Env vars

| Var | Default | Scopo |
|-----|---------|-------|
| `BOTTEGA_AGENT_TEST_TIER` | (tutti) | Limita a tier specifico: 0, 1, 2, 3, 4 |
| `ANTHROPIC_API_KEY` | (dal sistema) | API key per chiamate reali |

---

## Helper: agent-harness.mjs

### Bootstrap sequence

```js
// 1. Lancia app SENZA test mode e SENZA mock auth
//    - BOTTEGA_TEST_MODE non settato -> porta 9280, infra reale
//    - BOTTEGA_TEST_MOCK_AUTH non settato -> API key reali da AuthStorage
const app = await electron.launch({
  args: ['dist/main.js'],
  timeout: 30_000,
  env: { ...process.env },  // Nessun override — produzione
});

// 2. Aspetta DOM ready
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');

// 3. Aspetta connessione Figma (con banner interattivo, come UAT)
//    Poll fino a 60s per fileConnected via listTabs()
//    Se Tier 0, skip questo step

// 4. Crea tab se necessario, estrai slotId
const tabs = await win.evaluate(() => window.api.listTabs());
const slotId = tabs[0]?.id;

// 5. Setta compression profile a "minimal" per tool result completi
await win.evaluate(() => window.api.compressionSetProfile('minimal'));
```

### Funzioni helper

```js
// --- Lifecycle ---
launchAgentApp(opts)              // Bootstrap completo (step 1-5)
launchAgentAppNoFigma(opts)       // Solo step 1-2, per Tier 0

// --- Agent turn ---
sendAndWait(win, slotId, prompt, timeout)
  // 1. win.evaluate(() => window.api.sendPrompt(slotId, prompt))
  // 2. waitForAgentEnd(win, timeout)
  // 3. return { toolCalls, response, screenshot }

waitForAgentEnd(win, timeout)
  // Segnale: poll per assenza di .tab-item.streaming sul tab attivo
  // E zero .tool-spinner (tutti i tool card risolti)
  // Fallback timeout con abort forzato

// --- Verifiche DOM ---
getToolCalls(win)
  // Attende zero .tool-spinner, poi estrae .tool-card:
  // [{name: string, success: boolean, error: boolean}]

getAgentResponse(win)
  // Estrae textContent dell'ultimo .assistant-message

hasScreenshotInChat(win)
  // Verifica presenza di img element nel chat area

// --- Verifiche Figma (WS Oracle) ---
queryFigma(win, code)
  // Esegue Plugin API code via window.api.sendPrompt hack:
  // Usa win.evaluate() per invocare un IPC diretto al WS server
  // Alternativa: connette un ws client diretto a localhost:9280

assertFigmaNodeExists(win, namePattern, expectedProps)
  // queryFigma con findOne(n => n.name.match(pattern))
  // Verifica type, width, height, fills etc.

clearFigmaPage(win)
  // queryFigma("figma.currentPage.children.forEach(n => n.remove())")
  // Chiamato in beforeEach per isolamento

getFigmaPageNodeCount(win)
  // queryFigma("figma.currentPage.children.length")

// --- Assertions ---
assertToolCalled(calls, ...names)
  // Almeno uno dei nomi e' presente nelle calls
assertNoToolErrors(calls)
  // Zero calls con error: true
assertResponseContains(text, keywords)
  // Almeno una keyword presente (case-insensitive)
assertAgentStable(win)
  // Window responsive + nessun stack trace nella risposta
```

### Pattern di verifica (per test)

```
CLEANUP: clearFigmaPage()                    <- Figma pulita
SEND:    sendAndWait(win, slotId, prompt)     <- 1 API call
CHECK DOM:
  - getToolCalls() -> assertToolCalled() + assertNoToolErrors()
  - getAgentResponse() -> assertResponseContains()
  - hasScreenshotInChat() se atteso
CHECK FIGMA (ground truth):
  - assertFigmaNodeExists() per creazioni
  - getFigmaPageNodeCount() per conteggio
DIAGNOSTIC:
  - Screenshot Playwright per debug
  - Console logs capture on failure
```

### Diagnostica on failure

Ogni test cattura automaticamente in `tests/.artifacts/agent/`:
- Screenshot Playwright dell'app
- Console log del renderer (errori JS)
- Lista tool calls con stato
- Testo completo della risposta agent
- Node count nella pagina Figma

---

## Criticita' dei tool Bottega (13 identificate)

| # | Criticita' | Rischio | Coperta da |
|---|-----------|---------|-----------|
| 1 | Queue deadlock: timeout blocca mutation queue | CRITICO | Unit test (injection) |
| 2 | Screenshot dopo delete: reference nodo cancellato, silent fail | ALTO | Agent 3.2 |
| 3 | Instantiate + properties immediate: instance non pronta | ALTO | Agent 4.1 |
| 4 | Key format REST vs plugin: instantiate fallisce silenziosamente | ALTO | Agent 4.1 |
| 5 | Design system cache stale: token obsoleti dopo modifica esterna | ALTO | Unit test (injection) |
| 6 | Icon resolution timeout: render_jsx incompleto senza icone | MEDIO-ALTO | Agent 2.3, 3.3 |
| 7 | Auto-layout ignora move: posizionamento silenziosamente ignorato | MEDIO-ALTO | Agent 2.2, 2.5, 3.4 |
| 8 | Image fill auto-apply: nodeId invalido silenzioso | MEDIO | Unit test |
| 9 | Variant name collision: search ambiguo, istanza sbagliata | MEDIO | Agent 4.1 |
| 10 | Annotation categoryId invalido: scritto senza categoria | MEDIO | Agent 3.6 |
| 11 | **figma_execute codice arbitrario**: errori syntax, return non serializzabile, timeout 30s | CRITICO | Agent 2.1, 3.5b |
| 12 | **get_component_deep stack depth**: ricorsione profonda, timeout su alberi grandi | MEDIO | Agent 4.1 (indiretto) |
| 13 | **Compression altera tool result**: profilo balanced comprime risultati, agent perde info | MEDIO | Mitigato: tests usano profilo minimal |

Copertura: 9/13 da agent test, 4/13 da unit test (richiedono injection/mocking).

---

## Gestione non-determinismo LLM

- **Assertion fuzzy**: keyword OR case-insensitive ("rect" OR "rectangle")
- **Tool assertion strutturale**: "almeno uno tra create_child/render_jsx/execute" (non ordine esatto)
- **Retry**: `retries: 2` nel Playwright project agent (3 tentativi totali)
- **Nomi univoci**: ogni test usa nomi con timestamp per non interferire
- **Nessun match esatto** sul testo dell'agent — solo keyword presence
- **Multi-outcome per resilience**: test 3.x definiscono piu' esiti accettabili

---

## Gestione costi

Stime realistiche includendo thinking tokens (medium level ~2x), retry overhead
(~30%), e system prompt (~3K token input per call).

| Tier | Test | Costo base | Con retry 30% | Totale |
|------|------|-----------|---------------|--------|
| 0 — Smoke | 2 | ~$0.02 | ~$0.03 | ~$0.03 |
| 1 — Connectivity | 5 | ~$0.10 | ~$0.13 | ~$0.13 |
| 2 — Creation | 8 | ~$0.80 | ~$1.04 | ~$1.04 |
| 3 — Resilience | 6 | ~$0.60 | ~$0.78 | ~$0.78 |
| 4 — Chains | 5 | ~$1.00 | ~$1.30 | ~$1.30 |
| **Totale** | **26** | **~$2.52** | | **~$3.28/run** |

### Smoke subset (@smoke tag, ~$0.20)

Per sanity check veloce (<2 min): test 0.1, 1.1, 2.1, 4.2
```bash
npm run test:agent:smoke
```

### Quando eseguire

- Pre-release: run completo (~26 test, ~$3.28)
- Post-refactor: dopo modifiche a tools, system prompt, agent pipeline
- Quick check: smoke subset (~4 test, ~$0.20)
- MAI in CI — solo manuale

---

## Suite di test

### Tier 0 — Smoke senza Figma (2 test)

Verifica che la pipeline agent (Pi SDK session + API key + prompt/response)
funzioni senza dipendenze esterne. Non richiede Figma Desktop.

| # | Prompt | Verifica |
|---|--------|---------|
| 0.1 @smoke | "List the tools you have available for working with Figma." | Risposta contiene "execute", "screenshot", "create"; no crash |
| 0.2 | "What can you help me with? Describe your capabilities briefly." | Risposta non vuota, contiene "design" o "Figma"; no crash |

### Tier 1 — Connectivity (5 test)

L'agent si connette a Figma e usa tool base.

| # | Prompt | Tool atteso | Verifica DOM | Verifica Figma |
|---|--------|-------------|-------------|----------------|
| 1.1 @smoke | "What's the Figma connection status?" | figma_status | tool success, risposta contiene "connected" | — |
| 1.2 | "Take a screenshot of the current page" | figma_screenshot | img element nel chat | — |
| 1.3 | "What's currently selected on the page?" | figma_get_selection | tool success | — |
| 1.4 | "Describe the structure of this file" | figma_get_file_data | tool success, risposta con "page" | — |
| 1.5 | "Check if there are any design system tokens or variables defined" | figma_design_system | tool success | — |

### Tier 2 — Creation (8 test)

L'agent crea nodi su Figma partendo da pagina vuota (clearFigmaPage in beforeEach).

Criticita' coperte: #6 (icon pipeline), #7 (mutation sequencing), #11 (figma_execute)

| # | Scenario | Prompt | Criticita' | Verifica DOM | Verifica Figma |
|---|----------|--------|-----------|-------------|----------------|
| 2.1 @smoke | Gradient shape (figma_execute) | "Create a rectangle named 'Hero_{ts}' that is 400x200 pixels. Fill it with a linear gradient from purple (#7C3AED) to blue (#3B82F6), and add a 2px white border." | #11 | tool success (execute o create_child + set_fills), keyword: hero, gradient | assertFigmaNodeExists('Hero_', {type: 'RECTANGLE'}) |
| 2.2 | Text layout | "Create a vertical auto-layout frame named 'Layout_{ts}' with 16px spacing containing: a heading 'Welcome to Bottega', a paragraph of lorem ipsum text, and a button that says 'Get Started'." | #7 | tool success, keyword: welcome, get started | nodeCount >= 1, node type FRAME |
| 2.3 | Icon grid | "Create a 2x2 grid of icons in a frame named 'IconGrid_{ts}': a star (mdi:star), a heart (mdi:heart), a home (mdi:home), and a gear (mdi:cog). Each icon 24x24, 8px gap." | #6 | create_icon o render_jsx, keyword: icon, grid | assertFigmaNodeExists('IconGrid_') |
| 2.4 | Button component | "Create a button named 'PrimaryBtn_{ts}' with text 'Submit', padding 12px/8px, corner radius 8px, solid blue (#2563EB) background." | #7 | tool success, keyword: button, submit | assertFigmaNodeExists('PrimaryBtn_') |
| 2.5 | App header | "Create a mobile app header named 'Header_{ts}': 375px wide, 44px tall, white background. Back arrow icon left, centered title 'Profile', settings gear icon right." | #6, #7 | multipli tool, keyword: header, profile | assertFigmaNodeExists('Header_', {width: 375}) |
| 2.6 | Color swatches | "Create 5 colored circles in a horizontal row, each 48x48, in a frame named 'Swatches_{ts}': Red (#EF4444), Orange (#F97316), Yellow (#EAB308), Green (#22C55E), Blue (#3B82F6). Name each circle." | #7 queue | 5x tool success, keyword: red, blue | getFigmaPageNodeCount() >= 1 |
| 2.7 | Product card | "Create a product card named 'Card_{ts}' (320x400) with auto-layout: gray (#E5E7EB) image placeholder (320x200), title 'Product Name', price '$29.99', description. Proper spacing." | #7 nested | tool success, keyword: card, 29.99 | assertFigmaNodeExists('Card_') |
| 2.8 | Annotations | "Create a rectangle named 'Annotated_{ts}' and add an annotation to it with the label 'Needs review' and description 'Check spacing with design team'." | #10 | set_annotations tool, keyword: annotation, review | assertFigmaNodeExists('Annotated_') |

### Tier 3 — Resilience (6 test)

L'agent gestisce failure gracefully. Ogni test definisce assertion concrete
per "graceful handling":
- App non crasha (window responsive dopo il test)
- Agent produce una risposta testuale (non vuota)
- Nessun stack trace o "undefined" nella risposta
- Keyword specifiche presenti che indicano comprensione dell'errore

Criticita' coperte: #2, #6, #7, #10, #11

| # | Scenario | Prompt | Criticita' | Assertion concrete |
|---|----------|--------|-----------|-------------------|
| 3.1 | Component not found | "Find a component called 'XYZ_NONEXISTENT_12345' in the design system and instantiate it." | #3, #4 | assertAgentStable() + risposta contiene "not found" OR "doesn't exist" OR "couldn't find" OR "no component" OR agent crea da zero (fallback accettabile) |
| 3.2 | Operate on deleted node | "Create a small rectangle, then delete it, then try to change its fill color to red." | #2 | assertAgentStable() + almeno 3 tool calls (create, delete, attempt) + risposta contiene "deleted" OR "doesn't exist" OR "removed" OR agent crea nuovo rettangolo (fallback accettabile) |
| 3.3 | Invalid icon name | "Create a layout with an icon called 'mdi:nonexistent-icon-xyz-99999' using JSX." | #6 | assertAgentStable() + risposta presente + layout creato (con o senza icona) OR agent spiega che l'icona non esiste |
| 3.4 | Move in auto-layout | "Create an auto-layout frame with 3 colored rectangles, then move the second one to absolute position x=500, y=500." | #7 | assertAgentStable() + risposta presente + agent spiega vincolo auto-layout OR agent rimuove da auto-layout prima di muovere |
| 3.5 | Execute with bad code | "Use figma_execute to run this code: `const x = figma.currentPage.findAll(n => n.nonExistentMethod()); return x;`" | #11 | assertAgentStable() + tool error O agent spiega l'errore + app non crasha |
| 3.6 | Invalid annotation category | "Add an annotation to any node on the page with categoryId 'FAKE_CATEGORY_99999'." | #10 | assertAgentStable() + risposta presente + agent spiega errore o tool gestisce silently |

### Tier 4 — Tool Chains (5 test)

Flussi multi-step che testano catene di tool dove il fallimento di uno
puo' cascadare sugli altri.

Criticita' coperte: #3, #4, #9, #11, #12

| # | Scenario | Prompt | Criticita' | Verifica DOM | Verifica Figma |
|---|----------|--------|-----------|-------------|----------------|
| 4.1 | Design system flow | "Search the design system for any button component. If you find one, instantiate it and change its text to 'Click me'. If none exists, create a button from scratch with blue background." | #3, #4, #9 | Catena search + instantiate + set_properties, OPPURE fallback create | assertFigmaNodeExists che contiene "Click me" (via queryFigma text search) |
| 4.2 @smoke | Create + modify + verify | "Create a blue (#3B82F6) rectangle named 'Morph_{ts}' (200x100), then change its color to green (#22C55E), then take a screenshot to confirm." | #7 | Screenshot presente, tool chain success | assertFigmaNodeExists('Morph_', {type: 'RECTANGLE'}) |
| 4.3 | JSX + tokens | "Create a card frame named 'TokenCard_{ts}', then set up a color variable 'brand-primary' with value #6366F1, then bind the card's background fill to that variable." | token chain | setup_tokens + bind_variable (o spiegazione) | assertFigmaNodeExists('TokenCard_') |
| 4.4 | Clone + modify | "Create a red (#EF4444) rectangle named 'Original_{ts}', clone it 3 times. Change clones to blue (#3B82F6), green (#22C55E), yellow (#EAB308). Rename each with its color." | queue stress | 4+ tool success, no errors | getFigmaPageNodeCount() >= 4 |
| 4.5 | Complex execute chain | "Using figma_execute, create a COMPONENT named 'TestComp_{ts}' with auto-layout, add a text child 'Label', and set padding to 16px all sides. Then take a screenshot." | #11 chain | execute success + screenshot | assertFigmaNodeExists('TestComp_', {type: 'COMPONENT'}) |

---

## Cleanup e isolamento

### beforeEach: clearFigmaPage()

Ogni test (Tier 1-4) esegue `clearFigmaPage()` in `beforeEach` che:
```js
await queryFigma(win, `
  const page = figma.currentPage;
  for (const child of [...page.children]) child.remove();
  return page.children.length;
`);
```

Questo garantisce:
- Ogni test parte da pagina vuota
- Nessuna interferenza tra test
- `figma_get_file_data` restituisce payload piccoli
- `figma_search_components` non trova nodi da test precedenti

### afterEach: abort + diagnostic capture

```js
// Abort qualsiasi streaming in corso
await win.evaluate(id => window.api.abort(id), slotId);
await win.evaluate(id => window.api.queueClear(id), slotId);

// Cattura diagnostica se test fallito
if (testInfo.status === 'failed') {
  await win.screenshot({ path: `tests/.artifacts/agent/${testInfo.title}.png` });
  // Salva console logs, tool calls, risposta agent
}
```

---

## Fasi di implementazione

### Fase 1 — Setup infrastruttura

- [ ] Creare `tests/agent/` directory
- [ ] Scrivere `tests/helpers/agent-harness.mjs` con bootstrap + tutti gli helper
- [ ] Implementare `queryFigma()` via WS connector diretto (ws client a localhost:9280)
- [ ] Implementare `clearFigmaPage()`, `assertFigmaNodeExists()`, `getFigmaPageNodeCount()`
- [ ] Implementare `waitForAgentEnd()` (poll .tab-item.streaming + .tool-spinner)
- [ ] Implementare diagnostic capture in afterEach
- [ ] Aggiungere project "agent" a `playwright.config.mjs`
- [ ] Aggiungere script `test:agent` e `test:agent:smoke` a `package.json`
- [ ] CI: verificare che `--project=e2e` escluda agent (gia' garantito da project separation)

### Fase 2 — Tier 0 Smoke (senza Figma)

- [ ] Scrivere `tests/agent/tier0-smoke.spec.mjs` (2 test)
- [ ] Verificare che funzioni con solo API key, senza Figma Desktop

### Fase 3 — Tier 1 Connectivity

- [ ] Scrivere `tests/agent/tier1-connectivity.spec.mjs` (5 test)
- [ ] Verificare con Figma Desktop + API key reale
- [ ] Validare `waitForAgentEnd` e `getToolCalls` end-to-end

### Fase 4 — Tier 2 Creation

- [ ] Scrivere `tests/agent/tier2-creation.spec.mjs` (8 test)
- [ ] Verificare `clearFigmaPage` + `assertFigmaNodeExists` per ogni test
- [ ] Confermare che prompt 2.1 usa `figma_execute` per gradient

### Fase 5 — Tier 3 Resilience

- [ ] Scrivere `tests/agent/tier3-resilience.spec.mjs` (6 test)
- [ ] Verificare che ogni test multi-outcome funziona con assertion concrete

### Fase 6 — Tier 4 Chains

- [ ] Scrivere `tests/agent/tier4-chains.spec.mjs` (5 test)
- [ ] Verificare catene complete end-to-end con Figma oracle

### Fase 7 — Unit test per criticita' non coperte

- [ ] Estendere `operation-queue.test.ts` con timeout/deadlock injection (criticita' #1)
- [ ] Estendere `design-system-cache.test.ts` con invalidation timing (criticita' #5)
- [ ] Unit test per `set_image_fill` con nodeIds invalidi (criticita' #8)

### Fase 8 — Documentazione e validazione

- [ ] Run completo di tutti i 26 test agent
- [ ] Documentare costo effettivo vs stimato
- [ ] Aggiornare PLAN-AGENT-TESTS.md con stato DONE

---

## Note

- I test agent sono per natura piu' lenti e costosi degli altri. Usare
  `BOTTEGA_AGENT_TEST_TIER` per limitare durante lo sviluppo.
- Il non-determinismo dell'LLM e' gestito ma non eliminato: un test puo'
  fallire occasionalmente. Il retry (`retries: 2`, 3 tentativi totali) mitiga.
- Ogni test Tier 1-4 pulisce la pagina Figma in beforeEach via `clearFigmaPage()`.
- I prompt sono in inglese (lingua del system prompt dell'agent).
- I test usano compression profile `minimal` per avere tool result completi.
- Il Figma Oracle (queryFigma via WS) e' il meccanismo di ground-truth verification.
  Le verifiche DOM (.tool-card) sono complementari, non sostitutive.
- Smoke subset (@smoke tag): 4 test per sanity check veloce (~$0.20, <2 min).
