/**
 * Guardrails shared types. Kept separate from rules.ts so the renderer
 * bundle can import them via preload without pulling in rule logic or
 * connector deps.
 */

export type RuleId = 'bulk-delete' | 'main-ds-component' | 'variable-delete-via-execute' | 'detach-main-instance';

export interface RuleMatch {
  ruleId: RuleId;
  description: string;
  toolName: string;
  affectedLabel: string;
  /** For diagnostics/logging only — raw shape depends on tool. */
  input: Record<string, unknown>;
  /** Optional override for the confirm-bus timeout (ms). Falls back to the bus default when omitted. */
  confirmTimeoutMs?: number;
}

export interface ConfirmRequest {
  requestId: string;
  slotId: string;
  match: RuleMatch;
  timestamp: number;
}

export type ConfirmDecision = 'allow-once' | 'block';

export interface ConfirmResponse {
  requestId: string;
  decision: ConfirmDecision;
}
