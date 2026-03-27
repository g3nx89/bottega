/**
 * OperationQueue — serializes concurrent Figma mutation calls.
 * All mutation tools must go through execute() to prevent concurrent modifications.
 */
export class OperationQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;

  async execute<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const fnPromise = fn();
        try {
          let raced: Promise<T> = fnPromise;
          if (timeoutMs != null) {
            const timeoutPromise = new Promise<never>((_, rej) => {
              timeoutId = setTimeout(() => rej(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            raced = Promise.race([fnPromise, timeoutPromise]);
          }
          resolve(await raced);
        } catch (err) {
          reject(err);
          // fn() may still be running — wait for it before drain() starts the next task.
          await fnPromise.catch(() => {});
        } finally {
          if (timeoutId != null) clearTimeout(timeoutId);
        }
      });
      if (!this.running) {
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await task();
      } catch {
        /* error already forwarded via reject */
      }
    }
    this.running = false;
  }
}
