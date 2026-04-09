# QA — Bottega Three-Pass Testing Pipeline

Run the Bottega QA pipeline with three complementary passes: functional testing, log monitoring, and UX quality review.

## Arguments

This command accepts arguments in the format: `/qa [suite] [options]`

**Suite** (REQUIRED — ask if not provided):
- `smoke` — Scripts 01 + 02 (~8 min)
- `pre-release` — Scripts 01-05 + 14 (~30 min)
- `full` — Scripts 01-16 (~100 min)
- `stress` — Scripts 20-25 (~155 min)
- `script NN` — Single script by number (e.g., `script 07`)

**Options** (REQUIRED — ask each if not provided):
- `--pass1-only` — Run only Pass 1 (functional checks), skip Pass 2 (UX review)
- `--pass2-only` — Run only Pass 2 on existing screenshots/metadata (no app launch)
- `--no-recorder` — Skip the qa-recorder (no test generation artifacts)
- `--generate-tests` — After QA, auto-generate playbook tests from recordings

## Behavior

**If no arguments are provided, ask the user these questions one by one:**

1. "Quale suite vuoi eseguire? (smoke, pre-release, full, stress, oppure un singolo script con il numero)"
2. "Vuoi eseguire il pipeline completo (Pass 1 + Pass 2 + Log Monitor + Recorder) oppure solo una parte? (completo, pass1-only, pass2-only)"
3. "Vuoi generare test automatici dai recording dopo il QA? (si/no)"

**Never assume defaults. Always ask.**

## Execution

Once all parameters are confirmed, follow this exact sequence from the `bottega-dev-debug` skill:

### Step 0: Build + Background Monitors

```bash
npm run build
```

Then launch background monitors via `nohup` (NOT via subagent Bash — the 600s timeout kills them):

```bash
# Duration lookup: smoke=600, pre-release=2100, full=6600, stress=10200, single=900
DURATION=<based on suite>

# Log monitor
nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs \
  --duration $DURATION --output /tmp/log-monitor-report.md \
  > /tmp/log-watcher-stdout.txt 2>&1 &
echo "LOG_PID: $!"

# QA recorder (skip if --no-recorder)
nohup node .claude/skills/bottega-dev-debug/scripts/qa-recorder.mjs \
  --duration $DURATION --output /tmp/bottega-qa/recordings \
  > /tmp/qa-recorder-stdout.txt 2>&1 &
echo "REC_PID: $!"
```

Verify both are alive with `ps -p PID`.

### Step 1: Pass 1 — Functional Testing (qa-runner.mjs)

**Skip if `--pass2-only`.**

Launch qa-tester subagent in background. The subagent runs `qa-runner.mjs` which
is a deterministic test runner that parses test script markdown and guarantees
metadata JSON output for Pass 2.

```
Agent tool:
  subagent_type: "qa-tester" (oh-my-claudecode:qa-tester)
  model: "sonnet"
  run_in_background: true
  prompt: |
    Run the Bottega QA runner. The app is already built.
    Set BOTTEGA_QA_RECORDING=1 then run:
      export BOTTEGA_QA_RECORDING=1
      node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite SUITE_NAME
    
    The runner handles: app launch, Figma connection wait, prompt sending,
    response capture, screenshots, and metadata JSON production.
    
    After it completes, handle MANUAL steps (listed in stdout).
    For each MANUAL step, interact with the app and record findings.
    
    Output: /tmp/bottega-qa/ (result-NN.txt + NN-metadata.json + screenshots)
```

Suite flags: `--suite smoke`, `--suite pre-release`, `--suite full`, `--suite stress`
Single script: `--script NN`

### Step 2: Pass 2 — UX Quality Review

**Skip if `--pass1-only`.**
**Wait for Pass 1 to complete before starting.**

Launch ux-reviewer subagent:
```
Agent tool:
  subagent_type: "general-purpose"
  model: "opus"
  run_in_background: true
```

The ux-reviewer:
- Reads each `/tmp/bottega-qa/NN-metadata.json`
- Reads the corresponding test script from `tests/qa-scripts/`
- READs each screenshot image file
- Evaluates 5 dimensions per step (1-5): Visual Quality, Response Clarity, Tool Selection, UX Coherence, Feedback Quality
- Writes `/tmp/bottega-qa/ux-review.md`

See the full prompt template in SKILL.md → "Step 2: Pass 2".

### Step 3: Merge + Report

After all passes complete:

1. Stop background monitors: `kill $LOG_PID $REC_PID` (or let --duration auto-stop)
2. Read all outputs:
   - `/tmp/bottega-qa/result-NN.txt` (Pass 1)
   - `/tmp/bottega-qa/ux-review.md` (Pass 2)
   - `/tmp/log-monitor-report.md` (log anomalies)
   - `/tmp/bottega-qa/recordings/` (if recorder was active)
3. Correlate findings by timestamp
4. Classify: B-NNN (bugs), UX-NNN (UX issues), P-NNN (performance), W-NNN (warnings)
5. Update `BUG-REPORT.md` with new findings
6. Present unified summary to user

### Step 4: Test Generation (if --generate-tests)

After Step 3:
1. Read `/tmp/bottega-qa/recordings/playbook-drafts.json`
2. Cross-reference with existing tests in `tests/unit/main/agent-playbook*.test.ts`
3. Generate new playbook tests for uncovered scenarios
4. Write to `tests/unit/main/agent-playbook-recorded.test.ts`
5. Run `npm test` to verify new tests pass

## Examples

```
/qa full
/qa smoke --pass1-only
/qa script 07
/qa pre-release --generate-tests
/qa full --no-recorder
/qa pass2-only    # review existing screenshots without re-running the app
```
