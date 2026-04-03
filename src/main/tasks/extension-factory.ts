/**
 * Pi SDK extension factory for task reminder injection.
 *
 * After N consecutive non-task tool calls (with tasks in the store),
 * injects a system-reminder nudging the agent to update task progress.
 *
 * Also supports auto-clear: when all tasks are completed and N turns pass
 * without new task activity, the completed tasks are cleared automatically.
 */

import { createChildLogger } from '../../figma/logger.js';
import type { TaskStore } from './store.js';

const log = createChildLogger({ component: 'task-extension' });
const REMINDER_INTERVAL = 4;
const AUTO_CLEAR_TURNS = 4;
const TASK_TOOL_NAMES = new Set(['task_create', 'task_update', 'task_list']);

export type AutoClearMode = 'never' | 'on_list_complete';

export function createTaskExtensionFactory(
  getStore: () => TaskStore | undefined,
  autoClear: AutoClearMode = 'on_list_complete',
  onCleared?: (count: number) => void,
) {
  let turnsSinceTaskTool = 0;
  let turnsSinceAllComplete = 0;

  const factory = (pi: { on: (event: string, handler: (event: any) => Promise<any> | any) => void }) => {
    pi.on('tool_result', async (event: any) => {
      try {
        if (TASK_TOOL_NAMES.has(event.toolName)) {
          turnsSinceTaskTool = 0;
          turnsSinceAllComplete = 0;
          return null;
        }
        turnsSinceTaskTool++;

        const store = getStore();
        if (!store || store.size === 0) return null;

        // Auto-clear: if all tasks completed and enough turns passed
        if (autoClear === 'on_list_complete') {
          const tasks = store.list();
          const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
          if (allDone) {
            turnsSinceAllComplete++;
            if (turnsSinceAllComplete >= AUTO_CLEAR_TURNS) {
              const count = store.clearAll();
              turnsSinceAllComplete = 0;
              onCleared?.(count);
              log.info({ count }, 'Auto-cleared completed tasks');
              // Return empty task list hint so renderer can refresh via tool_result content
              const content = Array.isArray(event.content) ? event.content : [];
              return {
                content: [...content, { type: 'text', text: '<system-reminder>Tasks auto-cleared.</system-reminder>' }],
              };
            }
          } else {
            turnsSinceAllComplete = 0;
          }
        }

        if (turnsSinceTaskTool < REMINDER_INTERVAL) return null;

        // Inject reminder, reset counter
        turnsSinceTaskTool = 0;

        const tasks = store.list();
        const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
        let reminderText: string;
        if (pending.length > 0) {
          const summary = pending.map((t) => `- [${t.status}] #${t.id}: ${t.subject}`).join('\n');
          reminderText = `<system-reminder>Active tasks:\n${summary}\nUpdate task progress with task_update.</system-reminder>`;
        } else {
          reminderText =
            '<system-reminder>Task tools not used recently. Consider using task_update to mark progress.</system-reminder>';
        }

        const content = Array.isArray(event.content) ? event.content : [];
        return { content: [...content, { type: 'text', text: reminderText }] };
      } catch (err) {
        log.warn({ err }, 'Task extension error');
        return null;
      }
    });
  };

  /** Reset the counters — call on slot/model switch to prevent stale state. */
  factory.reset = () => {
    turnsSinceTaskTool = 0;
    turnsSinceAllComplete = 0;
  };

  return factory;
}
