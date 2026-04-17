/**
 * Guardrails rule matcher tests. Each built-in rule is asserted in isolation
 * for match/no-match, including fail-open behaviour when the WS connector is
 * absent (rule B). Rule B cache pollution across tests is avoided via
 * __clearNodeInfoCacheForTests() in beforeEach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearNodeInfoCacheForTests, evaluateRules } from '../../../../src/main/guardrails/rules.js';

type FakeConnector = {
  executeCodeViaUI: ReturnType<typeof vi.fn>;
};

function fakeConnector(result: any): FakeConnector {
  return {
    executeCodeViaUI: vi.fn(async () => result),
  };
}

const NULL_CTX = { connector: null, fileKey: 'f1' };

beforeEach(() => {
  __clearNodeInfoCacheForTests();
});
afterEach(() => {
  __clearNodeInfoCacheForTests();
});

describe('Rule A — bulk-delete', () => {
  it('matches figma_delete with nodeIds length > 5', async () => {
    const m = await evaluateRules('figma_delete', { nodeIds: ['a', 'b', 'c', 'd', 'e', 'f'] }, NULL_CTX);
    expect(m?.ruleId).toBe('bulk-delete');
    expect(m?.affectedLabel).toBe('6 nodes');
  });
  it('records exact N in description for length 100', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => String(i));
    const m = await evaluateRules('figma_delete', { nodeIds: ids }, NULL_CTX);
    expect(m?.description).toContain('Deleting 100 nodes');
  });
  it('does NOT match at threshold 5', async () => {
    const m = await evaluateRules('figma_delete', { nodeIds: ['a', 'b', 'c', 'd', 'e'] }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('does NOT match a single delete', async () => {
    const m = await evaluateRules('figma_delete', { nodeIds: ['a'] }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('matches figma_execute with two .remove() calls', async () => {
    const code = 'const a = await figma.getNodeByIdAsync("1:2"); a.remove(); a.remove();';
    const m = await evaluateRules('figma_execute', { code }, NULL_CTX);
    expect(m?.ruleId).toBe('bulk-delete');
  });
  it('matches figma_execute with deleteMany(', async () => {
    const m = await evaluateRules('figma_execute', { code: 'deleteMany(nodes);' }, NULL_CTX);
    expect(m?.ruleId).toBe('bulk-delete');
  });
  it('does NOT match figma_execute with a single .remove()', async () => {
    const m = await evaluateRules('figma_execute', { code: 'node.remove();' }, NULL_CTX);
    expect(m).toBeNull();
  });
});

describe('Rule C — variable-delete-via-execute', () => {
  it('matches figma.variables.deleteLocalVariable', async () => {
    const m = await evaluateRules('figma_execute', { code: 'figma.variables.deleteLocalVariable(varId);' }, NULL_CTX);
    expect(m?.ruleId).toBe('variable-delete-via-execute');
  });
  it('matches .removeVariable(', async () => {
    const m = await evaluateRules('figma_execute', { code: 'ds.removeVariable(id);' }, NULL_CTX);
    expect(m?.ruleId).toBe('variable-delete-via-execute');
  });
  it('matches deleteVariableCollection', async () => {
    const m = await evaluateRules('figma_execute', { code: 'figma.variables.deleteVariableCollection(id);' }, NULL_CTX);
    expect(m?.ruleId).toBe('variable-delete-via-execute');
  });
  it('does NOT match non-deletion variable access', async () => {
    const m = await evaluateRules('figma_execute', { code: 'variable.name = "x";' }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('does NOT match on tools other than figma_execute', async () => {
    const m = await evaluateRules('figma_set_text', { code: 'deleteLocalVariable(1)' }, NULL_CTX);
    expect(m).toBeNull();
  });
});

describe('Rule D — detach-main-instance', () => {
  it('matches .detachInstance()', async () => {
    const m = await evaluateRules('figma_execute', { code: 'instance.detachInstance();' }, NULL_CTX);
    expect(m?.ruleId).toBe('detach-main-instance');
  });
  it('tolerates spacing variants like .detachInstance ( )', async () => {
    const m = await evaluateRules('figma_execute', { code: 'instance.detachInstance ( );' }, NULL_CTX);
    expect(m?.ruleId).toBe('detach-main-instance');
  });
  it('does NOT match the string literal "detachInstance" without the call', async () => {
    const m = await evaluateRules('figma_execute', { code: 'const name = "detachInstance";' }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('does NOT match on non-execute tools', async () => {
    const m = await evaluateRules('figma_set_text', { code: 'x.detachInstance()' }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('does NOT match identifiers ending in "detachInstance"', async () => {
    const m = await evaluateRules('figma_execute', { code: 'helpers.softDetachInstance();' }, NULL_CTX);
    expect(m).toBeNull();
  });
});

describe('Rule B — main-ds-component', () => {
  it('matches when connector reports type COMPONENT', async () => {
    const c = fakeConnector({ type: 'COMPONENT', name: 'Button', pageName: 'Screens' });
    const m = await evaluateRules('figma_set_fills', { nodeId: '1:2' }, { connector: c as any, fileKey: 'f1' });
    expect(m?.ruleId).toBe('main-ds-component');
    expect(m?.affectedLabel).toBe('Button');
  });
  it('matches when ancestor page name matches /design\\s*system/i', async () => {
    const c = fakeConnector({ type: 'FRAME', name: 'Card', pageName: 'Design System' });
    const m = await evaluateRules('figma_set_fills', { nodeId: '1:2' }, { connector: c as any, fileKey: 'f1' });
    expect(m?.ruleId).toBe('main-ds-component');
    expect(m?.affectedLabel).toContain('Design System');
  });
  it('does NOT match on ordinary frame outside DS page', async () => {
    const c = fakeConnector({ type: 'FRAME', name: 'Hero', pageName: 'Homepage' });
    const m = await evaluateRules('figma_set_fills', { nodeId: '1:2' }, { connector: c as any, fileKey: 'f1' });
    expect(m).toBeNull();
  });
  it('fails-open (no match) when connector is null', async () => {
    const m = await evaluateRules('figma_set_fills', { nodeId: '1:2' }, NULL_CTX);
    expect(m).toBeNull();
  });
  it('fails-open when executeCodeViaUI throws', async () => {
    const c = {
      executeCodeViaUI: vi.fn(async () => {
        throw new Error('bridge down');
      }),
    };
    const m = await evaluateRules('figma_set_fills', { nodeId: '1:2' }, { connector: c as any, fileKey: 'f1' });
    expect(m).toBeNull();
  });
});

describe('Rule priority', () => {
  it('prefers variable-delete-via-execute over bulk-delete when both would match', async () => {
    // Code has 2x .remove() AND deleteLocalVariable — variable rule wins per RULE_ORDER
    const code = 'figma.variables.deleteLocalVariable(id); a.remove(); b.remove();';
    const m = await evaluateRules('figma_execute', { code }, NULL_CTX);
    expect(m?.ruleId).toBe('variable-delete-via-execute');
  });
  it('prefers detach-main-instance over bulk-delete when both would match', async () => {
    const code = 'instance.detachInstance(); a.remove(); b.remove();';
    const m = await evaluateRules('figma_execute', { code }, NULL_CTX);
    expect(m?.ruleId).toBe('detach-main-instance');
  });
});
