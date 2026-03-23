import type { AgentSessionLike } from '../../src/main/ipc-handlers.js';

export interface ScriptEvent {
  type: string;
  /** Full event payload merged with { type } before emitting */
  data?: Record<string, any>;
  /** Delay in ms before emitting this event (default: 0) */
  delayMs?: number;
}

/**
 * A session that replays a predefined sequence of events when prompt() is called.
 * Useful for testing the full agent pipeline without a real LLM.
 */
export class ScriptedSession implements AgentSessionLike {
  private subscribers: Array<(event: any) => void> = [];
  private _promptHistory: string[] = [];
  private _abortCount = 0;
  private _aborted = false;
  private _replaying = false;

  constructor(private script: ScriptEvent[]) {}

  get promptHistory(): string[] {
    return this._promptHistory;
  }

  get abortCount(): number {
    return this._abortCount;
  }

  get isReplaying(): boolean {
    return this._replaying;
  }

  subscribe(callback: (event: any) => void): void {
    this.subscribers.push(callback);
  }

  async prompt(text: string, _options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void> {
    this._promptHistory.push(text);
    this._aborted = false;
    this._replaying = true;

    for (const event of this.script) {
      if (this._aborted) break;

      if (event.delayMs && event.delayMs > 0) {
        await new Promise((r) => setTimeout(r, event.delayMs));
        if (this._aborted) break;
      }

      const payload = { type: event.type, ...event.data };
      for (const cb of this.subscribers) {
        cb(payload);
      }
    }

    this._replaying = false;
  }

  async abort(): Promise<void> {
    this._abortCount++;
    this._aborted = true;
  }
}
