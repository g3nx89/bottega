/**
 * Shared types for the read-only parallel subagent system.
 */

export type SubagentRole = 'scout' | 'analyst' | 'auditor' | 'judge';

export interface SubagentContext {
  task: string;
  scope?: { nodeIds?: string[]; pageId?: string; area?: string };
  /** Judge only: evaluation criteria. */
  criteria?: string;
  /** Judge only: what the parent agent claims it did. */
  claim?: string;
  /** Soft context from pre-fetch (screenshot + file_data + design_system). */
  briefing?: string;
}

export interface JudgeCriterion {
  name: string;
  pass: boolean;
  finding: string;
  evidence: string;
}

export interface JudgeVerdict {
  verdict: 'PASS' | 'FAIL';
  criteria: JudgeCriterion[];
  actionItems: string[];
  summary: string;
}

export interface SubagentResult {
  role: SubagentRole;
  subagentId: string;
  status: 'completed' | 'error' | 'aborted';
  output?: string;
  /** Judge role only. */
  verdict?: JudgeVerdict;
  durationMs: number;
  tokenUsage?: { input: number; output: number };
  error?: string;
}

export interface BatchResult {
  batchId: string;
  results: SubagentResult[];
  totalDurationMs: number;
  aborted: boolean;
}

export interface SubagentProgressEvent {
  batchId: string;
  subagentId: string;
  role: SubagentRole;
  type: 'spawned' | 'tool-start' | 'tool-end' | 'completed' | 'error';
  toolName?: string;
  summary?: string;
}

/** Aggregated batch result — pure structural grouping, no semantic interpretation. */
export interface AggregatedBatchResult {
  results: Array<{
    role: SubagentRole;
    status: 'completed' | 'error' | 'aborted';
    output?: string;
    verdict?: JudgeVerdict;
    durationMs: number;
    error?: string;
  }>;
  summary: {
    total: number;
    completed: number;
    errors: number;
    aborted: number;
  };
}

/** Pre-fetched context shared across all subagents in a batch. */
export interface PrefetchedContext {
  screenshot: string | null;
  fileData: string | null;
  designSystem: string | null;
}
