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

  // Add user bubble
  addUserMessage(text);
  inputField.value = '';
  inputField.style.height = 'auto';

  // Start assistant bubble
  currentAssistantBubble = createAssistantBubble();
  isStreaming = true;
  updateInputState();

  // Send to main process
  window.api.sendPrompt(text);
}

function addUserMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'message user-message';
  msg.textContent = text;
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

// Focus input on load
inputField.focus();
