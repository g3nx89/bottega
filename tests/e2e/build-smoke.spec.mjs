/**
 * Build smoke tests — verify build output integrity.
 *
 * These tests check that the build produces correct artifacts:
 * - preload.js is CJS (Electron sandbox requirement)
 * - main.js is ESM
 * - Build script completes without errors
 *
 * Run: npm run test:e2e
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const DIST = resolve('dist');

test.describe('Build smoke tests', () => {
  test('build script completes without errors', () => {
    const result = execFileSync('node', ['scripts/build.mjs'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(result).toContain('Build complete');
  });

  test('dist/preload.js exists and is CJS', () => {
    const preloadPath = resolve(DIST, 'preload.js');
    expect(existsSync(preloadPath)).toBe(true);

    const content = readFileSync(preloadPath, 'utf8');
    // CJS indicators: require() calls or module.exports
    const hasCjsIndicator =
      content.includes('require(') ||
      content.includes('module.exports') ||
      content.includes('exports.');
    expect(hasCjsIndicator).toBe(true);

    // Should NOT have top-level ESM import statements
    const hasTopLevelImport = /^import\s+/m.test(content);
    expect(hasTopLevelImport).toBe(false);
  });

  test('dist/main.js exists and is ESM', () => {
    const mainPath = resolve(DIST, 'main.js');
    expect(existsSync(mainPath)).toBe(true);

    const content = readFileSync(mainPath, 'utf8');
    // ESM indicators: import statements
    const hasEsmIndicator = content.includes('import ') || content.includes('import{');
    expect(hasEsmIndicator).toBe(true);
  });
});
