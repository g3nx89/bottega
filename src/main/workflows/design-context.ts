/**
 * Context builder with state machine transitions for design workflow context.
 *
 * Determines the interaction mode, governance policy, and library context
 * based on DS status and user intent signals.
 */

import type { DesignWorkflowContext, GovernancePolicy, InteractionMode } from './types.js';

export interface ContextInput {
  dsStatus: 'unknown' | 'none' | 'partial' | 'active';
  dsRecentlyModified?: boolean;
  userMessage?: string;
  previousMode?: InteractionMode;
  modeBeforeReview?: InteractionMode;
  libraryContext?: 'none' | 'linked' | 'dominant';
  profileDirectives?: string[];
}

// Keyword sets for intent detection
const REVIEW_KEYWORDS = ['check', 'audit', 'lint', 'review', 'controlla', 'verifica'];
const FREEFORM_KEYWORDS = ['no ds', 'skip ds', 'without design system', 'senza ds'];
const DS_SETUP_KEYWORDS = ['setup ds', 'create tokens', 'imposta tokens', 'crea design system'];
const DS_APPROVAL_KEYWORDS = ['ok', 'procedi', 'approve', 'sì', 'yes', 'go ahead'];

function messageContains(message: string, keywords: string[]): boolean {
  const lower = message.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * State machine for interaction mode transitions.
 *
 * Rules (in priority order):
 * 1.  session start + dsStatus=none → bootstrap
 * 2.  session start + dsStatus=partial → socratic
 * 3.  session start + dsStatus=active → execution
 * 4.  bootstrap + user approves DS plan → socratic
 * 5.  socratic + last DS decision confirmed → execution
 * 6.  execution + value not in DS / user asks DS change → socratic
 * 7.  any + user asks audit/lint/check → review
 * 8.  review + review completed → previous mode
 * 9.  any + user opts out of DS → freeform
 * 10. freeform + user asks DS setup → bootstrap
 */
function resolveInteractionMode(input: ContextInput): InteractionMode {
  const msg = input.userMessage ?? '';
  const prev = input.previousMode;

  // Rule 9 (opt-out to freeform) — high priority, check first
  if (messageContains(msg, FREEFORM_KEYWORDS)) {
    return 'freeform';
  }

  // Rule 10 (freeform → bootstrap on DS setup request)
  if (prev === 'freeform' && messageContains(msg, DS_SETUP_KEYWORDS)) {
    return 'bootstrap';
  }

  // Rule 7 (any → review on audit request)
  if (messageContains(msg, REVIEW_KEYWORDS)) {
    return 'review';
  }

  // Rule 8 (review → previous mode on completion)
  // We interpret "review completed" as: we were in review and the message is an approval
  if (prev === 'review' && messageContains(msg, DS_APPROVAL_KEYWORDS)) {
    return input.modeBeforeReview ?? 'execution';
  }

  // Session start transitions (no previousMode)
  if (!prev) {
    // Rules 1, 2, 3
    if (input.dsStatus === 'none' || input.dsStatus === 'unknown') return 'bootstrap';
    if (input.dsStatus === 'partial') return 'socratic';
    if (input.dsStatus === 'active') return 'execution';
    return 'execution';
  }

  // Rule 4 (bootstrap → socratic on approval)
  if (prev === 'bootstrap' && messageContains(msg, DS_APPROVAL_KEYWORDS)) {
    return 'socratic';
  }

  // Rule 5 (socratic → execution on confirmation)
  if (prev === 'socratic' && messageContains(msg, DS_APPROVAL_KEYWORDS)) {
    return 'execution';
  }

  // Rule 6 (execution → socratic on DS change request)
  if (prev === 'execution' && messageContains(msg, DS_SETUP_KEYWORDS)) {
    return 'socratic';
  }

  return prev;
}

function resolveGovernancePolicy(mode: InteractionMode, dsStatus: ContextInput['dsStatus']): GovernancePolicy {
  if (mode === 'freeform') return 'freeform';
  if (mode === 'bootstrap') return 'adaptive';
  if (dsStatus === 'active') return 'strict';
  return 'adaptive';
}

export function buildDesignWorkflowContext(input: ContextInput): DesignWorkflowContext {
  const interactionMode = resolveInteractionMode(input);
  const governancePolicy = resolveGovernancePolicy(interactionMode, input.dsStatus);

  return {
    dsStatus: input.dsStatus,
    dsRecentlyModified: input.dsRecentlyModified ?? false,
    interactionMode,
    governancePolicy,
    libraryContext: input.libraryContext ?? 'none',
    profileDirectives: input.profileDirectives ?? [],
  };
}
