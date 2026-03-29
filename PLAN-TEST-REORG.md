# Piano: Riorganizzazione Test Suite

> Stato: DONE
> Data: 2026-03-27
> Completato: 2026-03-27

## Obiettivo

Riorganizzare la test suite di Bottega per eliminare duplicazioni, separare chiaramente
le categorie di test, isolare gli artifact generati e allinearsi alle best practice
per progetti Electron con Playwright + Vitest.

---

## Stato attuale

### Struttura (problemi evidenziati)

```
tests/
├── *.test.ts                    ← Unit test (vitest), ~25 file flat nella root
├── compression/*.test.ts        ← Unit test raggruppati (unica eccezione)
├── tools/*.test.ts              ← Unit test raggruppati (unica eccezione)
├── helpers/                     ← Mock condivisi
│
├── e2e/                         ← Playwright spec formali (4 file)
│   ├── build-smoke.spec.mjs
│   ├── electron-app.spec.mjs    ← ~370 righe, test monolitico
│   ├── uat-multi-tab.spec.mjs   ← Richiede Figma Desktop live
│   └── single-instance.spec.mjs
│
├── electron-smoke.mjs           ← DUPLICATO di electron-app.spec.mjs
├── electron-compression-smoke.mjs ← DUPLICATO (compression in electron-app.spec.mjs)
├── pin-button-test.mjs          ← Test reale, ma fuori dalla suite
├── electron-connection-test.mjs ← Test manuale, richiede Figma
│
├── check-running-app.mjs        ← Utility di debug, non test
├── check-status.mjs             ← Utility di debug, non test
├── debug-connection.mjs         ← Utility di debug, non test
│
└── screenshot-*.png (11 file)   ← Artifact mescolati al codice
```

### Problemi principali

1. **Duplicazione**: 3 script standalone ripetono copertura già in `electron-app.spec.mjs`
2. **Test reali fuori suite**: `pin-button-test.mjs` testa funzionalità ma non gira con `npm run test:e2e`
3. **Nessuna separazione CI / manuale**: `uat-multi-tab.spec.mjs` (richiede Figma) è nella stessa cartella dei test CI-runnable
4. **Unit test flat**: 25+ file `.test.ts` nella root di `tests/`, non rispecchiano `src/`
5. **Debug utility mescolate con test**: 3 script di debug nella stessa directory
6. **Screenshot nel codice**: 11 PNG direttamente in `tests/`, gitignore copre solo `tests/*.png` ma non sottocartelle
7. **Monolite E2E**: `electron-app.spec.mjs` (~370 righe) copre 7+ aree funzionali in un unico file
8. **Boilerplate ripetuto**: ogni file replica `electron.launch()` con stessa configurazione

---

## Struttura target

```
tests/
├── unit/                              ← Vitest — mirror di src/
│   ├── main/
│   │   ├── operation-queue.test.ts
│   │   ├── jsx-parser.test.ts
│   │   ├── prompt-queue.test.ts
│   │   ├── prompt-suggester.test.ts
│   │   ├── ipc-handlers.test.ts
│   │   ├── safe-send.test.ts
│   │   ├── icon-loader.test.ts
│   │   ├── session-store.test.ts
│   │   ├── slot-manager.test.ts
│   │   ├── messages.test.ts
│   │   ├── renderable-messages.test.ts
│   │   ├── compression/
│   │   │   ├── extension-factory.test.ts
│   │   │   ├── mutation-compressor.test.ts
│   │   │   ├── design-system-cache.test.ts
│   │   │   ├── color-utils.test.ts
│   │   │   └── ...
│   │   └── image-gen/
│   │       └── ...
│   ├── figma/
│   │   ├── websocket-server.test.ts
│   │   └── websocket-connector.test.ts
│   └── tools/
│       ├── core.test.ts
│       ├── manipulation.test.ts
│       └── ...
│
├── e2e/                               ← Playwright — CI-runnable, no Figma
│   ├── app-startup.spec.mjs           ← Launch, title, status dot
│   ├── settings.spec.mjs              ← Settings panel, model selector, API keys
│   ├── compression.spec.mjs           ← Compression toggle, profile switch, IPC
│   ├── ipc-roundtrip.spec.mjs         ← Preload bridge, window.api
│   ├── pin-toggle.spec.mjs            ← Always-on-top toggle (da pin-button-test.mjs)
│   ├── single-instance.spec.mjs       ← Single instance lock
│   └── build-smoke.spec.mjs           ← Build output verification
│
├── uat/                               ← Playwright — richiede Figma Desktop
│   ├── multi-tab.spec.mjs             ← Multi-tab, prompt queue, sessions
│   └── connection.spec.mjs            ← Connection lifecycle
│
├── helpers/                           ← Shared: mock, fixture, launch config
│   ├── launch.mjs                     ← Shared electron.launch() (DRY)
│   ├── mock-window.ts
│   └── ...
│
├── scripts/                           ← Utility di debug (NON test)
│   ├── check-running-app.mjs
│   ├── check-status.mjs
│   └── debug-connection.mjs
│
└── .artifacts/                        ← Screenshot e trace (gitignored)
    └── (generati a runtime)
```

---

## Fasi di esecuzione

### Fase 1 — Artifact e gitignore

**Obiettivo**: Isolare gli screenshot dal codice, pulire i file generati.

- [x]Creare directory `tests/.artifacts/` con un `.gitkeep`
- [x]Aggiornare `.gitignore`:
  ```
  # Test artifacts
  tests/.artifacts/
  test-results/
  ```
- [x]Rimuovere la regola `tests/*.png` (non più necessaria)
- [x]Cancellare tutti i `tests/screenshot-*.png` esistenti (11 file)
- [x]Aggiornare `playwright.config.mjs` per dirigere screenshot/trace verso `tests/.artifacts/`:
  ```js
  outputDir: 'tests/.artifacts/results',
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  ```

### Fase 2 — Separare script di debug da test

**Obiettivo**: Le utility di debug non devono stare con i test.

- [x]Creare `tests/scripts/`
- [x]Spostare: `check-running-app.mjs`, `check-status.mjs`, `debug-connection.mjs`
- [x]Aggiungere commento header in ogni script: `// Debug utility — not a test. Run manually.`

### Fase 3 — Eliminare i duplicati

**Obiettivo**: Rimuovere i test standalone che duplicano la suite formale.

- [x]Verificare che `electron-app.spec.mjs` copra tutto ciò che c'è in `electron-smoke.mjs` → cancella
- [x]Verificare che `electron-app.spec.mjs` copra tutto ciò che c'è in `electron-compression-smoke.mjs` → cancella
- [x]Promuovere `pin-button-test.mjs` a `e2e/pin-toggle.spec.mjs` (riscrivere come `test()` Playwright) → cancella l'originale
- [x]Decidere per `electron-connection-test.mjs`: promuovere a `uat/connection.spec.mjs` oppure spostare in `scripts/`

### Fase 4 — Riorganizzare unit test

**Obiettivo**: I unit test rispecchiano la struttura di `src/`.

- [x]Creare `tests/unit/main/`, `tests/unit/figma/`, `tests/unit/tools/`
- [x]Spostare ogni `tests/*.test.ts` nella sottocartella corrispondente a `src/`
- [x]Spostare `tests/compression/*.test.ts` → `tests/unit/main/compression/`
- [x]Spostare `tests/tools/*.test.ts` → `tests/unit/tools/`
- [x]Aggiornare `vitest.config.ts`:
  ```ts
  include: ['tests/unit/**/*.test.ts']
  ```
- [x]Verificare che import relativi e path nei mock restino corretti
- [x]Eseguire `npm test` per confermare zero regressioni

### Fase 5 — Split del monolite E2E e separazione UAT

**Obiettivo**: `electron-app.spec.mjs` diventa N spec più piccoli. I test che richiedono Figma vanno in `uat/`.

- [x]Estrarre shared launch helper in `tests/helpers/launch.mjs`:
  ```js
  import { _electron as electron } from '@playwright/test';

  export async function launchApp(opts = {}) {
    const app = await electron.launch({
      args: ['dist/main.js'],
      timeout: opts.timeout ?? 30_000,
      env: { ...process.env, BOTTEGA_TEST_MODE: '1', ...opts.env },
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(opts.readyDelay ?? 2_000);
    return { app, window };
  }
  ```
- [x]Dividere `electron-app.spec.mjs` in:
  - `app-startup.spec.mjs` — Launch, title, status dot, basic DOM
  - `settings.spec.mjs` — Settings panel, model selector, API key fields
  - `compression.spec.mjs` — Compression controls, profile switching, IPC
  - `ipc-roundtrip.spec.mjs` — Preload bridge, window.api methods
- [x]Spostare `uat-multi-tab.spec.mjs` → `tests/uat/multi-tab.spec.mjs`
- [x]Aggiornare `playwright.config.mjs` con due project:
  ```js
  export default defineConfig({
    outputDir: 'tests/.artifacts/results',
    workers: 1,
    timeout: 120_000,
    reporter: [['list']],
    use: {
      screenshot: 'only-on-failure',
      trace: 'on-first-retry',
    },
    projects: [
      {
        name: 'e2e',
        testDir: 'tests/e2e',
        testMatch: '**/*.spec.mjs',
      },
      {
        name: 'uat',
        testDir: 'tests/uat',
        testMatch: '**/*.spec.mjs',
      },
    ],
  });
  ```
- [x]Aggiornare `package.json`:
  ```json
  "test:e2e": "npm run build && npx playwright test --project=e2e",
  "test:uat": "npm run build && npx playwright test --project=uat"
  ```

### Fase 6 — Verifica finale

- [x]`npm test` — unit test passano
- [x]`npm run test:e2e` — E2E passano senza Figma
- [x]`npm run test:uat` — UAT funziona con Figma Desktop aperto (test manuale)
- [x]`npm run check` — typecheck + lint + test gate verde
- [x]Nessun `.png` in `git status` dopo un run completo
- [x]CI pipeline (se presente) usa solo `test:e2e`, mai `test:uat`

---

## File da eliminare (riepilogo)

| File | Motivo |
|---|---|
| `tests/electron-smoke.mjs` | Duplicato di `electron-app.spec.mjs` |
| `tests/electron-compression-smoke.mjs` | Duplicato di `electron-app.spec.mjs` |
| `tests/pin-button-test.mjs` | Promosso a `e2e/pin-toggle.spec.mjs` |
| `tests/screenshot-*.png` (11 file) | Artifact generati, non codice |

## File da spostare (riepilogo)

| Da | A |
|---|---|
| `tests/check-running-app.mjs` | `tests/scripts/check-running-app.mjs` |
| `tests/check-status.mjs` | `tests/scripts/check-status.mjs` |
| `tests/debug-connection.mjs` | `tests/scripts/debug-connection.mjs` |
| `tests/electron-connection-test.mjs` | `tests/uat/connection.spec.mjs` o `tests/scripts/` |
| `tests/e2e/uat-multi-tab.spec.mjs` | `tests/uat/multi-tab.spec.mjs` |
| `tests/*.test.ts` (~25 file) | `tests/unit/{main,figma,tools}/` |
| `tests/compression/*.test.ts` | `tests/unit/main/compression/` |
| `tests/tools/*.test.ts` | `tests/unit/tools/` |

---

## Note

- Ogni fase e' indipendente e committabile separatamente.
- Fase 1-3 sono quick win con rischio zero. Fase 4-5 richiedono piu' attenzione per gli import.
- Il progetto usa documentazione in italiano, coerente con `PLAN-DESIGN-WORKFLOW.md`.
