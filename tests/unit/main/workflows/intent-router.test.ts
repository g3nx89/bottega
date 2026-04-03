import { describe, expect, it } from 'vitest';
import { buildDesignWorkflowContext } from '../../../../src/main/workflows/design-context.js';
import { resolveIntent } from '../../../../src/main/workflows/intent-router.js';
import type { DesignWorkflowContext } from '../../../../src/main/workflows/types.js';

function makeContext(overrides: Partial<DesignWorkflowContext> = {}): DesignWorkflowContext {
  return buildDesignWorkflowContext({ dsStatus: 'active', ...overrides });
}

describe('resolveIntent', () => {
  it('"crea una landing page" → build-screen with medium confidence', () => {
    const result = resolveIntent('crea una landing page', makeContext());
    expect(result.pack?.id).toBe('build-screen');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('"build screen for mobile" → build-screen', () => {
    const result = resolveIntent('build screen for mobile', makeContext());
    expect(result.pack?.id).toBe('build-screen');
  });

  it('"create page for onboarding" → build-screen', () => {
    const result = resolveIntent('create page for onboarding', makeContext());
    expect(result.pack?.id).toBe('build-screen');
  });

  it('"aggiorna il header del frame" → update-screen', () => {
    const result = resolveIntent('aggiorna il header del frame', makeContext());
    expect(result.pack?.id).toBe('update-screen');
  });

  it('"update design to match new brand" → update-screen', () => {
    const result = resolveIntent('update design to match new brand', makeContext());
    expect(result.pack?.id).toBe('update-screen');
  });

  it('"imposta i token per la nuova palette" → build-design-system', () => {
    const result = resolveIntent('imposta i token per la nuova palette', makeContext());
    expect(result.pack?.id).toBe('build-design-system');
  });

  it('"setup tokens for the project" → build-design-system', () => {
    const result = resolveIntent('setup tokens for the project', makeContext());
    expect(result.pack?.id).toBe('build-design-system');
  });

  it('"crea design system completo" → build-design-system with high confidence', () => {
    const result = resolveIntent('crea design system completo', makeContext());
    expect(result.pack?.id).toBe('build-design-system');
    // "crea" + "design system" matches 2 keywords
    expect(result.confidence).toBe('high');
  });

  it('"fai un rettangolo blu" → null (fallback)', () => {
    const result = resolveIntent('fai un rettangolo blu', makeContext());
    expect(result.pack).toBeNull();
    expect(result.confidence).toBe('none');
  });

  it('empty message → null', () => {
    const result = resolveIntent('', makeContext());
    expect(result.pack).toBeNull();
    expect(result.confidence).toBe('none');
  });

  it('whitespace-only message → null', () => {
    const result = resolveIntent('   ', makeContext());
    expect(result.pack).toBeNull();
    expect(result.confidence).toBe('none');
  });

  it('returns capabilities for matched pack', () => {
    const result = resolveIntent('build screen now', makeContext());
    expect(result.pack?.id).toBe('build-screen');
    expect(result.capabilities.length).toBeGreaterThan(0);
    // Should have ds-read capability
    expect(result.capabilities.some((c) => c.id === 'ds-read')).toBe(true);
  });

  it('context is passed through unchanged', () => {
    const ctx = makeContext();
    const result = resolveIntent('fai un rettangolo', ctx);
    expect(result.context).toBe(ctx);
  });

  it('high confidence when 2+ keywords match', () => {
    const result = resolveIntent('build screen and design page together', makeContext());
    expect(result.pack?.id).toBe('build-screen');
    expect(result.confidence).toBe('high');
  });

  it('trigger confidence affects routing — high-confidence trigger wins with fewer matches', () => {
    // Both packs may match but the one with higher confidence trigger should win
    // "design system" is a high-confidence trigger (0.95) for build-design-system
    const result = resolveIntent('setup the design system tokens', makeContext());
    expect(result.pack?.id).toBe('build-design-system');
  });

  it('"update me on the status" should NOT match (generic verb without design context)', () => {
    const result = resolveIntent('update me on the status', makeContext());
    expect(result.pack).toBeNull();
    expect(result.confidence).toBe('none');
  });

  it('"update the header design" SHOULD match (generic verb + design context)', () => {
    const result = resolveIntent('update the header design', makeContext());
    expect(result.pack?.id).toBe('update-screen');
  });

  it('"change the button color" SHOULD match (generic verb + design context word)', () => {
    const result = resolveIntent('change the button color', makeContext());
    expect(result.pack).not.toBeNull();
  });

  it('"cambia questo" should NOT match (generic Italian verb without design context)', () => {
    const result = resolveIntent('cambia questo', makeContext());
    expect(result.pack).toBeNull();
    expect(result.confidence).toBe('none');
  });
});
