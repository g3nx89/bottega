# Piano di Testing — Bottega

> Analisi dei rischi e strategia di estensione della copertura di test.
> v3 — revisionato con analisi sequenziale + review Codex gpt-5.4 (xhigh).
> Data: 2026-03-23

---

## Stato Attuale

- **229 test** in 17 file (Vitest + Playwright-Electron)
- Copertura concentrata su **logica pura** (compression 109 test, jsx-parser 22, operation-queue 8)
- **~1.700 LOC nei percorsi critici senza alcun test** (websocket-server, ipc-handlers, figma-api, websocket-connector, agent)
- E2E test (20 casi) coprono solo UI statica, nessun flusso agent
- **Nessuna CI/CD** — nessuna GitHub Actions workflow, test eseguiti solo manualmente
- `npm run test:e2e` non esegue build prima — assume `dist/` pre-esistente

---

## Analisi dei Rischi (ranking v3)

Ranking basato su probabilita reale di occorrenza x impatto, verificato sul codice sorgente e rivisto da Codex gpt-5.4.

### Rischi Confermati

| Rank | ID | Componente | Rischio | P x I | Note |
|------|-----|-----------|---------|-------|------|
| 1 | R6 | `ipc-handlers.ts:45`, `ipc-handlers.ts:256`, `index.ts:122` | **`wc.send()` su webContents distrutto** — crash main process. Problema **cross-cutting**: presente nel subscriber agent events, nel forwarding auth/login, e nel forwarding WS events in index.ts | Alto | Serve una funzione `safeSend()` centralizzata, non un fix puntuale |
| 2 | R5 | `ipc-handlers.ts:149-164`, `app.js:45-50,296` | **Streaming state split tra main e renderer** — il main ha `isStreaming`, il renderer ha il proprio stato input disabled/enabled. Se `prompt()` rejecta, il catch block in main resetta e invia `agent:end`, ma il renderer ignora rejection di `invoke('agent:prompt')` (`app.js:50`). Il rischio reale e il **desync tra i due stati**, non solo il flag nel main | Medio-Alto | La correzione richiede intervento su entrambi i lati |
| 3 | R7 | `icon-loader.ts:15` | **Fetch senza AbortController/timeout** — Iconify API lenta blocca l'OperationQueue | Medio | Node.js fetch puo attendere 30s+ su DNS failure. Blocca tutte le mutazioni successive |
| 4 | R-N7 | `websocket-server.ts:255,271,439` | **Multi-file WS race condition** — `SELECTION_CHANGE`/`PAGE_CHANGE` flippano il file attivo, mentre `sendCommand` risolve il target dal file attivo al momento dell'invio. Un comando potrebbe essere inviato al file sbagliato se l'utente cambia tab Figma durante un'operazione | Medio | Non identificato nelle analisi precedenti |
| 5 | R-N8 | `preload.ts:43` vs `index.ts:124` | **IPC contract drift** — preload espone `figma:connected` con payload `fileKey`, ma index.ts invia `fileName`. Nessun tipo condiviso, nessun test. Drift gia in corso | Medio | Fragile: qualsiasi rinomina rompe silenziosamente la comunicazione |
| 6 | R4 | `operation-queue.ts` | **Nessun timeout proprio** — difesa in profondita | Basso | Gia mitigato: ogni operazione wrappata ha il timeout del WS sendCommand (15s-300s). Valore solo come safety net |
| 7 | R8 | `websocket-server.ts` | **Nessun heartbeat/keepalive** | Basso | Grace period 5s + re-identificazione via FILE_INFO gia gestiscono il caso |
| 8 | R9 | `agent.ts` | **createAgentSession senza retry** | Basso | L'utente puo semplicemente riavviare l'app |

### Rischi Declassati (erano sopravvalutati)

| ID | Rischio originale | Perche declassato |
|----|-------------------|-------------------|
| R1 | Memory leak da pending request orfane su WS | **Falso positivo**: ogni pending request ha un `timeoutId` (`websocket-server.ts:454-458`) che la rejecta e la rimuove dal Map dopo 15s. `rejectPendingRequestsForFile()` pulisce al disconnect. Non ci sono orfani |
| R3 | Stack overflow da JSX profondamente annidato | **L'LLM non genera questo**: il massimo pratico e 10-20 livelli. Nessun modello produce 1000+ livelli di nesting |

### R2 (vm sandbox) — Parzialmente Declassato

R2 era stato declassato a "probabilita ~0" nella v2. La review Codex ha corretto: espressioni JS arbitrarie **sono consentite** dentro JSX (i test esistenti in `jsx-parser.test.ts:154,159` lo dimostrano). L'esbuild transform barrier blocca la maggior parte dei vettori, ma non tutti — `{(() => { /* arbitrary code */ })()}` e JSX valido che esbuild preserva.

Il rischio non e sicurezza (l'LLM non e un attaccante) ma **stabilita**: il sandbox e creato una volta (`jsx-parser.ts:12`) e riusato. Un'espressione che modifica il contesto inquina tutte le chiamate successive.

**Classificazione corretta**: Basso (probabilita) x Medio (impatto) = **Basso-Medio**. Va testato per cross-run contamination, non per prototype pollution offensiva.

### Rischi Nuovi Identificati

| ID | Componente | Rischio | P x I | Azione |
|----|-----------|---------|-------|--------|
| R-N1 | `image-gen/config.ts:8` | **API key Gemini hardcoded nel sorgente** | Alto (sicurezza) | **Fix immediato**, non un item di testing. Spostare in env var o keychain |
| R-N2 | `figma-api.ts` (481 LOC, 0 test) | **Funzioni pure critiche senza test** — `extractFileKey()`, `formatVariables()` usate da tutti i tool di discovery. `withTimeout()` e dead code | Medio | Test existing. Nota: helper non sono il hot path primario, ma `extractFileKey` rompe 5 tool se sbaglia |
| R-N3 | `icon-loader.ts:56-58` | **`Promise.all` fail-all-on-one** — se una singola icona fallisce, `resolveIcons()` fallisce interamente. Nessun fallback parziale | Medio | Fix + test: `Promise.allSettled()` |
| R-N4 | Tool error propagation | **Inconsistenza tra tool**: `core.ts:22-26` propaga eccezioni, `image-gen.ts:106` ritorna oggetti errore. L'agente riceve feedback incoerente | Basso-Medio | Standardizzare in un secondo momento |
| R-N5 | `preload.ts:9-84` | **Event listener leak potenziale** — `ipcRenderer.on()` senza cleanup | Basso | Non prioritario: registrazioni avvengono una volta per lifetime del processo (`app.js:276`) |
| R-N6 | `scripts/build.mjs` | **Nessuna verifica post-build** che preload sia CJS | Basso-Medio | Smoke test in CI, non in Vitest |
| R-N7 | `websocket-server.ts:255,271,439` | **Multi-file active-file race condition** | Medio | Vedi tabella rischi confermati sopra |
| R-N8 | `preload.ts:43` vs `index.ts:124` | **IPC contract drift tra preload e main** | Medio | Vedi tabella rischi confermati sopra |
| R-N9 | `ipc-handlers.ts:159`, `figma-api.ts:125` | **Error message leakage** — errori di prompt inviati verbatim al renderer, REST failure include raw response body | Basso | Sanitizzare prima di forwarding |
| R-N10 | `package.json:23` | **Pi SDK version coupling** — caret versions `^0.61.0` su entrambi i package Pi. Session event strings usati come literal in `ipc-handlers.ts:47`. Bump minore puo rompere silenziosamente | Basso-Medio | Pin versions o aggiungere contract test |
| R-N11 | `app.js:45,50,296` | **Renderer state management** — input disabilitato prima che IPC completi, invoke rejection ignorata, riabilitato solo su `agent:end` | Medio | Coperto indirettamente da R5 |

---

## Distinzione Fondamentale: Test vs Fix+Test vs Fix Immediato

| Item | Tipo | Note |
|------|------|------|
| **R-N1: API key hardcoded** | **Fix immediato** | Non e un item di testing. Spostare in env var/keychain prima di tutto il resto |
| R6: wc.send crash (cross-cutting) | Fix + test | Estrarre `safeSend()`, poi testare |
| R5: streaming state desync | Test existing bug + fix | Testare il desync, poi correggere su entrambi i lati |
| R7: icon-loader no fetch timeout | Fix + test | Aggiungere AbortController |
| R-N3: icon-loader Promise.all | Fix + test | Sostituire con Promise.allSettled |
| R-N7: multi-file WS race | Test existing | Documentare il comportamento attuale |
| R-N8: IPC contract drift | Test existing | Verificare che i nomi corrispondano |
| R4: operation-queue timeout | Fix + test | Aggiungere parametro timeout |
| figma-api: funzioni pure | Test existing | extractFileKey, formatVariables |
| prompt-builders | Test existing | Funzioni pure, zero mock |

---

## Prerequisiti (prima di qualsiasi fase)

### P0. Fix Immediato: API Key Hardcoded (R-N1)

`image-gen/config.ts:8` contiene una API key Gemini in chiaro. Non e un item di testing — va rimosso dal sorgente immediatamente, indipendentemente dal piano di testing.

### P1. Refactor di Testabilita: `safeSend()` (R6)

Prima di poter testare R6, serve estrarre una funzione `safeSend(wc, channel, ...args)` che:
1. Controlla `wc.isDestroyed()` prima di inviare
2. E usata in tutti i punti che oggi chiamano `wc.send()` direttamente:
   - `ipc-handlers.ts:45+` (subscriber agent events)
   - `ipc-handlers.ts:256` (auth/login forwarding)
   - `index.ts:122` (WS event forwarding)

Effort: ~2h. Questa e una precondizione per la Fase 1.

### P2. Infrastruttura Test Condivisa

Creare `tests/helpers/`:
- `mock-session.ts` — `AgentSessionLike` mock con `subscribe()` controllabile
- `mock-window.ts` — `BrowserWindow` mock con `webContents.send` spy e `isDestroyed()` toggle
- `mock-ipc.ts` — interceptor per `ipcMain.handle()` che cattura handler registrati
- `ws-test-client.ts` — client WS per connettersi al server, inviare FILE_INFO, rispondere a comandi

Effort: ~3h. Riutilizzabile in Fase 1, 2 e 3.

---

## Piano di Testing

Riordinato dopo review Codex: IPC handlers spostati in Fase 1 insieme a una tranche minima di pure functions. Build verification spostata a CI smoke.

### Fase 1 — Seam Critici + Quick Win (settimana 1, ~16-18h)

La fase 1 ora combina i test ad alto impatto (IPC handlers) con quick win a basso sforzo (pure functions). Questo bilancia ROI immediato su bug reali con copertura facile da ottenere.

#### 1A. `ipc-handlers.test.ts` (NUOVO, ~20 test) — Rischi R5, R6, R-N8

Target: il flusso agent prompt/abort/event, il cross-cutting `safeSend`, e i casi limite critici.

Dipendenze: P1 (`safeSend` refactor), P2 (mock infrastructure).

```
safeSend (cross-cutting, R6)
├── safeSend su webContents vivo → invia normalmente
├── safeSend su webContents distrutto → no-op, no crash
├── safeSend usato da subscriber agent events
└── safeSend usato da auth/login forwarding

Streaming lifecycle (R5)
├── prompt invia a session, eventi inoltrati al renderer
├── prompt error setta isStreaming = false e invia agent:end
├── agent_end event resetta streaming state
├── follow-up prompt durante streaming usa 'followUp'
├── double agent:end (SDK emette + catch) → renderer gestisce idempotente

Edge cases
├── API key mancante → errore senza chiamare session
├── abort resetta streaming state

Model switch
├── abort vecchia sessione → crea nuova con nuovo modello
└── switch fallito → sessione precedente preservata

IPC contract (R-N8)
├── figma:connected payload shape matches preload expectation
├── screenshot forwarding da tool_execution_end
├── suggestion generation su agent_end (errore silenzioso, UI non bloccata)
├── OAuth login con concurrency guard (LoginAbortController)
└── compression profile IPC roundtrip
```

**Effort**: ~10h (inclusa infrastruttura mock di P2) | **Impact**: copre i rischi #1 e #2

#### 1B. `figma-api.test.ts` (NUOVO, ~12 test) — Rischio R-N2

Target: funzioni helper pure in `figma-api.ts` — nessuna chiamata HTTP necessaria.

```
extractFileKey()
├── URL standard figma.com/design/:key/:name          → estrae :key
├── URL con branch figma.com/design/:key/branch/:bk   → estrae :bk
├── URL invalido                                       → null/throw
└── URL con path mancante                              → null/throw

extractFigmaUrlInfo()
├── URL con branch                                     → { fileKey, branchKey }
├── URL con node-id (dash → colon conversion)          → { nodeId: "1:23" }
├── branch in path vs query param                      → parsing corretto
└── URL non-Figma                                      → errore

formatVariables()
├── data vuota                                         → stringa vuota/default
├── singola collection                                 → formato compatto
└── campi mancanti/null                                → nessun crash

withTimeout()
└── resolve prima del timeout / reject dopo            → documenta dead code
```

**Effort**: ~2h | **Impact**: copre funzioni usate da 5 tool di discovery

#### 1C. `prompt-builders.test.ts` (NUOVO, ~15 test)

Target: funzioni pure di costruzione prompt in `image-gen/prompt-builders.ts`.

```
buildBatchPrompts()
├── senza opzioni → singolo prompt
├── solo styles → N prompt (uno per stile)
├── solo variations → N prompt (uno per variazione)
├── styles x variations → prodotto cartesiano
├── outputCount cap a 8
└── array vuoti → singolo prompt default

buildIconPrompt()
├── defaults                    → contiene dimensioni standard
├── tutte le opzioni            → integra tutto
└── app-icon vs favicon         → prompt diversi

buildPatternPrompt()
├── defaults                    → pattern generico
├── seamless → aggiunge "tileable"
└── tutte le opzioni

buildDiagramPrompt()
├── defaults
└── tutte le opzioni

buildStoryStepPrompt()
└── step 1 vs step N, per tipo
```

**Effort**: ~2h | **Impact**: previene corruzione prompt in 7 tool di image-gen

#### 1D. `jsx-parser.test.ts` ESTENSIONE (+7 test) — Rischio R2

Aggiungere ai 22 test esistenti. Include test di stabilita cross-run (review Codex).

```
Boundary behavior (test existing)
├── Tag name sconosciuto (non nella mappatura sandbox) → comportamento?
├── Stringa JSX vuota                                  → errore gestito?
├── Albero molto largo (100 sibling)                   → baseline performance
├── Espressione JS con variabile undefined             → errore chiaro?
└── Elementi root multipli                             → fallisce o wrappa in Fragment?

Cross-run contamination (R2, stability)
├── Espressione che modifica il contesto → non persiste nella chiamata successiva
└── Espressione con side-effect su prototipi built-in → sandbox isolato
```

**Effort**: ~1.5h | **Impact**: documenta limiti del parser e verifica stabilita sandbox

#### 1E. `image-gen-config.test.ts` (NUOVO, ~4 test)

```
├── effectiveApiKey() ritorna chiave custom quando impostata
├── effectiveApiKey() ritorna default quando non impostata
├── loadImageGenSettings() ritorna {} quando il file non esiste
└── save + load roundtrip (usando tmpdir)
```

**Effort**: ~1h

**Totale Fase 1: ~54 test, ~16-18h (inclusi prerequisiti P1+P2). Copre R5, R6, R2, R-N2, R-N8.**

---

### Fase 2 — Resilienza e Fix (settimana 2, ~8h)

Fix al codice + test che verificano la correzione. Queste modifiche richiedono design decision.

#### 2A. `icon-loader.test.ts` ESTENSIONE (+3 test) — Rischi R7, R-N3

Aggiungere ai 14 test esistenti. Richiede fix al codice.

```
├── Fetch timeout dopo N ms → rejected                              [R7 - fix: AbortController]
├── Un'icona fallisce su 10 → partial success                       [R-N3 - fix: Promise.allSettled]
└── Cache eviction order corretto (FIFO a 500 entries)
```

**Nota**: il bug `Promise.all` in `icon-loader.ts:56-58` e reale — se una singola icona non carica, l'intero `resolveIcons()` fallisce e il render JSX viene abortito. Fix a `Promise.allSettled()` con fallback (icona mancante → nodo senza SVG).

**Effort**: ~3h (1.5h fix + 1.5h test)

#### 2B. `operation-queue.test.ts` ESTENSIONE (+4 test) — Rischio R4

Aggiungere agli 8 test esistenti. Richiede piccola modifica al codice (timeout opzionale).

```
├── Task che supera timeout → rejected                              [Fix + test]
├── Queue continua drain dopo timeout rejection
├── Timeout cleanup senza leak
└── execute() annidato con timeout
```

**Effort**: ~2h (1h fix + 1h test)

#### 2C. Error message sanitization (R-N9, ~3 test)

```
├── Prompt failure: errore sanitizzato prima di inviare al renderer
├── REST failure: response body non esposto al renderer
└── Stack trace non incluso nei messaggi utente
```

**Effort**: ~3h (2h fix + 1h test)

**Totale Fase 2: ~10 test, ~8h. Mitiga R7, R-N3, R4, R-N9.**

---

### Fase 3 — Layer WebSocket (settimana 3, ~13h)

Priorita inferiore perche il codice e gia difensivo, ma include il nuovo rischio R-N7 (multi-file race).

#### 3A. `websocket-server.test.ts` (NUOVO, ~18 test)

Target: lifecycle connessioni, routing comandi, e multi-file race condition. Usa WS server reale su porta random.

Dipendenze: P2 (`ws-test-client.ts`).

```
Connection lifecycle
├── Server avvia e accetta connessioni
├── FILE_INFO promuove pending client a named client
├── Pending client timeout dopo 30s (con timer mocking)
├── Client disconnect con grace period 5s
├── Client reconnect entro grace period preserva stato
├── Origin verification rejecta origini non-Figma

Command routing
├── sendCommand resolve quando risposta ricevuta
├── sendCommand reject su timeout
├── sendCommand reject quando nessun client connesso
├── rejectPendingRequestsForFile al disconnect

Multi-file e race condition (R-N7)
├── Due client con fileKey diversi → active file tracking
├── Active file switch su SELECTION_CHANGE
├── sendCommand durante active file switch → comando arriva al file corretto?
├── Comando inviato a fileKey specifico ignora active file

Cleanup
├── stop() pulisce tutti i client e pending requests
├── Console log buffer overflow (cap 1000)
└── Document change buffer overflow (cap 200)
```

**Effort**: ~9h | **Impact**: regressione safety per 700 LOC + documenta race condition R-N7

#### 3B. `websocket-connector.test.ts` (NUOVO, ~8 test)

Target: routing comandi corretto e valori timeout. Mock: stub `FigmaWebSocketServer.sendCommand()`.

```
├── executeCodeViaUI → EXECUTE_CODE con timeout + 2000
├── captureScreenshot → CAPTURE_SCREENSHOT con 30s timeout
├── createFromJsx → CREATE_FROM_JSX con 60s timeout
├── setImageFill → SET_IMAGE_FILL con 60s timeout
├── getVariables → EXECUTE_CODE con 32s timeout
├── lintDesign → LINT_DESIGN con 120s timeout
├── refreshVariables → REFRESH_VARIABLES con 300s timeout
└── Errore da sendCommand si propaga correttamente
```

**Effort**: ~3h

**Totale Fase 3: ~26 test, ~13h. Copre WS layer + R-N7.**

---

### Fase 4 — E2E Deterministici (settimana 4, ~10h, differibile)

Ridimensionata rispetto alla v2 (era 16h). Codex ha evidenziato che il flusso agent completo richiede un seam per iniettare una fake session — senza di esso, i test E2E con agent non sono deterministici.

**Prerequisito non ancora disponibile**: `index.ts` crea sempre una sessione Pi SDK reale. Serve aggiungere un'opzione `--test-mode` o un seam di dependency injection per iniettare una fake session. Questo refactor non e budgetato in questa fase.

#### 4A. Estensione Playwright-Electron (+10 test) — Solo UI/IPC, no agent

I 20 test attuali verificano solo che elementi UI esistano. Estendere con interazioni reali che non richiedono un agent:

```
├── Digitare messaggio e verificare user bubble
├── Settings panel apre e chiude
├── Model selector mostra tutti i modelli
├── Context bar renderizza a 0 token
├── Mock WS client si connette → status "Connected"    (3 test)
├── Image generation settings panel                     (2 test)
└── Compression profile selector
```

#### 4B. Build smoke test (CI, ~3 test) — Rischio R-N6

Spostato qui dalla Fase 1 (suggerimento Codex: non appartiene a Vitest).

```
├── dist/preload.js esiste e contiene `require(` o `module.exports` (check CJS)
├── dist/main.js esiste e contiene `import` (check ESM)
└── Script `npm run build` completa senza errori
```

**Nota**: questi test dovrebbero vivere in un CI workflow, non nella suite Vitest. Prevedere creazione di `.github/workflows/ci.yml`.

**Totale Fase 4: ~13 test, ~10h.**

---

### Fase Futura — Agent Flow E2E (non pianificata)

Questa fase richiede un refactor architetturale (session injection seam) che va pianificato separatamente:

```
Prerequisito: --test-mode o DI per AgentSession fake
├── Round-trip: prompt → agent → tool → WS → mock response → renderer (2 test)
├── Screenshot flow end-to-end
├── Connection status updates in UI
└── Disconnect/reconnect durante operazione
```

Non inclusa nelle stime perche il refactor ha scope e rischio propri.

---

## Riepilogo Quantitativo

| Fase | Contenuto | Test | Tipo | Effort | Rischi mitigati |
|------|-----------|------|------|--------|-----------------|
| P0 | Fix API key hardcoded | 0 | Fix immediato | ~1h | R-N1 |
| P1 | safeSend refactor | 0 | Refactor testabilita | ~2h | Prerequisito R6 |
| P2 | Test helpers condivisi | 0 | Infrastruttura | ~3h | Prerequisito Fasi 1-3 |
| 1 | IPC handlers + pure functions + jsx | ~54 | Mix test + fix | ~12h | R5, R6, R2, R-N2, R-N8 |
| 2 | Resilienza (icon, queue, errors) | ~10 | Fix + test | ~8h | R7, R-N3, R4, R-N9 |
| 3 | WebSocket layer + multi-file | ~26 | Test existing | ~13h | WS regression, R-N7 |
| 4 | E2E deterministici + CI smoke | ~13 | E2E/CI | ~10h | UI interactions, R-N6 |
| **Totale** | | **~103** | | **~49h** | **12 rischi** |

**Da 229 → ~332 test**, con copertura riallineata ai rischi reali.

---

## Cosa NON testare (e perche)

| Area | Motivo |
|------|--------|
| `system-prompt.ts` (5 test esistenti) | Sufficiente. Template string builder, non serve espandere |
| `tools-schema.test.ts` (13 test) | Mantenere ma non espandere. TypeBox + Pi SDK forniscono validazione runtime |
| `compression/` (109 test) | Completo. Rapporto 109 test / 910 LOC e adeguato per logica pura |
| Renderer `app.js` unit test | NON usare jsdom — fragile e basso valore. Coprire via E2E Playwright |
| `agent.ts` (197 LOC) | Mock Pi SDK pesante e fragile. Testabile indirettamente solo con session injection seam (Fase Futura) |
| `preload.ts` event listener leak (R-N5) | Non prioritario: registrazioni avvengono una volta per process lifetime (`app.js:276`). Codex conferma |

---

## Infrastruttura di Testing

### Stato attuale

- **Vitest** per unit/integration, timeout 10s, coverage v8
- **Playwright** per E2E Electron, timeout 60s, 1 worker seriale
- **Nessuna CI/CD** — test solo manuali
- `vitest.config.ts` esclude `index.ts`, `preload.ts`, `agent.ts` dalla coverage — nessuna soglia minima
- `npm run test:e2e` non esegue build prima — assume `dist/` pre-esistente
- `tests/electron-smoke.mjs` e standalone/manuale, separato dalla suite Playwright

### Azioni necessarie

1. **Creare `.github/workflows/ci.yml`**: `npm test` + `npm run build` + build smoke test + `npm run test:e2e`
2. **Aggiungere soglie di coverage** in `vitest.config.ts` (suggerito: 40% linee come baseline, incrementare gradualmente)
3. **Creare `tests/helpers/`** con mock condivisi (P2)
4. **Fix `test:e2e` script** per eseguire build prima dei test: `"test:e2e": "npm run build && npx playwright test tests/e2e/"`

---

## Cronologia Revisioni

### v1 → v2: Analisi sequenziale

- R1 (memory leak WS) declassato: falso positivo, timeout e cleanup gia presenti
- R2 (vm pollution) declassato: esbuild transform barrier blocca la maggior parte dei vettori
- R3 (JSX stack overflow) declassato: LLM non genera nesting 1000+
- Ordine fasi invertito: IPC handlers prima di WS server
- Integration test 3B spostato a E2E
- Nuovi rischi identificati: R-N1 (API key), R-N2 (figma-api), R-N3 (Promise.all), R-N6 (build verification)

### v2 → v3: Review Codex gpt-5.4 (xhigh)

Feedback accettato:
- **R6 e cross-cutting** — `wc.send()` non protetto in 3 punti, non 1. Serve `safeSend()` centralizzato (P1)
- **R5 corretto** — il rischio reale e split streaming state tra main e renderer, non solo il flag `isStreaming`
- **R2 parzialmente riabilitato** — espressioni JS arbitrarie possibili in JSX. Aggiunti test cross-run contamination
- **Nuovi rischi** — R-N7 (multi-file WS race), R-N8 (IPC contract drift), R-N9 (error leakage), R-N10 (Pi SDK version coupling), R-N11 (renderer state management)
- **Effort Fase 2 sottostimato** — da 13h a 16-18h (ora Fase 1 ristrutturata)
- **Build verification → CI** — non appartiene a Vitest
- **R-N1 non e un item di testing** — e un fix di sicurezza immediato
- **Fase 4 ridimensionata** — agent flow E2E richiede session injection seam non ancora disponibile
- **Aggiunta sezione infrastruttura** — CI/CD, coverage thresholds, test helpers

Feedback rifiutato (con motivazione):
- "figma-api helpers non sono il hot path" — vero per HTTP methods, ma `extractFileKey()` e usato da ogni tool di discovery (5 tool). Un bug li rompe tutti. Mantenuto in Fase 1 ma dopo IPC handlers
- "R-N5 (preload event leak) da deprioritizzare" — era gia deprioritizzato nella v2, confermato

---

## Trade-off Consapevoli

| Decisione | Pro | Contro |
|-----------|-----|--------|
| IPC handlers in Fase 1 (non Fase 2) | ROI massimo: copre rischi #1 e #2 subito | Richiede infrastruttura mock (P2) prima di iniziare |
| safeSend come prerequisito (P1) | Fix architetturale pulito, testabile | Ritarda l'inizio dei test di ~2h |
| Pure functions accanto a IPC (Fase 1) | Quick win facili bilanciano il costo dei mock | La fase diventa piu lunga (16-18h vs 6h originali) |
| Fase 4 ridimensionata, agent flow differito | Realistico senza session injection seam | Il percorso piu critico (prompt→agent→tool→render) resta non testato |
| Nessun unit test renderer | Evita fragilita jsdom | Renderer state bugs (R-N11) coperti solo indirettamente |
| WS server in Fase 3 (non Fase 1) | Il codice e gia difensivo (timeout, grace period) | Race condition R-N7 resta scoperta fino a settimana 3 |

---

## Riferimenti Codice

File sorgente citati con numero di riga:

- `src/main/ipc-handlers.ts:45` — `wc.send()` non protetto, subscriber events (R6)
- `src/main/ipc-handlers.ts:256` — `wc.send()` non protetto, auth/login forwarding (R6)
- `src/main/index.ts:122` — `wc.send()` non protetto, WS event forwarding (R6)
- `src/main/ipc-handlers.ts:149-164` — isStreaming lifecycle (R5)
- `src/main/ipc-handlers.ts:159` — error message forwarded verbatim (R-N9)
- `src/main/ipc-handlers.ts:47` — Pi SDK event string literals (R-N10)
- `src/renderer/app.js:45,50` — input disabled + invoke rejection ignored (R-N11)
- `src/renderer/app.js:296` — agent:end reenables input (R-N11)
- `src/main/icon-loader.ts:15` — `fetch()` senza timeout (R7)
- `src/main/icon-loader.ts:56-58` — `Promise.all` fail-all (R-N3)
- `src/main/operation-queue.ts:26-34` — drain loop senza timeout (R4)
- `src/main/jsx-parser.ts:8-12` — sandbox creation e riuso (R2)
- `src/main/jsx-parser.ts:30-35` — esbuild transform (R2 barrier)
- `src/main/image-gen/config.ts:8` — API key hardcoded (R-N1)
- `src/main/preload.ts:43` — `figma:connected` payload name (R-N8)
- `src/main/index.ts:124` — `fileName` sent vs `fileKey` expected (R-N8)
- `src/figma/websocket-server.ts:255,271` — active file switch on events (R-N7)
- `src/figma/websocket-server.ts:439` — sendCommand uses active file (R-N7)
- `src/figma/websocket-server.ts:454-458` — timeout su pending requests (R1 invalidated)
- `src/figma/websocket-server.ts:404-423` — grace period 5s al disconnect
- `src/figma/websocket-server.ts:647-655` — cleanup pending requests al disconnect
- `src/figma/figma-api.ts:70-78` — `withTimeout()` dead code
- `src/figma/figma-api.ts:94-136` — `request()` senza retry/rate-limit
- `src/figma/figma-api.ts:125` — raw response body in errors (R-N9)
- `src/figma/websocket-connector.ts:73` — timeout delegation a sendCommand
- `src/main/preload.ts:9-84` — event listener senza cleanup (R-N5)
- `scripts/build.mjs:17` — preload CJS format, nessuna verifica (R-N6)
- `package.json:23` — Pi SDK caret versions (R-N10)
