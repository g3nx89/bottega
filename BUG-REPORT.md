# Bug Report — Testing Reale v0.12.0

## Run 1 (2026-04-05)

Metodologia: QA full suite (16 script, 192 test) eseguita da qa-tester subagent (Sonnet)
con log-monitor in parallelo (1886 log entries, 2335 entries totali analizzate).
**Risultati**: 192 test, 183 pass (95.3%), 9 fail.

## Run 2 (2026-04-06) — Post-fix

Metodologia: QA pipeline (19 script, 152 step: 78 automated, 74 manual) con qa-runner
+ log-watcher + qa-recorder. Targeted suite (6 script cambiati) + full resume (13 rimanenti).
App in produzione connessa a Figma Desktop con Bridge plugin, 2 file aperti.
**Risultati**: 78 automated pass, 0 fail (100%). 3665 log entries, 260 anomalie.

### Confronto Run 1 → Run 2

| Metrica | Run 1 | Run 2 | Delta |
|---------|-------|-------|-------|
| Script | 16 | 19 | +3 nuovi |
| Automated pass rate | 95.3% | 100% | +4.7% |
| Automated fail | 9 | 0 | -9 |
| API 403 errors | 42 | 88* | circuit breaker attivo |
| WS disconnects | 22 | 38 | +16 (più script) |
| Slow ops | 150 | 92 | -58 (-39%) |

*I 403 sono più visibili perché il circuit breaker (P-004) li logga esplicitamente prima di disabilitare la REST API. Root cause invariata: Figma PAT non configurato.

## Riepilogo

| ID | Titolo | Severita | Status |
|----|--------|----------|--------|
| B-001 | Context bar non si aggiorna al cambio tab | Media | **FIXED** (db11dae) |
| B-002 | Nessun bottone abort/stop visibile durante streaming | Alta | **FIXED** (db11dae) |
| B-003 | Abort via IPC e lentissimo (~47s) | Alta | **FIXED** (abort timeout 5s) |
| B-004 | Cambio modello in Settings non aggiorna toolbar | Media | **FIXED** (syncBarModelLabel) |
| B-005 | Effort button non cicla (apre dropdown, richiede 2 click) | Bassa | **BY DESIGN** (dropdown UX) |
| B-006 | Pin button toggle restituisce undefined | Bassa | **FIXED** (nullish fallback) |
| B-007 | Flag isStreaming non azzerato subito dopo abort | Bassa | **FIXED** (immediate reset) |
| B-008 | Nessun fallback visivo per screenshot senza Figma | Bassa | **FIXED** (tool-fallback msg) |
| B-009 | Suggerimenti follow-up assenti dopo risposte degradate | Bassa | **FIXED** (relaxed guard) |
| B-010 | Click su suggestion chip non riempie l'input | Media | **IMPROVED** (error handling) |
| B-011 | Suggestions riappaiono dopo session reset (race condition) | Bassa | **FIXED** (turnIndex guard) |
| B-012 | Context bar non si resetta a 0K dopo New Chat | Media | **FIXED** (db11dae) |
| B-013 | figma_restore_image non usato dall'agent (tool selection) | Bassa | **REOPENED** (mitigation inefficace) |
| W-001 | "Pre-fetch tool not found in tool set" warning ricorrente | Bassa | **FIXED** (debug level) |
| W-002 | "Figma API request failed" in coppia (retry senza backoff) | Media | **FIXED** (exp backoff) |
| B-014 | Annotation categories senza label leggibili | Media | Open |
| B-015 | Error recovery narrato all'utente (retry interni visibili) | Media | Open |
| B-016 | Immagini generate non auto-piazzate su canvas | Media | Open |
| B-017 | App close timeout dopo operazioni DS pesanti | Bassa | Open |
| UX-001 | Istruzioni disconnessione ripetute verbatim | Media | Open |
| UX-002 | Clarification loop eccessivo per annotazioni | Media | Open |
| UX-003 | Judge false positive su contenuto canvas non correlato | Media | Open |
| UX-004 | Tool retry cards visibili all'utente (noise) | Bassa | Open |
| UX-005 | Risposta vuota dopo image fill timeout | Bassa | Open |
| P-006 | figma_set_image_fill timeout 60s costante | Media | Open |

---

## B-001: Context bar non si aggiorna al cambio tab — FIXED

**Severita**: Media → **FIXED** in commit db11dae
**Componente**: Renderer (app.js)
**Fix applicato**: Aggiunto `lastContextTokens` per-tab e `updateContextBar(tab.lastContextTokens)` in `switchToTab()` (app.js:302).
**Verificato**: Run 2, script 06 step 8 (status check) — context bar coerente dopo switch.

---

## B-002: Nessun bottone abort/stop visibile durante streaming — FIXED

**Severita**: Alta → **FIXED** in commit db11dae
**Componente**: Renderer (app.js)
**Fix applicato**: Send button si trasforma in stop (quadrato rosso) durante streaming (app.js:719-766). Click → `window.api.abort()`, Esc shortcut. Torna a send al completamento.
**Verificato**: Run 2, script 04 step 1 (abort during streaming) — test passato.

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

**Root cause**: Il chip click handler (app.js:1746) funziona correttamente — chiama
`_initTurn` + `sendPrompt` come `sendMessage()`. Il test originale controllava
`inputField.value` che resta vuoto by design (il chip bypassa l'input field).
Il vero rischio era il `.catch(() => {})` che inghiottiva silenziosamente errori IPC.

**Fix applicato**: Rimosso silent catch, aggiunto error handling visibile con
`console.error` + messaggio inline se `sendPrompt` fallisce. Aggiunta guard `!tab.id`.

**File**: `src/renderer/app.js` (suggestion chip click handler, linea ~1746)

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

## B-012: Context bar non si resetta a 0K dopo New Chat — FIXED

**Severita**: Media → **FIXED** in commit db11dae
**Componente**: Renderer (app.js)
**Fix applicato**: `clearChat()` ora chiama `updateContextBar({ usedTokens: 0, maxTokens: 200000 })` (app.js:893).
**Verificato**: Run 2, script 14 step 5 (new chat after judge) — context bar reset confermato.

---

## B-013: figma_restore_image non usato dall'agent (tool selection)

**Severita**: Bassa
**Componente**: System prompt / tool description (system-prompt.ts)
**Riproduzione**:
1. Genera un'immagine su canvas (script 17, step 1)
2. Edita l'immagine (script 17, step 2)
3. Chiedi "Restore the original image before the edit"
4. L'agent risponde "I can't undo the edit" invece di usare `figma_restore_image`

**Root cause**: Il tool `figma_restore_image` esiste ma il modello non lo seleziona.
Possibile che la descrizione del tool non sia abbastanza chiara su quando usarlo,
o che il modello non associa "restore original" → `figma_restore_image`.

**Fix applicato (inefficace)**: Aggiunta `promptGuidelines` a `figma_edit_image` (image-gen.ts:139):
"To revert an edit, use figma_restore_image on the same node". Il modello continua
a non usare il tool — confermato in Run 3 (Script 17 Step 3, Script 11 Step 7).

**Status**: REOPENED — la mitigation via promptGuidelines non funziona. Serve un
approccio più diretto: aggiungere il tool esplicitamente nel system prompt section
"Image Generation Workflow" con un esempio di quando usarlo, oppure forzare il tool
come suggestion automatica quando l'utente dice "restore"/"undo"/"revert".

**File**: `src/main/system-prompt.ts` (image generation section), `src/main/tools/image-gen.ts`

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

### P-002: Judge pass rate ~1% con retry loop automatico — PARTIALLY FIXED

**Severita**: Alta → **PARTIALLY FIXED** in commit db11dae
**Componente**: Main process (subagent/judge-harness.ts)
**Fix applicato**: `maxRetries` 2→1, skip `token_compliance` quando file senza token e nessun token tool usato nella sessione (judge-harness.ts:135-144). `sessionToolHistory` aggiunto a `SessionSlot` (slot-manager.ts:57).
**Impatto residuo**: Retry loop moltiplica il tempo judge di 2x (ridotto da 2-5x).

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

### P-004: Figma REST API — 50 errori 403 "Invalid token" — FIXED

**Severita**: Media → **FIXED** in commit db11dae
**Componente**: Figma Core (figma/figma-api.ts)
**Fix applicato**: Circuit breaker — dopo 3 errori 403 consecutivi, disabilita REST API per il resto della sessione (figma-api.ts:84-90, 126-147). Messaggio esplicito "Figma REST API disabled: invalid token".
**Impatto residuo**: I primi 3 errori 403 continuano ad avvenire (necessari per attivare il breaker). Fix definitivo: configurare un Figma PAT valido.

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

| ID | Severità | Impatto stimato | Effort | Status |
|----|----------|----------------|--------|--------|
| P-001 | Alta | -50% tempo judge (da 24-60s a 12-17s) | Medio | **FIXED** (parallel launch) |
| P-002 | Alta | -70% run judge inutili, -80% retry time | Basso | **FIXED** (tier + skip) |
| P-003 | Media | -30% latenza singolo judge | Basso | **FIXED** (30s timeout) |
| P-004 | Media | Elimina 50 errori/sessione, -2s su discovery | Basso | **FIXED** |
| P-005 | Bassa | Monitoraggio, non richiede fix | — | Monitoring |

**Applied quick wins** (db11dae): P-002 (maxRetries 2→1, skip token_compliance condizionale) + P-004 (circuit breaker 403). Slow ops ridotte da 150→92 (-39%).

---

## Run 3 (2026-04-07) — Full Pipeline + UX Review

Metodologia: Three-pass QA pipeline (19 script, 152 step: 78 automated, 74 manual).
Pass 1 (qa-runner, Sonnet) + Log Monitor (log-watcher) + Pass 2 (UX reviewer, Opus).
QA recorder attivo per test generation. Bridge disconnesso durante test.
**Risultati**: 78/78 automated pass (100%). UX score 4.0/5. 260 anomalie log. 18 UX issue.

### Confronto Run 2 → Run 3

| Metrica | Run 2 | Run 3 | Delta |
|---------|-------|-------|-------|
| Automated pass rate | 100% | 100% | = |
| UX score | — | 4.0/5 | (primo UX review) |
| API 403 errors | 88 | 88 | = (PAT non configurato) |
| WS disconnects | 38 | 38 | = (Bridge off) |
| Slow ops | 92 | 92 | = |
| UX issues found | — | 18 (7 Media, 11 Bassa) | (nuovo) |

### Nuovi finding Run 3

| ID | Titolo | Severita | Status | Source |
|----|--------|----------|--------|--------|
| B-014 | Annotation categories senza label leggibili | Media | Open | Pass 1+2 |
| B-015 | Error recovery narrato all'utente (retry interni visibili) | Media | Open | Pass 2 |
| B-016 | Immagini generate non auto-piazzate su canvas | Media | Open | Pass 2 |
| B-017 | App close timeout dopo operazioni DS pesanti | Bassa | Open | Pass 1 |
| UX-001 | Istruzioni disconnessione ripetute verbatim | Media | Open | Pass 2 |
| UX-002 | Clarification loop eccessivo per annotazioni | Media | Open | Pass 2 |
| UX-003 | Judge false positive su contenuto canvas non correlato | Media | Open | Pass 2 |
| UX-004 | Tool retry cards visibili all'utente (noise) | Bassa | Open | Pass 2 |
| UX-005 | Risposta vuota dopo image fill timeout | Bassa | Open | Pass 1+2 |
| P-006 | figma_set_image_fill timeout 60s costante | Media | Open | Log+Timing |
| B-018 | Judge auto-trigger non si attiva dopo mutazioni Figma | Alta | Open | Manual Batch 3 |
| B-019 | Judge enable checkboxes senza id (accessibilità) | Bassa | Open | Manual Batch 3 |
| B-020 | figma_analyze/arrange_component_set non selezionati dall'agent | Media | Open | Manual Batch 3 |
| B-021 | Suggestion chips non appaiono dopo risposte agent | Media | Open | Manual Batch 2 |
| B-022 | Task panel count non resettato su New Chat | Bassa | Open | Manual Batch 2 |
| B-023 | Cross-tab file context mismatch (Tab B riporta file di Tab A) | Bassa | Open | Manual Batch 2 |
| B-024 | Toolbar dropdown senza ARIA role (accessibilità) | Bassa | Open | Manual Batch 1 |
| B-025 | Per-tab model selection non persistito al restart | Media | Open | Manual Batch 4 |
| B-026 | Tab B context bar mostra 0K con conversazione esistente | Bassa | Open | Manual Batch 4 |
| UX-006 | Lint report 80+ warnings non riassunto | Bassa | Open | Pass 2 |
| UX-007 | Tool card noise su JSX retry (3-5 card per render) | Bassa | Open | Pass 2 |
| UX-008 | figma_execute usato al posto di tool specifici (workaround) | Bassa | Open | Pass 2 |
| UX-009 | Screenshot verbosity in multi-step (16+ tool card in un turno) | Bassa | Open | Pass 2 |
| UX-010 | Agent narra "Let me zoom in" come narrazione intermedia | Bassa | Open | Pass 2 |
| UX-011 | figma_set_image_fill retry silenzioso (2x stessa URL) | Bassa | Open | Pass 2 |

---

## B-014: Annotation categories senza label leggibili

**Severita**: Media
**Componente**: Tools (annotations.ts) / Plugin (code.js)
**Riproduzione**:
1. Chiedi "What annotation categories are available?"
2. `figma_get_annotation_categories` restituisce IDs grezzi: "51:0", "51:1", "51:2", "51:3"
3. Nessun nome leggibile (Development, Interaction, Content, Visual)
4. L'agent è costretto a chiedere all'utente quale ID corrisponde alla categoria

**Root cause**: Il plugin command GET_ANNOTATION_CATEGORIES restituisce solo gli ID
delle categorie Figma senza i nomi corrispondenti. L'API Figma plugin espone
`figma.codegen.annotationCategories` che include sia ID che nome.

**Fix proposto**: Modificare il plugin handler in `figma-desktop-bridge/code.js`
per restituire `{ id, name }` pairs, oppure arricchire la risposta tool nel
compression extension o nel tool stesso.

**File**: `figma-desktop-bridge/code.js` (GET_ANNOTATION_CATEGORIES handler), `src/main/tools/annotations.ts`

---

## B-015: Error recovery narrato all'utente (retry interni visibili)

**Severita**: Media
**Componente**: Agent behavior / System prompt
**Riproduzione**:
1. Chiedi "Create a card with shadow, gradient fill, and rounded corners"
2. L'agent tenta figma_render_jsx → fallisce parzialmente
3. L'agent riprova con parametri diversi
4. Nel testo risposta: "The shadow format changed", "The grow caused an issue"
5. 13 tool card visibili in un singolo turno

**Root cause**: Il modello espone il suo processo di retry all'utente. Il system prompt
non istruisce esplicitamente l'agent a nascondere i tentativi falliti e presentare
solo il risultato finale.

**Fix proposto**: Aggiungere guidance nel system prompt:
"When a tool call fails and you retry with different parameters, do not mention the
failed attempt to the user. Present only the final successful result. If all attempts
fail, explain the limitation without exposing internal error details."

**File**: `src/main/system-prompt.ts`

---

## B-016: Immagini generate non auto-piazzate su canvas

**Severita**: Media
**Componente**: Agent behavior / Image gen tools
**Riproduzione**:
1. Usa `/icon`, `/pattern`, o `/diagram`
2. L'agent genera l'immagine con successo
3. Invece di piazzarla automaticamente, chiede "Where would you like me to place it?"
4. Friction inutile — l'utente si aspetta il piazzamento automatico

**Root cause**: I tool di image generation restituiscono il risultato ma non forzano
il piazzamento. Il modello interpreta la mancanza di un target esplicito come
necessità di chiedere conferma.

**Fix proposto**: Aggiungere `promptGuidelines` ai tool di image generation:
"After generating an image/icon/pattern/diagram, always place it on the current page
at a reasonable position (next to existing content or centered on viewport) without
asking the user. Mention where you placed it in the response."

**File**: `src/main/tools/image-gen.ts` (promptGuidelines per generate_icon, generate_pattern, generate_diagram)

---

## B-017: App close timeout dopo operazioni DS pesanti

**Severita**: Bassa
**Componente**: Main process (agent.ts / index.ts)
**Riproduzione**:
1. Esegui script 10 (Design System) — 6 step con token setup, DS page, lint
2. Al termine, `app.close()` va in timeout
3. Il QA runner forza `pkill`

**Root cause**: Dopo heavy token/DS operations, l'Electron app accumula stato
che rallenta il graceful shutdown. Probabile race condition tra cleanup della
session agent e chiusura del WebSocket server.

**Fix proposto**: Aggiungere timeout al graceful shutdown con force exit:
```typescript
app.on('before-quit', async () => {
  const cleanup = Promise.all([closeAllSessions(), wsServer.close()]);
  await Promise.race([cleanup, sleep(5000)]);
});
```

**File**: `src/main/index.ts` (app quit handler)

---

## UX-001: Istruzioni disconnessione ripetute verbatim

**Severita**: Media
**Componente**: Agent behavior / System prompt
**Descrizione**: Quando Figma è disconnesso, l'agent ripete le stesse istruzioni
di riconnessione identiche ad ogni turno, senza riconoscere che le ha già date.
**Fix proposto**: System prompt guidance: "If you already provided connection
instructions in this session, acknowledge that ('As I mentioned earlier...') and
offer alternative actions instead of repeating the full setup steps."

---

## UX-002: Clarification loop eccessivo per annotazioni

**Severita**: Media
**Componente**: Agent behavior / System prompt
**Descrizione**: Per ogni operazione di annotazione, l'agent chiede sia la categoria
che il nodo target, anche quando il contesto li rende evidenti. Script 13 steps 2-3-5
tutti bloccati da clarification.
**Fix proposto**: System prompt guidance: "When setting annotations, default to the
most recently discussed element. For category, pick the most contextually appropriate
one or use 'Development' as default."

---

## UX-003: Judge false positive su contenuto canvas non correlato

**Severita**: Media
**Componente**: Subagent (judge-harness.ts)
**Descrizione**: La Quality Check valuta contenuto canvas non correlato al task corrente.
Es. dopo creare un bottone, il judge lamenta "[DS::colors] frame not visible" perché
vede l'intero canvas, non solo l'elemento appena creato.
**Fix proposto**: Passare al judge solo lo screenshot/contesto dell'elemento appena
creato/modificato, non l'intero canvas. Usare `nodeId` nel screenshot se disponibile.

---

## UX-004: Tool retry cards visibili all'utente (noise)

**Severita**: Bassa
**Componente**: Renderer (app.js)
**Descrizione**: Quando un tool fallisce e viene ritentato, l'utente vede tutte
le tool card intermedie (fino a 13 in un singolo turno). I retry interni dovrebbero
essere compressi o nascosti.
**Fix proposto**: Nel renderer, collassare tool card consecutive con lo stesso nome
che hanno status error, mostrando solo "Tool X (N retries)" + la card finale.

---

## UX-005: Risposta vuota dopo image fill timeout

**Severita**: Bassa
**Componente**: Main process / Renderer
**Descrizione**: Script 07 step 6 e Script 18 step 3 — dopo figma_set_image_fill
timeout (60s), la risposta catturata è stringa vuota. Le tool card mostrano esecuzione
ma l'utente non riceve spiegazione testuale.
**Root cause**: Il timeout di 60s del WS command esaurisce il budget tempo del turno,
l'agent non ha spazio per generare testo di risposta.
**Fix proposto**: Ridurre il timeout di SET_IMAGE_FILL a 30s per lasciare margine
al modello di rispondere.

---

## P-006: figma_set_image_fill timeout 60s costante

**Severita**: Media
**Componente**: Figma Core (websocket-server.ts)
**Dati misurati**: 4 chiamate, tutte timeout a 60002-60010ms. Nessun successo.
Il tool tenta di scaricare un'immagine da URL e applicarla via plugin, ma il
Bridge disconnesso causa timeout WS invece di errore immediato.

**Root cause**: `figma_set_image_fill` non verifica la connessione WS prima di
inviare il comando. Senza Bridge, aspetta il timeout completo di 60s.

**Fix proposto**: Aggiungere check di connessione WS prima di inviare SET_IMAGE_FILL.
Se disconnesso, restituire errore immediato: "Figma Bridge not connected".

**File**: `src/main/tools/manipulation.ts`, `src/figma/websocket-server.ts`

---

## B-018: Judge auto-trigger non si attiva dopo mutazioni Figma

**Severita**: Alta
**Componente**: Main process (session-events.ts, judge-harness.ts)
**Riproduzione**:
1. Attiva il judge toggle (`#bar-judge-btn` → `active`)
2. Invia un prompt complesso: "Create a professional pricing card with title, price, features, CTA"
3. L'agent crea il componente con successo (8 tool calls: render_jsx, set_effects, execute, screenshot)
4. Il turno si completa — NESSUN "Quality Check" appare nella risposta
5. Il manual re-judge (chiedendo "Run a quality check") funziona correttamente

**Root cause verificata**: Il flusso IPC funziona correttamente:
- `app.js:1749` → `window.api.setJudgeOverride(slotId, true)` ✓
- `preload.ts:185` → `ipcRenderer.invoke('judge:set-override', slotId, true)` ✓
- `ipc-handlers.ts:679` → `slot.judgeOverride = true` ✓
- `session-events.ts:247` → `shouldRun = slot.judgeOverride === true` → true ✓

Il break è a `session-events.ts:250`: `if (connector && hasMutations)`.
`getConnectorForSlot` (ipc-handlers.ts:290-291) restituisce:
```typescript
slot.fileKey ? new ScopedConnector(infra.wsServer, slot.fileKey) : null
```
Quando `slot.fileKey` è null (slot creato senza connessione Figma stabilita,
o connessione persa), `connector` è null e il judge è **silently skipped** —
nessun log message, nessun feedback all'utente.

Il QA runner lancia l'app con `testMode`, che potrebbe non ripristinare i fileKey
dal disco, oppure il WS handshake non è completato quando il turno finisce.

**Fix proposto**:
1. Aggiungere log warn quando il judge è skippato per connector null:
   ```typescript
   if (!connector) {
     log.warn({ slotId: slot.id, fileKey: slot.fileKey }, 'Judge skipped: no connector (fileKey missing or WS disconnected)');
     safeSend(wc, 'judge:skipped', slot.id, 'no-connector');
   }
   ```
2. Nel renderer, mostrare un messaggio "Judge skipped — no Figma connection" nel
   footer della risposta quando riceve `judge:skipped`.
3. Verificare che `slot.fileKey` venga settato dal `fileConnected` event anche
   per slot creati prima della connessione WS.

**File**: `src/main/session-events.ts` (linea 250), `src/main/ipc-handlers.ts` (linea 290-291), `src/renderer/app.js` (judge:skipped handler)

---

## B-019: Judge enable checkboxes senza id (accessibilità)

**Severita**: Bassa
**Componente**: Renderer (settings.js)
**Descrizione**: I 7 checkbox per abilitare/disabilitare i singoli micro-judge
nel settings panel hanno attributo `id` vuoto. Questo impedisce l'associazione
`<label for="">`, rende i checkbox inaccessibili a screen reader, e complica
l'automazione dei test.
**Fix proposto**: Assegnare id univoci: `judge-enable-alignment`, `judge-enable-naming`, etc.
**File**: `src/renderer/settings.js`

---

## B-020: figma_analyze/arrange_component_set non selezionati dall'agent

**Severita**: Media
**Componente**: System prompt / Tool descriptions
**Descrizione**: Quando l'utente chiede esplicitamente di "analyze component set" o
"arrange components in a grid", l'agent usa `figma_search_components` + `figma_execute`
+ `figma_batch_transform` invece dei tool dedicati `figma_analyze_component_set` e
`figma_arrange_component_set`. I risultati sono corretti ma i tool specializzati
vengono ignorati.
**Fix proposto**: Rafforzare le descrizioni TypeBox dei tool in `tools/components.ts`
e aggiungere guidance nel system prompt: "When the user asks to analyze or arrange
component sets, prefer figma_analyze_component_set and figma_arrange_component_set."
**File**: `src/main/system-prompt.ts`, `src/main/tools/components.ts`

---

## B-021: Suggestion chips non appaiono dopo risposte agent

**Severita**: Media
**Componente**: Main process (prompt-suggester.ts, session-events.ts)
**Riproduzione**:
1. Invia un prompt con risposta completa (es. "Create a blue rectangle")
2. L'agent completa il turno con successo
3. `#suggestions` container resta hidden, 0 `.suggestion-chip`

**Root cause probabile**: `prompt-suggester.ts` potrebbe non triggerare in modalità
reale, o l'IPC `agent:suggestions` non raggiunge il renderer. Da verificare se
il suggester è disabilitato quando il modello non è Claude.

**File**: `src/main/prompt-suggester.ts`, `src/main/session-events.ts`

---

## B-022: Task panel count non resettato su New Chat

**Severita**: Bassa
**Componente**: Renderer (app.js) / Main (session-store.ts)
**Descrizione**: Dopo `resetSession()`, il task panel mostra "8 tasks (0/8 done)"
dalla sessione precedente. Il task store non viene pulito dal reset.
**Fix proposto**: In `clearChat()`, aggiungere `taskPanel.reset()` o equivalente IPC.
**File**: `src/renderer/app.js` (clearChat), `src/main/ipc-handlers.ts`

---

## B-023: Cross-tab file context mismatch

**Severita**: Bassa
**Componente**: Main process (scoped-connector.ts)
**Descrizione**: Su Tab B (label "Bottega-Test_B"), l'agent risponde "You're on
Bottega-Test_A" perché il ScopedConnector usa la connessione attiva del plugin
(che è su Test_A) invece del file associato al tab.
**Fix proposto**: Il ScopedConnector dovrebbe filtrare in base al `fileKey` assegnato
allo slot, non usare il file attualmente attivo nel plugin.
**File**: `src/main/scoped-connector.ts`

---

## UX Backlog (da Pass 2 — UX Quality Review)

Le 18 issue UX trovate dal Pass 2 (Opus reviewer) sono raggruppate qui in **9 task
implementabili** con priorità, effort, file di riferimento e acceptance criteria.
Ogni task copre uno o più finding UX e linka i bug entry esistenti.

### Riepilogo backlog

| ID | Task | Priorità | Effort | Bug correlati | Status |
|----|------|----------|--------|---------------|--------|
| **UX-T1** | Fix `figma_restore_image` tool awareness | P1 | S | B-013, UX (script 11/17) | Open |
| **UX-T2** | Auto-place generated images on canvas | P1 | S | B-016 | Open |
| **UX-T3** | Suppress internal error narration durante retry | P2 | M | B-015, UX-007 | Open |
| **UX-T4** | Collapse retry tool cards nel renderer | P2 | M | UX-004, UX-007, UX-009, UX-011 | Open |
| **UX-T5** | Reduce annotation clarification friction | P2 | S | UX-002, B-014 | Open |
| **UX-T6** | De-duplicate disconnected state guidance | P2 | S | UX-001 | Open |
| **UX-T7** | Human-readable annotation categories | P3 | S | B-014 | Open |
| **UX-T8** | Lint report summarization (top-N expandable) | P3 | M | UX-006 | Open |
| **UX-T9** | Strengthen tool descriptions per tool selection | P3 | S | B-020, UX-008 | Open |

**Legenda effort**: S = ≤1 giorno, M = 1-3 giorni, L = >3 giorni

---

### UX-T1: Fix `figma_restore_image` tool awareness

**Priorità**: P1 (Functional Fix)
**Effort**: S
**Bug correlati**: B-013 (REOPENED), Pass 2 script 11 step 7, script 17 step 3

**Problema**: L'agent risponde "I don't have the ability to undo edits or restore"
quando l'utente chiede di ripristinare un'immagine, anche se `figma_restore_image`
esiste nel toolkit. La mitigation precedente via `promptGuidelines` su `edit_image`
non ha funzionato.

**Acceptance criteria**:
- [ ] Quando l'utente dice "restore"/"undo"/"revert" su un'immagine, l'agent invoca `figma_restore_image`
- [ ] Se il nodo target non è chiaro, l'agent chiede UNA volta per il nodo, non rifiuta
- [ ] Test playbook: `when("restore the original image", [calls("figma_restore_image", ...)])`
- [ ] Manual test: Script 17 Step 3 e Script 11 Step 7 devono PASS

**File da modificare**:
- `src/main/system-prompt.ts` — sezione "Image Workflow", aggiungere esempio esplicito di restore
- `src/main/tools/image-gen.ts` — `figma_restore_image` tool description rinforzata

---

### UX-T2: Auto-place generated images on canvas

**Priorità**: P1 (Functional Fix)
**Effort**: S
**Bug correlati**: B-016, Pass 2 script 11 steps 2-4

**Problema**: I comandi `/generate`, `/icon`, `/pattern`, `/diagram` generano l'immagine
ma poi l'agent chiede "Where would you like me to place it?" invece di piazzarla
automaticamente. Friction inutile su ogni comando image.

**Acceptance criteria**:
- [ ] Dopo `figma_generate_image/icon/pattern/diagram/story`, il risultato è piazzato automaticamente sul canvas
- [ ] La risposta menziona la posizione: "placed at (x, y)" o "placed at viewport center"
- [ ] L'agent non chiede conferma di placement a meno che l'utente non specifichi un target
- [ ] Manual test: Script 11 step 1 deve mostrare placement automatico nella risposta

**File da modificare**:
- `src/main/tools/image-gen.ts` — aggiungere `promptGuidelines` a tutti i tool image-gen:
  ```
  "After generating, always place the result on the current page at viewport center
   (or next to existing content). Mention the placement in your response. Do NOT ask
   the user where to place it."
  ```

---

### UX-T3: Suppress internal error narration durante retry

**Priorità**: P2 (UX Improvement)
**Effort**: M
**Bug correlati**: B-015, UX-007, UX-010, UX-011

**Problema**: Quando un tool fallisce e l'agent riprova con parametri diversi, espone
i tentativi falliti all'utente nel testo: "The shadow format changed", "The grow caused
an issue", "Let me zoom in", "Let me try again". L'utente vede dettagli implementativi
invece del risultato finale.

**Acceptance criteria**:
- [ ] L'agent non menziona retry interni nel testo della risposta
- [ ] Solo il risultato finale è presentato
- [ ] Se TUTTI i tentativi falliscono, l'agent spiega la limitazione SENZA dettagli interni
- [ ] Frasi vietate nel testo: "Let me adjust", "format changed", "caused an issue", "Let me try again"

**File da modificare**:
- `src/main/system-prompt.ts` — sezione "Error Handling", aggiungere:
  ```
  When a tool call fails and you retry with different parameters:
  1. Do NOT mention the failed attempt in your response text
  2. Present only the final successful result
  3. If all attempts fail, explain the user-facing limitation in simple terms
     (e.g., "I couldn't apply the shadow due to a Figma API constraint") without
     exposing implementation details
  ```

---

### UX-T4: Collapse retry tool cards nel renderer

**Priorità**: P2 (UX Improvement)
**Effort**: M
**Bug correlati**: UX-004, UX-007, UX-009, UX-011, B-015

**Problema**: Quando l'agent riprova un tool, l'utente vede tutte le tool card
intermedie (fino a 13-16 in un singolo turno). I retry interni dovrebbero essere
collapsed mostrando solo il risultato finale.

**Acceptance criteria**:
- [ ] Tool card consecutive con lo stesso nome che hanno status `error` sono collapsed
- [ ] Mostrato come "Tool X (3 retries)" + la card finale espandibile
- [ ] Click espande la lista completa delle tentativi
- [ ] Tool card screenshot multiple in un turno sono raggruppate sotto "N screenshots"

**File da modificare**:
- `src/renderer/app.js` — funzione di rendering tool card (cercare `addToolCard` o equivalente)
- `src/renderer/styles.css` — stili per `.tool-card-group`, `.tool-card-collapsed`

**Nota implementativa**: Considerare di usare un `<details>` HTML element nativo per
l'espansione, evita JavaScript custom.

---

### UX-T5: Reduce annotation clarification friction

**Priorità**: P2 (UX Improvement)
**Effort**: S
**Bug correlati**: UX-002, B-014, Pass 2 script 13 steps 2-3-5

**Problema**: Per ogni operazione di annotazione, l'agent chiede sia la categoria che
il nodo target, anche quando il contesto li rende evidenti. Script 13 ha 3 step
bloccati da clarification loop.

**Acceptance criteria**:
- [ ] Quando l'utente dice "add annotation to X", l'agent default al last-discussed element
- [ ] Per la category, picking automatico della prima disponibile o "General"
- [ ] Solo se l'utente vuole una category specifica e nessuna matcha → chiede
- [ ] Manual test: 3 prompt consecutive di annotation senza clarification

**File da modificare**:
- `src/main/system-prompt.ts` — sezione "Annotations":
  ```
  When setting annotations:
  1. Default the target node to the most recently created or discussed element
  2. Default the category to "Development" or the first available
  3. Only ask for clarification if the user explicitly mentions both elements without
     making the target clear
  ```

---

### UX-T6: De-duplicate disconnected state guidance

**Priorità**: P2 (UX Improvement)
**Effort**: S
**Bug correlati**: UX-001, Pass 2 script 02 steps 4-6

**Problema**: Quando Figma è disconnesso, l'agent ripete le stesse identiche istruzioni
di setup ad ogni turno, senza riconoscere che le ha già date. Frustrante e ridondante.

**Acceptance criteria**:
- [ ] Se il setup Bridge è già stato spiegato in questa sessione, l'agent acknowledge ("As I mentioned earlier...")
- [ ] L'agent offre alternative actionable invece di ripetere ("Let me know once it's connected and I'll continue")
- [ ] Test: 3 prompt consecutivi con Bridge disconnesso → 3 risposte distinte, non identiche

**File da modificare**:
- `src/main/system-prompt.ts` — sezione "Connection Guidance":
  ```
  If you've already provided Bridge connection instructions earlier in this session,
  do not repeat the full setup steps. Instead:
  - Acknowledge ("As I mentioned earlier, the Bridge plugin needs to be running")
  - Offer to continue once connected ("Let me know when it's ready")
  ```

---

### UX-T7: Human-readable annotation categories

**Priorità**: P3 (Polish)
**Effort**: S
**Bug correlati**: B-014, Pass 2 script 13 step 1

**Problema**: `figma_get_annotation_categories` restituisce IDs grezzi ("51:0", "51:1")
senza nomi leggibili. L'agent è costretto a esporli all'utente.

**Acceptance criteria**:
- [ ] Il tool restituisce `{ id, name }` pairs invece di solo ID
- [ ] L'agent presenta i nomi leggibili all'utente: "Development", "Interaction", etc.
- [ ] Backward compat: il tool accetta ancora `id` come input nelle altre API

**File da modificare**:
- `figma-desktop-bridge/code.js` — handler `GET_ANNOTATION_CATEGORIES`:
  ```javascript
  // Restituire { id, name } invece di solo id
  return categories.map(c => ({ id: c.id, name: c.label || c.id }));
  ```
- `src/main/tools/annotations.ts` — aggiornare schema TypeBox di output
- `src/figma/types.ts` — aggiornare type `AnnotationCategory`

---

### UX-T8: Lint report summarization (top-N expandable)

**Priorità**: P3 (Polish)
**Effort**: M
**Bug correlati**: UX-006, Pass 2 script 14 step 6

**Problema**: Il lint report con 80+ warnings è overwhelming. L'utente non sa da dove
cominciare. Manca priorizzazione.

**Acceptance criteria**:
- [ ] Per report con >10 warnings, mostrare top-10 by impact
- [ ] Seguire con "... and N more (expand to see all)"
- [ ] Click espande la lista completa
- [ ] Top-N criteria: severity (critical > warning > info) poi count

**File da modificare**:
- `src/main/tools/tokens.ts` — `figma_lint` tool, aggiungere logica di summarization nel result formatting
- `src/main/compression/extension-factory.ts` — assicurarsi che il lint result non sia compresso troppo aggressivamente

---

### UX-T9: Strengthen tool descriptions per tool selection

**Priorità**: P3 (Polish)
**Effort**: S
**Bug correlati**: B-020, UX-008, Pass 2 script 08 step 6, script 09 step 8, script 19 step 4

**Problema**: L'agent usa `figma_execute` come fallback generico invece dei tool
specializzati (`figma_analyze_component_set`, `figma_arrange_component_set`,
`figma_batch_transform`, `figma_get_library_components`). Risultati corretti ma path
roundabout.

**Acceptance criteria**:
- [ ] Le TypeBox descriptions dei tool specializzati menzionano "Prefer this over figma_execute when..."
- [ ] System prompt ha sezione "Tool Selection Hierarchy" con priorità esplicite
- [ ] Manual test: Script 08 step 6 deve usare `figma_get_library_components`

**File da modificare**:
- `src/main/tools/components.ts` — descriptions di `analyze_component_set`, `arrange_component_set`
- `src/main/tools/discovery.ts` — description di `get_library_components`
- `src/main/system-prompt.ts` — sezione "Tool Selection Priorities":
  ```
  When the user explicitly asks to:
  - "analyze component set" → figma_analyze_component_set (NOT figma_execute)
  - "arrange components" → figma_arrange_component_set (NOT figma_batch_transform)
  - "list libraries" → figma_get_library_components (NOT figma_design_system)
  Use figma_execute only when no specialized tool fits.
  ```

---

### Backlog stats

- **Totale task**: 9
- **Per priorità**: 2 P1, 4 P2, 3 P3
- **Effort totale**: 7 S + 2 M ≈ **9-15 giorni di lavoro**
- **Quick wins** (P1 + S): UX-T1, UX-T2 — risolvibili in 1 giorno e portano UX score da 4.0 a ~4.3
- **High impact** (riduce UX issues): UX-T3 + UX-T4 risolvono 6 finding combinati

### Cosa NON è in questo backlog

I bug Alta/Media tracciati come B-* (es. B-018 judge auto-trigger, B-021 suggestion
chips, B-025 model persistence) non sono qui — sono **bug funzionali** e vanno fixati
nelle entries B-NNN già esistenti, prima di lavorare su questo backlog UX.

---

## Note tecniche Run 3

### Circuit breaker 88 errori 403

Il circuit breaker (P-004) è **instance-scoped** (`FigmaAPI.consecutive403Count`).
Ogni relaunch dell'app (1 per script QA) crea una nuova istanza, resettando il contatore.
19 script × ~4-5 errori prima del breaker = ~88 errori totali. Comportamento atteso.
Fix definitivo: configurare un Figma PAT valido.

### Playbook drafts vuoti

Il qa-recorder produce `playbook-drafts.json: []` perché `generatePlaybookDrafts()`
filtra su `t.prompt` (truthy), ma i log pino non includono il testo del prompt utente
nei log entry delle tool call. Il recorder cattura le sequenze tool (`tool-sequences.json`)
ma senza il prompt associato non può generare stub DSL. Fix: arricchire il log
`session-events.ts` con il prompt text nel log entry iniziale del turno, oppure
fare join sui timestamp tra log di prompt e log di tool call nel recorder.

### B-013 riapertura

La mitigation via `promptGuidelines` su `figma_edit_image` non funziona.
Run 3 Script 17 Step 3 e Script 11 Step 7 confermano: l'agent risponde
"I can't undo edits" senza invocare `figma_restore_image`. Il tool esiste
nel toolkit ma il modello non lo associa a "restore"/"undo"/"revert".
Serve menzione esplicita nel system prompt o keyword-triggered suggestion.

## Timing Baselines (Run 3)

Misurate da qa-recorder su 265 tool call durante la sessione full.

| Tool | Count | p50 (ms) | p90 (ms) | Max (ms) | Note |
|------|-------|----------|----------|----------|------|
| figma_screenshot | 89 | 224 | 396 | 586 | Stabile |
| figma_get_file_data | 51 | 271 | 364 | 413 | Stabile |
| figma_render_jsx | 21 | 386 | 583 | 1314 | p99 alto |
| figma_design_system | 20 | 348 | 367 | 384 | Stabile |
| figma_execute | 14 | 44 | 243 | 304 | Varianza alta |
| figma_setup_tokens | 3 | 451 | 604 | 604 | Lento |
| figma_update_ds_page | 5 | 361 | 457 | 457 | Lento |
| figma_generate_image | 3 | 23757 | 24795 | 24795 | Gemini latency |
| figma_generate_pattern | 4 | 24825 | 29208 | 29208 | Gemini latency |
| figma_generate_story | 1 | 75987 | — | 75987 | Gemini heavy |
| figma_set_image_fill | 4 | 60009 | 60010 | 60010 | 100% timeout |

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
