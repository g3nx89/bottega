/**
 * Subagent orchestrator — runs subagents in parallel and aggregates results.
 *
 * Design: pure data collector. No semantic deduplication or contradiction detection.
 * The parent LLM reconciles findings with full conversational awareness.
 */

import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../../figma/logger.js';
import type { AgentInfra } from '../agent.js';
import type { ScopedConnector } from '../scoped-connector.js';
import type { ToolDeps } from '../tools/index.js';
import type { SubagentSettings } from './config.js';
import { formatBriefing, prefetchCommonContext } from './context-prefetch.js';
import { getJudgeDefinition } from './judge-registry.js';
import { createReadOnlyTools } from './read-only-tools.js';
import { createSubagentSession } from './session-factory.js';
import { writeSubagentLog } from './session-logger.js';
import { getMicroJudgeCriterionPrompt, getMicroJudgeSystemPrompt, getSystemPrompt } from './system-prompts.js';
import type {
  AggregatedBatchResult,
  BatchResult,
  MicroJudgeId,
  MicroVerdict,
  PrefetchedContext,
  SubagentContext,
  SubagentProgressEvent,
  SubagentResult,
  SubagentRole,
} from './types.js';

const log = createChildLogger({ component: 'subagent-orchestrator' });

const MAX_OUTPUT_CHARS = 50_000;

interface SubagentRequest {
  role: SubagentRole;
  context: SubagentContext;
}

/**
 * Run a batch of subagents in parallel.
 * Pre-fetches common context once, then spawns all subagents concurrently.
 */
export async function runSubagentBatch(
  infra: AgentInfra,
  connector: ScopedConnector,
  requests: SubagentRequest[],
  settings: SubagentSettings,
  batchId: string,
  signal: AbortSignal,
  onProgress: (event: SubagentProgressEvent) => void,
): Promise<BatchResult> {
  const batchStart = Date.now();

  if (requests.length === 0) {
    return { batchId, results: [], totalDurationMs: 0, aborted: false };
  }

  // Build read-only tools sharing the same ScopedConnector
  const toolDeps: ToolDeps = {
    connector,
    figmaAPI: infra.figmaAPI,
    operationQueue: infra.queueManager.getQueue(connector.fileKey),
    wsServer: infra.wsServer,
    designSystemCache: infra.designSystemCache,
    configManager: infra.configManager,
    fileKey: connector.fileKey,
  };
  const readOnlyTools = createReadOnlyTools(toolDeps);

  // Pre-fetch common context (degraded mode if this fails)
  let briefing = 'No pre-fetched data available. Start with direct observation.';
  try {
    if (signal.aborted) {
      return { batchId, results: [], totalDurationMs: Date.now() - batchStart, aborted: true };
    }
    const prefetched = await prefetchCommonContext(readOnlyTools, signal);
    briefing = formatBriefing(prefetched);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      return { batchId, results: [], totalDurationMs: Date.now() - batchStart, aborted: true };
    }
    log.warn({ err, batchId }, 'Pre-fetch failed, running subagents without briefing');
  }

  // Spawn all subagents in parallel
  const subagentPromises = requests.map((req) =>
    runSingleSubagent(infra, readOnlyTools, req, settings, briefing, batchId, signal, onProgress),
  );

  const settled = await Promise.allSettled(subagentPromises);
  const results: SubagentResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const role = requests[i]?.role ?? 'scout';
    return {
      role,
      subagentId: `${batchId}-${role}-error`,
      status: 'error' as const,
      durationMs: Date.now() - batchStart,
      error: (s.reason as Error)?.message ?? 'Unknown error',
    };
  });

  // Write diagnostic logs (best-effort, never throws)
  for (const r of results) {
    writeSubagentLog(batchId, r.role, [{ ...r, batchId }]).catch(() => {});
  }

  return {
    batchId,
    results,
    totalDurationMs: Date.now() - batchStart,
    aborted: signal.aborted,
  };
}

/** Run a single subagent and collect its output. */
async function runSingleSubagent(
  infra: AgentInfra,
  tools: import('@mariozechner/pi-coding-agent').ToolDefinition[],
  request: SubagentRequest,
  settings: SubagentSettings,
  briefing: string,
  batchId: string,
  signal: AbortSignal,
  onProgress: (event: SubagentProgressEvent) => void,
): Promise<SubagentResult> {
  const { role, context } = request;
  const subagentId = `${batchId}-${role}-${randomUUID().slice(0, 8)}`;
  const start = Date.now();

  onProgress({ batchId, subagentId, role, type: 'spawned' });

  if (signal.aborted) {
    return { role, subagentId, status: 'aborted', durationMs: Date.now() - start };
  }

  try {
    const modelConfig = settings.models[role];
    const systemPrompt = getSystemPrompt(role);
    const sessionResult = await createSubagentSession(infra, tools, modelConfig, systemPrompt);
    const session = sessionResult.session;

    // Single subscription for both progress reporting and output collection
    let output = '';
    session.subscribe((event: any) => {
      if (signal.aborted) return;
      if (event.type === 'tool_execution_start') {
        onProgress({ batchId, subagentId, role, type: 'tool-start', toolName: event.toolName });
      }
      if (event.type === 'tool_execution_end') {
        onProgress({ batchId, subagentId, role, type: 'tool-end', toolName: event.toolName });
      }
      if (event.assistantMessageEvent?.type === 'text_delta') {
        output += event.assistantMessageEvent.delta;
      }
    });

    await session.newSession();

    // Build the prompt with briefing and task context
    const promptParts = [briefing];
    if (context.scope) {
      promptParts.push(`\n## Scope\n${JSON.stringify(context.scope)}`);
    }
    if (context.criteria) {
      promptParts.push(`\n## Evaluation Criteria\n${context.criteria}`);
    }
    if (context.claim) {
      promptParts.push(`\n## Claim to Verify\n${context.claim}`);
    }
    promptParts.push(`\n## Task\n${context.task}`);

    const prompt = promptParts.join('\n');

    // Abort propagation
    const abortHandler = () => {
      session.abort().catch(() => {});
    };
    signal.addEventListener('abort', abortHandler, { once: true });

    try {
      await session.prompt(prompt);
    } finally {
      signal.removeEventListener('abort', abortHandler);
      // Explicit cleanup: abort ephemeral session to release resources
      session.abort().catch(() => {});
    }

    if (signal.aborted) {
      return {
        role,
        subagentId,
        status: 'aborted',
        durationMs: Date.now() - start,
        output: output.slice(0, MAX_OUTPUT_CHARS),
      };
    }

    // Truncate overly large output
    const truncatedOutput =
      output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]' : output;

    const result: SubagentResult = {
      role,
      subagentId,
      status: 'completed',
      output: truncatedOutput,
      durationMs: Date.now() - start,
    };

    // Parse judge verdict if this is a judge role
    if (role === 'judge') {
      result.verdict = parseJudgeVerdict(truncatedOutput);
    }

    onProgress({ batchId, subagentId, role, type: 'completed', summary: result.verdict?.verdict ?? 'done' });
    log.info({ subagentId, role, durationMs: result.durationMs }, 'Subagent completed');
    return result;
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError' || signal.aborted) {
      return { role, subagentId, status: 'aborted', durationMs: Date.now() - start };
    }
    const errorMsg = (err as Error)?.message ?? 'Unknown error';
    log.error({ err, subagentId, role }, 'Subagent error');
    onProgress({ batchId, subagentId, role, type: 'error', summary: errorMsg });
    return { role, subagentId, status: 'error', durationMs: Date.now() - start, error: errorMsg };
  }
}

/** Parse JSON verdict from judge output, with graceful fallback. */
function isValidVerdict(v: any): boolean {
  return (
    (v.verdict === 'PASS' || v.verdict === 'FAIL') &&
    Array.isArray(v.criteria) &&
    Array.isArray(v.actionItems) &&
    typeof v.summary === 'string'
  );
}

function parseJudgeVerdict(output: string): import('./types.js').JudgeVerdict {
  // Happy path: output is pure JSON as instructed
  try {
    const parsed = JSON.parse(output.trim());
    if (isValidVerdict(parsed)) return parsed;
  } catch {
    // Fall through to extraction
  }

  // Fallback: find first '{' and try progressively smaller slices
  try {
    const start = output.indexOf('{');
    if (start !== -1) {
      for (let end = output.lastIndexOf('}'); end > start; end = output.lastIndexOf('}', end - 1)) {
        try {
          const parsed = JSON.parse(output.slice(start, end + 1));
          if (isValidVerdict(parsed)) return parsed;
        } catch {
          // try smaller slice
        }
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback for malformed judge responses
  return {
    verdict: 'FAIL',
    criteria: [
      {
        name: 'parse_error',
        pass: false,
        finding: 'Malformed judge response',
        evidence: output.slice(0, 500),
      },
    ],
    actionItems: ['Re-run quality check'],
    summary: 'Malformed judge response — could not parse structured verdict.',
  };
}

// ── Micro-Judge Batch ────────────────────────────────────────────────

/**
 * Run a batch of micro-judges in parallel.
 * Each judge is a zero-tool, single-turn session that evaluates one criterion.
 * P-001: All judges launch simultaneously — no sequential stagger.
 * P-003: Per-judge timeout of 15s prevents slow judges from blocking the batch.
 */
const PER_JUDGE_TIMEOUT_MS = 30_000;

/** Create a skip/error verdict for a micro-judge that didn't evaluate. */
function makeSkipVerdict(
  judgeId: MicroJudgeId,
  status: 'timeout' | 'error',
  finding: string,
  start: number,
): MicroVerdict {
  return { judgeId, pass: true, finding, evidence: '', actionItems: [], status, durationMs: Date.now() - start };
}

export async function runMicroJudgeBatch(
  infra: AgentInfra,
  judgeIds: MicroJudgeId[],
  prefetchedData: PrefetchedContext,
  settings: SubagentSettings,
  taskContext: string,
  batchId: string,
  signal: AbortSignal,
  onProgress: (event: SubagentProgressEvent) => void,
): Promise<MicroVerdict[]> {
  const systemPrompt = getMicroJudgeSystemPrompt();

  const promises = judgeIds.map(async (judgeId): Promise<MicroVerdict> => {
    const subagentId = `${batchId}-${judgeId}-${randomUUID().slice(0, 8)}`;
    const start = Date.now();

    onProgress({ batchId, subagentId, role: 'judge', type: 'spawned', summary: judgeId });

    if (signal.aborted) {
      return makeSkipVerdict(judgeId, 'timeout', 'Aborted', start);
    }

    // P-003: Per-judge timeout — declared outside try for catch access
    const judgeSignal = AbortSignal.any([signal, AbortSignal.timeout(PER_JUDGE_TIMEOUT_MS)]);

    try {
      const def = getJudgeDefinition(judgeId);
      const modelConfig = settings.microJudges[judgeId]?.model ?? {
        provider: 'anthropic',
        modelId: def.defaultModel,
      };

      // Create zero-tool session with low thinking
      const sessionResult = await createSubagentSession(
        infra,
        [], // Zero tools — micro-judges don't call tools
        modelConfig,
        systemPrompt,
        'low', // Light thinking for speed
      );
      const session = sessionResult.session;

      // Collect output
      let output = '';
      session.subscribe((event: any) => {
        if (judgeSignal.aborted) return;
        if (event.assistantMessageEvent?.type === 'text_delta') {
          output += event.assistantMessageEvent.delta;
        }
      });

      await session.newSession();

      // Build user prompt with criterion instructions + relevant data
      const criterionPrompt = getMicroJudgeCriterionPrompt(judgeId);
      const dataSections: string[] = [];

      if (prefetchedData.fileData && def.dataNeeds.includes('fileData')) {
        dataSections.push(`## File Data\n${prefetchedData.fileData.slice(0, 15_000)}`);
      }
      // Screenshot is passed as an image attachment via session.prompt({ images }), not as text
      const hasScreenshot = prefetchedData.screenshot && def.dataNeeds.includes('screenshot');
      if (hasScreenshot) {
        dataSections.push(
          '## Screenshot\nA screenshot of the current design is attached as an image. Evaluate visually.',
        );
      }
      if (prefetchedData.lint && def.dataNeeds.includes('lint')) {
        dataSections.push(`## Lint Results\n${prefetchedData.lint.slice(0, 5_000)}`);
      }
      if (prefetchedData.designSystem && def.dataNeeds.includes('designSystem')) {
        dataSections.push(`## Design System\n${prefetchedData.designSystem.slice(0, 5_000)}`);
      }
      if (prefetchedData.libraryComponents && def.dataNeeds.includes('libraryComponents')) {
        dataSections.push(`## Library Components\n${prefetchedData.libraryComponents.slice(0, 5_000)}`);
      }
      if (prefetchedData.componentAnalysis && judgeId === 'componentization') {
        dataSections.push(
          `## Component Analysis (pre-computed)\n${JSON.stringify(prefetchedData.componentAnalysis, null, 2).slice(0, 10_000)}`,
        );
      }

      const userPrompt = [criterionPrompt, `\n## Task Context\n${taskContext}`, ...dataSections].join('\n\n');

      // P-003: Abort propagation using per-judge signal (includes timeout)
      const abortHandler = () => {
        session.abort().catch(() => {});
      };
      judgeSignal.addEventListener('abort', abortHandler, { once: true });

      try {
        const promptOptions = hasScreenshot ? { images: [prefetchedData.screenshot!] } : undefined;
        await session.prompt(userPrompt, promptOptions);
      } finally {
        judgeSignal.removeEventListener('abort', abortHandler);
        session.abort().catch(() => {});
      }

      if (judgeSignal.aborted) {
        return makeSkipVerdict(judgeId, 'timeout', 'Timed out or aborted', start);
      }

      // Parse JSON micro-verdict
      const parsed = parseMicroVerdict(output, judgeId);
      const durationMs = Date.now() - start;

      onProgress({
        batchId,
        subagentId,
        role: 'judge',
        type: 'completed',
        summary: `${judgeId}:${parsed.pass ? 'PASS' : 'FAIL'}`,
      });
      log.info({ subagentId, judgeId, pass: parsed.pass, durationMs }, 'Micro-judge completed');

      return { ...parsed, durationMs };
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || judgeSignal.aborted || signal.aborted) {
        const reason = judgeSignal.aborted && !signal.aborted ? 'Per-judge timeout (30s)' : 'Aborted';
        return makeSkipVerdict(judgeId, 'timeout', reason, start);
      }
      log.error({ err, judgeId, batchId }, 'Micro-judge error');
      onProgress({ batchId, subagentId, role: 'judge', type: 'error', summary: (err as Error)?.message });
      return makeSkipVerdict(judgeId, 'error', (err as Error)?.message ?? 'Unknown error', start);
    }
  });

  const settled = await Promise.allSettled(promises);
  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      judgeId: judgeIds[i]!,
      pass: true,
      finding: (s.reason as Error)?.message ?? 'Unknown error',
      evidence: '',
      actionItems: [],
      status: 'error' as const,
      durationMs: 0,
    };
  });
}

/** Parse a micro-verdict JSON from judge output. */
function parseMicroVerdict(output: string, judgeId: MicroJudgeId): MicroVerdict {
  const trimmed = output.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.pass === 'boolean') {
      return {
        judgeId,
        pass: parsed.pass,
        finding: String(parsed.finding ?? ''),
        evidence: String(parsed.evidence ?? ''),
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
        status: 'evaluated',
        durationMs: 0,
      };
    }
  } catch {
    // Fall through
  }

  // Fallback: extract JSON from text
  try {
    const start = trimmed.indexOf('{');
    if (start !== -1) {
      for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1));
          if (typeof parsed.pass === 'boolean') {
            return {
              judgeId,
              pass: parsed.pass,
              finding: String(parsed.finding ?? ''),
              evidence: String(parsed.evidence ?? ''),
              actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
              status: 'evaluated',
              durationMs: 0,
            };
          }
        } catch {
          // try smaller
        }
      }
    }
  } catch {
    // Fall through
  }

  // Could not parse — return error verdict (does not cause FAIL)
  return {
    judgeId,
    pass: true,
    finding: `Parse error: could not extract verdict from output`,
    evidence: trimmed.slice(0, 300),
    actionItems: [],
    status: 'error',
    durationMs: 0,
  };
}

/** Aggregate results into a structured summary — pure structural, no interpretation. */
export function aggregateResults(results: SubagentResult[]): AggregatedBatchResult {
  return {
    results: results.map((r) => ({
      role: r.role,
      status: r.status,
      output: r.output,
      verdict: r.verdict,
      durationMs: r.durationMs,
      error: r.error,
    })),
    summary: {
      total: results.length,
      completed: results.filter((r) => r.status === 'completed').length,
      errors: results.filter((r) => r.status === 'error').length,
      aborted: results.filter((r) => r.status === 'aborted').length,
    },
  };
}
