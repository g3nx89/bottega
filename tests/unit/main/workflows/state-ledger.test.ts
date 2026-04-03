import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStore } from '../../../../src/main/tasks/store.js';
import {
  getResumePoint,
  getWorkflowLedger,
  isStepCompleted,
  listLedgers,
  loadLedger,
  saveLedger,
  type WorkflowStateLedger,
} from '../../../../src/main/workflows/state-ledger.js';

// Mock fs
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

describe('getWorkflowLedger', () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  it('returns null when no tasks match workflow', () => {
    store.create('Unrelated task', 'desc');
    expect(getWorkflowLedger(store, 'build-ds-run-1')).toBeNull();
  });

  it('builds ledger from workflow tasks', () => {
    store.create('Setup tokens', 'Create token collection', undefined, {
      workflowId: 'run-1',
      isWorkflowRoot: true,
      runId: 'run-1',
      fileKey: 'file-abc',
      phase: 'foundations',
      startedAt: '2026-04-01T00:00:00Z',
    });
    store.create('Create colors', 'Add color variables', undefined, {
      workflowId: 'run-1',
      stepId: 'create-colors',
      phase: 'foundations',
    });
    store.update('2', { status: 'completed' });

    const ledger = getWorkflowLedger(store, 'run-1');
    expect(ledger).not.toBeNull();
    expect(ledger!.runId).toBe('run-1');
    expect(ledger!.fileKey).toBe('file-abc');
    expect(ledger!.completedSteps).toContain('create-colors');
  });

  it('collects entities from completed tasks', () => {
    store.create('Root', 'root', undefined, {
      workflowId: 'run-1',
      isWorkflowRoot: true,
      runId: 'run-1',
      fileKey: 'f1',
    });
    store.create('Add vars', 'add variables', undefined, {
      workflowId: 'run-1',
      stepId: 'vars',
      createdEntities: { variables: ['var1', 'var2'], collections: ['col1'] },
    });
    store.update('2', { status: 'completed' });

    const ledger = getWorkflowLedger(store, 'run-1')!;
    expect(ledger.entities.variables).toEqual(['var1', 'var2']);
    expect(ledger.entities.collections).toEqual(['col1']);
  });

  it('deduplicates entities', () => {
    store.create('Root', 'root', undefined, {
      workflowId: 'run-1',
      isWorkflowRoot: true,
      runId: 'run-1',
      fileKey: 'f1',
    });
    store.create('Step 1', 'desc', undefined, { workflowId: 'run-1', createdEntities: { variables: ['v1'] } });
    store.update('2', { status: 'completed' });
    store.create('Step 2', 'desc', undefined, { workflowId: 'run-1', createdEntities: { variables: ['v1', 'v2'] } });
    store.update('3', { status: 'completed' });

    const ledger = getWorkflowLedger(store, 'run-1')!;
    expect(ledger.entities.variables).toEqual(['v1', 'v2']);
  });

  it('tracks errors', () => {
    store.create('Root', 'root', undefined, {
      workflowId: 'run-1',
      isWorkflowRoot: true,
      runId: 'run-1',
      fileKey: 'f1',
    });
    store.create('Failed step', 'desc', undefined, {
      workflowId: 'run-1',
      stepId: 'failed-step',
      error: 'Variable not found',
    });

    const ledger = getWorkflowLedger(store, 'run-1')!;
    expect(ledger.errors).toHaveLength(1);
    expect(ledger.errors[0].error).toBe('Variable not found');
  });
});

describe('getResumePoint', () => {
  it('returns current phase and step when in progress', () => {
    const ledger: WorkflowStateLedger = {
      runId: 'r1',
      workflowId: 'w1',
      fileKey: 'f1',
      phase: 'foundations',
      step: 'create-colors',
      startedAt: '',
      lastUpdatedAt: '',
      completedSteps: ['discover'],
      entities: { collections: [], variables: [], modes: [], pages: [], components: [], componentSets: [], styles: [] },
      pendingValidations: [],
      userCheckpoints: {},
      errors: [],
    };
    expect(getResumePoint(ledger)).toEqual({ phase: 'foundations', step: 'create-colors' });
  });

  it('returns null when no step in progress', () => {
    const ledger: WorkflowStateLedger = {
      runId: 'r1',
      workflowId: 'w1',
      fileKey: 'f1',
      phase: '',
      step: '',
      startedAt: '',
      lastUpdatedAt: '',
      completedSteps: ['all-done'],
      entities: { collections: [], variables: [], modes: [], pages: [], components: [], componentSets: [], styles: [] },
      pendingValidations: [],
      userCheckpoints: {},
      errors: [],
    };
    expect(getResumePoint(ledger)).toBeNull();
  });
});

describe('isStepCompleted', () => {
  const ledger: WorkflowStateLedger = {
    runId: 'r1',
    workflowId: 'w1',
    fileKey: 'f1',
    phase: 'build',
    step: 'current',
    startedAt: '',
    lastUpdatedAt: '',
    completedSteps: ['discover', 'plan'],
    entities: { collections: [], variables: [], modes: [], pages: [], components: [], componentSets: [], styles: [] },
    pendingValidations: [],
    userCheckpoints: {},
    errors: [],
  };

  it('returns true for completed steps', () => {
    expect(isStepCompleted(ledger, 'discover')).toBe(true);
    expect(isStepCompleted(ledger, 'plan')).toBe(true);
  });

  it('returns false for incomplete steps', () => {
    expect(isStepCompleted(ledger, 'build')).toBe(false);
  });
});

describe('persistence', () => {
  it('saveLedger writes to disk', async () => {
    const fsMock = await import('node:fs/promises');
    const ledger: WorkflowStateLedger = {
      runId: 'run-1',
      workflowId: 'w1',
      fileKey: 'file-abc',
      phase: 'build',
      step: 's1',
      startedAt: '',
      lastUpdatedAt: '',
      completedSteps: [],
      entities: { collections: [], variables: [], modes: [], pages: [], components: [], componentSets: [], styles: [] },
      pendingValidations: [],
      userCheckpoints: {},
      errors: [],
    };
    await saveLedger(ledger);
    expect(fsMock.default.mkdir).toHaveBeenCalled();
    expect(fsMock.default.writeFile).toHaveBeenCalled();
  });

  it('loadLedger reads and parses', async () => {
    const fsMock = await import('node:fs/promises');
    const ledger: WorkflowStateLedger = {
      runId: 'run-1',
      workflowId: 'w1',
      fileKey: 'f1',
      phase: '',
      step: '',
      startedAt: '',
      lastUpdatedAt: '',
      completedSteps: ['a', 'b'],
      entities: { collections: [], variables: [], modes: [], pages: [], components: [], componentSets: [], styles: [] },
      pendingValidations: [],
      userCheckpoints: {},
      errors: [],
    };
    (fsMock.default.readFile as any).mockResolvedValue(JSON.stringify(ledger));
    const loaded = await loadLedger('f1', 'run-1');
    expect(loaded?.completedSteps).toEqual(['a', 'b']);
  });

  it('loadLedger returns null for missing', async () => {
    const fsMock = await import('node:fs/promises');
    (fsMock.default.readFile as any).mockRejectedValue(new Error('ENOENT'));
    expect(await loadLedger('x', 'y')).toBeNull();
  });

  it('listLedgers returns run IDs', async () => {
    const fsMock = await import('node:fs/promises');
    (fsMock.default.readdir as any).mockResolvedValue(['run-1.json', 'run-2.json', '.DS_Store']);
    const ids = await listLedgers('f1');
    expect(ids).toEqual(['run-1', 'run-2']);
  });
});
