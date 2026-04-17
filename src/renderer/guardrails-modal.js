/**
 * Guardrails confirmation modal.
 *
 * Listens for 'guardrails:confirm-request' events from main and renders a
 * blocking overlay with a Block / Allow once decision. Built with
 * createElement + textContent — NO innerHTML — because ruleId / description /
 * affectedLabel / toolName may contain user-controlled strings (Figma node
 * names can include HTML-like characters).
 *
 * Dual export: attaches to `window.guardrailsModal` for the renderer, and
 * exports via module.exports / globalThis for vitest (same pattern as
 * status-strip.js).
 */

(() => {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clearChildren(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function buildModal(req) {
    const match = req?.match || {};
    const modal = el('div', 'gr-modal');

    const header = el('header', 'gr-modal-header', '\u26A0 Azione potenzialmente distruttiva');
    const body = el('div', 'gr-modal-body');
    body.appendChild(el('div', 'gr-modal-rule', match.ruleId || ''));
    body.appendChild(el('div', 'gr-modal-desc', match.description || ''));
    body.appendChild(el('div', 'gr-modal-affected', match.affectedLabel || ''));

    const toolRow = el('div', 'gr-modal-tool');
    toolRow.appendChild(document.createTextNode('Tool: '));
    toolRow.appendChild(el('code', null, match.toolName || ''));
    body.appendChild(toolRow);

    const actions = el('footer', 'gr-modal-actions');
    const blockBtn = el('button', 'gr-btn-block', 'Block');
    blockBtn.type = 'button';
    const allowBtn = el('button', 'gr-btn-allow', 'Allow once');
    allowBtn.type = 'button';
    actions.appendChild(blockBtn);
    actions.appendChild(allowBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(actions);
    return { modal, blockBtn, allowBtn };
  }

  /**
   * Render a confirm-request into the given root element. Exposed so E2E
   * tests can drive the modal without going through the full IPC round-trip.
   */
  function showConfirmRequest(api, root, req, onClosed) {
    if (!root || !req || !req.requestId) {
      onClosed?.();
      return;
    }

    clearChildren(root);
    const { modal, blockBtn, allowBtn } = buildModal(req);
    root.appendChild(modal);
    root.classList.remove('gr-modal-hidden');
    root.setAttribute('aria-hidden', 'false');

    const respond = (decision) => {
      try {
        api.guardrailsRespond({ requestId: req.requestId, decision });
      } catch (err) {
        // Main will timeout and fail-closed, but surface the error to dev-tools
        // so renderer-side regressions aren't invisible.
        // biome-ignore lint/suspicious/noConsole: dev-tools surface for renderer-side failures
        console.warn('[guardrails] respond failed', err);
      }
      clearChildren(root);
      root.classList.add('gr-modal-hidden');
      root.setAttribute('aria-hidden', 'true');
      onClosed?.();
    };

    blockBtn.addEventListener('click', () => {
      respond('block');
    });
    allowBtn.addEventListener('click', () => {
      respond('allow-once');
    });

    // Focus the safer option (Block) for keyboard users.
    try {
      blockBtn.focus({ preventScroll: true });
    } catch (_err) {
      // jsdom lacks focus options; ignore.
    }
  }

  /**
   * Initialise the modal controller. Exposed for tests; production calls
   * it automatically via DOMContentLoaded below.
   *
   * Concurrent confirm requests (multiple slots in flight) are queued rather
   * than overwriting the visible modal — otherwise the first slot's prompt
   * would be wiped before the user could see it and that slot's pending
   * entry on main would block only on the 10–60s timeout.
   */
  function initGuardrailsModal(api, doc) {
    const d = doc || document;
    const root = d.getElementById('guardrails-modal-root');
    if (!root || !api || typeof api.onGuardrailsConfirmRequest !== 'function') return;

    const queue = [];
    let active = false;

    const drain = () => {
      if (active) return;
      const next = queue.shift();
      if (!next) return;
      active = true;
      showConfirmRequest(api, root, next, () => {
        active = false;
        drain();
      });
    };

    api.onGuardrailsConfirmRequest((req) => {
      queue.push(req);
      drain();
    });
  }

  // Auto-init in renderer (has `window.api`). Tests call initGuardrailsModal directly.
  if (typeof window !== 'undefined' && window.api) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initGuardrailsModal(window.api, document);
      });
    } else {
      initGuardrailsModal(window.api, document);
    }
    window.guardrailsModal = { initGuardrailsModal, buildModal, showConfirmRequest };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initGuardrailsModal, buildModal, showConfirmRequest };
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__guardrailsModalForTests = { initGuardrailsModal, buildModal, showConfirmRequest };
  }
})();
