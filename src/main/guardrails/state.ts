/**
 * Per-session guardrails state — dedup scoped to the full agent cycle
 * (agent_start → agent_end), i.e. ONE user request. First match of a given
 * ruleId asks the user; subsequent same-rule matches auto-allow for the
 * rest of the same request. Block decisions are NOT remembered, so the
 * agent gets prompted again if it retries the same tool this request.
 * Dedup resets on the next `agent_start`.
 */

import type { ConfirmDecision, RuleId } from './types.js';

export interface GuardrailsState {
  approvedThisRequest: Set<RuleId>;
}

export function createState(): GuardrailsState {
  return { approvedThisRequest: new Set() };
}

export function onAgentStart(state: GuardrailsState): void {
  state.approvedThisRequest.clear();
}

export function rememberDecision(state: GuardrailsState, ruleId: RuleId, decision: ConfirmDecision): void {
  if (decision === 'allow-once') {
    state.approvedThisRequest.add(ruleId);
  }
}

export function isAlreadyApproved(state: GuardrailsState, ruleId: RuleId): boolean {
  return state.approvedThisRequest.has(ruleId);
}
