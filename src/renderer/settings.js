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
