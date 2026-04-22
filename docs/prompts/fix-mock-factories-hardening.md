# Mock factory hardening — error path coverage per Bottega

## Contesto

Progetto: **Bottega** — macOS Electron app per design pair-programming con Figma Desktop.
Working directory: `/Users/afato/Projects/bottega`.
Stack familiare (TS ESM + esbuild + vitest) — CLAUDE.md copre già l'architettura.

Una sessione precedente ha analizzato 17 bug nel feature Rewind e identificato **3 pattern emergenti**. Uno di questi — **mock factory default troppo permissivi che nascondono error path** — non è stato fixato per lo scope invasivo. Questa sessione lo affronta in modo **non-breaking** ma con copertura reale dei failure path.

Suite attuale baseline: **2863/2863 unit verdi** + **10/10 UAT verdi**. Obiettivo invariato: restare verdi, aggiungere solo test nuovi.

## Il pattern

`tests/helpers/mock-connector.ts` espone 4 factory:
- `createMockConnector()` — 47 metodi `IFigmaConnector` tutti con `mockResolvedValue({ success: true })`
- `createMockWsServer()` — `isClientConnected/isFileConnected/isStarted` hardcoded `true`, `sendCommand` auto-success
- `createMockFigmaAPI()` — tutti i metodi REST ritornano `{}` o componenti vuoti
- `createMockConfigManager()` — struttura config hardcoded valida

Utilizzati da **20+ file** in `tests/unit/main/tools/`, `tests/unit/main/agent-playbook-*`, `tests/unit/main/scoped-tools.test.ts`, etc.

**Conseguenza**: è impossibile testare i failure path senza override esplicito per ogni singolo test. In pratica, nessuno scrive l'override → gli error branch nel codice di produzione sono **non-testati**:
- Connector disconnect mid-operation
- WS timeout / connection loss
- Figma REST API 401/429/500/malformed
- Plugin protocol version mismatch
- Config profile invalid / compactDesignSystem flag missing

**Rischio reale**: bug di error handling (retry logic, fallback, user-facing error messages) possono passare QA e rompersi in produzione.

## Strategia: additive, non-breaking

Non cambiamo i default delle factory esistenti (troppo invasivo, rompe 20+ file). Invece:

1. **Aggiungere factory "failing"** che producono mock il cui comportamento error è esplicito
2. **Auditare quali error path sono non-testati** nel codice di produzione
3. **Scrivere test mirati** usando le nuove factory, raggiungendo i branch non coperti

## Modalità operativa

- **5 commit separati**: 1 per factory, 1 per auditing doc, 3 per test suite per area (connector errors, ws errors, REST errors)
- Dopo ogni commit `npx vitest run` deve restare verde
- Niente modifiche alle factory esistenti — solo aggiunte
- Niente modifiche al codice di produzione — solo test. Se trovi bug reali (error path che throw NPE), **annotali** in `docs/prompts/mock-audit-findings.md` ma **non fixare** in questa sessione

## COMMIT 1 — Aggiungere factory "failing" 🟢

### File: `tests/helpers/mock-connector.ts`

Aggiungere in coda alle factory esistenti (non toccare quelle già presenti):

```ts
/**
 * IFigmaConnector mock that rejects every async call with a descriptive error.
 * Use for testing error-path branches — connector methods that surface transport
 * failures, timeouts, or WS disconnect.
 */
export function createFailingConnector(defaultError = new Error('mock: connector failure')) {
  const mock = createMockConnector();
  for (const key of Object.keys(mock)) {
    if (typeof mock[key] !== 'function') continue;
    // Preserve sync methods (getTransportType, clearFrameCache)
    if (key === 'getTransportType' || key === 'clearFrameCache') continue;
    mock[key] = vi.fn().mockRejectedValue(defaultError);
  }
  return mock;
}

/**
 * IFigmaConnector mock that simulates WS timeout — sendCommand-like methods
 * return a never-resolving promise up to a cap, then reject with a timeout-ish
 * error. Mirrors real `ws: command timed out` behavior.
 */
export function createTimingOutConnector(timeoutMs = 50) {
  const mock = createMockConnector();
  for (const key of Object.keys(mock)) {
    if (typeof mock[key] !== 'function') continue;
    if (key === 'getTransportType' || key === 'clearFrameCache') continue;
    mock[key] = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error(`mock: ${key} timed out`)), timeoutMs)),
    );
  }
  return mock;
}

/**
 * WebSocket server mock with every connection predicate returning false and
 * sendCommand rejecting. Simulates "plugin not loaded" or "Figma closed" state.
 */
export function createDisconnectedWsServer() {
  return {
    sendCommand: vi.fn().mockRejectedValue(new Error('mock: no client connected')),
    isClientConnected: vi.fn().mockReturnValue(false),
    isFileConnected: vi.fn().mockReturnValue(false),
    isStarted: vi.fn().mockReturnValue(true),
    getConnectedFileInfo: vi.fn().mockReturnValue(null),
    getConnectedFiles: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * FigmaAPI mock that surfaces transport-level failures (401, 429, 500, network).
 * Methods rejected with Error whose .status mimics fetch response status.
 */
export function createFailingFigmaAPI(status = 500, body = 'mock: API failure') {
  const err = Object.assign(new Error(body), { status });
  return {
    getFileData: vi.fn().mockRejectedValue(err),
    getLibraryComponents: vi.fn().mockRejectedValue(err),
    getComponentDetails: vi.fn().mockRejectedValue(err),
    getNodeImages: vi.fn().mockRejectedValue(err),
    // ... (mirror tutti i metodi di createMockFigmaAPI con reject)
  };
}
```

Type-safe: se la tua preferenza è strict typing invece di loop dinamico, scrivi ogni metodo a mano. Il loop è più breve ma perde le signature — accettabile per mock.

### Test

Aggiungere `tests/helpers/mock-connector.test.ts` (piccolo smoke):
- `createFailingConnector()` → chiamata su metodo arbitrario rejects
- `createTimingOutConnector(10)` → timeout entro ~50ms
- `createDisconnectedWsServer().sendCommand(...)` rejects, predicati ritornano false
- `createFailingFigmaAPI(429)` → err.status === 429

### Validazione

```bash
npx vitest run tests/helpers/
npx vitest run tests/unit/main/tools/  # verify existing tests still green
```

## COMMIT 2 — Audit error path coverage 🟠

### Goal

Mappare **quali branch di error handling nel codice di produzione sono non-coperti**. Non scrivere ancora test — solo inventariare.

### File: `docs/prompts/mock-audit-findings.md` (nuovo)

Per ogni area (connector, ws, REST, config), elencare:
- Error branch identificato (file:line)
- Scenario user-visibile (es. "plugin disconnesso mid-turn")
- Test mancante (descrizione test da scrivere)
- Priorità (alta/media/bassa)

### Metodo

Grep + review:
- `grep -rn "catch\|\.catch(\|throw new Error\|reject(" src/main/ src/figma/ | grep -v test` → lista dei catch
- Per ogni catch, verifica se esiste un test che attiva quel path (`grep "test:.*" tests/` per keyword)
- Concentrati su:
  - `src/main/agent.ts` — retry on transport error
  - `src/figma/websocket-server.ts` — reconnect, version mismatch, close codes
  - `src/figma/websocket-connector.ts` — sendCommand timeout, plugin error channel
  - `src/figma/figma-api.ts` — retry logic su status code
  - `src/main/rewind/manager.ts` — probe failure, restore error
  - `src/main/slot-manager.ts` — runtime dispose error, queue drain failure
  - `src/main/compression/` — config invalid, extension factory error

### Output

File markdown con tabella per area. Target: 20-40 righe di audit findings, ordinati per priorità.

### Validazione

Nessuna — è un doc. Ma il file deve essere checkato in git per la fase successiva.

## COMMIT 3 — Test connector error path 🟠

### Goal

Usare `createFailingConnector()` + `createTimingOutConnector()` per scrivere **5-10 test mirati** sui branch di error handling del connector identificati nell'audit.

### File candidati

- `tests/unit/main/agent-error-paths.test.ts` (nuovo)
- Estensioni a `tests/unit/main/tools/*-error.test.ts` per i tool che hanno retry/fallback
- `tests/unit/main/rewind/restore-error-paths.test.ts` (nuovo o estensione esistente)

### Esempi

1. **Restore con connector transport error** (`rewind/manager.ts`):
   - Costruisci checkpoint con 3 mutations
   - `getConnector` returns `createFailingConnector()`
   - `restoreCheckpoint('last-turn')` → `success: false`, `skipReasons: {'inverse-failed': 3}`

2. **Agent turn con WS timeout mid-execution**:
   - Playbook session con `createTimingOutConnector(50)`
   - Agent fires `figma_set_fills` → reject → `skipReasons` propagato

3. **Tool batch con partial failure** (`tools/manipulation.ts`):
   - `batchSetFills` chiamato con 5 node IDs, 3° throw
   - Verify response contiene `{succeeded: 2, failed: 3, errors: [...]}` (se il tool lo supporta)

### Validazione

```bash
npx vitest run tests/unit/main/
```

## COMMIT 4 — Test WS error path 🟠

Analogo a commit 3, ma con `createDisconnectedWsServer()`:

- `tests/unit/figma/websocket-connector-errors.test.ts` (nuovo o estensione)
- Scenari:
  - `sendCommand` quando `isClientConnected() === false` → reject con messaggio user-friendly
  - `captureScreenshot` con plugin disconnesso → non crash, errore propagato
  - `executeInPluginContext` con file key non connesso → reject immediato (non timeout)
  - Reconnect logic (se presente): mock che cambia da disconnected a connected → sendCommand successivo passa

## COMMIT 5 — Test REST error path 🟠

Con `createFailingFigmaAPI(status)`:

- `tests/unit/figma/figma-api-error-handling.test.ts` (estende `figma-api-retry.test.ts` esistente)
- Scenari:
  - 401 → retry? bail? Check logic
  - 429 → backoff (se presente) → eventually reject
  - 500 → retry N volte
  - Malformed JSON → throw parsable error

## Policy in-flight

- Se durante l'audit (commit 2) o la scrittura test (3-5) trovi **bug reali** nel codice di produzione (error path che NPE, retry infiniti, silent swallow):
  - **Annota** in `mock-audit-findings.md` con severità
  - **Non fixare** — apri un follow-up issue
  - Il test che hai scritto può esporre il bug con `.skip()` + commento TODO, oppure può essere scritto in modo che documenti il comportamento attuale (non quello ideale). Scegli il secondo per non far fallire la suite.

- Se un test che scrivi si rivela rompere un test esistente (mock leak), rimedia nel `beforeEach` del file — ma prima verifica che la soluzione sia localizzata (non broadcast a tutta la suite).

## Output atteso

- 5 commit
- `tests/helpers/mock-connector.ts` esteso con 4 factory (+~80 linee)
- `docs/prompts/mock-audit-findings.md` con 20-40 findings prioritizzati
- 3 nuovi file test (connector/ws/REST error paths) con 15-25 test totali
- Baseline invariata: 2863/2863 + ~20 nuovi test = ~2885/2885

## Comandi di apertura

```bash
cd /Users/afato/Projects/bottega
git status
git log --oneline -5
cat tests/helpers/mock-connector.ts | head -80  # ispeziona factory esistenti
npx vitest run 2>&1 | tail -5  # baseline
```

Se baseline non verde, **fermati** e chiedi.

## Riferimenti

- Report pattern analysis (sessione precedente): i 3 pattern emergenti sono descritti in chat history non accessibile. Quello rilevante per questa sessione è "Pattern 3A: Mock factory default troppo permissivi".
- File esistenti di riferimento:
  - `tests/helpers/mock-connector.ts` — factory esistenti
  - `tests/unit/figma/figma-api-retry.test.ts` — modello di test error-path retry
  - `tests/unit/main/rewind/restore.test.ts` — modello di test playbook con connector injection
- `CLAUDE.md` nel root ha l'architettura generale; `.claude/skills/bottega-dev-debug/SKILL.md` ha debug tips.

## Non-goal di questa sessione

- Cambiare i default delle factory esistenti (romperebbe 20+ file — fuori scope)
- Fixare i bug scoperti durante audit (separato follow-up)
- Refactor strutturale di `mock-connector.ts` (es. split in più file per area)
- Modifiche al codice di produzione di qualunque tipo
