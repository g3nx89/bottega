import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_PROTOCOL_VERSION } from '../../../src/shared/plugin-protocol.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const UI_HTML_PATH = resolve(REPO_ROOT, 'figma-desktop-bridge/ui.html');

describe('PLUGIN_PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PLUGIN_PROTOCOL_VERSION)).toBe(true);
    expect(PLUGIN_PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('matches PLUGIN_VERSION declared in figma-desktop-bridge/ui.html', () => {
    const html = readFileSync(UI_HTML_PATH, 'utf8');
    const match = html.match(/var\s+PLUGIN_VERSION\s*=\s*(\d+)\s*;/);
    expect(match, 'PLUGIN_VERSION declaration not found in ui.html').not.toBeNull();
    const uiVersion = Number(match![1]);
    expect(uiVersion).toBe(PLUGIN_PROTOCOL_VERSION);
  });
});
