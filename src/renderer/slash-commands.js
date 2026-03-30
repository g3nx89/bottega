// ── Slash commands ────────────────────────
// Source of truth for tool parameters: src/main/tools/image-gen.ts
//
// Depends on globals from app.js: clearChildren, autoResizeInput, inputField

const SLASH_COMMANDS = [
  {
    id: 'generate',
    label: 'Generate Image',
    desc: 'Create images from text descriptions with AI',
    template: 'Generate an image of ',
    help: 'Describe subject, style, mood, lighting, and composition in detail for best results.',
    advanced: [
      'Styles: photorealistic, watercolor, oil-painting, sketch, pixel-art, anime, vintage, modern, abstract, minimalist',
      'Variations: lighting, angle, color-palette, composition, mood, season, time-of-day',
      'Count: 1-8 for multiple variations',
      'Auto-apply: mention the Figma node to use as fill target',
      'Scale mode: FILL, FIT, CROP, TILE',
    ],
  },
  {
    id: 'edit',
    label: 'Edit Image',
    desc: 'Edit an existing image on a Figma node with AI',
    template: 'Edit the image: ',
    help: 'The target node must have an image fill. Describe changes clearly.',
    advanced: [
      'Examples: "remove the background", "change sky to sunset", "add snow on the mountains"',
      'The edited image is automatically re-applied to the same node',
      'Use figma_screenshot after to verify the result',
    ],
  },
  {
    id: 'restore',
    label: 'Restore Image',
    desc: 'Enhance, upscale, or fix image quality',
    template: 'Restore the image: ',
    help: 'Works on any node with an image fill or exportable content.',
    advanced: [
      'Goals: "enhance quality", "remove noise", "sharpen details", "fix compression artifacts"',
      'Good for upscaling low-resolution images',
      'Result is automatically re-applied to the same node',
    ],
  },
  {
    id: 'icon',
    label: 'Generate Icon',
    desc: 'Create app icons, favicons, and UI elements',
    template: 'Create an icon of ',
    help: 'Describe the icon subject clearly: "a mountain landscape", "a chat bubble".',
    advanced: [
      'Types: app-icon, favicon, ui-element',
      'Styles: flat, skeuomorphic, minimal, modern',
      'Background: transparent, white, black, or any color',
      'Corners: rounded (default) or sharp',
    ],
  },
  {
    id: 'pattern',
    label: 'Generate Pattern',
    desc: 'Create seamless patterns and textures',
    template: 'Create a seamless pattern of ',
    help: 'Describe the pattern motif: "geometric triangles", "floral watercolor", "tech circuit board".',
    advanced: [
      'Types: seamless (tileable), texture, wallpaper',
      'Styles: geometric, organic, abstract, floral, tech',
      'Density: sparse, medium, dense',
      'Colors: mono, duotone, colorful',
      'Use TILE scale mode for seamless repeating fills',
    ],
  },
  {
    id: 'story',
    label: 'Generate Story',
    desc: 'Create a sequence of related images',
    template: 'Create a visual story about ',
    help: 'Describe the complete narrative or process. Each step is generated with sequential context.',
    advanced: [
      'Types: story (narrative), process (step-by-step), tutorial, timeline',
      'Steps: 2-8 images in sequence',
      'Style: consistent (same look) or evolving (changing)',
      'Transitions: smooth, dramatic, fade',
      'Creates auto-layout frames in Figma',
    ],
  },
  {
    id: 'diagram',
    label: 'Generate Diagram',
    desc: 'Create flowcharts, architecture diagrams, wireframes',
    template: 'Create a diagram showing ',
    help: 'Describe diagram content and relationships. List components and connections for accuracy.',
    advanced: [
      'Types: flowchart, architecture, network, database, wireframe, mindmap, sequence',
      'Styles: professional, clean, hand-drawn, technical',
      'Layout: horizontal, vertical, hierarchical, circular',
      'Complexity: simple, detailed, comprehensive',
      'Colors: mono, accent, categorical',
    ],
  },
];

const slashMenuEl = document.getElementById('slash-menu');
const slashHelpEl = document.getElementById('slash-help');
let slashMenuOpen = false;
let slashSelectedIdx = 0;
let slashFiltered = [];
let slashLastFilter = null;

function handleSlashMenuKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    slashSelectedIdx = Math.min(slashSelectedIdx + 1, slashFiltered.length - 1);
    updateSlashSelection();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    slashSelectedIdx = Math.max(slashSelectedIdx - 1, 0);
    updateSlashSelection();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (slashFiltered[slashSelectedIdx]) selectSlashCommand(slashFiltered[slashSelectedIdx]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideSlashMenu();
    return true;
  }
  return false;
}

function showSlashMenu(filter) {
  if (filter === slashLastFilter) return;
  slashLastFilter = filter;

  const q = filter.toLowerCase();
  slashFiltered = q
    ? SLASH_COMMANDS.filter(
        (c) => c.id.includes(q) || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
      )
    : SLASH_COMMANDS.slice();

  if (slashFiltered.length === 0) {
    hideSlashMenu();
    return;
  }

  slashSelectedIdx = 0;
  renderSlashMenu();
  slashMenuEl.classList.remove('hidden');
  slashMenuOpen = true;
}

function renderSlashMenu() {
  clearChildren(slashMenuEl);

  slashFiltered.forEach((cmd, i) => {
    const item = document.createElement('button');
    item.className = 'slash-menu-item' + (i === slashSelectedIdx ? ' selected' : '');

    const header = document.createElement('div');
    header.className = 'slash-item-header';
    const cmdName = document.createElement('span');
    cmdName.className = 'slash-item-cmd';
    cmdName.textContent = '/' + cmd.id;
    const cmdLabel = document.createElement('span');
    cmdLabel.className = 'slash-item-label';
    cmdLabel.textContent = cmd.label;
    header.appendChild(cmdName);
    header.appendChild(cmdLabel);

    const desc = document.createElement('span');
    desc.className = 'slash-item-desc';
    desc.textContent = cmd.desc;

    item.appendChild(header);
    item.appendChild(desc);

    item.addEventListener('click', () => selectSlashCommand(cmd));
    item.addEventListener('mouseenter', () => {
      slashSelectedIdx = i;
      updateSlashSelection();
    });

    slashMenuEl.appendChild(item);
  });
}

function updateSlashSelection() {
  const items = slashMenuEl.querySelectorAll('.slash-menu-item');
  items.forEach((item, i) => item.classList.toggle('selected', i === slashSelectedIdx));
  const selected = slashMenuEl.querySelector('.slash-menu-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function hideSlashMenu() {
  slashMenuEl.classList.add('hidden');
  slashMenuOpen = false;
  slashFiltered = [];
  slashLastFilter = null;
}

function selectSlashCommand(cmd) {
  hideSlashMenu();
  inputField.value = cmd.template;
  autoResizeInput();
  inputField.focus();
  inputField.setSelectionRange(cmd.template.length, cmd.template.length);
  showSlashHelp(cmd);
}

function showSlashHelp(cmd) {
  clearChildren(slashHelpEl);

  const header = document.createElement('div');
  header.className = 'slash-help-header';
  const title = document.createElement('span');
  title.className = 'slash-help-title';
  title.textContent = cmd.label;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'slash-help-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', hideSlashHelp);
  header.appendChild(title);
  header.appendChild(closeBtn);
  slashHelpEl.appendChild(header);

  const usage = document.createElement('span');
  usage.className = 'slash-help-usage';
  usage.textContent = cmd.help;
  slashHelpEl.appendChild(usage);

  const section = document.createElement('span');
  section.className = 'slash-help-section';
  section.textContent = 'Advanced settings';
  slashHelpEl.appendChild(section);

  const tipsList = document.createElement('ul');
  tipsList.className = 'slash-help-tips';
  cmd.advanced.forEach((tip) => {
    const li = document.createElement('li');
    li.textContent = tip;
    tipsList.appendChild(li);
  });
  slashHelpEl.appendChild(tipsList);

  slashHelpEl.classList.remove('hidden');
}

function hideSlashHelp() {
  slashHelpEl.classList.add('hidden');
  clearChildren(slashHelpEl);
}
