import { randomUUID } from 'node:crypto';

export interface QueuedPrompt {
  id: string;
  text: string;
  addedAt: number;
}

export class PromptQueue {
  private items: QueuedPrompt[] = [];

  /** Add a prompt to the end of the queue. Returns the created entry. */
  enqueue(text: string): QueuedPrompt {
    const item: QueuedPrompt = { id: randomUUID(), text, addedAt: Date.now() };
    this.items.push(item);
    return item;
  }

  /** Remove a specific prompt by ID. Returns true if found and removed. */
  remove(promptId: string): boolean {
    const idx = this.items.findIndex((p) => p.id === promptId);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  /** Edit the text of a queued prompt. Returns true if found and updated. */
  edit(promptId: string, newText: string): boolean {
    const item = this.items.find((p) => p.id === promptId);
    if (!item) return false;
    item.text = newText;
    return true;
  }

  /** Remove and return the first prompt in the queue (FIFO). Returns null if empty. */
  dequeue(): QueuedPrompt | null {
    return this.items.shift() ?? null;
  }

  /** Return a shallow copy of all queued prompts (for UI display). */
  list(): QueuedPrompt[] {
    return [...this.items];
  }

  /** Clear all prompts. Returns the number of items removed. */
  clear(): number {
    const count = this.items.length;
    this.items = [];
    return count;
  }

  /** Number of prompts in queue. */
  get length(): number {
    return this.items.length;
  }

  /** Whether the queue is empty. */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Restore queue from persisted data (used on app restart). */
  restore(items: QueuedPrompt[]): void {
    this.items = [...items];
  }
}
