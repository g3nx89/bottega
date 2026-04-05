/**
 * Category coherence tests.
 *
 * Verifies that CATEGORY_MAP and its consumers (MUTATION_TOOLS, hasMutations check,
 * tool definitions) stay in sync with each other.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../../../../src/main/compression/metrics.js';
import { MUTATION_TOOLS } from '../../../../src/main/compression/mutation-compressor.js';
import { TaskStore } from '../../../../src/main/tasks/store.js';
import { createTaskTools } from '../../../../src/main/tasks/tools.js';
import { createFigmaTools } from '../../../../src/main/tools/index.js';
import { createTestToolDeps } from '../../../helpers/mock-connector.js';

// ── Helper: collect all defined tool names ────────────────────────────────────

function getAllToolNames(): Set<string> {
  const deps = createTestToolDeps();
  const figmaTools = createFigmaTools(deps);
  const taskTools = createTaskTools(new TaskStore());
  const names = new Set<string>();
  for (const t of [...figmaTools, ...taskTools]) {
    names.add(t.name);
  }
  return names;
}

// ── Test 1: every CATEGORY_MAP key has a matching tool definition ─────────────

/**
 * figma_screenshot_rest is a legacy analytics alias tracked in CATEGORY_MAP for
 * historical metrics but has no live ToolDefinition. It is the only known exception.
 * All other CATEGORY_MAP entries must have a corresponding ToolDefinition.
 */
const KNOWN_METRICS_ONLY_ENTRIES = new Set(['figma_screenshot_rest']);

describe('CATEGORY_MAP keys are a subset of defined tool names', () => {
  it('every tool in CATEGORY_MAP has a corresponding ToolDefinition (except known metrics-only entries)', () => {
    const definedNames = getAllToolNames();
    const missingTools: string[] = [];

    for (const toolName of Object.keys(CATEGORY_MAP)) {
      if (KNOWN_METRICS_ONLY_ENTRIES.has(toolName)) continue;
      if (!definedNames.has(toolName)) {
        missingTools.push(toolName);
      }
    }

    expect(missingTools, `CATEGORY_MAP contains entries with no tool definition: ${missingTools.join(', ')}`).toEqual(
      [],
    );
  });

  it('known metrics-only entries are not accidentally given tool definitions', () => {
    const definedNames = getAllToolNames();
    for (const name of KNOWN_METRICS_ONLY_ENTRIES) {
      expect(
        definedNames.has(name),
        `${name} was added as a real tool — remove it from KNOWN_METRICS_ONLY_ENTRIES`,
      ).toBe(false);
    }
  });
});

// ── Test 2: MUTATION_TOOLS equals exactly the set of 'mutation' tools ─────────

describe('MUTATION_TOOLS equals the set of mutation-category tools in CATEGORY_MAP', () => {
  it('MUTATION_TOOLS matches exactly the tools categorized as mutation', () => {
    const expectedMutations = new Set(
      Object.entries(CATEGORY_MAP)
        .filter(([, cat]) => cat === 'mutation')
        .map(([name]) => name),
    );

    // Every expected mutation must be in MUTATION_TOOLS
    for (const name of expectedMutations) {
      expect(MUTATION_TOOLS.has(name), `${name} is mutation in CATEGORY_MAP but missing from MUTATION_TOOLS`).toBe(
        true,
      );
    }

    // Every entry in MUTATION_TOOLS must be in expectedMutations
    for (const name of MUTATION_TOOLS) {
      expect(
        expectedMutations.has(name),
        `${name} is in MUTATION_TOOLS but not categorized as mutation in CATEGORY_MAP`,
      ).toBe(true);
    }

    expect(MUTATION_TOOLS.size).toBe(expectedMutations.size);
  });
});

// ── Test 3: hasMutations check in session-events.ts uses fail-safe approach ───

describe('hasMutations check in session-events.ts uses fail-safe READ_ONLY_CATEGORIES', () => {
  it('session-events.ts imports and uses READ_ONLY_CATEGORIES', () => {
    const sessionEventsPath = join(process.cwd(), 'src', 'main', 'session-events.ts');
    const source = readFileSync(sessionEventsPath, 'utf-8');

    // Fail-safe: imports READ_ONLY_CATEGORIES from judge-harness
    expect(source).toContain('READ_ONLY_CATEGORIES');
    // Uses it in the hasMutations check
    expect(source).toContain('!READ_ONLY_CATEGORIES.has');
  });

  it('READ_ONLY_CATEGORIES in judge-harness.ts contains key categories', () => {
    const harnessPath = join(process.cwd(), 'src', 'main', 'subagent', 'judge-harness.ts');
    const source = readFileSync(harnessPath, 'utf-8');

    expect(source).toContain("'discovery'");
    expect(source).toContain("'screenshot'");
  });
});

// ── Test 4: no tool is both 'mutation' and 'ds' category ─────────────────────

describe('no tool has dual mutation+ds category', () => {
  it('no tool name appears as both mutation and ds in CATEGORY_MAP', () => {
    const mutationTools = Object.entries(CATEGORY_MAP)
      .filter(([, cat]) => cat === 'mutation')
      .map(([name]) => name);

    const dsTools = new Set(
      Object.entries(CATEGORY_MAP)
        .filter(([, cat]) => cat === 'ds')
        .map(([name]) => name),
    );

    const overlap = mutationTools.filter((name) => dsTools.has(name));

    expect(overlap, `Tools that are both mutation and ds: ${overlap.join(', ')}`).toEqual([]);
  });
});
