# Handover — Componentization Judge Pipeline (v0.14.0 → v9 validation + fixes)

## Context per la nuova sessione

Stiamo lavorando sulla pipeline componentization judge di Bottega (Electron + Pi SDK agent + Figma Desktop Bridge). Il judge deve rilevare elementi UI duplicati (es: 4 card identiche in una menu grid) e guidare l'agent a creare componenti riutilizzabili invece di frames duplicati.

**Tag di partenza**: `v0.14.0` (4 commits sopra main: fix updater, overhaul judge, test suite, version bump).

**2282 unit test verdi**, build pulito. Pipeline validata attraverso **8 campagne QA progressive** (v1→v8).

## Problema Attuale (aperto post-v8)

**Il fix v8.1 deve essere validato con una QA campaign v9**, e poi bisogna risolvere il gap residuo `figma_instantiate = 0/11 retries`.

Quando il componentization judge dà FAIL, l'agent riceve un retry prompt con una DIRECT ACTION CHECKLIST. L'agent converte correttamente il primo frame in component (`figma_create_component`) ma **non istanzia mai** i successivi (`figma_instantiate = 0` in 11 retry su 11). In v8, retry convergence è al 45% combinato / 60% S40-only — migliore ma sotto il target 60%.

## Cosa NON Fare (soluzioni già tentate e scartate)

### ❌ Non modificare la soglia di detection
La soglia è 2+ duplicati. Già scesa da 3+ in v2. Scenderla oltre genera noise.

### ❌ Non rimuovere il filtro structural depth
`minChildren=2 + grandchildren required` elimina FRAME>[TEXT] false positives (bottoni, badge, label). Senza di esso la detection aveva 27 findings/run, judge si confondeva.

### ❌ Non rimuovere parent-scoped analysis
Senza di essa, la judge evaluava l'intera pagina incluso contenuto pre-esistente di sessioni precedenti → false positive 50%+. Il parent scoping limita analisi al parent container del targetNodeId.

### ❌ Non dipendere da `__testFigmaExecute` per il canvas cleanup QA
È gated dietro `BOTTEGA_AGENT_TEST=1`. Abbiamo aggiunto handler always-available `figma:clear-page` e `figma:execute` in `ipc-handlers.ts`. Il QA runner usa questi con fallback al legacy.

### ❌ Non ritornare a `libraryComponents` obbligatorio
Il prefetch ora computa `componentAnalysis` con solo `fileData`. `libraryComponents` (Figma REST API) è opzionale. Senza token REST, l'analisi within-screen funziona comunque.

### ❌ Non usare il YAML serialization output per il tree walk
Il profile balanced usa `outputFormat: 'yaml'`. Il raw tree fetch va via `connector.executeCodeViaUI` bypassando `figma_get_file_data` che è YAML. Altrimenti `parseFileData` produce `totalNodes: 0`.

### ❌ Non semplificare il retry hint in testo generico
Soluzioni tentate e fallite:
- "Use figma_create_component to convert frames to reusable components" (v2) → agent ignora
- "Workflow: 1) create 2) delete 3) instantiate" (v6) → agent crea ma non istanzia
- Generic "nodeIds in evidence" (v5) → LLM haiku non include IDs

**Quello che funziona**: checklist esplicita con node ID specifici, "STEP 1/STEP 2/STEP N" numerati, sezione "WHY ALL STEPS MATTER", sezione "DO NOTs" separata.

### ❌ Non rimuovere l'ancestor dedup
Senza di esso, 4 card con inner body frames generano 2 gruppi (4 card + 4 inner bodies). L'agent si confonde su cosa convertire.

## Architettura Corrente della Pipeline

```
Agent turn ends
  ↓
runJudgeHarness() — src/main/subagent/judge-harness.ts
  ↓
prefetchForMicroJudges() — src/main/subagent/context-prefetch.ts
  - figma_get_file_data (YAML output)
  - figma_lint, figma_design_system
  - figma_get_library_components (optional, può fallire)
  - RAW TREE via connector.executeCodeViaUI (bypassa YAML)
  - analyzeComponents(rawTreeJson, libraryNames, targetNodeId)
    → ComponentAnalysis { withinScreen, crossScreen, libraryMisses, detachedInstances, stats }
  ↓
runMicroJudgeBatch() — src/main/subagent/orchestrator.ts
  ↓ (for componentization)
  Fast-path PASS if withinScreen=0 && libraryMisses=0 && detachedInstances=0
  Otherwise → LLM judge (haiku) with ComponentAnalysis as evidence
  ↓
  Verdict → if FAIL + autoRetry → buildRetryPrompt()
  ↓
  buildRetryPrompt(verdicts, retry, evidence, componentAnalysis)
    - extracts nodeIds directly from componentAnalysis.withinScreen[].nodeIds
    - builds DIRECT ACTION CHECKLIST with actual IDs
    - logs "Judge retry prompt injected" with nodeIds, hasChecklist, promptPreview
  ↓
  slot.session.prompt(retryPrompt) — agent processes retry
  ↓
  Loop to next attempt (max 2)
```

## File Chiave (stato corrente)

| File | Responsabilità |
|------|----------------|
| `src/main/subagent/component-analysis.ts` | Detection logic: fingerprinting, dedup, name similarity, parent scoping |
| `src/main/subagent/context-prefetch.ts` | Data fetch: raw tree via connector, componentAnalysis build |
| `src/main/subagent/orchestrator.ts` | Per-judge execution, fast-path, diagnostic logging |
| `src/main/subagent/judge-harness.ts` | Retry loop, buildRetryPrompt con checklist, observability |
| `src/main/subagent/system-prompts.ts` | Judge LLM prompt (instructs to include nodeIds) |
| `src/main/subagent/judge-registry.ts` | componentization: `blocking: true` |
| `src/main/subagent/types.ts` | `WithinScreenDuplicates.nodeIds` field |
| `src/main/system-prompt.ts` | Agent "Component check" step 5 |
| `src/main/tools/jsx-render.ts` | promptGuideline avverte contro inlining |
| `src/main/ipc-handlers.ts` | `figma:clear-page`, `figma:execute` handlers |
| `src/main/preload.ts` | `window.api.clearPage`, `window.api.figmaExecute` |
| `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` | Usa le nuove IPC con fallback |
| `tests/qa-scripts/39-componentization-detection.md` | QA script: 5 step detection |
| `tests/qa-scripts/40-componentization-domains.md` | QA script: 6 design domains |

## Progressione QA Campaigns

| Campaign | Retry Convergence | Focus | Outcome |
|----------|-------------------|-------|---------|
| v1 | 0% | baseline (blind PASS) | Identified 3 root causes |
| v2 | 23% | threshold + blocking | False positives emerged |
| v3 | 50% | ancestor dedup | Canvas contamination identified |
| v4 | 100% (clean canvas) | canvas cleanup IPC | First full convergence on genuine cases |
| v5 | 23% | parent scoping + depth filter | Nav/header FP issue |
| v6 | 40% | name similarity filter | Shared-prefix FP, logging gap |
| v7 | 25% | nodeIds direct extraction | Agent returns too quickly |
| v8 | 45% / 60% S40-only | DIRECT ACTION CHECKLIST | **`figma_instantiate = 0/11`** |

## v8.1 Fixes (implementati, NON ancora validati con QA v9)

Tutti in `src/main/subagent/judge-harness.ts`:

1. **promptPreview 300→1200 chars** + `hasChecklist` + `promptLength` log fields
2. **Checklist all'inizio del retry prompt** (era dopo itemsText, agent leggeva prima gli abstract items)
3. **Checklist linguaggio rinforzato**:
   - "STEP 1, STEP 2, STEP N" invece di numeri generici
   - **"WHY ALL STEPS MATTER"** section: "component con zero istanze NON soddisfa componentization. Il judge deve vedere [1 COMPONENT + N INSTANCE] — non [N+1 FRAME]. Skippare figma_instantiate WILL fail the retry"
   - **"DO NOTs"** section separata

## Task per la Nuova Sessione

### 1. Run QA Campaign v9

```bash
# Verifica build corrente (dovrebbe essere 0.14.0)
cat package.json | grep version

# Pulisci output precedenti
pkill -f "electron.*dist/main" 2>/dev/null
rm -f /tmp/bottega-qa/*.txt /tmp/bottega-qa/*.json /tmp/bottega-qa/*.png /tmp/bottega-qa/*.md

# Log watcher background
nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs \
  --duration 7200 --output /tmp/log-monitor-v9.md \
  > /tmp/log-watcher-v9-stdout.txt 2>&1 &

# Lancia qa-tester agent (background, ~40min)
# Prompt: valida i fix v8.1
# Scripts: 39 (--timeout 300000), 40 (--timeout 700000)
```

### 2. Metriche Chiave da Validare

| Metric | v8 | Target v9 |
|--------|----|----|
| Retry convergence (combined) | 45% | **≥60%** |
| Retry convergence S40-only | 60% | **≥75%** |
| `figma_instantiate` usage in retries | **0/11** ❌ | **≥5/11** |
| `hasChecklist: true` in retry logs | N/A | **Present** |
| `figma_render_jsx` durante retry | 0 | **0 (maintained)** |
| `figma_generate_image` durante retry | 0 | **0 (maintained)** |
| Checklist visibile in promptPreview | Truncated | **Visible (1200 char)** |
| Script 39 pass rate | 4/4 | 4/4 |
| Script 40 pass rate | 5/6 | **6/6** |

### 3. Verifiche Diagnostiche Post-v9

```bash
# Verifica checklist delivery
grep "Judge retry prompt injected" ~/Library/Logs/bottega/app.log | \
  grep -o '"hasChecklist":[^,]*' | tail -10

# Verifica figma_instantiate usage post-retry
grep -E "Judge retry prompt injected|tool.*figma_instantiate|tool.*figma_create_component|tool.*figma_delete" \
  ~/Library/Logs/bottega/app.log | tail -40

# Conta convergence FAIL→PASS
grep "judge.*verdict" ~/Library/Logs/bottega/app.log | \
  grep -E "componentization|verdict" | tail -20
```

### 4. Decision Tree Post-v9

**Se `figma_instantiate ≥ 5/11`**:
- ✅ Fix v8.1 ha funzionato
- Commit la `HANDOVER.md` come closed
- Considera release v0.14.1 se ci sono altri bug fix

**Se `figma_instantiate < 5/11` ancora**:
- L'agent ancora non istanzia nonostante checklist esplicita
- **Possibili root cause da investigare** (in ordine di priorità):
  
  a) **Agent system prompt conflict** — qualcosa nel system prompt scoraggia instantiation. Controlla `src/main/system-prompt.ts` linea 280-310 (Component Workflow section).
  
  b) **Pi SDK timeout** — forse `session.prompt()` ha un timeout interno più corto del judge retry budget. Verifica con Pi SDK docs.
  
  c) **Tool call sequencing issue** — agent chiama `figma_create_component` ma non memorizza il `componentKey` nel contesto. Forse il result viene troppo compresso.
  
  d) **Judge re-fires troppo veloce** — se il 2° judge parte prima che l'agent finisca i tool calls, agent sembra non aver fatto nulla. Check timestamps tra "Judge retry prompt injected" e next "Micro-judge completed".

### 5. Issue Minori Aperti (da v8)

- **Restaurant menu step 1**: è l'unico step dove l'agent non usa `figma_create_component` proattivamente (heavy image generation workflow). Valutare se aggiungere esempi few-shot nel system prompt.
- **Mobile nav step 5 timeout marginale** (488s vs 480s target): recommended timeout Script 40 aumentato a 700s in v8.
- **Script 40 Step 3 (SaaS) duration 530s**: usare `--timeout 700000` come da v8.1 config.

### 6. Se QA v9 Fallisce Tutti i Target

Approccio alternativo drastico da considerare:
- **Post-render auto-componentization**: modificare `figma_render_jsx` tool perché dopo il render, detecta duplicati strutturali e auto-converta a component+instances prima di ritornare. Bypassa completamente il judge retry. Richiede modifiche al plugin bridge in `figma-desktop-bridge/code.js`.

## Riferimenti

- **Session memory**: `/Users/afato/.claude/projects/-Users-afato-Projects-bottega/memory/project_componentization_fix.md`
- **Report QA v8**: `/tmp/bottega-qa/componentization-v8-report.md`
- **CLAUDE.md**: architettura completa (src/main/, subagent/, compression/)
- **Feedback memories**: `/Users/afato/.claude/projects/-Users-afato-Projects-bottega/memory/feedback_*.md`

## Commit History di Questa Sessione

```
ce12224 chore: bump version to 0.14.0
11b63f1 test(judge): add componentization test suite + QA infrastructure updates
434bad5 feat(judge): overhaul componentization detection and retry pipeline
9f1cf55 fix(updater): resolve freeze and esbuild ENOTDIR after auto-update
957a640 chore: bump version to 0.13.0 (previous release)
```

## Start dalla Nuova Sessione

Prima cosa da fare: leggere questo HANDOVER.md e `project_componentization_fix.md` in memory. Poi lanciare QA v9. Il qa-tester agent (skill `bottega-dev-debug`) è configurato per questa pipeline.

Buon lavoro!
