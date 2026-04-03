/**
 * Playbook integration tests — task tools through the full Pi SDK pipeline.
 * Tests task creation, updates, dependencies, deletion, compression interplay,
 * and multi-turn persistence.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

describe('Task tools — playbook integration', () => {
  let t: BottegaTestSession;

  afterEach(() => t?.dispose());

  it('multi-task workflow: create, update, list', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Build header and footer', [
        calls('task_create', { subject: 'Build header', description: 'Create responsive header' }),
        calls('task_create', { subject: 'Build footer', description: 'Create footer with links' }),
        calls('task_update', { taskId: '1', status: 'in_progress' }),
        calls('task_update', { taskId: '1', status: 'completed' }),
        calls('task_update', { taskId: '2', status: 'in_progress' }),
        calls('task_update', { taskId: '2', status: 'completed' }),
        calls('task_list', {}),
        says('Done.'),
      ]),
    );

    expect(t.events.toolSequence()).toContain('task_create');
    expect(t.events.toolSequence()).toContain('task_update');
    expect(t.events.toolSequence()).toContain('task_list');

    const listResults = t.events.toolResultsFor('task_list');
    expect(listResults.length).toBe(1);
    expect(listResults[0].text).toContain('#1');
    expect(listResults[0].text).toContain('#2');
    expect(listResults[0].text).toContain('completed');
  });

  it('task tools interleaved with figma tools', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Create with tracking', [
        calls('task_create', { subject: 'Create header', description: 'Build it' }),
        calls('task_update', { taskId: '1', status: 'in_progress' }),
        calls('figma_create_child', { parentId: 'page:1', type: 'FRAME', name: 'Header' }),
        calls('task_update', { taskId: '1', status: 'completed' }),
        calls('task_list', {}),
        says('Header done.'),
      ]),
    );

    const seq = t.events.toolSequence();
    expect(seq).toEqual(['task_create', 'task_update', 'figma_create_child', 'task_update', 'task_list']);

    // Figma tools work normally alongside task tools
    const createResults = t.events.toolResultsFor('figma_create_child');
    expect(createResults.length).toBe(1);
    expect(createResults[0].isError).toBe(false);
  });

  it('dependency chain with addBlockedBy', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Create dependent tasks', [
        calls('task_create', { subject: 'Phase 1', description: 'Discovery' }),
        calls('task_create', { subject: 'Phase 2', description: 'Build' }),
        calls('task_update', { taskId: '2', addBlockedBy: ['1'] }),
        calls('task_list', {}),
        says('Tasks with dependencies.'),
      ]),
    );

    const listResult = t.events.toolResultsFor('task_list')[0].text;
    expect(listResult).toContain('blocked by #1');
  });

  it('delete via task_update with status deleted', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Cleanup', [
        calls('task_create', { subject: 'Temp task', description: 'Will be deleted' }),
        calls('task_update', { taskId: '1', status: 'deleted' }),
        calls('task_list', {}),
        says('Cleaned up.'),
      ]),
    );

    const listResult = t.events.toolResultsFor('task_list')[0].text;
    expect(listResult).toContain('No tasks');
  });

  it('task tools do not get compressed (category: other)', async () => {
    t = await createBottegaTestSession({ compressionProfile: 'balanced' });
    await t.run(
      when('Create and mutate', [
        calls('task_create', { subject: 'Style button', description: 'Apply fills' }),
        calls('task_update', { taskId: '1', status: 'in_progress' }),
        calls('figma_set_fills', { nodeId: '42:15', fills: [{ type: 'SOLID', color: '#FF0000' }] }),
        calls('task_update', { taskId: '1', status: 'completed' }),
        says('Done.'),
      ]),
    );

    // Task tool results contain the full text, not compressed
    const createResults = t.events.toolResultsFor('task_create');
    expect(createResults[0].text).toContain('Task #1 created');

    // Figma mutation tool executed successfully alongside task tools
    const fillResults = t.events.toolResultsFor('figma_set_fills');
    expect(fillResults.length).toBe(1);
    expect(fillResults[0].isError).toBe(false);
  });

  it('metadata passed through task_create', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Judge remediation', [
        calls('task_create', {
          subject: 'Fix button fill',
          description: 'Judge remediation (attempt 1)',
          metadata: { source: 'judge', judgeAttempt: 1 },
        }),
        calls('task_list', {}),
        says('Remediation created.'),
      ]),
    );

    // Verify via the TaskStore directly
    const task = t.taskStore.get('1');
    expect(task).toBeDefined();
    expect(task!.metadata.source).toBe('judge');
    expect(task!.metadata.judgeAttempt).toBe(1);
  });

  it('multi-turn with task persistence', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Plan work', [
        calls('task_create', { subject: 'Phase 1', description: 'Discovery' }),
        calls('task_create', { subject: 'Phase 2', description: 'Build' }),
        calls('task_update', { taskId: '1', status: 'in_progress' }),
        says('Starting phase 1.'),
      ]),
      when('Continue', [
        calls('task_update', { taskId: '1', status: 'completed' }),
        calls('task_update', { taskId: '2', status: 'in_progress' }),
        calls('task_list', {}),
        says('Phase 1 done, starting phase 2.'),
      ]),
    );

    // task_list in turn 2 sees both tasks
    const listResult = t.events.toolResultsFor('task_list')[0].text;
    expect(listResult).toContain('#1');
    expect(listResult).toContain('completed');
    expect(listResult).toContain('#2');
    expect(listResult).toContain('in_progress');

    // Store persists across turns
    expect(t.taskStore.size).toBe(2);
  });
});
