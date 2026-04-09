# Handover: Fase 6 — Full QA Run + Next Steps

## Contesto

Nelle sessioni 2026-04-05/06 abbiamo completato le fasi 1-5 del QA pipeline:

### Cosa e' stato fatto (commit db11dae + eadebae)

1. **Fase 1 — Golden Run**: qa-runner validato end-to-end su script 01+02. Pipeline three-pass funziona: qa-runner produce result-NN.txt + NN-metadata.json + screenshot, log-watcher produce anomaly report, ux-reviewer (Opus) produce UX review (3.8/5)

2. **Fase 2 — Performance Quick-Wins**:
   - P-002: `maxRetries` 2→1, skip `token_compliance` quando file senza token E nessun token tool usato nella sessione
   - P-004: circuit breaker per 403 "Invalid token" su Figma REST API (3 consecutive → disable)
   - `sessionToolHistory` aggiunto a `SessionSlot` per tracking tool session-wide

3. **Fase 3 — Bug Fix Media**:
   - B-002: abort button durante streaming (send btn → stop rosso, Esc per abort)
   - B-001: context bar si aggiorna al cambio tab (`lastContextTokens` per-tab)
   - B-012: context bar si resetta a 0 dopo New Chat

4. **Fase 4 — Nuovi test script**: 17-image-editing, 18-advanced-creation, 19-deep-discovery (16 nuovi step automatizzati)

5. **Fase 5 — Log monitor improvements**: soglie per-component, filtro micro-judge, prompt markers

6. **Resilienza qa-runner** (non in .git, in .claude/skills):
   - `--resume` con checkpoint.json (riprende dopo crash)
   - `--dry-run` (parsa senza lanciare)
   - Pre-flight checks (Figma running, no Electron zombie, disco)
   - Port wait 9280 con backoff (vs sleep naive)
   - Suite `targeted` per script cambiati (04,05,16,17,18,19)
   - `unhandledRejection` safety net

### Cosa NON e' stato fatto

- Fase 6: full QA run con pipeline validato — e' l'oggetto di questo handover
- B-010 (suggestion chip click) — investigazione non completata
- P-001 (judge parallelism pre-creation) — deprioritizzato
- UX issues dalla review Pass 2 (judge task panel noise, auto-scroll canvas results)

### Stato test

- **Unit test**: 1658 pass, 3 fail pre-esistenti (session-events.test.ts, agent-pipeline.test.ts — non correlati ai nostri cambiamenti)
- **TypeScript**: compila clean
- **Build**: OK
- **Dry parse**: tutti i 25 script parsano correttamente (127 automated, 81 manual)

### Pre-existing failures (da NON fixare in questa sessione)

I 3 test che falliscono sono pre-esistenti e non correlati:
- `session-events.test.ts`: "emits usage:turn_end with full metrics on agent_end" + "resets per-turn state after agent_end"
- `agent-pipeline.test.ts`: "handles a full turn with thinking + tools + screenshot + text"

---

## Task da eseguire (in ordine)

### Fase 6: Full QA Run (~100 min)

**Obiettivo**: Eseguire la full QA run con il pipeline validato e confrontare con la run precedente (192 test, 95.3% pass).

#### Step 1: Build

```bash
npm run build
```

#### Step 2: Dry run di verifica

```bash
node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite full --dry-run
```

Verifica che tutti i 19 script parsano correttamente. Aspettati: 127 automated, 81 manual.

#### Step 3: Lancia monitor in background

```bash
export BOTTEGA_QA_RECORDING=1
nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs --duration 7200 --output /tmp/log-monitor-report.md > /tmp/log-watcher-stdout.txt 2>&1 &
nohup node .claude/skills/bottega-dev-debug/scripts/qa-recorder.mjs --duration 7200 --output /tmp/bottega-qa/recordings > /tmp/qa-recorder-stdout.txt 2>&1 &
```

#### Step 4: Run targeted suite PRIMA (script cambiati, ~35 min)

```bash
rm -rf /tmp/bottega-qa && mkdir -p /tmp/bottega-qa/recordings
BOTTEGA_QA_RECORDING=1 node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite targeted --output /tmp/bottega-qa
```

Verifica i risultati:
- `ls /tmp/bottega-qa/result-*.txt` — devono esserci result-04, result-05, result-16, result-17, result-18, result-19
- Se script 17 (image-editing) fallisce, potrebbe essere per chiave Gemini mancante — annotare ma non bloccarsi
- Script 05 e 16 sono ALL MANUAL — produrranno solo step manuali (atteso)

#### Step 5: Run full suite con resume (~65 min rimanenti)

```bash
BOTTEGA_QA_RECORDING=1 node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite full --resume --output /tmp/bottega-qa
```

`--resume` saltera' i 6 script gia' completati dal targeted run. Se crasha a meta', ri-lanciare lo stesso comando — ripartira' dall'ultimo checkpoint.

#### Step 6: Verifica output completo

```bash
# Verifica che tutti i result file esistono
ls -la /tmp/bottega-qa/result-*.txt | wc -l  # atteso: 19

# Verifica metadata JSON
ls -la /tmp/bottega-qa/*-metadata.json | wc -l  # atteso: 19

# Verifica checkpoint
cat /tmp/bottega-qa/checkpoint.json

# Verifica recording
ls -la /tmp/bottega-qa/recordings/
cat /tmp/bottega-qa/recordings/timing-baselines.json
```

#### Step 7: Ferma monitor e leggi report

```bash
kill $(pgrep -f log-watcher.mjs) $(pgrep -f qa-recorder.mjs) 2>/dev/null
cat /tmp/log-monitor-report.md
```

#### Step 8: Lancia Pass 2 (UX review) come subagent

Lanciare un Agent con model opus:
```
Agent:
  subagent_type: "general-purpose"
  model: "opus"
  prompt: "Read all metadata JSON files from /tmp/bottega-qa/*-metadata.json and all screenshot PNGs.
           For each step with a screenshot, evaluate: Visual Quality, Tool Feedback, Response Quality,
           UX Coherence, Feedback Quality (1-5 scale).
           Write the review to /tmp/bottega-qa/ux-review.md"
```

#### Step 9: Confronto con run precedente

La run precedente (qa-tester ad-hoc) aveva:
- 16 script, 192 test, 183 pass (95.3%), 9 fail
- 42 errori API 403, 22 WS disconnect, 150 slow ops
- Judge pass rate 1%

Confrontare:
- Pass rate automated (atteso: simile o migliore grazie ai fix)
- API 403 count (atteso: drasticamente ridotto dal circuit breaker)
- Slow ops count (atteso: ridotto dal filtro micro-judge)
- Nuovi bug trovati dai 3 script aggiuntivi (17-19)

#### Step 10: Aggiorna BUG-REPORT.md

Dopo la full run, aggiornare BUG-REPORT.md con:
- Bug fixati (B-001, B-002, B-012) → status FIXED
- Nuovi bug trovati → B-013+
- Performance issue status (P-002, P-004) → FIXED
- Risultati UX review → sezione dedicata

---

## Post-Fase 6: Next Steps (se la run va bene)

### 1. Fix B-010 (suggestion chip click) — ~30 min

Il chip click handler in `src/renderer/app.js:1683` chiama `_initTurn(tab, text, [])` + `window.api.sendPrompt(tab.id, text)`. Il test TC2.9 dice "input empty after chip click" ma il chip NON mette il testo nell'input — lo invia direttamente. Verificare con `BOTTEGA_QA_RECORDING=1` se il prompt arriva al backend.

### 2. UX Issues dalla Pass 2 Review — ~1h

Dalla review 3.8/5, i problemi principali:
- Judge task panel (23 tasks, 0 done) crea rumore visivo — aggiungere dismiss/clear
- Canvas screenshots non auto-scroll nel viewport — aggiungere `scrollIntoView()` dopo screenshot inline
- Judge critique panel usa colori allarmanti (rosso/salmone) — ridurre a grigio/giallo

### 3. Pre-release Readiness — ~30 min

```bash
npm run check        # typecheck + lint + test + dead code
npm run build:check  # bundle size check
npm run package      # .dmg build
```

Verificare che il .dmg si installa e lancia correttamente su una macchina pulita.

---

## File chiave

| File | Perche' |
|------|---------|
| `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` | Runner con checkpoint/resume/dry-run/pre-flight |
| `.claude/skills/bottega-dev-debug/scripts/log-watcher.mjs` | Monitor con soglie per-component e prompt markers |
| `.claude/skills/bottega-dev-debug/scripts/qa-recorder.mjs` | Recorder con pattern corretti (Prompt enqueued, Suggestions generated) |
| `tests/qa-scripts/README.md` | Catalogo 25 script con coverage matrix |
| `BUG-REPORT.md` | 12 bug, 2 warning, 5 performance issues |
| `src/figma/figma-api.ts` | Circuit breaker 403 (linea 84-90, 126-147) |
| `src/main/subagent/judge-harness.ts` | Skip token_compliance condizionale (linea 135-144) |
| `src/main/slot-manager.ts` | sessionToolHistory (linea 57) |
| `src/renderer/app.js` | Abort button (linea 719-766), context bar fix (linea 893, 302) |

## Comandi utili

```bash
# Build e test
npm run build
npm test
npx tsc --noEmit

# QA pipeline
node qa-runner.mjs --suite full --dry-run           # parse-only
node qa-runner.mjs --suite targeted                  # solo script cambiati
node qa-runner.mjs --suite full --resume             # riprendi dopo crash
node qa-runner.mjs --script 02 --script 07           # singoli script

# Debug
BOTTEGA_QA_RECORDING=1 npx electron dist/main.js    # app con verbose tool logging
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs  # inspect app state
```

## Note importanti

- **Figma Desktop** deve essere aperto con Bottega-Test_A e Bottega-Test_B, Bridge plugin attivo
- **Script 05, 15, 16**: sono ALL MANUAL (0 step automatizzati) — il qa-runner li processa ma produce solo step "MANUAL (skipped)"
- **Script 17**: richiede Gemini API key per image generation — se mancante, fallira' ma non blocca gli altri
- **Script 24**: usa ENTRAMBI i file test (Bottega-Test_A e Bottega-Test_B) — entrambi devono essere aperti
- **`--resume`**: legge `checkpoint.json` nella output dir. Per forzare re-run completo: `rm /tmp/bottega-qa/checkpoint.json`
- **Monitor**: vanno lanciati con `nohup` perche' il Bash tool ha timeout max 600s
- **Timeout**: 120s per prompt (default). Per script complessi (20-25 extended), considerare `--timeout 180000`
- **I 3 test falliti** (session-events, agent-pipeline) sono pre-esistenti e non correlati
