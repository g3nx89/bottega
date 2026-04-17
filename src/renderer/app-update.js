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
