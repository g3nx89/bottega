# Piano Operativo — Workflow Skills e Orchestrazione Runtime

> Stato: DRAFT
> Data: 2026-04-01
> Obiettivo: introdurre in Bottega un layer di orchestrazione task-specifica ispirato al pack ufficiale Figma, adattato al runtime desktop di Bottega e ai suoi contratti reali.

---

## Introduzione

L'analisi di `../forks/mcp-server-guide` ha chiarito un punto importante: quel repository **non contiene il codice del server MCP di Figma**, ma il suo **companion pack ufficiale**. È una distribution composta da:

- manifest MCP e packaging cross-client
- plugin metadata per Cursor, Claude Code, Gemini CLI
- power/steering per il routing dei workflow
- skill task-specifiche
- reference docs caricabili on demand
- helper script riusabili

Il valore principale del progetto non è quindi il transport HTTP o il backend remoto, ma il modo in cui Figma ha spezzato la conoscenza operativa in strati distinti:

1. manifest e packaging
2. steering per intenti
3. workflow skill specializzate
4. reference modulari
5. helper script riusabili

Il repo Figma è particolarmente forte in tre aree:

- **decomposizione del prompting**: l'intelligenza non sta in un solo system prompt, ma in skill mirate
- **progressive disclosure**: si carica solo la reference necessaria per il task corrente
- **governo dei workflow lunghi**: checkpoint, idempotenza, recovery, ledger di stato, validazione strutturale e visiva

Bottega, al contrario, oggi è più forte come **prodotto eseguibile**:

- bridge desktop e connector scoped per file
- 49 tool già disponibili
- queue manager per serializzare le mutazioni
- compression runtime
- subagent read-only
- image generation integrata
- app desktop già pronta all'uso

Il punto debole di Bottega, rispetto al pack Figma, è il layer di **workflow knowledge**. Oggi la maggior parte dell'orchestrazione vive in:

- il system prompt monolitico in `src/main/system-prompt.ts`
- le `description` / `promptSnippet` dei tool
- skill locali in `.claude/skills/`, ma orientate quasi tutte alla manutenzione del repo e non ai workflow utente dentro Figma

In runtime, inoltre, Bottega crea la sessione con `noSkills: true`, `noExtensions: true` e `noPromptTemplates: true` in `src/main/agent.ts`, lasciando attiva solo la compression extension factory. Questo rende il comportamento più controllato, ma impedisce al prodotto di beneficiare di un vero layer di skill/workflow runtime.

La conclusione chiave è questa:

- **Bottega non deve copiare il repo Figma letteralmente**
- **Bottega deve importarne il modello operativo**

Ci sono infatti differenze reali di contratto che impediscono un copia-incolla:

- il pack Figma per `use_figma` prescrive top-level `await` e vieta async IIFE
- Bottega per `figma_execute` oggi documenta esplicitamente outer-return + async IIFE
- il pack Figma contiene anche almeno una incoerenza interna: la documentazione vieta `getPluginData/setPluginData`, ma diversi helper script continuano a usarli

Questa incoerenza è utile come promemoria progettuale: il pack Figma è una **fonte eccellente di pattern**, non una base eseguibile da importare senza adattamento.

L'obiettivo di questo piano è quindi costruire in Bottega un layer di **workflow packs runtime**, fortemente controllato, testabile e aderente al comportamento reale dei tool del prodotto.

---

## 1. Obiettivi

1. Ridurre la dipendenza da un system prompt monolitico.
2. Introdurre workflow task-specifici per i casi d'uso ad alto valore.
3. Rendere i task multi-step più coerenti, ripetibili e recuperabili.
4. Persistre stato, checkpoint e validazioni per workflow lunghi.
5. Riutilizzare l'attuale tool surface di Bottega prima di introdurre nuovi tool.
6. Mantenere il runtime deterministico e controllato, senza discovery arbitraria di skill da filesystem in v1.

---

## 2. Non-Obiettivi

1. Reimplementare il server MCP remoto di Figma.
2. Abilitare in v1 il caricamento arbitrario di skill utente dal filesystem.
3. Copiare 1:1 le skill del repo Figma senza adattamento semantico.
4. Spostare operazioni critiche fuori dal modello di serializzazione già garantito da `OperationQueue`.
5. Parallelizzare mutazioni Figma.

---

## 3. Decisioni Guida

### 3.1 Runtime controllato

In v1 Bottega **non** abilita la discovery generica di skill runtime. Manteniamo il principio attuale:

- nessuna discovery ambientale da `cwd`
- nessuna dipendenza da file locali dell'utente
- nessuna variabilità opaca tra installazioni

Le nuove skill saranno **bundled inside the app**.

### 3.2 Workflow packs, non skill generiche

Il layer nuovo non sarà un clone delle `.claude/skills/` attuali. Sarà un sistema di **workflow packs** interni:

- tipizzati
- selezionati per intento
- con reference modulari
- con regole di validazione
- con supporto a resume e checkpoint

### 3.3 Adattamento ai contratti reali di Bottega

Ogni workflow pack dovrà parlare il linguaggio dei tool reali di Bottega:

- `figma_execute` con il contratto documentato da Bottega
- `OperationQueue` come barriera obbligatoria per mutazioni
- `ScopedConnector` e file scoping reale
- `figma_screenshot` / discovery / component tools già esistenti

### 3.4 Read parallel, write sequential

I subagent esistenti possono essere usati per:

- discovery
- analisi
- confronto alternative
- audit

Non possono essere usati per mutazioni concorrenti.

### 3.5 Stato esplicito per lavori lunghi

Per workflow lunghi o multi-turno introdurremo un **ledger di stato** per sessione/file:

- intent risolto
- fase corrente
- nodi creati/aggiornati
- screenshot di riferimento
- validazioni pending
- checkpoint utente

---

## 4. Architettura Target

### 4.1 Nuovi moduli

Proposta di nuova area:

```text
src/main/workflows/
├── types.ts
├── registry.ts
├── intent-router.ts
├── extension-factory.ts
├── state-ledger.ts
├── validation-policy.ts
├── references/
│   ├── figma-execute-safety.md
│   ├── design-system-discovery.md
│   ├── visual-validation.md
│   └── component-reuse.md
└── packs/
    ├── build-screen.ts
    ├── update-screen.ts
    ├── build-design-system.ts
    ├── componentize-pattern.ts
    ├── token-audit.ts
    └── image-story.ts
```

### 4.2 Flusso runtime

```text
Prompt utente
→ intent-router
→ selezione workflow pack
→ workflow extension factory
→ augment del system prompt per il solo task corrente
→ tool selection/execution
→ validation policy
→ state ledger update
→ eventuale checkpoint / resume
```

### 4.3 Integrazione con il runtime attuale

File primari da toccare:

- `src/main/agent.ts`
- `src/main/system-prompt.ts`
- `src/main/tools/index.ts`
- `src/main/session-store.ts`
- `src/main/app-state-persistence.ts`
- `src/main/subagent/orchestrator.ts`

Direzione:

- alleggerire `system-prompt.ts` lasciando solo regole universali
- introdurre una `workflow extension factory` accanto alla compression extension
- mantenere `noSkills: true` in v1, ma aggiungere injection runtime interna tramite `extensionFactories`

---

## 5. Workflow Packs V1

### 5.1 `build-screen`

Trigger:

- "crea una schermata"
- "trasforma questo brief in UI"
- "costruisci questa pagina in Figma"

Flusso minimo:

1. `figma_status`
2. discovery del contesto corrente
3. ricerca componenti e tokens esistenti
4. costruzione per sezioni
5. screenshot finale
6. massimo 3 cicli fix/screenshot

### 5.2 `update-screen`

Trigger:

- "aggiorna questa schermata"
- "allinea questo frame"
- "rifai hero/header/card"

Flusso minimo:

1. lettura selezione o target node
2. ispezione struttura esistente
3. diff logico con intento utente
4. mutazioni minimali
5. validazione visiva

### 5.3 `build-design-system`

Trigger:

- "imposta tokens"
- "costruisci libreria"
- "organizza componenti e varianti"

Flusso minimo:

1. discovery di naming, componenti, variabili, stili esistenti
2. definizione scope con checkpoint
3. foundations prima dei componenti
4. un componente per volta
5. checkpoint per ogni fase
6. ledger e resume obbligatori

### 5.4 `componentize-pattern`

Trigger:

- "questo pattern si ripete"
- "trasformalo in component"
- "crea variants"

Flusso minimo:

1. ispezione delle istanze/pattern ripetuti
2. proposta di API del componente
3. creazione componente base
4. varianti
5. arrangiamento / naming / validazione

### 5.5 `token-audit`

Trigger:

- "controlla consistenza"
- "audit design system"
- "trova hardcoded values"

Flusso minimo:

1. scan layout/style/token usage
2. rilevazione problemi
3. classificazione per severità
4. suggerimenti fix

### 5.6 `image-story`

Trigger:

- workflow multi-frame con gli image-gen tools
- storyboard
- tutorial per step
- flussi visuali narrativi

Scopo:

trasformare gli image-gen tools da toolbox isolata a workflow composito riusabile.

---

## 6. Piano di Implementazione

### Fase 0 — Baseline e Benchmark

Obiettivo:

misurare il comportamento attuale prima di cambiare l'orchestrazione.

Attività:

- definire 8-12 scenari canonici
- eseguire gli scenari con l'orchestrazione attuale
- registrare:
  - numero medio di tool call
  - numero di screenshot
  - errori/retry
  - qualità finale percepita

Output:

- benchmark v0
- set di regression scenarios per i test agent-level

### Fase 1 — Core Runtime dei Workflow Packs

Obiettivo:

creare il framework minimo per selezionare e iniettare workflow packs.

Attività:

- aggiungere `src/main/workflows/types.ts`
- aggiungere `registry.ts` e `intent-router.ts`
- aggiungere `extension-factory.ts`
- integrare la nuova factory in `src/main/agent.ts`
- introdurre un formato typed per:
  - trigger
  - goals
  - mandatory steps
  - validation rules
  - reference fragments

Exit criteria:

- un prompt può attivare un workflow pack
- il pack aggiunge istruzioni solo per quel turno/sessione
- nessuna regressione sui prompt fuori scope

### Fase 2 — Riduzione del System Prompt Monolitico

Obiettivo:

spostare i dettagli task-specifici fuori da `src/main/system-prompt.ts`.

Attività:

- lasciare nel system prompt:
  - regole universali
  - safety di alto livello
  - tool selection base
- spostare in references modulari:
  - best practice `figma_execute`
  - visual validation policy
  - design system discovery patterns
  - component reuse rules

Exit criteria:

- il system prompt si accorcia in modo sensibile
- i pack ricostruiscono il contesto solo quando serve

### Fase 3 — Workflow Packs V1

Obiettivo:

implementare i tre workflow a più alto impatto:

1. `build-screen`
2. `update-screen`
3. `build-design-system`

Attività:

- codificare trigger e mandatory steps
- definire policy di validazione specifiche
- usare subagent solo per discovery opzionale
- aggiungere osservabilità sugli activation events

Exit criteria:

- i tre workflow si attivano in modo affidabile
- gli scenari benchmark mostrano meno retry e più coerenza

### Fase 4 — State Ledger e Resume

Obiettivo:

rendere robusti i workflow multi-turno.

Attività:

- introdurre `state-ledger.ts`
- persist per sessione/file in app state
- tracciare:
  - workflow id
  - fase
  - node ids
  - pending validations
  - last screenshot references
  - user checkpoint status

Exit criteria:

- un workflow lungo può essere ripreso dopo restart o model switch
- il resume non dipende solo dalla memoria del modello

### Fase 5 — Validation Engine

Obiettivo:

formalizzare cosa significa "task finito bene".

Attività:

- creare `validation-policy.ts`
- introdurre policy tipo:
  - mutazione → screenshot obbligatorio
  - no duplicate creation
  - discovery before create
  - component reuse before primitive recreation
  - max screenshot loops

Exit criteria:

- i workflow V1 usano policy comuni
- la validazione diventa testabile

### Fase 6 — Workflow Packs V2

Obiettivo:

estendere il sistema a casi più specifici.

Candidati:

- `componentize-pattern`
- `token-audit`
- `image-story`
- `annotation-review`

---

## 7. Strategia di Test

### 7.1 Unit test

Nuovi target:

- `tests/unit/main/workflows/intent-router.test.ts`
- `tests/unit/main/workflows/registry.test.ts`
- `tests/unit/main/workflows/state-ledger.test.ts`
- `tests/unit/main/workflows/validation-policy.test.ts`

### 7.2 Agent playbook tests

Usare l'harness già esistente per testare:

- attivazione workflow corretta
- injection del pack giusto
- enforcement delle validation policy
- assenza di attivazione su prompt non pertinenti

### 7.3 Integration tests

Scenari:

- build screen from brief
- update selected frame
- bootstrap design system
- resume dopo interruzione

### 7.4 UAT manuale

Checklist:

- workflow attivati correttamente
- nessun prompt bloat evidente
- mutazioni sempre serializzate
- screenshot/fix loop entro il limite

---

## 8. Rischi e Mitigazioni

### Rischio 1 — Prompt bloat travestito da modularità

Problema:

se iniettiamo troppi pack o troppa reference, ricreiamo lo stesso problema del system prompt monolitico.

Mitigazione:

- un solo workflow pack primario per task
- reference modulari e corte
- injection lazy, mai eager

### Rischio 2 — Misclassificazione dell'intento

Problema:

il router può scegliere il workflow sbagliato.

Mitigazione:

- euristiche deterministic-first
- fallback neutro quando la confidence è bassa
- logging delle attivazioni per migliorare il router

### Rischio 3 — Drift tra doc e comportamento reale dei tool

Problema:

si replica l'errore visto nel repo Figma, dove la doc e alcuni helper divergono.

Mitigazione:

- ogni workflow pack deve essere ancorato ai contratti reali di Bottega
- test automatici sui casi documented-as-critical
- reference generate/manutenute insieme al codice

### Rischio 4 — Troppa rigidità

Problema:

workflow troppo prescrittivi possono peggiorare i task creativi o rapidi.

Mitigazione:

- workflow opzionali e intent-based
- fallback sempre possibile al comportamento generalista
- policy diverse per task esplorativi vs task strutturati

### Rischio 5 — Collisione con il sistema di subagent

Problema:

workflow packs e subagent potrebbero introdurre complessità duplicata.

Mitigazione:

- ruolo chiaro: i workflow decidono la procedura, i subagent aiutano solo in discovery/analysis

---

## 9. Backlog Prioritizzato

### P0

- benchmark v0
- core workflow runtime
- alleggerimento del system prompt
- `build-screen`
- `update-screen`

### P1

- `build-design-system`
- state ledger
- validation engine
- agent playbook tests dedicati

### P2

- `componentize-pattern`
- `token-audit`
- `image-story`
- eventuale UI esplicita per checkpoint e resume

---

## 10. File Target Iniziali

### Da creare

- `src/main/workflows/types.ts`
- `src/main/workflows/registry.ts`
- `src/main/workflows/intent-router.ts`
- `src/main/workflows/extension-factory.ts`
- `src/main/workflows/state-ledger.ts`
- `src/main/workflows/validation-policy.ts`
- `src/main/workflows/packs/build-screen.ts`
- `src/main/workflows/packs/update-screen.ts`
- `src/main/workflows/packs/build-design-system.ts`
- `tests/unit/main/workflows/intent-router.test.ts`
- `tests/unit/main/workflows/state-ledger.test.ts`

### Da modificare

- `src/main/agent.ts`
- `src/main/system-prompt.ts`
- `src/main/subagent/orchestrator.ts`
- `src/main/session-store.ts`
- `src/main/app-state-persistence.ts`

---

## 11. Criteri di Successo

Considereremo riuscita la v1 se:

1. Bottega attiva correttamente un workflow pack per i task target.
2. Il system prompt base si riduce senza perdita di robustezza generale.
3. I task `build-screen` e `update-screen` mostrano meno retry rispetto al benchmark.
4. I workflow multi-turno possono essere ripresi senza dipendere solo dal contesto del modello.
5. Le mutazioni restano sempre serializzate e la validazione visiva è coerente.

---

## 12. Decisione Finale

La direzione raccomandata è:

- **non importare le skill Figma come contenuto statico**
- **costruire in Bottega un runtime di workflow packs interni**
- **adottare dal repo Figma il modello operativo, non la sua implementazione testuale**

Questo consente a Bottega di unire i suoi punti di forza attuali:

- prodotto desktop reale
- toolset ricco
- queueing e file scoping
- subagent e compression

con il punto di forza principale del pack ufficiale Figma:

- un layer di conoscenza operativa task-specifica, modulare, riusabile e governabile.
