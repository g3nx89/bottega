/**
 * Per-request dedup semantics for guardrails state.
 * Block decisions are intentionally NOT remembered so the user is asked
 * again if the agent retries the same tool in the same request.
 */

import { describe, expect, it } from 'vitest';
import {
  createState,
  isAlreadyApproved,
  onAgentStart,
  rememberDecision,
} from '../../../../src/main/guardrails/state.js';

describe('guardrails/state', () => {
  it('initial state has empty approvals', () => {
    const s = createState();
    expect(s.approvedThisRequest.size).toBe(0);
  });

  it('onAgentStart clears approvals', () => {
    const s = createState();
    rememberDecision(s, 'bulk-delete', 'allow-once');
    expect(isAlreadyApproved(s, 'bulk-delete')).toBe(true);
    onAgentStart(s);
    expect(s.approvedThisRequest.size).toBe(0);
    expect(isAlreadyApproved(s, 'bulk-delete')).toBe(false);
  });

  it('remembers allow-once decision for the current request', () => {
    const s = createState();
    rememberDecision(s, 'bulk-delete', 'allow-once');
    expect(isAlreadyApproved(s, 'bulk-delete')).toBe(true);
  });

  it('does NOT remember block decisions', () => {
    const s = createState();
    rememberDecision(s, 'bulk-delete', 'block');
    expect(isAlreadyApproved(s, 'bulk-delete')).toBe(false);
  });

  it('approvals for different rules are independent', () => {
    const s = createState();
    rememberDecision(s, 'bulk-delete', 'allow-once');
    expect(isAlreadyApproved(s, 'bulk-delete')).toBe(true);
    expect(isAlreadyApproved(s, 'detach-main-instance')).toBe(false);
  });

  it('agent_start does not leak approvals from previous requests', () => {
    const s = createState();
    rememberDecision(s, 'main-ds-component', 'allow-once');
    onAgentStart(s);
    expect(isAlreadyApproved(s, 'main-ds-component')).toBe(false);
  });
});
