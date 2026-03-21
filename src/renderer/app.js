// State
let currentAssistantBubble = null;
let isStreaming = false;

// DOM references
const chatArea = document.getElementById('chat-area');
const inputField = document.getElementById('input-field');
const sendBtn = document.getElementById('send-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const pinBtn = document.getElementById('pin-btn');

// Send message
function sendMessage() {
  const text = inputField.value.trim();
  if (!text || isStreaming) return;

  // Hide prompt suggestions when sending
  hideSuggestions();

  // Add user bubble (with pasted images if any)
  addUserMessage(text, pastedImages.map((p) => p.dataUrl));
  pastedImages = [];
  renderPastePreview();
  inputField.value = '';
  inputField.style.height = 'auto';

  // Start assistant bubble
  currentAssistantBubble = createAssistantBubble();
  isStreaming = true;
  updateInputState();

  // Send to main process (catch to prevent unhandled rejection — errors are
  // surfaced via agent:text-delta + agent:end events from the main process)
  window.api.sendPrompt(text).catch(() => {});
}

function addUserMessage(text, images) {
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
  chatArea.appendChild(msg);
  scrollToBottom();
}

function createAssistantBubble() {
  const msg = document.createElement('div');
  msg.className = 'message assistant-message';
  const content = document.createElement('div');
  content.className = 'message-content';
  msg.appendChild(content);
  chatArea.appendChild(msg);
  scrollToBottom();
  return msg;
}

function appendToAssistant(text) {
  if (!currentAssistantBubble) return;
  const content = currentAssistantBubble.querySelector('.message-content');
  content.textContent += text;
  scrollToBottom();
}

// Tool execution cards
function addToolCard(toolName, toolCallId) {
  if (!currentAssistantBubble) currentAssistantBubble = createAssistantBubble();
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.id = 'tool-' + toolCallId;
  // Build with DOM methods — no untrusted content set via innerHTML
  const spinner = document.createElement('span');
  spinner.className = 'tool-spinner';
  const nameEl = document.createElement('span');
  nameEl.className = 'tool-name';
  nameEl.textContent = toolName; // textContent: safe
  card.appendChild(spinner);
  card.appendChild(nameEl);
  currentAssistantBubble.appendChild(card);
  scrollToBottom();
}

function completeToolCard(toolCallId, success) {
  const card = document.getElementById('tool-' + toolCallId);
  if (!card) return;
  const spinner = card.querySelector('.tool-spinner');
  if (spinner) {
    spinner.className = 'tool-status ' + (success ? 'tool-success' : 'tool-error');
    spinner.textContent = success ? '\u2713' : '\u2717'; // ✓ / ✗ via textContent
  }
}

// Screenshots
function addScreenshot(base64) {
  if (!currentAssistantBubble) currentAssistantBubble = createAssistantBubble();
  const img = document.createElement('img');
  img.className = 'screenshot';
  img.src = 'data:image/png;base64,' + base64;
  img.alt = 'Figma screenshot';
  currentAssistantBubble.appendChild(img);
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let scrollRafId = null;
function scrollToBottom() {
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
    scrollRafId = null;
  });
}

function updateInputState() {
  sendBtn.disabled = isStreaming;
  inputField.disabled = isStreaming;
  if (!isStreaming) {
    inputField.focus();
  }
}

// ── Event listeners ──────────────────────

sendBtn.addEventListener('click', sendMessage);

inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
inputField.addEventListener('input', () => {
  inputField.style.height = 'auto';
  inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
});

// ── API event handlers ───────────────────

// ── Thinking indicator ────────────────────

let thinkingBubble = null;

function showThinkingIndicator() {
  if (thinkingBubble) return;
  thinkingBubble = document.createElement('div');
  thinkingBubble.className = 'thinking-bubble';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'thinking-dot';
    thinkingBubble.appendChild(dot);
  }
  chatArea.appendChild(thinkingBubble);
  scrollToBottom();
}

function removeThinkingIndicator() {
  if (thinkingBubble) {
    thinkingBubble.remove();
    thinkingBubble = null;
  }
}

window.api.onTextDelta((text) => {
  appendToAssistant(text);
});

window.api.onThinking((_text) => {
  showThinkingIndicator();
});

window.api.onToolStart((toolName, toolCallId) => {
  addToolCard(toolName, toolCallId);
});

window.api.onToolEnd((toolName, toolCallId, success) => {
  completeToolCard(toolCallId, success);
});

window.api.onScreenshot((base64) => {
  addScreenshot(base64);
});

window.api.onAgentEnd(() => {
  removeThinkingIndicator();
  // Render markdown on the accumulated plain text.
  // renderMarkdown() calls escapeHtml() first, so innerHTML receives
  // only sanitized markup — no untrusted content is injected directly.
  if (currentAssistantBubble) {
    const content = currentAssistantBubble.querySelector('.message-content');
    if (content && content.textContent) {
      content.innerHTML = renderMarkdown(content.textContent); // safe: escapeHtml applied first
    }
  }
  currentAssistantBubble = null;
  isStreaming = false;
  updateInputState();
});

// ── Context usage bar ────────────────────

const contextFill = document.getElementById('context-fill');
const contextLabel = document.getElementById('context-label');
let contextSizes = {};
let lastInputTokens = 0;

function updateContextBar(inputTokens) {
  lastInputTokens = inputTokens;
  const modelId = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  const maxTokens = contextSizes[modelId] || 200000;
  const pct = Math.min(100, (inputTokens / maxTokens) * 100);
  contextFill.style.width = pct.toFixed(1) + '%';
  contextFill.className = 'context-fill' + (pct > 90 ? ' critical' : pct > 70 ? ' warn' : '');

  // Format: "125K / 1M" or "12K / 200K"
  const fmt = (n) => n >= 1_000_000 ? (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M' : Math.round(n / 1000) + 'K';
  contextLabel.textContent = fmt(inputTokens) + ' / ' + fmt(maxTokens);
}

window.api.onUsage((usage) => {
  updateContextBar(usage.input);
});

// Load context sizes and init bar
(async () => {
  contextSizes = await window.api.getContextSizes();
  updateContextBar(0);
})();

// SDK lifecycle: compaction / retry indicators
window.api.onCompaction((active) => {
  statusText.textContent = active ? 'Compacting…' : (statusDot.classList.contains('connected') ? 'Connected' : 'Disconnected');
});

window.api.onRetry((active) => {
  statusText.textContent = active ? 'Retrying…' : (statusDot.classList.contains('connected') ? 'Connected' : 'Disconnected');
});

window.api.onFigmaConnected((fileKey) => {
  statusDot.className = 'status-dot connected';
  statusText.textContent = fileKey || 'Connected';
});

window.api.onFigmaDisconnected(() => {
  statusDot.className = 'status-dot disconnected';
  statusText.textContent = 'Disconnected';
});

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
  while (accountsList.firstChild) accountsList.removeChild(accountsList.firstChild);

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
  setLoginAreaContent(loginArea, 'Opening browser for authentication…', null, true);

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
      localStorage.setItem('figma-companion:provider', oauthModel.sdkProvider);
      localStorage.setItem('figma-companion:model', oauthModel.id);
      populateModelSelect();
      modelSelect.value = oauthModel.sdkProvider + ':' + oauthModel.id;
      const switchResult = await window.api.switchModel({ provider: oauthModel.sdkProvider, modelId: oauthModel.id });
      if (!switchResult.success) {
        keyStatus.textContent = switchResult.error || 'Failed to switch model';
        keyStatus.className = 'key-status error';
      }
      updateContextBar(0);
    }
  } else if (result.error && result.error !== 'Login cancelled') {
    keyStatus.textContent = result.error;
    keyStatus.className = 'key-status error';
  }
}

function setLoginAreaContent(area, message, promptOpts, showCancel) {
  while (area.firstChild) area.removeChild(area.firstChild);

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
      setLoginAreaContent(area, 'Authenticating…', null, true);
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
      setLoginAreaContent(
        loginArea,
        event.instructions || 'Waiting for browser authentication…',
        null,
        true,
      );
      break;
    case 'prompt':
      setLoginAreaContent(loginArea, event.message, {
        placeholder: event.placeholder,
        allowEmpty: event.allowEmpty,
      }, true);
      break;
    case 'progress':
      setLoginAreaContent(loginArea, event.message, null, true);
      break;
  }
});

// ── API key fallback ─────────────────────

toggleApikeyBtn.addEventListener('click', () => {
  apikeySection.classList.toggle('hidden');
  toggleApikeyBtn.textContent = apikeySection.classList.contains('hidden')
    ? 'Use API key instead'
    : 'Hide API key';
});

apikeyProviderSelect.addEventListener('change', () => {
  const provider = apikeyProviderSelect.value;
  apiKeyInput.placeholder = PROVIDER_META[provider]?.keyPlaceholder || 'API key';
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

  keyStatus.textContent = PROVIDER_META[provider]?.label + ' key saved';
  keyStatus.className = 'key-status success';

  await renderAccountCards();

  // Auto-switch to this provider's first API key model
  const models = availableModels[provider] || [];
  // For API keys, pick a model whose sdkProvider matches the display group
  const apiModel = models.find((m) => m.sdkProvider === provider) || models[0];
  if (apiModel) {
    localStorage.setItem('figma-companion:provider', apiModel.sdkProvider);
    localStorage.setItem('figma-companion:model', apiModel.id);
    populateModelSelect();
    modelSelect.value = apiModel.sdkProvider + ':' + apiModel.id;
    await window.api.switchModel({ provider: apiModel.sdkProvider, modelId: apiModel.id });
  }
});

// ── Model selector ───────────────────────

function populateModelSelect() {
  while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
  for (const [displayGroup, models] of Object.entries(availableModels)) {
    if (models.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = PROVIDER_META[displayGroup]?.label || displayGroup;
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
  const savedProvider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const savedModel = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  modelSelect.value = savedProvider + ':' + savedModel;
}

modelSelect.addEventListener('change', async () => {
  // Split on first colon only (model IDs should not contain colons, but be safe)
  const sepIdx = modelSelect.value.indexOf(':');
  const sdkProvider = modelSelect.value.slice(0, sepIdx);
  const modelId = modelSelect.value.slice(sepIdx + 1);
  localStorage.setItem('figma-companion:provider', sdkProvider);
  localStorage.setItem('figma-companion:model', modelId);
  const result = await window.api.switchModel({ provider: sdkProvider, modelId });
  if (!result.success) {
    keyStatus.textContent = result.error || 'Failed to switch';
    keyStatus.className = 'key-status error';
  }
  updateContextBar(0);
});

// ── Init auth UI ─────────────────────────

async function initAuthUI() {
  availableModels = await window.api.getModels();
  populateModelSelect();
  await renderAccountCards();

  // Sync bar label now that models are loaded
  syncBarModelLabel();

  // Switch session to saved model if it differs from the default
  const savedProvider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const savedModel = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  if (savedProvider !== 'anthropic' || savedModel !== 'claude-sonnet-4-6') {
    await window.api.switchModel({ provider: savedProvider, modelId: savedModel });
  }
}

initAuthUI();

// ── Transparency control ─────────────────

function applyTransparency(value) {
  // 0% = fully opaque (opacity 1.0), 100% = max usable transparency (opacity 0.775)
  const opacity = 1 - (value / 100) * 0.225; // maps 0→1.0, 100→0.775
  window.api.setOpacity(opacity);
  transparencyValue.textContent = value + '%';
  localStorage.setItem('figma-companion:transparency', value);
}

transparencySlider.addEventListener('input', () => {
  applyTransparency(Number(transparencySlider.value));
});

// Restore saved transparency (or default 0 = fully opaque)
const savedTransparency = localStorage.getItem('figma-companion:transparency');
const initialTransparency = savedTransparency !== null ? Number(savedTransparency) : 0;
transparencySlider.value = initialTransparency;
applyTransparency(initialTransparency);

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

let currentEffort = localStorage.getItem('figma-companion:effort') || 'medium';
barEffortLabel.textContent = EFFORT_LEVELS.find((e) => e.id === currentEffort)?.label || 'Medium';

// Generic dropdown factory
function createDropdown(anchorBtn, items, onSelect) {
  // Close any existing dropdown
  const existing = anchorBtn.querySelector('.toolbar-dropdown');
  if (existing) { existing.remove(); anchorBtn.classList.remove('open'); return; }
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
  const currentProvider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const currentModel = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  const allModels = [];
  for (const [_group, list] of Object.entries(models)) {
    list.forEach((m) => allModels.push({
      id: m.id,
      label: m.label,
      sdkProvider: m.sdkProvider,
      active: m.sdkProvider === currentProvider && m.id === currentModel,
    }));
  }
  createDropdown(barModelBtn, allModels, async (item) => {
    barModelLabel.textContent = item.label.replace(/ \(.*\)/, '');
    localStorage.setItem('figma-companion:provider', item.sdkProvider);
    localStorage.setItem('figma-companion:model', item.id);
    // Sync settings panel model selector
    if (modelSelect) modelSelect.value = item.sdkProvider + ':' + item.id;
    await window.api.switchModel({ provider: item.sdkProvider, modelId: item.id });
    updateContextBar(0);
  });
});

// Effort picker
barEffortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const items = EFFORT_LEVELS.map((l) => ({ ...l, active: l.id === currentEffort }));
  createDropdown(barEffortBtn, items, (item) => {
    currentEffort = item.id;
    barEffortLabel.textContent = item.label;
    localStorage.setItem('figma-companion:effort', item.id);
    window.api.setThinking(item.id);
  });
});

// Sync model label on init (runs after initAuthUI populates availableModels)
function syncBarModelLabel() {
  const sdkProvider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const modelId = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  const allModels = Object.values(availableModels).flat();
  const match = allModels.find((m) => m.sdkProvider === sdkProvider && m.id === modelId);
  if (match) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
}

// Apply saved effort on load
window.api.setThinking(currentEffort);

// ── Paste screenshot support ─────────────

const pastePreview = document.getElementById('paste-preview');
let pastedImages = []; // Array of { dataUrl, blob }

inputField.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
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
  while (pastePreview.firstChild) pastePreview.removeChild(pastePreview.firstChild);
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
  while (suggestionsContainer.firstChild) suggestionsContainer.removeChild(suggestionsContainer.firstChild);
  if (!suggestions || suggestions.length === 0) {
    suggestionsContainer.classList.add('hidden');
    return;
  }
  suggestions.forEach((text) => {
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      inputField.value = text;
      inputField.style.height = 'auto';
      inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
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
  while (suggestionsContainer.firstChild) suggestionsContainer.removeChild(suggestionsContainer.firstChild);
}

window.api.onSuggestions((suggestions) => {
  showSuggestions(suggestions);
});

// Hide suggestions when user starts typing or sends
inputField.addEventListener('input', () => {
  if (suggestionsContainer.children.length > 0) {
    hideSuggestions();
  }
});

// Focus input on load
inputField.focus();
