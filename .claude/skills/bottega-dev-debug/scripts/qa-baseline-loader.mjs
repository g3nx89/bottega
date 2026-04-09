/**
 * qa-baseline loader — compiles tests/helpers/qa-baseline/*.ts on demand
 * via esbuild's programmatic API and returns the runnable module.
 *
 * Why this exists: qa-runner.mjs lives in .claude/ (gitignored) and must
 * consume the committed TypeScript recorder/differ in tests/helpers/.
 * Node 24 supports experimental type stripping but gating CLI use on that
 * flag is brittle; esbuild is already a devDep so this is zero-cost.
 *
 * Loading is cached per-process: the same recorder/differ instance is
 * returned across multiple CLI calls in one qa-runner run.
 */

import { build } from 'esbuild';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const PROJECT_DIR = process.env.BOTTEGA_PROJECT_DIR || '/Users/afato/Projects/bottega';
const RECORDER_PATH = join(PROJECT_DIR, 'tests/helpers/qa-baseline/recorder.ts');
const DIFFER_PATH = join(PROJECT_DIR, 'tests/helpers/qa-baseline/differ.ts');
const UX_SCHEMA_PATH = join(PROJECT_DIR, 'tests/helpers/ux-baseline/schema.ts');
const UX_DIFFER_PATH = join(PROJECT_DIR, 'tests/helpers/ux-baseline/differ.ts');

// Write compiled bundles INSIDE the project so Node resolves bare specifiers
// (e.g. @sinclair/typebox) from the project's node_modules.
const COMPILE_DIR = join(PROJECT_DIR, 'node_modules/.cache/bottega-qa-loader');
mkdirSync(COMPILE_DIR, { recursive: true });

let recorderCache = null;
let differCache = null;
let uxCache = null;

async function compileAndImport(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    // Keep typebox external — resolution works because the temp file lives
    // under PROJECT_DIR so Node walks up to project's node_modules.
    external: ['@sinclair/typebox', '@sinclair/typebox/value'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const tmpFile = join(COMPILE_DIR, `${randomBytes(8).toString('hex')}.mjs`);
  writeFileSync(tmpFile, code, 'utf-8');
  return import(pathToFileURL(tmpFile).href);
}

export async function loadRecorder() {
  if (recorderCache) return recorderCache;
  recorderCache = await compileAndImport(RECORDER_PATH);
  return recorderCache;
}

export async function loadDiffer() {
  if (differCache) return differCache;
  differCache = await compileAndImport(DIFFER_PATH);
  return differCache;
}

/**
 * Loads both UX schema and differ modules in one call. Returned as a
 * namespaced object so ux-baseline-cli can destructure cleanly without
 * collapsing exports from two distinct files.
 */
export async function loadUxBaseline() {
  if (uxCache) return uxCache;
  const [schemaModule, differModule] = await Promise.all([
    compileAndImport(UX_SCHEMA_PATH),
    compileAndImport(UX_DIFFER_PATH),
  ]);
  uxCache = { schemaModule, differModule };
  return uxCache;
}
