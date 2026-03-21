# Figma Cowork — Piano di Implementazione

## Cosa stiamo costruendo

Un'app desktop macOS che fa design pair-programming: l'utente descrive cosa vuole, un agente AI opera su Figma Desktop, mostra screenshot del risultato, l'utente corregge, l'agente itera.

## Decisioni prese

| Decisione | Scelta | Perché |
|-----------|--------|--------|
| Agent SDK | **pi SDK** (`@mariozechner/pi-coding-agent`) | Richiesto. `createAgentSession()` + `customTools` |
| Desktop framework | **Electron 41** | Pi SDK è Node.js, Electron lo esegue nativamente (Node 24.14) |
| Integrazione Figma | **Embed transport layer** (Opzione B) | Pi SDK non ha MCP nativo → embed è l'unica via pulita. Elimina zombie, single process, lifecycle controllato |
| Sorgenti da embeddare | ~2,900 righe da `figma-console-mcp/src/core/` | Self-contained, 2 deps (ws, pino), MIT license |
| Desktop Bridge Plugin | **Fork custom** del plugin di figma-console-mcp | Aggiunge comandi nativi: `CREATE_FROM_JSX`, `CREATE_ICON`, `BIND_VARIABLE`. Portati da figma-use (MIT) |
| Tool approach | `figma_execute` come jolly + ~28 tool dedicati | Sistema prompt ricco > tanti tool generici |
| UI | HTML/CSS/JS vanilla nel renderer | Minimo viable, no framework |

## Architettura

```
┌──────────────────── Electron Main Process ────────────────────┐
│                                                                │
│  FigmaWebSocketServer (porta 9223)                            │
│       ↕ WebSocket                                              │
│  WebSocketConnector (IFigmaConnector)                         │
│       ↕ metodi diretti                                         │
│  OperationQueue (mutex per serializzare mutazioni)            │
│       ↕                                                        │
│  Pi SDK AgentSession                                           │
│    - customTools: ~28 Figma tools (TypeBox schemas)           │
│    - tools: [] (nessun tool di coding)                        │
│    - System prompt: condensato da figma-console-mastery       │
│    - Session: in-memory                                        │
│       ↕ IPC (contextBridge)                                    │
│  Electron Renderer                                             │
│    - Chat UI con screenshot inline                            │
│    - Status connessione Figma                                  │
│    - Tool execution indicators                                 │
└────────────────────────────────────────────────────────────────┘
         ↕ WebSocket (ws://localhost:9223)
┌────────────────────────────────────────────────────────────────┐
│  Figma Desktop + Desktop Bridge Plugin (code.js + ui.html)    │
└────────────────────────────────────────────────────────────────┘
```

## Struttura file

```
figma-cowork/
├── package.json
├── tsconfig.json
├── scripts/
│   ├── build.mjs              # esbuild: main + preload → dist/
│   └── check-upstream.sh      # Diff contro figma-console-mcp upstream
│
├── src/
│   ├── main/
│   │   ├── index.ts           # Electron app: BrowserWindow, cleanup handlers
│   │   ├── figma-core.ts      # Avvia WS server, crea connector, attende plugin
│   │   ├── agent.ts           # createAgentSession + customTools + system prompt
│   │   ├── operation-queue.ts # Mutex per serializzare mutazioni Figma
│   │   ├── tools/             # ~28 ToolDefinition per pi SDK, divisi per categoria
│   │   │   ├── index.ts       # Esporta tutti i tool
│   │   │   ├── core.ts        # execute, screenshot, status, selection
│   │   │   ├── discovery.ts   # file data, search, library, component details, design system
│   │   │   ├── components.ts  # instantiate, instance properties, arrange
│   │   │   ├── manipulation.ts # fills, strokes, text, image, resize, move, create, clone, delete
│   │   │   ├── tokens.ts      # setup tokens, rename, lint
│   │   │   └── jsx-render.ts  # render_jsx, create_icon, bind_variable (logica client-side)
│   │   ├── icon-loader.ts     # Fetch SVG da Iconify API (portato da figma-use/render/icon.ts)
│   │   ├── jsx-parser.ts      # JSX string → TreeNode (portato da figma-use/render/mini-react + tree)
│   │   ├── system-prompt.ts   # Prompt condensato da figma-console-mastery
│   │   ├── ipc-handlers.ts    # IPC: connect, prompt, abort, status
│   │   └── preload.ts         # contextBridge API per renderer
│   │
│   ├── figma/                 # Embeddato da figma-console-mcp (MIT, commit ref in UPSTREAM.md)
│   │   ├── UPSTREAM.md        # Commit di riferimento, istruzioni sync
│   │   ├── websocket-server.ts
│   │   ├── websocket-connector.ts
│   │   ├── figma-connector.ts
│   │   ├── figma-api.ts
│   │   ├── port-discovery.ts
│   │   ├── logger.ts
│   │   └── types.ts
│   │
│   └── renderer/
│       ├── index.html         # Layout: header + chat + input
│       ├── styles.css         # macOS-native look, dark mode, accent viola Figma
│       └── app.js             # Logica chat: messaggi, streaming, screenshot inline
│
├── figma-desktop-bridge/      # Fork custom del plugin di figma-console-mcp
│   ├── code.js               # Originale + handler da figma-use: CREATE_FROM_JSX, CREATE_ICON, BIND_VARIABLE
│   ├── ui.html               # Originale (gestisce routing WS comandi → code.js)
│   ├── manifest.json          # Originale (ha già permissions: teamlibrary)
│   └── UPSTREAM.md            # Tracking: commit figma-console-mcp + commit figma-use
│
└── resources/
    └── icon.icns
```

## Fasi di implementazione

### Fase 1 — Scaffold progetto
- `package.json` con tutte le dipendenze
- `tsconfig.json` per ESM
- `scripts/build.mjs` con esbuild (main + preload bundles)
- `.gitignore`
- Verificare che `npm install` e build funzionino

### Fase 2 — Embed figma core
- Copiare i 7 file da `/Users/afato/Projects/forks/figma-console-mcp/src/core/`
- Adattare imports (paths relativi, rimuovere .js extensions se necessario)
- Semplificare `config.ts` (solo local mode)
- Semplificare `logger.ts` (o sostituire con console per ora)
- Merge dei types necessari in un singolo `types.ts`
- Creare `src/figma/UPSTREAM.md` con commit di riferimento
- **Verifica**: import di `FigmaWebSocketServer` e `WebSocketConnector` compila senza errori

### Fase 2b — Fork Desktop Bridge Plugin
- Copiare `figma-desktop-bridge/` da figma-console-mcp come base
- Aggiungere a `code.js` i 3 nuovi handler portati da figma-use:
  - **`CREATE_FROM_JSX`**: riceve un albero JSX serializzato (TreeNode), crea i nodi Figma usando Widget API (`figma.widget.h`). Portato dal handler `create-from-jsx` di `figma-use/packages/plugin/src/rpc.ts` (~1,884 righe nella versione completa, da ridurre al core necessario: shorthand expansion + node creation + auto-layout + text + fill/stroke + icon SVG injection)
  - **`CREATE_ICON`**: riceve SVG string + size + color, crea un nodo vettore. Logica da `figma-use` icon handling
  - **`BIND_VARIABLE`**: riceve nodeId + variableName + property (fill/stroke), linka il nodo alla variabile Figma per nome usando `figma.variables.setBoundVariableForPaint()`
- Aggiungere routing in `ui.html` per i nuovi comandi (forwarding WS → postMessage → code.js)
- Aggiungere metodi corrispondenti a `WebSocketConnector`:
  - `createFromJsx(tree, opts)` → `sendCommand('CREATE_FROM_JSX', ...)`
  - `createIcon(svgData, size, color, opts)` → `sendCommand('CREATE_ICON', ...)`
  - `bindVariable(nodeId, variableName, property)` → `sendCommand('BIND_VARIABLE', ...)`
- Aggiungere i metodi a `IFigmaConnector` interface
- Creare `figma-desktop-bridge/UPSTREAM.md` con commit di riferimento di entrambi i progetti
- **Verifica**: plugin si carica in Figma, i nuovi comandi funzionano via WS

### Fase 3 — Figma core runtime
- `figma-core.ts`: avvia WebSocket server, crea connector, gestisce lifecycle
- `operation-queue.ts`: mutex per serializzare mutazioni
- Cleanup handlers: `process.on('exit')`, `SIGINT`, `SIGTERM`, `uncaughtException`
- Port advertisement e cleanup
- **Verifica**: il server WS parte, il Desktop Bridge Plugin si connette

### Fase 4 — Tool definitions
- `tools.ts`: ~28 `ToolDefinition[]` per pi SDK con TypeBox schemas, organizzati per categoria:
  - Core: `figma_execute`, `figma_screenshot`, `figma_screenshot_rest`, `figma_status`, `figma_get_selection`
  - Discovery: `figma_get_file_data`, `figma_search_components`, `figma_get_library_components`, `figma_get_component_details`, `figma_design_system`
  - Componenti: `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set`
  - Manipolazione: `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_set_image_fill`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`
  - Token & qualità: `figma_setup_tokens`, `figma_rename`, `figma_lint`
  - Da figma-use: `figma_render_jsx`, `figma_create_icon`, `figma_bind_variable`
- Ogni tool di mutazione chiama `connector.metodo()` via `operationQueue.execute()`
- `figma_render_jsx`: client-side JSX parse (mini-react tree) + icon prefetch (Iconify API) → `connector.createFromJsx(tree, opts)`
- `figma_create_icon`: fetch SVG da Iconify API → `connector.createIcon(svg, size, color, opts)`
- `figma_bind_variable`: `connector.bindVariable(nodeId, variableName, property)`
- **Verifica**: i tool compilano, i tipi sono corretti

### Fase 5 — Pi SDK Agent
- `system-prompt.ts`: prompt Figma-specializzato (~4000-6000 token)
  - Identità e workflow (design pair-programming)
  - Decision matrix aggiornata:
    - Layout complesso? → `figma_render_jsx` (un roundtrip, JSX con shorthand Tailwind)
    - Singola proprietà? → tool dedicato (`figma_set_fills`, `figma_set_text`, ...)
    - Operazione non coperta? → `figma_execute` con script Plugin API
    - Serve icona? → `figma_create_icon` con nome Iconify
    - Componente da libreria? → `figma_get_library_components` → `figma_instantiate`
    - Design token? → `figma_bind_variable` per linkare, `figma_setup_tokens` per creare
    - Validazione? → `figma_screenshot` SEMPRE dopo mutazioni
  - Pattern figma_execute (async IIFE, load font, layoutMode prima di padding)
  - Pattern figma_render_jsx (shorthand reference, elementi supportati, Icon syntax)
  - Anti-pattern critici (da figma-console-mastery)
- `agent.ts`: `createAgentSession()` con:
  - `customTools`: i ~28 tool da tools/
  - `tools: []` (nessun tool coding)
  - `resourceLoader`: system prompt custom
  - `sessionManager`: in-memory
  - `authStorage` e `modelRegistry`: default
- **Verifica**: l'agente parte, risponde a un prompt di test

### Fase 6 — Electron shell
- `index.ts`: `app.whenReady()`, `BrowserWindow` con `titleBarStyle: "hiddenInset"`
- `preload.ts`: `contextBridge.exposeInMainWorld("figma", { ... })`
- `ipc-handlers.ts`: `agent:prompt`, `agent:abort`, `agent:status`
  - Streaming: `session.subscribe()` → `webContents.send()` per text_delta, tool events
- **Verifica**: finestra Electron si apre, IPC funziona

### Fase 7 — Chat UI
- `index.html`: header (status + titolo) + chat area + input area
- `styles.css`: dark/light mode, accent `#A259FF`, macOS-native feel
- `app.js`:
  - Invio messaggi, rendering bolle user/assistant
  - Streaming text (append progressivo)
  - Tool execution cards (nome tool, spinner → ✅/❌)
  - Screenshot inline (base64 images dal tool figma_screenshot)
  - Markdown rendering basico (bold, code blocks, liste)
  - Auto-scroll
- **Verifica**: chat end-to-end funzionante

### Fase 8 — Polish e test
- Gestione token Figma (input al primo avvio, salvataggio sicuro via `safeStorage`)
- Gestione errori (connessione persa, tool failure, model unavailable)
- Status bar con indicatore connessione plugin
- Test end-to-end: "Crea un bottone blu con testo bianco" → verifica in Figma
- Packaging: `electron-builder --mac` → `.dmg`

## Dipendenze

```
Runtime:
  @mariozechner/pi-coding-agent  ^0.60.0   # Agent SDK
  @mariozechner/pi-ai            ^0.60.0   # Model utilities
  @sinclair/typebox              ^0.34.0   # Tool parameter schemas
  ws                             ^8.19.0   # WebSocket (per Figma bridge)
  pino                           ^9.5.0    # Logger (usato dai moduli figma)
  pino-pretty                    ^13.0.0   # Logger formatting
  @iconify/utils                 ^2.0.0    # Iconify icon loading per figma_create_icon / figma_render_jsx

Dev:
  electron                       ^41.0.0   # Desktop framework
  electron-builder               ^26.0.0   # Packaging macOS .app
  esbuild                        ^0.25.0   # Bundle main + preload
  typescript                     ^5.8.0    # Type checking
  @types/ws                      ^8.18.0
  @types/node                    ^22.0.0
```

## Tool set (~25 tool)

I tool sono divisi in 5 categorie. I tool di mutazione (✅) passano attraverso `OperationQueue`.

### Core (5 tool)

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 1 | `figma_execute` | `connector.executeCodeViaUI(code, timeout)` | ✅ | Jolly: accesso completo Plugin API |
| 2 | `figma_screenshot` | `connector.captureScreenshot(nodeId, opts)` | ❌ | Validazione visiva — SEMPRE dopo mutazioni |
| 3 | `figma_screenshot_rest` | `figmaAPI.getImages(fileKey, nodeId, opts)` | ❌ | Screenshot via REST API (non richiede plugin attivo su quel nodo) |
| 4 | `figma_status` | `wsServer.isClientConnected()` + `getConnectedFileInfo()` | ❌ | Stato connessione, file aperti |
| 5 | `figma_get_selection` | `wsServer.getCurrentSelection()` | ❌ | Nodi selezionati dall'utente in Figma |

### Discovery & Ispezione (5 tool)

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 6 | `figma_get_file_data` | `figmaAPI.getFile(key, opts)` | ❌ | Struttura file, pagine, layer tree. Partire con depth=1, verbosity=summary |
| 7 | `figma_search_components` | `connector.getLocalComponents()` + filtro OPPURE `figmaAPI.getComponents(libraryFileKey)` per librerie | ❌ | Cerca componenti per nome — nel file corrente O in una libreria pubblicata (passando `libraryFileKey`) |
| 8 | `figma_get_library_components` | `figmaAPI.getComponents(fileKey)` + `figmaAPI.getComponentSets(fileKey)` | ❌ | Elenca tutti i componenti di una libreria pubblicata. Restituisce key per istanziazione cross-file |
| 9 | `figma_get_component_details` | `connector.getComponentFromPluginUI(nodeId)` | ❌ | Dettagli componente: varianti, proprietà, key per istanziazione |
| 10 | `figma_design_system` | `connector.getVariables()` + `connector.getLocalComponents()` | ❌ | Overview design system: token collections, stili, componenti |

### Componenti & Librerie (3 tool)

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 11 | `figma_instantiate` | `connector.instantiateComponent(key, opts)` | ✅ | Istanzia componente locale O da libreria pubblicata. Il plugin usa `figma.importComponentByKeyAsync()` per le librerie — basta passare la `componentKey` ottenuta da `figma_get_library_components` |
| 12 | `figma_set_instance_properties` | `connector.setInstanceProperties(nodeId, props)` | ✅ | Modifica proprietà di un'istanza (TEXT, BOOLEAN, VARIANT, INSTANCE_SWAP) |
| 13 | `figma_arrange_component_set` | `connector.executeCodeViaUI(arrangeScript)` | ✅ | Organizza varianti in griglia con visualizzazione nativa Figma |

### Manipolazione nodi (9 tool)

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 14 | `figma_set_fills` | `connector.setNodeFills(nodeId, fills)` | ✅ | Colori di riempimento (hex, gradienti) |
| 15 | `figma_set_strokes` | `connector.setNodeStrokes(nodeId, strokes, weight)` | ✅ | Bordi |
| 16 | `figma_set_text` | `connector.setTextContent(nodeId, text, opts)` | ✅ | Contenuto testo + opzioni font |
| 17 | `figma_set_image_fill` | `connector.setImageFill(nodeIds, imageData, scaleMode)` | ✅ | Riempimento immagine (base64 JPEG/PNG) |
| 18 | `figma_resize` | `connector.resizeNode(nodeId, w, h)` | ✅ | Dimensioni |
| 19 | `figma_move` | `connector.moveNode(nodeId, x, y)` | ✅ | Posizione |
| 20 | `figma_create_child` | `connector.createChildNode(parentId, type, props)` | ✅ | Crea nodo figlio (RECTANGLE, ELLIPSE, FRAME, TEXT, LINE) |
| 21 | `figma_clone` | `connector.cloneNode(nodeId)` | ✅ | Duplica nodo |
| 22 | `figma_delete` | `connector.deleteNode(nodeId)` | ✅ | Elimina nodo |

### Token & Qualità (3 tool)

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 23 | `figma_setup_tokens` | `connector.createVariableCollection()` + batch | ✅ | Crea token collection con modi e variabili in un colpo |
| 24 | `figma_rename` | `connector.renameNode(nodeId, name)` | ✅ | Rinomina nel layer panel |
| 25 | `figma_lint` | `connector.lintDesign(nodeId, rules)` | ❌ | Audit WCAG accessibilità + qualità design |

### Da figma-use (3 tool) — richiedono fork del Desktop Bridge Plugin

| # | Tool | Backend | Mut? | Note |
|---|------|---------|:---:|------|
| 26 | `figma_render_jsx` | Client: JSX string → mini-react tree + Iconify prefetch. Plugin: `CREATE_FROM_JSX` handler crea l'intero albero di nodi in un roundtrip | ✅ | **Da figma-use.** Crea interi layout da JSX con shorthand Tailwind-like (`bg`, `p`, `rounded`, `flex`, `gap`). Un singolo tool crea ciò che altrimenti richiederebbe 5-15 chiamate separate. Supporta: Frame, Text, Rectangle, Ellipse, Line, Image, SVG, Icon. |
| 27 | `figma_create_icon` | Client: fetch SVG da Iconify API. Plugin: `CREATE_ICON` handler crea nodo vettore da SVG string | ✅ | **Da figma-use.** Accesso a 150,000+ icone per nome (`mdi:home`, `lucide:star`, `heroicons:arrow-right`). L'agente può inserire qualsiasi icona senza asset manuali. |
| 28 | `figma_bind_variable` | Plugin: `BIND_VARIABLE` handler usa `figma.variables.setBoundVariableForPaint()` per linkare fill/stroke a un token | ✅ | **Da figma-use.** Linka il colore di un nodo a una variabile/token Figma per nome, non solo setta un valore hex. Essenziale per design che rispettano il design system. |

### Workflow JSX rendering (da figma-use)

Il flusso per creare layout complessi in un singolo roundtrip:

```
1. L'LLM genera JSX con shorthand Tailwind-like:

   <Frame style={{p: 24, gap: 16, flex: "col", bg: "#FFF", rounded: 12}}>
     <Text style={{size: 24, weight: "bold", color: "#000"}}>Card Title</Text>
     <Text style={{size: 14, color: "#666"}}>Description text</Text>
     <Frame style={{flex: "row", gap: 8}}>
       <Icon icon="lucide:heart" size={20} color="#EF4444" />
       <Text style={{size: 14, color: "#EF4444"}}>42 likes</Text>
     </Frame>
   </Frame>

2. figma_render_jsx (client-side):
   a. Parse JSX → TreeNode (mini-react, ~33 righe da figma-use)
   b. Risolvi <Icon> → fetch SVG da Iconify API, sostituisci con nodi SVG
   c. Serializza tree come JSON

3. connector.createFromJsx(tree, { x, y, parentId })
   → WebSocket → plugin code.js → CREATE_FROM_JSX handler

4. Il plugin (CREATE_FROM_JSX handler nel fork):
   a. Riceve TreeNode serializzato
   b. Espande shorthand (bg→fill, p→padding, rounded→cornerRadius, flex→layoutMode)
   c. Crea nodi ricorsivamente con figma.widget API o figma.create*()
   d. Applica auto-layout, fill, stroke, text, corner radius
   e. Restituisce { nodeId, childIds } del tree creato

5. figma_screenshot(nodeId) per validazione visiva
```

**Perché è più efficiente di figma_execute:**
- Un singolo tool call vs 5-15 chiamate `create_child` + `set_fills` + `set_text` + ...
- L'LLM genera JSX naturalmente (milioni di componenti React nel training data)
- Shorthand compatti riducono i token: `bg="#FFF"` vs `{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }`
- Il plugin fa tutto il lavoro pesante in un unico roundtrip

### Workflow librerie pubblicata (cross-file)

Il flusso per usare componenti da una libreria pubblicata senza copia-incolla manuale:

```
1. figma_get_library_components(libraryFileKey: "abc123")
   → Restituisce lista di component sets con { name, key, variants }

2. figma_search_components(query: "Button", libraryFileKey: "abc123")
   → Filtra per nome nella libreria

3. figma_instantiate(componentKey: "key_from_step_1_or_2")
   → Il plugin esegue figma.importComponentByKeyAsync(key)
   → Il componente viene importato dalla libreria e piazzato nel file corrente
   → Funziona per componenti pubblicati senza alcun copia-incolla

4. figma_set_instance_properties(nodeId: "istanza_creata", properties: {...})
   → Configura TEXT, BOOLEAN, VARIANT dell'istanza importata
```

Questo è possibile perché:
- `FigmaAPI.getComponents(fileKey)` e `FigmaAPI.getComponentSets(fileKey)` usano la REST API per leggere qualsiasi file accessibile con il token
- Il plugin Desktop Bridge chiama `figma.importComponentByKeyAsync(componentKey)` che importa automaticamente componenti pubblicati da qualsiasi libreria abilitata nel team
- Il manifest del plugin ha `"permissions": ["teamlibrary"]` che abilita l'accesso
