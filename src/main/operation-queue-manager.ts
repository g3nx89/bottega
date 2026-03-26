import { OperationQueue } from './operation-queue.js';

export class OperationQueueManager {
  private queues = new Map<string, OperationQueue>();

  /** Get or lazy-create an OperationQueue for the given fileKey. */
  getQueue(fileKey: string): OperationQueue {
    let q = this.queues.get(fileKey);
    if (!q) {
      q = new OperationQueue();
      this.queues.set(fileKey, q);
    }
    return q;
  }

  /** Remove a queue (cleanup when tab/slot is closed). */
  removeQueue(fileKey: string): boolean {
    return this.queues.delete(fileKey);
  }

  /** Check if a queue exists for the given fileKey. */
  has(fileKey: string): boolean {
    return this.queues.has(fileKey);
  }

  /** Number of active queues. */
  get size(): number {
    return this.queues.size;
  }
}
