import { vi } from 'vitest';
import type { AgentSessionLike } from '../../src/main/ipc-handlers.js';

/**
 * Controllable mock for AgentSessionLike.
 * Use `emitEvent(event)` to fire subscriber callbacks.
 */
export function createMockSession(): AgentSessionLike & {
  emitEvent: (event: any) => void;
  subscribers: Array<(event: any) => void>;
  _promptFn: ReturnType<typeof vi.fn>;
  _abortFn: ReturnType<typeof vi.fn>;
} {
  const subscribers: Array<(event: any) => void> = [];
  const _promptFn = vi.fn<(text: string, options?: any) => Promise<void>>().mockResolvedValue(undefined);
  const _abortFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  return {
    prompt: _promptFn,
    abort: _abortFn,
    subscribe(callback: (event: any) => void) {
      subscribers.push(callback);
    },
    emitEvent(event: any) {
      for (const cb of subscribers) cb(event);
    },
    subscribers,
    _promptFn,
    _abortFn,
  };
}
