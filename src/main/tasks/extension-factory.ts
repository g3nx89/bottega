/**
 * Pi SDK extension factory for task reminder injection.
 *
 * After N consecutive non-task tool calls (with tasks in the store),
 * injects a system-reminder nudging the agent to update task progress.
 */

import { createChildLogger } from '../../figma/logger.js';
import type { TaskStore } from './store.js';

const log = createChildLogger({ component: 'task-extension' });
const REMINDER_INTERVAL = 4;
const TASK_TOOL_NAMES = new Set(['task_create', 'task_update', 'task_list']);

export function createTaskExtensionFactory(getStore: () => TaskStore | undefined) {
  let turnsSinceTaskTool = 0;

  const factory = (pi: { on: (event: string, handler: (event: any) => Promise<any> | any) => void }) => {
    pi.on('tool_result', async (event: any) => {
      try {
        if (TASK_TOOL_NAMES.has(event.toolName)) {
          turnsSinceTaskTool = 0;
          return null;
        }
        turnsSinceTaskTool++;

        const store = getStore();
        if (!store || store.size === 0) return null;
        if (turnsSinceTaskTool < REMINDER_INTERVAL) return null;

        // Inject reminder, reset counter
        turnsSinceTaskTool = 0;
        const reminderText =
          '<system-reminder>Task tools not used recently. Consider using task_update to mark progress.</system-reminder>';
        const content = Array.isArray(event.content) ? event.content : [];
        return { content: [...content, { type: 'text', text: reminderText }] };
      } catch (err) {
        log.warn({ err }, 'Task extension error');
        return null;
      }
    });
  };

  /** Reset the counter — call on slot/model switch to prevent stale state. */
  factory.reset = () => {
    turnsSinceTaskTool = 0;
  };

  return factory;
}
