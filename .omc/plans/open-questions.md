# Open Questions

## RALPLAN-DR Analisi - 2026-03-18

- [ ] **Widget API in plugin standard**: `figma.widget.h` e `figma.createNodeFromJSXAsync` sono accessibili in un plugin di tipo "figma" (non "widget")? Lo spike della Fase 0 deve rispondere a questa domanda prima di procedere con la Fase 2b. — Determina se CREATE_FROM_JSX usa Widget API (Opzione A) o API native (Opzione B).

- [ ] **Pi SDK subscribe() event shape**: La forma esatta degli eventi emessi da `session.subscribe()` (text_delta, tool_execution_start, etc.) va verificata con un test reale. Il piano assume una struttura specifica in ipc-handlers.ts che potrebbe non corrispondere all'API effettiva. — Se sbagliata, lo streaming nella chat non funziona.

- [ ] **@iconify/core vs @iconify/utils**: Il piano lista solo `@iconify/utils` nelle dipendenze, ma figma-use importa anche da `@iconify/core` (`loadIcon`). Verificare se `@iconify/utils` da solo basta o se serve anche `@iconify/core`. — Import mancante causa build failure.

- [ ] **Electron 41 + Node 24 stabilita**: Electron 41 e la versione target nel piano. Verificare se e gia in stable release o se serve Electron 33 LTS (Node 20). — Impatta il `target` in tsconfig e esbuild.

- [ ] **esbuild bundling di ws**: Il piano nota che `ws` potrebbe avere problemi con esbuild bundling. Va testato durante Fase 1 (scaffold) se il bundle con ws incluso funziona o se serve `external: ['ws']`. — Build failure se non gestito.

- [ ] **Font fallback nel plugin**: Quando l'LLM specifica un font non installato nel sistema (es. "Roboto" su macOS senza Google Fonts), `figma.loadFontAsync()` fallisce. Serve un meccanismo di fallback. — Tool crash silenzioso su set_text e render_jsx.

- [ ] **Dimensione .dmg finale**: Con esbuild + electron + pino + ws + @iconify/utils, la dimensione del pacchetto va verificata dopo Fase 8. Target ragionevole: < 150MB. — UX di download e installazione.

## RALPLAN-DR Iterazione 2 - 2026-03-18

- [ ] **Plugin base supporta createChildNode via executeCodeViaUI()**: Il MILESTONE E2E ora dipende dal plugin base (non fork). Verificare in Fase 3 che operazioni come `figma.createFrame()`, `figma.createText()` siano eseguibili tramite `executeCodeViaUI()`. Se no, serve un mini-fork. — Blocca il nuovo percorso critico se non funziona.

- [ ] **loader.reload() necessario pre-createAgentSession**: `DefaultResourceLoader` potrebbe richiedere una chiamata a `reload()` prima di poter creare la sessione agente. Va verificato in Fase 5. — Session creation potrebbe fallire silenziosamente.

- [ ] **Dipendenze npm nel fork plugin (svgpath, d3-hierarchy)**: Questi pacchetti sono usati in handler diversi da CREATE_FROM_JSX. Se il fork estrae solo CREATE_FROM_JSX + CREATE_ICON + BIND_VARIABLE, potrebbero non servire. Va verificato durante il porting in Fase 2b. — Bundle plugin inutilmente grosso se inclusi senza necessita.

- [ ] **AbortSignal propagation end-to-end**: Il helper `wrapFigmaTool()` gestira il signal, ma va verificato che Pi SDK passi effettivamente un `AbortSignal` valido quando l'utente chiama abort. Se il signal e sempre `undefined`, la gestione e dead code. — Abort utente potrebbe non funzionare.
