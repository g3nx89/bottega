// ── Auth & Model ─────────────────────────

let loginInProgress = null; // provider currently logging in

const accountsList = document.getElementById('accounts-list');
const toggleApikeyBtn = document.getElementById('toggle-apikey-btn');
const apikeySection = document.getElementById('apikey-section');
const apikeyProviderSelect = document.getElementById('apikey-provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const keyStatus = document.getElementById('key-status');
const modelSelect = document.getElementById('model-select');
const transparencySlider = document.getElementById('transparency-slider');
const transparencyValue = document.getElementById('transparency-value');

// OpenAI is OAuth-only (ChatGPT Plus/Pro subscription). Anthropic + Google
// still accept either OAuth or API key via the "Use API key instead" path.
const PROVIDER_META = {
  anthropic: { label: 'Anthropic', sublabel: 'Claude Pro / Max', keyPlaceholder: 'sk-ant-...' },
  openai: { label: 'OpenAI', sublabel: 'ChatGPT Plus / Pro subscription', keyPlaceholder: '' },
  google: { label: 'Google', sublabel: 'Gemini', keyPlaceholder: 'AIza...' },
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
      // F19: Test connection — probes the first model in this provider group.
      const testBtn = document.createElement('button');
      testBtn.className = 'account-btn test';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
        try {
          const res = await window.api.testConnection(provider);
          // New envelope: {success, data?, error?, code?}
          if (res.success) {
            testBtn.textContent = '✓ OK';
            testBtn.title = res.data?.modelId ?? '';
          } else {
            testBtn.textContent = `✗ ${res.code ?? 'ERR'}`;
            testBtn.title = res.error ?? '';
          }
        } catch (e) {
          testBtn.textContent = '✗ err';
          testBtn.title = String(e);
        }
        setTimeout(() => {
          testBtn.disabled = false;
          testBtn.textContent = 'Test';
          testBtn.title = '';
        }, 3000);
        refreshModelStatus();
      });
      right.appendChild(testBtn);

      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'account-btn logout';
      logoutBtn.textContent = 'Logout';
      logoutBtn.addEventListener('click', async () => {
        await window.api.logout(provider);
        renderAccountCards();
        refreshModelStatus();
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

async function handleLoginSuccess(displayGroup) {
  const models = availableModels[displayGroup] || [];
  const oauthModel = models.find((m) => m.sdkProvider !== displayGroup) || models[0];
  if (!oauthModel) return;

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

function showGoogleCloudProjectPrompt(loginArea, displayGroup) {
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
}

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
  // Repopulate the model-picker dot cache so newly authorized providers
  // turn green immediately instead of waiting for the next Test click.
  refreshModelStatus();

  if (result.success) {
    await handleLoginSuccess(displayGroup);
  } else if (result.code === 'GOOGLE_CLOUD_PROJECT_REQUIRED') {
    showGoogleCloudProjectPrompt(loginArea, displayGroup);
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

// modelStatusDotEmoji() is defined once in app.js and consumed here via
// shared global scope. Keeping the canonical mapping in a single place
// avoids drift when probe statuses are added or reclassified.

let _modelStatusCache = {};

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
      const status = _modelStatusCache[m.id] ?? 'unknown';
      opt.textContent = `${modelStatusDotEmoji(status)} ${m.label}`;
      // F10: disable reds so picker enforces auth invariant.
      if (status === 'unauthorized' || status === 'forbidden' || status === 'not_found') {
        opt.disabled = true;
        opt.title = `${m.label} requires ${PROVIDER_META[displayGroup]?.label ?? displayGroup} auth. Sign in first.`;
      }
      group.appendChild(opt);
    });
    modelSelect.appendChild(group);
  }

  // Restore saved selection
  const savedProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const savedModel = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  modelSelect.value = savedProvider + ':' + savedModel;
}

/** Refresh dots from main. Call after auth changes or on settings open. */
async function refreshModelStatus() {
  if (typeof window.api.getModelStatus !== 'function') return;
  try {
    _modelStatusCache = await window.api.getModelStatus();
    populateModelSelect();
    // Reuse the just-fetched snapshot to repaint the micro-judge selects and
    // the toolbar cache — avoids two extra IPC roundtrips for the same data.
    if (typeof populateRoleModelSelects === 'function') {
      void populateRoleModelSelects(_modelStatusCache);
    }
    if (typeof setToolbarModelStatusCache === 'function') {
      setToolbarModelStatusCache(_modelStatusCache);
    }
  } catch {
    // Silent fail — dots will remain neutral. Log visible via devtools.
  }
}

modelSelect.addEventListener('change', async () => {
  // Split on first colon only (model IDs should not contain colons, but be safe)
  const sepIdx = modelSelect.value.indexOf(':');
  const sdkProvider = modelSelect.value.slice(0, sepIdx);
  const modelId = modelSelect.value.slice(sepIdx + 1);
  localStorage.setItem('bottega:provider', sdkProvider);
  localStorage.setItem('bottega:model', modelId);

  // B-004: Sync toolbar model label immediately
  syncBarModelLabel();

  if (!activeTabId) return;
  const result = await window.api.switchModel(activeTabId, { provider: sdkProvider, modelId });
  if (!result.success) {
    keyStatus.textContent = result.error || 'Failed to switch';
    keyStatus.className = 'key-status error';
  }
  updateContextBar(0);
});

// ── Init auth UI ─────────────────────────

// Sync model label on init (runs after initAuthUI populates availableModels)
function syncBarModelLabel() {
  const sdkProvider = localStorage.getItem('bottega:provider') || 'anthropic';
  const modelId = localStorage.getItem('bottega:model') || 'claude-sonnet-4-6';
  const allModels = Object.values(availableModels).flat();
  const match = allModels.find((m) => m.sdkProvider === sdkProvider && m.id === modelId);
  if (match) barModelLabel.textContent = match.label.replace(/ \(.*\)/, '');
}

async function initAuthUI() {
  // Restore persisted Google Cloud Project ID for Workspace accounts
  const savedGoogleProject = localStorage.getItem('bottega:google-project');
  if (savedGoogleProject) await window.api.setGoogleProject(savedGoogleProject);

  availableModels = await window.api.getModels();
  populateModelSelect();
  await renderAccountCards();

  // Sync bar label now that models are loaded
  syncBarModelLabel();

  // F9: fetch status cache + repopulate with dots. Fire-and-forget — dots
  // render late but don't block initial load.
  refreshModelStatus();

  // B-025: Do NOT force-switch the active tab to the global localStorage model on
  // startup. The slot's persisted modelConfig is the source of truth — overwriting
  // it from the global "last-used" value in localStorage would wipe per-tab model
  // selection on every restart. syncBarToTab() already reconciles the dropdown /
  // bar label to the active tab's actual modelConfig when the tab becomes active.
}

initAuthUI();

// ── Image Generation settings ─────────────

const imagegenKeyInput = document.getElementById('imagegen-key-input');
const imagegenSaveKeyBtn = document.getElementById('imagegen-save-key-btn');
const imagegenTestKeyBtn = document.getElementById('imagegen-test-key-btn');
const imagegenResetKeyBtn = document.getElementById('imagegen-reset-key-btn');
const imagegenKeyStatus = document.getElementById('imagegen-key-status');
const imagegenModelSelect = document.getElementById('imagegen-model-select');

function updateImageGenKeyUI(hasApiKey) {
  if (hasApiKey) {
    imagegenKeyStatus.textContent = 'API key active';
    imagegenKeyStatus.className = 'key-status success';
    imagegenKeyInput.placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    imagegenResetKeyBtn.classList.remove('hidden');
  } else {
    imagegenKeyStatus.textContent = 'Not connected';
    imagegenKeyStatus.className = 'key-status error';
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

  updateImageGenKeyUI(config.hasApiKey);
}

imagegenSaveKeyBtn.addEventListener('click', async () => {
  const key = imagegenKeyInput.value.trim();
  if (!key) return;

  imagegenSaveKeyBtn.disabled = true;
  const original = imagegenSaveKeyBtn.textContent;
  imagegenSaveKeyBtn.textContent = 'Validating\u2026';
  // Validate against Gemini before persisting — protects against typos and
  // expired/invalid keys silently saved to disk.
  const test = await window.api.testImageGenKey(key).catch((err) => ({ success: false, error: String(err) }));
  if (!test?.success) {
    imagegenKeyStatus.textContent = `\u2717 ${test?.error ?? 'Invalid API key'}`;
    imagegenKeyStatus.className = 'key-status error';
    imagegenSaveKeyBtn.textContent = original;
    imagegenSaveKeyBtn.disabled = false;
    return;
  }
  await window.api.setImageGenConfig({ apiKey: key });
  imagegenSaveKeyBtn.textContent = original;
  imagegenSaveKeyBtn.disabled = false;
  imagegenKeyInput.value = '';

  // Re-fetch full config so hasDefaultKey stays accurate.
  const refreshed = await window.api.getImageGenConfig();
  updateImageGenKeyUI(refreshed.hasApiKey);
});

imagegenResetKeyBtn.addEventListener('click', async () => {
  imagegenResetKeyBtn.disabled = true;
  await window.api.setImageGenConfig({ apiKey: '' });
  imagegenResetKeyBtn.disabled = false;
  imagegenKeyInput.value = '';
  const refreshed = await window.api.getImageGenConfig();
  updateImageGenKeyUI(refreshed.hasApiKey);
});

imagegenModelSelect.addEventListener('change', async () => {
  await window.api.setImageGenConfig({ model: imagegenModelSelect.value });
});

if (imagegenTestKeyBtn) {
  imagegenTestKeyBtn.addEventListener('click', async () => {
    imagegenTestKeyBtn.disabled = true;
    const original = imagegenTestKeyBtn.textContent;
    imagegenTestKeyBtn.textContent = 'Testing\u2026';
    try {
      const res = await window.api.testImageGenKey();
      if (res?.success) {
        imagegenKeyStatus.textContent = '\u2713 API key valid';
        imagegenKeyStatus.className = 'key-status success';
      } else {
        imagegenKeyStatus.textContent = `\u2717 ${res?.error ?? 'Test failed'}`;
        imagegenKeyStatus.className = 'key-status error';
      }
    } catch (err) {
      imagegenKeyStatus.textContent = `\u2717 ${String(err)}`;
      imagegenKeyStatus.className = 'key-status error';
    } finally {
      imagegenTestKeyBtn.textContent = original;
      imagegenTestKeyBtn.disabled = false;
    }
  });
}

initImageGenUI();

// ── Figma REST API (Personal Access Token) ─────────────

const figmaPatInput = document.getElementById('figma-pat-input');
const figmaPatSaveBtn = document.getElementById('figma-pat-save-btn');
const figmaPatTestBtn = document.getElementById('figma-pat-test-btn');
const figmaPatClearBtn = document.getElementById('figma-pat-clear-btn');
const figmaPatStatus = document.getElementById('figma-pat-status');
const figmaPatDocsLink = document.getElementById('figma-pat-docs-link');

function setFigmaPatStatus(text, variant) {
  figmaPatStatus.textContent = text || '';
  figmaPatStatus.className = 'key-status' + (variant ? ' ' + variant : '');
}

/** Map technical error strings from the main process to user-friendly UI copy. */
function friendlyFigmaAuthError(result) {
  if (!result) return 'Failed to save';
  if (result.status === 401 || result.status === 403) {
    return 'Invalid token — check that it has the required read scopes';
  }
  const err = result.error || '';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(err)) {
    return 'Network unreachable — check your connection';
  }
  if (/abort|timed out|timeout/i.test(err)) {
    return 'Figma API timed out — retry in a moment';
  }
  return err || 'Failed to save';
}

// Single source of truth for the "connected" / "disconnected" DOM state.
// Previously duplicated between refreshFigmaAuthStatus and the save handler.
const FIGMA_PAT_MASKED_PLACEHOLDER = '••••••••  (token saved)';
const FIGMA_PAT_EMPTY_PLACEHOLDER = 'figd_...';

function applyFigmaConnectedUI(userHandle) {
  const who = userHandle ? `Connected as ${userHandle}` : 'Connected';
  setFigmaPatStatus(who, 'success');
  figmaPatClearBtn.classList.remove('hidden');
  figmaPatInput.placeholder = FIGMA_PAT_MASKED_PLACEHOLDER;
}

function applyFigmaDisconnectedUI(message) {
  setFigmaPatStatus(message ?? 'Not connected', 'error');
  figmaPatClearBtn.classList.add('hidden');
  figmaPatInput.placeholder = FIGMA_PAT_EMPTY_PLACEHOLDER;
}

async function refreshFigmaAuthStatus() {
  try {
    const status = await window.api.getFigmaAuthStatus();
    if (status?.connected) {
      applyFigmaConnectedUI(status.userHandle);
    } else {
      applyFigmaDisconnectedUI();
    }
  } catch (_err) {
    setFigmaPatStatus('Failed to read status', 'error');
  }
}

figmaPatSaveBtn.addEventListener('click', async () => {
  const token = figmaPatInput.value.trim();
  if (!token) {
    setFigmaPatStatus('Paste a token first', 'error');
    return;
  }
  figmaPatSaveBtn.disabled = true;
  setFigmaPatStatus('Validating…', '');
  try {
    const result = await window.api.setFigmaToken(token);
    if (result?.success) {
      figmaPatInput.value = '';
      applyFigmaConnectedUI(result.userHandle);
    } else {
      setFigmaPatStatus(friendlyFigmaAuthError(result), 'error');
    }
  } catch (err) {
    setFigmaPatStatus(err?.message || 'Unexpected error', 'error');
  } finally {
    figmaPatSaveBtn.disabled = false;
  }
});

figmaPatClearBtn.addEventListener('click', async () => {
  figmaPatClearBtn.disabled = true;
  try {
    await window.api.clearFigmaToken();
    await refreshFigmaAuthStatus();
  } finally {
    figmaPatClearBtn.disabled = false;
  }
});

figmaPatDocsLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openFigmaPatDocs();
});

if (figmaPatTestBtn) {
  figmaPatTestBtn.addEventListener('click', async () => {
    figmaPatTestBtn.disabled = true;
    const original = figmaPatTestBtn.textContent;
    figmaPatTestBtn.textContent = 'Testing\u2026';
    try {
      const res = await window.api.testFigmaToken();
      if (res?.success) {
        const who = res.userHandle ? `Connected as ${res.userHandle}` : '\u2713 Token valid';
        setFigmaPatStatus(who, 'success');
      } else {
        setFigmaPatStatus(`\u2717 ${res?.error ?? 'Test failed'}`, 'error');
      }
    } catch (err) {
      setFigmaPatStatus(`\u2717 ${String(err)}`, 'error');
    } finally {
      figmaPatTestBtn.textContent = original;
      figmaPatTestBtn.disabled = false;
    }
  });
}

if (window.api.onFigmaAuthStatusChanged) {
  window.api.onFigmaAuthStatusChanged(() => refreshFigmaAuthStatus());
}

refreshFigmaAuthStatus();

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
const figmaPluginResult = document.getElementById('figma-plugin-result');
const figmaMsgAuto = document.getElementById('figma-msg-auto');
const figmaMsgRunning = document.getElementById('figma-msg-running');
const figmaMsgManual = document.getElementById('figma-msg-manual');
const figmaPluginSteps = document.getElementById('figma-plugin-steps');

function showPluginResult(variant) {
  if (figmaPluginResult) figmaPluginResult.classList.remove('hidden');
  if (figmaMsgAuto) figmaMsgAuto.classList.toggle('hidden', variant !== 'auto');
  if (figmaMsgRunning) figmaMsgRunning.classList.toggle('hidden', variant !== 'running');
  if (figmaMsgManual) figmaMsgManual.classList.toggle('hidden', variant !== 'manual');
  if (figmaPluginSteps) figmaPluginSteps.classList.toggle('hidden', variant === 'auto');
}

if (setupFigmaBtn) {
  setupFigmaBtn.addEventListener('click', async () => {
    setupFigmaBtn.disabled = true;
    setupFigmaBtn.textContent = 'Installing\u2026';
    setupFigmaStatus.textContent = '';
    if (figmaPluginResult) figmaPluginResult.classList.add('hidden');
    try {
      const result = await window.api.installFigmaPlugin();
      if (result.success) {
        setupFigmaBtn.textContent = 'Reinstall Figma Plugin';
        if (result.autoRegistered || result.alreadyRegistered) {
          showPluginResult('auto');
        } else if (result.figmaRunning) {
          showPluginResult('running');
        } else {
          showPluginResult('manual');
        }
      } else {
        setupFigmaStatus.textContent = result.error || 'Setup failed.';
        setupFigmaBtn.textContent = 'Install Figma Plugin';
        if (figmaPluginResult) figmaPluginResult.classList.add('hidden');
      }
    } catch {
      setupFigmaStatus.textContent = 'Setup failed \u2014 see logs.';
      setupFigmaBtn.textContent = 'Install Figma Plugin';
      if (figmaPluginResult) figmaPluginResult.classList.add('hidden');
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

// ── Support Code ───────────────────────

const supportCodeValue = document.getElementById('support-code-value');
const copySupportCodeBtn = document.getElementById('copy-support-code-btn');

if (supportCodeValue) {
  window.api
    .getSupportCode()
    .then((code) => {
      supportCodeValue.textContent = code;
    })
    .catch(() => {
      supportCodeValue.textContent = '---';
    });
}

if (copySupportCodeBtn) {
  copySupportCodeBtn.addEventListener('click', async () => {
    const code = supportCodeValue?.textContent;
    if (code && code !== '---') {
      await navigator.clipboard.writeText(code);
      copySupportCodeBtn.textContent = '\u2713';
      setTimeout(() => {
        copySupportCodeBtn.textContent = '\u2398';
      }, 1500);
    }
  });
}

// ── Diagnostics ─────────────────────────

const exportLogsBtn = document.getElementById('export-logs-btn');
const copySysinfoBtn = document.getElementById('copy-sysinfo-btn');
const diagnosticsExportStatus = document.getElementById('diagnostics-export-status');

// F15: Recent errors panel wiring.
const recentErrorsBtn = document.getElementById('show-recent-errors-btn');
const recentErrorsPanel = document.getElementById('recent-errors-panel');
const recentErrorsList = document.getElementById('recent-errors-list');
const recentErrorsRefresh = document.getElementById('recent-errors-refresh');
const recentErrorsCopy = document.getElementById('recent-errors-copy');
const recentErrorsClose = document.getElementById('recent-errors-close');
let _recentErrorsCache = [];

async function loadRecentErrors() {
  if (typeof window.api.getRecentErrors !== 'function') return;
  _recentErrorsCache = await window.api.getRecentErrors();
  renderRecentErrors();
}

function renderRecentErrors() {
  if (!recentErrorsList) return;
  while (recentErrorsList.firstChild) recentErrorsList.removeChild(recentErrorsList.firstChild);
  if (_recentErrorsCache.length === 0) {
    const li = document.createElement('li');
    li.className = 'recent-errors-empty';
    li.textContent = 'No recent errors recorded.';
    recentErrorsList.appendChild(li);
    return;
  }
  for (const rec of _recentErrorsCache.slice().reverse()) {
    const li = document.createElement('li');
    const ts = new Date(rec.ts).toLocaleTimeString();
    const status = rec.httpStatus ?? rec.reason ?? '—';
    li.textContent = `${ts} · ${rec.provider}/${rec.modelId} · ${status} · ${rec.message}`;
    recentErrorsList.appendChild(li);
  }
}

if (recentErrorsBtn) {
  recentErrorsBtn.addEventListener('click', async () => {
    if (!recentErrorsPanel) return;
    const visible = recentErrorsPanel.style.display !== 'none';
    if (visible) {
      recentErrorsPanel.style.display = 'none';
      return;
    }
    await loadRecentErrors();
    recentErrorsPanel.style.display = 'block';
  });
}
recentErrorsRefresh?.addEventListener('click', () => loadRecentErrors());
recentErrorsCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(_recentErrorsCache, null, 2));
    recentErrorsCopy.textContent = '✓';
    setTimeout(() => {
      recentErrorsCopy.textContent = '⎘';
    }, 1500);
  } catch {
    // silent
  }
});
recentErrorsClose?.addEventListener('click', () => {
  if (recentErrorsPanel) recentErrorsPanel.style.display = 'none';
});
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

// ── Guardrails (safety rails) toggle ──
const guardrailsToggle = document.getElementById('guardrails-enabled-toggle');
if (guardrailsToggle && window.api?.getGuardrailsSettings) {
  window.api
    .getGuardrailsSettings()
    .then((settings) => {
      guardrailsToggle.checked = settings?.enabled !== false;
    })
    .catch(() => {});
  guardrailsToggle.addEventListener('change', async () => {
    const prev = !guardrailsToggle.checked;
    try {
      await window.api.setGuardrailsSettings({ enabled: guardrailsToggle.checked });
    } catch {
      guardrailsToggle.checked = prev;
    }
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

// ── Reset actions ────────────────────────

const resetAuthBtn = document.getElementById('reset-auth-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const factoryResetBtn = document.getElementById('factory-reset-btn');

async function handleResetClick(button, op, onSuccess) {
  if (!button) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Working…';
  try {
    const result = await op();
    if (result?.cancelled) {
      button.textContent = original;
    } else if (result?.ok) {
      button.textContent = 'Done';
      onSuccess?.();
      setTimeout(() => {
        button.textContent = original;
      }, 2000);
    } else {
      button.textContent = 'Failed';
      setTimeout(() => {
        button.textContent = original;
      }, 2000);
    }
  } catch {
    button.textContent = 'Error';
    setTimeout(() => {
      button.textContent = original;
    }, 2000);
  } finally {
    button.disabled = false;
  }
}

if (resetAuthBtn) {
  resetAuthBtn.addEventListener('click', () => {
    handleResetClick(
      resetAuthBtn,
      () => window.api.resetAuth(),
      () => {
        // Refresh account cards to reflect cleared auth.
        if (typeof renderAccountCards === 'function') renderAccountCards();
      },
    );
  });
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', () => {
    handleResetClick(clearHistoryBtn, () => window.api.clearHistory());
  });
}

if (factoryResetBtn) {
  factoryResetBtn.addEventListener('click', () => {
    // Main process quits + relaunches; no client-side work needed after confirm.
    handleResetClick(factoryResetBtn, () => window.api.factoryReset());
  });
}
