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

/** Image content for multimodal prompts (matches Pi SDK ImageContent shape). */
export interface ScreenshotImage {
  type: 'image';
  data: string;
  mimeType: string;
}

/** Pre-fetched context shared across all subagents in a batch. */
export interface PrefetchedContext {
  screenshot: ScreenshotImage | null;
  fileData: string | null;
  designSystem: string | null;
  lint: string | null;
  libraryComponents: string | null;
  componentAnalysis: ComponentAnalysis | null;
}

// ── Micro-Judge Types ────────────────────────────────────────────────

/** The 7 specialized micro-judges. */
export type MicroJudgeId =
  | 'alignment'
  | 'token_compliance'
  | 'visual_hierarchy'
  | 'completeness'
  | 'consistency'
  | 'naming'
  | 'componentization';

/** Output of a single micro-judge evaluation. */
export interface MicroVerdict {
  judgeId: MicroJudgeId;
  pass: boolean;
  finding: string;
  evidence: string;
  actionItems: string[];
  status: 'evaluated' | 'timeout' | 'error';
  durationMs: number;
}

/** Activation tier — determines which judges run based on complexity. */
export type ActivationTier = 'full' | 'standard' | 'minimal' | 'visual' | 'narrow';

/** Data keys available for selective prefetch. */
export type PrefetchDataKey = 'screenshot' | 'fileData' | 'lint' | 'designSystem' | 'libraryComponents';

// ── Component Analysis Types ─────────────────────────────────────────

/** A group of structurally identical subtrees within a single screen. */
export interface WithinScreenDuplicates {
  screenName: string;
  fingerprint: string;
  nodeNames: string[];
  count: number;
}

/** A structural or name match across different screens. */
export interface CrossScreenMatch {
  fingerprint: string;
  screens: Array<{ screenName: string; nodeName: string }>;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchType: 'struct+name' | 'struct_only' | 'name+relaxed' | 'name_only';
}

/** A node that looks like it should be a library component but isn't. */
export interface LibraryMiss {
  nodeName: string;
  screenName: string;
  matchedComponentName: string;
  similarity: number;
}

/** A node that appears to be a detached component instance. */
export interface DetachedInstance {
  nodeName: string;
  screenName: string;
}

/** Statistics from component analysis. */
export interface ComponentStats {
  totalScreens: number;
  totalNodes: number;
  instanceCount: number;
  componentizationRatio: number;
}

/** Full component analysis report — preprocessed for the componentization judge. */
export interface ComponentAnalysis {
  withinScreen: WithinScreenDuplicates[];
  crossScreen: CrossScreenMatch[];
  libraryMisses: LibraryMiss[];
  detachedInstances: DetachedInstance[];
  stats: ComponentStats;
}
