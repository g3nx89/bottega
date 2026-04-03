import { describe, expect, it } from 'vitest';
import { buildDesignWorkflowContext } from '../../../../src/main/workflows/design-context.js';

describe('buildDesignWorkflowContext', () => {
  // ─── Session start transitions (no previousMode) ───────────────────────────

  it('session start + dsStatus=none → bootstrap', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'none' });
    expect(ctx.interactionMode).toBe('bootstrap');
  });

  it('session start + dsStatus=unknown → bootstrap', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'unknown' });
    expect(ctx.interactionMode).toBe('bootstrap');
  });

  it('session start + dsStatus=partial → socratic', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'partial' });
    expect(ctx.interactionMode).toBe('socratic');
  });

  it('session start + dsStatus=active → execution', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active' });
    expect(ctx.interactionMode).toBe('execution');
  });

  // ─── State machine transitions ─────────────────────────────────────────────

  it('bootstrap → socratic on approval', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'none',
      previousMode: 'bootstrap',
      userMessage: 'ok, procedi',
    });
    expect(ctx.interactionMode).toBe('socratic');
  });

  it('socratic → execution on confirmation', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'partial',
      previousMode: 'socratic',
      userMessage: 'yes, go ahead',
    });
    expect(ctx.interactionMode).toBe('execution');
  });

  it('execution → socratic on DS change request', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'execution',
      userMessage: 'imposta tokens for the new brand',
    });
    expect(ctx.interactionMode).toBe('socratic');
  });

  it('any → review on audit request', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'execution',
      userMessage: 'please audit the current design',
    });
    expect(ctx.interactionMode).toBe('review');
  });

  it('any → review on "check" keyword', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'partial',
      previousMode: 'socratic',
      userMessage: 'check if everything is fine',
    });
    expect(ctx.interactionMode).toBe('review');
  });

  it('review → returns to modeBeforeReview on completion (Rule 8)', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'review',
      modeBeforeReview: 'execution',
      userMessage: 'ok looks good',
    });
    expect(ctx.interactionMode).toBe('execution');
  });

  it('review → returns to socratic if that was the mode before review', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'partial',
      previousMode: 'review',
      modeBeforeReview: 'socratic',
      userMessage: 'approve',
    });
    expect(ctx.interactionMode).toBe('socratic');
  });

  it('review → defaults to execution if modeBeforeReview not set', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'review',
      userMessage: 'yes',
    });
    expect(ctx.interactionMode).toBe('execution');
  });

  it('any → freeform on opt-out', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'execution',
      userMessage: 'no DS, just draw a rectangle',
    });
    expect(ctx.interactionMode).toBe('freeform');
  });

  it('any → freeform on "skip ds"', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'partial',
      previousMode: 'socratic',
      userMessage: 'skip DS for now',
    });
    expect(ctx.interactionMode).toBe('freeform');
  });

  it('freeform → bootstrap on DS setup request', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'none',
      previousMode: 'freeform',
      userMessage: 'ok now setup DS for me',
    });
    expect(ctx.interactionMode).toBe('bootstrap');
  });

  it('freeform → bootstrap on "imposta tokens"', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'none',
      previousMode: 'freeform',
      userMessage: 'imposta tokens adesso',
    });
    expect(ctx.interactionMode).toBe('bootstrap');
  });

  // ─── Governance policy ─────────────────────────────────────────────────────

  it('strict when DS active + execution mode', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active' });
    expect(ctx.governancePolicy).toBe('strict');
  });

  it('strict when DS active + review mode', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'execution',
      userMessage: 'controlla',
    });
    expect(ctx.governancePolicy).toBe('strict');
  });

  it('freeform governance when mode is freeform', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      previousMode: 'execution',
      userMessage: 'no DS',
    });
    expect(ctx.governancePolicy).toBe('freeform');
  });

  it('adaptive as default (partial DS, no special mode)', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'partial' });
    expect(ctx.governancePolicy).toBe('adaptive');
  });

  it('adaptive when DS=none (bootstrap mode)', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'none' });
    expect(ctx.governancePolicy).toBe('adaptive');
  });

  // ─── Default values ────────────────────────────────────────────────────────

  it('dsRecentlyModified defaults to false', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active' });
    expect(ctx.dsRecentlyModified).toBe(false);
  });

  it('libraryContext defaults to none', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active' });
    expect(ctx.libraryContext).toBe('none');
  });

  it('profileDirectives defaults to empty array', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active' });
    expect(ctx.profileDirectives).toEqual([]);
  });

  it('passes through provided libraryContext', () => {
    const ctx = buildDesignWorkflowContext({ dsStatus: 'active', libraryContext: 'dominant' });
    expect(ctx.libraryContext).toBe('dominant');
  });

  it('passes through profileDirectives', () => {
    const ctx = buildDesignWorkflowContext({
      dsStatus: 'active',
      profileDirectives: ['use-compact-spacing'],
    });
    expect(ctx.profileDirectives).toEqual(['use-compact-spacing']);
  });
});
