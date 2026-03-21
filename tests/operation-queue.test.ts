import { describe, expect, it } from 'vitest';
import { OperationQueue } from '../src/main/operation-queue.js';

describe('OperationQueue', () => {
  it('should execute a single operation and return its result', async () => {
    const queue = new OperationQueue();
    const result = await queue.execute(async () => 42);
    expect(result).toBe(42);
  });

  it('should propagate errors from operations', async () => {
    const queue = new OperationQueue();
    await expect(
      queue.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('should serialize concurrent operations (no parallel execution)', async () => {
    const queue = new OperationQueue();
    const order: number[] = [];

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Fire 3 concurrent operations — they must run sequentially
    const p1 = queue.execute(async () => {
      order.push(1);
      await delay(30);
      order.push(2);
      return 'a';
    });
    const p2 = queue.execute(async () => {
      order.push(3);
      await delay(10);
      order.push(4);
      return 'b';
    });
    const p3 = queue.execute(async () => {
      order.push(5);
      return 'c';
    });

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual(['a', 'b', 'c']);
    // Operations must have started and finished in order: 1,2 then 3,4 then 5
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('should continue draining after an operation fails', async () => {
    const queue = new OperationQueue();

    const p1 = queue.execute(async () => {
      throw new Error('fail');
    });
    const p2 = queue.execute(async () => 'recovered');

    await expect(p1).rejects.toThrow('fail');
    expect(await p2).toBe('recovered');
  });

  it('should handle empty queue gracefully after draining', async () => {
    const queue = new OperationQueue();
    await queue.execute(async () => 'first');
    // Queue is now idle — new operation should work fine
    const result = await queue.execute(async () => 'second');
    expect(result).toBe('second');
  });
});
