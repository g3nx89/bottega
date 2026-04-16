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
  // Controllable capability state for thinking-level tests.
  _thinkingLevel: string;
  _availableThinkingLevels: string[];
  _supportsThinking: boolean;
  _supportsXhigh: boolean;
  getAvailableThinkingLevels: ReturnType<typeof vi.fn>;
  supportsThinking: ReturnType<typeof vi.fn>;
  supportsXhighThinking: ReturnType<typeof vi.fn>;
} {
  const subscribers: Array<(event: any) => void> = [];
  const _promptFn = vi.fn<(text: string, options?: any) => Promise<void>>().mockResolvedValue(undefined);
  const _abortFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const _newSessionFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const _switchSessionFn = vi.fn<(path: string) => Promise<boolean>>().mockResolvedValue(true);

  // setThinkingLevel simulates Pi SDK clamping: if the requested level isn't in
  // the available set, it falls back to the highest supported one (mirroring
  // _clampThinkingLevel in agent-session.js). Tests can override by setting
  // `_thinkingLevel` directly on the returned mock.
  const setThinkingLevelFn = vi.fn((level: string) => {
    if (mock._availableThinkingLevels.includes(level)) {
      mock._thinkingLevel = level;
    } else {
      const ordered = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      const reqIdx = ordered.indexOf(level);
      // Clamp down to the nearest supported level.
      for (let i = reqIdx; i >= 0; i--) {
        if (mock._availableThinkingLevels.includes(ordered[i])) {
          mock._thinkingLevel = ordered[i];
          return;
        }
      }
      mock._thinkingLevel = mock._availableThinkingLevels[0] ?? 'off';
    }
  });

  const mock = {
    prompt: _promptFn,
    abort: _abortFn,
    subscribe(callback: (event: any) => void) {
      subscribers.push(callback);
    },
    newSession: _newSessionFn,
    switchSession: _switchSessionFn,
    setThinkingLevel: setThinkingLevelFn,
    _messages: [] as any[],
    _sessionFile: undefined as string | undefined,
    _thinkingLevel: 'medium',
    _availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
    _supportsThinking: true,
    _supportsXhigh: false,
    get messages() {
      return mock._messages;
    },
    get sessionFile() {
      return mock._sessionFile;
    },
    get thinkingLevel() {
      return mock._thinkingLevel;
    },
    getAvailableThinkingLevels: vi.fn(() => [...mock._availableThinkingLevels]),
    supportsThinking: vi.fn(() => mock._supportsThinking),
    supportsXhighThinking: vi.fn(() => mock._supportsXhigh),
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
