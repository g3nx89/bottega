// ── Per-tab state ─────────────────────────
const tabs = new Map(); // Map<slotId, TabState>
let activeTabId = null;

/*
  TabState: {
    id, fileKey, fileName, isStreaming, isConnected, modelConfig,
    chatContainer (DOM element — detached when inactive),
    currentAssistantBubble, thinkingBubble,
    queuedPrompts: [] // mirrors server queue for UI display
  }
*/

function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) : null;
}

/** Run fn(tab) if the slot exists, no-op otherwise. */
function withTab(slotId, fn) {
  const tab = tabs.get(slotId);
  if (tab) fn(tab);
}

// DOM references
const chatArea = document.getElementById('chat-area');
const inputField = document.getElementById('input-field');
const sendBtn = document.getElementById('send-btn');
const statusDot = document.getElementById('status-dot');
const pinBtn = document.getElementById('pin-btn');
const appVersion = document.getElementById('app-version');
const tabList = document.getElementById('tab-list');
const tabAddBtn = document.getElementById('tab-add-btn');
const promptQueueEl = document.getElementById('prompt-queue');

// Show app version in titlebar + check for post-update "What's New"
window.api.getAppVersion().then((v) => {
  appVersion.textContent = `v${v}`;

  // Check if we just updated — show "What's New" modal
  const lastVersion = localStorage.getItem('bottega-last-version');
  if (lastVersion && lastVersion !== v) {
    const notes = localStorage.getItem('bottega-update-notes') || '';
    showWhatsNewModal(v, notes);
    localStorage.removeItem('bottega-update-notes');
  }
  localStorage.setItem('bottega-last-version', v);
});

// ── Update modals ─────────────────────────────

const updateModal = document.getElementById('update-modal');
const updateModalVersion = document.getElementById('update-modal-version');
const updateDownloadBtn = document.getElementById('update-download-btn');
const updateLaterBtn = document.getElementById('update-later-btn');
const updateProgressBar = document.getElementById('update-progress-bar');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateStatus = document.getElementById('update-status');
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const whatsNewModal = document.getElementById('whatsnew-modal');
const whatsNewVersion = document.getElementById('whatsnew-version');
const whatsNewNotes = document.getElementById('whatsnew-notes');
const whatsNewCloseBtn = document.getElementById('whatsnew-close-btn');

// Update available — show modal
window.api.onUpdateAvailable((info) => {
  updateModalVersion.textContent = `v${info.version}`;
  updateModal.classList.remove('hidden');
  updateStatus.textContent = `Update v${info.version} available`;
  // Store release notes for "What's New" after restart
  if (info.releaseNotes) {
    localStorage.setItem('bottega-update-notes', info.releaseNotes);
  }
});

// Download button
updateDownloadBtn.addEventListener('click', () => {
  updateDownloadBtn.disabled = true;
  updateDownloadBtn.textContent = 'Downloading…';
  updateProgressBar.classList.remove('hidden');
  window.api.downloadUpdate();
});

// Download progress
window.api.onUpdateProgress((percent) => {
  updateProgressFill.style.width = `${percent}%`;
  updateDownloadBtn.textContent = `Downloading… ${percent}%`;
});

// Download complete
window.api.onUpdateDownloaded((version) => {
  updateDownloadBtn.textContent = 'Restart & Update';
  updateDownloadBtn.disabled = false;
  updateDownloadBtn.onclick = () => window.api.installUpdate();
  updateStatus.textContent = `v${version} ready — restart to install`;
});

// Later button
updateLaterBtn.addEventListener('click', () => {
  updateModal.classList.add('hidden');
});

// Update error
window.api.onUpdateError(() => {
  updateDownloadBtn.textContent = 'Download & Install';
  updateDownloadBtn.disabled = false;
  updateProgressBar.classList.add('hidden');
  updateStatus.textContent = 'Update check failed';
});

// Not available
window.api.onUpdateAvailable ||
  window.api.getAppVersion().then((v) => {
    updateStatus.textContent = `v${v} — up to date`;
  });

// Manual check button in settings
checkUpdatesBtn.addEventListener('click', () => {
  updateStatus.textContent = 'Checking…';
  checkUpdatesBtn.disabled = true;
  window.api.checkForUpdates().then(() => {
    setTimeout(() => {
      checkUpdatesBtn.disabled = false;
    }, 3000);
  });
});

// "What's New" modal
function showWhatsNewModal(version, notes) {
  whatsNewVersion.textContent = `v${version}`;
  // Release notes come as HTML from GitHub — render them safely
  if (notes) {
    // Strip raw HTML tags and extract readable text
    const parser = new DOMParser();
    const doc = parser.parseFromString(notes, 'text/html');
    const text = doc.body.textContent || '';
    // If it's just a "Full Changelog" link, show a friendly default
    if (text.trim().startsWith('Full Changelog') || text.trim().length < 10) {
      whatsNewNotes.textContent = 'Bug fixes and improvements.';
    } else {
      whatsNewNotes.textContent = text.trim();
    }
  } else {
    whatsNewNotes.textContent = 'Bug fixes and improvements.';
  }
  whatsNewModal.classList.remove('hidden');
}

whatsNewCloseBtn.addEventListener('click', () => {
  whatsNewModal.classList.add('hidden');
});

// Set initial update status after check completes
setTimeout(() => {
  if (updateStatus.textContent === 'Checking…') {
    window.api.getAppVersion().then((v) => {
      updateStatus.textContent = `v${v} — up to date`;
    });
  }
}, 10000);

// Utilities
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function autoResizeInput() {
  inputField.style.height = 'auto';
  inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
}

// ── Tab bar management ───────────────────

let dragSourceId = null;

function renderTabBar() {
  const tabIds = [...tabs.keys()];
  const existingEls = tabList.querySelectorAll('.tab-item');
  const existingById = new Map();
  existingEls.forEach((el) => existingById.set(el.dataset.slotId, el));

  // Remove DOM elements for tabs that no longer exist
  for (const [id, el] of existingById) {
    if (!tabs.has(id)) {
      el.remove();
      existingById.delete(id);
    }
  }

  // Update or create elements in order
  let insertBefore = tabList.firstChild;
  for (const id of tabIds) {
    const tab = tabs.get(id);
    let el = existingById.get(id);

    if (!el) {
      // Create new tab element with event listeners (only once)
      el = document.createElement('div');
      el.dataset.slotId = id;
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        dragSourceId = id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        dragSourceId = null;
        el.classList.remove('dragging');
        tabList.querySelectorAll('.tab-item.drag-over').forEach((d) => d.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        if (!dragSourceId || dragSourceId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabList.querySelectorAll('.tab-item.drag-over').forEach((d) => d.classList.remove('drag-over'));
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (!dragSourceId || dragSourceId === id) return;
        reorderTab(dragSourceId, id);
        dragSourceId = null;
      });

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      el.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'tab-label';
      el.appendChild(label);

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '\u00d7';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.closeTab(id);
      });
      el.appendChild(close);

      el.addEventListener('click', () => switchToTab(id));
    }

    // Reconcile classes and text (cheap in-place update)
    el.className =
      'tab-item' +
      (id === activeTabId ? ' active' : '') +
      (tab.isStreaming ? ' streaming' : '') +
      (!tab.isConnected ? ' disconnected' : '');

    const dot = el.querySelector('.tab-dot');
    dot.className = 'tab-dot' + (tab.isConnected ? ' connected' : ' disconnected');

    const label = el.querySelector('.tab-label');
    const newLabel = tab.fileName || 'New Tab';
    if (label.textContent !== newLabel) label.textContent = newLabel;

    // Ensure correct DOM order
    if (el !== insertBefore) tabList.insertBefore(el, insertBefore);
    insertBefore = el.nextSibling;
  }
}

/** Reorder tabs Map: move sourceId before targetId. */
function reorderTab(sourceId, targetId) {
  const entries = [...tabs.entries()];
  const srcIdx = entries.findIndex(([id]) => id === sourceId);
  const tgtIdx = entries.findIndex(([id]) => id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;
  const [moved] = entries.splice(srcIdx, 1);
  entries.splice(tgtIdx, 0, moved);
  tabs.clear();
  for (const [id, tab] of entries) tabs.set(id, tab);
  renderTabBar();
}

function switchToTab(slotId) {
  if (slotId === activeTabId) return;

  // Detach current chat
  const currentTab = getActiveTab();
  if (currentTab?.chatContainer.parentNode) {
    chatArea.removeChild(currentTab.chatContainer);
  }

  activeTabId = slotId;
  window.api.activateTab(slotId);

  // Attach new tab's chat
  const newTab = tabs.get(slotId);
  if (newTab) {
    chatArea.appendChild(newTab.chatContainer);
    updateInputState();
    renderTabBar();
    renderPromptQueue(newTab);
    syncBarToTab(newTab);
    scrollToBottom();
  }
}

/** Update the model and effort bar labels to reflect a tab's actual config. */
function syncBarToTab(tab) {
  // Model label
  if (tab.modelConfig && typeof availableModels === 'object') {
    const allModels = Object.values(availableModels).flat();
    const match = allModels.find((m) => m.sdkProvider === tab.modelConfig.provider && m.id === tab.modelConfig.modelId);
    if (match && barModelLabel) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
  }
  // Effort label — read from tab's thinkingLevel if present, else fall back to global
  const effort = tab.thinkingLevel || currentEffort;
  const level = EFFORT_LEVELS.find((e) => e.id === effort);
  if (level && barEffortLabel) barEffortLabel.textContent = level.label;
}

function createTabState(slotInfo) {
  const container = document.createElement('div');
  container.className = 'tab-chat-container';

  return {
    id: slotInfo.id,
    fileKey: slotInfo.fileKey,
    fileName: slotInfo.fileName,
    isStreaming: slotInfo.isStreaming || false,
    isConnected: slotInfo.isConnected !== false,
    modelConfig: slotInfo.modelConfig || { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    chatContainer: container,
    currentAssistantBubble: null,
    thinkingBubble: null,
    queuedPrompts: [],
  };
}

// ── Prompt queue UI ──────────────────────

function renderPromptQueue(tab) {
  if (!tab || tab.queuedPrompts.length === 0) {
    promptQueueEl.classList.add('hidden');
    clearChildren(promptQueueEl);
    return;
  }
  promptQueueEl.classList.remove('hidden');
  clearChildren(promptQueueEl);
  tab.queuedPrompts.forEach((prompt, index) => {
    const item = document.createElement('div');
    item.className = 'queue-item';

    const indexEl = document.createElement('span');
    indexEl.className = 'queue-index';
    indexEl.textContent = String(index + 1);
    item.appendChild(indexEl);

    const textEl = document.createElement('span');
    textEl.className = 'queue-text';
    textEl.textContent = prompt.text;
    item.appendChild(textEl);

    const actions = document.createElement('span');
    actions.className = 'queue-actions';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'queue-btn';
    removeBtn.textContent = '\u2716';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => window.api.queueRemove(tab.id, prompt.id));
    actions.appendChild(removeBtn);

    item.appendChild(actions);
    promptQueueEl.appendChild(item);
  });
}

/** Pop the last queued prompt and put its text back in the input field for editing. */
function recallLastQueuedPrompt() {
  const tab = getActiveTab();
  if (!tab || tab.queuedPrompts.length === 0) return;
  if (inputField.value.trim()) return; // don't overwrite existing input

  const last = tab.queuedPrompts[tab.queuedPrompts.length - 1];
  window.api.queueRemove(tab.id, last.id);
  inputField.value = last.text;
  autoResizeInput();
  inputField.focus();
}

// ── Send message ─────────────────────────

function sendMessage() {
  const text = inputField.value.trim();
  const tab = getActiveTab();
  if (!text || !tab) return;

  hideSuggestions();
  hideSlashMenu();
  hideSlashHelp();

  // Only add user bubble if the prompt will be sent directly (not queued).
  // Queued prompts appear in chat when the agent actually starts processing them
  // (via the onQueuedPromptStart event).
  if (!tab.isStreaming) {
    addUserMessage(
      tab,
      text,
      pastedImages.map((p) => p.dataUrl),
    );
    tab.currentAssistantBubble = createAssistantBubble(tab);
    tab.isStreaming = true;
    updateInputState();
    renderTabBar();
  }

  pastedImages = [];
  renderPastePreview();
  inputField.value = '';
  autoResizeInput();

  window.api.sendPrompt(tab.id, text).catch(() => {});
}

function addUserMessage(tab, text, images) {
  const msg = document.createElement('div');
  msg.className = 'message user-message';
  if (images && images.length > 0) {
    const imgRow = document.createElement('div');
    imgRow.className = 'user-images';
    images.forEach((dataUrl) => {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Attached image';
      img.className = 'user-attached-img';
      imgRow.appendChild(img);
    });
    msg.appendChild(imgRow);
  }
  const textEl = document.createElement('span');
  textEl.textContent = text;
  msg.appendChild(textEl);
  tab.chatContainer.appendChild(msg);
  scrollToBottom();
}

function createAssistantBubble(tab) {
  const msg = document.createElement('div');
  msg.className = 'message assistant-message';
  const content = document.createElement('div');
  content.className = 'message-content';
  msg.appendChild(content);
  tab.chatContainer.appendChild(msg);
  scrollToBottom();
  return msg;
}

function appendToAssistant(tab, text) {
  if (!tab.currentAssistantBubble) return;
  const content = tab.currentAssistantBubble.querySelector('.message-content');
  content.textContent += text;
  scrollToBottom();
}

// Tool execution cards
function addToolCard(tab, toolName, toolCallId) {
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.toolCallId = toolCallId;
  // Build with DOM methods — no untrusted content set via innerHTML
  const spinner = document.createElement('span');
  spinner.className = 'tool-spinner';
  const nameEl = document.createElement('span');
  nameEl.className = 'tool-name';
  nameEl.textContent = toolName; // textContent: safe
  card.appendChild(spinner);
  card.appendChild(nameEl);
  tab.currentAssistantBubble.appendChild(card);
  scrollToBottom();
}

function completeToolCard(tab, toolCallId, success) {
  // Search within the tab's container to avoid cross-tab collisions
  const card = tab.chatContainer.querySelector('[data-tool-call-id="' + CSS.escape(toolCallId) + '"]');
  if (!card) return;
  const spinner = card.querySelector('.tool-spinner');
  if (spinner) {
    spinner.className = 'tool-status ' + (success ? 'tool-success' : 'tool-error');
    spinner.textContent = success ? '\u2713' : '\u2717'; // ✓ / ✗ via textContent
  }
}

// Screenshots
function addScreenshot(tab, base64, opts) {
  const lazy = opts?.lazy;
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const img = document.createElement('img');
  img.className = 'screenshot';
  img.src = 'data:image/png;base64,' + base64;
  img.alt = 'Figma screenshot';
  if (lazy) img.loading = 'lazy';
  tab.currentAssistantBubble.appendChild(img);
  scrollToBottom();
}

// Markdown → safe HTML
// All user/LLM text passes through escapeHtml first; only known safe
// markup tags are then injected via string replacement, so no
// untrusted HTML ever reaches innerHTML.
function renderMarkdown(text) {
  // 1. Escape all HTML entities in the raw text
  let html = escapeHtml(text);

  // 2. Fenced code blocks (must come before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // 3. Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // 5. Italic
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // 6. Unordered list items
  html = html.replace(/^[ \t]*[-*+][ \t]+(.+)$/gm, '<li>$1</li>');

  // 7. Paragraph breaks
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  return html;
}

const _escapeDiv = document.createElement('div');
function escapeHtml(text) {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

let scrollRafId = null;
function scrollToBottom() {
  // Only scroll if the active tab's container is visible
  const tab = getActiveTab();
  if (!tab || !tab.chatContainer.parentNode) return;
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
    scrollRafId = null;
  });
}

function updateInputState() {
  const tab = getActiveTab();
  const streaming = tab ? tab.isStreaming : false;
  sendBtn.disabled = !tab;
  inputField.disabled = !tab;
  inputField.placeholder = !tab
    ? 'No tab open'
    : streaming
      ? 'Type to queue\u2026'
      : 'Type / for image commands, or describe what you want\u2026';
  if (tab && !streaming) {
    inputField.focus();
  }
}

// ── Session restore / reset ──────────────

/**
 * Clear all chat messages from a tab's UI.
 */
function clearChat(tab) {
  if (!tab) return;
  clearChildren(tab.chatContainer);
  tab.currentAssistantBubble = null;
  tab.isStreaming = false;
  hideSuggestions();
  updateInputState();
}

/**
 * Batch-render historical messages from a restored session.
 * Reuses addUserMessage, addToolCard, completeToolCard, addScreenshot to keep
 * a single source of truth for DOM construction.
 */
function restoreChat(tab, turns) {
  clearChat(tab);
  if (!turns || turns.length === 0) return;

  for (const turn of turns) {
    if (turn.role === 'user') {
      addUserMessage(tab, turn.text, turn.images || []);
    } else if (turn.role === 'assistant') {
      tab.currentAssistantBubble = createAssistantBubble(tab);

      if (turn.tools) {
        for (const tool of turn.tools) {
          addToolCard(tab, tool.name, tool.id);
          completeToolCard(tab, tool.id, tool.success);
        }
      }

      if (turn.images) {
        for (const base64 of turn.images) {
          addScreenshot(tab, base64, { lazy: true });
        }
      }

      // Render text with markdown — renderMarkdown() calls escapeHtml() first (safe)
      if (turn.text) {
        const content = tab.currentAssistantBubble.querySelector('.message-content');
        const safeHtml = renderMarkdown(turn.text);
        content.insertAdjacentHTML('beforeend', safeHtml);
      }

      tab.currentAssistantBubble = null;
    }
  }

  scrollToBottom();
}

// Reset button — main process handles abort, so we just call resetSession
const resetSessionBtn = document.getElementById('reset-session-btn');
resetSessionBtn.addEventListener('click', async () => {
  const tab = getActiveTab();
  if (!tab) return;
  const result = await window.api.resetSession(tab.id);
  if (result.success) {
    clearChat(tab);
  }
});

// ── Event listeners ──────────────────────

sendBtn.addEventListener('click', sendMessage);

inputField.addEventListener('keydown', (e) => {
  // Slash menu keyboard navigation
  if (slashMenuOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashSelectedIdx = Math.min(slashSelectedIdx + 1, slashFiltered.length - 1);
      updateSlashSelection();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashSelectedIdx = Math.max(slashSelectedIdx - 1, 0);
      updateSlashSelection();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (slashFiltered[slashSelectedIdx]) selectSlashCommand(slashFiltered[slashSelectedIdx]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  // Close help panel on Escape
  if (e.key === 'Escape' && !slashHelpEl.classList.contains('hidden')) {
    hideSlashHelp();
    return;
  }

  // Arrow Up on empty input → recall last queued prompt for editing
  if (e.key === 'ArrowUp' && !inputField.value.trim()) {
    const tab = getActiveTab();
    if (tab && tab.queuedPrompts.length > 0) {
      e.preventDefault();
      recallLastQueuedPrompt();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Consolidated input handler: auto-resize, suggestions, slash commands
inputField.addEventListener('input', () => {
  autoResizeInput();

  // Hide prompt suggestions on any typing
  if (suggestionsContainer.children.length > 0) {
    hideSuggestions();
  }

  // Slash command detection
  const text = inputField.value;
  if (text.startsWith('/') && !text.includes(' ')) {
    showSlashMenu(text.slice(1));
  } else {
    hideSlashMenu();
    // Auto-dismiss help panel when user clears/changes away from template
    if (!slashHelpEl.classList.contains('hidden')) {
      hideSlashHelp();
    }
  }
});

// ── API event handlers ───────────────────

// ── Thinking indicator ────────────────────

function showThinkingIndicator(tab) {
  if (tab.thinkingBubble) return;
  tab.thinkingBubble = document.createElement('div');
  tab.thinkingBubble.className = 'thinking-bubble';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'thinking-dot';
    tab.thinkingBubble.appendChild(dot);
  }
  tab.chatContainer.appendChild(tab.thinkingBubble);
  scrollToBottom();
}

function removeThinkingIndicator(tab) {
  if (tab.thinkingBubble) {
    tab.thinkingBubble.remove();
    tab.thinkingBubble = null;
  }
}

window.api.onTextDelta((slotId, text) => withTab(slotId, (tab) => appendToAssistant(tab, text)));
window.api.onThinking((slotId, _text) => withTab(slotId, (tab) => showThinkingIndicator(tab)));
window.api.onToolStart((slotId, toolName, toolCallId) =>
  withTab(slotId, (tab) => addToolCard(tab, toolName, toolCallId)),
);
window.api.onToolEnd((slotId, _toolName, toolCallId, success) =>
  withTab(slotId, (tab) => completeToolCard(tab, toolCallId, success)),
);
window.api.onScreenshot((slotId, base64) => withTab(slotId, (tab) => addScreenshot(tab, base64)));

window.api.onAgentEnd((slotId) => {
  const tab = tabs.get(slotId);
  if (!tab) return;
  removeThinkingIndicator(tab);
  // Render markdown on the accumulated plain text.
  // renderMarkdown() calls escapeHtml() first, so innerHTML receives
  // only sanitized markup — no untrusted content is injected directly.
  if (tab.currentAssistantBubble) {
    const content = tab.currentAssistantBubble.querySelector('.message-content');
    if (content?.textContent) {
      // safe: escapeHtml applied first inside renderMarkdown()
      content.innerHTML = renderMarkdown(content.textContent);
    }
  }
  tab.currentAssistantBubble = null;
  tab.isStreaming = false;
  updateInputState();
  renderTabBar();
});

// ── Context usage bar ────────────────────

const contextFill = document.getElementById('context-fill');
const contextLabel = document.getElementById('context-label');
let contextSizes = {};

function updateContextBar(inputTokens) {
  const modelId = getActiveTab()?.modelConfig?.modelId || localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  const maxTokens = contextSizes[modelId] || 200000;
  const pct = Math.min(100, (inputTokens / maxTokens) * 100);
  contextFill.style.width = pct.toFixed(1) + '%';
  contextFill.className = 'context-fill' + (pct > 90 ? ' critical' : pct > 70 ? ' warn' : '');

  // Format: "125K / 1M" or "12K / 200K"
  const fmt = (n) =>
    n >= 1_000_000 ? (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M' : Math.round(n / 1000) + 'K';
  contextLabel.textContent = fmt(inputTokens) + ' / ' + fmt(maxTokens);
}

window.api.onUsage((slotId, usage) => {
  const tab = tabs.get(slotId);
  if (tab && tab.id === activeTabId) updateContextBar(usage.input);
});

// Load context sizes and init bar
(async () => {
  contextSizes = await window.api.getContextSizes();
  updateContextBar(0);
})();

// SDK lifecycle: compaction / retry indicators — shown via statusDot title
window.api.onCompaction((slotId, active) => {
  if (slotId === activeTabId)
    statusDot.title = active
      ? 'Compacting\u2026'
      : statusDot.classList.contains('connected')
        ? 'Connected'
        : 'Disconnected';
});
window.api.onRetry((slotId, active) => {
  if (slotId === activeTabId)
    statusDot.title = active
      ? 'Retrying\u2026'
      : statusDot.classList.contains('connected')
        ? 'Connected'
        : 'Disconnected';
});

window.api.onFigmaConnected(() => {
  statusDot.className = 'status-dot connected';
  statusDot.title = 'Figma connected';
  document.getElementById('version-banner').style.display = 'none';
});

window.api.onFigmaDisconnected(() => {
  statusDot.className = 'status-dot disconnected';
  statusDot.title = 'Disconnected';
});

window.api.onFigmaVersionMismatch((info) => {
  const banner = document.getElementById('version-banner');
  const text = document.getElementById('version-banner-text');
  text.textContent =
    'Figma plugin outdated (v' +
    info.pluginVersion +
    ', required v' +
    info.requiredVersion +
    '). Re-import the plugin from Plugins \u2192 Development \u2192 Import plugin from manifest.';
  banner.style.display = 'flex';
  statusDot.className = 'status-dot version-mismatch';
  statusDot.title = 'Plugin version mismatch';
});

document.getElementById('version-banner-dismiss')?.addEventListener('click', () => {
  document.getElementById('version-banner').style.display = 'none';
  statusDot.className = 'status-dot disconnected';
  statusDot.title = 'Disconnected';
});

// ── Tab lifecycle events ─────────────────

window.api.onTabCreated((slotInfo) => {
  const tab = createTabState(slotInfo);
  tabs.set(tab.id, tab);
  switchToTab(tab.id);
  renderTabBar();
});

window.api.onTabRemoved((slotId) => {
  // Switch away BEFORE deleting so switchToTab can detach the old chatContainer
  if (activeTabId === slotId) {
    const remaining = [...tabs.keys()].filter((id) => id !== slotId);
    if (remaining.length > 0) switchToTab(remaining[0]);
    else activeTabId = null;
  }
  const removed = tabs.get(slotId);
  if (removed?.chatContainer.parentNode) {
    removed.chatContainer.parentNode.removeChild(removed.chatContainer);
  }
  tabs.delete(slotId);
  renderTabBar();
});

window.api.onTabUpdated((slotInfo) => {
  const tab = tabs.get(slotInfo.id);
  if (tab) {
    tab.isConnected = slotInfo.isConnected;
    tab.fileName = slotInfo.fileName;
    renderTabBar();
  }
});

// Queue updates
window.api.onQueueUpdated((slotId, queue) =>
  withTab(slotId, (tab) => {
    tab.queuedPrompts = queue;
    if (slotId === activeTabId) renderPromptQueue(tab);
  }),
);

// Queued prompt starts (auto-drain): create new user+assistant bubbles
window.api.onQueuedPromptStart((slotId, text) =>
  withTab(slotId, (tab) => {
    addUserMessage(tab, text, []);
    tab.currentAssistantBubble = createAssistantBubble(tab);
  }),
);

// "+" button
tabAddBtn.addEventListener('click', () => {
  window.api.createTab();
});

// Load existing tabs on startup and restore chat history
(async () => {
  const existingTabs = await window.api.listTabs();
  for (const info of existingTabs) {
    const tab = createTabState(info);
    tabs.set(tab.id, tab);
  }
  if (existingTabs.length > 0) {
    switchToTab(existingTabs[0].id);
    // Restore chat history for all tabs in parallel
    await Promise.allSettled(
      [...tabs].map(async ([id, tab]) => {
        const messages = await window.api.getSessionMessages(id);
        if (messages?.length > 0) restoreChat(tab, messages);
      }),
    );
  }
  renderTabBar();
})();

// ── Settings ─────────────────────────────

const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const transparencySlider = document.getElementById('transparency-slider');
const transparencyValue = document.getElementById('transparency-value');

function openSettings() {
  settingsOverlay.classList.remove('hidden');
  settingsBtn.classList.add('active');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
  settingsBtn.classList.remove('active');
}

settingsBtn.addEventListener('click', () => {
  settingsOverlay.classList.contains('hidden') ? openSettings() : closeSettings();
});

settingsClose.addEventListener('click', closeSettings);

// Close on overlay background click
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
    closeSettings();
  }
  // Cmd+1..9 → switch to tab by position
  if (e.metaKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    const index = parseInt(e.key, 10) - 1;
    const tabIds = [...tabs.keys()];
    if (index < tabIds.length) {
      e.preventDefault();
      switchToTab(tabIds[index]);
    }
  }
});

// ── Auth & Model ─────────────────────────

const accountsList = document.getElementById('accounts-list');
const toggleApikeyBtn = document.getElementById('toggle-apikey-btn');
const apikeySection = document.getElementById('apikey-section');
const apikeyProviderSelect = document.getElementById('apikey-provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const keyStatus = document.getElementById('key-status');
const modelSelect = document.getElementById('model-select');

let availableModels = {};
let loginInProgress = null; // provider currently logging in

const PROVIDER_META = {
  anthropic: { label: 'Anthropic', sublabel: 'Claude Pro / Max', keyPlaceholder: 'sk-ant-...' },
  openai: { label: 'OpenAI', sublabel: 'ChatGPT Plus / Pro', keyPlaceholder: 'sk-...' },
  google: { label: 'Google', sublabel: 'Gemini (free)', keyPlaceholder: 'AIza...' },
};

// ── Account cards ────────────────────────

async function renderAccountCards() {
  const status = await window.api.getAuthStatus();
  clearChildren(accountsList);

  for (const [provider, info] of Object.entries(PROVIDER_META)) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.dataset.provider = provider;

    const left = document.createElement('div');
    left.className = 'account-left';

    const dot = document.createElement('span');
    const st = status[provider] || { type: 'none' };
    dot.className = 'account-dot' + (st.type !== 'none' ? ' connected' : '');

    const text = document.createElement('div');
    text.className = 'account-text';
    const name = document.createElement('span');
    name.className = 'account-name';
    name.textContent = info.label;
    const sub = document.createElement('span');
    sub.className = 'account-sub';
    sub.textContent = st.type === 'oauth' ? 'Logged in' : st.type === 'api_key' ? 'API key' : info.sublabel;
    text.appendChild(name);
    text.appendChild(sub);
    left.appendChild(dot);
    left.appendChild(text);
    card.appendChild(left);

    const right = document.createElement('div');
    right.className = 'account-actions';

    if (st.type !== 'none') {
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'account-btn logout';
      logoutBtn.textContent = 'Logout';
      logoutBtn.addEventListener('click', async () => {
        await window.api.logout(provider);
        renderAccountCards();
      });
      right.appendChild(logoutBtn);
    } else {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'account-btn login';
      loginBtn.textContent = 'Login';
      loginBtn.addEventListener('click', () => startLogin(provider));
      right.appendChild(loginBtn);
    }

    card.appendChild(right);

    // Login-in-progress state (inline prompt/progress area)
    const loginArea = document.createElement('div');
    loginArea.className = 'account-login-area hidden';
    loginArea.id = 'login-area-' + provider;
    card.appendChild(loginArea);

    accountsList.appendChild(card);
  }
}

// ── OAuth login flow ─────────────────────

async function startLogin(displayGroup) {
  loginInProgress = displayGroup;
  const loginArea = document.getElementById('login-area-' + displayGroup);
  if (!loginArea) return;

  // Show waiting state
  loginArea.classList.remove('hidden');
  setLoginAreaContent(loginArea, 'Opening browser for authentication\u2026', null, true);

  // Disable other login buttons
  accountsList.querySelectorAll('.account-btn.login').forEach((btn) => (btn.disabled = true));

  const result = await window.api.login(displayGroup);

  loginInProgress = null;
  loginArea.classList.add('hidden');
  await renderAccountCards();

  if (result.success) {
    // Auto-select first OAuth model (one whose sdkProvider differs from the display group)
    const models = availableModels[displayGroup] || [];
    const oauthModel = models.find((m) => m.sdkProvider !== displayGroup) || models[0];
    if (oauthModel) {
      localStorage.setItem('bottega:provider', oauthModel.sdkProvider);
      localStorage.setItem('bottega:model', oauthModel.id);
      populateModelSelect();
      modelSelect.value = oauthModel.sdkProvider + ':' + oauthModel.id;
      if (!activeTabId) return;
      const switchResult = await window.api.switchModel(activeTabId, {
        provider: oauthModel.sdkProvider,
        modelId: oauthModel.id,
      });
      if (!switchResult.success) {
        keyStatus.textContent = switchResult.error || 'Failed to switch model';
        keyStatus.className = 'key-status error';
      }
      updateContextBar(0);
    }
  } else if (result.code === 'GOOGLE_CLOUD_PROJECT_REQUIRED') {
    // Google Workspace accounts need a Cloud Project ID — show inline prompt
    loginArea.classList.remove('hidden');
    clearChildren(loginArea);

    const msgEl = document.createElement('span');
    msgEl.className = 'login-message';
    msgEl.textContent = 'This Google account requires a Cloud Project ID.';
    loginArea.appendChild(msgEl);

    const row = document.createElement('div');
    row.className = 'login-prompt-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'login-prompt-input';
    input.placeholder = 'Google Cloud Project ID';
    const submitBtn = document.createElement('button');
    submitBtn.className = 'login-prompt-submit';
    submitBtn.textContent = 'Retry';
    submitBtn.addEventListener('click', async () => {
      const projectId = input.value.trim();
      if (!projectId) return;
      localStorage.setItem('bottega:google-project', projectId);
      await window.api.setGoogleProject(projectId);
      loginArea.classList.add('hidden');
      startLogin(displayGroup);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });
    row.appendChild(input);
    row.appendChild(submitBtn);
    loginArea.appendChild(row);
  } else if (result.error && result.error !== 'Login cancelled') {
    keyStatus.textContent = result.error;
    keyStatus.className = 'key-status error';
  }
}

function setLoginAreaContent(area, message, promptOpts, showCancel) {
  clearChildren(area);

  const msgEl = document.createElement('span');
  msgEl.className = 'login-message';
  msgEl.textContent = message;
  area.appendChild(msgEl);

  if (promptOpts) {
    const row = document.createElement('div');
    row.className = 'login-prompt-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'setting-input';
    input.placeholder = promptOpts.placeholder || '';
    const submit = document.createElement('button');
    submit.className = 'setting-btn-sm';
    submit.textContent = 'Submit';
    submit.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val && !promptOpts.allowEmpty) return;
      window.api.loginRespond(val);
      setLoginAreaContent(area, 'Authenticating\u2026', null, true);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit.click();
    });
    row.appendChild(input);
    row.appendChild(submit);
    area.appendChild(row);
    input.focus();
  }

  if (showCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'account-btn cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      window.api.loginCancel();
    });
    area.appendChild(cancelBtn);
  }
}

// Listen for login events from main process
window.api.onLoginEvent((event) => {
  if (!loginInProgress) return;
  const loginArea = document.getElementById('login-area-' + loginInProgress);
  if (!loginArea) return;

  switch (event.type) {
    case 'auth':
      setLoginAreaContent(loginArea, event.instructions || 'Waiting for browser authentication\u2026', null, true);
      break;
    case 'prompt':
      setLoginAreaContent(
        loginArea,
        event.message,
        {
          placeholder: event.placeholder,
          allowEmpty: event.allowEmpty,
        },
        true,
      );
      break;
    case 'progress':
      setLoginAreaContent(loginArea, event.message, null, true);
      break;
  }
});

// ── API key fallback ─────────────────────

toggleApikeyBtn.addEventListener('click', () => {
  apikeySection.classList.toggle('hidden');
  toggleApikeyBtn.textContent = apikeySection.classList.contains('hidden') ? 'Use API key instead' : 'Hide API key';
});

apikeyProviderSelect.addEventListener('change', () => {
  const provider = apikeyProviderSelect.value;
  apiKeyInput.placeholder = PROVIDER_META[provider] ? PROVIDER_META[provider].keyPlaceholder : 'API key';
  keyStatus.textContent = '';
});

saveKeyBtn.addEventListener('click', async () => {
  const provider = apikeyProviderSelect.value;
  const key = apiKeyInput.value.trim();
  if (!key) return;

  saveKeyBtn.disabled = true;
  await window.api.setApiKey(provider, key);
  apiKeyInput.value = '';
  saveKeyBtn.disabled = false;

  keyStatus.textContent = (PROVIDER_META[provider] ? PROVIDER_META[provider].label : provider) + ' key saved';
  keyStatus.className = 'key-status success';

  await renderAccountCards();

  // Auto-switch to this provider's first API key model
  const models = availableModels[provider] || [];
  // For API keys, pick a model whose sdkProvider matches the display group
  const apiModel = models.find((m) => m.sdkProvider === provider) || models[0];
  if (apiModel) {
    localStorage.setItem('bottega:provider', apiModel.sdkProvider);
    localStorage.setItem('bottega:model', apiModel.id);
    populateModelSelect();
    modelSelect.value = apiModel.sdkProvider + ':' + apiModel.id;
    if (activeTabId) {
      await window.api.switchModel(activeTabId, { provider: apiModel.sdkProvider, modelId: apiModel.id });
    }
  }
});

// ── Model selector ───────────────────────

function populateModelSelect() {
  clearChildren(modelSelect);
  for (const [displayGroup, models] of Object.entries(availableModels)) {
    if (models.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = PROVIDER_META[displayGroup] ? PROVIDER_META[displayGroup].label : displayGroup;
    models.forEach((m) => {
      const opt = document.createElement('option');
      // Value encodes sdkProvider:modelId (sdkProvider is the Pi SDK provider)
      opt.value = m.sdkProvider + ':' + m.id;
      opt.textContent = m.label;
      group.appendChild(opt);
    });
    modelSelect.appendChild(group);
  }

  // Restore saved selection
  const savedProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const savedModel = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  modelSelect.value = savedProvider + ':' + savedModel;
}

modelSelect.addEventListener('change', async () => {
  // Split on first colon only (model IDs should not contain colons, but be safe)
  const sepIdx = modelSelect.value.indexOf(':');
  const sdkProvider = modelSelect.value.slice(0, sepIdx);
  const modelId = modelSelect.value.slice(sepIdx + 1);
  localStorage.setItem('bottega:provider', sdkProvider);
  localStorage.setItem('bottega:model', modelId);
  if (!activeTabId) return;
  const result = await window.api.switchModel(activeTabId, { provider: sdkProvider, modelId });
  if (!result.success) {
    keyStatus.textContent = result.error || 'Failed to switch';
    keyStatus.className = 'key-status error';
  }
  updateContextBar(0);
});

// ── Init auth UI ─────────────────────────

async function initAuthUI() {
  // Restore persisted Google Cloud Project ID for Workspace accounts
  const savedGoogleProject = localStorage.getItem('bottega:google-project');
  if (savedGoogleProject) await window.api.setGoogleProject(savedGoogleProject);

  availableModels = await window.api.getModels();
  populateModelSelect();
  await renderAccountCards();

  // Sync bar label now that models are loaded
  syncBarModelLabel();

  // Switch session to saved model if it differs from the default
  const savedProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const savedModel = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  if (activeTabId && (savedProvider !== 'anthropic' || savedModel !== 'claude-sonnet-4-6')) {
    await window.api.switchModel(activeTabId, { provider: savedProvider, modelId: savedModel });
  }
}

initAuthUI();

// ── Image Generation settings ─────────────

const imagegenKeyInput = document.getElementById('imagegen-key-input');
const imagegenSaveKeyBtn = document.getElementById('imagegen-save-key-btn');
const imagegenResetKeyBtn = document.getElementById('imagegen-reset-key-btn');
const imagegenKeyStatus = document.getElementById('imagegen-key-status');
const imagegenModelSelect = document.getElementById('imagegen-model-select');

function updateImageGenKeyUI(hasCustomKey) {
  if (hasCustomKey) {
    imagegenKeyStatus.textContent = 'Custom API key active';
    imagegenKeyStatus.className = 'key-status success';
    imagegenKeyInput.placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    imagegenResetKeyBtn.classList.remove('hidden');
  } else {
    imagegenKeyStatus.textContent = 'Using default key';
    imagegenKeyStatus.className = 'key-status success';
    imagegenKeyInput.placeholder = 'AIza...';
    imagegenResetKeyBtn.classList.add('hidden');
  }
}

async function initImageGenUI() {
  const config = await window.api.getImageGenConfig();

  // Populate model dropdown
  clearChildren(imagegenModelSelect);
  config.models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    imagegenModelSelect.appendChild(opt);
  });
  imagegenModelSelect.value = config.model;

  updateImageGenKeyUI(config.hasCustomKey);
}

imagegenSaveKeyBtn.addEventListener('click', async () => {
  const key = imagegenKeyInput.value.trim();
  if (!key) return;

  imagegenSaveKeyBtn.disabled = true;
  const result = await window.api.setImageGenConfig({ apiKey: key });
  imagegenSaveKeyBtn.disabled = false;
  imagegenKeyInput.value = '';

  updateImageGenKeyUI(result.hasCustomKey);
});

imagegenResetKeyBtn.addEventListener('click', async () => {
  imagegenResetKeyBtn.disabled = true;
  await window.api.setImageGenConfig({ apiKey: '' });
  imagegenResetKeyBtn.disabled = false;
  imagegenKeyInput.value = '';
  updateImageGenKeyUI(false);
});

imagegenModelSelect.addEventListener('change', async () => {
  await window.api.setImageGenConfig({ model: imagegenModelSelect.value });
});

initImageGenUI();

// ── Transparency control ─────────────────

function applyTransparency(value) {
  // 0% = fully opaque (opacity 1.0), 100% = max usable transparency (opacity 0.775)
  const opacity = 1 - (value / 100) * 0.225; // maps 0->1.0, 100->0.775
  window.api.setOpacity(opacity);
  transparencyValue.textContent = value + '%';
  localStorage.setItem('bottega:transparency', value);
}

transparencySlider.addEventListener('input', () => {
  applyTransparency(Number(transparencySlider.value));
});

// Restore saved transparency (or default 0 = fully opaque)
const savedTransparency = localStorage.getItem('bottega:transparency');
const initialTransparency = savedTransparency !== null ? Number(savedTransparency) : 0;
transparencySlider.value = initialTransparency;
applyTransparency(initialTransparency);

// ── Compression profile ─────────────────

const compressionSelect = document.getElementById('compression-profile-select');
const compressionDesc = document.getElementById('compression-profile-desc');
const compressionRefreshBtn = document.getElementById('compression-refresh-btn');

// Profile descriptions — loaded from main process, fallback inline
const profileDescriptions = {
  balanced: 'Default profile. Balances token savings and information completeness.',
  creative: 'For intensive design sessions. Shorter cache TTLs for rapid iteration.',
  exploration: 'For analysis and auditing. More detail in nodes and design system.',
  minimal: 'For quick fixes and debugging. Mutation compression disabled, full detail preserved.',
};

function updateCompressionDesc() {
  if (compressionDesc) {
    compressionDesc.textContent = profileDescriptions[compressionSelect.value] || '';
  }
}

if (compressionSelect) {
  // Load full descriptions from main process
  window.api
    .compressionGetProfiles()
    .then((profiles) => {
      if (Array.isArray(profiles)) {
        for (const p of profiles) {
          if (p.id && p.description) profileDescriptions[p.id] = p.description;
        }
        updateCompressionDesc();
      }
    })
    .catch(() => {});

  // Sync active profile from main
  window.api
    .compressionGetProfile()
    .then((profile) => {
      if (profile) {
        compressionSelect.value = profile;
        localStorage.setItem('bottega:compression-profile', profile);
        updateCompressionDesc();
      }
    })
    .catch(() => {});

  // Restore from localStorage as immediate fallback
  const savedProfile = localStorage.getItem('bottega:compression-profile');
  if (savedProfile) {
    compressionSelect.value = savedProfile;
  }
  updateCompressionDesc();

  compressionSelect.addEventListener('change', async () => {
    const profile = compressionSelect.value;
    localStorage.setItem('bottega:compression-profile', profile);
    updateCompressionDesc();
    try {
      await window.api.compressionSetProfile(profile);
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: renderer has no structured logger
      console.warn('Failed to set compression profile:', err);
    }
  });
}

if (compressionRefreshBtn) {
  compressionRefreshBtn.addEventListener('click', async () => {
    try {
      await window.api.compressionInvalidateCaches();
      compressionRefreshBtn.textContent = 'Done!';
      setTimeout(() => {
        compressionRefreshBtn.textContent = 'Refresh caches';
      }, 1500);
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: renderer has no structured logger
      console.warn('Failed to invalidate caches:', err);
    }
  });
}

// ── Figma Plugin setup ──────────────────

const setupFigmaBtn = document.getElementById('setup-figma-btn');
const setupFigmaStatus = document.getElementById('setup-figma-status');
const figmaPluginSteps = document.getElementById('figma-plugin-steps');

if (setupFigmaBtn) {
  setupFigmaBtn.addEventListener('click', async () => {
    setupFigmaBtn.disabled = true;
    setupFigmaBtn.textContent = 'Installing\u2026';
    setupFigmaStatus.textContent = '';
    try {
      const result = await window.api.installFigmaPlugin();
      if (result.success) {
        setupFigmaBtn.textContent = 'Reinstall Figma Plugin';
        figmaPluginSteps.classList.remove('hidden');
      } else {
        setupFigmaStatus.textContent = result.error || 'Setup failed.';
        setupFigmaBtn.textContent = 'Install Figma Plugin';
        figmaPluginSteps.classList.add('hidden');
      }
    } catch {
      setupFigmaStatus.textContent = 'Setup failed \u2014 see logs.';
      setupFigmaBtn.textContent = 'Install Figma Plugin';
      figmaPluginSteps.classList.add('hidden');
    } finally {
      setupFigmaBtn.disabled = false;
    }
  });

  // First-launch nudge: if plugin not yet set up, open settings automatically
  window.api
    .checkFigmaPlugin()
    .then((status) => {
      if (status.installed) {
        setupFigmaBtn.textContent = 'Reinstall Figma Plugin';
      } else if (!localStorage.getItem('bottega:plugin-nudge-dismissed')) {
        openSettings();
        setupFigmaBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        localStorage.setItem('bottega:plugin-nudge-dismissed', '1');
      }
    })
    .catch(() => {});
}

// ── Diagnostics ─────────────────────────

const exportLogsBtn = document.getElementById('export-logs-btn');
const copySysinfoBtn = document.getElementById('copy-sysinfo-btn');
const diagnosticsExportStatus = document.getElementById('diagnostics-export-status');
const sendDiagnosticsToggle = document.getElementById('send-diagnostics-toggle');
const diagnosticsRestartHint = document.getElementById('diagnostics-restart-hint');

if (exportLogsBtn) {
  exportLogsBtn.addEventListener('click', async () => {
    exportLogsBtn.disabled = true;
    exportLogsBtn.textContent = 'Exporting\u2026';
    diagnosticsExportStatus.textContent = '';
    try {
      const result = await window.api.exportDiagnostics();
      if (result.success) {
        diagnosticsExportStatus.textContent = 'Exported successfully';
        diagnosticsExportStatus.className = 'key-status success';
      } else if (!result.canceled) {
        diagnosticsExportStatus.textContent = result.error || 'Export failed';
        diagnosticsExportStatus.className = 'key-status error';
      }
    } catch {
      diagnosticsExportStatus.textContent = 'Export failed';
      diagnosticsExportStatus.className = 'key-status error';
    } finally {
      exportLogsBtn.disabled = false;
      exportLogsBtn.textContent = 'Export Logs';
    }
  });
}

if (copySysinfoBtn) {
  copySysinfoBtn.addEventListener('click', async () => {
    try {
      const info = await window.api.copyDiagnosticsInfo();
      await navigator.clipboard.writeText(info);
      copySysinfoBtn.textContent = 'Copied!';
    } catch {
      copySysinfoBtn.textContent = 'Copy failed';
    }
    setTimeout(() => {
      copySysinfoBtn.textContent = 'Copy System Info';
    }, 1500);
  });
}

if (sendDiagnosticsToggle) {
  // Load saved state
  window.api
    .getDiagnosticsConfig()
    .then((config) => {
      sendDiagnosticsToggle.checked = config.sendDiagnostics;
    })
    .catch(() => {});

  sendDiagnosticsToggle.addEventListener('change', async () => {
    const prev = !sendDiagnosticsToggle.checked;
    try {
      const result = await window.api.setDiagnosticsConfig({
        sendDiagnostics: sendDiagnosticsToggle.checked,
      });
      if (result.requiresRestart && diagnosticsRestartHint) {
        diagnosticsRestartHint.classList.remove('hidden');
      }
    } catch {
      sendDiagnosticsToggle.checked = prev;
    }
  });
}

// ── Pin (always-on-top) ─────────────────

pinBtn.addEventListener('click', async () => {
  const pinned = await window.api.togglePin();
  pinBtn.classList.toggle('pinned', pinned);
  pinBtn.title = pinned ? 'Unpin from top' : 'Keep on top';
});

// Sync initial pin state
window.api.isPinned().then((pinned) => {
  pinBtn.classList.toggle('pinned', pinned);
  pinBtn.title = pinned ? 'Unpin from top' : 'Keep on top';
});

// ── Input bar: Model & Effort selectors ──

const barModelBtn = document.getElementById('bar-model-btn');
const barModelLabel = document.getElementById('bar-model-label');
const barEffortBtn = document.getElementById('bar-effort-btn');
const barEffortLabel = document.getElementById('bar-effort-label');

const EFFORT_LEVELS = [
  { id: 'off', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

let currentEffort = localStorage.getItem('bottega:effort') || 'medium';
barEffortLabel.textContent = EFFORT_LEVELS.find((e) => e.id === currentEffort)
  ? EFFORT_LEVELS.find((e) => e.id === currentEffort).label
  : 'Medium';

// Generic dropdown factory
function createDropdown(anchorBtn, items, onSelect) {
  // Close any existing dropdown
  const existing = anchorBtn.querySelector('.toolbar-dropdown');
  if (existing) {
    existing.remove();
    anchorBtn.classList.remove('open');
    return;
  }
  closeAllDropdowns();

  const menu = document.createElement('div');
  menu.className = 'toolbar-dropdown';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item' + (item.active ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = item.label;
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = '\u2713';
    btn.appendChild(label);
    btn.appendChild(check);
    btn.addEventListener('click', () => {
      menu.remove();
      anchorBtn.classList.remove('open');
      onSelect(item);
    });
    menu.appendChild(btn);
  });
  anchorBtn.classList.add('open');
  anchorBtn.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    function onOutside(e) {
      if (!anchorBtn.contains(e.target)) {
        menu.remove();
        anchorBtn.classList.remove('open');
        document.removeEventListener('click', onOutside);
      }
    }
    document.addEventListener('click', onOutside);
  }, 0);
}

function closeAllDropdowns() {
  document.querySelectorAll('.toolbar-dropdown').forEach((d) => d.remove());
  document.querySelectorAll('.toolbar-chip.open').forEach((c) => c.classList.remove('open'));
}

// Model picker
barModelBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const models = availableModels;
  const currentProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const currentModel = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  const allModels = [];
  for (const [_group, list] of Object.entries(models)) {
    list.forEach((m) =>
      allModels.push({
        id: m.id,
        label: m.label,
        sdkProvider: m.sdkProvider,
        active: m.sdkProvider === currentProvider && m.id === currentModel,
      }),
    );
  }
  createDropdown(barModelBtn, allModels, async (item) => {
    barModelLabel.textContent = item.label.replace(/ \(.*\)/, '');
    localStorage.setItem('bottega:provider', item.sdkProvider);
    localStorage.setItem('bottega:model', item.id);
    // Sync settings panel model selector
    if (modelSelect) modelSelect.value = item.sdkProvider + ':' + item.id;
    if (!activeTabId) return;
    await window.api.switchModel(activeTabId, { provider: item.sdkProvider, modelId: item.id });
    updateContextBar(0);
  });
});

// Effort picker
barEffortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const items = EFFORT_LEVELS.map((l) => ({ id: l.id, label: l.label, active: l.id === currentEffort }));
  createDropdown(barEffortBtn, items, (item) => {
    currentEffort = item.id;
    barEffortLabel.textContent = item.label;
    localStorage.setItem('bottega:effort', item.id);
    if (activeTabId) window.api.setThinking(activeTabId, item.id);
  });
});

// Sync model label on init (runs after initAuthUI populates availableModels)
function syncBarModelLabel() {
  const sdkProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const modelId = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  const allModels = Object.values(availableModels).flat();
  const match = allModels.find((m) => m.sdkProvider === sdkProvider && m.id === modelId);
  if (match) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
}

// Saved effort is applied when a tab is first activated (activeTabId is null at load time)

// ── Paste screenshot support ─────────────

const pastePreview = document.getElementById('paste-preview');
let pastedImages = []; // Array of { dataUrl, blob }

inputField.addEventListener('paste', (e) => {
  const items = e.clipboardData ? e.clipboardData.items : null;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        pastedImages.push({ dataUrl, blob });
        renderPastePreview();
      };
      reader.readAsDataURL(blob);
    }
  }
});

function renderPastePreview() {
  clearChildren(pastePreview);
  if (pastedImages.length === 0) {
    pastePreview.classList.add('hidden');
    return;
  }
  pastePreview.classList.remove('hidden');
  pastedImages.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'paste-thumb';
    const imgEl = document.createElement('img');
    imgEl.src = img.dataUrl;
    imgEl.alt = 'Pasted image';
    thumb.appendChild(imgEl);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'paste-thumb-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', () => {
      pastedImages.splice(i, 1);
      renderPastePreview();
    });
    thumb.appendChild(removeBtn);
    pastePreview.appendChild(thumb);
  });
}

// ── Prompt suggestions ───────────────────

const suggestionsContainer = document.getElementById('suggestions');

function showSuggestions(suggestions) {
  // Clear old suggestions
  clearChildren(suggestionsContainer);
  if (!suggestions || suggestions.length === 0) {
    suggestionsContainer.classList.add('hidden');
    return;
  }
  suggestions.forEach((text, index) => {
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      window.api.trackSuggestionClicked(index);
      inputField.value = text;
      autoResizeInput();
      hideSuggestions();
      inputField.focus();
    });
    suggestionsContainer.appendChild(chip);
  });
  suggestionsContainer.classList.remove('hidden');
  scrollToBottom();
}

function hideSuggestions() {
  suggestionsContainer.classList.add('hidden');
  clearChildren(suggestionsContainer);
}

window.api.onSuggestions((slotId, suggestions) => {
  if (slotId === activeTabId) showSuggestions(suggestions);
});

// ── Slash commands ────────────────────────
// Source of truth for tool parameters: src/main/tools/image-gen.ts

const SLASH_COMMANDS = [
  {
    id: 'generate',
    label: 'Generate Image',
    desc: 'Create images from text descriptions with AI',
    template: 'Generate an image of ',
    help: 'Describe subject, style, mood, lighting, and composition in detail for best results.',
    advanced: [
      'Styles: photorealistic, watercolor, oil-painting, sketch, pixel-art, anime, vintage, modern, abstract, minimalist',
      'Variations: lighting, angle, color-palette, composition, mood, season, time-of-day',
      'Count: 1-8 for multiple variations',
      'Auto-apply: mention the Figma node to use as fill target',
      'Scale mode: FILL, FIT, CROP, TILE',
    ],
  },
  {
    id: 'edit',
    label: 'Edit Image',
    desc: 'Edit an existing image on a Figma node with AI',
    template: 'Edit the image: ',
    help: 'The target node must have an image fill. Describe changes clearly.',
    advanced: [
      'Examples: "remove the background", "change sky to sunset", "add snow on the mountains"',
      'The edited image is automatically re-applied to the same node',
      'Use figma_screenshot after to verify the result',
    ],
  },
  {
    id: 'restore',
    label: 'Restore Image',
    desc: 'Enhance, upscale, or fix image quality',
    template: 'Restore the image: ',
    help: 'Works on any node with an image fill or exportable content.',
    advanced: [
      'Goals: "enhance quality", "remove noise", "sharpen details", "fix compression artifacts"',
      'Good for upscaling low-resolution images',
      'Result is automatically re-applied to the same node',
    ],
  },
  {
    id: 'icon',
    label: 'Generate Icon',
    desc: 'Create app icons, favicons, and UI elements',
    template: 'Create an icon of ',
    help: 'Describe the icon subject clearly: "a mountain landscape", "a chat bubble".',
    advanced: [
      'Types: app-icon, favicon, ui-element',
      'Styles: flat, skeuomorphic, minimal, modern',
      'Background: transparent, white, black, or any color',
      'Corners: rounded (default) or sharp',
    ],
  },
  {
    id: 'pattern',
    label: 'Generate Pattern',
    desc: 'Create seamless patterns and textures',
    template: 'Create a seamless pattern of ',
    help: 'Describe the pattern motif: "geometric triangles", "floral watercolor", "tech circuit board".',
    advanced: [
      'Types: seamless (tileable), texture, wallpaper',
      'Styles: geometric, organic, abstract, floral, tech',
      'Density: sparse, medium, dense',
      'Colors: mono, duotone, colorful',
      'Use TILE scale mode for seamless repeating fills',
    ],
  },
  {
    id: 'story',
    label: 'Generate Story',
    desc: 'Create a sequence of related images',
    template: 'Create a visual story about ',
    help: 'Describe the complete narrative or process. Each step is generated with sequential context.',
    advanced: [
      'Types: story (narrative), process (step-by-step), tutorial, timeline',
      'Steps: 2-8 images in sequence',
      'Style: consistent (same look) or evolving (changing)',
      'Transitions: smooth, dramatic, fade',
      'Creates auto-layout frames in Figma',
    ],
  },
  {
    id: 'diagram',
    label: 'Generate Diagram',
    desc: 'Create flowcharts, architecture diagrams, wireframes',
    template: 'Create a diagram showing ',
    help: 'Describe diagram content and relationships. List components and connections for accuracy.',
    advanced: [
      'Types: flowchart, architecture, network, database, wireframe, mindmap, sequence',
      'Styles: professional, clean, hand-drawn, technical',
      'Layout: horizontal, vertical, hierarchical, circular',
      'Complexity: simple, detailed, comprehensive',
      'Colors: mono, accent, categorical',
    ],
  },
];

const slashMenuEl = document.getElementById('slash-menu');
const slashHelpEl = document.getElementById('slash-help');
let slashMenuOpen = false;
let slashSelectedIdx = 0;
let slashFiltered = [];
let slashLastFilter = null;

function showSlashMenu(filter) {
  if (filter === slashLastFilter) return;
  slashLastFilter = filter;

  const q = filter.toLowerCase();
  slashFiltered = q
    ? SLASH_COMMANDS.filter(
        (c) => c.id.includes(q) || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
      )
    : SLASH_COMMANDS.slice();

  if (slashFiltered.length === 0) {
    hideSlashMenu();
    return;
  }

  slashSelectedIdx = 0;
  renderSlashMenu();
  slashMenuEl.classList.remove('hidden');
  slashMenuOpen = true;
}

function renderSlashMenu() {
  clearChildren(slashMenuEl);

  slashFiltered.forEach((cmd, i) => {
    const item = document.createElement('button');
    item.className = 'slash-menu-item' + (i === slashSelectedIdx ? ' selected' : '');

    const header = document.createElement('div');
    header.className = 'slash-item-header';
    const cmdName = document.createElement('span');
    cmdName.className = 'slash-item-cmd';
    cmdName.textContent = '/' + cmd.id;
    const cmdLabel = document.createElement('span');
    cmdLabel.className = 'slash-item-label';
    cmdLabel.textContent = cmd.label;
    header.appendChild(cmdName);
    header.appendChild(cmdLabel);

    const desc = document.createElement('span');
    desc.className = 'slash-item-desc';
    desc.textContent = cmd.desc;

    item.appendChild(header);
    item.appendChild(desc);

    item.addEventListener('click', () => selectSlashCommand(cmd));
    item.addEventListener('mouseenter', () => {
      slashSelectedIdx = i;
      updateSlashSelection();
    });

    slashMenuEl.appendChild(item);
  });
}

function updateSlashSelection() {
  const items = slashMenuEl.querySelectorAll('.slash-menu-item');
  items.forEach((item, i) => item.classList.toggle('selected', i === slashSelectedIdx));
  const selected = slashMenuEl.querySelector('.slash-menu-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function hideSlashMenu() {
  slashMenuEl.classList.add('hidden');
  slashMenuOpen = false;
  slashFiltered = [];
  slashLastFilter = null;
}

function selectSlashCommand(cmd) {
  hideSlashMenu();
  inputField.value = cmd.template;
  autoResizeInput();
  inputField.focus();
  inputField.setSelectionRange(cmd.template.length, cmd.template.length);
  showSlashHelp(cmd);
}

function showSlashHelp(cmd) {
  clearChildren(slashHelpEl);

  const header = document.createElement('div');
  header.className = 'slash-help-header';
  const title = document.createElement('span');
  title.className = 'slash-help-title';
  title.textContent = cmd.label;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'slash-help-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', hideSlashHelp);
  header.appendChild(title);
  header.appendChild(closeBtn);
  slashHelpEl.appendChild(header);

  const usage = document.createElement('span');
  usage.className = 'slash-help-usage';
  usage.textContent = cmd.help;
  slashHelpEl.appendChild(usage);

  const section = document.createElement('span');
  section.className = 'slash-help-section';
  section.textContent = 'Advanced settings';
  slashHelpEl.appendChild(section);

  const tipsList = document.createElement('ul');
  tipsList.className = 'slash-help-tips';
  cmd.advanced.forEach((tip) => {
    const li = document.createElement('li');
    li.textContent = tip;
    tipsList.appendChild(li);
  });
  slashHelpEl.appendChild(tipsList);

  slashHelpEl.classList.remove('hidden');
}

function hideSlashHelp() {
  slashHelpEl.classList.add('hidden');
  clearChildren(slashHelpEl);
}

// Focus input on load
inputField.focus();
