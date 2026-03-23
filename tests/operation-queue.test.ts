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

  // ── Edge cases ────────────────────────────────

  it('should queue nested execute calls (fire-and-forget from within)', async () => {
    const queue = new OperationQueue();
    const order: string[] = [];

    // Nested execute without awaiting — queues for after outer completes
    await queue.execute(async () => {
      order.push('outer');
      // Fire-and-forget: don't await the inner promise (awaiting would deadlock)
      queue.execute(async () => {
        order.push('inner');
      });
    });

    // Give the drain loop a tick to process the queued inner operation
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['outer', 'inner']);
  });

  it('should handle high contention (20 concurrent operations)', async () => {
    const queue = new OperationQueue();
    const results: number[] = [];

    const promises = Array.from({ length: 20 }, (_, i) =>
      queue.execute(async () => {
        results.push(i);
        return i;
      }),
    );

    const resolved = await Promise.all(promises);

    // All results should be in order
    expect(resolved).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('should handle multiple errors interspersed with successes', async () => {
    const queue = new OperationQueue();
    const results: string[] = [];

    const p1 = queue.execute(async () => {
      results.push('ok1');
      return 'ok1';
    });
    const p2 = queue.execute(async () => {
      throw new Error('err1');
    });
    const p3 = queue.execute(async () => {
      results.push('ok2');
      return 'ok2';
    });
    const p4 = queue.execute(async () => {
      throw new Error('err2');
    });
    const p5 = queue.execute(async () => {
      results.push('ok3');
      return 'ok3';
    });

    expect(await p1).toBe('ok1');
    await expect(p2).rejects.toThrow('err1');
    expect(await p3).toBe('ok2');
    await expect(p4).rejects.toThrow('err2');
    expect(await p5).toBe('ok3');
    expect(results).toEqual(['ok1', 'ok2', 'ok3']);
  });

  it('should handle sync-like operations (no awaiting)', async () => {
    const queue = new OperationQueue();
    const result = await queue.execute(async () => 'instant');
    expect(result).toBe('instant');
  });

  it('should support different return types', async () => {
    const queue = new OperationQueue();

    expect(await queue.execute(async () => null)).toBeNull();
    expect(await queue.execute(async () => undefined)).toBeUndefined();
    expect(await queue.execute(async () => [1, 2, 3])).toEqual([1, 2, 3]);
    expect(await queue.execute(async () => ({ key: 'val' }))).toEqual({ key: 'val' });
  });

  // ── Phase 2B: Timeout tests ─────────────────

  it('should reject when operation exceeds timeout', async () => {
    const queue = new OperationQueue();
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await expect(queue.execute(() => delay(500) as Promise<void>, 50)).rejects.toThrow(/timed out/);
  });

  it('should continue draining after a timeout rejection', async () => {
    const queue = new OperationQueue();
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const p1 = queue.execute(() => delay(500) as Promise<void>, 50);
    const p2 = queue.execute(async () => 'after-timeout');

    await expect(p1).rejects.toThrow(/timed out/);
    expect(await p2).toBe('after-timeout');
  });

  it('should resolve normally when operation completes before timeout', async () => {
    const queue = new OperationQueue();
    const result = await queue.execute(async () => 'fast', 5000);
    expect(result).toBe('fast');
  });

  it('should handle nested execute with timeout', async () => {
    const queue = new OperationQueue();
    const order: string[] = [];

    await queue.execute(async () => {
      order.push('outer');
      // Fire-and-forget inner (don't await — would deadlock)
      queue.execute(async () => {
        order.push('inner');
      }, 1000);
    }, 1000);

    // Let inner drain
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(['outer', 'inner']);
  });

  // ── Edge case: timeout boundary values ──────

  it('should reject immediately with near-zero timeout', async () => {
    // Edge case: 1ms timeout vs 50ms operation — deterministic, no race
    const queue = new OperationQueue();
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await expect(queue.execute(() => delay(50) as Promise<void>, 1)).rejects.toThrow(/timed out/);
  });

  it('should continue draining after near-zero-timeout rejection', async () => {
    // Edge case: verify queue health after timeout edge case
    const queue = new OperationQueue();
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const p1 = queue.execute(() => delay(50) as Promise<void>, 1);
    const p2 = queue.execute(async () => 'after-zero-timeout');

    await expect(p1).rejects.toThrow(/timed out/);
    expect(await p2).toBe('after-zero-timeout');
  });

  it('should handle operation that rejects synchronously (not async throw)', async () => {
    // Edge case: fn returns already-rejected promise vs throwing in async body
    const queue = new OperationQueue();

    await expect(queue.execute(() => Promise.reject(new Error('sync-reject')))).rejects.toThrow('sync-reject');

    // Queue should still be healthy
    const result = await queue.execute(async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
