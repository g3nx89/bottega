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
