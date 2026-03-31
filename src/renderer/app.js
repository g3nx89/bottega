// ── Per-tab state ─────────────────────────
const tabs = new Map(); // Map<slotId, TabState>
let activeTabId = null;
var availableModels = {}; // intentionally `var` — shared with settings.js via global scope

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

function createTabElement(id) {
  const el = document.createElement('div');
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
  return el;
}

function tabItemClass(id, tab) {
  let cls = 'tab-item';
  if (id === activeTabId) cls += ' active';
  if (tab.isStreaming) cls += ' streaming';
  if (!tab.isConnected) cls += ' disconnected';
  return cls;
}

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
    const el = existingById.get(id) || createTabElement(id);

    el.className = tabItemClass(id, tab);
    el.dataset.testid = 'tab-item';

    const dot = el.querySelector('.tab-dot');
    dot.className = tab.isConnected ? 'tab-dot connected' : 'tab-dot disconnected';

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
  // Model label + dropdown
  if (tab.modelConfig && typeof availableModels === 'object') {
    const allModels = Object.values(availableModels).flat();
    const match = allModels.find((m) => m.sdkProvider === tab.modelConfig.provider && m.id === tab.modelConfig.modelId);
    if (match && barModelLabel) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
    // Keep the settings dropdown in sync with the active tab's model
    const sel = document.getElementById('model-select');
    if (sel) {
      const val = tab.modelConfig.provider + ':' + tab.modelConfig.modelId;
      if (sel.value !== val) sel.value = val;
    }
    // Keep localStorage in sync so next populateModelSelect() restores correctly
    localStorage.setItem('bottega:provider', tab.modelConfig.provider);
    localStorage.setItem('bottega:model', tab.modelConfig.modelId);
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

// Shared core: create user bubble + assistant bubble, init turn metrics.
// Used by sendMessage() and __agentSubmit() to avoid divergence.
function _initTurn(tab, text, images) {
  addUserMessage(tab, text, images);
  tab.currentAssistantBubble = createAssistantBubble(tab);
  tab.isStreaming = true;
  tab._turnStartTime = Date.now();
  tab._turnToolCount = 0;
  tab._turnToolErrors = 0;
  tab._turnResponseLength = 0;
  tab._turnHasScreenshot = false;
  tab._lastPromptText = text;
  tab._lastPromptImages = images;
  updateInputState();
  renderTabBar();
}

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
    _initTurn(
      tab,
      text,
      pastedImages.map((p) => p.dataUrl),
    );
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
  msg.dataset.testid = 'assistant-message';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.dataset.testid = 'message-content';
  msg.appendChild(content);
  tab.chatContainer.appendChild(msg);
  scrollToBottom();
  return msg;
}

function appendToAssistant(tab, text) {
  if (!tab.currentAssistantBubble) return;
  const content = tab.currentAssistantBubble.querySelector('.message-content');
  content.textContent += text;
  tab._turnResponseLength = (tab._turnResponseLength || 0) + text.length;
  scrollToBottom();
}

// Tool execution cards
function addToolCard(tab, toolName, toolCallId) {
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.testid = 'tool-card';
  card.dataset.toolCallId = toolCallId;
  // Build with DOM methods — no untrusted content set via innerHTML
  const spinner = document.createElement('span');
  spinner.className = 'tool-spinner';
  spinner.dataset.testid = 'tool-spinner';
  const nameEl = document.createElement('span');
  nameEl.className = 'tool-name';
  nameEl.dataset.testid = 'tool-name';
  nameEl.textContent = toolName; // textContent: safe
  card.appendChild(spinner);
  card.appendChild(nameEl);
  // Screenshot progress indicator — show elapsed time after 3s
  if (toolName === 'figma_screenshot') {
    const startTime = Date.now();
    const elapsed = document.createElement('span');
    elapsed.className = 'tool-elapsed';
    card.appendChild(elapsed);
    const timer = setInterval(() => {
      const sec = ((Date.now() - startTime) / 1000).toFixed(0);
      elapsed.textContent = sec + 's';
    }, 1000);
    // Show after 3s delay
    elapsed.style.display = 'none';
    card._elapsedShowTimeout = setTimeout(() => {
      elapsed.style.display = '';
    }, 3000);
    card._elapsedTimer = timer;
  }
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
    spinner.dataset.testid = 'tool-status';
    spinner.textContent = success ? '\u2713' : '\u2717'; // ✓ / ✗ via textContent
  }
  // Clear screenshot elapsed timer
  if (card._elapsedTimer) {
    clearInterval(card._elapsedTimer);
    card._elapsedTimer = null;
    if (card._elapsedShowTimeout) clearTimeout(card._elapsedShowTimeout);
    card._elapsedShowTimeout = null;
    const elapsed = card.querySelector('.tool-elapsed');
    if (elapsed) elapsed.remove();
  }
}

// ── Response action bar (copy, thumbs up/down, retry) ───────

function _actionBtn(label, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'action-btn';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function createActionBar(bubble, tab) {
  const bar = document.createElement('div');
  bar.className = 'response-action-bar';

  const copyBtn = _actionBtn('\u2398', 'Copy response', () => {
    const content = bubble.querySelector('.message-content');
    if (content) navigator.clipboard.writeText(content.textContent || '');
    copyBtn.textContent = '\u2713';
    setTimeout(() => {
      copyBtn.textContent = '\u2398';
    }, 1500);
  });

  bar.appendChild(copyBtn);
  bar.appendChild(_actionBtn('\uD83D\uDC4D', 'Good response', () => openFeedbackModal('positive', tab)));
  bar.appendChild(_actionBtn('\uD83D\uDC4E', 'Bad response', () => openFeedbackModal('negative', tab)));
  bar.appendChild(
    _actionBtn('\u21BB', 'Retry', () => {
      if (tab._lastPromptText && !tab.isStreaming && tab.id) {
        window.api.sendPrompt(tab.id, tab._lastPromptText);
        _initTurn(tab, tab._lastPromptText, tab._lastPromptImages || []);
      }
    }),
  );
  bubble.appendChild(bar);
}

// ── Feedback modal logic ───────────────────

let _feedbackSentiment = null;
let _feedbackSlotId = null;
const feedbackModal = document.getElementById('feedback-modal');
const feedbackTitle = document.getElementById('feedback-modal-title');
const feedbackIssueGroup = document.getElementById('feedback-issue-group');
const feedbackIssueSelect = document.getElementById('feedback-issue-select');
const feedbackDetails = document.getElementById('feedback-details');
const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');
const feedbackCancelBtn = document.getElementById('feedback-cancel-btn');

function openFeedbackModal(sentiment, tab) {
  _feedbackSentiment = sentiment;
  _feedbackSlotId = tab.id;
  feedbackTitle.textContent = sentiment === 'positive' ? 'Give positive feedback' : 'Give negative feedback';
  feedbackIssueGroup.style.display = sentiment === 'negative' ? '' : 'none';
  feedbackDetails.placeholder =
    sentiment === 'positive'
      ? 'What was satisfying about this response?'
      : 'What was unsatisfying about this response?';
  feedbackIssueSelect.value = '';
  feedbackDetails.value = '';
  feedbackModal.classList.remove('hidden');
  feedbackDetails.focus();
}

function closeFeedbackModal() {
  feedbackModal.classList.add('hidden');
  _feedbackSentiment = null;
  _feedbackSlotId = null;
}

feedbackSubmitBtn.addEventListener('click', () => {
  if (!_feedbackSlotId) return;
  window.api.submitFeedback({
    slotId: _feedbackSlotId,
    sentiment: _feedbackSentiment,
    issueType: _feedbackSentiment === 'negative' ? feedbackIssueSelect.value || undefined : undefined,
    details: feedbackDetails.value.trim() || undefined,
  });
  closeFeedbackModal();
});

feedbackCancelBtn.addEventListener('click', closeFeedbackModal);

feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) closeFeedbackModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !feedbackModal.classList.contains('hidden')) closeFeedbackModal();
});

// Screenshots
function addScreenshot(tab, base64, opts) {
  const lazy = opts?.lazy;
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const img = document.createElement('img');
  img.className = 'screenshot';
  img.dataset.testid = 'screenshot';
  img.src = 'data:image/png;base64,' + base64;
  img.alt = 'Figma screenshot';
  if (lazy) img.loading = 'lazy';
  tab.currentAssistantBubble.appendChild(img);
  tab._turnHasScreenshot = true;
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

// Test helpers: slot-scoped access to chat state (only when agent test oracle is available).
// These bypass active-tab issues by accessing tabs.get(slotId).chatContainer directly.
if (typeof window.api?.__testFigmaExecute === 'function') {
  window.__testSwitchTab = (slotId) => switchToTab(slotId);
  window.__testResetChat = (slotId) => {
    const tab = slotId ? tabs.get(slotId) : getActiveTab();
    if (tab) clearChat(tab);
  };
  window.__testGetToolCalls = (slotId) => {
    const tab = tabs.get(slotId);
    if (!tab) return [];
    return [...tab.chatContainer.querySelectorAll('.tool-card')].map((card) => ({
      name: card.querySelector('.tool-name')?.textContent || '',
      success: !!card.querySelector('.tool-success'),
      error: !!card.querySelector('.tool-error'),
    }));
  };
  window.__testGetResponse = (slotId) => {
    const tab = tabs.get(slotId);
    if (!tab) return '';
    const msgs = [...tab.chatContainer.querySelectorAll('.assistant-message')];
    if (!msgs.length) return '';
    const last = msgs[msgs.length - 1];
    return last.querySelector('.message-content')?.textContent || '';
  };
  window.__testHasScreenshot = (slotId) => {
    const tab = tabs.get(slotId);
    if (!tab) return false;
    return tab.chatContainer.querySelectorAll('.screenshot').length > 0;
  };
  window.__agentSubmit = (slotId, text) => {
    const tab = tabs.get(slotId);
    if (!tab || !text?.trim()) return false;
    switchToTab(slotId);
    if (tab.isStreaming) return false;
    hideSuggestions();
    _initTurn(tab, text, []);
    window.api.sendPrompt(slotId, text).catch(() => {});
    return true;
  };
}

// Listen for reset-with-clear IPC to clear chat on session reset
window.api.onChatCleared?.((slotId) => {
  const tab = tabs.get(slotId);
  if (tab) clearChat(tab);
});

/**
 * Batch-render historical messages from a restored session.
 * Reuses addUserMessage, addToolCard, completeToolCard, addScreenshot to keep
 * a single source of truth for DOM construction.
 */
function renderAssistantTurn(tab, turn) {
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
    content.insertAdjacentHTML('beforeend', renderMarkdown(turn.text));
  }

  tab.currentAssistantBubble = null;
}

function restoreChat(tab, turns) {
  clearChat(tab);
  if (!turns || turns.length === 0) return;

  for (const turn of turns) {
    if (turn.role === 'user') {
      addUserMessage(tab, turn.text, turn.images || []);
    } else if (turn.role === 'assistant') {
      renderAssistantTurn(tab, turn);
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

/** Handle keyboard navigation within the slash command menu. Returns true if the event was consumed. */

function handleInputEscape() {
  if (!slashHelpEl.classList.contains('hidden')) hideSlashHelp();
}

function handleInputArrowUp(e) {
  if (inputField.value.trim()) return;
  const tab = getActiveTab();
  if (tab && tab.queuedPrompts.length > 0) {
    e.preventDefault();
    recallLastQueuedPrompt();
  }
}

function handleInputEnter(e) {
  if (e.shiftKey) return;
  e.preventDefault();
  sendMessage();
}

inputField.addEventListener('keydown', (e) => {
  if (slashMenuOpen && handleSlashMenuKey(e)) return;
  switch (e.key) {
    case 'Escape':
      handleInputEscape();
      return;
    case 'ArrowUp':
      handleInputArrowUp(e);
      return;
    case 'Enter':
      handleInputEnter(e);
      return;
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
  withTab(slotId, (tab) => {
    completeToolCard(tab, toolCallId, success);
    tab._turnToolCount = (tab._turnToolCount || 0) + 1;
    if (!success) tab._turnToolErrors = (tab._turnToolErrors || 0) + 1;
  }),
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
    createActionBar(tab.currentAssistantBubble, tab);
  }
  tab.currentAssistantBubble = null;
  tab.isStreaming = false;
  updateInputState();
  renderTabBar();
  // Emit structured turn-complete event with metrics
  window.dispatchEvent(
    new CustomEvent('agent:turn-complete', {
      detail: {
        slotId,
        durationMs: Date.now() - (tab._turnStartTime || Date.now()),
        toolCount: tab._turnToolCount || 0,
        toolErrors: tab._turnToolErrors || 0,
        responseLength: tab._turnResponseLength || 0,
        hasScreenshot: tab._turnHasScreenshot || false,
      },
    }),
  );
});

// ── Context usage bar ────────────────────

const contextFill = document.getElementById('context-fill');
const contextLabel = document.getElementById('context-label');
let contextSizes = {};

/** Format token count: 1500000 → "1.5M", 125000 → "125K" */
function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  return Math.round(n / 1000) + 'K';
}

function contextBarLevel(pct) {
  if (pct > 90) return ' critical';
  if (pct > 70) return ' warn';
  return '';
}

function updateContextBar(inputTokens) {
  const modelId = getActiveTab()?.modelConfig?.modelId || localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  const maxTokens = contextSizes[modelId] || 200000;
  const pct = Math.min(100, (inputTokens / maxTokens) * 100);
  contextFill.style.width = pct.toFixed(1) + '%';
  contextFill.className = 'context-fill' + contextBarLevel(pct);
  contextLabel.textContent = formatTokenCount(inputTokens) + ' / ' + formatTokenCount(maxTokens);
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
  text.textContent = info.message;
  banner.style.display = 'flex';
  statusDot.className = 'status-dot version-mismatch';
  statusDot.title = 'Plugin version mismatch';
});

document.getElementById('version-banner-dismiss')?.addEventListener('click', () => {
  document.getElementById('version-banner').style.display = 'none';
  statusDot.className = 'status-dot disconnected';
  statusDot.title = 'Disconnected';
});

// ── Plugin setup banner ─────────────────

const pluginBanner = document.getElementById('plugin-setup-banner');
const pluginRetryBtn = document.getElementById('plugin-setup-retry');

window.api.onPluginNeedsSetup(() => {
  if (pluginBanner) pluginBanner.style.display = 'flex';
});

pluginRetryBtn?.addEventListener('click', async () => {
  const result = await window.api.installFigmaPlugin();
  if (result.success && (result.autoRegistered || result.alreadyRegistered)) {
    if (pluginBanner) pluginBanner.style.display = 'none';
  } else if (result.success && result.figmaRunning) {
    if (pluginRetryBtn) pluginRetryBtn.textContent = 'Figma still running \u2014 try again';
  } else {
    if (pluginRetryBtn) pluginRetryBtn.textContent = 'Could not auto-register \u2014 use Settings to install manually';
  }
});

document.getElementById('plugin-setup-dismiss')?.addEventListener('click', () => {
  if (pluginBanner) pluginBanner.style.display = 'none';
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

/** Handle Cmd+1..9 → switch to tab by position */
function handleTabShortcut(e) {
  if (!e.metaKey || e.shiftKey || e.altKey || e.key < '1' || e.key > '9') return false;
  const index = parseInt(e.key, 10) - 1;
  const tabIds = [...tabs.keys()];
  if (index < tabIds.length) {
    e.preventDefault();
    switchToTab(tabIds[index]);
  }
  return true;
}

// Close on Escape + tab shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
    closeSettings();
  }
  handleTabShortcut(e);
});

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
      const tab = getActiveTab();
      if (!tab) return;
      hideSuggestions();
      if (!tab.isStreaming) _initTurn(tab, text, []);
      window.api.sendPrompt(tab.id, text).catch(() => {});
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

// Focus input on load
inputField.focus();
