# Bug Report — Testing Reale v0.12.0

Risultati del testing end-to-end condotto il 2026-04-05.
Metodologia: QA full suite (16 script, 192 test) eseguita da qa-tester subagent (Sonnet)
con log-monitor in parallelo (1886 log entries, 2335 entries totali analizzate).
App in produzione (non test mode), connessa a Figma Desktop con Bridge plugin,
2 file aperti (Bottega-Test_A, Bottega-Test_B).

**Risultati**: 192 test, 183 pass (95.3%), 9 fail (4 bug reali, 3 tool selection, 2 edge case).

## Riepilogo

| ID | Titolo | Severita | Status |
|----|--------|----------|--------|
| B-001 | Context bar non si aggiorna al cambio tab | Media | Open |
| B-002 | Nessun bottone abort/stop visibile durante streaming | Alta | Open |
| B-003 | Abort via IPC e lentissimo (~47s) | Alta | Open |
| B-004 | Cambio modello in Settings non aggiorna toolbar | Media | Open |
| B-005 | Effort button non cicla (apre dropdown, richiede 2 click) | Bassa | Open |
| B-006 | Pin button toggle restituisce undefined | Bassa | Open |
| B-007 | Flag isStreaming non azzerato subito dopo abort | Bassa | Open |
| B-008 | Nessun fallback visivo per screenshot senza Figma | Bassa | Open |
| B-009 | Suggerimenti follow-up assenti dopo risposte degradate | Bassa | Open |
| B-010 | Click su suggestion chip non riempie l'input | Media | Open |
| B-011 | Suggestions riappaiono dopo session reset (race condition) | Bassa | Open |
| B-012 | Context bar non si resetta a 0K dopo New Chat | Media | Open |
| W-001 | "Pre-fetch tool not found in tool set" warning ricorrente | Bassa | Open |
| W-002 | "Figma API request failed" in coppia (retry senza backoff) | Media | Open |

---

## B-001: Context bar non si aggiorna al cambio tab

**Severita**: Media
**Componente**: Renderer (app.js)
**Riproduzione**:
1. Apri 2 tab (Bottega-Test_A, Bottega-Test_B)
2. Invia prompt su Tab B (context sale a 34K)
3. Switcha a Tab A
4. La context bar mostra "34K / 1M" invece del valore reale di Tab A (~17K)

**Root cause**: `switchToTab()` (app.js:283) non chiama `updateContextBar()`.
Il label si aggiorna solo su eventi `onUsage`, che non vengono emessi al cambio tab.

**Fix proposto**: Salvare `tab.lastContextTokens` per ogni tab e chiamare
`updateContextBar(tab.lastContextTokens)` alla fine di `switchToTab()`.

**File**: `src/renderer/app.js` (switchToTab, updateContextBar)

---

## B-002: Nessun bottone abort/stop visibile durante streaming

**Severita**: Alta
**Componente**: Renderer (app.js, index.html, styles.css)
**Riproduzione**:
1. Invia un prompt complesso che richiede tempo
2. L'agent inizia a streamare
3. Non c'e nessun bottone per fermare l'operazione
4. Il send button mantiene title "Send (Enter)" e non cambia aspetto

**Impatto**: L'utente e intrappolato durante operazioni lunghe. Combinato con B-003,
l'unica opzione e chiudere l'app.

**Root cause**: `updateInputState()` (app.js:719) non mostra mai un bottone stop.
Non esiste un elemento abort nel DOM. Il placeholder cambia correttamente a
"Type to queue..." ma il bottone send non si trasforma in stop.

**Fix proposto**:
- Aggiungere un bottone abort nell'HTML (o riusare send-btn con icona diversa)
- In `updateInputState()`, quando `tab.isStreaming === true`:
  - Cambiare l'icona del send button in un'icona "stop" (quadrato)
  - Cambiare il title in "Stop (Esc)"
  - Collegare il click a `window.api.abort(tab.id)`

**File**: `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/styles.css`

---

## B-003: Abort via IPC e lentissimo (~47s)

**Severita**: Alta
**Componente**: Main process (ipc-handlers.ts)
**Riproduzione**:
1. Invia un prompt che attiva tool calls (es. "Analyze the entire file...")
2. Chiama `window.api.abortAgent(slotId)` via console o UI
3. L'agent continua a processare per ~47 secondi
4. Il turn termina con `responseCharLength: 0` e `responseDurationMs: 47025`

**Root cause**: `ipc-handlers.ts:358` fa `await slot.session.abort()` che delega
al Pi SDK. Il Pi SDK aspetta che lo stream corrente completi o vada in timeout.
Non c'e un timeout applicato all'operazione di abort stessa.

**Fix proposto**:
```typescript
// In ipc-handlers.ts, agent:abort handler:
// Settare isStreaming = false IMMEDIATAMENTE per sbloccare la UI
slot.isStreaming = false;
safeSend(mainWindow.webContents, 'streaming:end', slotId);

// Abort con timeout
const abortPromise = slot.session.abort();
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('abort timeout')), 5000)
);
await Promise.race([abortPromise, timeout]).catch(() => {
  logger.warn({ slotId }, 'Abort timed out, forcing cleanup');
});

// Cleanup
eventRouter.abortJudge(slotId);
eventRouter.finalizeTurn(slot);
slot.promptQueue.clear();
```

**File**: `src/main/ipc-handlers.ts` (agent:abort handler)

---

## B-004: Cambio modello in Settings non aggiorna toolbar

**Severita**: Media
**Componente**: Renderer (settings.js, app.js)
**Riproduzione**:
1. Apri Settings
2. Cambia modello da "Claude Sonnet 4.6" a "Claude Haiku 4.5"
3. Il select cambia valore correttamente
4. Il label nella toolbar (#bar-model-label) resta "Claude Sonnet 4.6"

**Root cause**: Il change handler di `#model-select` in settings.js (linea ~309)
chiama `window.api.switchModel()` ma non aggiorna direttamente `barModelLabel`.
Il toolbar dropdown button in app.js ha il suo handler separato che funziona,
ma i due percorsi non sono sincronizzati.

**Fix proposto**: Nel change handler di settings.js, dopo `switchModel()` con successo,
aggiornare `barModelLabel.textContent` con il label del modello selezionato,
oppure chiamare una funzione condivisa `syncBarModelLabel()`.

**File**: `src/renderer/settings.js` (modelSelect change handler)

---

## B-005: Effort button richiede doppio click (dropdown)

**Severita**: Bassa
**Componente**: Renderer (app.js)
**Riproduzione**:
1. Click su "Low" nella toolbar
2. Si apre un dropdown menu (non cicla direttamente)
3. Bisogna cliccare sull'item desiderato nel dropdown

**Note**: Questo potrebbe essere by-design (dropdown vs. cycle). Da verificare
con interazione umana reale se il dropdown appare e funziona. Il test programmatico
via CDP non cattura il dropdown perche richiede 2 click separati.

**File**: `src/renderer/app.js` (barEffortBtn click handler, linea ~1584)

---

## B-006: Pin button toggle restituisce undefined

**Severita**: Bassa
**Componente**: Renderer/Main (app.js, ipc-handlers.ts)
**Riproduzione**:
1. Click su pin button
2. `classList.contains('pinned')` restituisce undefined dopo il click
3. Il toggle potrebbe non applicare lo stato visivo

**Root cause probabile**: `window.api.togglePin()` (che invoca `ipcRenderer.invoke('window:toggle-pin')`)
potrebbe non restituire il valore boolean correttamente. Il handler in ipc-handlers.ts
deve restituire esplicitamente `return next` dopo `setAlwaysOnTop()`.

**Fix proposto**: Verificare che il handler IPC `window:toggle-pin` ritorni il boolean.
Se il problema persiste, aggiungere un fallback nel renderer:
```javascript
const pinned = (await window.api.togglePin()) ?? !pinBtn.classList.contains('pinned');
```

**File**: `src/main/ipc-handlers.ts`, `src/renderer/app.js`

---

## B-007: Flag isStreaming non azzerato subito dopo abort

**Severita**: Bassa
**Componente**: Main process (ipc-handlers.ts) / Renderer (app.js)
**Riproduzione**:
1. Invia un prompt complesso (es. "Analyze every element...")
2. Attendi che l'agent inizi a streamare
3. Chiama `window.api.abortAgent(slotId)`
4. Controlla `getActiveTab().isStreaming` entro 2 secondi → ancora `true`

**Root cause**: Il handler `agent:abort` in ipc-handlers.ts risolve la Promise
prima che l'evento `onAgentEnd` venga emesso e pulisca lo stato del tab.
Non c'è un reset sincrono dello stato streaming al completamento dell'abort.

**Fix proposto**: Emettere `streaming:end` immediatamente dopo che `abort()` risolve,
prima di attendere il cleanup completo dell'agent session.

**File**: `src/main/ipc-handlers.ts` (agent:abort handler), `src/renderer/app.js`

---

## B-008: Nessun fallback visivo per screenshot quando Figma è disconnesso

**Severita**: Bassa
**Componente**: Renderer (app.js)
**Riproduzione**:
1. Disconnetti il Bridge plugin (chiudi il plugin o il file Figma)
2. Invia "Take a screenshot"
3. Il tool card `figma_screenshot` appare ma senza immagine
4. Nessun messaggio inline spiega perché lo screenshot è assente

**Root cause**: L'evento IPC `onScreenshot` non viene mai emesso quando la connessione
è assente. L'agent spiega nel testo che Figma è disconnesso, ma la UI non mostra
un placeholder o messaggio di fallback nel tool card.

**Fix proposto**: Quando il tool card per `figma_screenshot` si chiude con status
`error` o senza immagine, mostrare un messaggio inline tipo
"Screenshot non disponibile — Figma non connesso".

**File**: `src/renderer/app.js` (tool card rendering)

---

## B-009: Suggerimenti follow-up assenti dopo risposte degradate

**Severita**: Bassa
**Componente**: Main process (prompt-suggester.ts)
**Riproduzione**:
1. Disconnetti Figma o provoca una risposta con errore
2. L'agent completa il turno con una risposta degradata
3. Nessun chip di suggerimento appare sotto la risposta

**Root cause**: `prompt-suggester.ts` probabilmente filtra i turni con errori o
struttura di risposta non standard. I suggerimenti vengono soppressi anche quando
la risposta si completa correttamente ma con contenuto degradato.

**Fix proposto**: Generare suggerimenti anche per turni degradati, adattandoli
al contesto (es. "Riconnetti Figma", "Verifica la connessione", "Riprova").

**File**: `src/main/prompt-suggester.ts`

---

## B-010: Click su suggestion chip non riempie l'input

**Severita**: Media
**Componente**: Renderer (app.js)
**Riproduzione**:
1. Invia un prompt e attendi la risposta
2. Le suggestion chip appaiono sotto la risposta
3. Clicca su una chip
4. L'input resta vuoto — il prompt non viene inviato

**Root cause**: La chip click handler (app.js:1683-1690) chiama `_initTurn(tab, text, [])`
poi `window.api.sendPrompt(tab.id, text)`. Il testo viene passato come argomento,
non inserito nell'input field. Il test controlla `inputField.value` che resta vuoto
perché `_initTurn` aggiunge direttamente il messaggio utente nel DOM senza
passare dall'input field. Tuttavia, il test originale TC2.9 riporta che il click
non ha effetto visibile — possibile che il chip click non funzioni quando l'agent
è in uno stato intermedio o il tab non è attivo.

**Fix proposto**: Investigare se il click handler viene effettivamente invocato
(aggiungere logging temporaneo). Verificare che `getActiveTab()` non ritorni null
al momento del click. Se il problema è nel test, il chip potrebbe richiedere un
target più specifico (Playwright `.click()` su elementi dinamici).

**File**: `src/renderer/app.js` (suggestion chip click handler, linea ~1683)

---

## B-011: Suggestions riappaiono dopo session reset (race condition)

**Severita**: Bassa
**Componente**: Main process (session-events.ts), Renderer (app.js)
**Riproduzione**:
1. Invia un prompt complesso che genera suggestions
2. Mentre le suggestions sono in generazione (async), clicca "New Chat"
3. `clearChat()` chiama `hideSuggestions()` e pulisce la chat
4. La Promise `slot.suggester.suggest()` risolve DOPO il reset
5. `safeSend(wc, 'agent:suggestions', ...)` invia le suggestion al renderer
6. `onSuggestions` callback le mostra in una chat vuota

**Root cause**: `session-events.ts:322-326` — il suggest è una Promise `.then()` fire-and-forget.
Non c'è nessun controllo se la sessione è stata resettata prima di emettere
`agent:suggestions`. `clearChat()` (app.js:744) chiama `hideSuggestions()` ma
non può prevenire l'arrivo di eventi IPC futuri.

**Fix proposto**: Due opzioni:
1. Nel renderer: in `onSuggestions` callback (app.js:1702), verificare che il tab
   abbia messaggi prima di mostrare suggestions (se chat vuota, ignorare).
2. Nel main: al session reset, settare un flag `slot.suggestionsSuppressed = true`
   e controllarlo prima di `safeSend` in session-events.ts:326.

**File**: `src/main/session-events.ts` (linea 322-331), `src/renderer/app.js` (linea 1702)

---

## B-012: Context bar non si resetta a 0K dopo New Chat

**Severita**: Media
**Componente**: Renderer (app.js) / Main process
**Riproduzione**:
1. Invia 3+ prompt per far salire il context a ~36K
2. Clicca "New Chat"
3. I messaggi vengono cancellati correttamente
4. La context bar mostra "39K / 1M" invece di "0K / 200K"

**Root cause**: Correlato a B-001 — `clearChat()` (app.js:739-746) pulisce i messaggi
e resetta `isStreaming`, ma non resetta il contatore context. Il context bar si
aggiorna solo su eventi `onUsage` dal main process. Dopo il reset, la nuova sessione
ha effettivamente un context non-zero (system prompt caricato), ma il valore mostrato
(39K) include ancora i token della sessione precedente perché `onUsage` non viene
emesso immediatamente al reset.

**Note**: Il context passa da "36K / 1M" (in-session) a "39K / 1M" (post-reset) —
il +3K potrebbe essere il system prompt della nuova sessione. Ma il display non
aggiorna il denominatore da 1M (max context) a 200K (default) come ci si aspetterebbe.

**Fix proposto**: Nel handler del reset button (app.js:843-850), dopo `clearChat(tab)`:
```javascript
updateContextBar({ usedTokens: 0, maxTokens: 200000 });
```
Oppure far emettere un evento `onUsage` dal main process al termine del reset.

**File**: `src/renderer/app.js` (reset handler linea 843), `src/main/ipc-handlers.ts`

---

## W-001: "Pre-fetch tool not found in tool set" warning ricorrente

**Severita**: Bassa (warning, non errore)
**Componente**: Main process (subagent/context-prefetch.ts)
**Identificato da**: Log monitor — 10+ occorrenze durante la sessione QA
**Pattern**: Ogni volta che il subagent orchestrator pre-fetcha contesto, tenta
di chiamare tool che non sono nel set ridotto di tool dei subagent read-only.

**Root cause**: `context-prefetch.ts:22-24` cerca tool per nome nel set passato,
ma il set di tool dei subagent è un sottoinsieme di quelli del parent agent.
Il prefetcher prova a chiamare tool come `figma_get_file_data` o `figma_status`
che potrebbero non essere inclusi nel set read-only.

**Impatto**: Nessuno funzionale — il prefetch fallisce gracefully (ritorna null)
e il subagent procede senza il dato pre-fetchato. Genera però rumore nei log
che rende difficile identificare warning reali.

**Fix proposto**: Filtrare la lista di tool da pre-fetchare basandosi sui tool
effettivamente disponibili, oppure abbassare il livello di log da `warn` a `debug`
per i tool noti come non disponibili nei subagent.

**File**: `src/main/subagent/context-prefetch.ts` (linea 23-25)

---

## W-002: "Figma API request failed" in coppia (retry senza backoff)

**Severita**: Media (warning con impatto potenziale)
**Componente**: Figma Core (figma/figma-api.ts)
**Identificato da**: Log monitor — 42 errori, tutti in coppie ravvicinate (~500ms distanza)
**Pattern**: Ogni errore API appare due volte in rapida successione, suggerendo
un retry automatico immediato senza backoff.

**Root cause**: `figma-api.ts:125-131` logga l'errore e lancia un'eccezione.
Il chiamante (probabilmente un tool o il prefetcher) cattura l'errore e ritenta
immediatamente. Con 42 errori in coppie, ci sono ~21 operazioni fallite con 1 retry
ciascuna. Il retry senza delay può peggiorare rate limiting del Figma REST API.

**Impatto**: Rate limiting — se il Figma API risponde con 429 (Too Many Requests),
un retry immediato peggiora la situazione. Con sessioni lunghe (script 15-16)
i cluster di errori si intensificano.

**Fix proposto**: Implementare retry con exponential backoff nel `figma-api.ts`:
```typescript
// Retry con backoff per errori transient (429, 500, 502, 503)
const RETRYABLE = [429, 500, 502, 503];
if (RETRYABLE.includes(response.status) && attempt < maxRetries) {
  await sleep(Math.min(1000 * 2 ** attempt, 10000));
  continue;
}
```

**File**: `src/figma/figma-api.ts` (metodo request, linea ~120)

---

## Performance — Colli di Bottiglia

Analisi basata su 2335 log entries durante 49 minuti di QA session (16 script),
con 231 esecuzioni micro-judge e 50 errori API tracciate dal log monitor.

### P-001: Parallelismo micro-judge insufficiente (1.8-3.5x su 7 possibili)

**Severita**: Alta
**Componente**: Main process (subagent/orchestrator.ts, subagent/judge-harness.ts)
**Impatto**: Il judge aggiunge 24-60s per turno quando potrebbe aggiungerne 10-17s.

**Dati misurati** (5 sessioni QA):

| Sessione | Judge runs | Wall time | Sum time | Parallelismo | Ideale |
|----------|-----------|-----------|----------|-------------|--------|
| s_97f61ff7 | 14 (2 retry) | 60s | 106s | 1.8x | 7x |
| s_6dac5530 | 11 (retry) | 56s | 110s | 2.0x | 7x |
| s_06fe1f07 | 7 | 27s | 71s | 2.6x | 7x |
| s_8a17c2c9 | 7 | 24s | 84s | 3.5x | 7x |
| s_f186222d | 36 (5 retry) | 174s | 378s | 2.2x | 7x |

**Root cause**: I 7 micro-judge vengono lanciati con uno stagger di 1-2s tra
ciascuno (offset misurato: 0, 287, 503, 933, 1171, 1311, 1405ms). Questo suggerisce
un lancio sequenziale con overhead di inizializzazione (creazione session, system
prompt injection, prefetch) che serializza parzialmente il lavoro.

**Fix proposto**:
1. Pre-creare tutte le 7 session dei judge prima di lanciarli (batch init)
2. Usare `Promise.allSettled()` con lancio simultaneo dopo il batch init
3. Condividere il contesto pre-fetchato una sola volta (già implementato) ma
   assicurarsi che il prefetch sia completato PRIMA di creare le session

**File**: `src/main/subagent/orchestrator.ts`, `src/main/subagent/judge-harness.ts`

---

### P-002: Judge pass rate ~1% con retry loop automatico

**Severita**: Alta
**Componente**: Main process (subagent/judge-harness.ts)
**Impatto**: Retry loop moltiplica il tempo judge di 2-5x senza migliorare i risultati.

**Dati misurati**: Su 231 esecuzioni micro-judge, solo 2 hanno passato (0.9%).
Ogni sessione ha 0/7 o 1/7 pass, generando retry automatici:
- 7 judge → tutti fail → retry 7 → tutti fail = 14 run, 60s sprecati
- Caso peggiore: 5 retry cycle, 36 run, 174s

**Root cause**: Probabile combinazione di:
1. Soglie dei criteri troppo strette per design rapidi (es. richiedono naming
   semantico perfetto su un singolo bottone creato dall'utente)
2. Contesto insufficiente nel prompt del judge (non vede l'intent dell'utente)
3. `token_compliance` fallisce sempre se non ci sono token configurati nel file

**Fix proposto**:
1. **Tier-based activation**: Non lanciare tutti i 7 judge per creazioni semplici.
   Per un singolo bottone, bastano `completeness` + `visual_hierarchy` + `naming`.
2. **Soglie adattive**: Pass threshold più basso per la prima iterazione (es. 60%),
   più alto solo se l'utente chiede esplicitamente qualità.
3. **Max retry = 1**: Il secondo retry non migliora quasi mai i risultati se il
   primo è fallito al 100%. Limitare a 1 retry massimo.
4. **Skip condizionale**: Se `figma_setup_tokens` non è mai stato chiamato nella
   sessione, skippare `token_compliance`.

**File**: `src/main/subagent/judge-harness.ts` (retry logic, tier config)

---

### P-003: Singoli micro-judge lenti (alignment p90=14s, max=16.3s)

**Severita**: Media
**Componente**: Main process (subagent/judge-harness.ts)

**Dati misurati per judge** (avg / max):

| Judge | Avg | Max | Note |
|-------|-----|-----|------|
| `alignment` | 12.8s | 16.3s | Il più lento — richiede analisi spaziale |
| `visual_hierarchy` | 10.6s | 17.7s | Secondo più lento |
| `completeness` | 11.2s | 14.5s | |
| `componentization` | 10.9s | 16.1s | |
| `naming` | 10.0s | 16.0s | |
| `consistency` | 10.0s | 19.3s | Varianza alta |
| `token_compliance` | 6.9s | 14.2s | Il più veloce ma pass rate 0% |

**Root cause**: Ogni micro-judge crea una session LLM completa con system prompt,
contesto pre-fetchato e screenshot. Il tempo è dominato dalla latenza API del
modello (non dal codice locale). `alignment` è il più lento perché richiede
analisi pixel-level dello screenshot.

**Fix proposto**:
1. Usare un modello più veloce (Haiku) per judge semplici (`naming`, `token_compliance`)
2. Ridurre il contesto passato a ciascun judge (solo lo screenshot + intent, non
   il file_data completo)
3. Timeout per judge a 15s — se supera, riportare "inconclusive" invece di attendere

**File**: `src/main/subagent/judge-harness.ts`, `src/main/subagent/config.ts`

---

### P-004: Figma REST API — 50 errori 403 "Invalid token"

**Severita**: Media
**Componente**: Figma Core (figma/figma-api.ts)
**Impatto**: Tool di discovery falliscono silenziosamente, prefetch degrada il contesto.

**Dati**: Tutti 50 errori sono HTTP 403 con body `{"status":403,"err":"Invalid token"}`.
Avvengono in coppie (~500ms distanza), concentrati durante script 14-16.

**Root cause**: Il token OAuth Figma usato per le REST API (`/v1/files/:key`,
`/v1/files/:key/components`) è scaduto o invalido. L'app usa il token per
arricchire le risposte tool (thumbnails, componenti remoti) ma non verifica
la validità del token prima delle chiamate. Il retry immediato senza check
peggiora la situazione.

**Fix proposto**:
1. **Token validation**: Prima della prima REST call dopo il launch, fare una
   lightweight call (`/v1/me`) per verificare il token. Se 403, mostrare un
   warning nell'UI e disabilitare REST API features.
2. **Circuit breaker**: Dopo 3 errori 403 consecutivi, smettere di chiamare
   l'API REST per il resto della sessione (il token non si auto-ripara).
3. **Graceful fallback**: I tool che usano REST API dovrebbero funzionare
   anche senza — il Bridge plugin WS è il canale primario.

**File**: `src/figma/figma-api.ts`, `src/main/tools/discovery.ts`

---

### P-005: Stagger di lancio app (~7s cold start)

**Severita**: Bassa
**Componente**: Main process (index.ts)
**Impatto**: L'utente attende 7s al primo lancio prima di poter interagire.

**Dati**: TC1.1 riporta launch time di 7373ms. Include: Electron startup, WS server,
slot creation, session init, system prompt load.

**Note**: 7s è accettabile per un'app desktop Electron. Monitorare che non cresca
con l'aggiunta di funzionalità.

---

### Riepilogo priorità performance

| ID | Severità | Impatto stimato | Effort |
|----|----------|----------------|--------|
| P-001 | Alta | -50% tempo judge (da 24-60s a 12-17s) | Medio |
| P-002 | Alta | -70% run judge inutili, -80% retry time | Basso |
| P-003 | Media | -30% latenza singolo judge | Basso |
| P-004 | Media | Elimina 50 errori/sessione, -2s su discovery | Basso |
| P-005 | Bassa | Monitoraggio, non richiede fix | — |

**Quick wins** (alto impatto, basso effort): P-002 (max retry=1, skip token_compliance) + P-004 (circuit breaker su 403).

---

## Cosa funziona bene

Per completezza, il testing ha confermato il corretto funzionamento di:

- Startup app (<500ms), WebSocket bridge, plugin auto-sync
- Happy path completo: prompt -> tool calls -> screenshot -> risposta formattata
- Creazione elementi in Figma via `figma_execute`
- Judge automatico con micro-judges e retry loop
- Multi-tab: switch, isolamento contenuti, sessione preservata
- Prompt queue: accodamento, UI con bottone rimuovi, dequeue automatico
- Restore sessione dal disco (slot + messaggi)
- Input validation: prompt vuoto e whitespace bloccati
- Input lungo (5000 char) accettato con scroll
- New Chat: reset completo (messaggi, context, suggestions)
- Slash commands: menu con 7 comandi
- Follow-up suggestions: chips cliccabili dopo ogni risposta
- Settings panel: 9 sezioni complete, 3 provider OAuth
- Subagent toggle on/off
- Compression profile switch
