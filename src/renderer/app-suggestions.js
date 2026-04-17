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
      if (!tab?.id) return;
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
