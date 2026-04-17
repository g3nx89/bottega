// ── Task panel ────────────────────────────
window.api.onTaskUpdated((slotId, tasks) => {
  withTab(slotId, (tab) => {
    tab._tasks = tasks;
    // Only update the visible panel if this is the active tab
    if (slotId === activeTabId) renderTaskPanel(tab);
  });
});

function renderTaskPanel(tab) {
  const panel = document.getElementById('task-panel');
  const tasks = tab._tasks || [];
  clearChildren(panel);

  if (tasks.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  const judgeTasks = [];
  const regularTasks = [];
  const taskById = new Map();
  let completed = 0;
  for (const t of tasks) {
    taskById.set(t.id, t);
    if (t.status === 'completed') completed++;
    if (t.metadata?.source === 'judge') judgeTasks.push(t);
    else regularTasks.push(t);
  }

  const header = document.createElement('div');
  header.className = 'task-header';
  header.textContent = `${tasks.length} tasks (${completed}/${tasks.length} done)`;
  panel.appendChild(header);

  const progressOuter = document.createElement('div');
  progressOuter.className = 'task-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'task-progress-fill';
  progressInner.style.width = `${(completed / tasks.length) * 100}%`;
  progressOuter.appendChild(progressInner);
  panel.appendChild(progressOuter);

  // Render regular tasks individually
  for (const t of regularTasks) {
    panel.appendChild(createTaskRow(t, taskById));
  }

  // Render judge tasks as a single collapsed group
  if (judgeTasks.length > 0) {
    let judgeCompleted = 0;
    let judgeInProgress = false;
    for (const t of judgeTasks) {
      if (t.status === 'completed') judgeCompleted++;
      else if (t.status === 'in_progress') judgeInProgress = true;
    }
    const groupStatus =
      judgeCompleted === judgeTasks.length ? 'completed' : judgeInProgress ? 'in_progress' : 'pending';

    const group = document.createElement('div');
    group.className = `task-row task-group ${groupStatus}`;

    const dot = document.createElement('span');
    dot.className = 'task-dot';
    if (groupStatus === 'completed') dot.textContent = '\u2714';
    else if (groupStatus === 'pending') dot.textContent = '\u25FB';

    const subject = document.createElement('span');
    subject.className = 'task-subject';
    subject.textContent = `Quality check (${judgeCompleted}/${judgeTasks.length} items)`;

    const toggle = document.createElement('button');
    toggle.className = 'task-group-toggle';
    toggle.textContent = '\u25B6';
    toggle.title = 'Expand';

    const details = document.createElement('div');
    details.className = 'task-group-details hidden';
    for (const t of judgeTasks) {
      details.appendChild(createTaskRow(t, taskById));
    }

    toggle.addEventListener('click', () => {
      const expanded = !details.classList.contains('hidden');
      details.classList.toggle('hidden');
      toggle.textContent = expanded ? '\u25B6' : '\u25BC';
      toggle.title = expanded ? 'Expand' : 'Collapse';
    });

    group.appendChild(dot);
    group.appendChild(subject);
    group.appendChild(toggle);
    panel.appendChild(group);
    panel.appendChild(details);
  }
}

function createTaskRow(t, taskById) {
  const row = document.createElement('div');
  row.className = `task-row ${t.status}`;

  const dot = document.createElement('span');
  dot.className = 'task-dot';
  if (t.status === 'completed') dot.textContent = '\u2714';
  else if (t.status === 'pending') dot.textContent = '\u25FB';

  const subject = document.createElement('span');
  subject.className = 'task-subject';
  subject.textContent = `#${t.id} ${t.status === 'in_progress' && t.activeForm ? t.activeForm + '\u2026' : t.subject}`;

  row.appendChild(dot);
  row.appendChild(subject);

  const openBlockers = (t.blockedBy || []).filter((bid) => {
    const b = taskById.get(bid);
    return b && b.status !== 'completed';
  });
  if (openBlockers.length > 0) {
    const blocker = document.createElement('span');
    blocker.className = 'task-blocker';
    blocker.textContent = `blocked by ${openBlockers.map((b) => '#' + b).join(', ')}`;
    row.appendChild(blocker);
  }

  return row;
}
