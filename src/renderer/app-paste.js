// ── Paste screenshot support ─────────────

const pastePreview = document.getElementById('paste-preview');
const pastedImages = []; // Array of { dataUrl, blob }

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
