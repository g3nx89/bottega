import { beforeEach, describe, expect, it } from 'vitest';
import { PromptQueue } from '../../../src/main/prompt-queue.js';

describe('PromptQueue', () => {
  let queue: PromptQueue;

  beforeEach(() => {
    queue = new PromptQueue();
  });

  describe('enqueue', () => {
    it('adds an item and returns it with id, text, and addedAt', () => {
      const item = queue.enqueue('hello');
      expect(item.text).toBe('hello');
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.addedAt).toBe('number');
      expect(item.addedAt).toBeGreaterThan(0);
    });

    it('multiple enqueues maintain FIFO order', () => {
      queue.enqueue('first');
      queue.enqueue('second');
      queue.enqueue('third');
      const items = queue.list();
      expect(items[0].text).toBe('first');
      expect(items[1].text).toBe('second');
      expect(items[2].text).toBe('third');
    });

    it('each enqueue generates a unique id', () => {
      const a = queue.enqueue('a');
      const b = queue.enqueue('b');
      const c = queue.enqueue('c');
      const ids = new Set([a.id, b.id, c.id]);
      expect(ids.size).toBe(3);
    });
  });

  describe('dequeue', () => {
    it('returns the first item and removes it', () => {
      const first = queue.enqueue('first');
      queue.enqueue('second');
      const result = queue.dequeue();
      expect(result).toEqual(first);
      expect(queue.length).toBe(1);
      expect(queue.list()[0].text).toBe('second');
    });

    it('returns null when the queue is empty', () => {
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('remove', () => {
    it('returns true and removes the item by id', () => {
      const item = queue.enqueue('to remove');
      const result = queue.remove(item.id);
      expect(result).toBe(true);
      expect(queue.length).toBe(0);
    });

    it('returns false for an unknown id', () => {
      queue.enqueue('some item');
      expect(queue.remove('nonexistent-id')).toBe(false);
    });

    it('removing a middle item preserves order of others', () => {
      queue.enqueue('first');
      const middle = queue.enqueue('middle');
      queue.enqueue('last');
      queue.remove(middle.id);
      const items = queue.list();
      expect(items.length).toBe(2);
      expect(items[0].text).toBe('first');
      expect(items[1].text).toBe('last');
    });
  });

  describe('edit', () => {
    it('changes the text of an existing item', () => {
      const item = queue.enqueue('original');
      const result = queue.edit(item.id, 'updated');
      expect(result).toBe(true);
      expect(queue.list()[0].text).toBe('updated');
    });

    it('returns false for an unknown id', () => {
      expect(queue.edit('nonexistent-id', 'new text')).toBe(false);
    });

    it('does not change id or addedAt when editing text', () => {
      const item = queue.enqueue('original');
      const originalId = item.id;
      const originalAddedAt = item.addedAt;
      queue.edit(item.id, 'updated');
      const updated = queue.list()[0];
      expect(updated.id).toBe(originalId);
      expect(updated.addedAt).toBe(originalAddedAt);
    });
  });

  describe('list', () => {
    it('returns a shallow copy — modifying it does not affect the queue', () => {
      queue.enqueue('item');
      const copy = queue.list();
      copy.push({ id: 'fake', text: 'fake', addedAt: 0 });
      expect(queue.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all items and returns the count', () => {
      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');
      const count = queue.clear();
      expect(count).toBe(3);
      expect(queue.length).toBe(0);
    });

    it('returns 0 when already empty', () => {
      expect(queue.clear()).toBe(0);
    });
  });

  describe('length and isEmpty', () => {
    it('length reflects current size', () => {
      expect(queue.length).toBe(0);
      queue.enqueue('a');
      expect(queue.length).toBe(1);
      queue.enqueue('b');
      expect(queue.length).toBe(2);
      queue.dequeue();
      expect(queue.length).toBe(1);
    });

    it('isEmpty is true when empty', () => {
      expect(queue.isEmpty).toBe(true);
    });

    it('isEmpty is false when not empty', () => {
      queue.enqueue('item');
      expect(queue.isEmpty).toBe(false);
    });
  });

  describe('restore', () => {
    it('replaces queue contents with the provided items', () => {
      queue.enqueue('old');
      const items = [
        { id: 'id-1', text: 'restored-1', addedAt: 1000 },
        { id: 'id-2', text: 'restored-2', addedAt: 2000 },
      ];
      queue.restore(items);
      expect(queue.length).toBe(2);
      expect(queue.list()[0].text).toBe('restored-1');
      expect(queue.list()[1].text).toBe('restored-2');
    });

    it('restore then dequeue works in FIFO order', () => {
      const items = [
        { id: 'id-1', text: 'first', addedAt: 1000 },
        { id: 'id-2', text: 'second', addedAt: 2000 },
      ];
      queue.restore(items);
      expect(queue.dequeue()?.text).toBe('first');
      expect(queue.dequeue()?.text).toBe('second');
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('integration', () => {
    it('enqueue 3 → edit middle → dequeue returns first → remove second → dequeue returns third (edited)', () => {
      const first = queue.enqueue('first');
      const second = queue.enqueue('second');
      const third = queue.enqueue('third');

      queue.edit(second.id, 'second-edited');

      const dequeued = queue.dequeue();
      expect(dequeued).toEqual(first);

      queue.remove(second.id);

      const last = queue.dequeue();
      expect(last?.id).toBe(third.id);
      expect(last?.text).toBe('third');

      expect(queue.isEmpty).toBe(true);
    });

    it('enqueue 3 → clear → isEmpty → enqueue 1 → dequeue returns new item', () => {
      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      queue.clear();
      expect(queue.isEmpty).toBe(true);

      const fresh = queue.enqueue('fresh');
      const result = queue.dequeue();
      expect(result?.id).toBe(fresh.id);
      expect(result?.text).toBe('fresh');
    });
  });

  // ── Large queue stress ──────────────────────────

  describe('large queue stress', () => {
    it('enqueue 1000 items → length is 1000', () => {
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(`item-${i}`);
      }
      expect(queue.length).toBe(1000);
    });

    it('dequeue all 1000 → FIFO order preserved, queue empty', () => {
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(`item-${i}`);
      }
      for (let i = 0; i < 1000; i++) {
        const item = queue.dequeue();
        expect(item).not.toBeNull();
        expect(item!.text).toBe(`item-${i}`);
      }
      expect(queue.isEmpty).toBe(true);
      expect(queue.dequeue()).toBeNull();
    });

    it('enqueue + dequeue 1000 items completes in <100ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(`perf-${i}`);
      }
      for (let i = 0; i < 1000; i++) {
        queue.dequeue();
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });

  // ── Concurrent operations ───────────────────────

  describe('concurrent operations', () => {
    it('interleaved enqueue + dequeue preserves FIFO and loses no items', () => {
      const dequeued: string[] = [];

      // Enqueue 5, dequeue 2, enqueue 5 more, dequeue all remaining
      for (let i = 0; i < 5; i++) {
        queue.enqueue(`batch1-${i}`);
      }
      for (let i = 0; i < 2; i++) {
        const item = queue.dequeue();
        expect(item).not.toBeNull();
        dequeued.push(item!.text);
      }
      for (let i = 0; i < 5; i++) {
        queue.enqueue(`batch2-${i}`);
      }
      while (!queue.isEmpty) {
        const item = queue.dequeue();
        expect(item).not.toBeNull();
        dequeued.push(item!.text);
      }

      expect(dequeued).toEqual([
        'batch1-0',
        'batch1-1',
        'batch1-2',
        'batch1-3',
        'batch1-4',
        'batch2-0',
        'batch2-1',
        'batch2-2',
        'batch2-3',
        'batch2-4',
      ]);
    });

    it('clear during iteration → clear wins, no stale items', () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueue(`stale-${i}`);
      }

      // Dequeue a few, then clear
      queue.dequeue();
      queue.dequeue();
      const cleared = queue.clear();
      expect(cleared).toBe(8);
      expect(queue.isEmpty).toBe(true);
      expect(queue.length).toBe(0);
      expect(queue.list()).toEqual([]);

      // New items after clear are independent
      queue.enqueue('after-clear');
      expect(queue.length).toBe(1);
      expect(queue.dequeue()?.text).toBe('after-clear');
    });
  });

  // ── Edge cases ──────────────────────────────────

  describe('edge cases', () => {
    it('dequeue from empty queue returns null', () => {
      expect(queue.dequeue()).toBeNull();
      expect(queue.length).toBe(0);
    });

    it('edit non-existent item returns false', () => {
      expect(queue.edit('does-not-exist', 'new text')).toBe(false);
    });

    it('edit non-existent item with items in queue is a no-op', () => {
      queue.enqueue('real-item');
      expect(queue.edit('does-not-exist', 'new text')).toBe(false);
      // Original item unchanged
      expect(queue.list()[0].text).toBe('real-item');
    });

    it('remove non-existent item returns false', () => {
      expect(queue.remove('does-not-exist')).toBe(false);
    });

    it('remove non-existent item with items in queue is a no-op', () => {
      queue.enqueue('keeper');
      expect(queue.remove('does-not-exist')).toBe(false);
      expect(queue.length).toBe(1);
      expect(queue.list()[0].text).toBe('keeper');
    });

    it('enqueue empty string is handled correctly', () => {
      const item = queue.enqueue('');
      expect(item.text).toBe('');
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(queue.length).toBe(1);

      const dequeued = queue.dequeue();
      expect(dequeued).not.toBeNull();
      expect(dequeued!.text).toBe('');
    });

    it('enqueue very long string (10K chars) is handled correctly', () => {
      const longText = 'x'.repeat(10_000);
      const item = queue.enqueue(longText);
      expect(item.text).toBe(longText);
      expect(item.text.length).toBe(10_000);
      expect(queue.length).toBe(1);

      const dequeued = queue.dequeue();
      expect(dequeued).not.toBeNull();
      expect(dequeued!.text).toBe(longText);
      expect(dequeued!.text.length).toBe(10_000);
    });
  });
});
