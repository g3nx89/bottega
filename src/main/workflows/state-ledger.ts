import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TaskStore } from '../tasks/store.js';

const LEDGER_DIR = path.join(os.homedir(), '.bottega', 'workflow-state');

export interface WorkflowStateLedger {
  runId: string;
  workflowId: string;
  fileKey: string;
  phase: string;
  step: string;
  startedAt: string;
  lastUpdatedAt: string;
  completedSteps: string[];
  entities: {
    collections: string[];
    variables: string[];
    modes: string[];
    pages: string[];
    components: string[];
    componentSets: string[];
    styles: string[];
  };
  pendingValidations: string[];
  userCheckpoints: Record<string, string>;
  errors: Array<{ step: string; error: string; recoveredAt?: string }>;
}

/**
 * Build a typed WorkflowStateLedger view from TaskStore tasks
 * that have metadata.workflowId matching the given workflowId.
 */
export function getWorkflowLedger(store: TaskStore, workflowId: string): WorkflowStateLedger | null {
  const tasks = store.list().filter((t) => t.metadata?.workflowId === workflowId);
  if (tasks.length === 0) return null;

  // Find the root/control task (metadata.isWorkflowRoot = true, or first task)
  const root = tasks.find((t) => t.metadata?.isWorkflowRoot) ?? tasks[0]!;
  const meta = root.metadata ?? {};

  const completedSteps = tasks
    .filter((t) => t.status === 'completed' && t.metadata?.stepId)
    .map((t) => t.metadata!.stepId as string);

  const currentPhase = (tasks.find((t) => t.status === 'in_progress')?.metadata?.phase as string) ?? meta.phase ?? '';
  const currentStep = (tasks.find((t) => t.status === 'in_progress')?.metadata?.stepId as string) ?? '';

  // Collect entities from completed tasks' metadata
  const entities = {
    collections: [] as string[],
    variables: [] as string[],
    modes: [] as string[],
    pages: [] as string[],
    components: [] as string[],
    componentSets: [] as string[],
    styles: [] as string[],
  };

  type EntityKey = keyof typeof entities;
  const validEntityKeys = new Set<string>(Object.keys(entities));

  for (const task of tasks) {
    if (task.metadata?.createdEntities) {
      const created = task.metadata.createdEntities as Record<string, string[]>;
      for (const [key, ids] of Object.entries(created)) {
        if (validEntityKeys.has(key)) {
          entities[key as EntityKey].push(...(ids as string[]));
        }
      }
    }
  }

  // Deduplicate entity arrays
  for (const key of Object.keys(entities) as EntityKey[]) {
    entities[key] = [...new Set(entities[key])];
  }

  const pendingValidations = tasks
    .filter((t) => t.status === 'pending' && t.metadata?.isValidation)
    .map((t) => t.metadata!.validationId as string);

  const userCheckpoints: Record<string, string> = {};
  for (const task of tasks) {
    if (task.metadata?.checkpointId && task.metadata?.checkpointResponse) {
      userCheckpoints[task.metadata.checkpointId as string] = task.metadata.checkpointResponse as string;
    }
  }

  const errors = tasks
    .filter((t) => t.metadata?.error)
    .map((t) => ({
      step: (t.metadata!.stepId as string | undefined) ?? t.subject,
      error: t.metadata!.error as string,
      recoveredAt: t.metadata?.recoveredAt as string | undefined,
    }));

  return {
    runId: (meta.runId as string | undefined) ?? '',
    workflowId,
    fileKey: (meta.fileKey as string | undefined) ?? '',
    phase: currentPhase,
    step: currentStep,
    startedAt: (meta.startedAt as string) ?? (root.metadata?.createdAt as string) ?? '',
    lastUpdatedAt: new Date().toISOString(),
    completedSteps,
    entities,
    pendingValidations,
    userCheckpoints,
    errors,
  };
}

/**
 * Get the resume point for a workflow — the first incomplete step.
 */
export function getResumePoint(ledger: WorkflowStateLedger): { phase: string; step: string } | null {
  // If there's a current step in progress, resume from there
  if (ledger.step) {
    return { phase: ledger.phase, step: ledger.step };
  }
  // Otherwise there's nothing to resume
  return null;
}

/**
 * Check if a specific step was already completed in the ledger.
 */
export function isStepCompleted(ledger: WorkflowStateLedger, stepId: string): boolean {
  return ledger.completedSteps.includes(stepId);
}

// ── Persistence ────────────────────────────────

/**
 * Save ledger to disk: ~/.bottega/workflow-state/{fileKey}/{runId}.json
 */
export async function saveLedger(ledger: WorkflowStateLedger): Promise<void> {
  const dir = path.join(LEDGER_DIR, ledger.fileKey);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${ledger.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(ledger, null, 2), 'utf-8');
}

/**
 * Load ledger from disk by fileKey and runId.
 */
export async function loadLedger(fileKey: string, runId: string): Promise<WorkflowStateLedger | null> {
  try {
    const filePath = path.join(LEDGER_DIR, fileKey, `${runId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as WorkflowStateLedger;
  } catch {
    return null;
  }
}

/**
 * List all ledger run IDs for a given file.
 */
export async function listLedgers(fileKey: string): Promise<string[]> {
  try {
    const dir = path.join(LEDGER_DIR, fileKey);
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  } catch {
    return [];
  }
}
