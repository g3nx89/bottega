/**
 * Static registry of 10 workflow capabilities.
 * Each capability defines prompt fragments, tool guidance, validation rules, and reference doc IDs.
 */

import type { WorkflowCapability, WorkflowCapabilityId } from './types.js';

export const CAPABILITIES: Record<WorkflowCapabilityId, WorkflowCapability> = {
  'ds-read': {
    id: 'ds-read',
    name: 'Design System Read',
    description: 'Read DS context before any creation operation',
    promptFragment:
      "Read DS context before any creation. Call figma_design_system first. If dsStatus='none', suggest bootstrap.",
    toolGuidance: {
      preferred: ['figma_design_system', 'figma_search_components'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [{ type: 'structural', description: 'Verify DS context was loaded before mutations' }],
    },
    referenceDocIds: [],
  },

  'ds-write': {
    id: 'ds-write',
    name: 'Design System Write',
    description: 'Update DS at both levels: tokens + DS page',
    promptFragment:
      'ALWAYS update BOTH levels (tokens + DS page) + forceRefresh after. NEVER use figma_execute for DS.',
    toolGuidance: {
      preferred: ['figma_setup_tokens', 'figma_update_ds_page'],
      forbidden: ['figma_execute'],
      constraints: {},
    },
    validationRules: {
      afterMutation: [{ type: 'structural', description: 'Verify DS page updated after token changes' }],
      afterMilestone: [],
    },
    referenceDocIds: ['ds-write-guide'],
  },

  'ds-lint': {
    id: 'ds-lint',
    name: 'Design System Lint',
    description: 'Use figma_lint as quality gate with 3-section report',
    promptFragment:
      'Use figma_lint for quality gate. 3-section report: dsCheck, bestPractices, figmaLint. In review mode: lint FIRST, screenshot AFTER.',
    toolGuidance: {
      preferred: ['figma_lint'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [{ type: 'structural', description: 'Run lint check after each milestone' }],
    },
    referenceDocIds: [],
  },

  'ds-proactive': {
    id: 'ds-proactive',
    name: 'Design System Proactive Governance',
    description: 'Proactively suggest DS updates and componentization',
    promptFragment: 'Value not in DS → ask user before adding. Pattern repeated 3+ times → suggest componentization.',
    toolGuidance: {
      preferred: ['figma_design_system'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [],
    },
    referenceDocIds: [],
  },

  'ds-bootstrap': {
    id: 'ds-bootstrap',
    name: 'Design System Bootstrap',
    description: 'Bootstrap a new design system from existing conventions',
    promptFragment: 'Analyze existing conventions. Propose token taxonomy. Fork from linked library if available.',
    toolGuidance: {
      preferred: ['figma_design_system', 'figma_setup_tokens', 'figma_update_ds_page'],
      forbidden: ['figma_execute'],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [{ type: 'structural', description: 'Verify token taxonomy is complete' }],
    },
    referenceDocIds: ['ds-bootstrap-guide'],
  },

  'component-reuse': {
    id: 'component-reuse',
    name: 'Component Reuse',
    description: 'Search before creating, use setProperties for text overrides',
    promptFragment: 'ALWAYS search before creating. Use setProperties() for text overrides, not node.characters.',
    toolGuidance: {
      preferred: ['figma_search_components', 'figma_instantiate', 'figma_get_library_components'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [{ type: 'structural', description: 'Confirm component was reused not recreated' }],
    },
    referenceDocIds: [],
  },

  'library-fork': {
    id: 'library-fork',
    name: 'Library Fork',
    description: 'Propose local DS page complementing linked library',
    promptFragment: "Library detected → propose local DS page complementing it. Don't duplicate library tokens.",
    toolGuidance: {
      preferred: ['figma_get_library_components', 'figma_search_components'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [],
    },
    referenceDocIds: [],
  },

  'targeted-diff': {
    id: 'targeted-diff',
    name: 'Targeted Diff',
    description: 'Read structure first, apply minimal mutations',
    promptFragment: 'Read structure first, apply minimal mutations. Never recreate entire screen for small changes.',
    toolGuidance: {
      preferred: ['figma_get_file_data', 'figma_get_selection'],
      forbidden: [],
      constraints: {},
    },
    validationRules: {
      afterMutation: [{ type: 'structural', description: 'Verify only targeted nodes were modified' }],
      afterMilestone: [],
    },
    referenceDocIds: [],
  },

  'visual-validation': {
    id: 'visual-validation',
    name: 'Visual Validation',
    description: 'Screenshot + defect check after milestones, max 3 fix loops',
    promptFragment:
      'After milestones: screenshot + check for defects (clipped text, overlap, placeholder). Max 3 fix loops.',
    toolGuidance: {
      preferred: ['figma_screenshot', 'figma_get_file_data'],
      forbidden: [],
      constraints: { maxLoops: '3' },
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [
        { type: 'visual', description: 'Screenshot and check for clipped text' },
        { type: 'visual', description: 'Check for element overlap' },
        { type: 'visual', description: 'Check for placeholder content' },
      ],
    },
    referenceDocIds: [],
  },

  documentation: {
    id: 'documentation',
    name: 'Documentation',
    description: 'Create/update DS page sections with samples and rules in English',
    promptFragment: 'Create/update DS page sections [DS::*] with samples + rules. Always in English.',
    toolGuidance: {
      preferred: ['figma_update_ds_page'],
      forbidden: ['figma_set_text', 'figma_execute'],
      constraints: {},
    },
    validationRules: {
      afterMutation: [],
      afterMilestone: [{ type: 'structural', description: 'Verify DS page sections created in English' }],
    },
    referenceDocIds: ['documentation-guide'],
  },
};

export function getCapability(id: WorkflowCapabilityId): WorkflowCapability {
  return CAPABILITIES[id];
}
