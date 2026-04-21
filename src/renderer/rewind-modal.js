(() => {
  'use strict';

  /**
   * @typedef {{
   *   id: string;
   *   fileKey: string;
   *   slotId: string;
   *   turnIndex: number;
   *   prompt: string;
   *   timestamp: number;
   *   restorableCount: number;
   *   nonRestorableCount: number;
   *   executeTouched: boolean;
   * }} CheckpointSummary
   *
   * @typedef {{
   *   success: boolean;
   *   restoredMutations: number;
   *   skippedMutations: number;
   *   undoToken?: string;
   *   error?: string;
   * }} RestoreResult
   *
   * @typedef {{
   *   checkpoint: {
   *     list(fileKey: string): Promise<CheckpointSummary[]>;
   *     restore(fileKey: string, checkpointId: string, scope: 'last-turn' | 'to-checkpoint'): Promise<RestoreResult>;
   *     undoRestore(fileKey: string, undoToken: string): Promise<RestoreResult>;
   *   };
   * }} RewindApi
   */

  const ACCENT_TOOLTIP = 'Open checkpoints';
  const OUTDATED_TOOLTIP = 'Rewind unavailable: update the Figma plugin';
  const NON_RESTORABLE_TOAST =
    'Questo checkpoint contiene figma_execute e non può essere ripristinato. I tool dedicati (rename, move, set_fills) creano checkpoint restorable.';
  // Must match UNDO_TTL_MS in src/main/rewind/manager.ts — main keeps the undo
  // entry alive for this duration, so the renderer should surface the button for
  // exactly the same window. A mismatch would either show a dead button or hide
  // a live token.
  const UNDO_WINDOW_MS = 300_000;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clearChildren(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  }

  function pluralize(word, count) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  const SKIP_REASON_LABELS = {
    'ws-timeout': 'probe timeout',
    'node-not-found': 'node deleted',
    unsupported: 'unsupported tool',
    execute: 'code execution',
    'inverse-unavailable': 'auto-layout parent',
    'inverse-failed': 'inverse error',
  };

  function formatSkipReasons(skipReasons) {
    if (!skipReasons || typeof skipReasons !== 'object') return '';
    const entries = Object.entries(skipReasons).filter(([, count]) => typeof count === 'number' && count > 0);
    if (entries.length === 0) return '';
    const parts = entries.map(([reason, count]) => `${count} ${SKIP_REASON_LABELS[reason] || reason}`);
    return ` (${parts.join(', ')})`;
  }

  function initRewindController(api, doc) {
    const d = doc || document;
    const chip = d.getElementById('rewind-chip');
    const count = d.getElementById('rewind-count');
    const overlay = d.getElementById('rewind-overlay');
    const panel = overlay?.querySelector('.rewind-panel') ?? null;
    const closeBtn = overlay?.querySelector('.rewind-close') ?? null;
    const banner = d.getElementById('rewind-banner');
    const list = d.getElementById('rewind-list');
    const undoBtn = d.getElementById('rewind-undo-btn');
    if (!chip || !count || !overlay || !panel || !closeBtn || !banner || !list || !undoBtn || !api?.checkpoint) {
      return null;
    }

    /** @type {{
     *   activeFileKey: string | null;
     *   summaries: CheckpointSummary[];
     *   isOpen: boolean;
     *   outdatedFileKeys: Set<string>;
     *   globalOutdated: boolean;
     *   undo: { fileKey: string; undoToken: string; expiresAt: number } | null;
     *   undoTimerId: ReturnType<typeof setInterval> | null;
     *   toastTimerId: ReturnType<typeof setTimeout> | null;
     *   apiOverrides: {
     *     restore?: (fileKey: string, checkpointId: string, scope: 'last-turn' | 'to-checkpoint') => Promise<RestoreResult>;
     *     undoRestore?: (fileKey: string, undoToken: string) => Promise<RestoreResult>;
     *   } | null;
     * }} */
    const state = {
      activeFileKey: null,
      summaries: [],
      isOpen: false,
      outdatedFileKeys: new Set(),
      globalOutdated: false,
      undo: null,
      undoTimerId: null,
      toastTimerId: null,
      apiOverrides: null,
      bindGuard: (() => {
        if (window.createGenerationGuard) return window.createGenerationGuard();
        // Fallback: preserve supersede semantics so stale writes are still
        // dropped even if generation-guard.js failed to load. Returning
        // `isCurrent: () => true` here would silently defeat the race guard
        // — the very bug this module was refactored to prevent.
        let n = 0;
        return {
          advance() {
            n += 1;
            return n;
          },
          isCurrent(gen) {
            return gen === n;
          },
          value() {
            return n;
          },
        };
      })(),
      /** Pruning notices queued for files the user wasn't viewing when they fired. */
      pendingPruneByFile: new Map(),
    };

    const toastHost = el('div', 'rewind-toast-host');
    const toast = el('div', 'rewind-toast hidden');
    toast.setAttribute('role', 'status');
    toastHost.appendChild(toast);
    d.body.appendChild(toastHost);

    function isCurrentFileOutdated() {
      return state.globalOutdated || (!!state.activeFileKey && state.outdatedFileKeys.has(state.activeFileKey));
    }

    function syncChip() {
      const visible = isCurrentFileOutdated() || (!!state.activeFileKey && state.summaries.length > 0);
      chip.classList.toggle('hidden', !visible);
      chip.classList.toggle('disabled', isCurrentFileOutdated());
      chip.disabled = isCurrentFileOutdated();
      chip.title = isCurrentFileOutdated() ? OUTDATED_TOOLTIP : ACCENT_TOOLTIP;
      count.textContent = String(state.summaries.length);
      syncUndoVisibility();
    }

    function syncUndoVisibility() {
      // Hide the undo button when the active tab no longer matches the file
      // whose restore produced the token. The token stays alive in the main
      // buffer so the user can recover by switching back to the original file.
      if (!state.undo) {
        undoBtn.classList.add('hidden');
        return;
      }
      if (state.undo.fileKey !== state.activeFileKey) {
        undoBtn.classList.add('hidden');
        return;
      }
      undoBtn.classList.remove('hidden');
    }

    function setBanner(message, tone) {
      banner.textContent = message;
      banner.classList.remove('hidden', 'warning', 'info');
      if (tone) banner.classList.add(tone);
    }

    function hideBanner() {
      banner.textContent = '';
      banner.classList.add('hidden');
      banner.classList.remove('warning', 'info');
    }

    function showToast(message, tone) {
      if (state.toastTimerId) clearTimeout(state.toastTimerId);
      toast.textContent = message;
      toast.classList.remove('hidden', 'error', 'success', 'info');
      if (tone) toast.classList.add(tone);
      state.toastTimerId = setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('error', 'success', 'info');
      }, 3_000);
    }

    function clearUndo() {
      if (state.undoTimerId) clearInterval(state.undoTimerId);
      state.undoTimerId = null;
      state.undo = null;
      undoBtn.classList.add('hidden');
      undoBtn.textContent = '\u21A9 Undo last rewind';
    }

    function updateUndoLabel() {
      if (!state.undo) return;
      const remainingMs = Math.max(state.undo.expiresAt - Date.now(), 0);
      if (remainingMs === 0) {
        clearUndo();
        return;
      }
      const remainingSec = Math.ceil(remainingMs / 1000);
      undoBtn.textContent = `\u21A9 Undo last rewind (${remainingSec}s)`;
    }

    function startUndo(fileKey, undoToken) {
      if (!undoToken) {
        clearUndo();
        return;
      }
      clearUndo();
      state.undo = { fileKey, undoToken, expiresAt: Date.now() + UNDO_WINDOW_MS };
      syncUndoVisibility();
      updateUndoLabel();
      state.undoTimerId = setInterval(updateUndoLabel, 1_000);
    }

    async function loadSummaries(fileKey) {
      if (!fileKey) return [];
      try {
        const summaries = await api.checkpoint.list(fileKey);
        return Array.isArray(summaries) ? [...summaries].sort((left, right) => right.timestamp - left.timestamp) : [];
      } catch (_err) {
        showToast('Failed to load checkpoints.', 'error');
        return [];
      }
    }

    function createBadge(label, className, title) {
      const badge = el('span', className, label);
      if (title) badge.title = title;
      return badge;
    }

    async function restoreCheckpoint(checkpointId) {
      if (!state.activeFileKey || isCurrentFileOutdated()) return;
      const restore = state.apiOverrides?.restore ?? api.checkpoint.restore;
      const result = await restore(state.activeFileKey, checkpointId, 'to-checkpoint');
      if (result?.success) return;
      // Partial-restore: main returns {success: false, error, undoToken, restoredMutations > 0}
      // when an executeTouched checkpoint aborts the scope after some clean ones
      // have already been replayed. Arm the undo button so the user can recover
      // the applied inverses instead of orphaning them.
      if (result?.undoToken && result.restoredMutations > 0) {
        startUndo(state.activeFileKey, result.undoToken);
        showToast(
          `${result.error || 'Rewind aborted.'} Restored ${pluralize('mutation', result.restoredMutations)} before stopping — use Undo to revert.`,
          'error',
        );
        void refresh();
        return;
      }
      showToast(result?.error || 'Rewind failed.', 'error');
    }

    async function undoLastRestore() {
      if (!state.undo || !state.activeFileKey) return;
      // Refuse to undo when the active tab doesn't own the token — prevents a
      // stray keyboard shortcut from applying changes to the visible file that
      // belong to a different one.
      if (state.undo.fileKey !== state.activeFileKey) {
        syncUndoVisibility();
        return;
      }
      const undoRestore = state.apiOverrides?.undoRestore ?? api.checkpoint.undoRestore;
      const result = await undoRestore(state.undo.fileKey, state.undo.undoToken);
      clearUndo();
      if (result?.success) {
        showToast(`Undo restored ${pluralize('mutation', result.restoredMutations)}.`, 'success');
        void refresh();
        return;
      }
      showToast(result?.error || 'Undo failed.', 'error');
    }

    function renderList() {
      clearChildren(list);
      if (isCurrentFileOutdated()) {
        setBanner('The connected Figma plugin is outdated. Update the plugin to use rewind.', 'warning');
      } else {
        hideBanner();
      }

      if (state.summaries.length === 0) {
        const empty = el('li', 'rewind-empty', 'No checkpoints yet.');
        list.appendChild(empty);
        return;
      }

      for (const summary of state.summaries) {
        const nonRestorable = summary.executeTouched || summary.restorableCount === 0;
        const item = el('li', `rewind-item${nonRestorable ? ' non-restorable' : ''}`);
        item.dataset.id = summary.id;
        item.tabIndex = 0;

        const main = el('div', 'rewind-item-main');
        const time = el('time', 'rewind-time', formatTimestamp(summary.timestamp));
        time.dateTime = new Date(summary.timestamp).toISOString();
        const prompt = el('span', 'rewind-prompt', summary.prompt || 'Untitled checkpoint');
        main.appendChild(time);
        main.appendChild(prompt);

        const badges = el('div', 'rewind-badges');
        if (summary.executeTouched) {
          badges.appendChild(createBadge('Non-restorable', 'badge-non-restorable', 'Contains figma_execute'));
        } else if (summary.nonRestorableCount > 0 || summary.restorableCount === 0) {
          badges.appendChild(createBadge('Partial', 'badge-partial'));
        }
        if (summary.restorableCount > 0) {
          badges.appendChild(createBadge(`${summary.restorableCount} restorable`, 'badge-restorable'));
        }

        const restoreBtn = el('button', 'rewind-restore', 'Restore');
        restoreBtn.type = 'button';
        restoreBtn.setAttribute('aria-label', 'Restore this checkpoint');
        restoreBtn.disabled = nonRestorable || isCurrentFileOutdated();
        if (restoreBtn.disabled && summary.executeTouched) {
          restoreBtn.title = 'Contains arbitrary code execution and cannot be restored';
        }
        restoreBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          void restoreCheckpoint(summary.id);
        });
        if (nonRestorable) {
          item.addEventListener('click', () => {
            if (isCurrentFileOutdated()) return;
            showToast(NON_RESTORABLE_TOAST, 'error');
          });
        }

        item.appendChild(main);
        item.appendChild(badges);
        item.appendChild(restoreBtn);
        item.addEventListener('keydown', (event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !restoreBtn.disabled) {
            event.preventDefault();
            void restoreCheckpoint(summary.id);
          }
        });
        list.appendChild(item);
      }
    }

    function trapFocus(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(panel.querySelectorAll('button:not([disabled]), [tabindex="0"]')).filter(
        (node) => !node.classList.contains('hidden'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && d.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && d.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    async function refresh() {
      // Pin the generation to the current active fileKey so a refresh that
      // completes after a tab switch does not overwrite the new tab's list.
      const generation = state.bindGuard.value();
      const fileKey = state.activeFileKey;
      const summaries = await loadSummaries(fileKey);
      if (!state.bindGuard.isCurrent(generation) || fileKey !== state.activeFileKey) return;
      state.summaries = summaries;
      syncChip();
      if (state.isOpen) renderList();
    }

    async function bindActiveFileKey(fileKey) {
      // Race guard: app.js fires bindActiveFileKey non-awaited on tab events,
      // so two rapid tab switches can overlap. Tag each call with a monotonic
      // generation and discard summaries that return after a newer bind ran.
      const generation = state.bindGuard.advance();
      state.activeFileKey = fileKey || null;
      if (!state.activeFileKey) {
        state.summaries = [];
        clearUndo();
        syncChip();
        if (state.isOpen) close();
        return;
      }
      const summaries = await loadSummaries(state.activeFileKey);
      if (!state.bindGuard.isCurrent(generation)) return; // superseded
      state.summaries = summaries;
      syncChip();
      if (state.isOpen) renderList();
      flushPendingPrune(state.activeFileKey);
    }

    async function open(fileKey) {
      const nextFileKey = fileKey || state.activeFileKey;
      if (!nextFileKey || isCurrentFileOutdated()) return;
      if (nextFileKey !== state.activeFileKey) {
        await bindActiveFileKey(nextFileKey);
      }
      state.isOpen = true;
      renderList();
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      try {
        closeBtn.focus({ preventScroll: true });
      } catch (_err) {
        closeBtn.focus();
      }
    }

    function close() {
      state.isOpen = false;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }

    function handleCheckpointAdded(fileKey, summary) {
      if (!state.activeFileKey || fileKey !== state.activeFileKey) return;
      if (summary && typeof summary.total === 'number') {
        count.textContent = String(summary.total);
      }
      chip.classList.remove('hidden');
      void refresh();
    }

    function handleRestored(fileKey, result) {
      if (!state.activeFileKey || fileKey !== state.activeFileKey) return;
      if (!result?.success) {
        // Partial-restore path: when restore aborts mid-scope (e.g. a poisoned
        // executeTouched checkpoint is hit after replaying clean ones), main
        // returns {success: false, error, restoredMutations > 0, undoToken}.
        // Dropping the token here would orphan the already-applied inverses and
        // the user would have no way to recover them — arm undo and surface
        // the partial status.
        if (result?.undoToken && result.restoredMutations > 0) {
          startUndo(fileKey, result.undoToken);
          showToast(
            `${result.error || 'Rewind aborted.'} Restored ${pluralize('mutation', result.restoredMutations)} before stopping — use Undo to revert.`,
            'error',
          );
          void refresh();
          return;
        }
        showToast(result?.error || 'Rewind failed.', 'error');
        return;
      }
      if (result.undoToken) startUndo(fileKey, result.undoToken);
      const skipSuffix =
        result.skippedMutations > 0
          ? ` Skipped ${pluralize('mutation', result.skippedMutations)}${formatSkipReasons(result.skipReasons)}.`
          : '';
      showToast(`Restored ${pluralize('mutation', result.restoredMutations)}.${skipSuffix}`, 'success');
      void refresh();
    }

    function handlePluginOutdated(fileKey) {
      if (fileKey) state.outdatedFileKeys.add(fileKey);
      else state.globalOutdated = true;
      syncChip();
      if (state.isOpen) renderList();
    }

    function handleCheckpointPruned(fileKey, payload) {
      const prunedCount = payload && typeof payload.prunedCount === 'number' ? payload.prunedCount : 0;
      if (prunedCount <= 0 || !fileKey) return;
      if (fileKey !== state.activeFileKey) {
        // Queue the notice — surface when the user switches to that tab.
        const existing = state.pendingPruneByFile.get(fileKey) || 0;
        state.pendingPruneByFile.set(fileKey, existing + prunedCount);
        return;
      }
      showToast(
        `Oldest ${pluralize('checkpoint', prunedCount)} dropped — rewind keeps only the last 20 turns.`,
        'info',
      );
      void refresh();
    }

    function flushPendingPrune(fileKey) {
      if (!fileKey) return;
      const pending = state.pendingPruneByFile.get(fileKey);
      if (!pending) return;
      state.pendingPruneByFile.delete(fileKey);
      showToast(
        `Oldest ${pluralize('checkpoint', pending)} dropped while viewing another file — rewind keeps only the last 20 turns.`,
        'info',
      );
    }

    chip.addEventListener('click', () => {
      if (chip.disabled) return;
      void open(state.activeFileKey);
    });
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', trapFocus);
    undoBtn.addEventListener('click', () => {
      void undoLastRestore();
    });

    const controller = {
      bindActiveFileKey,
      open,
      close,
      refresh,
      handleCheckpointAdded,
      handleRestored,
      handlePluginOutdated,
      handleCheckpointPruned,
      __setTestOverrides(overrides) {
        state.apiOverrides = overrides || null;
      },
      __getState() {
        return {
          activeFileKey: state.activeFileKey,
          summaryCount: state.summaries.length,
          isOpen: state.isOpen,
          undoToken: state.undo?.undoToken ?? null,
          outdated: isCurrentFileOutdated(),
        };
      },
    };

    return controller;
  }

  if (typeof window !== 'undefined' && window.api) {
    window.rewindController = initRewindController(window.api, document);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initRewindController };
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__rewindModalForTests = { initRewindController };
  }
})();
