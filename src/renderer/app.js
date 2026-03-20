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

  // Send to main process
  window.api.sendPrompt(text);
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

window.api.onTextDelta((text) => {
  appendToAssistant(text);
});

window.api.onThinking((_text) => {
  // Thinking content is internal; streaming cursor in the bubble shows activity.
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

const providerSelect = document.getElementById('provider-select');
const modelSelect = document.getElementById('model-select');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const keyStatus = document.getElementById('key-status');

let availableModels = {};

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

const KEY_PLACEHOLDERS = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  google: 'AIza...',
};

async function initAuthUI() {
  availableModels = await window.api.getModels();
  updateModelOptions();
  await updateKeyStatus();

  // Restore saved provider/model from localStorage
  const savedProvider = localStorage.getItem('figma-companion:provider');
  const savedModel = localStorage.getItem('figma-companion:model');
  if (savedProvider && availableModels[savedProvider]) {
    providerSelect.value = savedProvider;
    updateModelOptions();
  }
  if (savedModel) {
    modelSelect.value = savedModel;
  }

  // Switch session to saved model if it differs from the default (claude-sonnet-4-6)
  const targetProvider = savedProvider || 'anthropic';
  const targetModel = savedModel || 'claude-sonnet-4-6';
  if (targetProvider !== 'anthropic' || targetModel !== 'claude-sonnet-4-6') {
    await window.api.switchModel({ provider: targetProvider, modelId: targetModel });
  }
}

function updateModelOptions() {
  const provider = providerSelect.value;
  const models = availableModels[provider] || [];
  // Clear options safely (no innerHTML)
  while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  });
  apiKeyInput.placeholder = KEY_PLACEHOLDERS[provider] || 'API key';

  // Restore saved model if it belongs to this provider
  const savedModel = localStorage.getItem('figma-companion:model');
  if (savedModel && models.some((m) => m.id === savedModel)) {
    modelSelect.value = savedModel;
  }
}

async function updateKeyStatus() {
  const provider = providerSelect.value;
  const hasKey = await window.api.hasApiKey(provider);
  keyStatus.textContent = hasKey ? PROVIDER_LABELS[provider] + ' key configured' : 'No key set';
  keyStatus.className = 'key-status' + (hasKey ? ' success' : '');
}

providerSelect.addEventListener('change', async () => {
  updateModelOptions();
  await updateKeyStatus();
  apiKeyInput.value = '';
});

modelSelect.addEventListener('change', async () => {
  const provider = providerSelect.value;
  const modelId = modelSelect.value;
  localStorage.setItem('figma-companion:provider', provider);
  localStorage.setItem('figma-companion:model', modelId);

  keyStatus.textContent = 'Switching model…';
  keyStatus.className = 'key-status';
  const result = await window.api.switchModel({ provider, modelId });
  if (result.success) {
    keyStatus.textContent = 'Using ' + modelSelect.options[modelSelect.selectedIndex].text;
    keyStatus.className = 'key-status success';
  } else {
    keyStatus.textContent = result.error || 'Failed to switch';
    keyStatus.className = 'key-status error';
  }
});

saveKeyBtn.addEventListener('click', async () => {
  const provider = providerSelect.value;
  const key = apiKeyInput.value.trim();
  if (!key) return;

  saveKeyBtn.disabled = true;
  await window.api.setApiKey(provider, key);
  apiKeyInput.value = '';
  await updateKeyStatus();
  saveKeyBtn.disabled = false;

  // Auto-switch to this provider's model
  const modelId = modelSelect.value;
  localStorage.setItem('figma-companion:provider', provider);
  localStorage.setItem('figma-companion:model', modelId);
  keyStatus.textContent = 'Key saved. Switching…';
  const result = await window.api.switchModel({ provider, modelId });
  if (result.success) {
    keyStatus.textContent = 'Using ' + modelSelect.options[modelSelect.selectedIndex].text;
    keyStatus.className = 'key-status success';
  } else {
    keyStatus.textContent = result.error || 'Switch failed';
    keyStatus.className = 'key-status error';
  }
});

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
  const models = await window.api.getModels();
  const provider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const currentModel = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  const allModels = [];
  for (const [prov, list] of Object.entries(models)) {
    list.forEach((m) => allModels.push({ id: m.id, label: m.label, provider: prov, active: m.id === currentModel }));
  }
  createDropdown(barModelBtn, allModels, async (item) => {
    barModelLabel.textContent = item.label.replace(/ \(.*\)/, '');
    localStorage.setItem('figma-companion:provider', item.provider);
    localStorage.setItem('figma-companion:model', item.id);
    // Also update settings panel selectors if open
    if (providerSelect) providerSelect.value = item.provider;
    updateModelOptions();
    if (modelSelect) modelSelect.value = item.id;
    await window.api.switchModel({ provider: item.provider, modelId: item.id });
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

// Sync model label on init
(async () => {
  const models = await window.api.getModels();
  const provider = localStorage.getItem('figma-companion:provider') || 'anthropic';
  const modelId = localStorage.getItem('figma-companion:model') || 'claude-sonnet-4-6';
  const allModels = Object.values(models).flat();
  const match = allModels.find((m) => m.id === modelId);
  if (match) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
})();

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

// Clear pasted images after sending
const originalSendMessage = sendMessage;

// Focus input on load
inputField.focus();
