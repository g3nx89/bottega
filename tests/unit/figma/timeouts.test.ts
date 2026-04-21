import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WS_BATCH_TIMEOUT_MS,
  WS_COMMAND_DEFAULT_TIMEOUT_MS,
  WS_FAST_RPC_TIMEOUT_MS,
  WS_HEAVY_RPC_TIMEOUT_MS,
  WS_MEDIUM_RPC_TIMEOUT_MS,
  WS_REFRESH_VARIABLES_TIMEOUT_MS,
  WS_STALL_DETECTION_MS,
} from '../../../src/figma/websocket-server.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const UI_HTML_PATH = resolve(REPO_ROOT, 'figma-desktop-bridge/ui.html');

const ALL_TIMEOUTS = [
  ['WS_FAST_RPC_TIMEOUT_MS', WS_FAST_RPC_TIMEOUT_MS],
  ['WS_MEDIUM_RPC_TIMEOUT_MS', WS_MEDIUM_RPC_TIMEOUT_MS],
  ['WS_COMMAND_DEFAULT_TIMEOUT_MS', WS_COMMAND_DEFAULT_TIMEOUT_MS],
  ['WS_STALL_DETECTION_MS', WS_STALL_DETECTION_MS],
  ['WS_HEAVY_RPC_TIMEOUT_MS', WS_HEAVY_RPC_TIMEOUT_MS],
  ['WS_BATCH_TIMEOUT_MS', WS_BATCH_TIMEOUT_MS],
  ['WS_REFRESH_VARIABLES_TIMEOUT_MS', WS_REFRESH_VARIABLES_TIMEOUT_MS],
] as const;

describe('WebSocket timeout constants', () => {
  it('are positive integers', () => {
    for (const [, v] of ALL_TIMEOUTS) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('preserve monotonic ordering across all RPC classes', () => {
    // FAST < MEDIUM < COMMAND_DEFAULT < STALL < HEAVY < BATCH < REFRESH.
    // The bridge assumes the same ordering when picking timeouts; a violation
    // means an operation's own timeout would trigger the stall-detection
    // guard (or vice versa) before its intended deadline.
    const values = ALL_TIMEOUTS.map(([, v]) => v);
    for (let i = 0; i < values.length - 1; i++) {
      expect(values[i], `${ALL_TIMEOUTS[i][0]} must be < ${ALL_TIMEOUTS[i + 1][0]}`).toBeLessThan(values[i + 1]);
    }
  });

  it('match the values declared in figma-desktop-bridge/ui.html', () => {
    const html = readFileSync(UI_HTML_PATH, 'utf8');
    const readConst = (name: string): number => {
      const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
      expect(m, `${name} not found in ui.html`).not.toBeNull();
      return Number(m![1]);
    };
    for (const [name, value] of ALL_TIMEOUTS) {
      expect(readConst(name), `${name} drift in ui.html`).toBe(value);
    }
  });
});
