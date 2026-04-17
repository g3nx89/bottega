// ── Subagent batch & judge verdict cards ───

function updateBatchRow(tab, data) {
  const card = tab._activeBatchCard;
  if (!card) return;
  const body = card.querySelector('.batch-body');

  let row = body.querySelector(`[data-subagent-id="${data.subagentId}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'batch-row';
    row.dataset.subagentId = data.subagentId || '';
    row.dataset.role = data.role || '';

    const dot = document.createElement('span');
    dot.className = 'batch-dot';
    const role = document.createElement('span');
    role.className = 'batch-role';
    role.textContent = data.role || '';
    const status = document.createElement('span');
    status.className = 'batch-status';
    status.textContent = 'Running...';
    const dur = document.createElement('span');
    dur.className = 'batch-duration';

    row.appendChild(dot);
    row.appendChild(role);
    row.appendChild(status);
    row.appendChild(dur);
    body.appendChild(row);
  }

  const statusEl = row.querySelector('.batch-status');
  const dotEl = row.querySelector('.batch-dot');

  if (data.type === 'tool-start') {
    statusEl.textContent = data.toolName || 'Running...';
  } else if (data.type === 'completed') {
    row.classList.add('completed');
    dotEl.textContent = '\u2713';
    statusEl.textContent = data.summary || 'Done';
  } else if (data.type === 'error') {
    row.classList.add('error');
    dotEl.textContent = '\u2717';
    statusEl.textContent = data.summary || 'Error';
  }
}

function createJudgeVerdictCard(tab, verdict, attempt, maxAttempts) {
  // Remove "running" indicator if present
  clearJudgeIndicator(tab);
  if (!tab.currentAssistantBubble) tab.currentAssistantBubble = createAssistantBubble(tab);
  const card = document.createElement('div');
  card.className = 'judge-verdict-card';
  card.dataset.verdict = verdict.verdict;

  const header = document.createElement('div');
  header.className = 'verdict-header';
  header.textContent =
    verdict.verdict === 'PASS' ? 'Quality Check \u00B7 PASS \u2713' : 'Quality Check \u00B7 Suggestions';
  card.appendChild(header);

  const criteria = document.createElement('div');
  criteria.className = 'verdict-criteria';
  for (const c of verdict.criteria || []) {
    const item = document.createElement('div');
    item.className = 'criterion ' + (c.pass ? 'pass' : 'fail');
    item.textContent = (c.pass ? '\u2713 ' : '\u2717 ') + c.name + (c.finding ? ' \u2014 ' + c.finding : '');
    criteria.appendChild(item);
  }
  card.appendChild(criteria);

  if (verdict.verdict === 'FAIL' && verdict.actionItems?.length) {
    const actions = document.createElement('div');
    actions.className = 'verdict-actions';
    const ol = document.createElement('ol');
    for (const item of verdict.actionItems) {
      const li = document.createElement('li');
      li.textContent = item;
      ol.appendChild(li);
    }
    actions.appendChild(ol);
    card.appendChild(actions);
  }

  const footer = document.createElement('div');
  footer.className = 'verdict-footer';
  if (attempt < maxAttempts && verdict.verdict === 'FAIL') {
    footer.textContent = `Attempt ${attempt}/${maxAttempts} \u00B7 Retrying...`;
  } else {
    footer.textContent = `Attempt ${attempt}/${maxAttempts}`;
  }
  // Re-judge button on final FAIL
  if (verdict.verdict === 'FAIL' && attempt >= maxAttempts) {
    const rejudgeBtn = document.createElement('button');
    rejudgeBtn.className = 'rejudge-btn';
    rejudgeBtn.textContent = '\uD83D\uDD04 Re-judge';
    rejudgeBtn.addEventListener('click', () => {
      if (tab.id) window.api.forceRerunJudge(tab.id);
    });
    footer.appendChild(rejudgeBtn);
  }
  card.appendChild(footer);

  // Append as sibling of .message-content so markdown rendering doesn't destroy it
  tab.currentAssistantBubble.appendChild(card);
  tab._lastJudgeCard = card;
}

window.api.onSubagentStatus((slotId, data) => withTab(slotId, (tab) => updateBatchRow(tab, data)));
// Live "quality check" signal now lives on the status strip in app.js. The
// verdict card below still records each attempt in message history; its
// retry-start event stays unhandled here because the previous verdict card
// already shows the FAIL result and overwriting its footer would erase the
// attempt number.
window.api.onJudgeVerdict((slotId, verdict, attempt, max) =>
  withTab(slotId, (tab) => createJudgeVerdictCard(tab, verdict, attempt, max)),
);
