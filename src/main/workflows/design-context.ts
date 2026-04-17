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

function resolveInitialMode(dsStatus: ContextInput['dsStatus']): InteractionMode {
  // Rules 1, 2, 3 — session start transitions
  if (dsStatus === 'none' || dsStatus === 'unknown') return 'bootstrap';
  if (dsStatus === 'partial') return 'socratic';
  return 'execution';
}

function resolvePreviousModeTransition(prev: InteractionMode, msg: string): InteractionMode {
  // Rule 4: bootstrap → socratic on approval
  if (prev === 'bootstrap' && messageContains(msg, DS_APPROVAL_KEYWORDS)) return 'socratic';
  // Rule 5: socratic → execution on confirmation
  if (prev === 'socratic' && messageContains(msg, DS_APPROVAL_KEYWORDS)) return 'execution';
  // Rule 6: execution → socratic on DS change request
  if (prev === 'execution' && messageContains(msg, DS_SETUP_KEYWORDS)) return 'socratic';
  return prev;
}

/**
 * State machine for interaction mode transitions.
 *
 * Rules (priority order):
 * 9.  any + opt-out DS → freeform
 * 10. freeform + DS setup request → bootstrap
 * 7.  any + audit/lint/check → review
 * 8.  review + approval → previous mode
 * 1-3. session start → bootstrap | socratic | execution (by dsStatus)
 * 4-6. prev-dependent approval/setup transitions
 */
function resolveInteractionMode(input: ContextInput): InteractionMode {
  const msg = input.userMessage ?? '';
  const prev = input.previousMode;

  if (messageContains(msg, FREEFORM_KEYWORDS)) return 'freeform';
  if (prev === 'freeform' && messageContains(msg, DS_SETUP_KEYWORDS)) return 'bootstrap';
  if (messageContains(msg, REVIEW_KEYWORDS)) return 'review';
  if (prev === 'review' && messageContains(msg, DS_APPROVAL_KEYWORDS)) {
    return input.modeBeforeReview ?? 'execution';
  }
  if (!prev) return resolveInitialMode(input.dsStatus);
  return resolvePreviousModeTransition(prev, msg);
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
