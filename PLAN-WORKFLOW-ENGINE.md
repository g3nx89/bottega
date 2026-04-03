# Piano Operativo: Workflow Engine e Knowledge Layer per Bottega

> Stato: DRAFT v2.1
> Data: 2026-04-02
> Fonti: Analisi dettagliata mcp-server-guide (Figma ufficiale), Piano autonomo Codex, Analisi Gemini, PLAN-DESIGN-WORKFLOW.md v3.4, Analisi pi-tasks (cross-analisi Claude/Codex/Gemini)
> Metodo: 30 step di sequential thinking, lettura di 57 file del repo MCP, cross-analisi critica di 4 prospettive indipendenti + analisi code-level di `@tintinweb/pi-tasks` (8 file sorgente, 893 test lines)

---

## 1. Executive Summary

L'analisi approfondita del repository ufficiale `mcp-server-guide` di Figma rivela che non si tratta di un server MCP tradizionale con codice runtime, ma di un **sistema di conoscenza operativa** composto da 7 skill strutturate, 30+ gotchas documentati, 9 script helper, reference docs modulari e packaging cross-IDE.

Bottega e il Figma MCP hanno forze complementari:

| Bottega eccelle in | Figma MCP eccelle in |
|---|---|
| Esecuzione locale veloce (WebSocket) | Conoscenza design system profonda |
| 49 tool tipizzati con TypeBox | 40+ gotchas Plugin API con codice WRONG/CORRECT |
| OperationQueue per serializzazione | Code Connect (mapping design↔code) |
| Pipeline JSX custom | State ledger per workflow 100+ chiamate |
| Image generation (7 tool Gemini) | Anti-pattern specifici per fase |
| Subagenti read-only con judge | User checkpoint obbligatori |
| Compression contesto runtime | Phased workflow per design system builder |
| App desktop nativa macOS | Cross-IDE distribution |

**La strategia**: importare il layer di conoscenza operativa dal Figma MCP nel layer di esecuzione di Bottega, attraverso un sistema di **Workflow Packs interni** bundled nell'app.

L'integrazione con `PLAN-DESIGN-WORKFLOW.md` sposta però il problema un livello sopra: non basta scegliere un pack. L'engine deve capire **in che momento della relazione con il file** si trova l'utente, quale maturità ha il design system, e quale postura deve assumere l'agente: bootstrap, costruzione socratica, esecuzione, review.

Per questo la v2 del piano va letta come un'estensione da **workflow engine** a **workflow engine + design orchestration layer**. Ogni turno non risolve solo "quale pack attivare", ma anche:

- qual è il `DesignWorkflowContext` del file (`none` / `partial` / `active` / `evolving`)
- qual è la `interactionMode` corretta (`bootstrap` / `socratic` / `execution` / `review`)
- quali capability DS vanno composte nel pack attivo (`ds-read`, `ds-write`, `ds-lint`, `component-reuse`, `library-fork`, `ds-proactive`)

Questo consente di integrare davvero il lavoro di `PLAN-DESIGN-WORKFLOW.md`: la memoria del design system diventa un layer trasversale che informa routing, prompt injection, tool selection, user checkpoints, validation e resume.

---

## 2. Fonti e Contributi

### 2.1 Analisi Diretta del Repo MCP (57 file letti)

Contributo principale: **contenuto tecnico profondo** — tutti i gotchas, pattern, API gaps, workflow specifici.

- 40 gotchas Plugin API catalogati con codice WRONG/CORRECT
- Text override pattern a 3 step (setProperties vs node.characters)
- Code Connect template system (.figma.js) completo
- Codebase token extraction playbook (CSS, Tailwind, DTCG, CSS-in-JS, iOS, Android)
- `figma.createNodeFromJSXAsync()` — API nativa da investigare
- Component deep traversal helpers (collectDescendants)
- Variable scope best practices e token architecture patterns
- Error taxonomy (recuperabile vs corruzione strutturale)
- Validation workflow (strutturale vs visuale)
- `sharedPluginData` per cleanup sicuro
- 15 Plugin API capabilities mancanti in Bottega
- Conflict resolution framework (code wins vs Figma wins)

### 2.2 Piano Codex (PLAN-WORKFLOW-SKILLS.md)

Contributo principale: **architettura runtime** — come costruire il sistema in Bottega.

- Vincolo Pi SDK (`noSkills: true`) e soluzione via `extensionFactories`
- Distinzione "Workflow Packs" vs "Skills generiche"
- Benchmark-first approach (8-12 scenari canonici)
- `image-story` workflow (unico, non nel MCP guide)
- 5 rischi con mitigazioni concrete
- Fallback al comportamento generalista
- File touch list esplicita
- Scoperta incoerenze contrattuali (async IIFE, getPluginData)
- "Bundled inside the app" — no filesystem discovery in v1

### 2.3 Analisi Gemini

Contributo principale: **meta-pattern** — due idee di alto livello.

- **Persistent Figma File Profile**: elevare la discovery da step ad-hoc a artefatto persistente
- **Rules injection come direttiva assoluta**: le convenzioni scoperte diventano regole hard

Scartato: proposta "bottega-onboard" (scan git repo — fuori contesto per Bottega), anti-pattern generici (bash/file editing — Bottega opera su Figma), mancanza completa di contenuto tecnico Figma-specifico.

### 2.4 PLAN-DESIGN-WORKFLOW.md v3.4 — Il Design System Layer

Contributo principale: **specifica dettagliata del layer Design System** — la feature più strategica di Bottega.

Documento maturo (v3.4) prodotto dopo multi-agent critique a 5 prospettive, 6 ricerche di settore, e iterazioni strategiche con l'utente. Copre:

- **Architettura "Figma Is The Truth"**: il DS vive interamente in Figma (variabili + pagina DS dedicata con sezioni `[DS::*]`)
- **I 4 Momenti** dell'esperienza utente: First Contact → Socratic Construction → Daily Work → Review
- **6 tool DS** con specifiche esatte: `figma_design_system` (read), `figma_setup_tokens` (write idempotente), `figma_update_ds_page` (NEW), `figma_lint` (verify con 8 funzioni pure), `figma_set_fills/set_strokes` con `bindTo`, `figma_bind_variable` (numeric-only)
- **DS nel system prompt**: notazione compressa (~400-700 token), legenda di decodifica, istruzioni comportamentali, best practices Figma
- **Integrazione compressione**: tool DS rimossi da MUTATION_TOOLS, cache estesa, `readDesignSystem()` condivisa
- **10 regole di disambiguazione** tra tool per prevenire confusione
- **Proattività bidirezionale**: l'agente suggerisce aggiunte al DS e aggiorna SEMPRE entrambi i livelli
- **35 decisioni registrate** con alternative valutate e razionale

**Relazione tra i due piani**: PLAN-DESIGN-WORKFLOW.md è la **specifica di prodotto** per il layer DS. PLAN-WORKFLOW-ENGINE.md è il **framework architetturale** che lo ospita. Il workflow pack `build-design-system` usa DESIGN-WORKFLOW come specifica implementativa; il workflow engine fornisce intent routing, state ledger, e validation policy. Nessuno dei due sostituisce l'altro.

### 2.5 Analisi pi-tasks (`@tintinweb/pi-tasks`)

Contributo principale: **implementazione di riferimento per task lifecycle, dependency graph e agent self-tracking** — il layer mancante tra la PromptQueue FIFO di Bottega e il workflow state-ledger pianificato in Fase 4.

Analisi condotta con cross-review di 3 prospettive indipendenti (Claude, Codex, Gemini) su 8 file sorgente (1074 righe index.ts + 305 righe task-store.ts + 893 righe di test). Fonti: `../forks/pi-tasks/src/`, `../forks/pi-tasks/test/`.

**Componenti riutilizzabili:**

| Componente | Righe | Riuso | Ruolo in Bottega |
|---|---|---|---|
| `TaskStore` | 305 | 90% — cambiare path `~/.pi/` → `~/.bottega/` | Storage ACID per task lifecycle. Substrato per il state-ledger (Fase 4). File locking via `O_EXCL`, atomic write via tmp+rename, dependency graph bidirezionale con cycle detection. |
| `types.ts` (Task, TaskStatus) | 25 | 100% | Tipi base. Il campo `metadata: Record<string, any>` assorbe campi workflow-specifici (workflowId, phase, targetNodeIds, judgeVerdict) senza cambiare l'interfaccia. |
| `AutoClearManager` | 91 | 85% — adattare concetto di "turno" | Pulizia automatica task completati dopo N turni. Due modi: per-task o batch. |
| Tool descriptions (promptGuidelines) | — | Adattamento testo | Prompt engineering battle-tested per prevenire over-tasking. Sezioni "When to Use / When NOT to Use / Tips". |
| System-reminder injection | 20 | Pattern riusabile | Inietta nudge nel `tool_result` quando task tool non usati per 4 turni. In Bottega: hook nella extensionFactory. |

**Componenti NON riutilizzabili:**

| Componente | Motivo |
|---|---|
| `ProcessTracker` (140 righe) | Gestisce child process shell. Bottega non ha background shell tasks. |
| `TaskWidget` (265 righe) | Rendering pi-tui per terminale. Bottega ha renderer Electron vanilla HTML/CSS/JS. |
| `SettingsMenu` (100 righe) | TUI settings. Bottega ha `settings.js` nel renderer. |
| RPC event bus protocol | Pi-tasks comunica con pi-subagents via `pi.events.emit("subagents:rpc:spawn")`. Bottega fa chiamate dirette a `runSubagentBatch()`. |
| `/tasks` command handler | Bottega non ha un command system tipo Pi. |

**Insight chiave dall'analisi cross-model:**

1. **Il TaskStore è il substrato del state-ledger, non un modulo separato** (Codex). Il `WorkflowStateLedger` della Fase 4 (runId, phase, entities, pendingValidations) è un'estensione del Task con campi aggiuntivi nel metadata bag. Non servono due store.
2. **I task tools danno all'agente una capacità che oggi non ha**: l'auto-decomposizione. Oggi tutta l'orchestrazione è hardcoded in TypeScript (judge-harness.ts, orchestrator.ts). L'agente non decide mai di analizzare, non vede risultati strutturati, non traccia il proprio progresso.
3. **Le action items del judge devono diventare task persistenti** (Codex). Oggi il retry è un prompt effimero (`[JUDGE_RETRY]` in judge-harness.ts:131). Con task persistenti: visibili all'utente, sopravvivono a crash/resume, tracciabili come pending→completed.
4. **NON caricare pi-tasks come Pi extension** (errore Gemini). Bottega usa `noExtensions: true`. I tool task vanno come `customTools`, i side effects come `extensionFactory`.

**Relazione con il piano**: pi-tasks fornisce l'implementazione concreta per due aspetti del workflow engine:
- **Fase 1.5 (nuova)**: Task tools per agent self-tracking + task panel UX — deliverable autonomo, valore immediato
- **Fase 4**: Il TaskStore evolve in state-ledger aggiungendo campi workflow-specifici nel metadata bag

---

## 3. Decisioni Architetturali

### 3.1 Runtime controllato — Bundled inside the app

In v1 **nessuna** discovery di skill dal filesystem. Le workflow packs sono compilate dentro l'app e selezionate internamente.

**Motivazione**: Bottega è un prodotto desktop. La variabilità tra installazioni deve essere zero. L'utente non dovrebbe mai dover configurare skill.

### 3.2 Workflow Packs, non skill generiche

Il nuovo layer NON è un clone delle `.claude/skills/`. È un sistema di **workflow packs interni**:

- Tipizzati (TypeScript interfaces)
- Selezionati per intento dal router
- Con reference modulari caricabili on-demand
- Con regole di validazione incorporate
- Con supporto a resume e checkpoint

### 3.3 Integrazione via extensionFactories

Il punto di integrazione è `extensionFactories` nel Pi SDK AgentSession, lo stesso meccanismo della compression extension. La workflow extension factory augmenta il contesto per-turno con guidance task-specifico.

**Motivazione**: Bottega crea sessioni con `noSkills: true`, `noExtensions: true`, `noPromptTemplates: true`. L'unico punto di injection è `extensionFactories`, che è già usato per la compression.

### 3.4 Read parallel, write sequential

I subagenti esistenti (scout, analyst, auditor) possono fare discovery e analisi in parallelo. Le mutazioni restano rigorosamente sequenziali via `OperationQueue`.

### 3.5 Fallback generalista

I workflow packs sono opzionali. Quando il router ha bassa confidenza, l'agente opera in modalità generalista con il system prompt base. I workflow non devono MAI degradare task semplici o creativi.

### 3.6 Figma Is The Truth — Design System in Figma

Il design system vive interamente dentro Figma su due livelli complementari (da PLAN-DESIGN-WORKFLOW.md):

| Livello | Contenuto | Dove in Figma |
|---|---|---|
| **Valori** (quantitativi) | Colori, font size, spacing, radii, shadows | Variabili Figma |
| **Regole** (qualitativi) | Best practice, convenzioni, istruzioni | Pagina "Design System" con sezioni `[DS::*]` |

Zero storage esterno, zero drift, portabilità gratis. L'utente vede e modifica direttamente in Figma.

**Motivazione**: la ricerca (DESIGN-WORKFLOW v3.4) conferma che il 69.8% dei team usa variabili Figma come source of truth. I team piccoli (target di Bottega) non costruiscono DS da zero ma personalizzano 5 cose: colori, scala tipografica, spacing, border radius, shadows.

### 3.7 Design Workflow Context come meta-layer

Il workflow engine non deve ragionare solo in termini di "task". Deve costruire, per ogni file e per ogni turno, un **Design Workflow Context** che combina:

- `dsStatus`: `unknown` | `none` | `partial` | `active` — stato meccanico dalla cache Figma (ha variabili? ha pagina DS?)
- `dsRecentlyModified`: `boolean` — il DS è stato modificato in questa sessione (sostituisce il precedente `dsMaturity: 'evolving'`)
- `interactionMode`: `bootstrap` | `socratic` | `execution` | `review`
- `governancePolicy`: `strict` | `adaptive` | `freeform`
- `libraryContext`: `none` | `linked` | `dominant`

> **Nota**: `dsStatus` è lo stato RAW letto dalla cache. NON serve un enum `dsMaturity` separato — l'unico caso aggiuntivo (`evolving`) è catturato dal booleano `dsRecentlyModified`. Evita overlap semantici.

Questo contesto viene derivato da tre fonti:

1. stato del DS letto da Figma (`figma_design_system`, `dsStatus`)
2. convenzioni persistite nel `FigmaFileProfile`
3. intento del turno corrente

Il router non sceglie più solo un workflow pack. Sceglie un **pack dentro un contesto di collaborazione**.

### 3.8 Capability bundles, non pack monolitici

`PLAN-DESIGN-WORKFLOW.md` introduce competenze trasversali che non appartengono a un solo pack. Per evitare duplicazione, il motore deve distinguere tra:

- **Workflow packs**: orchestrazioni end-to-end (`build-screen`, `update-screen`, `build-design-system`)
- **Workflow capabilities**: blocchi riusabili, composabili e indipendentemente testabili

| Pack | Capability bundles |
|---|---|
| `build-screen` | `ds-read`, `component-reuse`, `ds-proactive`, `visual-validation` |
| `update-screen` | `ds-read`, `targeted-diff`, `ds-lint`, `visual-validation` |
| `build-design-system` | `ds-bootstrap`, `ds-write`, `library-fork`, `ds-lint`, `documentation` |
| `lint-and-review` | `ds-read`, `ds-lint`, `ds-proactive`, `visual-validation` |

#### Capability Content Model

Ogni capability contiene 4 componenti composabili:

```typescript
interface WorkflowCapability {
  id: WorkflowCapabilityId;
  name: string;
  description: string;

  // A. PROMPT — testo iniettato nel contesto (~200 token max per capability)
  promptFragment: string;

  // B. TOOL GUIDANCE — quali tool usare, evitare, con quali vincoli
  toolGuidance: {
    preferred: string[];                    // tool da preferire
    forbidden: string[];                    // tool da NON usare MAI
    constraints: Record<string, string>;    // vincoli tool-specifici
  };

  // C. VALIDATION — cosa verificare dopo le operazioni
  validationRules: {
    afterMutation: ValidationCheck[];
    afterMilestone: ValidationCheck[];
  };

  // D. REFERENCES — quali reference docs caricare on-demand
  referenceDocIds: string[];
}
```

**Composizione**: quando un pack attiva più capabilities, l'engine:
1. **Concatena** i `promptFragment` (in ordine di capability)
2. **Unisce** i tool guidance (`forbidden` vince in caso di conflitto con `preferred`)
3. **Unisce** le `validationRules` (deduplica per check identici)
4. **Unisce** i `referenceDocIds` (deduplica)

#### Capability Catalog

**`ds-read`** — Lettura contesto DS
```
prompt: "Read DS context before creating. Use figma_design_system. If dsStatus='none', suggest bootstrap."
preferred: [figma_design_system, figma_search_components]
references: [design-system-discovery]
```

**`ds-write`** — Scrittura DS (richiede conferma utente)
```
prompt: "Modify DS: ALWAYS update BOTH levels (figma_setup_tokens + figma_update_ds_page), then forceRefresh. NEVER use figma_execute for DS."
preferred: [figma_setup_tokens, figma_update_ds_page]  |  forbidden: [figma_execute]
references: [token-architecture, variable-binding]
```

**`ds-lint`** — Verifica aderenza DS
```
prompt: "Use figma_lint for quality. Returns 3 sections: dsCheck, bestPractices, figmaLint. In review mode: lint FIRST, screenshot SECOND."
preferred: [figma_lint]
references: [visual-validation]
```

**`ds-proactive`** — Suggerimenti proattivi DS
```
prompt: "When introducing a value not in DS, ask user to add it. When pattern repeats 3+ times, suggest componentization. After confirmed DS addition: update BOTH levels + forceRefresh."
preferred: [figma_design_system]
```

**`component-reuse`** — Riuso componenti
```
prompt: "ALWAYS search existing components before creating. Prefer instantiating over raw frames. Use setProperties() for text overrides, not node.characters."
preferred: [figma_search_components, figma_instantiate, figma_get_library_components]
references: [component-reuse]
```

**`visual-validation`** — Validazione visiva
```
prompt: "After milestones: figma_screenshot. Check: clipped text, overlapping content, placeholder text. Max 3 fix loops. Use figma_get_file_data for structural checks (cheap)."
preferred: [figma_screenshot, figma_get_file_data]
references: [visual-validation]
```

**`ds-bootstrap`** — Setup iniziale DS
```
prompt: "Analyze file for existing conventions. Propose token taxonomy. Support fork from existing library. Create collection architecture (Simple/Standard/Advanced based on token count)."
preferred: [figma_design_system, figma_setup_tokens, figma_update_ds_page]  |  forbidden: [figma_execute]
references: [design-system-discovery, token-architecture, codebase-token-extraction]
```

**`library-fork`** — Fork da libreria esistente
```
prompt: "If library detected, propose local DS page based on library tokens. The local DS complements the library, doesn't replace it."
preferred: [figma_get_library_components, figma_search_components]
```

**`targeted-diff`** — Diff mirato per aggiornamenti
```
prompt: "Read existing structure. Identify minimal mutations. Never recreate entire screen — modify only what changed."
preferred: [figma_get_file_data, figma_get_selection]
```

**`documentation`** — Documentazione DS in Figma
```
prompt: "Create/update DS page sections [DS::*] with visual samples (color swatches, type specimens) and rule text. All text in English."
preferred: [figma_update_ds_page]  |  forbidden: [figma_set_text, figma_execute]
```

Questo permette delivery incrementale: implementare `ds-read` per primo, poi `ds-lint`, poi `ds-write` — ciascuno testabile e riusabile indipendentemente.

### 3.9 I 4 Momenti diventano Interaction Modes

I "4 Momenti" definiti nel piano design non devono restare solo un modello concettuale. Vanno tradotti in modalità operative del workflow engine:

| Momento prodotto | Interaction mode | Comportamento atteso |
|---|---|---|
| First Contact | `bootstrap` | leggere il file, classificare il DS, suggerire setup/fork senza bloccare |
| Socratic Construction | `socratic` | proporre, chiedere conferma, aggiornare DS in modo esplicito |
| Daily Work | `execution` | usare il DS come vincolo attivo, essere proattivo solo quando serve |
| Review | `review` | verificare aderenza, usare lint strutturato, richiedere screenshot mirati |

#### State Machine delle Transizioni

Le transizioni sono guidate da **azioni utente e stato file**, non dal ragionamento interno dell'agente.

```
                                                    user asks "check/audit/lint"
                                                    from ANY mode
                                                           │
┌───────────┐  user confirms    ┌───────────┐  all DS      │      ┌──────────┐
│ bootstrap ├─────────────────►│  socratic  ├─decisions──►│◄─────│  review  │
└─────┬─────┘   DS plan        └──────┬─────┘  confirmed   │      └────┬─────┘
      │                               ▲                    │           │
      │                               │ new value not      │           │ review complete
      │                               │ in DS, or user     ▼           │
      │                               │ asks to modify  ┌──────────┐  │
      │                               └─────────────────┤execution ├──┘
      │                                                 └──────────┘
      │  user opts out of DS
      ▼
┌──────────┐
│ freeform │ ── user asks "set up DS" ──► bootstrap
└──────────┘
```

**Regole di transizione**:

| Da | A | Trigger |
|---|---|---|
| *session start* | `bootstrap` | `dsStatus = none` |
| *session start* | `socratic` | `dsStatus = partial` |
| *session start* | `execution` | `dsStatus = active` |
| `bootstrap` | `socratic` | Utente approva il piano DS |
| `socratic` | `execution` | Ultima decisione DS pendente confermata |
| `execution` | `socratic` | Agente rileva valore non nel DS, O utente chiede modifica DS |
| *any* | `review` | Utente chiede di controllare/auditare/lintare |
| `review` | *previous* | Review completato ("fix these" o "looks good") |
| *any* | `freeform` | Utente opta esplicitamente fuori dal DS |
| `freeform` | `bootstrap` | Utente chiede di impostare il DS |

**Principio chiave**: l'agente NON decide autonomamente di cambiare modo. Risponde a trigger espliciti (azione utente o cambio stato file).

### 3.10 Governance Policy

| Policy | Quando | Comportamento |
|---|---|---|
| `strict` | DS attivo, file maturo, task strutturato | Enforca DS ovunque, lint dopo ogni sezione, `bindTo` obbligatorio |
| `adaptive` | DS attivo, task operativo normale (default) | Enforca DS quando disponibile, suggerisce ma non blocca |
| `freeform` | Utente sta sperimentando, o file senza DS e utente rifiuta bootstrap | Zero suggerimenti DS, zero lint automatico. I gotchas Plugin API restano attivi (sono safety, non governance) |

Trigger per `freeform`: utente dice esplicitamente "non mi interessa il DS" / "sto sperimentando", oppure rifiuta la proposta di bootstrap. Uscita: utente chiede di impostare il DS → `bootstrap`.

### 3.11 Invarianti di governance del Design System

L'integrazione con il piano DS introduce regole più forti del semplice routing. Queste invarianti devono vivere nel **runtime**, nei **prompt** e nei **test** — non basta documentarle:

1. **Nessuna mutazione DS senza conferma esplicita** dell'utente
2. **Ogni mutazione DS aggiorna SEMPRE entrambi i livelli**: variabili (`figma_setup_tokens`) + pagina DS (`figma_update_ds_page`)
3. **Dopo ogni mutazione DS**: `figma_design_system(forceRefresh: true)`
4. **Se `dsStatus` è `none` o `partial`**: l'agente suggerisce bootstrap o completamento, ma **non blocca** il lavoro operativo
5. **In `review` mode**: `figma_lint` è il primo strumento; gli screenshot sono conferma mirata, non discovery cieca
6. **In `freeform` mode**: zero enforcement DS, ma i gotchas Plugin API restano attivi (sono safety, non governance)

### 3.12 TaskStore come substrato del State Ledger

Il `TaskStore` di pi-tasks (`../forks/pi-tasks/src/task-store.ts`) diventa il layer di persistenza per ENTRAMBI:

- **Agent self-tracking** (Fase 1.5): l'agente crea/aggiorna task per tracciare il proprio lavoro. I tool `task_create`, `task_update`, `task_list` operano sul TaskStore.
- **Workflow state-ledger** (Fase 4): i workflow packs scrivono fase, checkpoint, validation results, entity IDs nel campo `metadata` dei task.

```
                    ┌──────────────────────────────────────────┐
                    │              TaskStore (ACID)             │
                    │  ┌─────────────────────────────────────┐ │
                    │  │ Task { id, subject, status,          │ │
                    │  │   blocks[], blockedBy[],             │ │
                    │  │   metadata: {                        │ │
                    │  │     // Fase 1.5 — agent self-track   │ │
                    │  │     activeForm?: string,             │ │
                    │  │     // Fase 4 — workflow state       │ │
                    │  │     workflowId?: string,             │ │
                    │  │     phase?: string,                  │ │
                    │  │     targetNodeIds?: string[],        │ │
                    │  │     judgeVerdict?: JudgeVerdict,     │ │
                    │  │     artifacts?: Record<string,string>│ │
                    │  │   }                                  │ │
                    │  │ }                                    │ │
                    │  └─────────────────────────────────────┘ │
                    └──────────────────────────────────────────┘
                              ▲                    ▲
                              │                    │
                    ┌─────────┴──────┐   ┌────────┴────────┐
                    │ Task Tools     │   │ Workflow Engine  │
                    │ (agent-facing) │   │ (internal)       │
                    │ Fase 1.5       │   │ Fase 4           │
                    └────────────────┘   └─────────────────┘
```

**Perché un solo store e non due:**
- Il dependency graph (`blocks`/`blockedBy`) serve a entrambi: l'agente esprime "task 3 dipende da task 1", il workflow engine esprime "fase validate dipende da fase build"
- Il file locking ACID è necessario per entrambi (crash recovery)
- L'auto-clear serve a entrambi (pulizia task completati)
- Il task panel nel renderer mostra TUTTO — sia i task dell'agente sia le fasi del workflow

**Perché NON un `WorkflowStateLedger` separato:**
Il tipo `WorkflowStateLedger` della Fase 4 originale (runId, entities, pendingValidations, userCheckpoints, errors) è più specifico di un Task generico. Ma i campi extra vivono nel `metadata` bag — non serve un secondo store. Il `WorkflowStateLedger` diventa una **view tipizzata** sopra i task di un workflow:

```typescript
function getWorkflowLedger(store: TaskStore, workflowId: string): WorkflowStateLedger {
  const tasks = store.list().filter(t => t.metadata?.workflowId === workflowId);
  // Ricostruisci la vista tipizzata dai task + metadata
}
```

**Migrazione**: quando il workflow engine viene implementato (Fase 4), NON si riscrive il TaskStore. Si aggiunge la view tipizzata sopra. Zero breaking changes.

### 3.13 Task Tools come agent capability, extensionFactory come side-effect engine

I task tools (`task_create`, `task_update`, `task_list`) sono `customTools` nel toolset dell'agente — lo stesso meccanismo dei 49 tool Figma esistenti. L'agente li chiama esplicitamente.

I side effect (system-reminder injection quando task non usati da N turni, auto-clear su fine turno, context injection dopo compression) vivono in una `taskExtensionFactory` — lo stesso meccanismo della compression extension (`agent.ts:190`).

```typescript
// agent.ts
extensionFactories: [
  infra.compressionExtensionFactory,
  infra.taskExtensionFactory,  // ← NUOVO
],
```

Questo separa:
- **Cosa l'agente fa attivamente** (tool) da **cosa il sistema fa in background** (extensionFactory)
- **Prompt cost fisso** (tool descriptions: ~600 token) da **prompt cost variabile** (reminder injection: 0 token quando non servono)

### 3.14 Judge remediation come task persistenti

Quando il judge restituisce FAIL con action items, ogni action item diventa un task persistente nel TaskStore:

```
Judge FAIL: ["Fix button fill #A259FF → --color-primary", "Standardize padding to 12px 24px"]
     ↓
Task #7 [pending] "Fix button fill #A259FF → --color-primary"  { judgeAttempt: 1 }
Task #8 [pending] "Standardize padding to 12px 24px"           { judgeAttempt: 1 }
```

Questo non sostituisce il retry loop meccanico in `judge-harness.ts` — il loop resta per il retry automatico. I task servono per:
- **Visibilità**: l'utente vede cosa il judge ha trovato
- **Persistenza**: se il retry fallisce o l'app crasha, le remediation restano
- **Tracking**: quando l'agente fixa un problema, marca il task completed

### 3.15 Adattamento ai contratti reali di Bottega

Ogni workflow pack parla il linguaggio dei tool reali:

- `figma_execute` con il contratto Bottega (outer-return + async IIFE, non top-level await)
- `OperationQueue` come barriera per mutazioni
- `ScopedConnector` e file scoping
- Tool surface esistente (49 tool + 3 task tool da Fase 1.5)

### 3.16 Differenze contrattuali note

| Aspetto | Figma MCP (`use_figma`) | Bottega (`figma_execute`) |
|---|---|---|
| Wrapping async | Top-level await, NO IIFE | Outer-return + async IIFE |
| `getPluginData` | Documentato come non supportato (ma usato negli helper) | Da verificare nel bridge |
| Atomicità | Documentato come atomico (failed = no changes) | Da verificare |
| Page context reset | Reset ad ogni chiamata | Da verificare con ScopedConnector |
| Return semantics | `return` diretto, auto-serializzato | Da verificare |

**Azione**: Prima di adottare qualsiasi pattern dal MCP guide, verificare il comportamento reale del bridge Bottega per ogni differenza.

---

## 4. Fasi di Implementazione

### Fase 0: Quick Wins (1-2 giorni, zero nuovo runtime code)

**Obiettivo**: Miglioramenti immediati applicabili modificando solo `system-prompt.ts` e i `promptSnippet` dei tool.

#### 0.1 — Gotchas critici nel system prompt

Aggiungere a `src/main/system-prompt.ts` una sezione "Plugin API Safety Rules" con i 15-20 gotchas più impattanti (vedi Appendice A per il catalogo completo). Priorità:

1. Colori 0-1 range, non 0-255
2. Fills/strokes sono array immutabili — clonare, modificare, riassegnare
3. `setBoundVariableForPaint` ritorna un NUOVO paint — catturare il return value
4. `layoutSizingHorizontal/Vertical = 'FILL'` DEVE essere settato DOPO `appendChild`
5. `resize()` resetta i sizing modes a FIXED — chiamare resize PRIMA di settare HUG/FILL
6. Font DEVE essere caricato prima di qualsiasi operazione sul testo
7. `addComponentProperty` ritorna una STRING key — non hardcodare
8. `lineHeight`/`letterSpacing` devono essere oggetti `{value, unit}`, non numeri
9. COLOR variable values usano `{r,g,b,a}` (con alpha), paint colors usano `{r,g,b}` (senza)
10. Variable scopes: MAI usare `ALL_SCOPES` — settare scopi specifici
11. Nodi nuovi a (0,0) — posizionare via scan dei bounds esistenti
12. `counterAxisAlignItems` NON supporta `'STRETCH'` — usare `'MIN'` + child `FILL`
13. HUG parents collassano FILL children — il parent deve essere FIXED o FILL
14. `detachInstance()` invalida gli ID dei nodi antenati
15. Nuovi nodi creati in pagina vanno posizionati lontano da (0,0) per evitare sovrapposizioni

**File da modificare**: `src/main/system-prompt.ts`

#### 0.2 — Validation workflow nel system prompt

Aggiungere guidance per la validazione strutturale vs visuale:

```
Validation Policy:
- After EVERY mutation: use figma_get_file_data for structural check (counts, names, hierarchy) — this is CHEAP
- After EACH MILESTONE (component complete, section built): use figma_screenshot for visual check — this is EXPENSIVE
- In screenshots, look specifically for: clipped/cropped text, overlapping content, placeholder text still showing
```

**File da modificare**: `src/main/system-prompt.ts`

#### 0.3 — "Inspect before create" nel system prompt

Aggiungere:

```
Before creating ANY new element in Figma:
1. Search for existing components (figma_search_components, figma_get_library_components)
2. Check existing variables and styles (figma_design_system)
3. Inspect naming conventions of existing elements
4. Only create new elements if nothing suitable exists
```

**File da modificare**: `src/main/system-prompt.ts`

#### 0.4 — Text override warning

Aggiungere al `promptSnippet` di `figma_set_text`:

```
WARNING: If the text node is inside a component instance and managed by a TEXT-type component property,
setting node.characters directly may be silently overridden. In that case, use figma_set_instance_properties
with the property key instead. To discover property keys, inspect the instance's componentProperties first.
```

**File da modificare**: `src/main/tools/manipulation.ts` (promptSnippet di `figma_set_text`)

#### 0.5 — Error taxonomy nel system prompt

Aggiungere:

```
Error Recovery:
- figma_execute is ATOMIC: if a script fails, NO changes are made. Retry after fix is safe.
- On error: STOP → Read error message → If unclear, inspect state with figma_get_file_data → Fix script → Retry
- Recoverable errors: layout issues, naming, missing font, wrong variable binding — fix and retry
- Structural corruption: component cycles, wrong combineAsVariants input — clean up and restart from scratch
```

**File da modificare**: `src/main/system-prompt.ts`

#### 0.6 — Investigare `figma.createNodeFromJSXAsync()`

Verificare nel bridge Bottega se l'API nativa `figma.createNodeFromJSXAsync(jsx)` è accessibile e come si comporta rispetto alla pipeline custom `jsx-parser.ts → TreeNode → CREATE_FROM_JSX`.

**Output**: Issue o nota tecnica con risultati della verifica. Se l'API nativa copre i casi d'uso di Bottega (incluso icon pre-fetching e tag mappings), valutare semplificazione della pipeline.

**File da investigare**: `figma-desktop-bridge/code.js`, `src/main/jsx-parser.ts`, `src/main/tools/jsx-render.ts`

#### 0.7 — Best Practices Figma nel system prompt

Aggiungere un blocco coeso (~200 token) che consolida le regole universali Figma oggi sparse nel prompt (da PLAN-DESIGN-WORKFLOW.md Sezione 5.2):

```
## Figma Best Practices (ALWAYS apply)

Structure:
- Use auto-layout for ALL frames with children — no exceptions
- Prefer FILL over FIXED sizing — elements should adapt
- Max 4 levels of nesting (Screen > Section > Component > Element)

Components:
- ALWAYS search for existing components before creating from scratch
- Prefer instantiating over building from raw frames
- Extract repeated structures (3+ occurrences) into components

Naming:
- Name EVERY layer — never leave "Frame 1", "Rectangle 2"
- Use PascalCase with slash separator: "Card/Body", "Nav/Header/Logo"

Construction:
- Build inside-out: leaf nodes first, then containers
- Set layoutMode BEFORE layout properties
- appendChild BEFORE setting FILL sizing
- Bind colors and values to variables when a DS is active
```

Queste regole sono verificabili meccanicamente da `figma_lint` (Fase 5).

**File da modificare**: `src/main/system-prompt.ts`

#### 0.8 — Tool disambiguation rules nel system prompt

Aggiungere le 10 regole di disambiguazione tra coppie di tool dal PLAN-DESIGN-WORKFLOW.md (Sezione 6.4). Le più critiche:

- `figma_design_system` vs `figma_get_file_data` — DS overview vs structural tree
- `figma_set_fills` con `bindTo` vs `figma_bind_variable` — colori vs proprietà numeriche
- `figma_render_jsx` vs `figma_create_child` — layout 2+ elementi vs singolo
- `figma_execute` — MAI per operazioni DS
- `figma_setup_tokens` + `figma_update_ds_page` — SEMPRE insieme per modifiche DS

**File da modificare**: `src/main/system-prompt.ts`

#### 0.9 — Description/promptSnippet update per 8 tool

Aggiornare le description di 8 tool per riflettere i ruoli DS (da PLAN-DESIGN-WORKFLOW.md Sezione 6.5):

| Tool | Cambio chiave nella description |
|---|---|
| `figma_design_system` | "+ rules + naming + status. Use forceRefresh after DS changes" |
| `figma_setup_tokens` | "idempotent — creates if new, updates if existing" |
| `figma_bind_variable` | "numeric properties only (padding, gap, radius, fontSize, lineHeight). For colors: use set_fills with bindTo" |
| `figma_lint` | "DS adherence + auto-layout + naming + best practices. Structured report" |
| `figma_set_fills` | "+ Use bindTo to bind to DS variable" |
| `figma_set_strokes` | "+ Use bindTo to bind to DS variable" |
| `figma_set_text` | "+ NOT for DS page — use figma_update_ds_page" |
| `figma_execute` | "NEVER for DS operations" |

**File da modificare**: `src/main/tools/discovery.ts`, `tokens.ts`, `jsx-render.ts`, `core.ts`, `manipulation.ts`

---

### Fase 0.5: Benchmark (1-2 giorni)

**Obiettivo**: Misurare il comportamento attuale prima di cambiare l'orchestrazione.

#### 0.5.1 — Definire scenari canonici

8-12 scenari che coprono i workflow principali:

| # | Scenario | Categoria |
|---|---|---|
| 1 | Creare un bottone con 3 varianti (size) | Componente semplice |
| 2 | Creare una card con titolo, immagine, CTA | Componente composto |
| 3 | Costruire una hero section con heading, subtitle, 2 bottoni | Sezione schermata |
| 4 | Costruire una pagina completa (header + hero + features + footer) | Schermata intera |
| 5 | Aggiornare i colori di un frame esistente | Modifica minimale |
| 6 | Impostare variabili colore (primitivi + semantici, light/dark) | Token setup |
| 7 | Creare un component set con 4x3 varianti e proprietà | Componente avanzato |
| 8 | Generare un'immagine e inserirla in un frame | Image gen + composizione |
| 9 | Costruire un layout con componenti da libreria esistente | Riuso DS |
| 10 | Aggiornare testo e varianti in una schermata esistente | Update screen |
| 11 | Creare uno storyboard di 4 frame con immagini generate | Image story |
| 12 | Audit di un frame per hardcoded values e naming issues | Token audit |

#### 0.5.2 — Metriche da registrare

Per ogni scenario:

- Numero totale di tool call
- Numero di `figma_screenshot` calls
- Numero di errori / retry
- Tempo totale (turni di conversazione)
- Qualità finale percepita (1-5)
- Problemi specifici osservati

#### 0.5.3 — Output

- `docs/benchmark-v0.md` con risultati
- Set di scenari riutilizzabili come regression test per agent playbook

---

### Fase 1: Core Workflow Runtime (1 settimana)

**Obiettivo**: Creare il framework minimo per selezionare, contestualizzare e iniettare workflow packs.

#### 1.1 — Tipi base

```
src/main/workflows/types.ts
```

```typescript
interface WorkflowPack {
  id: string;
  name: string;
  description: string;
  triggers: TriggerPattern[];
  capabilities: WorkflowCapabilityId[];
  supportedModes: InteractionMode[];
  phases: WorkflowPhase[];
  references: ReferenceDoc[];
  validationPolicy: ValidationPolicy;
  requiresStateLedger: boolean;
  requiresUserCheckpoints: boolean;
}

type WorkflowCapabilityId =
  | 'ds-read'
  | 'ds-write'
  | 'ds-lint'
  | 'ds-proactive'
  | 'ds-bootstrap'
  | 'component-reuse'
  | 'library-fork'
  | 'targeted-diff'
  | 'visual-validation'
  | 'documentation';

type InteractionMode = 'bootstrap' | 'socratic' | 'execution' | 'review';
type GovernancePolicy = 'strict' | 'adaptive' | 'freeform';

interface TriggerPattern {
  keywords: string[];
  intentCategory: string;
  confidence: 'high' | 'medium' | 'low';
}

interface WorkflowPhase {
  id: string;
  name: string;
  description: string;
  mandatorySteps: string[];
  exitCriteria: string[];
  antiPatterns: string[];
  userCheckpoint: boolean;
  validationType: 'structural' | 'visual' | 'both' | 'none';
}

interface ReferenceDoc {
  id: string;
  title: string;
  content: string;         // markdown
  loadCondition: 'always' | 'on-demand';
}

// dsStatus = stato meccanico dalla cache (ha variabili? ha pagina DS?)
// dsRecentlyModified = il DS è stato modificato in questa sessione
// (sostituisce il precedente dsMaturity enum — evita overlap semantici)
interface DesignWorkflowContext {
  dsStatus: 'unknown' | 'none' | 'partial' | 'active';
  dsRecentlyModified: boolean;
  interactionMode: InteractionMode;
  governancePolicy: GovernancePolicy;
  libraryContext: 'none' | 'linked' | 'dominant';
  profileDirectives: string[];
}

interface ValidationPolicy {
  afterMutation: 'structural' | 'visual' | 'both' | 'none';
  afterMilestone: 'structural' | 'visual' | 'both';
  maxScreenshotLoops: number;
  requiredChecks: string[];
}
```

#### 1.2 — Registry

```
src/main/workflows/registry.ts
```

Registry statico di tutti i workflow packs. Nessuna discovery dal filesystem.

```typescript
import { buildScreenPack } from './packs/build-screen';
import { updateScreenPack } from './packs/update-screen';
import { buildDesignSystemPack } from './packs/build-design-system';

const WORKFLOW_PACKS: WorkflowPack[] = [
  buildScreenPack,
  updateScreenPack,
  buildDesignSystemPack,
];

export function getWorkflowPacks(): WorkflowPack[] {
  return WORKFLOW_PACKS;
}

export function getPackById(id: string): WorkflowPack | undefined {
  return WORKFLOW_PACKS.find(p => p.id === id);
}
```

#### 1.3 — Design Workflow Context Builder

```
src/main/workflows/design-context.ts
```

Prima di risolvere il pack, l'engine costruisce il contesto del file:

1. legge `dsStatus` e il riepilogo DS
2. recupera il `FigmaFileProfile` se esiste
3. inferisce `dsMaturity`, `interactionMode`, `governancePolicy`
4. emette direttive sintetiche per il prompt del turno

Heuristics iniziali:

- file senza DS + richiesta di creazione schermo → `bootstrap` oppure `socratic`
- file con DS attivo + richiesta operativa → `execution`
- richiesta di audit / consistency check → `review`
- utente che introduce nuovo token / regola → `socratic`

Output:

```typescript
export function buildDesignWorkflowContext(input: {
  userMessage: string;
  dsStatus: 'unknown' | 'none' | 'partial' | 'active';
  dsRecentlyModified: boolean;
  fileProfile?: FigmaFileProfile;
  previousMode?: InteractionMode;  // for transition logic
}): DesignWorkflowContext {
  // deterministic heuristics for v1
  // see §3.9 State Machine for transition rules
}
```

#### 1.4 — Intent Router

```
src/main/workflows/intent-router.ts
```

Router basato su keyword matching con fallback neutro. Per v1 usiamo euristiche deterministiche (non LLM-based) per semplicità e predicibilità, ma la decisione finale è `pack + context`, non solo `pack`.

```typescript
export function resolveIntent(input: {
  userMessage: string;
  context: DesignWorkflowContext;
}): {
  pack: WorkflowPack | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  context: DesignWorkflowContext;
  capabilities: WorkflowCapabilityId[];
} {
  // Keyword matching against trigger patterns
  // Return null pack with 'none' confidence when no match
  // Never force a pack on ambiguous input
  // Adjust pack behavior based on interactionMode / dsMaturity
}
```

**Rischio mitigato**: se il router sbaglia, il fallback è il comportamento generalista. L'agente non è mai peggiore di oggi.

#### 1.5 — Workflow Extension Factory

```
src/main/workflows/extension-factory.ts
```

Un `ExtensionFactory` che, quando un workflow pack è attivo, augmenta i messaggi dell'agente con:

- `DesignWorkflowContext` del turno
- Istruzioni della fase corrente
- Governance invariants della `interactionMode`
- Capability docs pertinenti
- Reference docs pertinenti
- Policy di validazione
- Anti-pattern della fase

Integrazione in `src/main/agent.ts` accanto alla compression extension factory:

```typescript
const session = new AgentSession({
  // ... existing config ...
  extensionFactories: [
    compressionExtensionFactory,
    workflowExtensionFactory,  // NEW
  ],
});
```

Le capability docs devono essere iniettabili separatamente dalle reference del pack. Esempio: `build-screen` in `review` mode potrebbe caricare `ds-lint` e `visual-validation` senza dover attivare l'intero pack `token-audit`.

#### 1.6 — Test

```
tests/unit/main/workflows/intent-router.test.ts
tests/unit/main/workflows/registry.test.ts
tests/unit/main/workflows/design-context.test.ts
```

Exit criteria:
- Un prompt può attivare un workflow pack
- Il `DesignWorkflowContext` viene classificato correttamente per i casi base
- Il pack aggiunge istruzioni solo per il task corrente
- Nessuna regressione sui prompt fuori scope
- Il fallback generalista funziona quando nessun pack matcha

---

### Fase 1.5: Task Orchestration Layer (3-5 giorni)

**Obiettivo**: Dare all'agente la capacità di auto-decomposizione e tracking del lavoro, con visibilità per l'utente. Deliverable autonomo che poi diventa substrato del workflow engine (Fase 4).

**Fonte**: `@tintinweb/pi-tasks` (vedi Sezione 2.5). Adattamento, non import diretto.

#### 1.5.1 — TaskStore file-backed

```
src/main/tasks/store.ts
```

Adattato da `../forks/pi-tasks/src/task-store.ts` (305 righe). Cambiamenti:

- Path: `~/.bottega/tasks/tasks-{slotId}.json` (per-slot, non per-session Pi)
- Rimuovere env override `PI_TASKS` e session upgrade logic (Bottega ha slot lifecycle)
- Mantenere: ACID write (tmp+rename), file locking (`O_EXCL`), dependency graph bidirezionale, cycle warning, auto-increment IDs

```
src/main/tasks/types.ts
```

```typescript
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm?: string;              // spinner text per il task panel
  metadata: Record<string, any>;    // campi estensibili (workflowId, phase, judgeVerdict, ...)
  blocks: string[];
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}
```

#### 1.5.2 — Task Tools (3 ToolDefinition)

```
src/main/tasks/tools.ts
```

Tre tool nel toolset dell'agente, pattern identico ai tool Figma esistenti (TypeBox schemas, `textResult` wrapper):

| Tool | Descrizione | Schema chiave |
|---|---|---|
| `task_create` | Crea task con subject, description, activeForm | `{ subject: string, description: string, activeForm?: string }` |
| `task_update` | Aggiorna stato, dipendenze, metadata | `{ taskId: string, status?: TaskStatus \| 'deleted', addBlockedBy?: string[], metadata?: Record<string, any> }` |
| `task_list` | Lista task con stato, blocker e dettagli | `{}` — nessun parametro |

**Descrizioni tool**: adattate dalle `promptGuidelines` di pi-tasks (battle-tested per prevenire over-tasking):

```
## When to Use task_create
- Complex multi-step requests (3+ distinct phases)
- Multiple design operations in one request
- User provides a list of changes to make

## When NOT to Use task_create
- Single operation (change a color, move an element)
- Fewer than 3 tool calls needed to complete
- Purely conversational or informational requests
```

**Naming convention**: `task_*` (snake_case, come tutti i tool Bottega), non `TaskCreate` (PascalCase di pi-tasks).

#### 1.5.3 — Task Extension Factory

```
src/main/tasks/extension-factory.ts
```

Una `extensionFactory` registrata accanto alla compression extension in `agent.ts`:

```typescript
extensionFactories: [
  infra.compressionExtensionFactory,
  infra.taskExtensionFactory,  // ← NUOVO
],
```

Responsabilità:

1. **System-reminder injection** (pattern da pi-tasks index.ts:299-321): se task esistono nel store ma task tools non usati da 4 turni, appendere un `<system-reminder>` al prossimo `tool_result` non-task. Reset del timer quando un task tool viene usato.

2. **Auto-clear** (pattern da pi-tasks auto-clear.ts): dopo N turni dalla completion di tutti i task, rimuovere automaticamente i task completati. Configurable: `never` | `on_list_complete` | `on_task_complete`.

3. **Task list injection** (nuovo): quando il contesto viene compresso e ci sono task pending/in_progress, iniettare un summary della task list nel prossimo `tool_result` per preservare lo stato di lavoro dell'agente.

#### 1.5.4 — Task Panel nel Renderer

```
src/renderer/task-panel.js
```

Pannello IPC-driven nel renderer, ispirato al widget pi-tasks ma adattato a Electron:

```
┌─ Tasks ──────────────────────────┐
│ ✔ Analyze existing design system │
│ ✔ Create page layout             │
│ ◼ Creating header component...   │  ← in_progress
│ ◻ Add navigation section         │  ← pending
│ ◻ Add footer                     │  ← pending, blocked by #3
│ ◻ Quality review                 │  ← pending, blocked by #3,#4,#5
│                                  │
│ ████████░░░░ 2/6                 │
└──────────────────────────────────┘
```

IPC events:
- `task:updated` (slotId, task) — singolo task aggiornato
- `task:list-changed` (slotId, tasks[]) — lista completa refreshata
- `task:cleared` (slotId, count) — N task rimossi da auto-clear

Nessun polling, nessun timer — event-driven puro. Il pannello è visibile solo quando ci sono task attivi.

#### 1.5.5 — Integrazione con moduli esistenti

| File | Modifica |
|---|---|
| `src/main/tools/index.ts` | Aggiungere `createTaskTools(store)` all'aggregatore (~2 righe) |
| `src/main/agent.ts` | Creare `taskExtensionFactory`, passare a `extensionFactories` (~10 righe) |
| `src/main/system-prompt.ts` | Aggiungere sezione "Task Tracking" con guidance (~300 token) |
| `src/main/preload.ts` | Esporre IPC task events al renderer (~5 righe) |
| `src/main/ipc-handlers.ts` | Aggiungere handler `tasks:list`, `tasks:get` (~10 righe) |
| `src/main/session-events.ts` | Wire turn counting per auto-clear + task IPC emit (~10 righe) |
| `src/main/compression/metrics.ts` | Aggiungere categoria `'task'` al `CATEGORY_MAP` (~3 righe) |

#### 1.5.6 — Judge Remediation Tasks

Integrare nel judge harness esistente (`src/main/subagent/judge-harness.ts`):

Quando il judge restituisce FAIL, creare un task per ogni action item:
```typescript
if (lastVerdict.verdict === 'FAIL') {
  for (const item of lastVerdict.actionItems) {
    store.create(item, `Judge remediation (attempt ${attempt})`, undefined, {
      source: 'judge',
      judgeAttempt: attempt,
      slotId: slot.id,
    });
  }
}
```

Il retry loop meccanico resta invariato — i task aggiungono visibilità e persistenza, non sostituiscono il meccanismo.

#### 1.5.7 — Test

```
tests/unit/main/tasks/store.test.ts         — CRUD, locking, dependency edges, cycle warning
tests/unit/main/tasks/tools.test.ts         — Tool execute, status transitions, blockers
tests/unit/main/tasks/extension.test.ts     — Reminder injection, auto-clear, context injection
```

Playbook test per scenari end-to-end:
```
tests/unit/main/agent-playbook-tasks.test.ts — Agent crea task, marca in_progress, completa, auto-clear
```

**Exit criteria**:
- L'agente può decomporsi task complessi in 3+ step tracciati
- Il task panel mostra progresso in real-time
- System-reminder injection funziona (nudge dopo 4 turni senza task tool)
- Auto-clear rimuove task completati dopo N turni
- Judge action items appaiono come task nel panel
- Zero regressione su task semplici (l'agente non crea task per operazioni banali)

---

### Fase 2: Decomposizione System Prompt (3-5 giorni)

**Obiettivo**: Spostare i dettagli task-specifici fuori da `system-prompt.ts` in reference docs modulari caricate on-demand dai workflow packs.

#### 2.1 — Cosa RESTA nel system prompt

- Identità e ruolo dell'agente
- Regole di safety universali
- Tool selection base (quale tool per quale operazione)
- I 15-20 gotchas critici (dalla Fase 0.1 — questi sono UNIVERSALI, non task-specifici)
- Validation workflow base
- "Inspect before create" pattern

#### 2.2 — Cosa viene SPOSTATO in reference docs

```
src/main/workflows/references/
├── figma-execute-safety.md      — Gotchas completi (40+), pattern di esecuzione, error recovery
├── design-system-discovery.md   — Discovery patterns, search_design_system, inspect existing
├── visual-validation.md         — Structural vs visual, defect categories, screenshot guidance
├── component-reuse.md           — Component property system, setProperties, variant API
├── token-architecture.md        — Simple/Standard/Advanced patterns, scope best practices
├── variable-binding.md          — setBoundVariable, setBoundVariableForPaint, scopes, aliasing
└── codebase-token-extraction.md — CSS/Tailwind/DTCG/CSS-in-JS/iOS/Android extraction
```

Ogni reference doc è un markdown che viene iniettato nel contesto solo quando il workflow pack lo richiede.

#### 2.3 — DS nel System Prompt (always-on, da PLAN-DESIGN-WORKFLOW.md)

Oltre alle reference modulari task-specifiche, il system prompt mantiene un blocco DS **sempre attivo** (non task-specifico — il DS è rilevante per OGNI operazione di design):

```
Posizione nel prompt:
1. Identity + workflow                    ← identità (critico)
2. DS notation legend                     ← come leggere il DS (~100 token, fisso)
3. DS block del progetto                  ← il DS attivo (~200-500 token, dinamico)
4. DS behavioral instructions            ← come usare il DS (~100 token, fisso)
5. Best practices Figma                   ← regole universali (~200 token, fisso)
6. Plugin API gotchas (top 15-20)         ← safety rules (dalla Fase 0.1)
7. Tool selection guide                   ← reference
8. Tool disambiguation rules             ← dalla Fase 0.8
```

**Budget token**: ~600-1000 token totali = <0.1% del contesto 1M. Impatto trascurabile.

Il DS block è costruito da `buildSystemPrompt(modelLabel, dsData?)` all'avvio sessione:
- `dsData` viene da `readDesignSystem()` (funzione condivisa startup/runtime — DESIGN-WORKFLOW Sezione 8.5)
- Se il file non ha un DS → il block è omesso e l'agente suggerisce di crearne uno
- `dsStatus` hint ("active" / "partial" / "none") incluso nei risultati di `figma_screenshot` e `figma_get_file_data`

Il DS block usa notazione compressa con legenda di decodifica (DESIGN-WORKFLOW Sezione 5.2):
```
Colors: primary=#A259FF secondary=#4A90D9 error=#FF3B30
Type: Inter — body=16/24/400 heading=24/32/700
Space: 8px grid [4 8 16 24 32 48] | Radii: sm=4 md=8 lg=16
```

**Gestione evoluzione mid-session**:
- Agente modifica DS → sa cosa è cambiato (è nella conversazione) → chiama `figma_design_system(forceRefresh: true)`
- Utente modifica DS in Figma → dice all'agente → agente chiama `forceRefresh`
- Sessione successiva → `buildSystemPrompt` rilegge tutto da Figma

#### 2.4 — Verifica

- Il system prompt task-specifico si riduce significativamente (target: -40% token)
- Il DS block always-on aggiunge ~600-1000 token (accettabile)
- I workflow packs ricostruiscono il contesto specifico solo quando servono
- Task semplici (che non attivano nessun pack) funzionano con il solo system prompt base + DS

**File da modificare**: `src/main/system-prompt.ts`
**File da creare**: tutti i reference docs sopra

---

### Fase 3: V1 Workflow Packs (2 settimane)

#### 3.1 — `build-screen`

```
src/main/workflows/packs/build-screen.ts
```

**Triggers**: "crea una schermata", "costruisci questa pagina", "trasforma in UI", "build this screen", "make a landing page"

**Fasi**:

| Fase | Steps | Validazione | Checkpoint |
|---|---|---|---|
| 0. Status | `figma_status` per verificare connessione | Nessuna | No |
| 1. Discovery | Ispezionare pagina corrente, cercare componenti e token esistenti | Strutturale | No |
| 2. Plan | Proporre struttura sezioni (header, hero, content, footer) | Nessuna | Si — "Procedo con questa struttura?" |
| 3. Build | Una sezione per volta: creare wrapper → build sezione → validate | Visual per sezione | No |
| 4. Validate | Screenshot finale + max 3 cicli fix/screenshot | Visual | No |

**References caricate**: `design-system-discovery.md`, `visual-validation.md`, `component-reuse.md`

**Capability bundles**: `ds-read`, `component-reuse`, `ds-proactive`, `visual-validation`

**Supported modes**:
- `bootstrap`: discovery + suggerimento DS minimo prima di costruire
- `socratic`: checkpoint esplicito sulla struttura e sui nuovi valori introdotti
- `execution`: costruzione rapida con DS attivo
- `review`: variante leggera che enfatizza lint + screenshot finale

**Anti-pattern specifici**:
- ❌ Costruire sezioni come top-level children e reparent dopo (silently fails)
- ❌ Creare più di una sezione per tool call
- ❌ Hardcodare colori hex quando esistono variabili
- ❌ Creare componenti da zero quando ne esistono di simili nella libreria

**Gotchas subset iniettati**: positions (0,0), FILL after appendChild, font loading, variable bindings, fills immutable

#### 3.2 — `update-screen`

```
src/main/workflows/packs/update-screen.ts
```

**Triggers**: "aggiorna questa schermata", "modifica il frame", "cambia il header", "update the design", "fix the layout"

**Fasi**:

| Fase | Steps | Validazione | Checkpoint |
|---|---|---|---|
| 0. Read | Leggere selezione o target node, ispezionare struttura | Strutturale | No |
| 1. Diff | Confrontare stato attuale con intento utente, identificare mutazioni minime | Nessuna | Si — "Ecco cosa cambierò. Procedo?" |
| 2. Mutate | Applicare mutazioni minimali, una per volta | Strutturale | No |
| 3. Validate | Screenshot di verifica | Visual | No |

**References caricate**: `visual-validation.md`, `component-reuse.md`

**Capability bundles**: `ds-read`, `targeted-diff`, `ds-lint`, `visual-validation`

**Supported modes**:
- `socratic`: l'agente espone il diff prima di mutare
- `execution`: applica mutazioni minime
- `review`: verifica l'aderenza dopo l'update

**Anti-pattern specifici**:
- ❌ Ricreare l'intera schermata invece di fare mutazioni minimali
- ❌ Modificare nodi fuori dal target senza conferma
- ❌ Ignorare le proprietà component (usare setProperties, non node.characters)

#### 3.3 — `build-design-system`

```
src/main/workflows/packs/build-design-system.ts
```

**Triggers**: "imposta tokens", "costruisci libreria", "crea design system", "setup variables", "build component library"

Questo è il workflow più complesso. La sua specifica implementativa è in **PLAN-DESIGN-WORKFLOW.md v3.4**, che definisce architettura, tool surface, e 35 decisioni registrate. Questo workflow pack unisce quella specifica di prodotto con i pattern operativi dal MCP guide.

**Capability bundles**: `ds-bootstrap`, `ds-write`, `library-fork`, `ds-lint`, `documentation`

**Supported modes**:
- `bootstrap`: setup iniziale da zero o da libreria esistente
- `socratic`: ogni tassonomia o regola passa da checkpoint utente
- `execution`: solo per fasi già approvate e riprese da ledger
- `review`: audit finale e sign-off

##### Esperienza Utente: I 4 Momenti (da PLAN-DESIGN-WORKFLOW.md)

| Momento | Cosa succede | Tool coinvolti |
|---|---|---|
| **First Contact** | L'agente legge variabili + pagina DS + librerie collegate. Inietta nel prompt. Se mancante, propone di crearlo. | `figma_design_system`, `readDesignSystem()` |
| **Socratic Construction** | L'agente analizza il file, guida l'utente passo per passo. Per ogni decisione confermata, aggiorna ENTRAMBI i livelli. | `figma_setup_tokens` + `figma_update_ds_page` (sempre insieme) |
| **Daily Work** | L'agente usa i valori DS. Se introduce un valore non nel DS, chiede. Proattività bidirezionale. | `figma_set_fills(bindTo)`, `figma_bind_variable`, `figma_search_components` |
| **Review** | L'agente linta per aderenza DS + auto-layout + naming + best practices. | `figma_lint` → report 3 sezioni |

##### Implementazione: 3 Step (da PLAN-DESIGN-WORKFLOW.md)

| Step | Obiettivo | Effort | File principali |
|---|---|---|---|
| **Step 1** | Lettura DS + iniezione nel prompt + best practices | ~350 righe | `tools/discovery.ts`, `system-prompt.ts`, `agent.ts` |
| **Step 2** | Tool DS: `figma_setup_tokens` idempotente + `figma_update_ds_page` (NEW) + `figma_bind_variable` esteso + bridge (+20 righe) | ~400 righe | `tools/tokens.ts`, `tools/ds-page.ts` (NEW), `tools/jsx-render.ts`, `code.js` |
| **Step 3** | `figma_lint` completo (walk + 8 funzioni matching + report 3 sezioni) + proattività | ~450 righe | `tools/lint.ts` (NEW) |

##### Knowledge Layer: Pattern dal MCP Guide

Il workflow pack carica i reference docs con i pattern operativi dal Figma MCP guide:

- **Discovery Phase** (da `discovery-phase.md`): codebase token extraction, file inspection scripts, search_design_system usage
- **Token Creation** (da `token-creation.md`): collection architecture (Simple/Standard/Advanced), scope best practices, code syntax format
- **Component Creation**: combineAsVariants + grid layout, addComponentProperty, INSTANCE_SWAP for icons
- **Error Recovery** (da `error-recovery.md`): sharedPluginData cleanup, idempotency patterns, failure taxonomy

##### Fasi del Workflow

| Fase | Steps | Validazione | Checkpoint | Ledger |
|---|---|---|---|---|
| 0. Discovery | Analizzare codebase (token extraction) + ispezionare file Figma + search librerie + rilevare librerie collegate | Nessuna | Si — piano completo con mapping table | Si |
| 1. Foundations | Creare variable collections/modes → primitivi → semantici → scopes → code syntax → effect styles → text styles. Aggiornare pagina DS con campioni visivi. | Strutturale + `figma_lint` | Si — "Token creati. Procedo?" | Si |
| 2. File Structure | Creare pagina DS con sezioni `[DS::colors]`, `[DS::typography]`, `[DS::spacing]`, `[DS::components]`, `[DS::naming]`, `[DS::rules]` + documentation pages | Strutturale + Visual | Si — "Struttura file ok?" | Si |
| 3. Components | Per OGNI componente: pagina → base component → varianti → proprietà → naming → bind variabili → validazione | Visual + `figma_lint` per componente | Si — per componente | Si |
| 4. QA | `figma_lint` su tutto il file → accessibility audit → naming audit → unbound values audit → final screenshots | `figma_lint` + Visual per pagina | Si — sign-off finale | Si |

##### Tool DS — Specifiche Esatte (da PLAN-DESIGN-WORKFLOW.md)

**`figma_setup_tokens` — Reso Idempotente** (Decisione D4):
- Se la collezione esiste → aggiunge/aggiorna variabili
- Se non esiste → la crea
- L'agente non distingue tra "creo" e "aggiorno" — stessa interfaccia

**`figma_update_ds_page` — Nuovo Tool** (Decisione D5):
- Parametri: `section` (colors/typography/spacing/components/naming/rules), `action` (create/update/append), `text`, `samples`
- Crea/trova pagina "Design System" → trova/crea sezione `[DS::section]` → aggiorna testo + campioni
- Via codice fisso `EXECUTE_CODE` (nessuna estensione bridge)

**`figma_set_fills`/`figma_set_strokes` con `bindTo`** (Decisione D32):
```
// Senza DS — valore grezzo
figma_set_fills(nodeId, [{ type: "SOLID", color: "#A259FF" }])
// Con DS — valore + binding in un solo call
figma_set_fills(nodeId, [{ type: "SOLID", color: "#A259FF" }], { bindTo: "colors/primary" })
```

**`figma_bind_variable` — Solo Proprietà Numeriche** (Decisione D33):
- Proprietà: `paddingTop/Right/Bottom/Left`, `itemSpacing`, `cornerRadius`, `fontSize`, `lineHeight`, `strokeWeight`
- Per colori: usare `figma_set_fills`/`figma_set_strokes` con `bindTo`

**`figma_lint` — Report a 3 Sezioni** (Decisione D6, D23):
1. `dsCheck`: matching meccanico (è nel DS? sì/no) per colori, tipografia, spacing, radii, effects, binding
2. `bestPractices`: auto-layout, depth, sizing, naming, empty/hidden nodes
3. `figmaLint`: regole native Figma (stili staccati, etc.)
Architettura: walk arricchita (codice fisso plugin) + funzioni pure di matching (Electron, unit-testabili)

##### Anti-Pattern per Fase

**Fase 0** — Discovery:
- ❌ Iniziare a creare prima che lo scope sia approvato dall'utente
- ❌ Ignorare convenzioni esistenti nel file
- ❌ Saltare discovery delle librerie collegate
- ❌ Concludere "no variables exist" basandosi solo su `getLocalVariableCollections` (le librerie remote sono invisibili)

**Fase 1** — Foundations:
- ❌ Usare `ALL_SCOPES` su qualsiasi variabile — settare scopi specifici
- ❌ Duplicare valori raw nel layer semantico invece di aliasare
- ❌ Non settare code syntax (rompe Dev Mode). WEB: `var(--color-bg-primary)`, non `--color-bg-primary`
- ❌ Creare token componente prima di concordare la tassonomia
- ❌ Usare `figma_execute` per operazioni su variabili — usare `figma_setup_tokens`
- ❌ Aggiornare variabili senza aggiornare anche la pagina DS

**Fase 2** — File Structure:
- ❌ Saltare pagina DS o documentation pages
- ❌ Mettere componenti multipli non correlati su una pagina

**Fase 3** — Components:
- ❌ Creare componenti prima che le foundations esistano
- ❌ Hardcodare qualsiasi fill/stroke/spacing/radius — usare `bindTo` e `figma_bind_variable`
- ❌ Creare una variante per icona (usare INSTANCE_SWAP)
- ❌ Non posizionare varianti dopo combineAsVariants (tutte a 0,0)
- ❌ Matrice varianti > 30 senza splitting
- ❌ Importare componenti remoti e detacharli immediatamente
- ❌ Usare `node.characters` su testo gestito da component property — usare `setProperties()`

##### Extended Collections e Multi-Brand

Figma supporta Extended Collections — collezioni che ereditano da un'altra e sovrascrivono solo ALCUNI valori (come CSS inheritance). Perfetto per temi branded. Il workflow supporta questo pattern quando rilevato nel codebase (es. `lightTheme` + `darkTheme` + `brandATheme`).

##### Conflict Resolution (Code vs Figma)

| Chi vince | Quando |
|---|---|
| **Code** | Valori hex, naming token, CSS variable names, mode values |
| **Figma** | Architettura collection, naming hierarchy, struttura pagine |
| **Utente** | Stesso nome + valore diverso, variant axes diversi, modello token incompatibile |

##### Codebase Token Extraction (dal MCP guide `discovery-phase.md`)

| Sorgente | Pattern di Ricerca |
|---|---|
| CSS Custom Properties | `:root { }`, `@theme { }` (Tailwind v4), `--color-*`, `--spacing-*` |
| Tailwind Config | `theme.extend.colors/spacing/borderRadius` |
| DTCG Format | `*.tokens.json` con `$type`/`$value` |
| CSS-in-JS | `createTheme`, `ThemeProvider`, theme objects |
| iOS | Asset catalogs `.xcassets`, `Color()` extensions |
| Android | `res/values/colors.xml`, Compose `MaterialTheme` |

Dark mode detection: `@media (prefers-color-scheme: dark)`, `.dark {}`, `darkMode` in Tailwind config, `values-night/` su Android.

Shadow extraction: CSS `box-shadow` → Figma Effect Styles (Decisione D21: shadows via Effect Styles, non variable binding).

---

### Fase 3.5: Figma File Profile Persistence (3-5 giorni)

**Obiettivo**: Quando Bottega si connette a un file Figma, scansiona automaticamente le sue convenzioni e le persiste come profilo riutilizzabile.

**Ispirazione**: Gemini (concetto di "auto-generazione regole") + MCP guide ("Discover Conventions Before Creating") + Codex (state persistence architecture).

#### 3.5.1 — File Profile Schema

```typescript
interface FigmaFileProfile {
  fileKey: string;
  fileName: string;
  lastScanned: string; // ISO date
  lastDsStatus: 'none' | 'partial' | 'active';
  conventions: {
    naming: {
      pageStyle: 'PascalCase' | 'sentence-case' | 'kebab-case' | 'other';
      componentStyle: string; // e.g., "Property=Value, Property=Value"
      variableStyle: string;  // e.g., "slash/separated/lowercase"
    };
    structure: {
      pageCount: number;
      hasSeparatorPages: boolean;
      hasFoundationsPages: boolean;
      hasCoverPage: boolean;
    };
    designSystem: {
      variableCollections: { name: string; modeCount: number; varCount: number }[];
      componentSetCount: number;
      textStyleCount: number;
      effectStyleCount: number;
      paintStyleCount: number;
      hasPublishedLibrary: boolean;
    };
    tokens: {
      hasPrimitiveSemanticSplit: boolean;
      colorModes: string[];   // e.g., ["Light", "Dark"]
      scopePattern: string;   // e.g., "specific" | "all_scopes" | "mixed"
      hasCodeSyntax: boolean;
    };
    workflow: {
      dsOrigin: 'none' | 'local' | 'library-derived' | 'mixed';
      preferredMode: 'bootstrap' | 'socratic' | 'execution' | 'review';
      lastApprovedDsChangeAt?: string;
      reusablePatternCount: number;
    };
  };
}
```

#### 3.5.2 — Scan Automatico

Alla prima connessione a un file (o su richiesta), eseguire uno scan read-only via `figma_execute`:

1. Listare pagine e struttura top-level
2. Listare variable collections con modes e sample variables
3. Listare component sets con proprietà
4. Listare text styles, effect styles, paint styles
5. Campionare naming conventions da componenti e variabili esistenti
6. Verificare scope patterns e code syntax

#### 3.5.3 — Persistenza e Injection

- Salvare il profilo in `session-store.ts` / `app-state-persistence.ts` per file key
- Iniettare le convenzioni rilevanti nel system prompt come **direttiva assoluta** per tutti i turni su quel file
- Esempio di injection: "This file uses slash/separated/lowercase for variables, PascalCase for component sets, and has Light/Dark modes. ALWAYS match these conventions."

#### 3.5.4 — Integrazione con Workflow Packs

I workflow packs accedono al file profile per:
- `build-design-system`: sapere se ci sono già token, quali convenzioni seguire
- `build-screen`: sapere quali componenti sono disponibili per il riuso
- `componentize-pattern`: allinearsi allo stile di naming esistente

#### 3.5.5 — Derivare il Design Workflow Context dal profilo

Il `FigmaFileProfile` non serve solo a iniettare convenzioni nel prompt. Serve anche a rendere il router meno cieco:

- `lastDsStatus = none` + libreria collegata → `interactionMode = bootstrap`, proposta di fork da libreria
- `lastDsStatus = partial` → `interactionMode = socratic`, suggerimento di completare la pagina DS
- `lastDsStatus = active` + naming stabile → `interactionMode = execution`
- richiesta utente di review → override a `review`, anche se il file è maturo

In questo modo `First Contact` non è un caso speciale hardcodato nel pack `build-design-system`. È una proprietà del file che influenza tutti i pack.

**File da creare**: `src/main/workflows/file-profile.ts`
**File da modificare**: `src/main/session-store.ts`, `src/main/system-prompt.ts`

---

### Fase 4: State Ledger e Resume (1 settimana)

**Obiettivo**: Rendere robusti i workflow multi-turno con persistenza di stato su disco.

**Prerequisito**: Fase 1.5 (TaskStore + task tools). Il state-ledger NON è un modulo separato — è una **view tipizzata** sopra il TaskStore già implementato in Fase 1.5 (vedi Decisione 3.12).

#### 4.1 — Schema del Ledger

Il `WorkflowStateLedger` è costruito come proiezione dei task con `metadata.workflowId` matching. I campi workflow-specifici vivono nel `metadata` bag dei task:

```
src/main/workflows/state-ledger.ts  — view tipizzata sopra TaskStore, non store separato
```

```typescript
/** View tipizzata: costruita filtrando i task per workflowId. */
interface WorkflowStateLedger {
  runId: string;
  workflowId: string;
  fileKey: string;
  phase: string;
  step: string;
  startedAt: string;
  lastUpdatedAt: string;
  completedSteps: string[];          // derivato da task con status='completed'
  entities: {
    collections: Record<string, string>;  // name → Figma ID
    variables: Record<string, string>;
    modes: Record<string, string>;
    pages: Record<string, string>;
    components: Record<string, string>;
    componentSets: Record<string, string>;
    styles: Record<string, string>;
  };
  pendingValidations: string[];
  userCheckpoints: Record<string, string>;  // phase → approval date
  errors: { step: string; error: string; recoveredAt?: string }[];
}
```

#### 4.2 — Persistenza

Scritto su disco in `app-state-persistence` per sessione/file:

```
~/.bottega/workflow-state/{fileKey}/{runId}.json
```

Letto all'inizio di ogni turno quando un workflow pack è attivo. Se il contesto viene troncato, il ledger è la fonte di verità.

#### 4.3 — sharedPluginData Tagging

Ogni nodo creato dai workflow viene taggato nel file Figma stesso:

```javascript
node.setSharedPluginData('bottega', 'run_id', RUN_ID);
node.setSharedPluginData('bottega', 'phase', 'phase3');
node.setSharedPluginData('bottega', 'key', 'componentset/button');
```

Questo abilita:
- **Cleanup sicuro**: trovare e rimuovere nodi per `run_id`, NON per nome
- **Idempotent check-before-create**: verificare se l'entità esiste già prima di crearla
- **Resume**: scansionare il file per ricostruire lo stato

#### 4.4 — Resume Protocol

1. Leggere il ledger da disco
2. Scansionare il file Figma per nodi con `sharedPluginData('bottega', 'run_id')` matching
3. Confrontare inventario file con entità nel ledger
4. Identificare il punto di resume (primo step non completato)
5. Continuare dal checkpoint

#### 4.5 — Test

```
tests/unit/main/workflows/state-ledger.test.ts
```

Exit criteria:
- Un workflow lungo può essere ripreso dopo restart o cambio modello
- Il resume non dipende solo dalla memoria del modello
- Il cleanup rimuove solo nodi taggati, mai nodi dell'utente

---

### Fase 5: Validation Engine (1 settimana)

**Obiettivo**: Formalizzare cosa significa "task completato correttamente".

#### 5.1 — Validation Policy

```
src/main/workflows/validation-policy.ts
```

```typescript
interface ValidationRule {
  id: string;
  description: string;
  trigger: 'after-mutation' | 'after-milestone' | 'before-checkpoint';
  type: 'structural' | 'visual';
  check: string;  // cosa verificare
}

const UNIVERSAL_RULES: ValidationRule[] = [
  { id: 'no-duplicate-creation', trigger: 'after-mutation', type: 'structural',
    description: 'Check that created node doesn\'t duplicate an existing one',
    check: 'Search by name before creating' },
  { id: 'discovery-before-create', trigger: 'after-mutation', type: 'structural',
    description: 'Verify design system search was done before creating from scratch',
    check: 'Check that figma_search_components or figma_design_system was called' },
  { id: 'visual-defect-check', trigger: 'after-milestone', type: 'visual',
    description: 'Check screenshot for common defects',
    check: 'Look for: clipped text, overlapping content, placeholder text, wrong colors' },
  { id: 'max-screenshot-loops', trigger: 'after-milestone', type: 'visual',
    description: 'Limit screenshot/fix cycles',
    check: 'Max 3 screenshot/fix loops per section' },
];
```

#### 5.2 — Integrazione con Judge Harness

I criteri di validazione visiva dal MCP guide si integrano con il judge harness esistente in `src/main/subagent/judge-harness.ts`:

- Il judge riceve i criteri specifici del workflow pack attivo
- Valuta screenshot contro criteri (clipped text, overlapping, placeholder)
- Produce verdetto strutturato

#### 5.3 — Test

```
tests/unit/main/workflows/validation-policy.test.ts
```

---

### Fase 6: Code Connect Integration (1-2 settimane)

**Obiettivo**: Integrare il mapping bidirezionale design↔code.

#### 6.1 — Opzione A: Bridge al Server MCP Remoto

Usare il server MCP remoto di Figma (`https://mcp.figma.com/mcp`) per le API Code Connect:

- `get_code_connect_map(fileKey, nodeId)` — leggere mapping esistenti
- `get_code_connect_suggestions(fileKey, nodeId)` — scoprire componenti non mappati
- `send_code_connect_mappings(fileKey, nodeId, mappings)` — creare mapping
- `get_context_for_code_connect(fileKey, nodeId)` — proprietà componente per template

Richiede autenticazione OAuth con l'account Figma dell'utente.

#### 6.2 — Opzione B: Mapping Locale

Mantenere un mapping locale in Bottega:

```typescript
interface ComponentCodeMapping {
  figmaNodeId: string;
  figmaComponentName: string;
  codeComponentPath: string;
  codeComponentName: string;
  propertyMapping: Record<string, string>; // Figma prop → code prop
}
```

Persistito nel profilo file (Fase 3.5).

#### 6.3 — Integrazione con Workflow

Il mapping Code Connect diventa input per:
- `build-screen`: sapere quale code component corrisponde a quale Figma component
- `build-design-system`: generare template .figma.js durante la creazione componenti
- Future: generazione codice da design

**File da creare**: `src/main/workflows/code-connect.ts`
**Decisione rimandata**: Opzione A vs B dipende da priorità product e complessità OAuth

---

### Fase 7: V2 Workflow Packs (ongoing)

#### 7.1 — `componentize-pattern`

**Triggers**: "questo pattern si ripete", "trasformalo in component", "crea variants"

**Fasi**:
1. Ispezionare pattern ripetuti (istanze simili, frame con struttura comune)
2. Proporre API del componente (variant axes, TEXT properties, INSTANCE_SWAP)
3. Creare componente base con variable bindings
4. Creare varianti e combineAsVariants
5. Arrangiamento griglia, naming, validazione

#### 7.2 — `lint-and-review` (ex `token-audit`)

**Triggers**: "controlla consistenza", "audit design system", "trova hardcoded", "check this page", "review quality"

**Capability bundles**: `ds-read`, `ds-lint`, `ds-proactive`, `visual-validation`

**Fasi** (struttura a 4 step, ispirata da analisi Gemini):

| Fase | Step | Validazione | Checkpoint |
|---|---|---|---|
| 1. Collection | `figma_lint` walk arricchita su frame/pagina | Nessuna | No |
| 2. Analysis | Interpretazione report JSON (dsCheck, bestPractices, figmaLint) | Nessuna | No |
| 3. Reporting | Presentazione difetti con fix proposte | Nessuna | Si — "Vuoi che corregga questi [N] problemi?" |
| 4. Correction | Applicazione fix con `bindTo`, `figma_bind_variable`, rename, ecc. | Visual | No |

#### 7.3 — `image-story`

**Triggers**: workflow multi-frame con image-gen tools, storyboard, tutorial, visual narrative

**Fasi**:
1. Pianificare frames e narrativa
2. Generare immagini sequenzialmente (ogni frame informa il successivo)
3. Arrangiare in layout narrativo
4. Validare coerenza visiva del flusso

Questo workflow è **unico di Bottega** — il Figma MCP non ha nulla di comparabile.

### Fase 5.5: Tool Surface Changes (da PLAN-DESIGN-WORKFLOW.md)

> **Nota di navigazione**: le Fasi 5.5 e 5.6 sono logicamente posizionate tra Fase 5 (Validation) e Fase 6 (Code Connect). Nell'ordine di esecuzione reale seguono il principio **"bricks before engine"** (dall'analisi Gemini): le modifiche ai tool (5.5) e alla compressione (5.6) devono essere completate PRIMA di implementare i workflow packs della Fase 3, perché i pack dipendono dai tool modificati.
>
> **Ordine di esecuzione effettivo**:
> 1. Fase 0 + 0.5 (quick wins + benchmark)
> 2. **Fase 5.5 + 5.6** (tool modifications + compression — i "mattoni")
> 3. Fase 1 (engine infrastructure — il "motore")
> 4. Fase 2 (system prompt decomposition)
> 5. Fase 3 + 3.5 (workflow packs + file profile)
> 6. Fase 4 (state ledger)
> 7. Fase 5 (validation engine — built on top of figma_lint from 5.5)
> 8. Fase 6 (Code Connect)
> 9. Fase 7 (V2 packs)

**Obiettivo**: Implementare le modifiche ai tool DS specificate in PLAN-DESIGN-WORKFLOW.md.

Questa fase è strettamente legata alla Fase 3.3 (`build-design-system`) ma è separata perché le modifiche ai tool impattano TUTTI i workflow, non solo il build-DS.

#### 5.5.1 — Tool Nuovi

| Tool | File | Descrizione |
|---|---|---|
| `figma_update_ds_page` | `src/main/tools/ds-page.ts` (NEW) | Crea/aggiorna pagina "Design System" con sezioni `[DS::*]`, campioni visivi, testo regole. Via codice fisso `EXECUTE_CODE`. |

#### 5.5.2 — Tool Modificati

| Tool | File | Modifica |
|---|---|---|
| `figma_design_system` | `tools/discovery.ts` | Legge pagina DS (`[DS::*]` sections), aggiunge `dsStatus`, include naming/rules |
| `figma_setup_tokens` | `tools/tokens.ts` | Reso idempotente: crea se nuovo, aggiorna se esistente |
| `figma_set_fills` | `tools/manipulation.ts` | Parametro opzionale `bindTo` per variable binding |
| `figma_set_strokes` | `tools/manipulation.ts` | Parametro opzionale `bindTo` per variable binding |
| `figma_bind_variable` | `tools/jsx-render.ts` | Esteso a proprietà FLOAT (padding, gap, radius, fontSize, lineHeight, strokeWeight). Colori gestiti da set_fills/set_strokes con bindTo |
| `figma_lint` | `tools/lint.ts` (NEW) | Walk arricchita + 8 funzioni pure matching + report 3 sezioni (dsCheck, bestPractices, figmaLint). Scope: nodo, pagina, selezione |

#### 5.5.3 — Bridge Changes

Unica modifica al bridge: ~20 righe nel handler `BIND_VARIABLE` in `figma-desktop-bridge/code.js` per supportare `node.setBoundVariable(property, variable)` sulle proprietà FLOAT.

Tutte le altre operazioni DS usano `EXECUTE_CODE` con codice fisso costruito in Electron — zero modifiche bridge aggiuntive.

### Fase 5.6: Compression Integration (da PLAN-DESIGN-WORKFLOW.md Sezione 8)

**Obiettivo**: Assicurare che il sistema di compressione non elimini informazioni DS critiche.

#### 5.6.1 — Tool DS rimossi da MUTATION_TOOLS

`figma_setup_tokens` e `figma_bind_variable` rimossi da `MUTATION_TOOLS` — risultato sempre completo, mai compresso. Il risparmio token (~1800/sessione) è trascurabile rispetto al rischio di perdere info (created vs updated, quale proprietà bound).

#### 5.6.2 — Cache DS estesa

```typescript
interface CachedDesignSystem {
  // Compressi dal flag compactDesignSystem:
  variables: CompactVariableCollection[];
  components: CompactComponent[];
  // MAI compressi — sempre inclusi:
  rules: DsRule[];
  naming: DsNaming | null;
  dsStatus: 'active' | 'partial' | 'none';
}
```

#### 5.6.3 — `readDesignSystem()` condivisa

Funzione condivisa tra startup path (`createFigmaAgent`) e runtime path (`figma_design_system`):

```
Startup:  createFigmaAgent → readDesignSystem() → popola cache → buildSystemPrompt(dsData)
Runtime:  figma_design_system → cache hit → return cached
          figma_design_system(forceRefresh) → fetch fresco → aggiorna cache
```

#### 5.6.4 — `fontSize` nel livello `standard`

Includere `fontSize` nel livello `standard` di `projectTree` (oggi solo in `detailed`). Costo: ~2 token per nodo TEXT, trascurabile.

#### 5.6.5 — `dsStatus` hint nei tool result

`figma_screenshot` e `figma_get_file_data` aggiungono `dsStatus` letto dalla cache. Nessun roundtrip WebSocket aggiuntivo.

**File da modificare**:
- `src/main/compression/metrics.ts` — categorie tool DS (~4 righe)
- `src/main/compression/design-system-cache.ts` — estensione cache (~20 righe)
- `src/main/compression/mutation-compressor.ts` — rimozione branch morto (-5 righe)

---

## 5. File Target

### Da Creare

| File | Fase |
|---|---|
| `src/main/workflows/types.ts` | 1 |
| `src/main/workflows/design-context.ts` | 1 |
| `src/main/workflows/registry.ts` | 1 |
| `src/main/workflows/intent-router.ts` | 1 |
| `src/main/workflows/extension-factory.ts` | 1 |
| `src/main/tasks/types.ts` | 1.5 |
| `src/main/tasks/store.ts` | 1.5 |
| `src/main/tasks/tools.ts` | 1.5 |
| `src/main/tasks/extension-factory.ts` | 1.5 |
| `src/renderer/task-panel.js` | 1.5 |
| `tests/unit/main/tasks/store.test.ts` | 1.5 |
| `tests/unit/main/tasks/tools.test.ts` | 1.5 |
| `tests/unit/main/tasks/extension.test.ts` | 1.5 |
| `tests/unit/main/agent-playbook-tasks.test.ts` | 1.5 |
| `src/main/workflows/state-ledger.ts` | 4 (view tipizzata sopra TaskStore di Fase 1.5) |
| `src/main/workflows/validation-policy.ts` | 5 |
| `src/main/workflows/file-profile.ts` | 3.5 |
| `src/main/workflows/code-connect.ts` | 6 |
| `src/main/workflows/packs/build-screen.ts` | 3 |
| `src/main/workflows/packs/update-screen.ts` | 3 |
| `src/main/workflows/packs/build-design-system.ts` | 3 |
| `src/main/workflows/packs/componentize-pattern.ts` | 7 |
| `src/main/workflows/packs/token-audit.ts` | 7 |
| `src/main/workflows/packs/image-story.ts` | 7 |
| `src/main/workflows/references/figma-execute-safety.md` | 2 |
| `src/main/workflows/references/design-system-discovery.md` | 2 |
| `src/main/workflows/references/visual-validation.md` | 2 |
| `src/main/workflows/references/component-reuse.md` | 2 |
| `src/main/workflows/references/token-architecture.md` | 2 |
| `src/main/workflows/references/variable-binding.md` | 2 |
| `src/main/workflows/references/codebase-token-extraction.md` | 2 |
| `tests/unit/main/workflows/intent-router.test.ts` | 1 |
| `tests/unit/main/workflows/registry.test.ts` | 1 |
| `tests/unit/main/workflows/design-context.test.ts` | 1 |
| `tests/unit/main/workflows/state-ledger.test.ts` | 4 |
| `tests/unit/main/workflows/validation-policy.test.ts` | 5 |
| `src/main/tools/ds-page.ts` | 5.5 |
| `src/main/tools/lint.ts` | 5.5 |
| `tests/unit/main/tools/ds-page.test.ts` | 5.5 |
| `tests/unit/main/tools/lint-matching.test.ts` | 5.5 |

### Da Modificare

| File | Fase | Cosa Cambia |
|---|---|---|
| `src/main/system-prompt.ts` | 0, 1.5, 2 | Gotchas (0.1), validation (0.2), inspect-before-create (0.3), best practices (0.7), tool disambiguation (0.8), task tracking guidance (1.5, ~300 token), DS block + legenda + behavioral (2.3) |
| `src/main/tools/manipulation.ts` | 0, 5.5 | promptSnippet figma_set_text (0.4) + `bindTo` parameter su set_fills/set_strokes (5.5) |
| `src/main/tools/discovery.ts` | 0.9, 5.5 | Description update (0.9) + figma_design_system legge pagina DS + dsStatus (5.5) |
| `src/main/tools/tokens.ts` | 0.9, 5.5 | Description update (0.9) + figma_setup_tokens idempotente (5.5) |
| `src/main/tools/jsx-render.ts` | 0.9, 5.5 | Description update (0.9) + figma_bind_variable esteso a FLOAT properties (5.5) |
| `src/main/tools/core.ts` | 5.6 | dsStatus hint in figma_screenshot result |
| `src/main/agent.ts` | 1, 1.5, 2.3 | Costruzione `DesignWorkflowContext`, aggiunta workflowExtensionFactory (1) + taskExtensionFactory (1.5) + readDesignSystem() startup (2.3) |
| `src/main/tools/index.ts` | 1.5 | Aggiungere `createTaskTools(store)` all'aggregatore (~2 righe) |
| `src/main/preload.ts` | 1.5 | Esporre task IPC events al renderer (~5 righe) |
| `src/main/ipc-handlers.ts` | 1.5 | Handler `tasks:list`, `tasks:get` per renderer query (~10 righe) |
| `src/main/session-events.ts` | 1.5 | Wire turn counting per auto-clear + task IPC emit (~10 righe) |
| `src/main/session-store.ts` | 3.5, 4 | File profile + state ledger persistence |
| `src/main/app-state-persistence.ts` | 3.5, 4 | Idem |
| `src/main/subagent/orchestrator.ts` | 5 | Integrazione validation criteria |
| `src/main/compression/metrics.ts` | 1.5, 5.6 | Categoria `'task'` nel CATEGORY_MAP (1.5, ~3 righe) + categorie tool DS (5.6, ~4 righe) |
| `src/main/subagent/judge-harness.ts` | 1.5, 5 | Creare task di remediation su FAIL (1.5, ~10 righe) + criteri dal workflow pack attivo (5) |
| `src/main/compression/design-system-cache.ts` | 5.6 | Cache estesa con rules/naming/dsStatus (~20 righe) |
| `src/main/compression/mutation-compressor.ts` | 5.6 | Rimozione branch morto figma_setup_tokens (-5 righe) |
| `figma-desktop-bridge/code.js` | 5.5 | Handler BIND_VARIABLE esteso per FLOAT properties (~20 righe) |

---

## 6. Rischi e Mitigazioni

### Rischio 1 — Prompt bloat travestito da modularità

**Problema**: iniettare troppi pack o reference ricrea il problema del system prompt monolitico.

**Mitigazione**:
- Un solo workflow pack primario per task
- Reference modulari e corte (max 2000 token ciascuna)
- Injection lazy: solo le reference della fase corrente
- Metrica: monitorare token count totale per turno pre/post workflow engine

### Rischio 2 — Misclassificazione dell'intento

**Problema**: il router sceglie il workflow sbagliato.

**Mitigazione**:
- Euristiche deterministic-first (keyword matching)
- Fallback neutro quando confidence < threshold
- Logging delle attivazioni per migliorare il router
- L'utente può sempre dire "non usare questo workflow" e l'agente torna generalista

### Rischio 3 — Drift tra documentazione e comportamento reale

**Problema**: la documentazione nei reference docs diverge dal comportamento dei tool.

**Mitigazione**:
- Ogni workflow pack ancorato ai contratti reali di Bottega
- Test automatici sui casi critici documentati
- Reference generate/mantenute insieme al codice (stessa directory, stessi PR)
- Verificare TUTTE le differenze contrattuali (Sezione 3.7) prima di adottare pattern MCP

### Rischio 4 — Troppa rigidità per task creativi

**Problema**: workflow prescrittivi peggiorano task creativi o rapidi.

**Mitigazione**:
- Workflow opzionali e intent-based, mai forzati
- Fallback sempre possibile al comportamento generalista
- Policy diverse per task esplorativi vs strutturati
- L'intent router ha una soglia di confidenza: sotto il threshold, non attiva nessun pack

### Rischio 5 — Collisione con il sistema di subagent

**Problema**: workflow packs e subagent introducono complessità duplicata.

**Mitigazione**:
- Ruolo chiaro: i workflow decidono la **procedura**, i subagent aiutano in **discovery/analysis**
- I subagent sono tool a disposizione del workflow, non decisori
- Il judge harness riceve criteri DAL workflow pack, non ne inventa di propri

### Rischio 6 — Overhead di manutenzione

**Problema**: 7+ reference docs, 6+ workflow packs, state ledger — tutto da mantenere.

**Mitigazione**:
- Iniziare con 3 packs (build-screen, update-screen, build-design-system) e solo 4 references
- Aggiungere packs solo quando c'è un caso d'uso ricorrente validato dal benchmark
- Ogni reference ha un ownership chiaro nel codice

### Rischio 7 — Over-tasking dell'agente (da analisi pi-tasks)

**Problema**: L'agente abusa dei task tools, decomponendo operazioni banali in 3-6 task superflui. Esempio: "cambia il colore del bottone" → 3 task (analizza, trova token, applica) con 6 tool call di overhead. Claude ha una tendenza nota all'over-decomposition quando riceve task tools.

**Mitigazione**:
- Tool descriptions con sezioni esplicite "When NOT to Use" (adattate da pi-tasks, battle-tested)
- System prompt guidance: "DO NOT create tasks for operations completable in fewer than 3 tool calls"
- Auto-clear aggressivo (4 turni) per ridurre il clutter visivo
- Monitorare: ratio task_create/turni totali nei primi 30 giorni. Se > 0.5, tighten le guardrails
- Playbook tests con scenari "operazione banale → verifica che l'agente NON crea task"

### Rischio 8 — Token overhead dei task tools (da analisi pi-tasks)

**Problema**: 3 nuovi tool aggiungono ~600 token fissi al system prompt per turno. Ogni `task_create` costa ~200 token input + ~100 output. Per un workflow con 6 task: ~1800 token di management overhead.

**Mitigazione**:
- 3 tool (non 7 come pi-tasks) — il minimo necessario
- Descrizioni più compatte rispetto a pi-tasks (Bottega-specific, senza riferimenti a background processes o /tasks command)
- Il system-reminder injection è a costo zero quando non si attiva (extensionFactory condizionale)
- Per operazioni da 50k+ token (build-screen), il 3-5% di overhead è accettabile dato il valore di trasparenza e context resilience

---

## 7. Strategia di Test

La strategia di test è organizzata su 4 livelli, con test specifici per ogni fase del piano. I test crescono incrementalmente: ogni fase aggiunge test, non sostituisce quelli precedenti.

### 7.1 Unit Test (vitest) — Funzioni Pure e Logica Interna

I unit test coprono la logica interna senza dipendenze runtime. Le 8 funzioni di matching del lint sono il singolo set di unit test più critico.

#### Fase 0: Quick Wins

Nessun unit test nuovo — le modifiche sono solo testo nel system prompt.

#### Fase 5.5: Tool Surface Changes (i "mattoni")

| File | Cosa Testa | Criticità |
|---|---|---|
| `tests/unit/main/tools/lint-matching.test.ts` | 8 funzioni pure: `checkColors`, `checkSpacing`, `checkTypography`, `checkNaming`, `checkAutoLayout`, `checkDepthAndSizing`, `checkEffects`, `checkBoundVariables` | 🔴 Critico — queste funzioni sono il cuore del quality gate |
| `tests/unit/main/tools/setup-tokens-idempotent.test.ts` | Path create vs update: collection esiste → aggiorna, non esiste → crea. Variable esiste → aggiorna valore, non esiste → crea | 🔴 Critico |
| `tests/unit/main/tools/ds-page.test.ts` | Creazione pagina DS, trova/crea sezioni `[DS::*]`, parsing sezioni esistenti | 🟠 Alto |
| `tests/unit/main/tools/set-fills-bind-to.test.ts` | Parametro `bindTo` opzionale: senza → fill grezzo, con → fill + binding. Variabile non trovata → errore chiaro | 🟠 Alto |
| `tests/unit/main/tools/bind-variable-float.test.ts` | Binding proprietà FLOAT: padding, gap, cornerRadius, fontSize, lineHeight, strokeWeight. Proprietà non supportata → errore | 🟡 Medio |

Esempio test lint matching (funzione pura):
```typescript
describe('checkColors', () => {
  const palette = { primary: '#A259FF', error: '#FF3B30', bg: '#FFFFFF' };
  
  it('returns empty for colors in palette', () => {
    const fills = [{ color: '#A259FF', bound: true }];
    expect(checkColors(fills, palette)).toHaveLength(0);
  });
  
  it('detects color not in palette', () => {
    const fills = [{ color: '#A359FF', bound: false }];
    const issues = checkColors(fills, palette);
    expect(issues[0].nearest).toBe('primary=#A259FF');
  });
  
  it('flags unbound but correct value', () => {
    const fills = [{ color: '#A259FF', bound: false }];
    const issues = checkColors(fills, palette);
    expect(issues[0].type).toBe('unboundButCorrect');
  });
});
```

#### Fase 5.6: Compression Integration

| File | Cosa Testa |
|---|---|
| `tests/unit/main/compression/ds-tools-not-compressed.test.ts` | `figma_setup_tokens` e `figma_bind_variable` NON in `MUTATION_TOOLS`. Risultato mai compresso |
| `tests/unit/main/compression/ds-cache-extended.test.ts` | Cache include `rules`, `naming`, `dsStatus`. Mai compressi |

#### Fase 1: Core Workflow Runtime

| File | Cosa Testa | Criticità |
|---|---|---|
| `tests/unit/main/workflows/design-context.test.ts` | Context builder: dsStatus → interactionMode mapping. **State machine**: tutte e 10 le transizioni da §3.9 | 🔴 Critico |
| `tests/unit/main/workflows/intent-router.test.ts` | Keyword matching per ogni pack. Fallback neutro su input ambiguo. Contesto influenza selezione pack | 🔴 Critico |
| `tests/unit/main/workflows/registry.test.ts` | Tutti i packs registrati. `getPackById` funziona. Capabilities dichiarate sono valide | 🟡 Medio |
| `tests/unit/main/workflows/capabilities.test.ts` | Ogni capability ha promptFragment < 200 token. `forbidden` non conflicta con `preferred` nella stessa capability. Composizione di capabilities di un pack non produce conflitti | 🟠 Alto |

Esempio test state machine:
```typescript
describe('mode transitions', () => {
  it('session start: dsStatus=none → bootstrap', () => {
    const ctx = buildDesignWorkflowContext({
      userMessage: 'build a landing page',
      dsStatus: 'none', dsRecentlyModified: false
    });
    expect(ctx.interactionMode).toBe('bootstrap');
  });
  
  it('execution → socratic: new value not in DS', () => {
    const ctx = buildDesignWorkflowContext({
      userMessage: 'use #FF0000 for the error state',
      dsStatus: 'active', dsRecentlyModified: false,
      previousMode: 'execution'
    });
    expect(ctx.interactionMode).toBe('socratic');
  });
  
  it('any → freeform: user opts out', () => {
    const ctx = buildDesignWorkflowContext({
      userMessage: "I don't want a design system, just build it",
      dsStatus: 'none', dsRecentlyModified: false,
      previousMode: 'bootstrap'
    });
    expect(ctx.interactionMode).toBe('freeform');
  });
});
```

Esempio test capability composition:
```typescript
describe('capability composition', () => {
  it('build-screen capabilities compose without conflicts', () => {
    const pack = getPackById('build-screen');
    const caps = pack.capabilities.map(id => getCapabilityById(id));
    const allForbidden = caps.flatMap(c => c.toolGuidance.forbidden);
    const allPreferred = caps.flatMap(c => c.toolGuidance.preferred);
    // No tool should be both forbidden and preferred
    const conflicts = allPreferred.filter(t => allForbidden.includes(t));
    expect(conflicts).toHaveLength(0);
  });
  
  it('composed prompt fragments fit token budget', () => {
    const pack = getPackById('build-design-system');
    const caps = pack.capabilities.map(id => getCapabilityById(id));
    const totalPrompt = caps.map(c => c.promptFragment).join('\n');
    expect(estimateTokens(totalPrompt)).toBeLessThan(1500);
  });
});
```

#### Fase 2: System Prompt Decomposition

| File | Cosa Testa |
|---|---|
| (estensione test esistenti in `system-prompt.test.ts`) | `buildSystemPrompt(model, dsData)` produce DS block quando dsData presente. Omette DS block quando dsData assente. Token count totale entro budget (~600-1000 per DS) |

#### Fase 3.5: File Profile

| File | Cosa Testa |
|---|---|
| `tests/unit/main/workflows/file-profile.test.ts` | Schema validation. Convention detection da mock data. Context derivation dal profilo |

#### Fase 4: State Ledger

| File | Cosa Testa |
|---|---|
| `tests/unit/main/workflows/state-ledger.test.ts` | CRUD: create/read/update ledger. Persistenza su disco. Resume: ricostruzione da file scan. Idempotency: check-before-create. Cleanup: rimozione per run_id |

#### Fase 5: Validation Engine

| File | Cosa Testa |
|---|---|
| `tests/unit/main/workflows/validation-policy.test.ts` | Rule evaluation logic. Max screenshot loops (3). Capability-specific rules compongono correttamente. `afterMutation` vs `afterMilestone` trigger corretti |

---

### 7.2 Agent Playbook Tests (createBottegaTestSession)

I playbook test verificano il **comportamento end-to-end dell'agente** con tool mockati. Usano `when()`, `calls()`, `says()` con la DSL esistente.

#### Fase 0: Quick Wins — Gotchas nel Prompt

```
tests/unit/main/agent-prompt-gotchas.test.ts
```

Verificano che l'agente applichi i gotchas critici:

| Scenario | Cosa Verifica |
|---|---|
| "set the rectangle fill to red" | L'agente usa `{r: 1, g: 0, b: 0}`, non `{r: 255, g: 0, b: 0}` |
| "set text to Hello" | L'agente chiama `loadFontAsync` prima di settare il testo |
| "make this frame fill the parent" | L'agente setta `FILL` DOPO `appendChild` |
| "create a color variable for backgrounds" | L'agente setta scopi specifici, non `ALL_SCOPES` |

#### Fase 1: Workflow Activation e Mode Transitions

```
tests/unit/main/agent-workflow-activation.test.ts
tests/unit/main/agent-mode-transitions.test.ts
```

| Scenario | Trigger | Expected Pack | Expected Mode |
|---|---|---|---|
| "crea una landing page" | build keyword + screen context | `build-screen` | depends on dsStatus |
| "aggiorna il header" | update keyword | `update-screen` | `execution` |
| "imposta i token del progetto" | token/DS keyword | `build-design-system` | `socratic` |
| "controlla questa pagina" | check/audit keyword | `lint-and-review` | `review` |
| "fai un rettangolo blu" | no pack keyword | null (fallback) | `execution` |
| "crea un bottone" | ambiguous | null or `build-screen` low confidence | fallback |

#### Fase 3: Governance Invariants (6 test critici)

```
tests/unit/main/agent-ds-governance.test.ts
```

| # | Invariant | Playbook Scenario |
|---|---|---|
| 1 | No DS mutation without confirmation | Agent asked to add a color → verify `says()` before `calls(figma_setup_tokens)` |
| 2 | Both levels updated | After confirmed DS change → verify `calls(figma_setup_tokens)` AND `calls(figma_update_ds_page)` in sequence |
| 3 | forceRefresh after mutation | After DS tools → verify `calls(figma_design_system, {forceRefresh: true})` |
| 4 | Don't block on missing DS | dsStatus=none, user asks "build a card" → agent builds card, suggests DS separately |
| 5 | Review: lint first | User says "check this page" → verify `calls(figma_lint)` before `calls(figma_screenshot)` |
| 6 | Freeform: no DS enforcement | In freeform mode → agent creates elements without DS suggestions but uses correct color range |

Esempio playbook per invariant #2:
```typescript
test('governance: DS mutation updates both levels', async () => {
  const t = createBottegaTestSession({ /* with DS context */ });
  
  await t.run(
    when("add primary=#A259FF to the design system", [
      says("I'll add primary=#A259FF. Proceed?"),
    ]),
    when("yes", [
      calls("figma_setup_tokens", () => ({ 
        collectionName: "Color",
        variables: [{ name: "color/primary", value: "#A259FF" }]
      })),
      calls("figma_update_ds_page", () => ({
        section: "colors", action: "update"
      })),
      calls("figma_design_system", () => ({ forceRefresh: true })),
      says("Added primary to your Design System."),
    ])
  );
  
  const sequence = t.events.toolSequence();
  expect(sequence).toContain("figma_setup_tokens");
  expect(sequence).toContain("figma_update_ds_page");
  expect(sequence).toContain("figma_design_system");
  // setup_tokens must come before update_ds_page
  expect(sequence.indexOf("figma_setup_tokens"))
    .toBeLessThan(sequence.indexOf("figma_update_ds_page"));
});
```

#### Fase 3: Capability-Specific Behaviors

```
tests/unit/main/agent-ds-capabilities.test.ts
```

| Capability | Scenario | Verifica |
|---|---|---|
| `ds-read` | Agent starts on file with DS | `figma_design_system` called in first turn |
| `ds-read` | Agent starts on file without DS | Agent suggests bootstrap |
| `component-reuse` | "create a button" | `figma_search_components` called BEFORE any creation tool |
| `component-reuse` | component found | `figma_instantiate` used, NOT `figma_create_child` |
| `component-reuse` | text in component instance | `figma_set_instance_properties` used, NOT `figma_set_text` |
| `ds-proactive` | color not in DS used | Agent asks "should I add this to the DS?" |
| `visual-validation` | section built | `figma_get_file_data` (structural) called, then `figma_screenshot` (visual) at milestone |
| `visual-validation` | 3 screenshot loops | Agent stops looping after 3 fix attempts |

#### Fase 3: Workflow-Specific Flows

```
tests/unit/main/agent-build-screen.test.ts
tests/unit/main/agent-update-screen.test.ts
tests/unit/main/agent-build-ds.test.ts
```

Per `build-screen`:
1. Activation → discovery (figma_design_system) → plan proposal → checkpoint
2. User confirms → build section 1 → structural validate → build section 2 → visual validate
3. Final screenshot → max 3 fix loops

Per `update-screen`:
1. Activation → read selection/target → inspect structure
2. Diff proposal → checkpoint ("Here's what I'll change")
3. User confirms → minimal mutations → visual validate

Per `build-design-system`:
1. Phase 0: discovery (figma_design_system + file inspection) → plan → checkpoint
2. Phase 1: figma_setup_tokens (idempotent) → structural validate → checkpoint
3. Phase 2: figma_update_ds_page (sections) → visual validate → checkpoint
4. Phase 3: per-component creation → visual validate → per-component checkpoint

#### Fase 4: State Ledger e Resume

```
tests/unit/main/agent-state-resume.test.ts
```

| Scenario | Verifica |
|---|---|
| Long workflow interrupted | Ledger file written with phase/step/entityIds |
| Resumed after interruption | Agent reads ledger, skips completed steps |
| Cleanup after failed step | Only nodes with matching `run_id` removed, user nodes intact |

---

### 7.3 Playwright Tests (E2E con Figma reale)

Playwright test sono lenti e costosi. Riservati a scenari critici end-to-end con Figma Desktop reale.

#### Fase 5.5: Tool DS con Figma Reale

```
tests/e2e/ds-tools.spec.ts
```

| Test | Cosa Verifica | Tag |
|---|---|---|
| `setup_tokens creates variables` | Chiama figma_setup_tokens → variabili esistono in Figma → ri-chiama → nessun duplicato (idempotent) | @smoke |
| `update_ds_page creates page` | Chiama figma_update_ds_page → pagina "Design System" esiste con sezione `[DS::colors]` | @smoke |
| `set_fills with bindTo` | Chiama figma_set_fills con bindTo → nodo ha fill bound alla variabile | @ds |
| `bind_variable FLOAT` | Chiama figma_bind_variable per paddingTop → proprietà legata alla variabile | @ds |
| `figma_lint structured report` | Crea frame con issues note → chiama figma_lint → report ha 3 sezioni, issues rilevate | @ds |
| `design_system reads DS page` | File con pagina DS → figma_design_system restituisce rules e naming | @ds |

#### Fase 2+3: DS nel Prompt e Workflow E2E

```
tests/e2e/ds-workflow.spec.ts
```

| Test | Cosa Verifica | Tag |
|---|---|---|
| `DS block in agent context` | File con variabili → DS block presente nel primo turno dell'agente | @smoke |
| `dsStatus hint in screenshot` | Chiama figma_screenshot → risultato contiene `dsStatus` | @smoke |
| `build-screen e2e` | Prompt "build a hero section" → agente crea sezione in Figma reale | @agent |
| `build-ds e2e` | Prompt "setup design tokens" → agente crea variabili + pagina DS | @agent |
| `file profile persisted` | Connetti a file → profilo persistito → ri-connetti → profilo letto | @agent |

#### Test Tag e Quando Eseguirli

| Tag | Quando | Tempo Stimato |
|---|---|---|
| `@smoke` | Ogni PR, CI | ~2 min |
| `@ds` | PR che toccano tool DS o compression | ~5 min |
| `@agent` | Release candidate, manual trigger | ~15 min |

---

### 7.4 Regression Strategy

Dopo ogni fase, ri-eseguire i 12 scenari benchmark (Fase 0.5). La regola è semplice:

| Fase Completata | Scenari da Ri-Eseguire | Metriche da Confrontare |
|---|---|---|
| 0 (quick wins) | Tutti i 12 | Errori/retry (dovrebbero scendere per gotchas) |
| 5.5 (tool changes) | #6, #7, #12 (DS-heavy) | Tool call count, errori |
| 1 (engine) | Tutti i 12 | Nessuna regressione (engine non deve peggiorare nulla) |
| 3 (packs) | Tutti i 12 | Retry -30% su build-screen e update-screen |
| 4 (ledger) | #6, #7 (long workflows) | Resume funzionante |

**Regola di non-regressione**: NESSUN scenario può peggiorare rispetto al benchmark v0. Se peggiora, la fase non è completa — fix prima di procedere.

---

### 7.5 UAT Manuale

Checklist per ogni fase:

- [ ] Workflow attivati correttamente per trigger keywords
- [ ] Nessun prompt bloat evidente (verificare token count)
- [ ] Mutazioni sempre serializzate via OperationQueue
- [ ] Screenshot/fix loop entro il limite (max 3)
- [ ] Task semplici non degradati dal workflow engine
- [ ] State ledger correttamente salvato e ripreso
- [ ] Governance invariants rispettate (DS changes → both levels + forceRefresh)
- [ ] Mode transitions corrette (verificare con prompt che cambiano intento)
- [ ] In freeform mode: zero suggerimenti DS, gotchas ancora attivi

---

### 7.6 Test File Summary

| Tipo | File Count | Fase | Focus |
|---|---|---|---|
| **Unit (vitest)** | 17 file | 1-5.6 | Funzioni pure, logica interna, schema validation |
| **Playbook** | 10 file | 0-4 | Comportamento agente, governance, capability, workflow flow |
| **Playwright** | 2 file | 5.5, 2+3 | Figma reale, tool DS end-to-end, workflow e2e |
| **Totale** | **29 file** | | |

---

## 8. Criteri di Successo

v1 è riuscita se:

1. **Attivazione corretta**: Bottega attiva il workflow pack giusto per i task target (precision > 90%)
2. **System prompt ridotto**: -40% token rispetto a oggi, senza perdita di robustezza
3. **Meno retry**: `build-screen` e `update-screen` mostrano -30% retry rispetto al benchmark
4. **Resume funzionante**: workflow multi-turno possono essere ripresi senza dipendere dal contesto modello
5. **Serializzazione preservata**: le mutazioni restano SEMPRE sequenziali via OperationQueue
6. **Validazione coerente**: il judge harness usa criteri dal workflow pack attivo
7. **Nessuna regressione**: i 12 scenari benchmark non peggiorano
8. **First Contact utile**: in file con `dsStatus = none|partial`, l'agente propone bootstrap o completamento entro i primi 2 turni senza bloccare il task richiesto
9. **Governance DS rispettata**: il 100% delle mutazioni DS confermate aggiorna sia variabili sia pagina DS, seguito da `forceRefresh`
10. **Capability reuse reale**: `build-screen` e `update-screen` condividono lo stesso layer `ds-read` / `ds-lint` senza duplicare logica o prompt

---

## Appendice A: Catalogo Completo Gotchas Plugin API

Estratti dall'analisi di `mcp-server-guide/skills/figma-use/references/gotchas.md` e file correlati. Ogni gotcha include il pattern WRONG e CORRECT per facilitare l'integrazione nel system prompt.

### A.1 — Colori e Paint

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 1 | Colori sono range 0-1, non 0-255 | `{r: 255, g: 0, b: 0}` | `{r: 1, g: 0, b: 0}` |
| 2 | Fills/strokes sono array immutabili | `node.fills[0].color = ...` | Clone → modifica → `node.fills = [newFill]` |
| 3 | `setBoundVariableForPaint` ritorna NUOVO paint | `setBound...(paint, ...)` poi `node.fills = [paint]` | `const bound = setBound...(paint, ...); node.fills = [bound]` |
| 4 | Solo SOLID paint supporta variable binding | Binding su gradient paint | Usare solo `type: 'SOLID'` |
| 5 | Binding su nodi con fills vuoti non funziona | `comp.fills = []; setBound...(...)` | Aggiungere placeholder SOLID fill prima di binding |
| 6 | COLOR variable values hanno alpha | `{r: 1, g: 0, b: 0}` per variabile | `{r: 1, g: 0, b: 0, a: 1}` per variabile |

### A.2 — Layout e Sizing

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 7 | `FILL` deve essere dopo `appendChild` | `child.layoutSizing = 'FILL'; parent.appendChild(child)` | `parent.appendChild(child); child.layoutSizing = 'FILL'` |
| 8 | `resize()` resetta sizing modes a FIXED | `frame.layoutSizingVertical = 'HUG'; frame.resize(300, 1)` | `frame.resize(300, 40); frame.layoutSizingVertical = 'HUG'` |
| 9 | HUG parents collassano FILL children | Parent HUG + child FILL → child collassa | Parent FIXED o FILL + child FILL |
| 10 | `counterAxisAlignItems` non supporta 'STRETCH' | `comp.counterAxisAlignItems = 'STRETCH'` | `comp.counterAxisAlignItems = 'MIN'` + child `layoutSizing = 'FILL'` |
| 11 | `layoutGrow` con parent HUG causa compressione | `parent.primaryAxisSizingMode = 'AUTO'; content.layoutGrow = 1` | `content.layoutGrow = 0` oppure parent FIXED |
| 12 | Nodi nuovi a (0,0) | Creare nodo senza posizionamento | Scan `maxX` dei children esistenti, posizionare con offset |
| 13 | Posizioni non si resettano dopo reparenting | `section.appendChild(node)` — node mantiene x/y vecchi | Reset esplicito `node.x = 80; node.y = 80` dopo reparenting |

### A.3 — Testo e Font

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 14 | Font DEVE essere caricato prima di operazioni text | `text.characters = "Hello"` senza loadFont | `await figma.loadFontAsync({family, style}); text.characters = "Hello"` |
| 15 | Font style names sono file-dependent | `loadFontAsync({family: "Inter", style: "SemiBold"})` | `listAvailableFontsAsync()` → trova style esatto → load |
| 16 | `lineHeight`/`letterSpacing` devono essere oggetti | `style.lineHeight = 1.5` | `style.lineHeight = {value: 24, unit: "PIXELS"}` |
| 17 | `TextStyle.setBoundVariable` non disponibile in use_figma | `ts.setBoundVariable("fontSize", var)` | Settare valori raw; bind manualmente in Figma |
| 18 | `fontSize`, `fontWeight`, `lineHeight` non bindabili via `setBoundVariable` su nodi | `node.setBoundVariable("fontSize", var)` | Settare direttamente `node.fontSize = 16` |
| 19 | Override testo in component instance | `node.characters = "text"` su testo gestito da property | `instance.setProperties({"Label#2:0": "text"})` |

### A.4 — Componenti e Varianti

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 20 | `addComponentProperty` ritorna STRING key | `comp.addComponentProperty('label', 'TEXT', '...'); ref = {characters: 'label#0:1'}` | `const key = comp.addComponentProperty(...); ref = {characters: key}` |
| 21 | `combineAsVariants` richiede ComponentNodes | `figma.combineAsVariants([frame], page)` | `figma.combineAsVariants([component], page)` |
| 22 | `combineAsVariants` non fa auto-layout | Varianti tutte sovrapposte a (0,0) | Layout manuale in griglia + `resizeWithoutConstraints` da bounds reali |
| 23 | `detachInstance()` invalida ID antenati | Usare `parentId` cached dopo detach | Re-scoprire nodi per traversal da frame stabile |

### A.5 — Pagine e Lifecycle

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 24 | `figma.currentPage = page` NON funziona | `figma.currentPage = targetPage` (throws) | `await figma.setCurrentPageAsync(targetPage)` |
| 25 | Page context resetta tra chiamate | Assumere di essere sulla pagina giusta | `setCurrentPageAsync` all'inizio di ogni call |
| 26 | `figma.notify()` throws | `figma.notify("Done!")` | `return "Done!"` |
| 27 | `getPluginData`/`setPluginData` non supportati | `node.setPluginData(...)` | `node.setSharedPluginData('namespace', ...)` |
| 28 | `console.log()` non ritornato | `console.log("debug")` | `return { debug: "..." }` |
| 29 | Deve sempre ritornare un valore | Nessun return | `return { nodeId: rect.id }` |
| 30 | Deve ritornare TUTTI gli ID creati/mutati | `return { nodeId: frame.id }` (perde children) | `return { createdNodeIds: [frame.id, rect.id, text.id] }` |

### A.6 — Variabili e Token

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 31 | Scopes default `ALL_SCOPES` — mai usare | Non settare scopes | `variable.scopes = ["FRAME_FILL", "SHAPE_FILL"]` |
| 32 | Mode names devono essere descrittivi | Lasciare "Mode 1" | `collection.renameMode(modeId, "Light")` |
| 33 | Collection inizia con 1 mode | `collection.addMode("Light")` (ne crea 2) | Rinominare la prima, poi aggiungere le altre |
| 34 | Mode limits dipendono dal piano | Creare 20 modes su Professional (max 4) | Verificare piano; se necessario, splittare collection |
| 35 | Explicit mode deve essere settato per componente | Tutti i componenti mostrano default mode | `comp.setExplicitVariableModeForCollection(coll, modeId)` |
| 36 | CSS variable names non devono contenere spazi | `var(--color bg primary)` | `var(--color-bg-primary)` — replace slashes E spazi |
| 37 | `setBoundVariableForEffect` ritorna NUOVO effect | Ignorare return value | `const newEffect = setBound...; node.effects = [newEffect]` |

### A.7 — Altre

| # | Gotcha | WRONG | CORRECT |
|---|---|---|---|
| 38 | Sezioni non auto-resizano | `section.appendChild(node)` — content overflow | `section.resizeWithoutConstraints(width + padding, height + padding)` |
| 39 | Grid con righe a larghezza mista causa overlap | Offset colonna fisso per righe diverse | Calcolare spacing per riga in base a larghezza reale dei children |
| 40 | `get_metadata` vede solo una pagina | Aspettarsi tutti i pages da get_metadata | Usare `figma_execute` per listare tutte le pagine |

---

## Appendice B: Plugin API Capabilities Mancanti in Bottega

| # | API | Scopo | Priorità |
|---|---|---|---|
| 1 | `figma.createNodeFromJSXAsync(jsx)` | JSX nativo → Node (potrebbe semplificare pipeline Bottega) | 🔴 Da investigare |
| 2 | `setBoundVariableForEffect(effect, field, var)` | Bind variabili a proprietà effetti | 🟠 Alta |
| 3 | `setBoundVariableForLayoutGrid(grid, field, var)` | Bind variabili a layout grid | 🟡 Media |
| 4 | `importStyleByKeyAsync(key)` | Import stili da team libraries | 🟠 Alta |
| 5 | `setFillStyleIdAsync(id)` | Applicare paint style importato | 🟡 Media |
| 6 | `setTextStyleIdAsync(id)` | Applicare text style importato | 🟡 Media |
| 7 | `setEffectStyleIdAsync(id)` | Applicare effect style importato | 🟡 Media |
| 8 | `figma.util.solidPaint(hex, opacity?)` | Utility per creare paint da hex | 🟢 Bassa |
| 9 | `figma.util.loadImageAsync(url)` | Load image da URL direttamente | 🟡 Media |
| 10 | `findAllWithCriteria({types})` | Ricerca tipizzata di nodi (più efficiente) | 🟢 Bassa |
| 11 | `createTable(rows, cols)` | Creazione tabelle native | 🟡 Media |
| 12 | `node.rescale(scale)` | Scaling proporzionale | 🟢 Bassa |
| 13 | `saveVersionHistoryAsync(title)` | Creare checkpoint nella version history | 🟡 Media |
| 14 | `importVariableByKeyAsync(key)` | Import variabili da team libraries | 🟠 Alta |
| 15 | `search_design_system` (remote MCP) | Ricerca cross-libreria | 🟠 Alta (richiede bridge remoto) |

---

## Appendice C: Script Template per promptSnippets

Dall'analisi di `mcp-server-guide/skills/figma-use/references/common-patterns.md`, questi script sono candidati per diventare `promptSnippet` nei tool di Bottega:

### C.1 — Inspect File Structure

```javascript
const pages = figma.root.children.map(p =>
  `${p.name} id=${p.id} children=${p.children.length}`
);
return pages.join('\n');
```

### C.2 — List Components Across All Pages

```javascript
const results = [];
for (const page of figma.root.children) {
  await figma.setCurrentPageAsync(page);
  page.findAll(n => {
    if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET')
      results.push(`[${page.name}] ${n.name} (${n.type}) id=${n.id}`);
    return false;
  });
}
return results.join('\n');
```

### C.3 — List Variable Collections

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
return collections.map(c => ({
  name: c.name, id: c.id,
  varCount: c.variableIds.length,
  modes: c.modes.map(m => m.name)
}));
```

### C.4 — Discover Bound Variables in Existing Screen

```javascript
const frame = figma.currentPage.findOne(n => n.name === "TARGET_FRAME");
const varMap = new Map();
frame.findAll(() => true).forEach(node => {
  const bv = node.boundVariables;
  if (!bv) return;
  for (const [prop, binding] of Object.entries(bv)) {
    const bindings = Array.isArray(binding) ? binding : [binding];
    for (const b of bindings) {
      if (b?.id && !varMap.has(b.id)) {
        const v = figma.variables.getVariableByIdAsync(b.id);
        if (v) varMap.set(b.id, { name: v.name, id: v.id, key: v.key });
      }
    }
  }
});
return [...varMap.values()];
```

### C.5 — Component Metadata Deep Traversal

```javascript
function getComponentProps(node) {
  const result = {};
  for (let key in node.componentPropertyDefinitions) {
    const prop = {
      name: key.replace(/#[^#]+$/, ""),
      type: node.componentPropertyDefinitions[key].type,
      key: key
    };
    if (prop.type === "VARIANT")
      prop.variantOptions = node.componentPropertyDefinitions[key].variantOptions;
    result[key] = prop;
  }
  return result;
}
// ... (full collectDescendants function from component-patterns.md)
```

---

## Appendice D: Mapping Completo MCP Guide Skills → Bottega Workflow Packs

| MCP Skill | Bottega Equivalent | Note |
|---|---|---|
| `figma-use` | Gotchas nel system prompt + reference `figma-execute-safety.md` | Bottega ha tool tipizzati, non un generico `use_figma` |
| `figma-generate-design` | Workflow pack `build-screen` | Adattato al modello per-sezione |
| `figma-generate-library` | Workflow pack `build-design-system` | Il più complesso, con state ledger obbligatorio |
| `figma-implement-design` | Non direttamente — Bottega opera SU Figma, non genera code DA Figma | Potenziale futuro con Code Connect |
| `figma-code-connect` | Fase 6: Code Connect Integration | Template .figma.js, mapping bidirezionale |
| `figma-create-new-file` | Non necessario — Bottega opera su file già aperti | Il bridge Bottega è scoped per file |
| `figma-create-design-system-rules` | File Profile Persistence (Fase 3.5) | Bottega genera profilo strutturato, non regole markdown |

---

## Appendice E: Design System — Decisioni Registrate

Le 35 decisioni di design per il layer DS sono documentate in **PLAN-DESIGN-WORKFLOW.md v3.4, Sezione 10**. Qui le più impattanti per il Workflow Engine:

| # | Decisione | Impatto su Workflow Engine |
|---|---|---|
| D1 | **Figma è la source of truth** — variabili + pagina DS, niente filesystem | Il state ledger traccia solo progresso workflow, mai valori DS |
| D3 | **Tool dedicati per DS** — niente `figma_execute` | Reference docs devono escludere esplicitamente `figma_execute` per operazioni DS |
| D4 | **`figma_setup_tokens` idempotente** | Lo state ledger può fare retry sicuri — il tool non duplica |
| D5 | **`figma_update_ds_page` come tool nuovo** | Workflow pack `build-design-system` lo include nei mandatory steps |
| D6 | **`figma_lint` unifica DS + auto-layout + lint nativo** | La validation-policy.ts delega i check DS a `figma_lint`, non implementa i propri |
| D7 | **DS compresso nel prompt, mai troncato** | Il budget token del prompt cresce di ~600-1000 token — da contabilizzare |
| D14 | **Proattività bidirezionale** | L'extension factory deve poter suggerire aggiunte al DS anche fuori dai workflow pack |
| D21 | **Shadows via Effect Styles** | Reference doc `variable-binding.md` deve documentare che shadow != variable |
| D23 | **Lint a due componenti** (walk plugin + matching Electron) | La validation engine usa le stesse funzioni pure di matching, non ne crea di nuove |
| D27 | **Nessuna compressione su tool DS critici** | Fase 5.6 esplicita — i tool DS restituiscono risultato completo |
| D29 | **`readDesignSystem()` condivisa** | Fase 3.5 (file profile) usa la stessa funzione — nessuna duplicazione |
| D32 | **`bindTo` su set_fills/set_strokes** | Reference doc `component-reuse.md` deve documentare questo pattern, non `figma_bind_variable` per colori |

Per il registro completo con alternative valutate e razionale: vedi PLAN-DESIGN-WORKFLOW.md Sezione 10.

---

## Appendice F: Stima Effort Complessiva

### Ordine di Esecuzione Effettivo ("Bricks Before Engine")

| # | Fase | Descrizione | Effort | Righe stimate |
|---|---|---|---|---|
| 1 | 0 | Quick Wins (system prompt + descriptions) | 1-2 giorni | ~200 |
| 2 | 0.5 | Benchmark | 1-2 giorni | ~100 |
| 3 | 5.5 + 5.6 | **Tool modifications + Compression** (i "mattoni") | ~2 settimane | ~1250 |
| 4 | 1 | Core Workflow Runtime (types, registry, context, router, factory) | 1 settimana | ~500 |
| 5 | 2 | System Prompt Decomposition + DS block | 3-5 giorni | ~400 |
| 6 | 3 + 3.5 | V1 Workflow Packs + File Profile | 2 settimane | ~900 |
| 7 | 4 | State Ledger + Resume | 1 settimana | ~400 |
| 8 | 5 | Validation Engine (built on figma_lint) | 3-5 giorni | ~300 |
| | | **Totale v1 (fasi 1-8)** | **~8-10 settimane** | **~4050** |
| 9 | 6 | Code Connect Integration | 1-2 settimane | ~400 |
| 10 | 7 | V2 Packs (lint-and-review, image-story, componentize) | ongoing | ~300+ per pack |

> **Razionale del sequencing** (dall'analisi Gemini): non puoi testare un workflow pack se i tool sottostanti non sono ancora modificati. I "mattoni" (tool DS idempotenti, bindTo, figma_lint, compression) devono essere costruiti prima di accendere il "motore" (workflow engine). Le quick wins (Fase 0) vengono prima di tutto perché richiedono zero modifiche al codice dei tool — sono solo testo nel system prompt.
