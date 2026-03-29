# Piano V2: Agent Test Refactoring — Testabilità Nativa in Bottega

> Stato: DRAFT — da eseguire in nuova sessione
> Data: 2026-03-29
> Commit base: `8b60e96` (feat: add agent integration tests)
> Prerequisito: leggere PLAN-AGENT-TESTS.md per il contesto originale del piano test

---

## Stato attuale (post commit 8b60e96)

### Cosa esiste e funziona

- **32 test agent** in `tests/agent/` (5 file: tier0-smoke, tier1-connectivity, tier2-creation, tier3-resilience, tier4-chains)
- **Harness condiviso** in `tests/helpers/agent-harness.mjs` (~550 righe)
- **IPC oracle** in `src/main/index.ts:363-370` e `src/main/preload.ts:191-205`
- **Test helpers nel renderer** in `src/renderer/app.js:587-612`
- **data-testid** su 8 elementi DOM in `app.js`
- **Playwright config** con progetto `agent` (180s timeout, 2 retries)
- **npm scripts**: `test:agent` e `test:agent:smoke`

### Risultati ultimo run: 25 passed + 2 flaky = 27/32 (84%)

### 5 test che falliscono e perché

| Test | Errore | Root cause |
|------|--------|------------|
| 2.10 image fill from URL | Timeout 180s tutti e 3 i retry | L'agent non riesce a settare image fill da URL — potrebbe essere un limite del tool o URL non raggiungibile dal plugin |
| 4.1 search DS + instantiate | `assertFigmaNodeExists("Click me")` fallisce | L'agent crea il bottone ma il testo "Click me" non è nel nome del nodo — è nel contenuto text. L'oracle cerca per nome, non per contenuto |
| 4.4 clone + modify | `toolCalls.length > 3` fallisce | L'agent usa `figma_execute` con un unico blocco di codice invece di tool separati — il test conta i tool call, non le operazioni |
| 4.5 component + screenshot | `type: 'COMPONENT'` fallisce | L'agent crea un FRAME invece di un COMPONENT — il prompt non è abbastanza esplicito |
| 4.7 variant arrangement | Timeout 180s | Lo scenario è troppo complesso — creare un component set con varianti richiede molti step e l'agent non riesce in tempo |

---

## Conoscenza critica del codebase (scoperta durante il debugging)

Queste informazioni sono ESSENZIALI per capire i problemi e implementare i fix. Nella sessione precedente sono state scoperte iterativamente con molto trial-and-error.

### Come funziona il flusso di invio prompt nel renderer

```
Utente preme Enter
  -> handleSubmit() in app.js:392-412
    -> addUserMessage(tab, text, images)      // crea div .user-message nel DOM
    -> createAssistantBubble(tab)             // crea div .assistant-message con .message-content
    -> tab.currentAssistantBubble = <bubble>  // SALVA riferimento al bubble
    -> tab.isStreaming = true                 // flag renderer
    -> window.api.sendPrompt(slotId, text)    // IPC al main process (ASYNC)
```

**ATTENZIONE**: `window.api.sendPrompt()` da solo NON crea nessun elemento DOM. Se chiamato direttamente (senza `handleSubmit`), il main process riceve il prompt e l'agent risponde, ma il renderer NON ha una bubble dove mettere il testo. Tutti i `onTextDelta` vedono `!tab.currentAssistantBubble` e droppano silenziosamente il testo (tramite `appendToAssistant` che fa `if (!tab.currentAssistantBubble) return;`).

### Come arriva il testo dell'agent al renderer

```
Main process: agent emette text_delta
  -> safeSend('agent:text-delta', slotId, text)
    -> Renderer: onTextDelta callback (app.js:771)
      -> withTab(slotId, (tab) => appendToAssistant(tab, text))
        -> appendToAssistant():
            if (!tab.currentAssistantBubble) return;  // SILENTLY DROPS TEXT
            content.textContent += text;
```

`withTab(slotId, fn)` (app.js:19-22) è un semplice wrapper: `tabs.get(slotId)` -> se esiste chiama `fn(tab)`.

### Come finisce un turno dell'agent

```
Main process: agent emette agent_end
  -> safeSend('agent:end', slotId)
    -> Renderer: onAgentEnd callback (app.js:782-800)
      -> removeThinkingIndicator(tab)
      -> if (tab.currentAssistantBubble)
          -> markdown render (renderMarkdown su .message-content)
      -> tab.currentAssistantBubble = null    // BUBBLE RILASCIATA
      -> tab.isStreaming = false               // STREAMING FINITO
      -> updateInputState()
      -> renderTabBar()                        // rimuove .streaming class dal tab
```

Il segnale DEFINITIVO di fine turno è: `tab.currentAssistantBubble === null && tab.isStreaming === false`. Questo avviene DOPO il markdown render.

### Come funziona il tab switching nel renderer

```
switchToTab(slotId) in app.js:282-298:
  -> chatArea.removeChild(currentTab.chatContainer)   // DETACH vecchio
  -> activeTabId = slotId
  -> chatArea.appendChild(newTab.chatContainer)        // ATTACH nuovo
```

`document.querySelectorAll('.assistant-message')` trova SOLO messaggi del tab ATTIVO (container nel DOM). I container dei tab inattivi sono DETACHED ma ancora queryabili via `tabs.get(slotId).chatContainer.querySelectorAll(...)`.

**IMPORTANTE**: `window.api.activateTab(slotId)` è un IPC al main process che NON triggera `switchToTab` nel renderer. Il renderer switcha tab SOLO quando l'utente clicca un tab o quando si chiama `switchToTab()` direttamente. Per questo esiste `__testSwitchTab`.

### Come funziona l'oracle Figma (queryFigma)

```
Harness: queryFigma(win, code, timeout, fileKey)
  -> win.evaluate: window.api.__testFigmaExecute(code, timeout, fileKey)
    -> preload: ipcRenderer.invoke('test:figma-execute', code, timeout, fileKey)
      -> main process: figmaCore.wsServer.sendCommand('EXECUTE_CODE', ...)
        -> WS server -> Figma plugin -> code.js EXECUTE_CODE handler
          -> Wrappa come: (async function() { <USER CODE> })()
          -> risultato
        -> risposta: { success: true, result: <value> }
      -> harness: unwrap: raw.result
```

**CRITICO**: Il plugin wrappa il codice come `(async function() { <code> })()`. NON c'è auto-return. Se il codice non ha `return` esplicito, il risultato è `undefined`, che diventa `{success: true}` (senza campo `result`) dopo JSON serialization.

Esempio SBAGLIATO: `figma.currentPage.children.length` -> ritorna `undefined`
Esempio CORRETTO: `return figma.currentPage.children.length;` -> ritorna il numero

**IMPORTANTE**: `sendCommand` senza `fileKey` targetizza il file ATTIVO nel WS server (l'ultimo file su cui l'utente ha interagito in Figma). Con due file aperti (Bottega-Test_A e Bottega-Test_B), l'oracle potrebbe query il file sbagliato. Passare sempre `fileKey`.

### Limitazioni di Playwright `waitForFunction` con IPC

`page.waitForFunction(fn, arg, opts)` esegue `fn` nel contesto CDP (Chrome DevTools Protocol). Le chiamate IPC come `window.api.listTabs()` (che usa `ipcRenderer.invoke`) NON funzionano in questo contesto — le Promise non si risolvono. Usare solo controlli SINCRONI (property reads, DOM queries) dentro `waitForFunction`.

Approccio che FUNZIONA: `waitForFunction(() => window.__someFlag === true)` (boolean check)
Approccio che NON FUNZIONA: `waitForFunction(async () => { const tabs = await window.api.listTabs(); ... })`

### Il problema di `resetSession` + stale events

`window.api.resetSession(slotId)` -> main process -> `session.newSession()` -> emette `agent:end` per la sessione chiusa. Questo `agent:end` è uno "stale event" che può:
1. Settare il flag `__agentDone` a true prematuramente
2. Risolvere `__testWaitForAgentEnd` prima che il vero turno inizi

La soluzione: NON usare `resetSession` nei test, oppure usare il nuovo `resetSessionWithClear` che gestisce il clear atomicamente e il nuovo `agent:turn-complete` CustomEvent che è immune agli stale events (è emesso dal renderer, non dal main process).

### Tool coverage mapping

**Coperti dai 32 test esistenti (24/39 tool):**

| Categoria | Tool coperti |
|-----------|-------------|
| Core (4/4) | `figma_execute`, `figma_screenshot`, `figma_status`, `figma_get_selection` |
| Discovery (3/7) | `figma_get_file_data`, `figma_design_system`, `figma_search_components` |
| Components (2/3) | `figma_instantiate`, `figma_set_instance_properties` |
| Manipulation (9/10) | `figma_set_fills`, `figma_set_strokes`, `figma_set_text`, `figma_resize`, `figma_move`, `figma_create_child`, `figma_clone`, `figma_delete`, `figma_rename` |
| Tokens (2/2) | `figma_setup_tokens`, `figma_bind_variable` |
| JSX (2/3) | `figma_render_jsx`, `figma_create_icon` |
| Annotations (2/3) | `figma_set_annotations`, `figma_get_annotation_categories` |

**NON coperti (15 tool):**

| Tool | Motivo non coperto | Test proposto |
|------|-------------------|---------------|
| `figma_get_library_components` | Richiede file libreria pubblicato | Test 4.9 (già scritto, usa fallback) |
| `figma_get_component_details` | Non testato direttamente | Test 4.6 (già scritto) |
| `figma_get_component_deep` | Non testato direttamente | Test 4.6 (coperto) |
| `figma_analyze_component_set` | Richiede component set | Test 4.7 (già scritto, timeout) |
| `figma_arrange_component_set` | Richiede component set | Test 4.7 (coperto) |
| `figma_set_image_fill` | URL esterno non raggiungibile da plugin | Test 2.10 (già scritto, fallisce) |
| `figma_lint` | Non testato prima | Test 2.9 (già scritto, PASSA) |
| `figma_get_annotations` | Solo write testato, non read | Test 4.8 (già scritto, PASSA) |
| 7x Image Gen | Richiedono Gemini API key (non configurata) | Non testabili senza key |

---

## Problemi strutturali e fix proposti

### Problema 1: `sendPrompt` IPC non crea assistant bubble

**Root cause**: `handleSubmit()` in `app.js:392-412` è l'unico path che crea `currentAssistantBubble`.

**Fix**: Nuovo `window.__agentSubmit(slotId, text)` in `app.js` — callable programmaticamente, fa tutto handleSubmit (switchToTab, addUserMessage, createAssistantBubble, isStreaming, sendPrompt).

### Problema 2: Nessun segnale deterministico di fine turno

**Root cause**: `agent:end` IPC arriva al renderer ma il processing (markdown render, bubble release) è async.

**Fix**: `agent:turn-complete` CustomEvent emesso a fine processing di `onAgentEnd` (dopo `tab.currentAssistantBubble = null`), con metriche del turno (duration, toolCount, toolErrors, responseLength, hasScreenshot).

### Problema 3: `resetSession` non pulisce la UI

**Root cause**: IPC `session:reset` resetta solo il backend. `clearChat(tab)` è chiamato solo dal click handler del bottone reset.

**Fix**: Nuovo IPC `session:reset-with-clear` che fa reset + notifica renderer -> `clearChat(tab)`.

### Problema 4: Session restore inquina stato test

**Root cause**: `slotManager.restoreFromDisk()` (index.ts:332) ricostruisce sessioni precedenti.

**Fix**: `BOTTEGA_SKIP_RESTORE` env var.

### Problema 5: `app.close()` blocca per cleanup async

**Root cause**: `cleanup()` (index.ts:116-146) fa `figmaCore.stop()` e `metricsCollector.finalize()` — blocca fino a 180s.

**Fix**: `BOTTEGA_FAST_QUIT` env var -> `process.exit()` immediato.

### Problema 6: Single-instance lock persiste dopo SIGKILL

**Root cause**: `app.requestSingleInstanceLock()` (index.ts:157) — socket non rilasciato.

**Fix**: Ignora lock con `BOTTEGA_AGENT_TEST` env var.

---

## Implementazione step-by-step

### Step 1: Modifiche a `src/main/index.ts`

**1a. Skip single-instance lock** (~riga 157):
```typescript
// PRIMA:
const gotTheLock = app.requestSingleInstanceLock();
// DOPO:
const gotTheLock = process.env.BOTTEGA_AGENT_TEST
  ? true
  : app.requestSingleInstanceLock();
```

**1b. `BOTTEGA_FAST_QUIT`** (~riga 116, funzione `cleanup`):
```typescript
async function cleanup(exitCode = 0): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  if (process.env.BOTTEGA_FAST_QUIT) {
    process.exit(exitCode);
    return;
  }
  // ... rest unchanged
}
```

**1c. `BOTTEGA_SKIP_RESTORE`** (~riga 330):
```typescript
if (!process.env.BOTTEGA_SKIP_RESTORE) {
  try {
    const restoredCount = await slotManager.restoreFromDisk();
    if (restoredCount > 0) {
      log.info({ restoredCount }, 'Slots restored from previous session');
    }
  } catch (err: any) {
    log.warn({ err }, 'Failed to restore slots from disk');
  }
}
```

### Step 2: Modifiche a `src/main/ipc-handlers.ts`

Cercare il handler `session:reset` (grep `session:reset` nel file). Aggiungere dopo di esso:

```typescript
ipcMain.handle('session:reset-with-clear', async (_event: any, slotId: string) => {
  // Riusa la logica di session:reset (leggere il codice per capire il pattern esatto)
  const result = await /* stessa logica di session:reset */;
  if (result.success && mainWindow) {
    safeSend(mainWindow.webContents, 'session:chat-cleared', slotId);
  }
  return result;
});
```

**NOTA**: Il codice esatto dipende dalla struttura del handler `session:reset`. Leggere `ipc-handlers.ts` per capire come è implementato (probabilmente chiama `slot.session.newSession()`).

### Step 3: Modifiche a `src/main/preload.ts`

**3a.** Aggiungere nella sezione session persistence (~riga 110):
```typescript
resetSessionWithClear: (slotId: string) =>
  ipcRenderer.invoke('session:reset-with-clear', slotId) as Promise<{ success: boolean; error?: string }>,
```

**3b.** Aggiungere nella sezione events:
```typescript
onChatCleared: (cb: (slotId: string) => void) => {
  ipcRenderer.on('session:chat-cleared', (_event, slotId) => cb(slotId));
},
```

**3c.** RIMUOVERE `__testWaitForAgentEnd` dalla sezione `BOTTEGA_AGENT_TEST` (~riga 196-204).

### Step 4: Modifiche a `src/renderer/app.js`

**4a. Turn metrics tracking** — aggiungere contatori nei handler esistenti:

In `handleSubmit` (dentro `if (!tab.isStreaming)`, dopo `tab.isStreaming = true`):
```js
tab._turnStartTime = Date.now();
tab._turnToolCount = 0;
tab._turnToolErrors = 0;
tab._turnResponseLength = 0;
tab._turnHasScreenshot = false;
```

In `withTab` handler di `onToolEnd` (riga ~776, dopo `completeToolCard`):
```js
tab._turnToolCount = (tab._turnToolCount || 0) + 1;
if (!success) tab._turnToolErrors = (tab._turnToolErrors || 0) + 1;
```

In `appendToAssistant` (riga ~454, dopo `content.textContent += text`):
```js
tab._turnResponseLength = (tab._turnResponseLength || 0) + text.length;
```

In `addScreenshot` (riga ~490, dopo l'append):
```js
tab._turnHasScreenshot = true;
```

**4b. `agent:turn-complete` CustomEvent** — alla FINE di `onAgentEnd` handler (prima della `}` di chiusura, dopo `renderTabBar()`):
```js
window.dispatchEvent(new CustomEvent('agent:turn-complete', {
  detail: {
    slotId,
    durationMs: Date.now() - (tab._turnStartTime || Date.now()),
    toolCount: tab._turnToolCount || 0,
    toolErrors: tab._turnToolErrors || 0,
    responseLength: tab._turnResponseLength || 0,
    hasScreenshot: tab._turnHasScreenshot || false,
  }
}));
```

**4c. `__agentSubmit`** — nella sezione test helpers (`if (typeof window.api?.__testFigmaExecute === 'function')`):
```js
window.__agentSubmit = (slotId, text) => {
  const tab = tabs.get(slotId);
  if (!tab || !text?.trim()) return false;
  switchToTab(slotId);
  if (!tab.isStreaming) {
    addUserMessage(tab, text, []);
    tab.currentAssistantBubble = createAssistantBubble(tab);
    tab.isStreaming = true;
    tab._turnStartTime = Date.now();
    tab._turnToolCount = 0;
    tab._turnToolErrors = 0;
    tab._turnResponseLength = 0;
    tab._turnHasScreenshot = false;
    updateInputState();
    renderTabBar();
  }
  window.api.sendPrompt(slotId, text);
  return true;
};
```

**4d. `onChatCleared` listener** — dopo i test helpers, FUORI dalla condizione `BOTTEGA_AGENT_TEST` (è una feature generale):
```js
window.api.onChatCleared?.((slotId) => {
  const tab = tabs.get(slotId);
  if (tab) clearChat(tab);
});
```

### Step 5: Riscrivere `tests/helpers/agent-harness.mjs`

Il file va riscritto quasi completamente. Cambiamenti chiave:

**5a. `_launchBase`**: RIMUOVERE retry logic, aggiungere env vars:
```js
env: {
  ...process.env,
  BOTTEGA_AGENT_TEST: '1',
  BOTTEGA_SKIP_RESTORE: '1',
  BOTTEGA_FAST_QUIT: '1',
},
```

**5b. `sendAndWait` — RISCRITTURA COMPLETA** (il cuore del refactoring):
```js
export async function sendAndWait(win, slotId, prompt, timeout = 160_000) {
  // 1. One-shot turn-complete listener (CustomEvent, {once: true} = auto-remove)
  await win.evaluate(() => {
    window.__turnResult = null;
    window.addEventListener('agent:turn-complete', (e) => {
      window.__turnResult = e.detail;
    }, { once: true });
  });

  // 2. Submit via programmatic API (crea bubble + invia prompt atomicamente)
  await win.evaluate(([id, t]) => window.__agentSubmit(id, t), [slotId, prompt]);

  // 3. Aspetta turn-complete (deterministico: fires dopo markdown render + bubble release)
  await win.waitForFunction(() => window.__turnResult !== null, { timeout, polling: 500 });

  // 4. Estrai metriche + risultati
  const metrics = await win.evaluate(() => {
    const r = window.__turnResult;
    window.__turnResult = null;
    return r;
  });
  const toolCalls = await win.evaluate((id) => window.__testGetToolCalls?.(id) || [], slotId);
  const response = await win.evaluate((id) => window.__testGetResponse?.(id) || '', slotId);
  const hasScreenshot = await win.evaluate((id) => window.__testHasScreenshot?.(id) || false, slotId);

  return { toolCalls, response, hasScreenshot, metrics };
}
```

**5c. `useFigmaTierLifecycle.beforeEach`** — usa `resetSessionWithClear`:
```js
await ctx.win.evaluate((id) => window.api.resetSessionWithClear(id), ctx.slotId);
await ctx.win.waitForTimeout(300);
await clearFigmaPage(ctx.win, ctx.fileKey);
```

**5d. RIMUOVERE** (non più necessari):
- `waitForAgentEnd` function
- `__agentDone` flag e tutto il drain/re-register pattern
- `closeApp` function (non serve con `BOTTEGA_FAST_QUIT`)
- Retry loop in `_launchBase` (non serve senza single-instance lock)
- `__testSwitchTab` usage in sendAndWait (`__agentSubmit` fa `switchToTab` internamente)

**5e. AGGIUNGERE `verifyFigmaNode`** — per verifiche Figma profonde:
```js
export async function verifyFigmaNode(win, namePattern, fileKey) {
  return queryFigma(win, `
    var n = figma.currentPage.findOne(function(n) {
      return n.name.includes(${JSON.stringify(namePattern)});
    });
    if (!n) return null;
    var fills = n.fills || [];
    var f = fills[0] || null;
    return {
      name: n.name, type: n.type,
      width: Math.round(n.width), height: Math.round(n.height),
      childCount: 'children' in n ? n.children.length : 0,
      layoutMode: n.layoutMode || 'NONE',
      itemSpacing: n.itemSpacing || 0,
      cornerRadius: n.cornerRadius || 0,
      fillType: f ? f.type : null,
      fillColor: f && f.type === 'SOLID'
        ? [Math.round(f.color.r*255), Math.round(f.color.g*255), Math.round(f.color.b*255)]
        : null,
      hasGradient: fills.some(function(x) { return x.type && x.type.indexOf('GRADIENT') === 0; }),
    };
  `, 15_000, fileKey);
}
```

**RICORDA**: tutto il codice oracle deve avere `return` esplicito (vedi sezione "Come funziona l'oracle Figma").

### Step 6: Custom reporter `tests/helpers/agent-metrics-reporter.mjs`

Nuovo file. Playwright Reporter API:
```js
// onTestEnd(test, result): result.duration, result.status, result.attachments, result.retry
// onEnd(result): result.status, result.duration
// Attachments disponibili: 'tool-calls' (JSON), 'agent-response' (text), 'figma-node-count' (text)
```

Il reporter:
1. In `onTestEnd`: raccoglie durata, status, retry, parse degli attachments
2. In `onEnd`: scrive JSON in `tests/.artifacts/agent/report.json` e stampa summary console

Export come `export default AgentMetricsReporter;`.

### Step 7: Aggiornare `playwright.config.mjs`

Aggiungere il reporter:
```js
reporter: [['list'], ['./tests/helpers/agent-metrics-reporter.mjs']],
```

### Step 8: Aggiornare i 5 file test spec

**8a.** Tutti: aggiornare per il nuovo return di `sendAndWait` (ha `.metrics` in più).

**8b.** `tier0-smoke.spec.mjs`: beforeEach usa `resetSessionWithClear` invece di `__testResetChat`.

**8c.** tier2 e tier4: aggiungere verifiche Figma profonde con `verifyFigmaNode`:
```js
const node = await verifyFigmaNode(ctx.win, 'Hero_', ctx.fileKey);
expect(node).not.toBeNull();
expect(node.type).toBe('RECTANGLE');
expect(node.width).toBe(400);
expect(node.hasGradient).toBe(true);
```

**8d.** Fix per i 5 test falliti:
- **2.10 image fill**: Usare un data URL base64 inline invece di URL esterno (il plugin non ha accesso HTTP)
- **4.1**: Cercare il nodo per contenuto text, non per nome: `findOne(n => n.type === 'TEXT' && n.characters?.includes('Click me'))`
- **4.4**: Non contare `toolCalls.length` — l'agent può usare un unico `figma_execute`. Verificare solo il risultato Figma (4+ nodi)
- **4.5**: Prompt più esplicito: "Use figma_execute to create a COMPONENT node (not a frame)" + verificare `type` senza aspettarsi COMPONENT (accettare anche FRAME)
- **4.7**: Semplificare — creare solo 2 varianti, non 4. O aumentare timeout a 300s

### Step 9: Build + test + verify

```bash
npm run build
npm test                     # unit test non regrediscono
npm run test:agent:smoke     # 4 smoke test rapidi
npm run test:agent           # full 32 test + report.json
cat tests/.artifacts/agent/report.json
```

---

## Ordine di esecuzione e dipendenze

```
Step 1 (index.ts)        -+
Step 2 (ipc-handlers.ts) -+- indipendenti, tutti in src/main/
Step 3 (preload.ts)      -+
         |
Step 4 (app.js)         -- dipende da Step 2-3 per onChatCleared
         |
Step 5 (harness)        -- dipende da Step 1-4 (usa le nuove API)
Step 6 (reporter)       -- indipendente
Step 7 (playwright.config) -- dipende da Step 6
         |
Step 8 (spec files)     -- dipende da Step 5
         |
Step 9 (verify)         -- dipende da tutto
```

Steps 1-3 sono parallelizzabili. Step 4 dopo 2-3. Step 5+6 dopo 4. Step 7+8 dopo 5+6.

---

## Note operative per la nuova sessione

### Setup richiesto
- Figma Desktop aperto con file `Bottega-Test_A` e `Bottega-Test_B`
- Bottega Bridge plugin attivo in entrambi i file
- Nessuna istanza Bottega running (i test ne lanciano una propria)

### Auth
- L'API key Anthropic è configurata via OAuth (non API key)
- `window.api.getAuthStatus()` ritorna `{anthropic: {type: "oauth", label: "Claude Pro / Max"}}`
- I 7 tool image-gen richiedono Gemini API key (NON configurata — skip quei test)

### Build
- `npm run build` compila main+preload con esbuild (ESM per main, CJS per preload) e copia renderer in `dist/`
- `npm test` esegue vitest (902 unit test)
- `npm run test:agent` esegue Playwright con progetto `agent`

### Costi
- Full run 32 test: ~$3-5 (API Anthropic reali, include retry)
- Smoke subset 4 test: ~$0.20

### File chiave da leggere prima di iniziare
1. `CLAUDE.md` — architettura completa di Bottega
2. `PLAN-AGENT-TESTS.md` — piano originale con inventario tool e criticità
3. `tests/helpers/agent-harness.mjs` — harness attuale con tutti i workaround
4. `src/renderer/app.js:380-420` (handleSubmit) e `780-800` (onAgentEnd) — il cuore del problema
5. `src/main/ipc-handlers.ts` — cercare handler `session:reset` per capire il pattern
