import type { WorkflowPack } from './types.js';

export interface ValidationRule {
  id: string;
  description: string;
  trigger: 'after-mutation' | 'after-milestone' | 'before-checkpoint';
  type: 'structural' | 'visual';
  check: string;
}

/** Universal rules that apply regardless of active pack. */
export const UNIVERSAL_RULES: ValidationRule[] = [
  {
    id: 'no-duplicate-creation',
    description: 'Search by name before creating any new element',
    trigger: 'after-mutation',
    type: 'structural',
    check: 'figma_search_components or figma_design_system was called before creation',
  },
  {
    id: 'discovery-before-create',
    description: 'Run discovery tools before creating new elements',
    trigger: 'after-mutation',
    type: 'structural',
    check: 'At least one discovery tool was called in the current turn',
  },
  {
    id: 'visual-defect-check',
    description: 'Check for visual defects at milestones',
    trigger: 'after-milestone',
    type: 'visual',
    check: 'No clipped text, overlapping content, placeholder text, or wrong colors',
  },
  {
    id: 'max-screenshot-loops',
    description: 'Limit screenshot/fix cycles',
    trigger: 'after-milestone',
    type: 'visual',
    check: 'Max 3 screenshot/fix loops per section',
  },
];

/**
 * Get all validation rules for a given context.
 * Combines universal rules with pack-specific rules.
 */
export function getValidationRules(pack: WorkflowPack | null, phaseId?: string): ValidationRule[] {
  const rules = [...UNIVERSAL_RULES];

  if (!pack) return rules;

  // Add pack-level validation rules from capabilities
  const policy = pack.validationPolicy;

  for (const check of policy.afterMutation) {
    rules.push({
      id: `pack-mutation-${check.description.slice(0, 30).replace(/\s/g, '-')}`,
      description: check.description,
      trigger: 'after-mutation',
      type: check.type,
      check: check.description,
    });
  }

  for (const check of policy.afterMilestone) {
    rules.push({
      id: `pack-milestone-${check.description.slice(0, 30).replace(/\s/g, '-')}`,
      description: check.description,
      trigger: 'after-milestone',
      type: check.type,
      check: check.description,
    });
  }

  // Add phase-specific exit criteria as validation checks
  if (phaseId) {
    const phase = pack.phases.find((p) => p.id === phaseId);
    if (phase) {
      for (const criterion of phase.exitCriteria) {
        rules.push({
          id: `phase-exit-${phaseId}-${criterion.slice(0, 20).replace(/\s/g, '-')}`,
          description: criterion,
          trigger: 'before-checkpoint',
          type: phase.validationType === 'visual' || phase.validationType === 'both' ? 'visual' : 'structural',
          check: criterion,
        });
      }
    }
  }

  return rules;
}

/**
 * Filter rules by trigger type.
 */
export function getRulesByTrigger(rules: ValidationRule[], trigger: ValidationRule['trigger']): ValidationRule[] {
  return rules.filter((r) => r.trigger === trigger);
}

/**
 * Get the max screenshot loops for a pack (or default of 3).
 */
export function getMaxScreenshotLoops(pack: WorkflowPack | null): number {
  return pack?.validationPolicy.maxScreenshotLoops ?? 3;
}

/**
 * Build judge criteria string from active validation rules.
 * This is injected into the judge subagent's system prompt.
 */
export function buildJudgeCriteria(pack: WorkflowPack | null, phaseId?: string): string {
  const rules = getValidationRules(pack, phaseId);
  const milestoneRules = getRulesByTrigger(rules, 'after-milestone');
  const checkpointRules = getRulesByTrigger(rules, 'before-checkpoint');

  const relevant = [...milestoneRules, ...checkpointRules];
  if (relevant.length === 0) return '';

  const lines = relevant.map((r) => `- [${r.type}] ${r.description}`);

  const header = pack
    ? `Validation criteria for "${pack.name}" workflow${phaseId ? ` (phase: ${phaseId})` : ''}:`
    : 'Validation criteria:';

  return `${header}\n${lines.join('\n')}`;
}

/**
 * Check if a set of tool names satisfies the required discovery checks.
 * Returns list of unsatisfied check IDs.
 */
export function checkRequiredDiscovery(toolNames: string[], pack: WorkflowPack | null): string[] {
  const requiredChecks = pack?.validationPolicy.requiredChecks ?? [];
  const unsatisfied: string[] = [];

  const discoveryTools = new Set([
    'figma_design_system',
    'figma_search_components',
    'figma_get_library_components',
    'figma_get_file_data',
    'figma_get_selection',
  ]);
  const hasDiscovery = toolNames.some((t) => discoveryTools.has(t));

  for (const check of requiredChecks) {
    if (check === 'discovery-before-create' && !hasDiscovery) {
      unsatisfied.push(check);
    }
    if (check === 'no-duplicate-creation') {
      const hasSearch = toolNames.some((t) => t === 'figma_search_components' || t === 'figma_design_system');
      const hasCreation = toolNames.some(
        (t) => t === 'figma_create_child' || t === 'figma_render_jsx' || t === 'figma_instantiate',
      );
      if (hasCreation && !hasSearch) {
        unsatisfied.push(check);
      }
    }
  }

  return unsatisfied;
}
