# Hardening architetturale Rewind/WS/renderer — prompt sessione fresca

## Contesto

Progetto: **Bottega** — macOS Electron app per design pair-programming con Figma Desktop.
Stack: TypeScript ESM (main), CJS (preload), vanilla JS (renderer), esbuild, vitest + Playwright-Electron.
Working directory: `/Users/afato/Projects/bottega`.
CLAUDE.md già carica contesto architetturale — non servono altre spiegazioni di base.

Una sessione di analisi precedente ha identificato **17 bug** in un feature Rewind/Checkpoint/Undo (cartella `src/main/rewind/` + `src/renderer/rewind-modal.js`) + **3 pattern emergenti** diffusi nel codebase. I 17 bug iniziali sono già stati fixati (branch corrente, uncommitted). Questa sessione implementa le **4 pattern-level fix** residue (esclusa quella sui mock-connector default, troppo invasiva).

Suite attuale: **2863/2863 unit verdi** + **10/10 UAT verdi**. Obiettivo: restare al 100% dopo ogni fix.

## Modalità operativa

- **Commit separato per ogni fix** (4 commit totali). Messaggi conventional commits (`refactor:`, `fix:`, `test:`).
- **Validate dopo ogni fix**: `npx vitest run` deve restare verde prima di procedere al fix successivo.
- Caveman mode OFF per questa sessione — risposte normali, ma codice/commit messages come sempre professionali.
- Se un fix rompe altro, **fermati e chiedi** — non forzare.

## FIX 1 — Unificare `PLUGIN_VERSION` cross-layer 🔴 CRITICO

### Problema

Numero di versione del protocollo plugin duplicato tra main-side e bridge-side:
- `src/figma/websocket-server.ts:24` → `export const REQUIRED_PLUGIN_VERSION = 2;`
- `figma-desktop-bridge/ui.html:521` → `var PLUGIN_VERSION = 2;` (hardcoded)

Un bump unilaterale produce **handshake failure silenzioso**: il server invia `VERSION_MISMATCH` e chiude la connessione, l'utente vede "Figma non connesso" senza capire perché.

### Fix

1. Creare `src/shared/plugin-protocol.ts`:
   ```ts
   /** Protocol version for the Figma Desktop Bridge ↔ main handshake.
    * Bump TOGETHER with ui.html#PLUGIN_VERSION. */
   export const PLUGIN_PROTOCOL_VERSION = 2;
   ```
2. In `src/figma/websocket-server.ts` sostituire la const locale con import dal file condiviso (`REQUIRED_PLUGIN_VERSION` resta come alias esportato per compatibility).
3. In `figma-desktop-bridge/ui.html:521`: il file è vanilla JS dentro `<script>`. Non si può importare ESM. **Strategia**:
   - Aggiungere commento `// MUST match src/shared/plugin-protocol.ts#PLUGIN_PROTOCOL_VERSION`
   - Opzionale: `scripts/build.mjs` già ha esbuild `define` — aggiungere `define['__PLUGIN_VERSION__'] = JSON.stringify(PLUGIN_PROTOCOL_VERSION)` e modificare ui.html per leggere `__PLUGIN_VERSION__` iniettato. Ma ui.html non passa per esbuild attualmente. Valuta se vale la pena.
   - **Compromesso accettabile**: commento + test runtime in `scripts/build.mjs` che legge entrambi i file e fallisce se disallineati.

### Test

Aggiungere `tests/unit/shared/plugin-protocol.test.ts`:
- Verifica che `PLUGIN_PROTOCOL_VERSION` sia un intero positivo
- Verifica che `ui.html` (letto da fs) contenga `var PLUGIN_VERSION = ${PLUGIN_PROTOCOL_VERSION}` — fallisce se drift

### Validazione

```bash
npx vitest run tests/unit/shared/ tests/unit/figma/websocket-server.test.ts tests/unit/figma/bridge-probe-integration.test.ts
```

---

## FIX 2 — Estrarre `WS_TIMEOUT_MS` + eliminare magic 30000 🔴 ALTO

### Problema

`30000` hardcoded 8+ volte:
- `src/figma/websocket-server.ts:168, 250` (OPERATION_PROGRESS 30s stall)
- `src/figma/websocket-connector.ts:70, 303, 344, 356, 360`
- `figma-desktop-bridge/ui.html:414, 467, 489, 494`

Ogni cambio deve propagare manualmente a 8 siti. Drift produce stall detection disallineato server↔client.

Stesso pattern per `300000` REFRESH_VARIABLES:
- `websocket-connector.ts:102` ↔ `ui.html:235, 244`

### Fix

1. In `src/figma/websocket-server.ts` esportare:
   ```ts
   export const WS_COMMAND_DEFAULT_TIMEOUT_MS = 15_000; // already used as sendCommand default
   export const WS_STALL_DETECTION_MS = 30_000;
   export const WS_REFRESH_VARIABLES_TIMEOUT_MS = 300_000;
   ```
2. Sostituire tutti i magic in `websocket-server.ts` e `websocket-connector.ts` con import.
3. In `ui.html`: stesso problema di fix 1. Commento `// MUST match WS_STALL_DETECTION_MS in src/figma/websocket-server.ts` + opzionale verifica build-time.

### Test

- Aggiornare `tests/unit/figma/websocket-server.test.ts` per importare le costanti invece di hardcodare
- Nuovo test in `tests/unit/figma/timeouts.test.ts`: verifica valori numerici e ordine relativo (COMMAND < STALL < REFRESH)

### Validazione

```bash
npx vitest run tests/unit/figma/
```

### Rischio

Sostituzione meccanica — grep-and-replace. Attenzione solo a mantenere inline il numero dove il contesto è diverso (es. un 30000 usato come `setInterval` per battimento UI è diverso da timeout WS).

---

## FIX 3 — Portare `captureTurnGuard` pattern al renderer 🟠 ALTO

### Problema

Fire-and-forget async in renderer aggiornano stato shared senza generation/sequence guard:
- `src/renderer/app.js:1438-1442` (`onTabCreated` handler)
- `src/renderer/app.js:1483-1501` (`onTabUpdated` handler)
- `src/renderer/app.js:283-291` (`syncEffortToTab`)

Modello corretto già presente in `src/main/session-events.ts:557-571`: `captureTurnGuard(slot, promptId)` restituisce una funzione `isStillValid()` da invocare prima della write, previene write su stato superato.

Nota: in `rewind-modal.js` ho già applicato `bindGeneration` counter in questa sessione. Serve lo stesso pattern estraibile.

### Fix

1. Creare `src/renderer/generation-guard.js`:
   ```js
   /** Monotonic counter + guard pair. Call advance() before starting async work,
    * call isCurrent() before writing — returns false if a newer generation
    * started in the meantime. */
   export function createGenerationGuard() {
     let current = 0;
     return {
       advance() { return ++current; },
       isCurrent(gen) { return gen === current; },
     };
   }
   ```
   (Vanilla JS — no `export` keyword se il file è caricato come non-module script; adattare alla convenzione del renderer. Altri file in `src/renderer/` usano IIFE + `window.xxx` globals. Seguire quel pattern.)
2. Applicare in `app.js` a:
   - `onTabCreated` → guard per qualunque async chiamata successiva
   - `onTabUpdated` → idem
   - `syncEffortToTab` (già ha await, ma manca guard)
3. Refactor `rewind-modal.js` per usare lo stesso helper (attualmente ha `bindGeneration` inline — uniformare).

### Test

- Nuovo `tests/unit/renderer/generation-guard.test.ts` (happy-dom env): verifica `advance()` incrementa, `isCurrent(gen)` diventa false dopo un nuovo advance.
- Estendere `tests/unit/renderer/rewind-modal.test.ts` con almeno 1 test che simula 2 tab switch rapidi e verifica che il primo non sovrascriva il secondo (pattern già testato parzialmente al test `bindActiveFileKey race`).

### Validazione

```bash
npx vitest run tests/unit/renderer/
npm run test:uat -- tests/uat/rewind-modal.spec.mjs --workers=1
```

### Rischio

Medio — refactor renderer tocca hot path (tab switching). Test UAT cross-tab obbligatori.

---

## FIX 5 — Standardizzare `mockReset` in `beforeEach` con fs mocks 🟠 MEDIO

### Problema

`vi.clearAllMocks()` **preserva `mockImplementation`** custom set da test precedenti → cross-test leak. Già fixato in `tests/unit/main/ipc-handlers.test.ts:191-195` aggiungendo `.mockReset().mockReturnValue(...)` esplicito per fs mocks. Altri 2 file hanno lo stesso rischio latente:

- `tests/unit/main/session-persistence.test.ts:119` — usa `clearAllMocks` senza reset fs
- `tests/unit/main/slot-manager.test.ts:136` — usa `clearAllMocks`, re-apply per agent module ma non fs/electron
- `tests/unit/main/ipc-handlers-auth.test.ts:113` — helpers function-scoped, rischio basso ma presente

### Fix

In ogni `beforeEach` affetto, dopo `vi.clearAllMocks()`, aggiungere reset espliciti per qualsiasi mock che un test potrebbe aver modificato con `.mockImplementation()`. Pattern canonico da copiare da `ipc-handlers.test.ts:191-195`:

```ts
(readFileSync as any).mockReset().mockReturnValue('{}');
(existsSync as any).mockReset().mockReturnValue(false);
(statSync as any).mockReset().mockReturnValue({ size: 0, mtimeMs: 0 });
(cpSync as any).mockReset();
(writeFileSync as any).mockReset();
```

Ispezionare ogni file:
1. Elencare quali mock moduli usano (`vi.mock('node:fs', ...)`)
2. Per ognuno, fare `mockReset().mockReturnValue(default)` in beforeEach
3. Rimuovere re-apply inline ridondanti se il nuovo reset lo copre

### Test

Non servono test nuovi — i test esistenti devono restare verdi. La validazione è running the full suite con `--run --repeat-each=2` per esporre leak:

```bash
npx vitest run tests/unit/main/ --repeat-each=2
```

### Validazione

```bash
npx vitest run tests/unit/main/
npx vitest run tests/unit/main/ --repeat-each=2  # esponi leak
```

### Rischio

Basso — modifiche localizzate ai `beforeEach`. Se qualche test si rompe, è perché dipendeva inconsciamente da un leak — va fixato esplicitamente.

---

## Output atteso

4 commit, 4 fix applicate, **0 regressioni**. Suite finale identica in count ma con test aggiunti per le fix (+4/+6 test nuovi).

Se scopri altri bug durante l'implementazione (tipo durante fix 2 trovi `15_000` duplicato in 4 file): **annotali** in `docs/prompts/pattern-followups.md` ma **non fixare** in questa sessione — un follow-up separato.

## Riferimenti

- Branch corrente: `main` con uncommitted changes (17 bug fix Rewind già applicati)
- File chiave da leggere prima di iniziare:
  - `src/main/session-events.ts` (modello captureTurnGuard)
  - `src/renderer/rewind-modal.js` (modello bindGeneration)
  - `tests/unit/main/ipc-handlers.test.ts` lines 183-205 (modello mockReset)
- `git log --oneline -5` mostra ultimi commit per context.

## Comandi di apertura

```bash
cd /Users/afato/Projects/bottega
git status
git log --oneline -5
npx vitest run 2>&1 | tail -5  # baseline
```

Se la baseline non è 2863/2863, **fermati** — significa che la sessione precedente non aveva committato tutto. Chiedi chiarimenti.
