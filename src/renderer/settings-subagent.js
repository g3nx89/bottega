// ── Subagent settings ────────────────────

const autoRetryToggle = document.getElementById('auto-retry-toggle');
const maxRetriesInput = document.getElementById('max-retries-input');
const maxRetriesRow = document.getElementById('max-retries-row');
const microJudgeContainer = document.getElementById('micro-judge-list');

function updateMaxRetriesVisibility() {
  if (maxRetriesRow && autoRetryToggle) {
    maxRetriesRow.style.display = autoRetryToggle.checked ? '' : 'none';
  }
}

async function loadSubagentSettings() {
  try {
    const config = await window.api.getSubagentConfig();
    if (autoRetryToggle) autoRetryToggle.checked = config.autoRetry || false;
    if (maxRetriesInput) maxRetriesInput.value = config.maxRetries || 2;
    updateMaxRetriesVisibility();
    if (config.microJudges && microJudgeContainer) {
      for (const row of microJudgeContainer.querySelectorAll('.micro-judge-row')) {
        const judgeId = row.dataset.judge;
        const mc = config.microJudges[judgeId];
        if (!mc) continue;
        const checkbox = row.querySelector('.judge-enable');
        const modelSelect = row.querySelector('.judge-model');
        if (checkbox) checkbox.checked = mc.enabled;
        if (modelSelect && mc.model) modelSelect.value = `${mc.model.provider}:${mc.model.modelId}`;
      }
    }
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: renderer has no structured logger
    console.warn('Failed to load subagent config:', err);
  }
}

async function saveSubagentSettings() {
  try {
    // Preserve server-persisted fields not bound to this UI (role models,
    // judgeMode) so dropped keys don't silently delete them on disk.
    const current = await window.api.getSubagentConfig();
    const models = { ...(current.models || {}) };
    const microJudges = { ...(current.microJudges || {}) };
    if (microJudgeContainer) {
      for (const row of microJudgeContainer.querySelectorAll('.micro-judge-row')) {
        const judgeId = row.dataset.judge;
        if (!judgeId) continue;
        const checkbox = row.querySelector('.judge-enable');
        const modelSelect = row.querySelector('.judge-model');
        const existing = microJudges[judgeId] || {};
        microJudges[judgeId] = {
          enabled: checkbox ? checkbox.checked : true,
          model: existing.model || { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
        };
        if (modelSelect?.value) {
          const [provider, modelId] = modelSelect.value.split(':');
          if (provider && modelId) microJudges[judgeId].model = { provider, modelId };
        }
      }
    }
    await window.api.setSubagentConfig({
      ...current,
      models,
      judgeMode: current.judgeMode || 'auto',
      autoRetry: autoRetryToggle?.checked || false,
      maxRetries: Number.parseInt(maxRetriesInput?.value || '2', 10),
      microJudges,
    });
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: renderer has no structured logger
    console.warn('Failed to save subagent config:', err);
  }
}

/** Populates every micro-judge model dropdown plus the bulk-apply select.
 *  presetStatusMap lets callers reuse a model-status snapshot they already fetched. */
async function populateRoleModelSelects(presetStatusMap) {
  try {
    const fetchStatus = () =>
      typeof window.api.getModelStatus === 'function' ? window.api.getModelStatus() : Promise.resolve({});
    const [modelsData, statusMap] = await Promise.all([window.api.getModels(), presetStatusMap ?? fetchStatus()]);
    const fillSelect = (select) => {
      const previousValue = select.value;
      clearChildren(select);
      for (const models of Object.values(modelsData)) {
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = `${m.sdkProvider}:${m.id}`;
          const status = statusMap[m.id] ?? 'unknown';
          opt.textContent = `${modelStatusDotEmoji(status)} ${m.label}`;
          select.appendChild(opt);
        }
      }
      if (previousValue) select.value = previousValue;
    };
    if (microJudgeContainer) {
      for (const select of microJudgeContainer.querySelectorAll('.judge-model')) fillSelect(select);
    }
    const bulkSelect = document.getElementById('judge-bulk-model');
    if (bulkSelect) fillSelect(bulkSelect);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: renderer has no structured logger
    console.warn('Failed to populate judge model selects:', err);
  }
}

populateRoleModelSelects().then(() => loadSubagentSettings());
if (autoRetryToggle) {
  autoRetryToggle.addEventListener('change', () => {
    updateMaxRetriesVisibility();
    saveSubagentSettings();
  });
}
if (maxRetriesInput) {
  maxRetriesInput.addEventListener('change', saveSubagentSettings);
}
// Micro-judge change listeners
if (microJudgeContainer) {
  for (const row of microJudgeContainer.querySelectorAll('.micro-judge-row')) {
    const checkbox = row.querySelector('.judge-enable');
    const modelSelect = row.querySelector('.judge-model');
    if (checkbox) checkbox.addEventListener('change', saveSubagentSettings);
    if (modelSelect) modelSelect.addEventListener('change', saveSubagentSettings);
  }
}

// Bulk model applier: writes the chosen model into every per-judge select
// and triggers a single save — avoids 8 manual dropdown changes for the
// common case of "use one model everywhere".
const bulkApplyBtn = document.getElementById('judge-bulk-apply');
const bulkModelSelect = document.getElementById('judge-bulk-model');
if (bulkApplyBtn && bulkModelSelect && microJudgeContainer) {
  bulkApplyBtn.addEventListener('click', async () => {
    const value = bulkModelSelect.value;
    if (!value) return;
    for (const select of microJudgeContainer.querySelectorAll('.judge-model')) {
      if (select.value !== value) select.value = value;
    }
    await saveSubagentSettings();
    const original = bulkApplyBtn.textContent;
    bulkApplyBtn.textContent = 'Applied \u2713';
    bulkApplyBtn.disabled = true;
    setTimeout(() => {
      bulkApplyBtn.textContent = original;
      bulkApplyBtn.disabled = false;
    }, 1500);
  });
}
