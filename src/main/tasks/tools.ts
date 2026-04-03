/**
 * Task tools — 3 ToolDefinitions for agent self-decomposition.
 * Factory pattern: tools capture a closure over the TaskStore instance.
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { textResult, withAbortCheck } from '../tools/index.js';
import type { TaskStore } from './store.js';

const STATUS_ORDERING: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 };

export function createTaskTools(store: TaskStore): ToolDefinition[] {
  const taskCreate: ToolDefinition = {
    name: 'task_create',
    label: 'Create Task',
    description: `Create a task to track a discrete unit of work.

When to Use:
- Multi-step requests requiring 3+ distinct phases
- Multiple independent design operations in one request
- User provides a list of changes

When NOT to Use:
- Single operation (change a color, move an element)
- Fewer than 3 tool calls needed
- Purely conversational requests

Create all tasks upfront with clear imperative subjects.`,
    parameters: Type.Object({
      subject: Type.String({ description: 'Brief imperative title (e.g., "Build header section")' }),
      description: Type.String({ description: 'What needs to be done' }),
      activeForm: Type.Optional(
        Type.String({ description: 'Present continuous form shown during progress (e.g., "Building header...")' }),
      ),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'Arbitrary key-value metadata' })),
    }),
    async execute(_toolCallId: string, params: any) {
      const task = store.create(params.subject, params.description, params.activeForm, params.metadata);
      return textResult(`Task #${task.id} created: ${task.subject}`);
    },
  };

  const taskUpdate: ToolDefinition = {
    name: 'task_update',
    label: 'Update Task',
    description: `Update a task's status, details, or dependencies.

Workflow:
1. Mark in_progress BEFORE starting work
2. Mark completed ONLY when fully accomplished
3. Use 'deleted' status to remove a task
4. Use addBlocks/addBlockedBy to set dependencies`,
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task ID (e.g., "1")' }),
      status: Type.Optional(
        Type.Union(
          [Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('deleted')],
          { description: 'New status' },
        ),
      ),
      subject: Type.Optional(Type.String({ description: 'New subject' })),
      description: Type.Optional(Type.String({ description: 'New description' })),
      activeForm: Type.Optional(Type.String({ description: 'New active form text' })),
      owner: Type.Optional(Type.String({ description: 'Agent or role name' })),
      metadata: Type.Optional(
        Type.Record(Type.String(), Type.Any(), { description: 'Metadata to merge (null value deletes key)' }),
      ),
      addBlocks: Type.Optional(
        Type.Array(Type.String(), { description: 'Task IDs that cannot start until this one completes' }),
      ),
      addBlockedBy: Type.Optional(
        Type.Array(Type.String(), { description: 'Task IDs that must complete before this one starts' }),
      ),
    }),
    async execute(_toolCallId: string, params: any) {
      const { taskId, ...fields } = params;
      const { task, changedFields, warnings } = store.update(taskId, fields);

      // store.update returns { task: undefined, changedFields: ['status'] } for deletion,
      // vs { task: undefined, changedFields: [] } for not-found
      if (!task) {
        return changedFields.length > 0
          ? textResult(`Task #${taskId} deleted`)
          : textResult(`Task #${taskId} not found`);
      }

      let msg =
        changedFields.length > 0
          ? `Updated task #${taskId}: ${changedFields.join(', ')}`
          : `No changes applied to task #${taskId}`;
      if (warnings.length > 0) {
        msg += ` | Warnings: ${warnings.join('; ')}`;
      }
      return textResult(msg);
    },
  };

  const taskList: ToolDefinition = {
    name: 'task_list',
    label: 'List Tasks',
    description: `List all tasks sorted by status (pending → in_progress → completed), then by ID.
Shows open blockers for each task. Use after completing a task to check remaining work.`,
    parameters: Type.Object({}),
    async execute() {
      const tasks = store.list();
      if (tasks.length === 0) return textResult('No tasks');

      // Sort: pending -> in_progress -> completed, then by ID
      const sorted = [...tasks].sort((a, b) => {
        const statusDiff = (STATUS_ORDERING[a.status] ?? 0) - (STATUS_ORDERING[b.status] ?? 0);
        if (statusDiff !== 0) return statusDiff;
        return Number(a.id) - Number(b.id);
      });

      const lines = sorted.map((t) => {
        let line = `#${t.id} [${t.status}] ${t.subject}`;

        // Show owner if present
        if (t.owner) {
          line += ` (${t.owner})`;
        }

        // Show open blockers
        const openBlockers = t.blockedBy.filter((bid) => {
          const b = store.get(bid);
          return b && b.status !== 'completed';
        });
        if (openBlockers.length > 0) {
          line += ` [blocked by ${openBlockers.map((b) => '#' + b).join(', ')}]`;
        }

        return line;
      });

      return textResult(lines.join('\n'));
    },
  };

  return [taskCreate, taskUpdate, taskList].map(withAbortCheck);
}
