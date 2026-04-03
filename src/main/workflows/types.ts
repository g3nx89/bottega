/**
 * Core type definitions for the Workflow Runtime.
 */

export type WorkflowCapabilityId =
  | 'ds-read'
  | 'ds-write'
  | 'ds-lint'
  | 'ds-proactive'
  | 'ds-bootstrap'
  | 'component-reuse'
  | 'library-fork'
  | 'targeted-diff'
  | 'visual-validation'
  | 'documentation';

export type InteractionMode = 'bootstrap' | 'socratic' | 'execution' | 'review' | 'freeform';
export type GovernancePolicy = 'strict' | 'adaptive' | 'freeform';

export interface DesignWorkflowContext {
  dsStatus: 'unknown' | 'none' | 'partial' | 'active';
  dsRecentlyModified: boolean;
  interactionMode: InteractionMode;
  governancePolicy: GovernancePolicy;
  libraryContext: 'none' | 'linked' | 'dominant';
  profileDirectives: string[];
}

export interface TriggerPattern {
  keywords: string[];
  intentCategory: string;
  confidence: number;
}

export interface ValidationCheck {
  type: 'structural' | 'visual';
  description: string;
}

export interface ValidationPolicy {
  afterMutation: ValidationCheck[];
  afterMilestone: ValidationCheck[];
  maxScreenshotLoops: number;
  requiredChecks: string[];
}

export interface ReferenceDoc {
  id: string;
  title: string;
  content: string;
  loadCondition: 'always' | 'on-demand';
}

export interface WorkflowPhase {
  id: string;
  name: string;
  description: string;
  mandatorySteps: string[];
  exitCriteria: string[];
  antiPatterns: string[];
  userCheckpoint: boolean;
  validationType: 'structural' | 'visual' | 'both' | 'none';
}

export interface WorkflowCapability {
  id: WorkflowCapabilityId;
  name: string;
  description: string;
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

export interface WorkflowPack {
  id: string;
  name: string;
  description: string;
  triggers: TriggerPattern[];
  capabilities: WorkflowCapabilityId[];
  supportedModes: InteractionMode[];
  phases: WorkflowPhase[];
  references: ReferenceDoc[];
  validationPolicy: ValidationPolicy;
  requiresStateLedger: boolean;
  requiresUserCheckpoints: boolean;
}

export interface IntentResolution {
  pack: WorkflowPack | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  context: DesignWorkflowContext;
  capabilities: WorkflowCapability[];
}
