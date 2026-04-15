/**
 * Regression test for the `statusDot` collision bug found via computer-use.
 *
 * The renderer loads `app.js`, `slash-commands.js`, `settings.js` as plain
 * <script> tags — they share the global scope. Any top-level `const`, `let`,
 * `var`, `function`, or `class` declaration with the same name across files
 * produces a `SyntaxError: Identifier 'X' has already been declared` which
 * prevents the later script(s) from loading entirely.
 *
 * Previous regression: F9 added `function statusDot(status)` in settings.js
 * which collided with `const statusDot = document.getElementById(...)` in
 * app.js → Settings panel (accounts, model selector, image gen) was broken
 * on every launch.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER_DIR = path.join(__dirname, '../../../src/renderer');
const SCRIPTS = ['app.js', 'slash-commands.js', 'settings.js'];

/**
 * Extract top-level (column-0) declaration names from a script. We restrict
 * to column 0 because function bodies, if/for blocks, arrow callbacks are
 * all indented — their declarations don't pollute global scope. This misses
 * block-scoped-but-top-level edge cases, which is acceptable for a regression
 * check (false negatives ok; false positives are what we cannot tolerate).
 */
function extractTopLevelIdentifiers(source: string): Set<string> {
  const out = new Set<string>();
  const lines = source.split('\n');
  const declRegex = /^(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/;
  for (const raw of lines) {
    // Only col-0 declarations. Indented = inside block scope = safe.
    if (raw.startsWith(' ') || raw.startsWith('\t')) continue;
    // Skip line comments + JSDoc.
    if (raw.trimStart().startsWith('//') || raw.trimStart().startsWith('*')) continue;
    const m = raw.match(declRegex);
    if (m) out.add(m[1]);
  }
  return out;
}

describe('Renderer global scope collisions (regression)', () => {
  const ids: Record<string, Set<string>> = {};
  for (const script of SCRIPTS) {
    const source = readFileSync(path.join(RENDERER_DIR, script), 'utf8');
    ids[script] = extractTopLevelIdentifiers(source);
  }

  it('extracts at least some identifiers from each script (sanity)', () => {
    for (const script of SCRIPTS) {
      expect(ids[script].size).toBeGreaterThan(0);
    }
  });

  it('app.js and settings.js must NOT share top-level identifiers', () => {
    const shared = [...ids['app.js']].filter((id) => ids['settings.js'].has(id));
    expect(shared, `Duplicate top-level identifiers between app.js and settings.js: ${shared.join(', ')}`).toEqual([]);
  });

  it('app.js and slash-commands.js must NOT share top-level identifiers', () => {
    const shared = [...ids['app.js']].filter((id) => ids['slash-commands.js'].has(id));
    expect(shared, `Duplicate top-level identifiers: ${shared.join(', ')}`).toEqual([]);
  });

  it('settings.js and slash-commands.js must NOT share top-level identifiers', () => {
    const shared = [...ids['settings.js']].filter((id) => ids['slash-commands.js'].has(id));
    expect(shared, `Duplicate top-level identifiers: ${shared.join(', ')}`).toEqual([]);
  });

  it('regression: no file declares `statusDot` as both const and function', () => {
    // The specific bug: app.js has `const statusDot` (DOM ref); settings.js
    // had `function statusDot()`. Guard against this exact pair returning.
    const appHas = ids['app.js'].has('statusDot');
    const settingsHas = ids['settings.js'].has('statusDot');
    expect(appHas && settingsHas).toBe(false);
  });
});
