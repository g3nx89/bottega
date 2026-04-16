/**
 * End-to-end playbook test for the judge evidence pipeline.
 *
 * Exercises the full chain:
 *   runJudgeHarness
 *     → real prefetchForMicroJudges
 *     → real connector.executeCodeViaUI  (mocked to return golden-negative raw trees)
 *     → real computeJudgeEvidence analyzers
 *     → real runMicroJudgeBatch
 *     → real per-judge evidence slicing in the prompt
 *     → mocked createSubagentSession (captures the prompt + returns canned JSON)
 *
 * This is the single authoritative regression guard for the judge-evidence
 * contract. If any link in the chain breaks, one of these tests flips red.
 *
 * Only two things are mocked: the LLM session (via createSubagentSession) and
 * the plugin eval (via connector.executeCodeViaUI). Everything in between is
 * the real production code path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks: LLM session + logger only ────────────────────────────────────

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Capture prompts passed to each micro-judge session. Default verdict is PASS;
// individual tests override it per judge via `nextVerdictsByJudge`.
const capturedPrompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
let nextVerdictsByJudge: Map<string, any> = new Map();
let judgeCallOrder: string[] = [];

vi.mock('../../../src/main/subagent/session-factory.js', () => ({
  createSubagentSession: vi.fn().mockImplementation(async (_infra, _tools, _model, systemPrompt) => {
    let subscribeCb: ((event: any) => void) | null = null;
    return {
      session: {
        subscribe: vi.fn((cb: any) => {
          subscribeCb = cb;
        }),
        prompt: vi.fn().mockImplementation(async (userPrompt: string) => {
          capturedPrompts.push({ systemPrompt, userPrompt });
          const judgeId = detectJudgeIdFromPrompt(userPrompt);
          judgeCallOrder.push(judgeId);
          const verdict = nextVerdictsByJudge.get(judgeId) ?? {
            pass: true,
            finding: 'ok',
            evidence: '',
            actionItems: [],
          };
          if (subscribeCb) {
            subscribeCb({
              assistantMessageEvent: { type: 'text_delta', delta: JSON.stringify(verdict) },
            });
          }
        }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
    };
  }),
}));

/**
 * Detect the micro-judge from the criterion prompt content. We match on the
 * unique "## Criterion: X" header (each criterion uses a distinct label that
 * we control in system-prompts.ts).
 */
function detectJudgeIdFromPrompt(userPrompt: string): string {
  if (userPrompt.includes('## Criterion: Alignment')) return 'alignment';
  if (userPrompt.includes('## Criterion: Visual Hierarchy')) return 'visual_hierarchy';
  if (userPrompt.includes('## Criterion: Consistency')) return 'consistency';
  if (userPrompt.includes('## Criterion: Naming')) return 'naming';
  if (userPrompt.includes('## Criterion: Token Compliance')) return 'token_compliance';
  if (userPrompt.includes('## Criterion: Completeness')) return 'completeness';
  if (userPrompt.includes('## Criterion: Componentization')) return 'componentization';
  if (userPrompt.includes('## Criterion: Design Quality')) return 'design_quality';
  // Throw on unknown to prevent silent false positives — if the criterion header
  // format changes in system-prompts.ts, this will fail loudly instead of silently
  // using the default PASS verdict for every judge.
  throw new Error(
    `Could not detect judge ID from prompt. Header not found. Prompt starts with: ${userPrompt.slice(0, 200)}`,
  );
}

// read-only-tools returns an empty tool list — the prefetch still fetches evidence
// via connector.executeCodeViaUI (which bypasses the tools layer entirely).
vi.mock('../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn(() => []),
}));

import { DEFAULT_SUBAGENT_SETTINGS, type SubagentSettings } from '../../../src/main/subagent/config.js';
import type { EvidenceNode } from '../../../src/main/subagent/judge-evidence.js';
import { runJudgeHarness } from '../../../src/main/subagent/judge-harness.js';
import {
  autoNamedFrame,
  threeFlatTexts,
  threeInconsistentCards,
  threeMisalignedSquares,
  wellFormedCard,
} from '../../helpers/evidence-fixtures.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeInfra() {
  return {
    queueManager: { getQueue: () => ({}) },
    wsServer: {},
    figmaAPI: {},
    designSystemCache: {},
    configManager: {},
    authStorage: { getApiKey: vi.fn().mockResolvedValue('test-key') },
  } as any;
}

function makeConnector(rawTree: EvidenceNode[] | Error) {
  return {
    fileKey: 'test-file',
    executeCodeViaUI: vi.fn().mockImplementation(async () => {
      if (rawTree instanceof Error) throw rawTree;
      return rawTree;
    }),
  } as any;
}

function makeSlot() {
  return {
    id: 'slot-playbook',
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
    judgeOverride: null,
    lastTurnToolNames: [],
    // Token_compliance is skipped unless setup_tokens was called
    sessionToolHistory: new Set<string>(),
    taskStore: { create: vi.fn(), size: 0, list: vi.fn(() => []) },
  } as any;
}

const settings: SubagentSettings = {
  ...DEFAULT_SUBAGENT_SETTINGS,
  judgeMode: 'auto',
  autoRetry: false,
};

// ── Tests ───────────────────────────────────────────────────────────────

describe('Judge evidence pipeline — end-to-end', () => {
  beforeEach(() => {
    capturedPrompts.length = 0;
    nextVerdictsByJudge = new Map();
    judgeCallOrder = [];
  });

  it('alignment: 3 squares with y=[0,15,0] → alignment judge sees "misaligned" evidence and receives prompt to return FAIL', async () => {
    const connector = makeConnector(threeMisalignedSquares);
    // Script the alignment judge to return FAIL (what a calibrated LLM would produce)
    nextVerdictsByJudge.set('alignment', {
      pass: false,
      finding: '3 squares misaligned on y axis',
      evidence: 'maxDeviation=15, values=[0,15,0]',
      actionItems: ['Move node 1:3 to y=0'],
    });

    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'], // structural → standard tier
      ['1:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    // The connector was called for raw tree (component analysis) + evidence payload
    expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(2);
    // The evidence call targets the specific node (contains "1:1")
    const evidenceCall = (connector.executeCodeViaUI as any).mock.calls.find(([c]: [string]) => c.includes('"1:1"'));
    const [code] = evidenceCall;
    expect(code).toContain('"1:1"');

    // The alignment judge's prompt contained the real numeric evidence
    const alignmentPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Alignment'));
    expect(alignmentPrompt).toBeDefined();
    expect(alignmentPrompt!.userPrompt).toContain('## Pre-Computed Evidence');
    expect(alignmentPrompt!.userPrompt).toContain('"verdict": "misaligned"');
    expect(alignmentPrompt!.userPrompt).toContain('"maxDeviation": 15');

    // Per-criterion: alignment judge received evidence and returned FAIL
    const alignmentCriterion = verdict?.criteria.find((c) => c.name === 'alignment');
    expect(alignmentCriterion?.pass).toBe(false);
    expect(alignmentCriterion?.finding).toContain('misaligned');
    // Overall: alignment is a blocking criterion → overall FAIL
    expect(verdict?.verdict).toBe('FAIL');
  });

  it('visual_hierarchy: 3 flat 14px texts → judge sees "flat" + allSameStyle=true', async () => {
    const connector = makeConnector(threeFlatTexts);
    nextVerdictsByJudge.set('visual_hierarchy', {
      pass: false,
      finding: 'All text nodes share one style — no hierarchy',
      evidence: 'allSameStyle=true, textCount=3',
      actionItems: ['Increase Title to fontSize=24'],
    });

    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'],
      ['2:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    const vhPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Visual Hierarchy'));
    expect(vhPrompt).toBeDefined();
    expect(vhPrompt!.userPrompt).toContain('"allSameStyle": true');
    expect(vhPrompt!.userPrompt).toContain('"verdict": "flat"');
    const vhCriterion = verdict?.criteria.find((c) => c.name === 'visual_hierarchy');
    expect(vhCriterion?.pass).toBe(false);
    // visual_hierarchy with textCount=3 is minor severity → downgraded from blocking
    // → appears as suggestion, overall PASS (with suggestions)
    expect(verdict?.verdict).toBe('PASS');
  });

  it('consistency: 3 cards with padding=[16,24,16] → judge sees "inconsistent" paddingTop finding', async () => {
    const connector = makeConnector(threeInconsistentCards);
    nextVerdictsByJudge.set('consistency', {
      pass: false,
      finding: 'Cards padding inconsistent',
      evidence: 'paddingTop=[16,24,16]',
      actionItems: ['Set node 3:3 paddingTop to 16'],
    });

    // Use 'full' tier to activate consistency judge (5+ structural calls)
    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx', 'figma_create_child', 'figma_create_child', 'figma_create_child', 'figma_create_child'],
      ['3:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    const consistencyPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Consistency'));
    expect(consistencyPrompt).toBeDefined();
    expect(consistencyPrompt!.userPrompt).toContain('"property": "paddingTop"');
    // Values are pretty-printed across lines in JSON.stringify(..., null, 2)
    expect(consistencyPrompt!.userPrompt).toContain('16');
    expect(consistencyPrompt!.userPrompt).toContain('24');
    const consistencyCriterion = verdict?.criteria.find((c) => c.name === 'consistency');
    expect(consistencyCriterion?.pass).toBe(false);
    // consistency is blocking → overall FAIL
    expect(verdict?.verdict).toBe('FAIL');
  });

  it("naming: 'Frame 1' with 4 children → naming judge sees autoNamedFrames + framesWithoutAutoLayout", async () => {
    const connector = makeConnector(autoNamedFrame);
    nextVerdictsByJudge.set('naming', {
      pass: false,
      finding: 'Auto-named frame with no auto-layout',
      evidence: "autoNamedFrames=[{id:'4:1',name:'Frame 1'}]",
      actionItems: ['Rename node 4:1', 'Apply auto-layout'],
    });

    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'],
      ['4:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    const namingPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Naming'));
    expect(namingPrompt).toBeDefined();
    expect(namingPrompt!.userPrompt).toContain('"verdict": "hasAutoNames"');
    expect(namingPrompt!.userPrompt).toContain('"Frame 1"');
    expect(namingPrompt!.userPrompt).toContain('"framesWithoutAutoLayout"');
    const namingCriterion = verdict?.criteria.find((c) => c.name === 'naming');
    expect(namingCriterion?.pass).toBe(false);
  });

  it('well-formed design: all 4 evidence-backed judges receive positive verdicts → overall PASS', async () => {
    const connector = makeConnector(wellFormedCard);
    // No scripted FAIL verdicts — default PASS for every judge

    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'],
      ['5:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    // Evidence was extracted and all 4 judges received non-failing reports
    const alignmentPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Alignment'));
    expect(alignmentPrompt).toBeDefined();
    expect(alignmentPrompt!.userPrompt).toContain('## Pre-Computed Evidence');
    // The alignment report should NOT show findings — the single-column layout is aligned
    expect(alignmentPrompt!.userPrompt).toContain('"verdict": "aligned"');

    const vhPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Visual Hierarchy'));
    expect(vhPrompt!.userPrompt).toContain('"verdict": "hierarchical"');

    expect(verdict?.verdict).toBe('PASS');
  });

  it('degraded mode: executeCodeViaUI throws → judge still runs without evidence (no crash)', async () => {
    const connector = makeConnector(new Error('Figma plugin disconnected'));

    const verdict = await runJudgeHarness(
      makeInfra(),
      connector,
      makeSlot(),
      settings,
      ['figma_render_jsx'],
      ['1:1'],
      new AbortController().signal,
      { onProgress: vi.fn(), onVerdict: vi.fn(), onRetryStart: vi.fn() },
    );

    // The harness returned a verdict (did not throw)
    expect(verdict).not.toBeNull();

    // The alignment judge was still invoked — just without the evidence section
    const alignmentPrompt = capturedPrompts.find((p) => p.userPrompt.includes('## Criterion: Alignment'));
    expect(alignmentPrompt).toBeDefined();
    expect(alignmentPrompt!.userPrompt).not.toContain('## Pre-Computed Evidence');
  });
});
