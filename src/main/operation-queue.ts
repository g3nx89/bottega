/**
 * OperationQueue — serializes concurrent Figma mutation calls.
 * All mutation tools must go through execute() to prevent concurrent modifications.
 */
export class OperationQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      if (!this.running) {
        this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try { await task(); } catch { /* error already forwarded via reject */ }
    }
    this.running = false;
  }
}
