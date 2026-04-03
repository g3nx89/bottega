/**
 * Extension factory E2E — tests reminder injection through the real
 * Pi SDK session pipeline (session → extension factory → tool_result → injected content).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../../helpers/playbook.js';

describe('Task extension factory — pipeline E2E', () => {
  let t: BottegaTestSession;

  afterEach(() => t?.dispose());

  it('reminder injected after 4 non-task tool calls when tasks exist', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Work without tracking', [
        calls('task_create', { subject: 'Do something', description: 'desc' }),
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}), // 4th non-task → should trigger reminder
        calls('figma_status', {}), // counter reset, no reminder
        says('Done.'),
      ]),
    );

    // Check that one of the figma_status results contains the reminder
    const statusResults = t.events.toolResultsFor('figma_status');
    const withReminder = statusResults.filter(
      (r) => r.text.includes('system-reminder') || r.text.includes('Task tools not used'),
    );
    expect(withReminder.length).toBeGreaterThanOrEqual(1);
  });

  it('no reminder when task tools used regularly', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('Work with tracking', [
        calls('task_create', { subject: 'Phase 1', description: 'desc' }),
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('task_update', { taskId: '1', status: 'in_progress' }), // resets counter
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}),
        says('Done.'),
      ]),
    );

    // No result should contain the reminder
    const statusResults = t.events.toolResultsFor('figma_status');
    const withReminder = statusResults.filter((r) => r.text.includes('Task tools not used'));
    expect(withReminder.length).toBe(0);
  });

  it('no reminder when store is empty', async () => {
    t = await createBottegaTestSession();
    await t.run(
      when('No tasks created', [
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}),
        calls('figma_status', {}),
        says('Done.'),
      ]),
    );

    // No reminder because store is empty
    const statusResults = t.events.toolResultsFor('figma_status');
    const withReminder = statusResults.filter((r) => r.text.includes('Task tools not used'));
    expect(withReminder.length).toBe(0);
  });
});
