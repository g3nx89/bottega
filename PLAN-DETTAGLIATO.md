# Figma Cowork — Piano Dettagliato di Implementazione

> Generato il 2026-03-18. Basato su PLAN.md + ricerca upstream repos + API Pi SDK v0.60.0.

## Stato attuale

- **Codice scritto**: nessuno — solo PLAN.md e CLAUDE.md
- **Upstream disponibili localmente**:
  - `~/Projects/forks/figma-console-mcp/` — commit `ae19af8` (v1.14.0, 2026-03-18)
  - `~/Projects/forks/figma-use/` — commit `3971ea8` (2026-03-18)
- **Pi SDK**: v0.60.0 installato globalmente (Node v24.13.0)
- **Git**: repo non ancora inizializzato

## Dipendenze tra fasi

```
Fase 1 (scaffold) ─────────────────────────┐
    │                                        │
    ├── Fase 2 (embed figma core)            │
    │       │                                │
    │       ├── Fase 2b (fork plugin)        │ (parallelo)
    │       │                                │
    │       └── Fase 3 (figma runtime)       │
    │               │                        │
    │               └── Fase 4 (tools) ──────┤
    │                       │                │
    │                       └── Fase 5 (agent)
    │                               │
    ├── Fase 6 (electron shell) ────┤ (parallelo con 2-5)
    │                               │
    └── Fase 7 (chat UI) ──────────┘
                    │
                    └── Fase 8 (polish)
```

**Percorso critico**: 1 → 2 → 3 → 4 → 5 → integrazione con 6+7 → 8

**Parallelismo possibile**:
- Fase 6 (Electron shell) può iniziare dopo Fase 1, in parallelo con 2-5
- Fase 7 (Chat UI) può iniziare dopo Fase 1, in parallelo con 2-5
- Fase 2b (plugin fork) può iniziare in parallelo con Fase 2

---

## Fase 1 — Scaffold progetto

**Obiettivo**: progetto compila e produce un bundle vuoto.

### 1.1 — Inizializzare git e package.json

**File**: `package.json`

```jsonc
{
  "name": "figma-cowork",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "node scripts/build.mjs",
    "start": "npm run build && npx electron dist/main.js",
    "typecheck": "tsc --noEmit",
    "package": "npm run build && npx electron-builder --mac"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.60.0",
    "@mariozechner/pi-ai": "^0.60.0",
    "@sinclair/typebox": "^0.34.0",
    "ws": "^8.19.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "@iconify/utils": "^2.0.0"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-builder": "^26.0.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.8.0",
    "@types/ws": "^8.18.0",
    "@types/node": "^22.0.0"
  }
}
```

**Nota critica su @iconify/utils**: figma-use usa `@iconify/core` con `loadIcon()` e `iconToSVG()` da `@iconify/utils`. Verificare che `@iconify/utils` esporti queste funzioni, altrimenti usare `@iconify/core` + `@iconify/utils` come peer. La versione render di figma-use importa:
```ts
import { loadIcon } from '@iconify/core'
import { iconToSVG } from '@iconify/utils'
```
Potrebbe servire anche `@iconify/core` come dipendenza.

### 1.2 — tsconfig.json

**File**: `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "figma-desktop-bridge"]
}
```

**Nota**: `moduleResolution: "bundler"` permette imports senza `.js` extension — esbuild risolve tutto.

### 1.3 — scripts/build.mjs

**File**: `scripts/build.mjs`

Due bundle separati:
1. **main bundle** (`src/main/index.ts` → `dist/main.js`): platform `node`, external `electron`
2. **preload bundle** (`src/main/preload.ts` → `dist/preload.js`): platform `node`, external `electron`

```js
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['electron'],
}

await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.js' }),
  build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js' }),
])

// Copiare renderer assets (HTML/CSS/JS) in dist/renderer/
import { cpSync } from 'fs'
cpSync('src/renderer', 'dist/renderer', { recursive: true })
```

**Attenzione**: `ws` e `pino` devono essere bundlati (non external) oppure risolti da node_modules a runtime. esbuild li bundla di default — OK per Electron main process.

### 1.4 — .gitignore

```
node_modules/
dist/
*.dmg
.DS_Store
```

### 1.5 — File stub per compilazione

Creare file minimi per verificare che il build funzioni:
- `src/main/index.ts` → `console.log('Figma Cowork starting...')`
- `src/main/preload.ts` → `console.log('preload')`
- `src/renderer/index.html` → HTML vuoto con titolo

### Verifica Fase 1

```bash
git init && git add -A && git commit -m "chore: scaffold progetto"
npm install
node scripts/build.mjs          # → dist/main.js, dist/preload.js, dist/renderer/
npx tsc --noEmit                # → nessun errore
npx electron dist/main.js       # → processo parte senza crash
```

---

## Fase 2 — Embed figma core

**Obiettivo**: i moduli WebSocket server, connector e API Figma sono importabili dal nostro codice.

### Sorgenti da copiare

Da `~/Projects/forks/figma-console-mcp/src/core/`:

| File upstream (LOC) | → Destinazione | Modifiche |
|---|---|---|
| `websocket-server.ts` (786) | `src/figma/websocket-server.ts` | Rimuovere cloud relay, semplificare. Tenere: multi-client, sendCommand, eventi |
| `websocket-connector.ts` (301) | `src/figma/websocket-connector.ts` | Aggiungere 3 metodi per figma-use (createFromJsx, createIcon, bindVariable) |
| `figma-connector.ts` (74) | `src/figma/figma-connector.ts` | Aggiungere 3 metodi all'interfaccia IFigmaConnector |
| `figma-api.ts` (540) | `src/figma/figma-api.ts` | Copiare as-is, serve per REST API calls |
| `port-discovery.ts` (308) | `src/figma/port-discovery.ts` | Semplificare: solo porta fissa 9223 (non serve discovery multi-istanza per MVP) |
| `logger.ts` (72) | `src/figma/logger.ts` | Sostituire con wrapper pino o console.log |
| `config.ts` (178) | `src/figma/config.ts` | Ridurre drasticamente: solo `{ mode: 'local', port: 9223 }` |
| `types/index.ts` (123) | `src/figma/types.ts` | Copiare, mergiare i tipi necessari |

**NON copiare** (non servono per MVP):
- `cloud-websocket-connector.ts` / `cloud-websocket-relay.ts` (cloud mode)
- `console-monitor.ts` (monitoring plugin console)
- `figma-desktop-connector.ts` (Puppeteer/CDP — noi usiamo WebSocket)
- `figma-tools.ts` / `write-tools.ts` / `comment-tools.ts` / `design-system-tools.ts` (MCP tools — noi li riscriviamo come Pi SDK ToolDefinition)
- `design-code-tools.ts` / `design-system-manifest.ts` / `figma-reconstruction-spec.ts` / `figma-style-extractor.ts` / `snippet-injector.ts` (features avanzate)
- `enrichment/` (node enrichment pipeline)

### 2.1 — Copiare e adattare websocket-server.ts

**Interventi**:
1. Rimuovere tutto il codice cloud relay (`cloudRelayUrl`, `cloudConnections`, ecc.)
2. Mantenere:
   - `FigmaWebSocketServer` class con `Map<string, ClientConnection>`
   - `sendCommand(method, params, timeout, targetFileKey)` con Promise correlation
   - Eventi: `connected`, `disconnected`, `fileConnected`, `selectionChange`
   - Port range: ridurre a solo 9223 (configurabile)
   - CSWSH validation
   - `_pendingClients` → `clients` promotion flow
3. Fix imports: tutti i path devono essere relativi dentro `src/figma/`

**Attenzione**: `ws` import. Upstream usa `import { WebSocketServer } from 'ws'`. Verificare che funzioni con esbuild bundling. Se problemi, marcare `ws` come external in esbuild e lasciarlo in node_modules.

### 2.2 — Copiare e adattare websocket-connector.ts

**Interventi**:
1. Copiare as-is la classe `WebSocketConnector implements IFigmaConnector`
2. **Aggiungere 3 nuovi metodi** per figma-use:

```ts
// Nuovo: crea albero nodi da TreeNode serializzato
async createFromJsx(tree: TreeNode, opts?: { x?: number; y?: number; parentId?: string }): Promise<{ nodeId: string; childIds: string[] }> {
  return this.wsServer.sendCommand('CREATE_FROM_JSX', { tree, ...opts }, 60000);
}

// Nuovo: crea nodo vettore da SVG
async createIcon(svg: string, size: number, color: string, opts?: { x?: number; y?: number; parentId?: string }): Promise<{ nodeId: string }> {
  return this.wsServer.sendCommand('CREATE_ICON', { svg, size, color, ...opts }, 30000);
}

// Nuovo: linka fill/stroke a variabile Figma per nome
async bindVariable(nodeId: string, variableName: string, property: 'fill' | 'stroke'): Promise<void> {
  return this.wsServer.sendCommand('BIND_VARIABLE', { nodeId, variableName, property }, 10000);
}
```

### 2.3 — Adattare figma-connector.ts (interfaccia)

Aggiungere all'interfaccia `IFigmaConnector`:
```ts
createFromJsx(tree: TreeNode, opts?: { x?: number; y?: number; parentId?: string }): Promise<{ nodeId: string; childIds: string[] }>;
createIcon(svg: string, size: number, color: string, opts?: { x?: number; y?: number; parentId?: string }): Promise<{ nodeId: string }>;
bindVariable(nodeId: string, variableName: string, property: 'fill' | 'stroke'): Promise<void>;
```

### 2.4 — Semplificare config.ts

Ridurre a:
```ts
export interface FigmaConfig {
  port: number;
  figmaToken?: string;
}

export function getDefaultConfig(): FigmaConfig {
  return { port: 9223 };
}
```

### 2.5 — Semplificare logger.ts

```ts
import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
```

### 2.6 — types.ts

Copiare da upstream `types/index.ts`. Aggiungere il tipo `TreeNode` (da figma-use):
```ts
export interface TreeNode {
  type: string;
  props: Record<string, unknown>;
  children: (TreeNode | string)[];
  key?: string | number | null;
}
```

### 2.7 — UPSTREAM.md

**File**: `src/figma/UPSTREAM.md`

```md
# Upstream Tracking

## figma-console-mcp
- Repo: https://github.com/southleft/figma-console-mcp
- Commit: ae19af8 (v1.14.0, 2026-03-18)
- Files embedded: websocket-server.ts, websocket-connector.ts, figma-connector.ts, figma-api.ts, port-discovery.ts, logger.ts, config.ts, types.ts
- Modifications: removed cloud relay, simplified config, added 3 methods for figma-use support

## Sync instructions
Run: scripts/check-upstream.sh
```

### Verifica Fase 2

```bash
npx tsc --noEmit   # I 7 file in src/figma/ compilano senza errori
```

Scrivere un test smoke in `src/main/index.ts`:
```ts
import { FigmaWebSocketServer } from '../figma/websocket-server.js'
import { WebSocketConnector } from '../figma/websocket-connector.js'
// Se compila, i moduli sono integrati correttamente
```

---

## Fase 2b — Fork Desktop Bridge Plugin (parallelo con Fase 2)

**Obiettivo**: il plugin Figma gestisce i 35+ comandi originali + 3 nuovi comandi da figma-use.

### Sorgenti

| Sorgente | File | LOC |
|---|---|---|
| `figma-console-mcp/figma-desktop-bridge/code.js` | Base plugin | ~2,800 |
| `figma-console-mcp/figma-desktop-bridge/ui.html` | WebSocket relay | ~450 |
| `figma-console-mcp/figma-desktop-bridge/manifest.json` | Config | ~50 |
| `figma-use/packages/plugin/src/rpc.ts` | Handler da portare | ~4,800 (estrarre ~600 LOC) |
| `figma-use/packages/plugin/src/shared.ts` | Utilities condivise | ~414 |

### 2b.1 — Copiare base plugin

Copiare intera directory `figma-desktop-bridge/` da figma-console-mcp:
- `code.js` — as-is
- `ui.html` — as-is
- `manifest.json` — as-is

### 2b.2 — Aggiungere CREATE_FROM_JSX handler a code.js

**Sorgente**: `figma-use/packages/plugin/src/rpc.ts`, handler `create-from-jsx`

**Cosa estrarre** (stima ~400-600 LOC da aggiungere a code.js):

1. **TYPE_MAP**: mappatura type → funzione di creazione Figma
   ```js
   const TYPE_MAP = {
     frame: 'FRAME', view: 'FRAME', rectangle: 'RECTANGLE', rect: 'RECTANGLE',
     ellipse: 'ELLIPSE', text: 'TEXT', line: 'LINE', svg: 'SVG', image: 'IMAGE'
   };
   ```

2. **Shorthand expansion**: converte props Tailwind-like → proprietà Figma native
   - `bg` → fills con SOLID paint
   - `p/px/py/pt/pr/pb/pl` → paddingTop/Right/Bottom/Left
   - `rounded` → cornerRadius
   - `flex: "row"|"col"` → layoutMode HORIZONTAL/VERTICAL
   - `gap` → itemSpacing
   - `justify` → primaryAxisAlignItems
   - `items` → counterAxisAlignItems
   - `w/h` → width/height (con layoutSizingHorizontal/Vertical = FIXED)
   - `grow` → layoutGrow = 1, layoutSizingHorizontal = FILL
   - `stroke` → strokes paint
   - `shadow` → effects (DROP_SHADOW)
   - `opacity` → opacity
   - `name` → node.name

3. **Funzione ricorsiva createNode(treeNode, parent)**:
   - Crea nodo Figma del tipo corretto
   - Applica proprietà espanse
   - Per TEXT: `figma.loadFontAsync()` prima di settare caratteri
   - Per SVG: `figma.createNodeFromSvg(svgString)`
   - Ricorsione sui children
   - Append al parent

4. **Handler message**:
   ```js
   case 'CREATE_FROM_JSX': {
     const { tree, x, y, parentId } = msg;
     const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
     const rootNode = await createNodeFromTree(tree, parent);
     if (x !== undefined) rootNode.x = x;
     if (y !== undefined) rootNode.y = y;
     figma.viewport.scrollAndZoomIntoView([rootNode]);
     figma.ui.postMessage({
       type: 'CREATE_FROM_JSX_RESULT',
       success: true,
       requestId: msg.requestId,
       nodeId: rootNode.id,
       childIds: collectChildIds(rootNode)
     });
   }
   ```

**Complessità**: La parte più complessa è l'expansion degli shorthand. In figma-use/rpc.ts il codice è ~1,884 righe perché gestisce anche Widget API, component instances, wrapping e molti edge case. Per MVP:
- **Includere**: shorthand base (bg, p, rounded, flex, gap, w, h, stroke, opacity, shadow, name, grow, justify, items)
- **Escludere per ora**: component instances placeholders, variable binding inline, cornerSmoothing individuale, min/maxWidth, blend modes, rotation, wrap layout
- **Font loading**: pattern obbligatorio — `await figma.loadFontAsync({ family, style })` prima di settare text

### 2b.3 — Aggiungere CREATE_ICON handler a code.js

Più semplice (~30 LOC):
```js
case 'CREATE_ICON': {
  const { svg, size, color, x, y, parentId } = msg;
  try {
    const node = figma.createNodeFromSvg(svg);
    node.resize(size, size);
    // Applica colore a tutti i vector children
    const vectors = node.findAll(n => n.type === 'VECTOR');
    vectors.forEach(v => {
      v.fills = [{ type: 'SOLID', color: hexToFigmaRGB(color) }];
    });
    const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
    if (parent && parent !== figma.currentPage) parent.appendChild(node);
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    figma.ui.postMessage({
      type: 'CREATE_ICON_RESULT', success: true,
      requestId: msg.requestId, nodeId: node.id
    });
  } catch (e) {
    figma.ui.postMessage({
      type: 'CREATE_ICON_RESULT', success: false,
      requestId: msg.requestId, error: e.message
    });
  }
}
```

### 2b.4 — Aggiungere BIND_VARIABLE handler a code.js

Da figma-use `bind-fill-variable-by-name` handler (~40 LOC):
```js
case 'BIND_VARIABLE': {
  const { nodeId, variableName, property } = msg;
  try {
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error('Node ' + nodeId + ' not found');

    const variables = await figma.variables.getLocalVariablesAsync('COLOR');
    const variable = variables.find(v => v.name === variableName);
    if (!variable) throw new Error('Variable "' + variableName + '" not found');

    if (property === 'fill' && 'fills' in node) {
      const fills = [...node.fills];
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID') {
          fills[i] = figma.variables.setBoundVariableForPaint(fills[i], 'color', variable);
        }
      }
      node.fills = fills;
    } else if (property === 'stroke' && 'strokes' in node) {
      const strokes = [...node.strokes];
      for (let i = 0; i < strokes.length; i++) {
        if (strokes[i].type === 'SOLID') {
          strokes[i] = figma.variables.setBoundVariableForPaint(strokes[i], 'color', variable);
        }
      }
      node.strokes = strokes;
    }
    figma.ui.postMessage({
      type: 'BIND_VARIABLE_RESULT', success: true, requestId: msg.requestId
    });
  } catch (e) {
    figma.ui.postMessage({
      type: 'BIND_VARIABLE_RESULT', success: false,
      requestId: msg.requestId, error: e.message
    });
  }
}
```

### 2b.5 — Aggiornare ui.html

Aggiungere i 3 nuovi comandi alla `methodMap` in ui.html:

```js
const methodMap = {
  // ... comandi esistenti ...
  'CREATE_FROM_JSX': (params) => sendPluginCommand('CREATE_FROM_JSX', params),
  'CREATE_ICON': (params) => sendPluginCommand('CREATE_ICON', params),
  'BIND_VARIABLE': (params) => sendPluginCommand('BIND_VARIABLE', params),
};
```

E aggiungere matching per `*_RESULT` nel handler onmessage (dovrebbe essere automatico se il pattern `msg.type.endsWith('_RESULT')` è già gestito genericamente).

### 2b.6 — UPSTREAM.md del plugin

**File**: `figma-desktop-bridge/UPSTREAM.md`

```md
# Upstream Tracking

## figma-console-mcp (base plugin)
- Repo: https://github.com/southleft/figma-console-mcp
- Commit: ae19af8 (v1.14.0)
- Files: code.js, ui.html, manifest.json (copiati as-is come base)

## figma-use (handler aggiuntivi)
- Repo: https://github.com/dannote/figma-use
- Commit: 3971ea8
- Code ported: CREATE_FROM_JSX handler (from rpc.ts), CREATE_ICON, BIND_VARIABLE
- Modifications: simplified shorthand expansion, removed Widget API dependency
```

### Verifica Fase 2b

1. Aprire Figma Desktop
2. Plugin → Development → Import plugin from manifest → selezionare `figma-desktop-bridge/manifest.json`
3. Avviare il plugin — verificare che si connette al WebSocket (porta 9223)
4. **Test manuale**: inviare comandi WS di test e verificare che i nodi vengano creati

---

## Fase 3 — Figma core runtime

**Obiettivo**: il WebSocket server parte nel main process, il plugin si connette, possiamo inviare comandi.

### 3.1 — figma-core.ts

**File**: `src/main/figma-core.ts`

Responsabilità:
- Crea e avvia `FigmaWebSocketServer` sulla porta 9223
- Crea `WebSocketConnector` che wrappa il WS server
- Crea `FigmaAPI` (con token configurabile)
- Espone `connector` e `figmaAPI` per i tool
- Gestisce lifecycle: startup, shutdown, reconnection events
- Emette eventi per la UI (plugin connected/disconnected)

```ts
import { FigmaWebSocketServer } from '../figma/websocket-server.js';
import { WebSocketConnector } from '../figma/websocket-connector.js';
import { FigmaAPI } from '../figma/figma-api.js';

export interface FigmaCore {
  wsServer: FigmaWebSocketServer;
  connector: WebSocketConnector;
  figmaAPI: FigmaAPI;
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}

export async function createFigmaCore(config: { port: number; figmaToken?: string }): Promise<FigmaCore> {
  const wsServer = new FigmaWebSocketServer({ port: config.port });
  const connector = new WebSocketConnector(wsServer);
  const figmaAPI = new FigmaAPI(config.figmaToken);

  return {
    wsServer, connector, figmaAPI,
    async start() { await wsServer.start(); },
    async stop() { await wsServer.stop(); },
    isConnected() { return wsServer.isClientConnected(); }
  };
}
```

### 3.2 — operation-queue.ts

**File**: `src/main/operation-queue.ts`

Mutex semplice per serializzare le mutazioni Figma:

```ts
export class OperationQueue {
  private _queue: Promise<any> = Promise.resolve();

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(fn, () => fn());
    this._queue = result.then(() => {}, () => {});
    return result;
  }
}
```

**Perché serve**: se l'agente chiama `figma_set_fills` e `figma_set_text` in parallelo sullo stesso nodo, i comandi WebSocket si sovrappongono e il plugin potrebbe crashare o produrre risultati inconsistenti.

### 3.3 — Cleanup handlers

In `figma-core.ts` o `index.ts`:

```ts
function setupCleanup(figmaCore: FigmaCore) {
  const cleanup = async () => { await figmaCore.stop(); };
  process.on('exit', cleanup);
  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
  process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await cleanup();
    process.exit(1);
  });
}
```

### Verifica Fase 3

```bash
npm run build
npx electron dist/main.js   # Avvia, il server WS parte sulla porta 9223
```

Poi in Figma: avviare il Desktop Bridge Plugin → deve connettersi e loggare `fileConnected`.

---

## Fase 4 — Tool definitions

**Obiettivo**: tutti i ~28 tool sono definiti come `ToolDefinition[]` per Pi SDK.

### Pattern comune per ogni tool

Ogni tool segue questa struttura (dall'API Pi SDK v0.60.0):

```ts
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const params = Type.Object({
  nodeId: Type.String({ description: 'ID del nodo Figma' }),
  // ... altri parametri
});

export const figma_tool_name: ToolDefinition<typeof params> = {
  name: 'figma_tool_name',
  label: 'Tool Label',
  description: 'Descrizione per LLM',
  promptSnippet: 'Una riga per la sezione Available tools nel system prompt',
  parameters: params,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Per tool di mutazione:
    return operationQueue.execute(async () => {
      const result = await connector.metodo(params.arg1, params.arg2);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: {}
      };
    });

    // Per tool di lettura:
    const result = await connector.metodo(params.arg1);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: {}
    };
  }
};
```

**Nota su AgentToolResult**:
- `content`: array di `{ type: 'text', text: string }` o `{ type: 'image', source: { type: 'base64', media_type: string, data: string } }` — inviato al LLM
- `details`: metadata per UI, NON inviato al LLM
- Per screenshot, restituire ImageContent con base64

### 4.1 — tools/core.ts (5 tool)

**`figma_execute`** — Jolly Plugin API
```ts
params: { code: Type.String(), timeout: Type.Optional(Type.Number({ default: 30000 })) }
execute: → operationQueue.execute(() => connector.executeCodeViaUI(code, timeout))
```

**`figma_screenshot`** — Validazione visiva (il tool più importante)
```ts
params: { nodeId: Type.Optional(Type.String()), format: Type.Optional(Type.Union([Type.Literal('png'), Type.Literal('jpg')])) }
execute: → connector.captureScreenshot(nodeId, { format })
// Restituire ImageContent: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }
```

**`figma_screenshot_rest`** — Screenshot via REST API
```ts
params: { fileKey: Type.String(), nodeId: Type.String(), scale: Type.Optional(Type.Number()) }
execute: → figmaAPI.getImages(fileKey, [nodeId], { format: 'png', scale })
```

**`figma_status`** — Stato connessione
```ts
params: Type.Object({})
execute: → { connected: wsServer.isClientConnected(), files: wsServer.getConnectedFileInfo() }
```

**`figma_get_selection`** — Selezione corrente
```ts
params: Type.Object({})
execute: → wsServer.getCurrentSelection()
```

### 4.2 — tools/discovery.ts (5 tool)

**`figma_get_file_data`**
```ts
params: { fileKey: Type.String(), depth: Type.Optional(Type.Number()), nodeId: Type.Optional(Type.String()) }
execute: → figmaAPI.getFile(fileKey, { depth, ids: nodeId ? [nodeId] : undefined })
```

**`figma_search_components`**
```ts
params: { query: Type.String(), libraryFileKey: Type.Optional(Type.String()) }
execute: → se libraryFileKey: figmaAPI.getComponents(libraryFileKey) + filtro
          → altrimenti: connector.getLocalComponents() + filtro
```

**`figma_get_library_components`**
```ts
params: { fileKey: Type.String() }
execute: → { components: await figmaAPI.getComponents(fileKey), componentSets: await figmaAPI.getComponentSets(fileKey) }
```

**`figma_get_component_details`**
```ts
params: { nodeId: Type.String() }
execute: → connector.getComponentFromPluginUI(nodeId)
```

**`figma_design_system`**
```ts
params: Type.Object({})
execute: → { variables: await connector.getVariables(), components: await connector.getLocalComponents() }
```

### 4.3 — tools/components.ts (3 tool)

**`figma_instantiate`**
```ts
params: {
  componentKey: Type.String({ description: 'Component key (da search_components o get_library_components)' }),
  x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()),
  parentId: Type.Optional(Type.String())
}
execute: → operationQueue.execute(() => connector.instantiateComponent(componentKey, { x, y, parentId }))
```

**`figma_set_instance_properties`**
```ts
params: {
  nodeId: Type.String(),
  properties: Type.Record(Type.String(), Type.Any())
}
execute: → operationQueue.execute(() => connector.setInstanceProperties(nodeId, properties))
```

**`figma_arrange_component_set`**
```ts
params: { nodeId: Type.String(), columns: Type.Optional(Type.Number()) }
execute: → operationQueue.execute(() => connector.executeCodeViaUI(`/* arrange script */`))
```

### 4.4 — tools/manipulation.ts (9 tool)

Tutti passano per `operationQueue.execute()`:

| Tool | Params chiave | Backend |
|---|---|---|
| `figma_set_fills` | nodeId, fills (array hex/gradient) | `connector.setNodeFills()` |
| `figma_set_strokes` | nodeId, strokes, weight | `connector.setNodeStrokes()` |
| `figma_set_text` | nodeId, text, fontFamily?, fontSize?, fontWeight? | `connector.setTextContent()` |
| `figma_set_image_fill` | nodeIds, imageUrl/base64, scaleMode | `connector.setImageFill()` |
| `figma_resize` | nodeId, width, height | `connector.resizeNode()` |
| `figma_move` | nodeId, x, y | `connector.moveNode()` |
| `figma_create_child` | parentId, type (FRAME/RECT/TEXT/...), props | `connector.createChildNode()` |
| `figma_clone` | nodeId | `connector.cloneNode()` |
| `figma_delete` | nodeId | `connector.deleteNode()` |

### 4.5 — tools/tokens.ts (3 tool)

**`figma_setup_tokens`**
```ts
params: {
  collectionName: Type.String(),
  modes: Type.Array(Type.String()),
  variables: Type.Array(Type.Object({
    name: Type.String(),
    type: Type.Union([Type.Literal('COLOR'), Type.Literal('FLOAT'), Type.Literal('STRING')]),
    values: Type.Record(Type.String(), Type.Any())
  }))
}
execute: → operationQueue.execute(() => {
  // 1. createVariableCollection
  // 2. addMode per ogni modo
  // 3. createVariable per ogni variabile
  // 4. updateVariable per ogni valore/modo
})
```

**`figma_rename`**
```ts
params: { nodeId: Type.String(), name: Type.String() }
execute: → operationQueue.execute(() => connector.renameNode(nodeId, name))
```

**`figma_lint`**
```ts
params: { nodeId: Type.Optional(Type.String()), rules: Type.Optional(Type.Array(Type.String())) }
execute: → connector.lintDesign(nodeId, rules)
```

### 4.6 — tools/jsx-render.ts (3 tool)

**Questi sono i tool più complessi perché hanno logica client-side.**

**`figma_render_jsx`**
```ts
params: {
  jsx: Type.String({ description: 'JSX string con shorthand Tailwind-like' }),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  parentId: Type.Optional(Type.String())
}
execute: → operationQueue.execute(async () => {
  // 1. Parse JSX → TreeNode (usa jsx-parser.ts)
  const tree = parseJsx(params.jsx);

  // 2. Pre-fetch icone da Iconify (usa icon-loader.ts)
  const icons = collectIconNodes(tree);
  await preloadIcons(icons);
  replaceIconNodesWithSvg(tree);

  // 3. Invia al plugin via WebSocket
  const result = await connector.createFromJsx(tree, { x, y, parentId });
  return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
})
```

**`figma_create_icon`**
```ts
params: {
  name: Type.String({ description: 'Nome Iconify (es: mdi:home, lucide:star)' }),
  size: Type.Optional(Type.Number({ default: 24 })),
  color: Type.Optional(Type.String({ default: '#000000' })),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  parentId: Type.Optional(Type.String())
}
execute: → operationQueue.execute(async () => {
  // 1. Fetch SVG da Iconify API
  const svg = await loadIconSvg(params.name, params.size);

  // 2. Invia al plugin
  const result = await connector.createIcon(svg, size, color, { x, y, parentId });
  return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
})
```

**`figma_bind_variable`**
```ts
params: {
  nodeId: Type.String(),
  variableName: Type.String({ description: 'Nome della variabile Figma (es: colors/primary)' }),
  property: Type.Union([Type.Literal('fill'), Type.Literal('stroke')])
}
execute: → operationQueue.execute(() => connector.bindVariable(nodeId, variableName, property))
```

### 4.7 — icon-loader.ts

**File**: `src/main/icon-loader.ts`

Portato da `figma-use/packages/render/` — logica di fetch SVG da Iconify.

```ts
import { iconToSVG, iconToHTML } from '@iconify/utils';

const iconCache = new Map<string, string>();

export async function loadIconSvg(name: string, size: number = 24): Promise<string> {
  const cacheKey = `${name}@${size}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  // Fetch da Iconify API
  const [prefix, iconName] = name.split(':');
  const url = `https://api.iconify.design/${prefix}.json?icons=${iconName}`;
  const response = await fetch(url);
  const data = await response.json();

  const iconData = data.icons[iconName];
  if (!iconData) throw new Error(`Icon "${name}" not found on Iconify`);

  const renderData = iconToSVG(iconData, { height: size, width: size });
  const svg = iconToHTML(renderData.body, renderData.attributes);

  iconCache.set(cacheKey, svg);
  return svg;
}

export function collectIconNodes(tree: TreeNode): Array<{ name: string; size: number }> {
  const icons: Array<{ name: string; size: number }> = [];
  function walk(node: TreeNode) {
    if (node.type === 'icon' || node.type === 'Icon') {
      icons.push({ name: node.props.name as string, size: (node.props.size as number) || 24 });
    }
    for (const child of node.children) {
      if (typeof child !== 'string') walk(child);
    }
  }
  walk(tree);
  return icons;
}

export async function preloadIcons(icons: Array<{ name: string; size: number }>): Promise<void> {
  await Promise.all(icons.map(i => loadIconSvg(i.name, i.size)));
}
```

### 4.8 — jsx-parser.ts

**File**: `src/main/jsx-parser.ts`

Portato/ispirato da figma-use mini-react. Converte JSX string → TreeNode.

**Approccio scelto**: usare `esbuild.transformSync()` per compilare JSX con un factory custom, poi eseguire il codice compilato in un sandbox isolato tramite Node.js `vm` module (sicuro: nessun accesso a globals).

```ts
import { transformSync } from 'esbuild';
import vm from 'node:vm';

export function parseJsx(jsxString: string): TreeNode {
  // Wrappa il JSX in codice che usa il nostro factory createElement
  const wrappedCode = `
    (function() {
      function h(type, props) {
        var args = Array.prototype.slice.call(arguments, 2);
        var children = args.flat().filter(function(c) { return c != null; });
        return {
          type: typeof type === 'string' ? type.toLowerCase() : String(type),
          props: props || {},
          children: children
        };
      }
      return (${jsxString});
    })()
  `;

  const { code: compiled } = transformSync(wrappedCode, {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: '"Fragment"',
    loader: 'jsx',
  });

  // Esegui in sandbox isolato via Node.js vm module (no accesso a process, require, etc.)
  const context = vm.createContext({});
  return vm.runInContext(compiled, context);
}
```

**Note sulla sicurezza**:
- Il JSX viene generato dal LLM, non dall'utente — il rischio è limitato
- `vm.createContext({})` crea un contesto isolato senza globals
- Nessun accesso a `process`, `require`, `fs`, etc. dal codice eseguito
- Alternative: parser JSX manuale (più sicuro ma molto più complesso)

**Nota su esbuild**: serve a runtime per il JSX transform. Spostare da devDependencies a dependencies, oppure bundlare la funzione `transformSync` (esbuild ha un WASM fallback ma è lento). Per MVP: spostare esbuild in dependencies.

### 4.9 — tools/index.ts

**File**: `src/main/tools/index.ts`

Esporta tutti i tool come array via factory pattern:

```ts
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { WebSocketConnector } from '../../figma/websocket-connector.js';
import type { FigmaAPI } from '../../figma/figma-api.js';
import type { OperationQueue } from '../operation-queue.js';
import type { FigmaWebSocketServer } from '../../figma/websocket-server.js';

export interface ToolDeps {
  connector: WebSocketConnector;
  figmaAPI: FigmaAPI;
  operationQueue: OperationQueue;
  wsServer: FigmaWebSocketServer;
}

export function createFigmaTools(deps: ToolDeps): ToolDefinition[] {
  return [
    ...createCoreTools(deps),
    ...createDiscoveryTools(deps),
    ...createComponentTools(deps),
    ...createManipulationTools(deps),
    ...createTokenTools(deps),
    ...createJsxRenderTools(deps),
  ];
}
```

### Verifica Fase 4

```bash
npx tsc --noEmit   # Tutti i tool compilano
```

Test unitario minimale: chiamare `createFigmaTools()` con mock deps e verificare che restituisca 28 tool con nomi e schemas corretti.

---

## Fase 5 — Pi SDK Agent

**Obiettivo**: l'agente Figma parte, usa i tool, e risponde ai prompt.

### 5.1 — system-prompt.ts

**File**: `src/main/system-prompt.ts`

Prompt target: ~4,000-6,000 token. Sezioni principali:

1. **Identità e workflow**: design pair-programming
2. **Decision matrix**: quale tool usare per ogni situazione
3. **Pattern figma_render_jsx**: shorthand reference, elementi supportati, Icon syntax
4. **Pattern figma_execute**: async IIFE, loadFont, layoutMode prima di padding
5. **Anti-pattern critici**: da figma-console-mastery
6. **Workflow standard**: analizza → controlla stato → pianifica → esegui → screenshot → feedback

Il prompt completo è nel piano originale PLAN.md (sezione Fase 5) — da raffinare durante implementazione.

### 5.2 — agent.ts

**File**: `src/main/agent.ts`

```ts
import { createAgentSession, type CreateAgentSessionResult } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { createFigmaTools } from './tools/index.js';
import { FIGMA_SYSTEM_PROMPT } from './system-prompt.js';
import type { FigmaCore } from './figma-core.js';
import { OperationQueue } from './operation-queue.js';

export async function createFigmaAgent(figmaCore: FigmaCore): Promise<CreateAgentSessionResult> {
  const operationQueue = new OperationQueue();

  const figmaTools = createFigmaTools({
    connector: figmaCore.connector,
    figmaAPI: figmaCore.figmaAPI,
    operationQueue,
    wsServer: figmaCore.wsServer,
  });

  const result = await createAgentSession({
    model: getModel('anthropic', 'claude-sonnet-4-5'),
    thinkingLevel: 'medium',
    tools: [],              // NESSUN tool built-in (no bash, read, edit, write)
    customTools: figmaTools, // Solo i nostri tool Figma
    sessionManager: SessionManager.inMemory(),
  });

  // Iniettare system prompt custom
  // Opzione 1: se resourceLoader supporta override
  // Opzione 2: post-creazione via agent
  // Da verificare durante implementazione — il modo esatto dipende dall'API interna
  // result.session.agent.setSystemPrompt(FIGMA_SYSTEM_PROMPT);

  return result;
}
```

**Problema aperto: come iniettare il system prompt?**

Dalla ricerca, `createAgentSession` accetta `resourceLoader: ResourceLoader`. Per override totale, servono due strategie da provare in ordine:

1. **Creare un ResourceLoader custom** che restituisce il nostro prompt fisso
2. **Usare `session.agent.setSystemPrompt()`** dopo la creazione (se il metodo esiste)
3. **Fallback**: creare un file `.pi/prompts/system.md` nella cwd del progetto

Da investigare durante implementazione leggendo il source di `DefaultResourceLoader`.

### 5.3 — Streaming eventi dall'agente

L'agente emette eventi tramite `session.subscribe()`. Tipi da gestire:

| Evento | Uso |
|---|---|
| `message_update` (text_delta) | Streaming testo al renderer |
| `message_update` (thinking_delta) | Opzionale: mostrare "thinking..." |
| `tool_execution_start` | Mostrare card "Executing figma_screenshot..." |
| `tool_execution_update` | Aggiornamento progressivo del tool |
| `tool_execution_end` | ✅ o ❌ nel tool card, estrarre screenshot se presente |
| `agent_end` | Agente ha finito |
| `auto_compaction_start/end` | Opzionale: mostrare "Compacting context..." |
| `auto_retry_start/end` | Opzionale: mostrare "Retrying..." |

### Verifica Fase 5

```bash
npm run build
```

Test manuale: avviare l'app, inviare un prompt "Ciao, qual è il tuo stato?", l'agente dovrebbe chiamare `figma_status` e rispondere.

---

## Fase 6 — Electron shell (parallelo con 2-5)

**Obiettivo**: finestra macOS nativa con IPC funzionante tra main e renderer.

### 6.1 — index.ts (Electron main)

**File**: `src/main/index.ts`

```ts
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { createFigmaCore } from './figma-core.js';
import { createFigmaAgent } from './agent.js';
import { setupIpcHandlers } from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  // 1. Avvia figma core (WebSocket server)
  const figmaCore = await createFigmaCore({ port: 9223 });
  await figmaCore.start();

  // 2. Crea agente
  const { session } = await createFigmaAgent(figmaCore);

  // 3. Crea finestra
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',    // Effetto trasparenza macOS
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 4. Setup IPC
  setupIpcHandlers(session, figmaCore, mainWindow);

  // 5. Forward eventi figma alla UI
  figmaCore.wsServer.on('fileConnected', (fileKey) => {
    mainWindow?.webContents.send('figma:connected', fileKey);
  });
  figmaCore.wsServer.on('disconnected', () => {
    mainWindow?.webContents.send('figma:disconnected');
  });
});

app.on('window-all-closed', () => app.quit());
```

### 6.2 — preload.ts

**File**: `src/main/preload.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Agent
  sendPrompt: (text: string) => ipcRenderer.invoke('agent:prompt', text),
  abort: () => ipcRenderer.invoke('agent:abort'),

  // Events dal main → renderer
  onTextDelta: (cb: (text: string) => void) =>
    ipcRenderer.on('agent:text-delta', (_, text) => cb(text)),
  onToolStart: (cb: (toolName: string) => void) =>
    ipcRenderer.on('agent:tool-start', (_, name) => cb(name)),
  onToolEnd: (cb: (toolName: string, success: boolean, result?: any) => void) =>
    ipcRenderer.on('agent:tool-end', (_, name, success, result) => cb(name, success, result)),
  onAgentEnd: (cb: () => void) =>
    ipcRenderer.on('agent:end', () => cb()),
  onScreenshot: (cb: (base64: string) => void) =>
    ipcRenderer.on('agent:screenshot', (_, base64) => cb(base64)),

  // Figma status
  onFigmaConnected: (cb: (fileKey: string) => void) =>
    ipcRenderer.on('figma:connected', (_, key) => cb(key)),
  onFigmaDisconnected: (cb: () => void) =>
    ipcRenderer.on('figma:disconnected', () => cb()),
});
```

### 6.3 — ipc-handlers.ts

**File**: `src/main/ipc-handlers.ts`

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { FigmaCore } from './figma-core.js';

export function setupIpcHandlers(
  session: AgentSession,
  figmaCore: FigmaCore,
  mainWindow: BrowserWindow
) {
  // Subscribe a eventi agente → forward al renderer
  session.subscribe((event) => {
    const wc = mainWindow.webContents;
    switch (event.type) {
      case 'message_update':
        if (event.assistantMessageEvent?.type === 'text_delta') {
          wc.send('agent:text-delta', event.assistantMessageEvent.delta);
        }
        break;
      case 'tool_execution_start':
        wc.send('agent:tool-start', event.toolName);
        break;
      case 'tool_execution_end':
        wc.send('agent:tool-end', event.toolName, !event.isError, event.result);
        // Se è screenshot, estrarre e inviare immagine
        if (event.toolName === 'figma_screenshot' && !event.isError) {
          const imageContent = event.result?.content?.find(c => c.type === 'image');
          if (imageContent) {
            wc.send('agent:screenshot', imageContent.source.data);
          }
        }
        break;
      case 'agent_end':
        wc.send('agent:end');
        break;
    }
  });

  // Handler IPC dal renderer
  ipcMain.handle('agent:prompt', async (_, text: string) => {
    await session.prompt(text);
  });

  ipcMain.handle('agent:abort', async () => {
    await session.abort();
  });
}
```

### Verifica Fase 6

```bash
npm run start   # Finestra si apre, titlebar macOS, nessun crash
```

---

## Fase 7 — Chat UI

**Obiettivo**: chat funzionale con streaming, tool cards, screenshot inline.

### 7.1 — index.html

**File**: `src/renderer/index.html`

Layout:
1. **Header** (40px): titolo "Figma Cowork" + indicatore connessione (dot verde/rosso)
2. **Chat area** (flex-grow, scrollable): messaggi user/assistant
3. **Input area** (bottom): textarea + bottone invio

### 7.2 — styles.css

**File**: `src/renderer/styles.css`

Design system:
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text"` (nativo macOS)
- Accent: `#A259FF` (Figma purple)
- Dark mode: `@media (prefers-color-scheme: dark)`
- User bubble: allineato a destra, sfondo accent
- Assistant bubble: allineato a sinistra, sfondo neutro
- Tool card: bordo sottile, icona spinner/check, nome tool
- Screenshot: inline con bordi arrotondati, max-width 100%

Key styles:
- `-webkit-app-region: drag` per l'header (draggable titlebar)
- `overflow-y: auto` per chat area con smooth scroll
- Textarea auto-resize con `input` event

### 7.3 — app.js

**File**: `src/renderer/app.js`

Funzionalità:
- Invio messaggi (Enter o click)
- Rendering bolle user/assistant
- Streaming text (append progressivo a bubble corrente)
- Tool execution cards (nome tool, spinner → check/cross)
- Screenshot inline (base64 → `<img>` tag)
- Markdown basico (bold, code, code blocks, liste)
- Auto-scroll al fondo
- Status connessione Figma (dot header)

### Verifica Fase 7

Test end-to-end:
1. Avviare l'app
2. Avviare il plugin in Figma
3. Verificare dot verde nell'header
4. Scrivere "Crea un rettangolo blu 200x100"
5. L'agente dovrebbe: creare il rettangolo → fare screenshot → mostrarlo nella chat
6. Verificare: streaming text, tool cards, screenshot inline

---

## Fase 8 — Polish e test

### 8.1 — Gestione token Figma

Il token Figma (Personal Access Token) serve per le REST API calls.

**Flusso**:
1. Al primo avvio, se non c'è token salvato → mostrare dialog input
2. Salvare con `safeStorage.encryptString()` di Electron
3. Caricare con `safeStorage.decryptString()` al successivo avvio
4. Passare al `FigmaAPI` constructor
5. Storage: `~/.figma-cowork/token.enc` (file cifrato con keychain macOS)

### 8.2 — Gestione errori

| Errore | Handling |
|---|---|
| Plugin non connesso | Mostrare avviso nella chat + disabilitare invio |
| Tool failure | Mostrare errore nel tool card + l'agente riceve l'errore e può riprovare |
| WebSocket disconnesso | Auto-reconnect con backoff, notifica nella status bar |
| Model API error (rate limit, overload) | Pi SDK gestisce auto-retry internamente |
| Timeout comando plugin | Il tool restituisce errore, l'agente può decidere di riprovare |

### 8.3 — Status bar migliorata

Aggiungere al header:
- Nome del file Figma connesso
- Indicatore "Agent is thinking..." durante streaming
- Contatore token/costo sessione (da `session.getSessionStats()`)

### 8.4 — Test end-to-end

Scenario di test principali:

| # | Test | Verifica |
|---|---|---|
| 1 | "Crea un bottone blu con testo bianco" | Rettangolo blu + testo bianco, screenshot corretto |
| 2 | "Aggiungi un'icona home in alto a sinistra" | `figma_create_icon` con `mdi:home`, posizionamento corretto |
| 3 | "Crea una card con titolo, descrizione e footer" | `figma_render_jsx` con layout complesso |
| 4 | "Cambia il colore del testo in rosso" (con nodo selezionato) | `figma_get_selection` → `figma_set_fills` |
| 5 | "Cerca il componente Button nella libreria X" | `figma_search_components` → risultati |
| 6 | "Linka questo colore al token primary" | `figma_bind_variable` |

### 8.5 — Packaging

```bash
npx electron-builder --mac
```

Config in `package.json`:
```json
{
  "build": {
    "appId": "com.figma-cowork",
    "productName": "Figma Cowork",
    "mac": {
      "category": "public.app-category.developer-tools",
      "icon": "resources/icon.icns",
      "target": ["dmg"]
    },
    "files": ["dist/**/*"],
    "extraResources": ["figma-desktop-bridge/**/*"]
  }
}
```

**Nota**: `figma-desktop-bridge/` va incluso come extra resource così l'utente può importarlo in Figma.

---

## Rischi e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Pi SDK non espone modo pulito per override system prompt | Alto | Fallback: post-creazione via agent API, oppure custom ResourceLoader |
| esbuild come runtime dep per JSX parsing | Medio | Alternativa: parser JSX manuale o formato JSON TreeNode diretto dall'LLM |
| CREATE_FROM_JSX handler troppo complesso da portare | Alto | MVP: supportare solo shorthand base (bg, p, rounded, flex, gap, w, h, text). Aggiungere shorthand avanzati iterativamente |
| `ws` bundling con esbuild | Basso | Se problemi, marcare come external |
| Electron 41 non ancora stabile | Basso | Fallback a Electron 33 (stabile, Node 20) — richiede downgrade target |
| vm.runInContext per JSX parsing | Medio | Il JSX è generato dall'LLM, non dall'utente. Il contesto è isolato (nessun global). Rischio contenuto. |

---

## Stima effort per fase

| Fase | Complessità | File principali |
|---|---|---|
| 1 — Scaffold | Bassa | 5 file config |
| 2 — Embed figma core | Media | 8 file da adattare (~2,400 LOC) |
| 2b — Fork plugin | **Alta** | code.js (+600 LOC), ui.html (+30 LOC) — CREATE_FROM_JSX è il pezzo più complesso |
| 3 — Figma runtime | Bassa | 2 file (~150 LOC) |
| 4 — Tool definitions | **Alta** | 8 file (~1,500 LOC) — 28 tool con schemas e execute |
| 5 — Pi SDK Agent | Media | 2 file (~300 LOC) — ma richiede debug dell'API |
| 6 — Electron shell | Media | 3 file (~200 LOC) |
| 7 — Chat UI | Media | 3 file (~500 LOC) |
| 8 — Polish | Media | Trasversale |

**Percorso critico per primo test E2E**: Fasi 1 → 2 → 2b → 3 → 4 (almeno core tools) → 5 → 6 → 7

**Fast track**: implementare prima solo 5 tool core (execute, screenshot, status, selection, create_child) per arrivare a un test E2E il prima possibile, poi aggiungere gli altri 23 tool incrementalmente.
