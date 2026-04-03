import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../../../../src/main/tasks/store.js';
import { createTaskTools } from '../../../../src/main/tasks/tools.js';

/** Invoke a tool — cast away ExtensionContext strictness (same pattern as other unit tests). */
function runTool(tool: ToolDefinition, params: Record<string, any>, callId = 'call-1') {
  return (tool as any).execute(callId, params, undefined, undefined, undefined);
}

function getTextResult(result: any): string {
  // textResult() JSON.stringify's the string, so content[0].text is JSON-encoded
  return JSON.parse(result.content[0].text) as string;
}

describe('createTaskTools', () => {
  let store: TaskStore;
  let tools: ToolDefinition[];
  let taskCreate: ToolDefinition;
  let taskUpdate: ToolDefinition;
  let taskList: ToolDefinition;

  beforeEach(() => {
    store = new TaskStore();
    tools = createTaskTools(store);
    taskCreate = tools.find((t) => t.name === 'task_create')!;
    taskUpdate = tools.find((t) => t.name === 'task_update')!;
    taskList = tools.find((t) => t.name === 'task_list')!;
  });

  describe('task_create', () => {
    it('returns textResult containing ID and subject', async () => {
      const result = await runTool(taskCreate, { subject: 'Fix header', description: 'Fix the header layout' });
      expect(getTextResult(result)).toBe('Task #1 created: Fix header');
    });

    it('stores the task in the store after creation', async () => {
      await runTool(taskCreate, { subject: 'Fix header', description: 'Fix the header layout' });
      expect(store.size).toBe(1);
      const task = store.get('1');
      expect(task).toBeDefined();
      expect(task!.subject).toBe('Fix header');
      expect(task!.status).toBe('pending');
    });

    it('increments ID for each created task', async () => {
      await runTool(taskCreate, { subject: 'Task A', description: 'A' });
      const result = await runTool(taskCreate, { subject: 'Task B', description: 'B' });
      expect(getTextResult(result)).toBe('Task #2 created: Task B');
      expect(store.size).toBe(2);
    });

    it('stores activeForm when provided', async () => {
      await runTool(taskCreate, { subject: 'Fix header', description: 'desc', activeForm: 'Fixing header...' });
      const task = store.get('1');
      expect(task!.activeForm).toBe('Fixing header...');
    });

    it('stores without activeForm when not provided', async () => {
      await runTool(taskCreate, { subject: 'Fix header', description: 'desc' });
      const task = store.get('1');
      expect(task!.activeForm).toBeUndefined();
    });

    it('stores metadata when provided', async () => {
      await runTool(taskCreate, {
        subject: 'Fix header',
        description: 'desc',
        metadata: { priority: 'high', effort: 3 },
      });
      const task = store.get('1');
      expect(task!.metadata).toEqual({ priority: 'high', effort: 3 });
    });

    it('stores empty metadata when not provided', async () => {
      await runTool(taskCreate, { subject: 'Fix header', description: 'desc' });
      const task = store.get('1');
      expect(task!.metadata).toEqual({});
    });
  });

  describe('task_update', () => {
    beforeEach(async () => {
      await runTool(taskCreate, { subject: 'Fix header', description: 'Fix header layout' });
    });

    it('changes status to in_progress and result mentions status', async () => {
      const result = await runTool(taskUpdate, { taskId: '1', status: 'in_progress' });
      const text = getTextResult(result);
      expect(text).toContain('status');
      expect(store.get('1')!.status).toBe('in_progress');
    });

    it('changes status to completed', async () => {
      const result = await runTool(taskUpdate, { taskId: '1', status: 'completed' });
      const text = getTextResult(result);
      expect(text).toContain('status');
      expect(store.get('1')!.status).toBe('completed');
    });

    it('status deleted removes the task and result mentions deleted', async () => {
      const result = await runTool(taskUpdate, { taskId: '1', status: 'deleted' });
      const text = getTextResult(result);
      expect(text).toContain('deleted');
      expect(store.get('1')).toBeUndefined();
      expect(store.size).toBe(0);
    });

    it('task not found returns result mentioning not found', async () => {
      const result = await runTool(taskUpdate, { taskId: '999', status: 'in_progress' });
      expect(getTextResult(result)).toContain('not found');
    });

    it('task not found with deleted status returns not found', async () => {
      const result = await runTool(taskUpdate, { taskId: '999', status: 'deleted' });
      expect(getTextResult(result)).toContain('not found');
      expect(store.size).toBe(1);
    });

    it('addBlockedBy creates bidirectional edges', async () => {
      await runTool(taskCreate, { subject: 'Task 2', description: 'Second task' });
      await runTool(taskUpdate, { taskId: '2', addBlockedBy: ['1'] });

      const task1 = store.get('1')!;
      const task2 = store.get('2')!;
      expect(task2.blockedBy).toContain('1');
      expect(task1.blocks).toContain('2');
    });

    it('addBlocks creates bidirectional edges symmetrically', async () => {
      await runTool(taskCreate, { subject: 'Task 2', description: 'Second task' });
      await runTool(taskUpdate, { taskId: '1', addBlocks: ['2'] });

      const task1 = store.get('1')!;
      const task2 = store.get('2')!;
      expect(task1.blocks).toContain('2');
      expect(task2.blockedBy).toContain('1');
    });

    it('self-block warning is included in result text', async () => {
      const result = await runTool(taskUpdate, { taskId: '1', addBlocks: ['1'] });
      expect(getTextResult(result)).toContain('Warnings');
    });

    it('cycle detection warning is included in result text', async () => {
      await runTool(taskCreate, { subject: 'Task 2', description: 'Second task' });
      // Task 1 blocks task 2
      await runTool(taskUpdate, { taskId: '1', addBlocks: ['2'] });
      // Now task 2 tries to block task 1 — cycle
      const result = await runTool(taskUpdate, { taskId: '2', addBlocks: ['1'] });
      expect(getTextResult(result)).toContain('Warnings');
      expect(getTextResult(result)).toContain('Cycle');
    });

    it('metadata merge adds new keys', async () => {
      await runTool(taskUpdate, { taskId: '1', metadata: { color: 'blue', size: 5 } });
      const task = store.get('1')!;
      expect(task.metadata.color).toBe('blue');
      expect(task.metadata.size).toBe(5);
    });

    it('metadata merge deletes keys with null value', async () => {
      await runTool(taskUpdate, { taskId: '1', metadata: { color: 'blue' } });
      await runTool(taskUpdate, { taskId: '1', metadata: { color: null } });
      const task = store.get('1')!;
      expect(task.metadata.color).toBeUndefined();
    });

    it('metadata merge preserves existing keys not mentioned', async () => {
      await runTool(taskUpdate, { taskId: '1', metadata: { existing: 'value', color: 'blue' } });
      await runTool(taskUpdate, { taskId: '1', metadata: { color: 'red' } });
      const task = store.get('1')!;
      expect(task.metadata.existing).toBe('value');
      expect(task.metadata.color).toBe('red');
    });

    it('owner field is stored and reflected', async () => {
      await runTool(taskUpdate, { taskId: '1', owner: 'agent-a' });
      const task = store.get('1') as any;
      expect(task.owner).toBe('agent-a');
    });
  });

  describe('task_list', () => {
    it('returns No tasks when store is empty', async () => {
      const result = await runTool(taskList, {});
      expect(getTextResult(result)).toBe('No tasks');
    });

    it('sorts pending first, then in_progress, then completed', async () => {
      await runTool(taskCreate, { subject: 'Task A', description: 'a' });
      await runTool(taskCreate, { subject: 'Task B', description: 'b' });
      await runTool(taskCreate, { subject: 'Task C', description: 'c' });
      await runTool(taskUpdate, { taskId: '1', status: 'completed' });
      await runTool(taskUpdate, { taskId: '2', status: 'in_progress' });
      // Task 3 remains pending

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      const lines = text.split('\n');

      expect(lines[0]).toContain('[pending]');
      expect(lines[1]).toContain('[in_progress]');
      expect(lines[2]).toContain('[completed]');
    });

    it('shows open blockers in output', async () => {
      await runTool(taskCreate, { subject: 'Blocker Task', description: 'blocker' });
      await runTool(taskCreate, { subject: 'Dependent Task', description: 'dependent' });
      await runTool(taskUpdate, { taskId: '2', addBlockedBy: ['1'] });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      expect(text).toContain('[blocked by #1]');
    });

    it('does not show completed blockers', async () => {
      await runTool(taskCreate, { subject: 'Blocker Task', description: 'blocker' });
      await runTool(taskCreate, { subject: 'Dependent Task', description: 'dependent' });
      await runTool(taskUpdate, { taskId: '2', addBlockedBy: ['1'] });
      await runTool(taskUpdate, { taskId: '1', status: 'completed' });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      expect(text).not.toContain('[blocked by');
    });

    it('shows owner when present', async () => {
      await runTool(taskCreate, { subject: 'Owned Task', description: 'task with owner' });
      await runTool(taskUpdate, { taskId: '1', owner: 'agent-b' });

      const result = await runTool(taskList, {});
      expect(getTextResult(result)).toContain('agent-b');
    });

    it('does not show owner annotation when owner is absent', async () => {
      await runTool(taskCreate, { subject: 'Unowned Task', description: 'no owner' });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      expect(text).not.toContain('(');
    });

    it('formats output as #id [status] Subject lines', async () => {
      await runTool(taskCreate, { subject: 'Fix Header', description: 'fix it' });
      await runTool(taskCreate, { subject: 'Update Footer', description: 'update it' });
      await runTool(taskUpdate, { taskId: '1', status: 'in_progress' });
      await runTool(taskUpdate, { taskId: '2', addBlockedBy: ['1'] });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      const lines = text.split('\n');

      expect(lines[0]).toBe('#2 [pending] Update Footer [blocked by #1]');
      expect(lines[1]).toBe('#1 [in_progress] Fix Header');
    });

    it('shows multiple blockers when multiple exist', async () => {
      await runTool(taskCreate, { subject: 'Blocker 1', description: 'b1' });
      await runTool(taskCreate, { subject: 'Blocker 2', description: 'b2' });
      await runTool(taskCreate, { subject: 'Dependent', description: 'dep' });
      await runTool(taskUpdate, { taskId: '3', addBlockedBy: ['1', '2'] });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      expect(text).toContain('[blocked by #1, #2]');
    });

    it('sorts by id within the same status group', async () => {
      await runTool(taskCreate, { subject: 'Task A', description: 'a' });
      await runTool(taskCreate, { subject: 'Task B', description: 'b' });
      await runTool(taskCreate, { subject: 'Task C', description: 'c' });

      const result = await runTool(taskList, {});
      const text = getTextResult(result);
      const lines = text.split('\n');

      expect(lines[0]).toContain('#1');
      expect(lines[1]).toContain('#2');
      expect(lines[2]).toContain('#3');
    });
  });
});
