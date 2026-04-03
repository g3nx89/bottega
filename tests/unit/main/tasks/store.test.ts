import { beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../../../../src/main/tasks/store.js';

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  // ---------------------------------------------------------------------------
  // CRUD base
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('assigns auto-increment string IDs starting at "1"', () => {
      const t1 = store.create('A', 'desc A');
      const t2 = store.create('B', 'desc B');
      const t3 = store.create('C', 'desc C');
      expect(t1.id).toBe('1');
      expect(t2.id).toBe('2');
      expect(t3.id).toBe('3');
    });

    it('sets default status to pending', () => {
      const task = store.create('S', 'D');
      expect(task.status).toBe('pending');
    });

    it('stores subject and description', () => {
      const task = store.create('My Subject', 'My Description');
      expect(task.subject).toBe('My Subject');
      expect(task.description).toBe('My Description');
    });

    it('stores optional activeForm', () => {
      const task = store.create('S', 'D', 'design-form');
      expect(task.activeForm).toBe('design-form');
    });

    it('leaves activeForm undefined when not provided', () => {
      const task = store.create('S', 'D');
      expect(task.activeForm).toBeUndefined();
    });

    it('stores optional metadata', () => {
      const task = store.create('S', 'D', undefined, { priority: 'high' });
      expect(task.metadata).toEqual({ priority: 'high' });
    });

    it('defaults metadata to empty object', () => {
      const task = store.create('S', 'D');
      expect(task.metadata).toEqual({});
    });

    it('initialises blocks and blockedBy as empty arrays', () => {
      const task = store.create('S', 'D');
      expect(task.blocks).toEqual([]);
      expect(task.blockedBy).toEqual([]);
    });

    it('sets createdAt and updatedAt to the same timestamp', () => {
      const before = Date.now();
      const task = store.create('S', 'D');
      const after = Date.now();
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.createdAt).toBeLessThanOrEqual(after);
      expect(task.updatedAt).toBe(task.createdAt);
    });

    it('increments ID across independent store instances independently', () => {
      const store2 = new TaskStore();
      expect(store2.create('X', 'Y').id).toBe('1');
    });
  });

  describe('get', () => {
    it('returns the task for a known id', () => {
      const created = store.create('S', 'D');
      expect(store.get(created.id)).toBe(created);
    });

    it('returns undefined for an unknown id', () => {
      expect(store.get('999')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns an empty array when the store is empty', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns tasks sorted by numeric ID ascending', () => {
      store.create('C', 'D');
      store.create('A', 'D');
      store.create('B', 'D');
      const ids = store.list().map((t) => t.id);
      expect(ids).toEqual(['1', '2', '3']);
    });
  });

  describe('delete', () => {
    it('returns true and removes the task', () => {
      const task = store.create('S', 'D');
      expect(store.delete(task.id)).toBe(true);
      expect(store.get(task.id)).toBeUndefined();
    });

    it('returns false for an unknown id', () => {
      expect(store.delete('999')).toBe(false);
    });
  });

  describe('size getter', () => {
    it('reflects the current task count', () => {
      expect(store.size).toBe(0);
      store.create('S', 'D');
      expect(store.size).toBe(1);
      store.create('S', 'D');
      expect(store.size).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  describe('status transitions', () => {
    it('transitions pending → in_progress → completed', () => {
      const task = store.create('S', 'D');

      store.update(task.id, { status: 'in_progress' });
      expect(task.status).toBe('in_progress');

      store.update(task.id, { status: 'completed' });
      expect(task.status).toBe('completed');
    });

    it('can revert from completed back to in_progress', () => {
      const task = store.create('S', 'D');
      store.update(task.id, { status: 'completed' });
      store.update(task.id, { status: 'in_progress' });
      expect(task.status).toBe('in_progress');
    });

    it('status "deleted" removes the task from the store', () => {
      const task = store.create('S', 'D');
      const result = store.update(task.id, { status: 'deleted' });
      expect(result.task).toBeUndefined();
      expect(result.changedFields).toContain('status');
      expect(store.get(task.id)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // update() on nonexistent ID
  // ---------------------------------------------------------------------------

  describe('update on nonexistent ID', () => {
    it('returns { task: undefined, changedFields: [], warnings: [] }', () => {
      const result = store.update('999', { status: 'completed' });
      expect(result.task).toBeUndefined();
      expect(result.changedFields).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Field updates + changedFields + updatedAt
  // ---------------------------------------------------------------------------

  describe('scalar field updates', () => {
    it('updates subject and records it in changedFields', () => {
      const task = store.create('Old', 'D');
      const { changedFields } = store.update(task.id, { subject: 'New' });
      expect(task.subject).toBe('New');
      expect(changedFields).toContain('subject');
    });

    it('does not add subject to changedFields when value is unchanged', () => {
      const task = store.create('Same', 'D');
      const { changedFields } = store.update(task.id, { subject: 'Same' });
      expect(changedFields).not.toContain('subject');
    });

    it('updates description and records it in changedFields', () => {
      const task = store.create('S', 'Old desc');
      const { changedFields } = store.update(task.id, { description: 'New desc' });
      expect(task.description).toBe('New desc');
      expect(changedFields).toContain('description');
    });

    it('updates activeForm and records it in changedFields', () => {
      const task = store.create('S', 'D', 'form-a');
      const { changedFields } = store.update(task.id, { activeForm: 'form-b' });
      expect(task.activeForm).toBe('form-b');
      expect(changedFields).toContain('activeForm');
    });

    it('updates owner and records it in changedFields', () => {
      const task = store.create('S', 'D');
      const { changedFields } = store.update(task.id, { owner: 'alice' });
      expect((task as any).owner).toBe('alice');
      expect(changedFields).toContain('owner');
    });

    it('updates updatedAt when fields change', async () => {
      const task = store.create('S', 'D');
      const before = task.updatedAt;
      await new Promise((r) => setTimeout(r, 2));
      store.update(task.id, { subject: 'Changed' });
      expect(task.updatedAt).toBeGreaterThan(before);
    });

    it('does not update updatedAt when nothing changes', () => {
      const task = store.create('S', 'D');
      const ts = task.updatedAt;
      store.update(task.id, { subject: 'S' }); // same value
      expect(task.updatedAt).toBe(ts);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata merge
  // ---------------------------------------------------------------------------

  describe('metadata merge', () => {
    it('adds new keys to metadata', () => {
      const task = store.create('S', 'D', undefined, { a: 1 });
      store.update(task.id, { metadata: { b: 2 } });
      expect(task.metadata).toEqual({ a: 1, b: 2 });
    });

    it('updates existing keys in metadata', () => {
      const task = store.create('S', 'D', undefined, { a: 1 });
      store.update(task.id, { metadata: { a: 99 } });
      expect(task.metadata.a).toBe(99);
    });

    it('deletes a key when the value is null', () => {
      const task = store.create('S', 'D', undefined, { a: 1, b: 2 });
      store.update(task.id, { metadata: { a: null } });
      expect(task.metadata).toEqual({ b: 2 });
      expect('a' in task.metadata).toBe(false);
    });

    it('records "metadata" in changedFields', () => {
      const task = store.create('S', 'D');
      const { changedFields } = store.update(task.id, { metadata: { x: 1 } });
      expect(changedFields).toContain('metadata');
    });
  });

  // ---------------------------------------------------------------------------
  // Dependency graph — bidirectional edges
  // ---------------------------------------------------------------------------

  describe('dependency graph', () => {
    it('addBlocks creates bidirectional edge: A.blocks → B, B.blockedBy → A', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      expect(a.blocks).toContain(b.id);
      expect(b.blockedBy).toContain(a.id);
    });

    it('addBlockedBy creates bidirectional edge: A.blockedBy → B, B.blocks → A', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlockedBy: [b.id] });
      expect(a.blockedBy).toContain(b.id);
      expect(b.blocks).toContain(a.id);
    });

    it('does not create duplicate edges when addBlocks is called twice', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.update(a.id, { addBlocks: [b.id] });
      expect(a.blocks.filter((id) => id === b.id)).toHaveLength(1);
      expect(b.blockedBy.filter((id) => id === a.id)).toHaveLength(1);
    });

    it('does not create duplicate edges when addBlockedBy is called twice', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlockedBy: [b.id] });
      store.update(a.id, { addBlockedBy: [b.id] });
      expect(a.blockedBy.filter((id) => id === b.id)).toHaveLength(1);
      expect(b.blocks.filter((id) => id === a.id)).toHaveLength(1);
    });

    it('records "blocks" in changedFields for addBlocks', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      const { changedFields } = store.update(a.id, { addBlocks: [b.id] });
      expect(changedFields).toContain('blocks');
    });

    it('records "blockedBy" in changedFields for addBlockedBy', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      const { changedFields } = store.update(a.id, { addBlockedBy: [b.id] });
      expect(changedFields).toContain('blockedBy');
    });
  });

  // ---------------------------------------------------------------------------
  // Cycle detection, self-block, nonexistent ID warnings
  // ---------------------------------------------------------------------------

  describe('warnings', () => {
    it('warns on self-block via addBlocks', () => {
      const a = store.create('A', 'D');
      const { warnings } = store.update(a.id, { addBlocks: [a.id] });
      expect(warnings.some((w) => w.includes('blocks itself'))).toBe(true);
    });

    it('warns on self-block via addBlockedBy', () => {
      const a = store.create('A', 'D');
      const { warnings } = store.update(a.id, { addBlockedBy: [a.id] });
      expect(warnings.some((w) => w.includes('blocks itself'))).toBe(true);
    });

    it('warns when addBlocks targets a nonexistent task', () => {
      const a = store.create('A', 'D');
      const { warnings } = store.update(a.id, { addBlocks: ['999'] });
      expect(warnings.some((w) => w.includes('does not exist'))).toBe(true);
    });

    it('warns when addBlockedBy targets a nonexistent task', () => {
      const a = store.create('A', 'D');
      const { warnings } = store.update(a.id, { addBlockedBy: ['999'] });
      expect(warnings.some((w) => w.includes('does not exist'))).toBe(true);
    });

    it('warns on cycle via addBlocks: A blocks B, B tries to block A', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      const { warnings } = store.update(b.id, { addBlocks: [a.id] });
      expect(warnings.some((w) => w.toLowerCase().includes('cycle'))).toBe(true);
    });

    it('warns on cycle via addBlockedBy: A blockedBy B, B tries addBlockedBy A', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlockedBy: [b.id] });
      const { warnings } = store.update(b.id, { addBlockedBy: [a.id] });
      expect(warnings.some((w) => w.toLowerCase().includes('cycle'))).toBe(true);
    });

    it('does not prevent the edge from being added on cycle detection (warns but does not block)', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.update(b.id, { addBlocks: [a.id] });
      // Both edges should still exist
      expect(b.blocks).toContain(a.id);
      expect(a.blockedBy).toContain(b.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cleanup on delete
  // ---------------------------------------------------------------------------

  describe('edge cleanup on delete', () => {
    it('removing a task removes it from other tasks blocks arrays', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.delete(a.id);
      expect(b.blockedBy).not.toContain(a.id);
    });

    it('removing a task removes it from other tasks blockedBy arrays', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlockedBy: [b.id] });
      store.delete(a.id);
      expect(b.blocks).not.toContain(a.id);
    });

    it('cleans up A→B→C chain when B is deleted', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      const c = store.create('C', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.update(b.id, { addBlocks: [c.id] });

      store.delete(b.id);

      // A should no longer list B in its blocks
      expect(a.blocks).not.toContain(b.id);
      // C should no longer list B in its blockedBy
      expect(c.blockedBy).not.toContain(b.id);
      // A and C are otherwise unaffected
      expect(store.get(a.id)).toBeDefined();
      expect(store.get(c.id)).toBeDefined();
    });

    it('status "deleted" via update also cleans edges', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.update(a.id, { status: 'deleted' });
      expect(b.blockedBy).not.toContain(a.id);
    });
  });

  // ---------------------------------------------------------------------------
  // clearCompleted
  // ---------------------------------------------------------------------------

  describe('clearCompleted', () => {
    it('removes only completed tasks and returns the count', () => {
      store.create('P', 'D'); // pending — stays
      const t2 = store.create('IP', 'D');
      const t3 = store.create('C', 'D');
      store.update(t2.id, { status: 'in_progress' });
      store.update(t3.id, { status: 'completed' });

      const removed = store.clearCompleted();
      expect(removed).toBe(1);
      expect(store.size).toBe(2);
      expect(store.get(t3.id)).toBeUndefined();
    });

    it('returns 0 when there are no completed tasks', () => {
      store.create('S', 'D');
      expect(store.clearCompleted()).toBe(0);
    });

    it('cleans dependency edges when a completed task is removed', () => {
      const a = store.create('A', 'D');
      const b = store.create('B', 'D');
      store.update(a.id, { addBlocks: [b.id] });
      store.update(a.id, { status: 'completed' });

      store.clearCompleted();

      expect(b.blockedBy).not.toContain(a.id);
    });
  });

  // ---------------------------------------------------------------------------
  // clearAll
  // ---------------------------------------------------------------------------

  describe('clearAll', () => {
    it('removes all tasks and returns the count', () => {
      store.create('A', 'D');
      store.create('B', 'D');
      store.create('C', 'D');

      const removed = store.clearAll();
      expect(removed).toBe(3);
      expect(store.size).toBe(0);
      expect(store.list()).toEqual([]);
    });

    it('returns 0 when the store is already empty', () => {
      expect(store.clearAll()).toBe(0);
    });
  });
});
