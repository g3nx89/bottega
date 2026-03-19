# RALPLAN-DR: Analisi Piano Dettagliato — Figma Companion

> Data: 2026-03-18 | Modo: DELIBERATE (progetto greenfield ad alta complessita)
> Iterazione: 2 (revisione post-feedback Architect + Critic)

---

## 1. Principi Guida (5)

1. **E2E First**: Arrivare a un flusso end-to-end funzionante (utente scrive -> agente opera su Figma -> screenshot nella chat) il prima possibile. Ogni fase deve produrre un incremento verificabile.

2. **Embed, Non Reinventare**: Il codice upstream (figma-console-mcp, figma-use) e testato e funzionante. Copiare e adattare minimamente, non riscrivere. Ogni modifica rispetto all'upstream va documentata in UPSTREAM.md.

3. **Serializzazione Rigorosa**: Tutte le mutazioni Figma passano per OperationQueue. Nessuna eccezione. Il plugin Figma non gestisce concorrenza.

4. **Superficie API Minima**: Per MVP, implementare solo i tool necessari per il primo test E2E (5 core + figma_create_child). Aggiungere gli altri 22 tool incrementalmente dopo che il flusso funziona.

5. **Sicurezza del Contesto**: Il JSX generato dall'LLM viene eseguito in sandbox vm isolato. Nessun accesso a globals, process, require. Il rischio e contenuto ma documentato.

---

## 2. Decision Drivers (Top 3)

### D1 — Velocita verso il primo test E2E
Il progetto non ha ancora una riga di codice. Il rischio principale e investire settimane in infrastruttura senza mai validare che il flusso funzioni. Il fast track (5 tool core) e essenziale.

### D2 — Complessita del porting CREATE_FROM_JSX
Il handler `create-from-jsx` in figma-use e 4,800 LOC totali in rpc.ts, usa pesantemente `figma.widget.h` e `figma.createNodeFromJSXAsync` (Widget API). Il piano stima 400-600 LOC da estrarre, ma il codice e profondamente intrecciato con Widget API. Questa e la decisione tecnica piu rischiosa.

### D3 — Integrazione Pi SDK (problema system prompt risolto)
Il piano identifica come "problema aperto" l'iniezione del system prompt. Dalla verifica del codice sorgente di Pi SDK v0.60.0, il problema e **risolto**: `DefaultResourceLoader({ systemPrompt: "..." })` accetta direttamente una stringa, e `systemPromptOverride` permette trasformazioni. Inoltre `agent.setSystemPrompt()` esiste su pi-agent-core. Questo riduce significativamente il rischio della Fase 5.

---

## 3. Opzioni Viabili

### Opzione A — "Fast Track + Widget API" (Piano attuale con ottimizzazioni)

Seguire il piano dettagliato con le 8 fasi, ma:
- Fase 4 ridotta: implementare solo 5-6 tool core per primo E2E
- Fase 2b: portare CREATE_FROM_JSX con Widget API come nel piano
- Fase 5: usare `DefaultResourceLoader({ systemPrompt })` (problema risolto)

**Pro:**
- Segue il piano gia analizzato e documentato in dettaglio
- figma_render_jsx con Widget API produce risultati di alta qualita (auto-layout nativo, shorthand Tailwind)
- Massimizza il riutilizzo del codice figma-use

**Contro:**
- CREATE_FROM_JSX e il pezzo piu rischioso: 4,800 LOC da distillare, fortemente accoppiato a Widget API
- Widget API (`figma.widget`) potrebbe non essere disponibile in tutti i contesti plugin (richiede plugin di tipo widget o accesso specifico)
- Se il porting fallisce, blocca figma_render_jsx (il tool piu potente) fino a quando non si trova un'alternativa

### Opzione B — "Fast Track + Figma API Nativa" (Alternativa semplificata)

Stessa struttura a 8 fasi, ma CREATE_FROM_JSX reimplementato con API Figma standard (`figma.createFrame()`, `figma.createText()`, ecc.) invece di Widget API.

**Pro:**
- API Figma standard sono ben documentate e stabili
- Nessuna dipendenza da Widget API (piu portabile)
- Il codice e piu semplice da debuggare perche usa API esplicite
- Riduce da ~600 LOC a ~300-400 LOC il handler nel plugin

**Contro:**
- Perdita della conversione shorthand -> Widget tree (va reimplementata manualmente)
- Auto-layout va settato esplicitamente (`layoutMode`, `primaryAxisAlignItems`, etc.) invece di derivarlo dal Widget API
- Font loading richiede chiamate `figma.loadFontAsync()` esplicite per ogni nodo Text (Widget API lo gestisce internamente)
- Potenzialmente piu lento per alberi grandi (N chiamate create vs un singolo `createNodeFromJSXAsync`)

### Opzione C — "JSON Tree Diretto" (Elimina JSX parsing)
**INVALIDATA**

Invece di far generare JSX all'LLM e poi parsarlo con esbuild+vm, far generare direttamente un TreeNode JSON.

**Rationale di invalidazione:**
- L'LLM genera JSX in modo molto piu naturale del JSON (milioni di componenti React nel training data)
- Il JSX con shorthand (`bg="#FFF" p={24} rounded={12}`) e significativamente piu compatto del JSON equivalente, risparmiando token
- La differenza di costo tra esbuild transform (~1ms) e la complessita di validare JSON arbitrario e trascurabile
- figma-use ha gia dimostrato che il pattern JSX funziona in produzione

---

## 4. Piano Revisionato

### Valutazione del piano attuale

Il piano dettagliato e **solido nella struttura** (fasi ordinate, dipendenze chiare, parallelismo corretto) ma ha **tre problemi concreti** corretti nell'iterazione 1 e **sei problemi aggiuntivi** identificati da Architect e Critic nell'iterazione 2.

### Problema 1: Il "problema aperto" del system prompt non e aperto
**Correzione (iter. 1)**: Fase 5 agent.ts deve usare:
```
const resourceLoader = new DefaultResourceLoader({
  systemPrompt: FIGMA_SYSTEM_PROMPT,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
});
const { session } = await createAgentSession({
  resourceLoader,
  customTools: figmaTools,
  tools: [],
});
```
Questo elimina completamente il rischio della Fase 5.

### Problema 2: CREATE_FROM_JSX dipende da Widget API
**Correzione (iter. 1)**: Il piano dice "removed Widget API dependency" nell'UPSTREAM.md del plugin, ma il codice sorgente di figma-use usa esplicitamente `figma.widget.h` e `figma.createNodeFromJSXAsync`. Servono due sotto-strategie:

- **Strategia primaria (Opzione A)**: Provare `figma.createNodeFromJSXAsync` nel contesto plugin standard. Se funziona, il porting e piu semplice perche il Widget API fa il lavoro pesante.
- **Strategia fallback (Opzione B)**: Se Widget API non e disponibile nel plugin standard, reimplementare con `figma.createFrame()`, `figma.createText()`, etc. Questa reimplementazione e piu verbosa ma usa solo API stabili.

**Spike richiesto**: Prima di investire nella Fase 2b, verificare in 30 minuti se `figma.widget` e accessibile in un plugin standard (non widget). Questo spike determina quale strategia seguire.

### Problema 3: 28 tool tutti insieme nella Fase 4 e troppo
**Correzione (iter. 1)**: Il piano gia suggerisce il fast track ma non lo formalizza come fase. Revisione:

- **Fase 4a** (pre-E2E): 6 tool core — `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection`, `figma_create_child`, `figma_set_text`
- **Fase 4b** (post-E2E): I restanti 22 tool, aggiungibili incrementalmente dopo il primo test E2E

### Problema 4 (iter. 2, M1): Fase 2b nel percorso critico del MILESTONE E2E
**Correzione**: Il MILESTONE E2E dipendeva da `5+6+7+2b`. Il fork del plugin con CREATE_FROM_JSX (Fase 2b) NON e necessario per il milestone: i 6 tool core funzionano con il plugin base di figma-console-mcp via `executeCodeViaUI()`. Il percorso critico diventa: `1->2->3->4a->5->[6+7]->MILESTONE`.

**NOTA**: Verificare che il plugin base supporti `createChildNode` e `setTextContent` tramite `executeCodeViaUI()`. Se queste operazioni sono eseguibili come codice Plugin API generico (via `figma_execute`), il plugin base e sufficiente. Se servissero handler dedicati, occorrerebbe un mini-fork limitato (senza CREATE_FROM_JSX). Questo va verificato in Fase 3.

### Problema 5 (iter. 2, M2): ToolDefinition.execute signature non documentata
**Correzione**: La signature reale di `ToolDefinition.execute` e:
```
execute(
  toolCallId: string,
  params: Static<TParams>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ctx: ExtensionContext
): Promise<AgentToolResult<TDetails>>
```
Il piano non menzionava `toolCallId`, `signal`, `onUpdate`, `ctx`. Fix: aggiungere in Fase 4a un task per creare `wrapFigmaTool()`, un helper che wrappa una funzione semplice `(params) => result` nella signature completa, gestendo: signal propagation (AbortSignal), error wrapping, OperationQueue integration, campo `label` nel ToolDefinition.

### Problema 6 (iter. 2, M3): Build system per plugin fork non pianificato
**Correzione**: Il plugin Figma esegue in sandbox senza `require()`. Dipendenze npm (svgpath, d3-hierarchy, ecc.) vanno bundlate. Fix: aggiungere in Fase 2b un task per creare `scripts/build-plugin.mjs` con esbuild che produce un singolo file JS per il plugin.

**NOTA del Critic**: svgpath e d3-hierarchy sono usati in handler diversi da CREATE_FROM_JSX. Se il fork estrae solo CREATE_FROM_JSX, CREATE_ICON, BIND_VARIABLE, queste dipendenze POTREBBERO non servire. Va verificato durante il porting.

### Fasi revisionate (iter. 2)

| Fase | Contenuto | Dipende da | Note |
|------|-----------|------------|------|
| 1 | Scaffold progetto | - | Invariata |
| 2 | Embed figma core (7 file) | 1 | Invariata. IFigmaConnector esteso con `IFigmaConnectorExtended` (non modifica diretta) |
| 3 | Figma core runtime | 2 | + Verifica che plugin base supporti createChildNode via executeCodeViaUI |
| 4a | 6 tool core per E2E + helper `wrapFigmaTool()` | 3 | **Aggiornata**: include helper wrapper e test unitari tool |
| 5 | Pi SDK Agent (system prompt risolto) | 4a | + Verifica `loader.reload()`, + mini-script verifica event shape pre-integrazione |
| 6 | Electron shell | 1 (parallelo) | Invariata |
| 7 | Chat UI | 1 (parallelo) | Invariata |
| **MILESTONE E2E** | Test: "Crea un rettangolo blu" funziona | **5+6+7** | **2b RIMOSSA dalle dipendenze** |
| 0 | **Spike Widget API** | MILESTONE E2E | **Spostata post-milestone** |
| 2b | Fork Desktop Bridge Plugin + build-plugin.mjs | 0 | **Spostata post-milestone**, + script build esbuild |
| 4b | Restanti 22 tool (inclusi jsx-render, icon, bind) | 2b | + fileKey in contesto per multi-file |
| 8 | Polish, token, packaging | 4b | Invariata |

### Percorso critico revisionato (iter. 2)

```
1 --> 2 --> 3 --> 4a --> 5 ---\
 \                              --> MILESTONE E2E --> 0 (spike) --> 2b --> 4b --> 8
  \--> 6 (parallelo) ---------/
   \--> 7 (parallelo) --------/
```

**Cambiamento chiave rispetto a iter. 1**: Lo spike (Fase 0) e la fork plugin (Fase 2b) sono spostati DOPO il milestone. Il MILESTONE E2E dipende solo da Fasi 5+6+7, tutte raggiungibili con il plugin base di figma-console-mcp.

---

## 5. Rischi e Mitigazioni

### Rischi dal piano originale (rivalutati)

| # | Rischio | Valutazione | Mitigazione |
|---|---------|-------------|-------------|
| R1 | Pi SDK non espone override system prompt | **RISOLTO** | `DefaultResourceLoader({ systemPrompt })` funziona. `noExtensions: true` disabilita features non necessarie. Confermato da analisi dei tipi d.ts. |
| R2 | esbuild come runtime dep per JSX parsing | Medio | Accettabile per MVP. esbuild e gia dependency di build. Spostare in dependencies. Alternativa futura: WASM transform o parser custom. |
| R3 | CREATE_FROM_JSX troppo complesso da portare | **ALTO** (rivalutato) | Il piano sottostima: il codice usa Widget API (`figma.widget.h`), non API standard. Lo spike (Fase 0) e obbligatorio. Fallback: reimplementazione con API native Figma. **Ora post-milestone, non blocca piu E2E.** |
| R4 | ws bundling con esbuild | Basso | Se problemi, `external: ['ws']` in esbuild config. ws e gia in node_modules per Electron. |
| R5 | Electron 41 non stabile | Basso | Electron 33 LTS come fallback. Verificare compatibilita Node target. |
| R6 | vm.runInContext sicurezza | Basso | JSX generato dall'LLM, contesto isolato. Per hardening futuro: timeout + memory limit. |

### Rischi aggiuntivi identificati

| # | Rischio | Impatto | Mitigazione |
|---|---------|---------|-------------|
| R7 | **Iconify API rate limiting** | Medio | icon-loader.ts ha cache in-memory, ma nessuna persistenza. Se l'agente genera molte icone in sessione, le API calls si accumulano. Aggiungere cache su disco (JSON file) o bundlare set comuni. |
| R8 | **Pi SDK subscribe() event shape** | Medio | Il piano assume una forma specifica degli eventi (`event.assistantMessageEvent.type === 'text_delta'`). L'API esatta va verificata. Se cambia tra versioni, l'IPC handler si rompe silenziosamente. Scrivere un integration test minimo. **Iter. 2: aggiunto mini-script di verifica pre-Fase 5.** |
| R9 | **Font loading in plugin** | Medio | `figma.loadFontAsync()` richiede che il font sia installato sul sistema. Se l'LLM specifica un font non disponibile, il plugin crasha. Wrappare sempre in try-catch con fallback a "Inter" o font di sistema. |
| R10 | **Dimensione bundle Electron** | Basso | esbuild + pino + ws + @iconify/utils in un bundle Electron possono produrre un .dmg pesante. Verificare dimensione dopo Fase 8 e ottimizzare se necessario. |
| R11 (iter. 2) | **Plugin base insufficiente per tool core** | Medio | Se il plugin base di figma-console-mcp non supporta `createChildNode` / `setTextContent` via `executeCodeViaUI()`, serve un mini-fork pre-milestone. Verifica in Fase 3. |

### Pre-Mortem (3 scenari di fallimento)

**Scenario 1 — "Widget API non disponibile"**
Lo spike della Fase 0 rivela che `figma.widget` non e accessibile nei plugin standard (solo nei widget). L'intero approccio CREATE_FROM_JSX va reimplementato con API native. Impatto: +2-3 giorni sulla Fase 2b. Mitigazione: il fallback (Opzione B) e gia documentato nel piano. **Iter. 2: non blocca piu il milestone E2E.**

**Scenario 2 — "Pi SDK breaking change"**
Pi SDK v0.61.0 viene rilasciato durante lo sviluppo e cambia la shape degli eventi `subscribe()` o la firma di `createAgentSession()`. L'app si rompe in modo non ovvio. Mitigazione: pinnare la versione a `0.60.0` esatta in package.json (non `^0.60.0`). Scrivere un smoke test che verifica la session creation. **Iter. 2: aggiunto mini-script verifica event shape.**

**Scenario 3 — "Latenza WebSocket inaccettabile"**
L'agente chiama 10-15 tool in sequenza per un layout complesso. Ogni roundtrip WebSocket aggiunge 50-100ms. Il tempo totale supera i 5-10 secondi, l'utente percepisce lentezza. Mitigazione: figma_render_jsx riduce a 1 roundtrip i layout complessi. Ma se figma_render_jsx non funziona (Scenario 1), si torna a tool multipli. Monitorare con timing nel tool result.

---

## 6. Acceptance Criteria per Fase

### Fase 1 — Scaffold
- [ ] `npm install` completa senza errori
- [ ] `node scripts/build.mjs` produce `dist/main.js`, `dist/preload.js`, `dist/renderer/index.html`
- [ ] `npx tsc --noEmit` passa senza errori
- [ ] `npx electron dist/main.js` avvia un processo senza crash (puo essere finestra vuota)
- [ ] Pi SDK pinnato a `0.60.0` esatta (non `^0.60.0`) in package.json
- [ ] `@iconify/utils` e `@iconify/core` entrambi nelle dipendenze

### Fase 2 — Embed figma core
- [ ] 7 file in `src/figma/` compilano con `npx tsc --noEmit`
- [ ] `import { FigmaWebSocketServer } from './figma/websocket-server'` risolve senza errori
- [ ] `import { WebSocketConnector } from './figma/websocket-connector'` risolve senza errori
- [ ] Interfaccia `IFigmaConnectorExtended` estende `IFigmaConnector` con metodi aggiuntivi (createFromJsx, createIcon, bindVariable)
- [ ] `IFigmaConnector` originale NON modificata (preserva compatibilita upstream)
- [ ] `src/figma/UPSTREAM.md` creato con commit di riferimento

### Fase 3 — Figma core runtime
- [ ] `figma-core.ts` avvia il WS server sulla porta 9223
- [ ] Il Desktop Bridge Plugin (base, non fork) si connette e logga `fileConnected`
- [ ] `operation-queue.ts` serializza 3 operazioni concorrenti in ordine FIFO
- [ ] Cleanup handlers chiudono il server su SIGINT senza porte orfane
- [ ] **Verifica plugin base**: confermare che `executeCodeViaUI()` supporta creazione nodi e modifica testo. Se NO, documentare cosa manca e pianificare mini-fork
- [ ] **Test unitario**: `operation-queue.ts` — 3 task concorrenti serializzati in ordine FIFO

### Fase 4a — 6 Tool Core + wrapFigmaTool
- [ ] Helper `wrapFigmaTool()` creato in `src/main/tools/wrap-tool.ts`:
  - Wrappa `(params: T) => Promise<AgentToolResult>` nella signature completa `execute(toolCallId, params, signal, onUpdate, ctx)`
  - Propaga `AbortSignal`: se `signal.aborted` prima dell'esecuzione, restituisce errore immediato; se durante, passa il signal alle operazioni async sottostanti
  - Integra `OperationQueue.execute()` per tool di mutazione (flag `isMutation`)
  - Wrappa errori in formato `AgentToolResult` con `isError: true`
  - Ogni ToolDefinition include campo `label` oltre a `name` e `description`
- [ ] `createFigmaTools(deps)` restituisce array di 6 ToolDefinition
- [ ] Ogni tool ha: name, label, description, parameters (TypeBox schema), execute function (via wrapFigmaTool)
- [ ] `figma_execute` esegue codice Plugin API e restituisce il risultato
- [ ] `figma_screenshot` restituisce ImageContent con base64 PNG
- [ ] `figma_create_child` crea un nodo figlio visibile nel canvas
- [ ] `figma_set_text` modifica il contenuto di un nodo testo esistente
- [ ] Tool di mutazione passano per OperationQueue (verificabile nel log)
- [ ] **Test unitari**: ogni tool testato con connector mock, verifica che wrapFigmaTool gestisca signal e errori
- [ ] **Test unitario**: `AgentToolResult` format documentato e verificato (campi: content, isError, details)

### Fase 5 — Pi SDK Agent
- [ ] **Pre-check**: eseguire mini-script di verifica che:
  - Crea una sessione con `createAgentSession()` e verifica che non lanci
  - Chiama `session.subscribe()` e logga la shape del primo evento ricevuto
  - Verifica che `AgentSessionEvent` abbia la struttura attesa (text_delta, tool_execution, etc.)
  - Documenta la shape reale in un commento nel codice
- [ ] **Verifica reload()**: testare se `loader.reload()` e necessario prima di `createAgentSession()`. Se si, aggiungerlo. Se no, documentare.
- [ ] `createFigmaAgent()` crea una sessione senza errori
- [ ] `session.systemPrompt` contiene il prompt Figma personalizzato (non quello di default Pi)
- [ ] `session.prompt("Qual e lo stato della connessione?")` chiama `figma_status` e restituisce una risposta coerente
- [ ] Gli eventi `subscribe()` emettono `text_delta` durante lo streaming
- [ ] `tools: []` disabilita tutti i tool built-in (bash, read, edit, write)
- [ ] AbortSignal propagato: `session.abort()` (o equivalente) interrompe la generazione e il signal arriva ai tool in esecuzione

### Fase 6 — Electron Shell
- [ ] La finestra si apre con titlebar macOS nativo (hiddenInset)
- [ ] `contextBridge` espone `window.api` con `sendPrompt`, `abort`, `onTextDelta`
- [ ] IPC `agent:prompt` invia il testo all'agente e riceve eventi di streaming
- [ ] IPC `agent:abort` interrompe la generazione in corso

### Fase 7 — Chat UI
- [ ] Messaggio utente appare come bolla a destra
- [ ] Risposta agente appare come bolla a sinistra con streaming progressivo
- [ ] Tool execution mostra card con nome tool e stato (spinner -> check/cross)
- [ ] Screenshot inline appare come immagine nella chat
- [ ] Indicatore connessione Figma (dot verde/rosso) nell'header
- [ ] Dark mode rispetta `prefers-color-scheme`

### MILESTONE E2E
- [ ] Utente scrive "Crea un rettangolo blu 200x100"
- [ ] L'agente chiama `figma_create_child` o `figma_execute`
- [ ] L'agente chiama `figma_screenshot`
- [ ] Lo screenshot appare nella chat mostrando il rettangolo blu
- [ ] Il rettangolo e visibile nel canvas Figma
- [ ] **Nessuna dipendenza da Fase 2b**: il plugin base e sufficiente

### Fase 0 — Spike Widget API (post-milestone)
- [ ] Un plugin di test che chiama `figma.widget.h` e caricato in Figma Desktop senza errore
- [ ] Oppure: documentata l'impossibilita con screenshot dell'errore
- [ ] Decisione documentata: Opzione A o Opzione B per CREATE_FROM_JSX

### Fase 2b — Fork Desktop Bridge Plugin (post-milestone)
- [ ] `scripts/build-plugin.mjs` creato: esbuild bundla il plugin fork in un singolo file JS
  - Verifica quali dipendenze npm servono effettivamente per CREATE_FROM_JSX + CREATE_ICON + BIND_VARIABLE
  - Se svgpath/d3-hierarchy non servono per questi 3 handler, NON includerli
  - Se servono, bundlarli con esbuild (no `require()` in sandbox Figma)
- [ ] `figma-desktop-bridge/manifest.json` si importa in Figma Desktop senza errore
- [ ] Il plugin si connette al WebSocket server sulla porta 9223
- [ ] Comando `CREATE_ICON` crea un nodo vettore visibile nel canvas
- [ ] Comando `BIND_VARIABLE` linka un fill a una variabile esistente
- [ ] Comando `CREATE_FROM_JSX` crea un albero di nodi (auto-layout, testo, colori)
- [ ] `figma-desktop-bridge/UPSTREAM.md` creato
- [ ] **Test unitario**: build script produce output valido, nessuna dipendenza `require()` residua

### Fase 4b — Restanti 22 Tool
- [ ] `createFigmaTools(deps)` restituisce array di 28 ToolDefinition
- [ ] Ogni tool usa `wrapFigmaTool()` per la signature completa
- [ ] Ogni categoria (discovery, components, manipulation, tokens, jsx-render) ha almeno un test unitario
- [ ] `figma_render_jsx` crea un layout con auto-layout, testo e colori da JSX
- [ ] `figma_create_icon` crea un nodo vettore da nome Iconify
- [ ] `figma_bind_variable` linka un fill a un token Figma
- [ ] Tool multi-file: `fileKey` incluso nel contesto per operazioni cross-file
- [ ] **Test unitari**: jsx-parser.ts (JSX semplice -> TreeNode), icon-loader.ts (fetch + cache hit)

### Fase 8 — Polish
- [ ] Token Figma salvato con `safeStorage` e recuperato al riavvio
- [ ] Disconnessione plugin mostra avviso nella chat
- [ ] `electron-builder --mac` produce un .dmg installabile
- [ ] Plugin incluso come extra resource nel pacchetto
- [ ] 6 scenari di test E2E passano (bottone, icona, card, selezione, libreria, token)

---

## 7. Test Plan Espanso (modo DELIBERATE)

### Unit Test

| Test | Fase | File target |
|------|------|-------------|
| `operation-queue.ts`: 3 task concorrenti serializzati | Fase 3 | `src/main/operation-queue.ts` |
| `wrapFigmaTool()`: signal propagation, error wrapping, OperationQueue | Fase 4a | `src/main/tools/wrap-tool.ts` |
| Ogni tool core: execute con connector mock | Fase 4a | `src/main/tools/core/*.ts` |
| `AgentToolResult` format validation | Fase 4a | `src/main/tools/wrap-tool.ts` |
| `jsx-parser.ts`: JSX semplice produce TreeNode corretto | Fase 4b | `src/main/tools/jsx-render/jsx-parser.ts` |
| `icon-loader.ts`: fetch + cache hit per stessa icona | Fase 4b | `src/main/tools/jsx-render/icon-loader.ts` |
| `createFigmaTools()`: restituisce 28 tool con schemas validi | Fase 4b | `src/main/tools/index.ts` |
| Build plugin: output valido senza require() | Fase 2b | `scripts/build-plugin.mjs` |

### Integration Test
- WebSocket server + connector: sendCommand con risposta mock (Fase 3)
- Tool execute con connector mock: verifica OperationQueue serialization (Fase 4a)
- IPC round-trip: renderer -> main -> agent -> main -> renderer (Fase 6)
- Pi SDK session creation + subscribe event shape (Fase 5)

### E2E Test
- Flusso completo: prompt -> tool calls -> screenshot -> chat display (MILESTONE)
- Reconnessione: plugin disconnesso -> riconnesso -> operazioni riprendono (Fase 8)
- Abort: utente interrompe generazione -> agente si ferma -> UI pulita (Fase 8)

### Observability
- Logging strutturato (pino) per ogni tool call: nome, durata, successo/errore
- Timing WebSocket roundtrip nel tool result details
- Contatore sessione: token consumati, tool calls, errori

---

## 8. ADR (Architectural Decision Record)

### Decisione
Seguire **Opzione A** (Fast Track + Widget API) come strategia primaria, con spike obbligatorio (Fase 0, post-milestone) e fallback documentato a Opzione B (API native Figma) se Widget API non e disponibile nei plugin standard.

### Drivers
1. Velocita verso primo E2E (ridurre Fase 4 a 6 tool core)
2. Massimizzare riutilizzo codice figma-use per CREATE_FROM_JSX
3. System prompt risolto tramite DefaultResourceLoader

### Alternative considerate
- **Opzione A (scelta)**: Widget API per CREATE_FROM_JSX
- **Opzione B (fallback)**: API native Figma per CREATE_FROM_JSX
- **Opzione C (invalidata)**: JSON Tree diretto invece di JSX — invalidata perche JSX e piu naturale per l'LLM e piu compatto in token

### Perche scelta
L'Opzione A massimizza il riutilizzo del codice figma-use gia testato in produzione. Il rischio (Widget API non disponibile) e mitigabile con uno spike di 30 minuti prima di investire nella Fase 2b. Se lo spike fallisce, l'Opzione B e una reimplementazione gestibile (300-400 LOC con API standard).

### Decisioni aggiuntive (iter. 2)

**D-IT2-1: Fase 2b fuori dal percorso critico**
Il MILESTONE E2E non richiede il fork del plugin. I 6 tool core funzionano con il plugin base via `executeCodeViaUI()`. Questo sblocca il milestone senza attendere lo spike Widget API e il porting CREATE_FROM_JSX.

**D-IT2-2: Helper wrapFigmaTool()**
Tutti i tool Figma usano un helper centralizzato che wrappa `(params) => result` nella signature completa di `ToolDefinition.execute`. Questo isola la complessita di Pi SDK (toolCallId, signal, onUpdate, ctx) in un unico punto e garantisce gestione uniforme di AbortSignal, errori, e OperationQueue.

**D-IT2-3: IFigmaConnectorExtended (non modifica diretta)**
I metodi aggiuntivi (createFromJsx, createIcon, bindVariable) vanno in un'interfaccia estesa `IFigmaConnectorExtended extends IFigmaConnector`. L'interfaccia upstream non viene modificata, preservando la possibilita di sync futuri.

**D-IT2-4: Build system plugin con esbuild**
Il fork del plugin richiede un build step per bundlare dipendenze npm in un singolo file JS (sandbox Figma non ha `require()`). Si usa esbuild (gia presente come dev dependency) con un script dedicato `scripts/build-plugin.mjs`.

### Conseguenze
- Lo spike (Fase 0) diventa bloccante per la Fase 2b ma NON per il MILESTONE E2E
- Il piano ha un branch point: dopo Fase 0, si sceglie A o B per CREATE_FROM_JSX
- Le Fasi 1, 2, 3, 6, 7 non sono impattate dalla scelta
- Pi SDK va pinnato a `0.60.0` esatta per evitare breaking changes
- Tutti i tool usano `wrapFigmaTool()` — nessuna implementazione diretta della signature completa

### Follow-up
- Dopo Milestone E2E: valutare se aggiungere cache icone su disco
- Dopo Fase 4b: misurare latenza multi-tool vs figma_render_jsx per layout complessi
- Dopo Fase 8: valutare se sostituire esbuild runtime con parser JSX dedicato
- Monitorare upstream figma-console-mcp per aggiornamenti al plugin base
- (iter. 2) Verificare se `@iconify/core` e necessario o se `@iconify/utils` e sufficiente (risolto in Fase 1)

---

## 9. Changelog Iterazione 2

> Integrazione feedback Architect (P1-P6) e Critic (M1-M3, m1-m5, What's Missing)

### MAJOR Fixes

| ID | Problema | Fix applicato |
|----|----------|---------------|
| M1 | Fase 2b nel percorso critico MILESTONE E2E | Rimossa 2b dalle dipendenze MILESTONE. Nuovo percorso: `1->2->3->4a->5->[6+7]->MILESTONE->0->2b->4b->8`. Aggiunta nota su verifica plugin base in Fase 3. |
| M2 | ToolDefinition.execute signature non documentata (mancano toolCallId, signal, onUpdate, ctx) | Aggiunto task `wrapFigmaTool()` in Fase 4a con gestione AbortSignal, error wrapping, OperationQueue, campo label |
| M3 | Build system plugin fork non pianificato (sandbox Figma senza require) | Aggiunto task `scripts/build-plugin.mjs` in Fase 2b con nota su dipendenze (svgpath/d3-hierarchy potrebbero non servire) |

### Minor Fixes

| ID | Problema | Fix applicato |
|----|----------|---------------|
| m1 | `@iconify/core` vs `@iconify/utils` | Entrambi aggiunti nelle dipendenze Fase 1 |
| m2 | Pi SDK `^0.60.0` vs `0.60.0` | Pinnato a `0.60.0` esatta, aggiunto in acceptance criteria Fase 1 |
| m3 | Test unitari non assegnati a fasi | Creata tabella test-fase nella sezione 7, ogni test assegnato alla fase corrispondente |
| m4 | `IFigmaConnectorExtended` vs modifica diretta | Decisione D-IT2-3: interfaccia estesa, upstream non modificata |
| m5 | Campo `label` mancante in ToolDefinition | Aggiunto in wrapFigmaTool e acceptance criteria Fase 4a |

### What's Missing (risolti)

| Problema | Fix applicato |
|----------|---------------|
| `loader.reload()` potenzialmente necessario | Aggiunto task verifica in Fase 5 |
| `AgentToolResult` format non documentato | Aggiunto test unitario in Fase 4a |
| Gestione `AbortSignal` nei tool | Integrato in `wrapFigmaTool()` (Fase 4a) con propagation e early-exit |

### Problemi Architect (P1-P6)

| ID | Problema | Fix applicato |
|----|----------|---------------|
| P1 | IFigmaConnector modifica diretta | -> IFigmaConnectorExtended (D-IT2-3) |
| P2 | ToolDefinition signature | -> wrapFigmaTool (coperto da M2) |
| P3 | WebSocket multi-file | fileKey aggiunto in Fase 4b |
| P4 | Build system plugin | -> scripts/build-plugin.mjs (coperto da M3) |
| P5 | DefaultResourceLoader reload() | -> verifica in Fase 5 |
| P6 | AgentSessionEvent shape | -> mini-script verifica pre-Fase 5 |
