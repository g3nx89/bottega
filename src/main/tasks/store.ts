/**
 * In-memory per-slot task store.
 * Adapted from @tintinweb/pi-tasks — file persistence deferred to Fase 4.
 */

import type { Task, TaskStatus } from './types.js';

export interface TaskUpdateFields {
  status?: TaskStatus | 'deleted';
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, any>;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

export interface TaskUpdateResult {
  task: Task | undefined;
  changedFields: string[];
  warnings: string[];
}

export class TaskStore {
  private tasks = new Map<string, Task>();
  private nextId = 1;

  create(subject: string, description: string, activeForm?: string, metadata?: Record<string, any>): Task {
    const id = String(this.nextId++);
    const now = Date.now();
    const task: Task = {
      id,
      subject,
      description,
      status: 'pending',
      activeForm,
      metadata: metadata ?? {},
      blocks: [],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    // Map preserves insertion order; IDs are auto-increment — already sorted
    return Array.from(this.tasks.values());
  }

  update(id: string, fields: TaskUpdateFields): TaskUpdateResult {
    const task = this.tasks.get(id);
    if (!task) {
      return { task: undefined, changedFields: [], warnings: [] };
    }

    // Handle deletion
    if (fields.status === 'deleted') {
      this.deleteInternal(id);
      return { task: undefined, changedFields: ['status'], warnings: [] };
    }

    const changedFields: string[] = [];
    const warnings: string[] = [];

    // Scalar fields
    if (fields.status !== undefined && fields.status !== task.status) {
      task.status = fields.status;
      changedFields.push('status');
    }
    if (fields.subject !== undefined && fields.subject !== task.subject) {
      task.subject = fields.subject;
      changedFields.push('subject');
    }
    if (fields.description !== undefined && fields.description !== task.description) {
      task.description = fields.description;
      changedFields.push('description');
    }
    if (fields.activeForm !== undefined && fields.activeForm !== task.activeForm) {
      task.activeForm = fields.activeForm;
      changedFields.push('activeForm');
    }
    if (fields.owner !== undefined && fields.owner !== task.owner) {
      task.owner = fields.owner;
      changedFields.push('owner');
    }

    // Metadata merge
    if (fields.metadata) {
      for (const [key, value] of Object.entries(fields.metadata)) {
        if (value === null) {
          delete task.metadata[key];
        } else {
          task.metadata[key] = value;
        }
      }
      changedFields.push('metadata');
    }

    // Dependency edges — addBlocks
    if (fields.addBlocks) {
      for (const targetId of fields.addBlocks) {
        if (targetId === id) {
          warnings.push(`Task #${id} blocks itself`);
          continue;
        }
        const target = this.tasks.get(targetId);
        if (!target) {
          warnings.push(`Task #${targetId} does not exist`);
          continue;
        }
        // Check cycle: if target already blocks this task
        if (task.blockedBy.includes(targetId)) {
          warnings.push(`Cycle detected: #${id} and #${targetId} block each other`);
        }
        if (!task.blocks.includes(targetId)) {
          task.blocks.push(targetId);
        }
        if (!target.blockedBy.includes(id)) {
          target.blockedBy.push(id);
        }
      }
      changedFields.push('blocks');
    }

    // Dependency edges — addBlockedBy
    if (fields.addBlockedBy) {
      for (const blockerId of fields.addBlockedBy) {
        if (blockerId === id) {
          warnings.push(`Task #${id} blocks itself`);
          continue;
        }
        const blocker = this.tasks.get(blockerId);
        if (!blocker) {
          warnings.push(`Task #${blockerId} does not exist`);
          continue;
        }
        // Check cycle: if this task already blocks the blocker
        if (task.blocks.includes(blockerId)) {
          warnings.push(`Cycle detected: #${id} and #${blockerId} block each other`);
        }
        if (!task.blockedBy.includes(blockerId)) {
          task.blockedBy.push(blockerId);
        }
        if (!blocker.blocks.includes(id)) {
          blocker.blocks.push(id);
        }
      }
      changedFields.push('blockedBy');
    }

    if (changedFields.length > 0) {
      task.updatedAt = Date.now();
    }

    return { task, changedFields, warnings };
  }

  delete(id: string): boolean {
    if (!this.tasks.has(id)) return false;
    this.deleteInternal(id);
    return true;
  }

  clearCompleted(): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed') {
        this.deleteInternal(id);
        count++;
      }
    }
    return count;
  }

  clearAll(): number {
    const count = this.tasks.size;
    this.tasks.clear();
    return count;
  }

  get size(): number {
    return this.tasks.size;
  }

  /** Remove a task and clean up orphaned edges in all other tasks. */
  private deleteInternal(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    // Clean edges referencing this task
    for (const otherId of task.blocks) {
      const other = this.tasks.get(otherId);
      if (other) {
        other.blockedBy = other.blockedBy.filter((bid) => bid !== id);
      }
    }
    for (const otherId of task.blockedBy) {
      const other = this.tasks.get(otherId);
      if (other) {
        other.blocks = other.blocks.filter((bid) => bid !== id);
      }
    }

    this.tasks.delete(id);
  }
}
