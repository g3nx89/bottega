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
import { createReadOnlyTools } from './read-only-tools.js';
import { createSubagentSession } from './session-factory.js';
import { writeSubagentLog } from './session-logger.js';
import { getSystemPrompt } from './system-prompts.js';
import type {
  AggregatedBatchResult,
  BatchResult,
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
  signal: AbortSignal,
  onProgress: (event: SubagentProgressEvent) => void,
): Promise<BatchResult> {
  const batchId = randomUUID();
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
