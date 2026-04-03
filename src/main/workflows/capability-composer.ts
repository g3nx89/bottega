/**
 * Capability composer — merges multiple capabilities into a single composed result.
 *
 * Rules:
 * 1. Concatenate promptFragments with newline separator
 * 2. Union preferred/forbidden, deduplicate
 * 3. If a tool appears in both preferred AND forbidden → remove from preferred (forbidden wins)
 * 4. Merge constraints (last wins for same key)
 * 5. Deduplicate validation rules and referenceDocIds
 */

import { getCapability } from './capabilities.js';
import type { ValidationCheck, WorkflowCapabilityId } from './types.js';

export interface ComposedCapabilities {
  promptFragment: string;
  toolGuidance: {
    preferred: string[];
    forbidden: string[];
    constraints: Record<string, string>;
  };
  validationRules: {
    afterMutation: ValidationCheck[];
    afterMilestone: ValidationCheck[];
  };
  referenceDocIds: string[];
}

function deduplicateChecks(checks: ValidationCheck[]): ValidationCheck[] {
  const seen = new Set<string>();
  return checks.filter((c) => {
    const key = `${c.type}:${c.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function composeCapabilities(ids: WorkflowCapabilityId[]): ComposedCapabilities {
  const fragments: string[] = [];
  const preferredSet = new Set<string>();
  const forbiddenSet = new Set<string>();
  const constraints: Record<string, string> = {};
  const afterMutation: ValidationCheck[] = [];
  const afterMilestone: ValidationCheck[] = [];
  const refDocIds = new Set<string>();

  for (const id of ids) {
    const cap = getCapability(id);

    fragments.push(cap.promptFragment);

    for (const t of cap.toolGuidance.preferred) preferredSet.add(t);
    for (const t of cap.toolGuidance.forbidden) forbiddenSet.add(t);
    Object.assign(constraints, cap.toolGuidance.constraints);

    afterMutation.push(...cap.validationRules.afterMutation);
    afterMilestone.push(...cap.validationRules.afterMilestone);

    for (const docId of cap.referenceDocIds) refDocIds.add(docId);
  }

  // Forbidden wins over preferred
  for (const t of forbiddenSet) {
    preferredSet.delete(t);
  }

  return {
    promptFragment: fragments.join('\n'),
    toolGuidance: {
      preferred: Array.from(preferredSet),
      forbidden: Array.from(forbiddenSet),
      constraints,
    },
    validationRules: {
      afterMutation: deduplicateChecks(afterMutation),
      afterMilestone: deduplicateChecks(afterMilestone),
    },
    referenceDocIds: Array.from(refDocIds),
  };
}
