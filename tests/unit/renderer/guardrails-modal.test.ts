// @vitest-environment happy-dom

/**
 * guardrails-modal.js — renderer modal controller.
 * Runs under happy-dom (see pragma above) so we exercise real DOM semantics.
 *
 * Critical assertion: user-controlled strings go through `textContent`, not
 * `innerHTML`. Any regression that reintroduces innerHTML would create real
 * <script>/<img> elements, which this test will catch.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

let GuardrailsModal: typeof import('../../../src/renderer/guardrails-modal.js') = {} as any;

function mountRoot() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  const root = document.createElement('div');
  root.id = 'guardrails-modal-root';
  root.className = 'gr-modal-hidden';
  document.body.appendChild(root);
  return root;
}

function makeFakeApi() {
  const respond = vi.fn();
  let handler: ((req: any) => void) | null = null;
  return {
    api: {
      guardrailsRespond: respond,
      onGuardrailsConfirmRequest: (cb: (req: any) => void) => {
        handler = cb;
      },
    },
    fire: (req: any) => handler?.(req),
    respond,
  };
}

beforeEach(() => {
  mountRoot();
  // Clear require cache so the module's auto-init IIFE re-runs against the
  // freshly-mounted DOM. Without this, the dual-export branch caches once
  // at first require().
  delete require.cache[require.resolve('../../../src/renderer/guardrails-modal.js')];
  GuardrailsModal = require('../../../src/renderer/guardrails-modal.js');
});

describe('guardrails-modal — XSS safety (happy-dom real DOM)', () => {
  it('user-controlled strings are rendered as text, never parsed as HTML', () => {
    const { modal } = GuardrailsModal.buildModal({
      match: {
        ruleId: '<script>window.__pwn = 1;</script>',
        description: '<img src=x onerror="window.__pwn = 2">',
        toolName: 'figma_delete',
        affectedLabel: '<b>bold</b>',
      },
    });
    // Mount to inspect via real DOM APIs
    document.body.appendChild(modal);
    expect(modal.querySelector('script')).toBeNull();
    expect(modal.querySelector('img')).toBeNull();
    expect(modal.querySelector('b')).toBeNull();
    expect((window as any).__pwn).toBeUndefined();
    // Literals are visible as text
    expect(modal.textContent).toContain('<script>window.__pwn = 1;</script>');
    expect(modal.textContent).toContain('<b>bold</b>');
  });

  it('buildModal returns correctly classed buttons (type="button")', () => {
    const { blockBtn, allowBtn } = GuardrailsModal.buildModal({
      match: { ruleId: 'x', description: 'y', toolName: 't', affectedLabel: 'a' },
    });
    expect(blockBtn.className).toBe('gr-btn-block');
    expect((blockBtn as HTMLButtonElement).type).toBe('button');
    expect(allowBtn.className).toBe('gr-btn-allow');
    expect((allowBtn as HTMLButtonElement).type).toBe('button');
  });
});

describe('guardrails-modal — init controller', () => {
  it('shows modal and dispatches block decision on Block click', () => {
    const { api, fire, respond } = makeFakeApi();
    const root = document.getElementById('guardrails-modal-root')!;
    GuardrailsModal.initGuardrailsModal(api, document);
    fire({
      requestId: 'r1',
      slotId: 's1',
      timestamp: 0,
      match: { ruleId: 'bulk-delete', description: 'd', toolName: 'figma_delete', affectedLabel: '10' },
    });
    expect(root.classList.contains('gr-modal-hidden')).toBe(false);

    const blockBtn = root.querySelector<HTMLButtonElement>('.gr-btn-block')!;
    blockBtn.click();
    expect(respond).toHaveBeenCalledWith({ requestId: 'r1', decision: 'block' });
    expect(root.classList.contains('gr-modal-hidden')).toBe(true);
  });

  it('dispatches allow-once on Allow button', () => {
    const { api, fire, respond } = makeFakeApi();
    const root = document.getElementById('guardrails-modal-root')!;
    GuardrailsModal.initGuardrailsModal(api, document);
    fire({
      requestId: 'r2',
      slotId: 's1',
      timestamp: 0,
      match: { ruleId: 'detach-main-instance', description: 'd', toolName: 't', affectedLabel: 'a' },
    });
    const allowBtn = root.querySelector<HTMLButtonElement>('.gr-btn-allow')!;
    allowBtn.click();
    expect(respond).toHaveBeenCalledWith({ requestId: 'r2', decision: 'allow-once' });
  });

  it('ignores requests without requestId', () => {
    const { api, fire, respond } = makeFakeApi();
    const root = document.getElementById('guardrails-modal-root')!;
    GuardrailsModal.initGuardrailsModal(api, document);
    fire({ match: { ruleId: 'x' } });
    expect(respond).not.toHaveBeenCalled();
    expect(root.classList.contains('gr-modal-hidden')).toBe(true);
  });

  it('queues concurrent requests — second modal shows only after first is answered (H-A regression guard)', () => {
    const { api, fire, respond } = makeFakeApi();
    const root = document.getElementById('guardrails-modal-root')!;
    GuardrailsModal.initGuardrailsModal(api, document);

    fire({
      requestId: 'r-first',
      slotId: 's1',
      timestamp: 0,
      match: { ruleId: 'bulk-delete', description: 'first', toolName: 'figma_delete', affectedLabel: '10' },
    });
    fire({
      requestId: 'r-second',
      slotId: 's2',
      timestamp: 0,
      match: { ruleId: 'bulk-delete', description: 'second', toolName: 'figma_delete', affectedLabel: '20' },
    });

    // Only one modal is mounted; first request's description is still visible.
    expect(root.querySelectorAll('.gr-modal').length).toBe(1);
    expect(root.textContent).toContain('first');
    expect(root.textContent).not.toContain('second');

    // Answer the first → second must come up
    root.querySelector<HTMLButtonElement>('.gr-btn-allow')!.click();
    expect(respond).toHaveBeenNthCalledWith(1, { requestId: 'r-first', decision: 'allow-once' });
    expect(root.querySelectorAll('.gr-modal').length).toBe(1);
    expect(root.textContent).toContain('second');

    // Answer the second — queue drains to empty
    root.querySelector<HTMLButtonElement>('.gr-btn-block')!.click();
    expect(respond).toHaveBeenNthCalledWith(2, { requestId: 'r-second', decision: 'block' });
    expect(root.classList.contains('gr-modal-hidden')).toBe(true);
    expect(root.children.length).toBe(0);
  });
});
