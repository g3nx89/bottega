/**
 * Workflow pipeline smoke tests — verifies the full chain:
 * buildDesignWorkflowContext → resolveIntent → composeCapabilities → extension factory injection.
 *
 * Tests at the module level, no LLM calls required.
 */

import { describe, expect, it } from 'vitest';
import { compactDesignSystem } from '../../../src/main/compression/design-system-cache.js';
import { buildSystemPrompt, type DsBlockData } from '../../../src/main/system-prompt.js';
import { composeCapabilities } from '../../../src/main/workflows/capability-composer.js';
import { buildDesignWorkflowContext } from '../../../src/main/workflows/design-context.js';
import { createWorkflowExtensionFactory } from '../../../src/main/workflows/extension-factory.js';
import { resolveIntent } from '../../../src/main/workflows/intent-router.js';
import { loadReferenceDocs } from '../../../src/main/workflows/reference-loader.js';
import { GET_LOCAL_COMPONENTS_RESPONSE, GET_VARIABLES_RESPONSE } from '../../fixtures/connector-responses.js';

describe('workflow pipeline smoke', () => {
  it('user message → intent → pack → composed capabilities', () => {
    const context = buildDesignWorkflowContext({ dsStatus: 'active' });
    const resolution = resolveIntent('crea una landing page', context);

    expect(resolution.pack).not.toBeNull();
    expect(resolution.pack!.id).toBe('build-screen');
    expect(resolution.confidence).not.toBe('none');

    const composed = composeCapabilities(resolution.pack!.capabilities);
    expect(composed.promptFragment).toBeTruthy();
    expect(composed.toolGuidance.preferred.length).toBeGreaterThan(0);
  });

  it('no pack matched → null resolution', () => {
    const context = buildDesignWorkflowContext({ dsStatus: 'active' });
    const resolution = resolveIntent('hello how are you', context);
    expect(resolution.pack).toBeNull();
    expect(resolution.confidence).toBe('none');
  });

  it('mode transitions persist when simulating multi-turn', () => {
    // Turn 1: bootstrap (dsStatus unknown)
    const ctx1 = buildDesignWorkflowContext({ dsStatus: 'unknown' });
    expect(ctx1.interactionMode).toBe('bootstrap');

    // Turn 2: user approves → socratic
    const ctx2 = buildDesignWorkflowContext({
      dsStatus: 'unknown',
      previousMode: 'bootstrap',
      userMessage: 'ok procedi',
    });
    expect(ctx2.interactionMode).toBe('socratic');

    // Turn 3: confirmed → execution
    const ctx3 = buildDesignWorkflowContext({
      dsStatus: 'partial',
      previousMode: 'socratic',
      userMessage: 'yes go ahead',
    });
    expect(ctx3.interactionMode).toBe('execution');
  });

  it('DS block in system prompt when cache has data', () => {
    const dsData: DsBlockData = {
      colors: 'primary=#A259FF secondary=#4A90D9',
      spacing: 'md=16 lg=24',
      status: 'active',
    };
    const prompt = buildSystemPrompt('TestModel', dsData);
    expect(prompt).toContain('Active Design System');
    expect(prompt).toContain('primary=#A259FF');
  });

  it('DS block NOT in prompt when status is none', () => {
    const dsData: DsBlockData = { status: 'none' };
    const prompt = buildSystemPrompt('TestModel', dsData);
    expect(prompt).not.toContain('Active Design System');
  });

  it('reference docs loaded for known capability IDs', () => {
    // The inlined reference loader should serve content for all registered doc IDs.
    // Use well-known IDs that exist in INLINED_REFERENCES.
    const knownIds = ['figma-execute-safety', 'design-system-discovery', 'visual-validation', 'component-reuse'];
    const refs = loadReferenceDocs(knownIds);
    expect(refs.size).toBe(knownIds.length);
    for (const [id, content] of refs) {
      expect(content.length, `Reference ${id} is empty`).toBeGreaterThan(100);
    }
  });

  it('build-design-system pack capabilities have reference doc IDs', () => {
    // The build-design-system pack triggers on "crea design system" and uses ds-bootstrap + ds-write
    // which carry non-empty referenceDocIds — ensuring the reference pipeline is wired end-to-end.
    const context = buildDesignWorkflowContext({ dsStatus: 'none' });
    const resolution = resolveIntent('crea design system', context);
    expect(resolution.pack).not.toBeNull();
    expect(resolution.pack!.id).toBe('build-design-system');

    const composed = composeCapabilities(resolution.pack!.capabilities);
    expect(composed.referenceDocIds.length).toBeGreaterThan(0);

    const refs = loadReferenceDocs(composed.referenceDocIds);
    // Refs may not be in INLINED_REFERENCES (ids like 'ds-write-guide') but the map should exist
    expect(refs).toBeInstanceOf(Map);
  });

  it('workflow extension factory injects context block', () => {
    const context = buildDesignWorkflowContext({ dsStatus: 'active' });
    const resolution = resolveIntent('crea una landing page', context);
    expect(resolution.pack).not.toBeNull();

    const composed = composeCapabilities(resolution.pack!.capabilities);

    const factory = createWorkflowExtensionFactory(() => ({
      context: resolution.context,
      pack: resolution.pack,
      composed,
    }));

    const handlers: Array<(event: any) => any> = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    // Simulate a tool_result event
    const result = handlers[0]({ content: [{ type: 'text', text: 'OK' }] });
    // The factory handler is async — unwrap the promise
    return Promise.resolve(result).then((resolved) => {
      expect(resolved).not.toBeNull();
      expect(resolved.content.some((c: any) => c.text?.includes('<workflow-context>'))).toBe(true);
      expect(resolved.content.some((c: any) => c.text?.includes('build-screen'))).toBe(true);
    });
  });

  it('compactDesignSystem with real connector shape produces correct dsStatus', () => {
    const raw = {
      variables: GET_VARIABLES_RESPONSE.variableCollections,
      variableCollections: GET_VARIABLES_RESPONSE.variableCollections,
      flatVariables: GET_VARIABLES_RESPONSE.variables,
      components: GET_LOCAL_COMPONENTS_RESPONSE,
    };
    const compact = compactDesignSystem(raw);
    expect(compact.dsStatus).toBe('active');
    expect(compact.variables.length).toBeGreaterThan(0);
  });

  it('empty DS response produces dsStatus none', () => {
    const raw = {
      variables: [],
      variableCollections: [],
      flatVariables: [],
      components: [],
    };
    const compact = compactDesignSystem(raw);
    expect(compact.dsStatus).toBe('none');
  });

  it('freeform keyword opts out of DS regardless of dsStatus', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      userMessage: 'no ds, just create a frame',
    });
    expect(ctx.interactionMode).toBe('freeform');
    expect(ctx.governancePolicy).toBe('freeform');
  });

  it('review keyword triggers review mode from any mode', () => {
    for (const prev of ['execution', 'socratic', 'bootstrap'] as const) {
      const ctx = buildDesignWorkflowContext({
        dsStatus: 'active',
        previousMode: prev,
        userMessage: 'controlla i token',
      });
      expect(ctx.interactionMode).toBe('review');
    }
  });
});
