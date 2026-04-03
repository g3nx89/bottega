import type { WorkflowPack } from '../types.js';

export const buildDesignSystemPack: WorkflowPack = {
  id: 'build-design-system',
  name: 'Build Design System',
  description: 'Bootstrap or extend a complete design system: tokens, components, DS page, and documentation.',
  triggers: [
    {
      keywords: [
        'imposta tokens',
        'costruisci libreria',
        'crea design system',
        'setup variables',
        'build component library',
        'setup tokens',
        'design system',
      ],
      intentCategory: 'ds-creation',
      confidence: 0.95,
    },
  ],
  capabilities: ['ds-bootstrap', 'ds-write', 'library-fork', 'ds-lint', 'documentation'],
  supportedModes: ['bootstrap', 'socratic', 'execution', 'review'],
  phases: [
    {
      id: 'discovery',
      name: 'Discovery',
      description:
        'Analyze existing file, linked libraries, and codebase conventions. Propose DS plan and get user approval.',
      mandatorySteps: [
        'Call figma_design_system to check existing DS status',
        'Call figma_get_file_data to inspect pages and existing structure',
        'Call figma_get_library_components to enumerate linked library tokens/components',
        'Analyze naming conventions, color patterns, spacing rhythm from existing content',
        'Propose token taxonomy and DS structure to user',
      ],
      exitCriteria: [
        'Existing conventions understood',
        'Linked libraries cataloged',
        'DS plan proposed and approved by user',
      ],
      antiPatterns: [
        'Overwriting existing tokens without checking current DS state',
        'Duplicating tokens already provided by a linked library',
        'Proceeding to foundations without user approval of the plan',
      ],
      userCheckpoint: true,
      validationType: 'structural',
    },
    {
      id: 'foundations',
      name: 'Foundations',
      description:
        'Create variable collections, modes, primitives, semantics, scopes, and code syntax. Validate with figma_lint.',
      mandatorySteps: [
        'Create variable collections with correct modes (Light/Dark, etc.)',
        'Define primitive tokens (raw color, spacing, radius, shadow values)',
        'Define semantic tokens that alias primitives (surface, on-surface, border, etc.)',
        'Set variable scopes and code syntax for each token',
        'Call figma_lint to validate token structure',
        'Every DS mutation must update BOTH levels: tokens + DS page',
        'After every DS mutation, call figma_design_system with forceRefresh: true',
      ],
      exitCriteria: [
        'All primitive tokens created',
        'All semantic tokens created and aliased to primitives',
        'figma_lint passes with no critical errors on token structure',
      ],
      antiPatterns: [
        'Creating semantic tokens with raw values instead of aliasing primitives',
        'Using non-standard naming (no dot-notation, no camelCase for token names)',
        'Skipping scopes — every token must have explicit scope',
        'No DS mutation without explicit user confirmation',
      ],
      userCheckpoint: false,
      validationType: 'both',
    },
    {
      id: 'file-structure',
      name: 'File Structure',
      description: 'Create DS page with [DS::*] sections and inline documentation.',
      mandatorySteps: [
        'Create or identify the DS page in the file',
        'Create [DS::Colors], [DS::Typography], [DS::Spacing], [DS::Effects] sections',
        'Populate each section with token swatches/samples and rule descriptions in English',
        'Call figma_screenshot to visually validate DS page layout',
      ],
      exitCriteria: [
        'DS page exists with all required [DS::*] sections',
        'Each section has samples and written rules in English',
        'Visual validation confirms page is readable and organized',
      ],
      antiPatterns: [
        'Mixing components and token documentation on the same section',
        'Writing documentation in a language other than English',
        'Creating DS page sections without corresponding token variables',
        'dsStatus=none/partial: suggest bootstrap but do not block user from proceeding',
      ],
      userCheckpoint: false,
      validationType: 'visual',
    },
    {
      id: 'components',
      name: 'Components',
      description:
        'Build each core component: base frame → variants → component properties → naming → variable bindings.',
      mandatorySteps: [
        'For each component: create base frame with auto-layout using DS tokens',
        'Create all required variants using component properties (not separate frames)',
        'Define text, boolean, instance-swap and variant properties',
        'Apply standard naming: ComponentName/Variant/State',
        'Bind all fills, strokes, effects, and text styles to DS variables via figma_bind_variable',
        'Call figma_screenshot and figma_lint after each component',
        'In review mode: run figma_lint FIRST, take screenshot AFTER',
      ],
      exitCriteria: [
        'All planned components created with full variant sets',
        'Every fill/stroke/effect is bound to a DS variable (no raw values)',
        'figma_lint passes for each component',
        'Visual screenshot confirms each component looks correct',
      ],
      antiPatterns: [
        'Hardcoding hex colors or spacing values in components',
        'Building components without DS tokens — every value must be a variable binding',
        'Creating separate frames for variants instead of using component properties',
        'Freeform mode: zero DS enforcement, but Plugin API safety rules remain active',
      ],
      userCheckpoint: false,
      validationType: 'both',
    },
    {
      id: 'qa',
      name: 'QA',
      description:
        'Global audit: lint all components, accessibility check, naming audit, unbound variable audit. User sign-off.',
      mandatorySteps: [
        'Call figma_lint on the entire file for global DS compliance',
        'Audit for accessibility: color contrast ratios, text sizes, touch targets',
        'Audit naming: all layers follow ComponentName/Variant/State convention',
        'Audit for unbound values: search for any remaining raw hex/spacing values',
        'Present QA report to user and address any blocking issues',
      ],
      exitCriteria: [
        'Global figma_lint passes with no critical errors',
        'No accessibility failures (WCAG AA minimum)',
        'Naming convention audit passes',
        'Zero unbound raw values remain in components',
        'User signs off on completed design system',
      ],
      antiPatterns: [
        'Shipping DS without a global lint check',
        'Ignoring contrast ratio failures',
        'Leaving any component with raw hex values',
        'Closing without user sign-off',
      ],
      userCheckpoint: true,
      validationType: 'both',
    },
  ],
  references: [
    { id: 'ds-bootstrap-guide', title: 'DS Bootstrap Guide', content: '', loadCondition: 'on-demand' },
    { id: 'ds-write-guide', title: 'DS Write Guide', content: '', loadCondition: 'on-demand' },
    { id: 'documentation-guide', title: 'Documentation Guide', content: '', loadCondition: 'on-demand' },
    { id: 'component-reuse', title: 'Component Reuse', content: '', loadCondition: 'on-demand' },
  ],
  validationPolicy: {
    afterMutation: [
      { type: 'structural', description: 'Verify token was created at correct level with proper aliasing' },
    ],
    afterMilestone: [
      { type: 'structural', description: 'Lint check for DS compliance after each phase' },
      { type: 'visual', description: 'Screenshot DS page and component set after each milestone' },
    ],
    maxScreenshotLoops: 3,
    requiredChecks: ['discovery-before-create', 'no-duplicate-creation'],
  },
  requiresStateLedger: true,
  requiresUserCheckpoints: true,
};
