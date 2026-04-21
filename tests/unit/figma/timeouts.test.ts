import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WS_COMMAND_DEFAULT_TIMEOUT_MS,
  WS_FAST_RPC_TIMEOUT_MS,
  WS_REFRESH_VARIABLES_TIMEOUT_MS,
  WS_STALL_DETECTION_MS,
} from '../../../src/figma/websocket-server.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const UI_HTML_PATH = resolve(REPO_ROOT, 'figma-desktop-bridge/ui.html');

describe('WebSocket timeout constants', () => {
  it('are positive integers', () => {
    for (const v of [
      WS_FAST_RPC_TIMEOUT_MS,
      WS_COMMAND_DEFAULT_TIMEOUT_MS,
      WS_STALL_DETECTION_MS,
      WS_REFRESH_VARIABLES_TIMEOUT_MS,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('preserve ordering: FAST_RPC < COMMAND_DEFAULT < STALL_DETECTION < REFRESH_VARIABLES', () => {
    expect(WS_FAST_RPC_TIMEOUT_MS).toBeLessThan(WS_COMMAND_DEFAULT_TIMEOUT_MS);
    expect(WS_COMMAND_DEFAULT_TIMEOUT_MS).toBeLessThan(WS_STALL_DETECTION_MS);
    expect(WS_STALL_DETECTION_MS).toBeLessThan(WS_REFRESH_VARIABLES_TIMEOUT_MS);
  });

  it('match the values declared in figma-desktop-bridge/ui.html', () => {
    const html = readFileSync(UI_HTML_PATH, 'utf8');
    const readConst = (name: string): number => {
      const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
      expect(m, `${name} not found in ui.html`).not.toBeNull();
      return Number(m![1]);
    };
    expect(readConst('WS_FAST_RPC_TIMEOUT_MS')).toBe(WS_FAST_RPC_TIMEOUT_MS);
    expect(readConst('WS_COMMAND_DEFAULT_TIMEOUT_MS')).toBe(WS_COMMAND_DEFAULT_TIMEOUT_MS);
    expect(readConst('WS_STALL_DETECTION_MS')).toBe(WS_STALL_DETECTION_MS);
    expect(readConst('WS_REFRESH_VARIABLES_TIMEOUT_MS')).toBe(WS_REFRESH_VARIABLES_TIMEOUT_MS);
  });
});
