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
  _newSessionFn: ReturnType<typeof vi.fn>;
  _switchSessionFn: ReturnType<typeof vi.fn>;
  _messages: any[];
  _sessionFile: string | undefined;
} {
  const subscribers: Array<(event: any) => void> = [];
  const _promptFn = vi.fn<(text: string, options?: any) => Promise<void>>().mockResolvedValue(undefined);
  const _abortFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const _newSessionFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const _switchSessionFn = vi.fn<(path: string) => Promise<boolean>>().mockResolvedValue(true);

  const mock = {
    prompt: _promptFn,
    abort: _abortFn,
    subscribe(callback: (event: any) => void) {
      subscribers.push(callback);
    },
    newSession: _newSessionFn,
    switchSession: _switchSessionFn,
    setThinkingLevel: vi.fn(),
    _messages: [] as any[],
    _sessionFile: undefined as string | undefined,
    get messages() {
      return mock._messages;
    },
    get sessionFile() {
      return mock._sessionFile;
    },
    emitEvent(event: any) {
      for (const cb of subscribers) cb(event);
    },
    subscribers,
    _promptFn,
    _abortFn,
    _newSessionFn,
    _switchSessionFn,
  };

  return mock;
}
