import { describe, expect, it } from 'vitest';
import { OperationQueueManager } from '../../../src/main/operation-queue-manager.js';

describe('OperationQueueManager', () => {
  it('getQueue returns the same instance for the same fileKey', () => {
    const manager = new OperationQueueManager();
    const q1 = manager.getQueue('file-abc');
    const q2 = manager.getQueue('file-abc');
    expect(q1).toBe(q2);
  });

  it('getQueue returns different instances for different fileKeys', () => {
    const manager = new OperationQueueManager();
    const q1 = manager.getQueue('file-abc');
    const q2 = manager.getQueue('file-xyz');
    expect(q1).not.toBe(q2);
  });

  it('two queues for different fileKeys run execute() in parallel', async () => {
    const manager = new OperationQueueManager();
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const q1 = manager.getQueue('file-a');
    const q2 = manager.getQueue('file-b');

    const start = Date.now();

    // Each operation takes ~50ms; if serialized they would take ~100ms total
    const p1 = q1.execute(() => delay(50));
    const p2 = q2.execute(() => delay(50));

    await Promise.all([p1, p2]);

    const elapsed = Date.now() - start;

    // Should complete in ~50ms (parallel), well under 100ms (serial)
    expect(elapsed).toBeLessThan(90);
  });

  it('removeQueue deletes the queue and getQueue creates a fresh one', () => {
    const manager = new OperationQueueManager();
    const original = manager.getQueue('file-abc');
    manager.removeQueue('file-abc');
    const fresh = manager.getQueue('file-abc');
    expect(fresh).not.toBe(original);
  });

  it('has returns true when a queue exists for the given fileKey', () => {
    const manager = new OperationQueueManager();
    manager.getQueue('file-abc');
    expect(manager.has('file-abc')).toBe(true);
  });

  it('has returns false when no queue exists for the given fileKey', () => {
    const manager = new OperationQueueManager();
    expect(manager.has('file-abc')).toBe(false);
  });

  it('size reflects the number of active queues', () => {
    const manager = new OperationQueueManager();
    expect(manager.size).toBe(0);
    manager.getQueue('file-a');
    expect(manager.size).toBe(1);
    manager.getQueue('file-b');
    expect(manager.size).toBe(2);
    manager.removeQueue('file-a');
    expect(manager.size).toBe(1);
  });

  it('removeQueue returns false for a non-existent key', () => {
    const manager = new OperationQueueManager();
    expect(manager.removeQueue('does-not-exist')).toBe(false);
  });

  it('removeQueue returns true for an existing key', () => {
    const manager = new OperationQueueManager();
    manager.getQueue('file-abc');
    expect(manager.removeQueue('file-abc')).toBe(true);
  });

  it('previous getQueue reference still works after removeQueue', async () => {
    const manager = new OperationQueueManager();
    const ref = manager.getQueue('file-abc');
    manager.removeQueue('file-abc');

    // The detached queue is still a valid, independent OperationQueue
    const result = await ref.execute(async () => 'still works');
    expect(result).toBe('still works');
  });
});
