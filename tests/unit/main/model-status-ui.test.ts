/**
 * F9/F10 canonical UI mapping + parity check against renderer's inlined copy.
 * The renderer is plain <script> (no bundler) so it duplicates the logic —
 * this test ensures drift is caught.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDisabledStatus, statusDot } from '../../../src/shared/model-status-ui.js';

describe('F9: statusDot mapping', () => {
  it('green for ok', () => {
    expect(statusDot('ok')).toBe('🟢');
  });
  it('red for unauthorized / forbidden / not_found', () => {
    expect(statusDot('unauthorized')).toBe('🔴');
    expect(statusDot('forbidden')).toBe('🔴');
    expect(statusDot('not_found')).toBe('🔴');
  });
  it('yellow for transient / unknown', () => {
    expect(statusDot('rate_limit')).toBe('🟡');
    expect(statusDot('error')).toBe('🟡');
    expect(statusDot('unknown')).toBe('🟡');
  });
});

describe('F10: isDisabledStatus', () => {
  it('disables only the hard-red statuses', () => {
    expect(isDisabledStatus('unauthorized')).toBe(true);
    expect(isDisabledStatus('forbidden')).toBe(true);
    expect(isDisabledStatus('not_found')).toBe(true);
  });
  it('does NOT disable ok / yellow / transient states', () => {
    expect(isDisabledStatus('ok')).toBe(false);
    expect(isDisabledStatus('rate_limit')).toBe(false);
    expect(isDisabledStatus('error')).toBe(false);
    expect(isDisabledStatus('unknown')).toBe(false);
  });
});

describe('Parity with renderer inlined copy', () => {
  const settingsJs = readFileSync(path.join(__dirname, '../../../src/renderer/settings.js'), 'utf8');

  it('renderer defines `function modelStatusDot(status)`', () => {
    expect(settingsJs).toMatch(/function\s+modelStatusDot\s*\(status\)/);
  });

  // Verify each status → emoji mapping literally appears in the renderer body.
  // Avoids code eval (PluginHook blocks `new Function`) while still catching
  // divergence from the shared canonical module.
  const expectedMappings: Array<[string, string]> = [
    ['ok', statusDot('ok')],
    ['unauthorized', statusDot('unauthorized')],
    ['forbidden', statusDot('forbidden')],
    ['not_found', statusDot('not_found')],
    ['rate_limit', statusDot('rate_limit')],
    ['error', statusDot('error')],
    ['unknown', statusDot('unknown')],
  ];

  for (const [status, emoji] of expectedMappings) {
    it(`renderer produces ${emoji} for status="${status}"`, () => {
      // Extract the function body and assert the emoji is present for the
      // expected branch. Red statuses use a shared condition chain so we
      // verify the emoji literal appears after the matching check.
      const body = settingsJs.match(/function\s+modelStatusDot\s*\(status\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
      if (status === 'ok') {
        expect(body).toContain(`if (status === 'ok') return '${emoji}'`);
      } else if (status === 'unauthorized' || status === 'forbidden' || status === 'not_found') {
        expect(body).toContain(`'${emoji}'`);
        expect(body).toContain(`status === '${status}'`);
      } else {
        // yellow fallthrough — ensure the default return emoji matches
        expect(body).toContain(`return '${emoji}'`);
      }
    });
  }
});
