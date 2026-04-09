# Handover: QA Pipeline Validation + Bug Fix + Performance

## Contesto

Nella sessione precedente (2026-04-05/06) abbiamo costruito un QA pipeline completo per Bottega:

### Cosa esiste

1. **Three-Pass QA Architecture** documentata in `.claude/skills/bottega-dev-debug/SKILL.md`
   - Pass 1: `qa-runner.mjs` — test runner deterministico che parsa i test script markdown, invia prompt all'agent, cattura response/screenshot/metadata
   - Log Monitor: `log-watcher.mjs` — anomaly detection real-time sui log pino
   - QA Recorder: `qa-recorder.mjs` — cattura tool interactions per generazione test automatici
   - Pass 2: ux-reviewer (Opus) — valutazione qualitativa su screenshot + metadata

2. **Tool call logging** in `src/main/tools/index.ts` — gated dietro `BOTTEGA_QA_RECORDING=1`, logga params/result/timing di ogni tool call

3. **22 test scripts** in `tests/qa-scripts/` (01-16 feature, 20-25 extended)

4. **BUG-REPORT.md** con 12 bug (B-001→B-012), 2 warning (W-001→W-002), 5 performance issues (P-001→P-005)

5. **Comando `/qa`** in `.claude/commands/qa.md` — orchestrator per il pipeline

### Cosa NON e' stato ancora validato

- Il `qa-runner.mjs` non e' MAI stato eseguito su una run reale
- Il `qa-recorder.mjs` non e' MAI stato eseguito (dipende dal logging R3 aggiunto)
- Il Pass 2 (ux-reviewer) non e' MAI stato eseguito
- Il metadata JSON bridge (Pass 1 → Pass 2) non e' MAI stato prodotto

### Run QA precedente (dati di riferimento)

La run precedente ha usato un qa-tester subagent che scriveva runner scripts ad-hoc:
- 16 script, 192 test, 183 pass (95.3%), 9 fail
- Log monitor: 1886 linee, 42 errori API 403, 22 WS disconnect, 150 slow ops (micro-judge)
- Bug trovati: B-007→B-012 (nuovi), confermati B-001→B-006 (pre-esistenti)
- Performance: judge parallelism 1.8-3.5x su 7x ideale, pass rate judge 1%, API 403 "Invalid token"

---

## Task da eseguire (in ordine)

### Fase 1: Golden Run Validation (~30 min)

**Obiettivo**: Validare che il pipeline three-pass funziona end-to-end su 2 script.

1. Build l'app: `npm run build`

2. Lancia i monitor in background:
   ```bash
   export BOTTEGA_QA_RECORDING=1
   nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs --duration 600 --output /tmp/log-monitor-report.md > /tmp/log-watcher-stdout.txt 2>&1 &
   nohup node .claude/skills/bottega-dev-debug/scripts/qa-recorder.mjs --duration 600 --output /tmp/bottega-qa/recordings > /tmp/qa-recorder-stdout.txt 2>&1 &
   ```

3. Lancia il qa-runner per smoke (script 01 + 02):
   ```bash
   BOTTEGA_QA_RECORDING=1 node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite smoke --output /tmp/bottega-qa
   ```
   Nota: il qa-runner ha un timeout di 120s per prompt. Assicurarsi che Figma Desktop sia aperto con Bottega-Test_A e Bridge plugin attivo.

4. Verifica output:
   - `/tmp/bottega-qa/result-01.txt` e `result-02.txt` devono esistere con PASS/FAIL
   - `/tmp/bottega-qa/01-metadata.json` e `02-metadata.json` devono contenere prompt, response, toolCards, screenshot path, evaluateCriteria
   - Screenshot in `/tmp/bottega-qa/01-*.png` e `02-*.png`
   - Se il qa-runner ha step MANUAL, annotali ma non bloccarti

5. Ferma i monitor: `kill` i PID o aspetta --duration

6. Verifica recording output:
   - `/tmp/bottega-qa/recordings/tool-sequences.json` — deve avere turn con tool chain
   - `/tmp/bottega-qa/recordings/timing-baselines.json` — deve avere timing per tool
   - `/tmp/log-monitor-report.md` — anomalie durante la run

7. Se il qa-runner fallisce (es. parser non riconosce il formato di uno script), **correggi il parser** in `qa-runner.mjs` e riesegui. Il parser e' regex-based e potrebbe non gestire tutti i formati dei 22 script.

8. Lancia il Pass 2 (ux-reviewer) come subagent Opus sui metadata prodotti. Segui il template in SKILL.md "Step 2: Pass 2". Verifica che `/tmp/bottega-qa/ux-review.md` viene prodotto con score 1-5 per step.

### Fase 2: Fix Performance Quick-Wins (~1h)

**File principali**: `src/main/subagent/judge-harness.ts`, `src/figma/figma-api.ts`

#### P-002: Ridurre retry loop del judge
- Trovare la retry logic nel judge harness
- Cambiare max retry da N (attuale) a 1
- Aggiungere skip condizionale per `token_compliance` quando `figma_setup_tokens` non e' mai stato chiamato nella sessione (verificare come il harness sa quali tool sono stati chiamati — potrebbe servire un flag nello slot)
- Impatto atteso: -70% run judge inutili

#### P-004: Circuit breaker per Figma API 403
- In `src/figma/figma-api.ts`, nella funzione `request()` (linea ~120):
  - Aggiungere un contatore di errori 403 consecutivi
  - Dopo 3 errori 403, disabilitare le REST API call per il resto della sessione
  - Loggare un warning "Figma REST API disabled: invalid token (3 consecutive 403s)"
  - I tool che usano REST API devono funzionare anche senza (il Bridge WS e' il canale primario)
- Impatto atteso: elimina 50 errori/sessione

#### P-001: Migliorare parallelismo judge (se tempo disponibile)
- Verificare in `orchestrator.ts` / `judge-harness.ts` come vengono lanciate le session dei judge
- L'ipotesi e' che il batch init delle session e' sequenziale — se confermato, provare a pre-creare tutte le 7 session in parallelo prima di lanciare i judge
- Impatto atteso: wall time judge da 24-60s a 12-17s

Dopo ogni fix: `npx tsc --noEmit && npm test` per verificare.

### Fase 3: Fix Bug Media (~1h)

#### B-002: Bottone abort visibile durante streaming
- `src/renderer/app.js` — funzione `updateInputState()` (linea ~719)
- Quando `tab.isStreaming === true`:
  - Cambiare l'icona del send button in un quadrato (stop)
  - Cambiare title in "Stop (Esc)"
  - Click → `window.api.abort(tab.id)`
- `src/renderer/styles.css` — stile per il bottone in modalita' stop
- `src/renderer/index.html` — potrebbe servire un secondo bottone o riusare `#send-btn`

#### B-012: Context bar non si resetta dopo New Chat
- `src/renderer/app.js` — reset handler (linea ~843)
- Dopo `clearChat(tab)`, aggiungere: `updateContextBar({ usedTokens: 0, maxTokens: 200000 })`
- Verificare anche che B-001 (context bar non aggiorna al cambio tab) sia correlato e se si puo' fixare insieme

#### B-010: Investigate suggestion chip click
- `src/renderer/app.js` — chip click handler (linea ~1683)
- Il click handler chiama `_initTurn(tab, text, [])` + `window.api.sendPrompt(tab.id, text)` — questo DOVREBBE funzionare
- Il test TC2.9 dice "input empty after chip click" — ma il chip NON mette il testo nell'input, lo invia direttamente
- Verificare se il problema e' nel test (che controlla inputField.value) o nell'app (il prompt non viene effettivamente inviato)
- Usare `BOTTEGA_QA_RECORDING=1` per vedere se il prompt arriva al backend

Dopo ogni fix: `npm run build && npm test`

### Fase 4: Test Script per Tool Non Coperti (~45 min)

Creare nuovi test script per tool senza copertura QA. Seguire il formato standard con "Send:", "Implementation hint:", "Evaluate:".

Script da creare:
- `17-image-editing.md` — edit_image, restore_image (richiede immagine esistente su canvas)
- `18-advanced-creation.md` — auto_layout, set_image_fill, batch_transform, arrange_component_set
- `19-deep-discovery.md` — get_component_details, get_component_deep (richiede componenti nel file)

Formato di riferimento: leggere `tests/qa-scripts/07-creation-and-manipulation.md` come esempio.

### Fase 5: Log Monitor Improvements (~30 min)

Migliorare `scripts/log-watcher.mjs`:
- Soglie per-component invece di soglia unica 10s:
  - `judge` / `subagent`: >20s e' anomalo
  - `tool`: >5s e' anomalo
  - `ws` / `connector`: >2s e' anomalo
  - `figma-api`: >3s e' anomalo
- Filtrare i "Micro-judge completed" dalla lista slow ops (sono attesi >10s)
- Aggiungere marker di inizio/fine script (leggere dal log il prompt "User prompt received" come delimitatore)

### Fase 6: Re-run Full Suite con Pipeline Validato

Dopo fasi 1-5, eseguire una full QA run con il pipeline completo:

```
/qa full
```

Questo dovrebbe:
1. Lanciare log-watcher + qa-recorder in background
2. Eseguire qa-runner su script 01-16 (+ 17-19 se creati)
3. Produrre metadata JSON per tutti gli script
4. Lanciare ux-reviewer (Pass 2) sui metadata
5. Merge dei 3 report + aggiornamento BUG-REPORT.md

Confrontare i risultati con la run precedente (192 test, 95.3% pass) per verificare regressioni.

---

## File chiave da leggere

| File | Perche' |
|------|---------|
| `.claude/skills/bottega-dev-debug/SKILL.md` | Pipeline completo, architettura three-pass |
| `.claude/commands/qa.md` | Comando /qa, flow di esecuzione |
| `BUG-REPORT.md` | Tutti i bug/warning/performance issues |
| `tests/qa-scripts/README.md` | Catalogo script, metadata format, three-pass docs |
| `src/main/tools/index.ts` | R3 tool logging (withAbortCheck wrapper) |
| `scripts/qa-runner.mjs` | R1 test runner deterministico |
| `scripts/log-watcher.mjs` | Log anomaly detection |
| `scripts/qa-recorder.mjs` | Tool interaction recording |
| `src/main/subagent/judge-harness.ts` | P-001/P-002 judge bottleneck |
| `src/figma/figma-api.ts` | P-004 API 403 circuit breaker |

## Comandi utili

```bash
npm run build                    # build app
npm test                         # 1661 unit test
npx tsc --noEmit                 # type check
npm run lint                     # biome check
npm run check                    # typecheck + lint + test + dead code

# QA pipeline
/qa smoke                        # 2 script, ~8 min
/qa pre-release                  # 6 script, ~30 min
/qa full                         # 16 script, ~100 min

# Helpers manuali
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite smoke
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs
node .claude/skills/bottega-dev-debug/scripts/analyze-logs.mjs --last 500
```

## Note importanti

- Figma Desktop deve essere aperto con Bottega-Test_A e Bottega-Test_B, Bridge plugin attivo
- Il Bridge impiega 5-10s a riconnettersi dopo il lancio dell'app (settleMs: 8000 nel qa-runner)
- I monitor (log-watcher, qa-recorder) vanno lanciati via `nohup` perche' il Bash tool ha timeout max 600s
- `BOTTEGA_QA_RECORDING=1` abilita il verbose tool logging — NON usare in produzione
- I test script in italiano hanno la documentazione e il PLAN.md in italiano
- Il commit message deve seguire Conventional Commits (feat:, fix:, chore:, etc.)
