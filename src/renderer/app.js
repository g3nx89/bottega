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
  updateDownloadBtn.onclick = () => {
    updateDownloadBtn.textContent = 'Installing…';
    updateDownloadBtn.disabled = true;
    updateStatus.textContent = 'Installing update — do not close the app';
    window.api.installUpdate();
  };
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

function updateTabElement(el, id, tab) {
  el.className = tabItemClass(id, tab);
  el.dataset.testid = 'tab-item';
  const dot = el.querySelector('.tab-dot');
  dot.className = tab.isConnected ? 'tab-dot connected' : 'tab-dot disconnected';
  const label = el.querySelector('.tab-label');
  const newLabel = tab.fileName || 'New Tab';
  if (label.textContent !== newLabel) label.textContent = newLabel;
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
    updateTabElement(el, id, tab);
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
    renderTaskPanel(newTab);
    syncBarToTab(newTab);
    updateContextBar(newTab.lastContextTokens);
    scrollToBottom();
  }
}

// Cached per-model status from auth:get-model-status. Refilled by
// refreshModelStatusCache() so the toolbar label can prefix a colored dot
// matching the picker without a fresh IPC roundtrip on every render.
let _toolbarModelStatusCache = {};

// Canonical mapping from ProbeStatus to dot emoji. Mirrors
// src/shared/model-status-ui.ts:statusDot() — that module is unreachable
// from the vanilla-script renderer, so we inline the same logic and share
// it across settings.js via global scope (see index.html script order).
// eslint-disable-next-line no-unused-vars -- consumed from settings.js via global scope
function modelStatusDotEmoji(status) {
  if (status === 'ok') return '🟢';
  if (status === 'unauthorized' || status === 'forbidden' || status === 'not_found') return '🔴';
  return '🟡';
}

// Allow settings.js to feed us a cache snapshot it just fetched, avoiding a
// second IPC roundtrip when the user opens Settings.
// biome-ignore lint/correctness/noUnusedVariables: consumed from settings.js via global scope
function setToolbarModelStatusCache(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  _toolbarModelStatusCache = snapshot;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab?.modelConfig) syncModelToTab(tab.modelConfig);
}

async function refreshModelStatusCache() {
  if (typeof window.api.getModelStatus !== 'function') return;
  try {
    _toolbarModelStatusCache = await window.api.getModelStatus();
    // Repaint current label so a status change is visible without picker open.
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab?.modelConfig) syncModelToTab(tab.modelConfig);
  } catch {
    // Silent: missing dot just falls back to neutral label.
  }
}

function syncModelToTab(modelConfig) {
  if (!modelConfig || typeof availableModels !== 'object') return;
  const allModels = Object.values(availableModels).flat();
  const match = allModels.find((m) => m.sdkProvider === modelConfig.provider && m.id === modelConfig.modelId);
  if (match && barModelLabel) {
    const dot = modelStatusDotEmoji(_toolbarModelStatusCache[modelConfig.modelId] ?? 'unknown');
    barModelLabel.textContent = `${dot} ${match.label.replace(/ \(.*\)/, '')}`;
  }
  syncModelDropdown(modelConfig);
}

function syncModelDropdown(modelConfig) {
  const sel = document.getElementById('model-select');
  const val = modelConfig.provider + ':' + modelConfig.modelId;
  if (sel && sel.value !== val) sel.value = val;
  localStorage.setItem('bottega:provider', modelConfig.provider);
  localStorage.setItem('bottega:model', modelConfig.modelId);
}

// Align chip/tab/session: push user preference to session if supported but
// diverging, otherwise adopt session as source of truth. Returns the caps
// object with a possibly-updated currentLevel so callers can render immediately.
async function reconcileEffortCaps(tab, caps) {
  if (!tab?.id) return caps;
  const pref = tab.thinkingLevel || currentEffort;
  const prefSupported = caps.availableLevels.includes(pref);
  if (prefSupported && pref !== caps.currentLevel) {
    const res = await window.api.setThinking(tab.id, pref);
    const effective = res?.level ?? pref;
    tab.thinkingLevel = effective;
    setEffortLabel(effective);
    _effortCapsCache.delete(tab.id);
    return { ...caps, currentLevel: effective };
  }
  tab.thinkingLevel = caps.currentLevel;
  setEffortLabel(caps.currentLevel);
  return caps;
}

function syncEffortToTab(tab) {
  const effort = tab.thinkingLevel || currentEffort;
  const level = EFFORT_LEVELS.find((e) => e.id === effort);
  if (level && barEffortLabel) barEffortLabel.textContent = level.label;
  if (!tab?.id || typeof window.api.getThinkingCapabilities !== 'function') return;

  window.api
    .getThinkingCapabilities(tab.id)
    .then(async (caps) => {
      _effortCapsCache.set(tab.id, caps);
      if (tab.id !== activeTabId) return;
      applyEffortCapsToChip(caps);
      await reconcileEffortCaps(tab, caps);
    })
    .catch(() => {});
}

/** Update the model and effort bar labels to reflect a tab's actual config. */
function syncBarToTab(tab) {
  syncModelToTab(tab.modelConfig);
  syncEffortToTab(tab);
  syncJudgeToTab(tab);
}

function syncJudgeToTab(tab) {
  const override = tab.judgeOverride ?? null;
  judgeOverride = override;
  barJudgeBtn.classList.toggle('active', override === true);
  barJudgeBtn.classList.toggle('disabled-chip', override === false);
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
    judgeOverride: null,
    // B-026: restore last known token count from the server so the context bar
    // reflects saved sessions instead of showing 0K until the next usage event.
    lastContextTokens: slotInfo.lastContextTokens ?? 0,
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

// UX-007: Judge running indicator timeout before auto-dismiss
const JUDGE_TIMEOUT_MS = 60_000;

/** Clear judge running indicator and its associated timeout from a tab. */
function clearJudgeIndicator(tab) {
  if (tab._judgeRunningTimeout) {
    clearTimeout(tab._judgeRunningTimeout);
    tab._judgeRunningTimeout = null;
  }
  if (tab._judgeRunningIndicator) {
    tab._judgeRunningIndicator.remove();
    tab._judgeRunningIndicator = null;
  }
}

// Tool execution cards
// UX-006: Internal bookkeeping tools hidden from chat UI
const HIDDEN_TOOL_CARDS = new Set(['task_create', 'task_update', 'task_list']);

function addToolCard(tab, toolName, toolCallId) {
  if (HIDDEN_TOOL_CARDS.has(toolName)) return;
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);

  // UX-004: Collapse retry noise. If the last child of the bubble is an errored
  // tool-card for the SAME tool, remove it and carry over a retry counter so the
  // user sees only the latest attempt + a small badge.
  let retryCount = 0;
  const parent = tab.currentAssistantBubble;
  const lastChild = parent.lastElementChild;
  if (lastChild?.classList?.contains('tool-card')) {
    const prevName = lastChild.querySelector('.tool-name')?.textContent;
    const prevStatus = lastChild.querySelector('.tool-status');
    const wasError = prevStatus?.classList.contains('tool-error');
    if (prevName === toolName && wasError) {
      retryCount = (Number(lastChild.dataset.retryCount) || 0) + 1;
      lastChild.remove();
    }
  }

  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.testid = 'tool-card';
  card.dataset.toolCallId = toolCallId;
  if (retryCount > 0) card.dataset.retryCount = String(retryCount);
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
  if (retryCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'tool-retry-badge';
    badge.textContent = `retry ×${retryCount}`;
    badge.title = `${retryCount} previous attempt(s) failed and were collapsed`;
    card.appendChild(badge);
  }
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
  // Scroll after image loads (dimensions unknown until then)
  img.addEventListener('load', () => scrollToBottom(), { once: true });
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

/** Create an SVG element for the send button icon. */
function createSendIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14 8L2 2L5 8L2 14L14 8Z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/** Create an SVG element for the stop button icon. */
function createStopIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('fill', 'none');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '2');
  rect.setAttribute('y', '2');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  rect.setAttribute('rx', '2');
  rect.setAttribute('fill', 'currentColor');
  svg.appendChild(rect);
  return svg;
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

  // Toggle send/stop button appearance
  if (streaming) {
    sendBtn.classList.add('stop-mode');
    sendBtn.title = 'Stop (Esc)';
    sendBtn.replaceChildren(createStopIcon());
  } else {
    sendBtn.classList.remove('stop-mode');
    sendBtn.title = 'Send (Enter)';
    sendBtn.replaceChildren(createSendIcon());
  }

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
  // B-022: Reset task panel state on new chat — otherwise stale "8 tasks (0/8 done)"
  // from the previous session lingers after reset.
  tab._tasks = [];
  if (tab.id === activeTabId) {
    const panel = document.getElementById('task-panel');
    if (panel) {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      panel.classList.add('hidden');
    }
  }
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

  const content = tab.currentAssistantBubble.querySelector('.message-content');
  if (turn.text) {
    content.insertAdjacentHTML('beforeend', renderMarkdown(turn.text));
  } else if (content) {
    content.remove();
  }

  // If the bubble ended up completely empty (e.g. all tools were hidden
  // task_create/update and no text), remove the wrapper so it doesn't
  // render as a phantom gray rectangle.
  const bubble = tab.currentAssistantBubble;
  if (bubble && !bubble.children.length) {
    bubble.remove();
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
    tab.lastContextTokens = 0;
    updateContextBar(0);
  }
});

// ── Event listeners ──────────────────────

sendBtn.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab?.isStreaming && !inputField.value.trim()) {
    window.api.abort(tab.id);
    return;
  }
  sendMessage();
});

/** Handle keyboard navigation within the slash command menu. Returns true if the event was consumed. */

function handleInputEscape() {
  if (!slashHelpEl.classList.contains('hidden')) {
    hideSlashHelp();
    return;
  }
  // Abort streaming on Escape
  const tab = getActiveTab();
  if (tab?.isStreaming) {
    window.api.abort(tab.id);
  }
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
window.api.onThinking((slotId, _text) =>
  withTab(slotId, (tab) => {
    // Defense in depth: drop late thinking events that arrive after the turn
    // completed. Pi SDK post-judge stragglers would otherwise re-create the
    // bubble with no subsequent agent:end to clear it (stuck-bubble regression).
    if (!tab.isStreaming) return;
    showThinkingIndicator(tab);
  }),
);
window.api.onToolStart((slotId, toolName, toolCallId) =>
  withTab(slotId, (tab) => addToolCard(tab, toolName, toolCallId)),
);
window.api.onToolEnd((slotId, toolName, toolCallId, success) =>
  withTab(slotId, (tab) => {
    completeToolCard(tab, toolCallId, success);
    tab._turnToolCount = (tab._turnToolCount || 0) + 1;
    if (!success) tab._turnToolErrors = (tab._turnToolErrors || 0) + 1;

    // B-008: Show fallback message when screenshot fails (no image will arrive)
    if (toolName === 'figma_screenshot' && !success) {
      const card = tab.chatContainer.querySelector('[data-tool-call-id="' + CSS.escape(toolCallId) + '"]');
      if (card) {
        const fallback = document.createElement('div');
        fallback.className = 'tool-fallback';
        fallback.textContent = 'Screenshot unavailable \u2014 Figma not connected';
        card.appendChild(fallback);
      }
    }
  }),
);
window.api.onScreenshot((slotId, base64) => withTab(slotId, (tab) => addScreenshot(tab, base64)));

// ── Task panel ────────────────────────────
window.api.onTaskUpdated((slotId, tasks) => {
  withTab(slotId, (tab) => {
    tab._tasks = tasks;
    // Only update the visible panel if this is the active tab
    if (slotId === activeTabId) renderTaskPanel(tab);
  });
});

function renderTaskPanel(tab) {
  const panel = document.getElementById('task-panel');
  const tasks = tab._tasks || [];
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  if (tasks.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  // Separate judge remediation tasks from regular tasks
  const judgeTasks = tasks.filter((t) => t.metadata?.source === 'judge');
  const regularTasks = tasks.filter((t) => !t.metadata?.source || t.metadata.source !== 'judge');

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const header = document.createElement('div');
  header.className = 'task-header';
  header.textContent = `${tasks.length} tasks (${completed}/${tasks.length} done)`;
  panel.appendChild(header);

  const progressOuter = document.createElement('div');
  progressOuter.className = 'task-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'task-progress-fill';
  progressInner.style.width = tasks.length > 0 ? `${(completed / tasks.length) * 100}%` : '0%';
  progressOuter.appendChild(progressInner);
  panel.appendChild(progressOuter);

  // Render regular tasks individually
  for (const t of regularTasks) {
    panel.appendChild(createTaskRow(t, taskById));
  }

  // Render judge tasks as a single collapsed group
  if (judgeTasks.length > 0) {
    const judgeCompleted = judgeTasks.filter((t) => t.status === 'completed').length;
    const judgeInProgress = judgeTasks.some((t) => t.status === 'in_progress');
    const groupStatus =
      judgeCompleted === judgeTasks.length ? 'completed' : judgeInProgress ? 'in_progress' : 'pending';

    const group = document.createElement('div');
    group.className = `task-row task-group ${groupStatus}`;

    const dot = document.createElement('span');
    dot.className = 'task-dot';
    if (groupStatus === 'completed') dot.textContent = '\u2714';
    else if (groupStatus === 'pending') dot.textContent = '\u25FB';

    const subject = document.createElement('span');
    subject.className = 'task-subject';
    subject.textContent = `Quality check (${judgeCompleted}/${judgeTasks.length} items)`;

    const toggle = document.createElement('button');
    toggle.className = 'task-group-toggle';
    toggle.textContent = '\u25B6';
    toggle.title = 'Expand';

    const details = document.createElement('div');
    details.className = 'task-group-details hidden';
    for (const t of judgeTasks) {
      details.appendChild(createTaskRow(t, taskById));
    }

    toggle.addEventListener('click', () => {
      const expanded = !details.classList.contains('hidden');
      details.classList.toggle('hidden');
      toggle.textContent = expanded ? '\u25B6' : '\u25BC';
      toggle.title = expanded ? 'Expand' : 'Collapse';
    });

    group.appendChild(dot);
    group.appendChild(subject);
    group.appendChild(toggle);
    panel.appendChild(group);
    panel.appendChild(details);
  }
}

function createTaskRow(t, taskById) {
  const row = document.createElement('div');
  row.className = `task-row ${t.status}`;

  const dot = document.createElement('span');
  dot.className = 'task-dot';
  if (t.status === 'completed') dot.textContent = '\u2714';
  else if (t.status === 'pending') dot.textContent = '\u25FB';

  const subject = document.createElement('span');
  subject.className = 'task-subject';
  subject.textContent = `#${t.id} ${t.status === 'in_progress' && t.activeForm ? t.activeForm + '\u2026' : t.subject}`;

  row.appendChild(dot);
  row.appendChild(subject);

  const openBlockers = (t.blockedBy || []).filter((bid) => {
    const b = taskById.get(bid);
    return b && b.status !== 'completed';
  });
  if (openBlockers.length > 0) {
    const blocker = document.createElement('span');
    blocker.className = 'task-blocker';
    blocker.textContent = `blocked by ${openBlockers.map((b) => '#' + b).join(', ')}`;
    row.appendChild(blocker);
  }

  return row;
}

// F14: track last retriable error per tab so we can render a Retry button on agent_end.
window.api.onStreamError?.((slotId, payload) => {
  const tab = tabs.get(slotId);
  if (!tab) return;
  tab._lastStreamError = payload;
});

// Image-gen failure banner — surfaced when Gemini call fails (missing/invalid key, quota, etc.)
window.api.onImageGenError?.((slotId, toolName, error) => {
  const tab = tabs.get(slotId);
  if (!tab?.chatContainer) return;
  const lower = String(error || '').toLowerCase();
  const needsKey = lower.includes('api key') || lower.includes('not configured') || lower.includes('authentication');
  const banner = document.createElement('div');
  banner.className = 'image-gen-error-banner';
  const title = document.createElement('strong');
  title.textContent = 'Image generation failed';
  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent = `${toolName}: ${error}`;
  banner.append(title, detail);
  if (needsKey) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Open Settings → Image Generation and add a Gemini API key from aistudio.google.com/apikey.';
    banner.appendChild(hint);
  }
  tab.chatContainer.appendChild(banner);
  tab.chatContainer.scrollTop = tab.chatContainer.scrollHeight;
});

window.api.onAgentEnd((slotId) => {
  const tab = tabs.get(slotId);
  if (!tab) return;
  removeThinkingIndicator(tab);
  // UX-007: Clear judge timeout + running indicator if no verdict arrived
  clearJudgeIndicator(tab);
  // Sweep stuck tool-card spinners: any tool card still showing a spinner
  // at agent-end means onToolEnd never arrived. Mark them as errored.
  if (tab.chatContainer) {
    for (const spinner of tab.chatContainer.querySelectorAll('.tool-spinner')) {
      const card = spinner.closest('.tool-card');
      if (card) {
        spinner.className = 'tool-status tool-error';
        spinner.textContent = '?';
        spinner.title = 'Tool result not received';
        if (card._elapsedTimer) clearInterval(card._elapsedTimer);
        if (card._elapsedShowTimeout) clearTimeout(card._elapsedShowTimeout);
      }
    }
  }
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
    // F14: if a retriable error fired during this turn, append a Retry button
    // that re-sends the last user prompt.
    if (tab._lastStreamError?.retriable && tab._lastStreamError.lastPrompt) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.textContent = 'Retry';
      const prompt = tab._lastStreamError.lastPrompt;
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        window.api.sendPrompt(slotId, prompt);
      });
      tab.currentAssistantBubble.appendChild(retryBtn);
    }
    tab._lastStreamError = null;
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
  if (tab) {
    tab.lastContextTokens = usage.input;
    if (tab.id === activeTabId) updateContextBar(usage.input);
  }
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

// ── Subagent batch & judge verdict cards ───

function createBatchCard(tab, data) {
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const card = document.createElement('div');
  card.className = 'subagent-batch-card';
  card.dataset.batchId = data.batchId || '';

  const header = document.createElement('div');
  header.className = 'batch-header';
  header.textContent = 'Research';
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'batch-body';
  card.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'batch-footer';
  footer.textContent = (data.roles?.length || 0) + ' agents';
  card.appendChild(footer);

  // Append as sibling of .message-content (not inside it) so markdown rendering doesn't destroy it
  tab.currentAssistantBubble.appendChild(card);
  tab._activeBatchCard = card;
}

function updateBatchRow(tab, data) {
  const card = tab._activeBatchCard;
  if (!card) return;
  const body = card.querySelector('.batch-body');

  let row = body.querySelector(`[data-subagent-id="${data.subagentId}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'batch-row';
    row.dataset.subagentId = data.subagentId || '';
    row.dataset.role = data.role || '';

    const dot = document.createElement('span');
    dot.className = 'batch-dot';
    const role = document.createElement('span');
    role.className = 'batch-role';
    role.textContent = data.role || '';
    const status = document.createElement('span');
    status.className = 'batch-status';
    status.textContent = 'Running...';
    const dur = document.createElement('span');
    dur.className = 'batch-duration';

    row.appendChild(dot);
    row.appendChild(role);
    row.appendChild(status);
    row.appendChild(dur);
    body.appendChild(row);
  }

  const statusEl = row.querySelector('.batch-status');
  const dotEl = row.querySelector('.batch-dot');

  if (data.type === 'tool-start') {
    statusEl.textContent = data.toolName || 'Running...';
  } else if (data.type === 'completed') {
    row.classList.add('completed');
    dotEl.textContent = '\u2713';
    statusEl.textContent = data.summary || 'Done';
  } else if (data.type === 'error') {
    row.classList.add('error');
    dotEl.textContent = '\u2717';
    statusEl.textContent = data.summary || 'Error';
  }
}

function finalizeBatchCard(tab, data) {
  const card = tab._activeBatchCard;
  if (!card) return;
  const footer = card.querySelector('.batch-footer');
  const results = data.results || [];
  const done = results.filter((r) => r.status === 'completed').length;
  const errs = results.filter((r) => r.status === 'error').length;
  footer.textContent = `${results.length} agents \u00B7 ${done} done` + (errs ? ` \u00B7 ${errs} errors` : '');
  tab._activeBatchCard = null;
}

function createJudgeVerdictCard(tab, verdict, attempt, maxAttempts) {
  // Remove "running" indicator if present
  clearJudgeIndicator(tab);
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const card = document.createElement('div');
  card.className = 'judge-verdict-card';
  card.dataset.verdict = verdict.verdict;

  const header = document.createElement('div');
  header.className = 'verdict-header';
  header.textContent =
    verdict.verdict === 'PASS' ? 'Quality Check \u00B7 PASS \u2713' : 'Quality Check \u00B7 Suggestions';
  card.appendChild(header);

  const criteria = document.createElement('div');
  criteria.className = 'verdict-criteria';
  for (const c of verdict.criteria || []) {
    const item = document.createElement('div');
    item.className = 'criterion ' + (c.pass ? 'pass' : 'fail');
    item.textContent = (c.pass ? '\u2713 ' : '\u2717 ') + c.name + (c.finding ? ' \u2014 ' + c.finding : '');
    criteria.appendChild(item);
  }
  card.appendChild(criteria);

  if (verdict.verdict === 'FAIL' && verdict.actionItems?.length) {
    const actions = document.createElement('div');
    actions.className = 'verdict-actions';
    const ol = document.createElement('ol');
    for (const item of verdict.actionItems) {
      const li = document.createElement('li');
      li.textContent = item;
      ol.appendChild(li);
    }
    actions.appendChild(ol);
    card.appendChild(actions);
  }

  const footer = document.createElement('div');
  footer.className = 'verdict-footer';
  if (attempt < maxAttempts && verdict.verdict === 'FAIL') {
    footer.textContent = `Attempt ${attempt}/${maxAttempts} \u00B7 Retrying...`;
  } else {
    footer.textContent = `Attempt ${attempt}/${maxAttempts}`;
  }
  // Re-judge button on final FAIL
  if (verdict.verdict === 'FAIL' && attempt >= maxAttempts) {
    const rejudgeBtn = document.createElement('button');
    rejudgeBtn.className = 'rejudge-btn';
    rejudgeBtn.textContent = '\uD83D\uDD04 Re-judge';
    rejudgeBtn.addEventListener('click', () => {
      if (tab.id) window.api.forceRerunJudge(tab.id);
    });
    footer.appendChild(rejudgeBtn);
  }
  card.appendChild(footer);

  // Append as sibling of .message-content so markdown rendering doesn't destroy it
  tab.currentAssistantBubble.appendChild(card);
  tab._lastJudgeCard = card;
}

// Subagent IPC events — only subagent:status remains (emitted by judge
// harness). batch-start/batch-end were for the orphan Scout/Analyst/Auditor
// orchestrator pipeline and have been removed from the preload surface.
window.api.onSubagentStatus((slotId, data) => withTab(slotId, (tab) => updateBatchRow(tab, data)));
window.api.onJudgeRunning((slotId) =>
  withTab(slotId, (tab) => {
    // Guard: clear any existing indicator before creating a new one (prevents stacking)
    clearJudgeIndicator(tab);
    if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
    const indicator = document.createElement('div');
    indicator.className = 'judge-running-indicator';
    const spinner = document.createElement('span');
    spinner.className = 'judge-spinner';
    indicator.appendChild(spinner);
    indicator.appendChild(document.createTextNode(' Quality check running\u2026'));
    tab.currentAssistantBubble.appendChild(indicator);
    tab._judgeRunningIndicator = indicator;
    // UX-007: Auto-dismiss spinner after timeout to avoid indefinite "running" state
    tab._judgeRunningTimeout = setTimeout(() => {
      if (tab._judgeRunningIndicator) {
        tab._judgeRunningIndicator.textContent = 'Quality check timed out';
        tab._judgeRunningIndicator.classList.add('judge-timeout');
        tab._judgeRunningIndicator = null;
      }
    }, JUDGE_TIMEOUT_MS);
  }),
);
window.api.onJudgeVerdict((slotId, verdict, attempt, max) =>
  withTab(slotId, (tab) => createJudgeVerdictCard(tab, verdict, attempt, max)),
);
window.api.onJudgeRetryStart((slotId, _attempt, _max) =>
  withTab(slotId, (_tab) => {
    // No-op: the previous verdict card already shows the FAIL result.
    // Overwriting its footer would erase the historical attempt number.
  }),
);

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

// ── F8: Figma token-lost banner ─────────
const figmaTokenBanner = document.getElementById('figma-token-lost-banner');
window.api.onFigmaTokenLost?.(() => {
  if (figmaTokenBanner) figmaTokenBanner.style.display = 'flex';
});
document.getElementById('figma-token-lost-dismiss')?.addEventListener('click', () => {
  if (figmaTokenBanner) figmaTokenBanner.style.display = 'none';
});
document.getElementById('figma-token-reenter')?.addEventListener('click', () => {
  if (figmaTokenBanner) figmaTokenBanner.style.display = 'none';
  document.getElementById('settings-btn')?.click();
});

// ── F17: Auto-fallback banner ───────────
const autoFallbackBanner = document.getElementById('auto-fallback-banner');
window.api.onAutoFallback?.((_slotId, payload) => {
  if (!autoFallbackBanner) return;
  const text = document.getElementById('auto-fallback-text');
  if (text) {
    text.textContent = `Model ${payload.from} not available (${payload.reason}). Switched to last-known-good ${payload.to}.`;
  }
  autoFallbackBanner.style.display = 'flex';
});
document.getElementById('auto-fallback-dismiss')?.addEventListener('click', () => {
  if (autoFallbackBanner) autoFallbackBanner.style.display = 'none';
});

// ── F21: Post-upgrade wizard ────────────
const postUpgradeModal = document.getElementById('post-upgrade-modal');
window.api.onPostUpgrade?.((payload) => {
  if (!postUpgradeModal) return;
  const summary = document.getElementById('post-upgrade-summary');
  const list = document.getElementById('post-upgrade-list');
  if (summary) {
    summary.textContent = `Updated from ${payload.previousVersion} to ${payload.currentVersion}. Some credentials need attention:`;
  }
  if (list) {
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const r of payload.regressions) {
      const li = document.createElement('li');
      li.textContent = `${r.provider}: was ${r.previousType}, now disconnected`;
      list.appendChild(li);
    }
  }
  postUpgradeModal.style.display = 'flex';
});
document.getElementById('post-upgrade-dismiss')?.addEventListener('click', () => {
  if (postUpgradeModal) postUpgradeModal.style.display = 'none';
});
document.getElementById('post-upgrade-open-settings')?.addEventListener('click', () => {
  if (postUpgradeModal) postUpgradeModal.style.display = 'none';
  document.getElementById('settings-btn')?.click();
});

// ── F6: Keychain unavailable banner ─────
const keychainBanner = document.getElementById('keychain-unavailable-banner');
window.api.onKeychainUnavailable?.(() => {
  if (keychainBanner) keychainBanner.style.display = 'flex';
});
document.getElementById('keychain-unavailable-dismiss')?.addEventListener('click', () => {
  if (keychainBanner) keychainBanner.style.display = 'none';
});
document.getElementById('keychain-open-settings')?.addEventListener('click', () => {
  if (keychainBanner) keychainBanner.style.display = 'none';
  document.getElementById('settings-btn')?.click();
});

// ── Plugin setup banner ─────────────────

const pluginBanner = document.getElementById('plugin-setup-banner');
const pluginRetryBtn = document.getElementById('plugin-setup-retry');

window.api.onPluginNeedsSetup(() => {
  if (pluginBanner) pluginBanner.style.display = 'flex';
});

function handlePluginInstallResult(result) {
  const installed = result.success && (result.autoRegistered || result.alreadyRegistered);
  if (installed) {
    if (pluginBanner) pluginBanner.style.display = 'none';
    return;
  }
  updateRetryButtonText(result);
}

function updateRetryButtonText(result) {
  if (!pluginRetryBtn) return;
  pluginRetryBtn.textContent =
    result.success && result.figmaRunning
      ? 'Figma still running \u2014 close Figma first, then retry'
      : 'Auto-register failed \u2014 run Bottega Bridge from Plugins \u2192 Development';
}

pluginRetryBtn?.addEventListener('click', async () => {
  handlePluginInstallResult(await window.api.installFigmaPlugin());
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
    // Keep the renderer's modelConfig in sync with the main process. Without
    // this, the toolbar picker reads stale values and the dropdown checkmark
    // can disagree with the bar label after a switchModel call.
    if (slotInfo.modelConfig) tab.modelConfig = slotInfo.modelConfig;
    renderTabBar();
    if (slotInfo.id === activeTabId) {
      syncModelToTab(tab.modelConfig);
      // Model switch recreates the session — effort capabilities may have
      // changed (different xhigh support, different default). Re-reconcile.
      syncEffortToTab(tab);
    }
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
  // Prefetch model status so the toolbar label shows a dot from the first
  // paint instead of waiting for the user to open Settings.
  void refreshModelStatusCache();
  const existingTabs = await window.api.listTabs();
  for (const info of existingTabs) {
    const tab = createTabState(info);
    tabs.set(tab.id, tab);
  }
  // The figma:connected IPC fires when the WS handshake completes — which can
  // happen before the renderer mounts listeners. Derive the global status dot
  // from the restored tabs' connection state so a reconnect isn't needed.
  if (existingTabs.some((t) => t.isConnected)) {
    statusDot.className = 'status-dot connected';
    statusDot.title = 'Figma connected';
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
  // B-006: Guard against undefined IPC return — fallback to toggling current state
  const result = await window.api.togglePin();
  const pinned = typeof result === 'boolean' ? result : !pinBtn.classList.contains('pinned');
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
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Max' },
];

// Anthropic=token budget, OpenAI=reasoning_effort enum, Google=model-dependent.
// Surfacing the semantic distinction prevents the "all providers alike" illusion.
const EFFORT_FAMILY_LABELS = {
  anthropic: 'Thinking budget',
  openai: 'Reasoning effort',
  google: 'Thinking',
  unknown: 'Thinking effort',
};

const _effortCapsCache = new Map();

// Conservative fallback for when the capability IPC is unavailable or fails.
// Never advertises minimal/xhigh — those are model-specific and showing them
// as "always available" bleeds false options (e.g. "Max" under Gemini 3 Pro).
function defaultEffortCaps() {
  return {
    family: 'unknown',
    availableLevels: ['off', 'low', 'medium', 'high'],
    supportsThinking: true,
    supportsXhigh: false,
    currentLevel: currentEffort,
  };
}

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
    // Optional dot prefix (model status: 🟢 ok, 🟡 unknown, 🔴 unauthorized).
    label.textContent = item.dot ? `${item.dot} ${item.label}` : item.label;
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
  // Prefer the active tab's modelConfig (live state) over localStorage (last
  // global default). Otherwise the button label and the menu's checkmark can
  // disagree when the active tab is using a different model than the default.
  const activeTab = activeTabId ? tabs.get(activeTabId) : null;
  const currentProvider = activeTab?.modelConfig?.provider ?? localStorage.getItem('bottega:provider') ?? 'anthropic';
  const currentModel = activeTab?.modelConfig?.modelId ?? localStorage.getItem('bottega:model') ?? 'claude-sonnet-4-6';
  // Use the cache populated at startup + refreshed on auth changes, avoiding
  // an IPC roundtrip on every dropdown open.
  const statusMap = _toolbarModelStatusCache;
  const allModels = [];
  for (const [_group, list] of Object.entries(models)) {
    list.forEach((m) =>
      allModels.push({
        id: m.id,
        label: m.label,
        sdkProvider: m.sdkProvider,
        dot: modelStatusDotEmoji(statusMap[m.id] ?? 'unknown'),
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
    // Eagerly update the renderer's tab.modelConfig so a re-open of the
    // picker before the IPC roundtrip completes still shows the right
    // checkmark. The follow-up tab:updated event reconfirms.
    const eagerTab = tabs.get(activeTabId);
    if (eagerTab) eagerTab.modelConfig = { provider: item.sdkProvider, modelId: item.id };
    await window.api.switchModel(activeTabId, { provider: item.sdkProvider, modelId: item.id });
    // Don't zero the context bar — switchSession restores the history, so
    // context is preserved. Repaint with the last known token count against
    // the NEW model's max window (e.g. Sonnet 1M → Opus 200k shrinks the bar).
    // Exact count lands on the next turn via onUsage.
    const repainted = tabs.get(activeTabId);
    updateContextBar(repainted?.lastContextTokens ?? 0);
  });
});

async function fetchEffortCapabilities(slotId) {
  if (!slotId || typeof window.api.getThinkingCapabilities !== 'function') return defaultEffortCaps();
  try {
    const caps = await window.api.getThinkingCapabilities(slotId);
    _effortCapsCache.set(slotId, caps);
    return caps;
  } catch {
    return _effortCapsCache.get(slotId) ?? defaultEffortCaps();
  }
}

function applyEffortCapsToChip(caps) {
  const familyLabel = EFFORT_FAMILY_LABELS[caps.family] ?? EFFORT_FAMILY_LABELS.unknown;
  barEffortBtn.title = caps.supportsThinking
    ? `${familyLabel} — click to change`
    : `${familyLabel} — not supported by this model`;
  barEffortBtn.classList.toggle('disabled-chip', !caps.supportsThinking);
  barEffortBtn.setAttribute('aria-label', `Select ${familyLabel.toLowerCase()}`);
}

function setEffortLabel(levelId) {
  const match = EFFORT_LEVELS.find((l) => l.id === levelId);
  if (!match) return;
  currentEffort = match.id;
  barEffortLabel.textContent = match.label;
  localStorage.setItem('bottega:effort', match.id);
}

barEffortBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  let caps = await fetchEffortCapabilities(activeTabId);
  applyEffortCapsToChip(caps);
  // Click can fire before the background reconcile in syncEffortToTab finishes,
  // leaving session.currentLevel stale relative to the user's preference.
  // Reconcile inline so the dropdown's check always matches the chip.
  const activeTab = activeTabId ? tabs.get(activeTabId) : null;
  if (activeTab) caps = await reconcileEffortCaps(activeTab, caps);

  const allowed = new Set(caps.availableLevels);
  const items = EFFORT_LEVELS.filter((l) => allowed.has(l.id)).map((l) => ({
    id: l.id,
    label: l.label,
    active: l.id === (caps.currentLevel ?? currentEffort),
  }));
  if (items.length === 0) items.push({ id: 'off', label: 'Off', active: true });

  createDropdown(barEffortBtn, items, async (item) => {
    if (!activeTabId) {
      setEffortLabel(item.id);
      return;
    }
    const res = await window.api.setThinking(activeTabId, item.id);
    const effective = res?.level ?? item.id;
    setEffortLabel(effective);
    const tab = tabs.get(activeTabId);
    if (tab) tab.thinkingLevel = effective;
    _effortCapsCache.delete(activeTabId);
  });
});

// Saved effort is applied when a tab is first activated (activeTabId is null at load time)

// ── Judge toggle chip ─────────────────────

const barJudgeBtn = document.getElementById('bar-judge-btn');
let judgeOverride = null; // null = follow settings, true = force on, false = force off

barJudgeBtn.addEventListener('click', () => {
  if (judgeOverride === null) {
    judgeOverride = true;
  } else if (judgeOverride === true) {
    judgeOverride = false;
  } else {
    judgeOverride = null;
  }
  barJudgeBtn.classList.toggle('active', judgeOverride === true);
  barJudgeBtn.classList.toggle('disabled-chip', judgeOverride === false);
  // Persist per-tab
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) tab.judgeOverride = judgeOverride;
  if (activeTabId) window.api.setJudgeOverride(activeTabId, judgeOverride);
});

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
      if (!tab || !tab.id) return;
      hideSuggestions();
      if (!tab.isStreaming) {
        _initTurn(tab, text, []);
      }
      window.api.sendPrompt(tab.id, text).catch((_err) => {
        // Show the error inline so the user knows the click didn't work
        if (tab.currentAssistantBubble) {
          const errEl = document.createElement('div');
          errEl.className = 'tool-error';
          errEl.textContent = 'Failed to send prompt. Please try again.';
          tab.currentAssistantBubble.appendChild(errEl);
        }
      });
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
  // B-011: Only show suggestions if this is the active tab AND has messages.
  // Prevents stale suggestions from appearing in a freshly-cleared chat.
  const tab = tabs.get(slotId);
  if (slotId === activeTabId && tab && tab.chatContainer.childElementCount > 0) {
    showSuggestions(suggestions);
  }
});

// Focus input on load
inputField.focus();
