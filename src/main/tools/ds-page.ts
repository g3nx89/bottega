import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export function createDsPageTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_update_ds_page',
      label: 'Update Design System Page',
      description:
        'Create or update the Design System documentation page in Figma. Manages sections: colors, typography, spacing, components, naming, rules. Actions: create (replace), update (replace content), append (add to existing). Creates visual samples for colors (swatches) and typography (type specimens).',
      promptSnippet:
        'figma_update_ds_page: maintain the DS documentation page. sections: colors, typography, spacing, components, naming, rules. actions: create/update/append',
      parameters: Type.Object({
        section: StringEnum(['colors', 'typography', 'spacing', 'components', 'naming', 'rules', 'effects'] as const, {
          description: 'Which DS section to update',
        }),
        action: StringEnum(['create', 'update', 'append'] as const, {
          description: 'create: replace entire section; update: replace content; append: add to existing',
        }),
        text: Type.String({ description: 'Text content for the section (markdown-like, plain text)' }),
        samples: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ description: 'Sample label (e.g. color name or type name)' }),
              value: Type.String({ description: 'Sample value (e.g. hex color, font size)' }),
            }),
          ),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const sectionTag = `[DS::${params.section}]`;
          const pluginCode = buildDsPagePluginCode(sectionTag, params.action, params.text, params.samples ?? []);
          const raw = await connector.executeCodeViaUI(pluginCode);
          let parsed: unknown;
          try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch {
            parsed = raw;
          }
          return textResult(parsed);
        });
      },
    },
  ];
}

function buildDsPagePluginCode(
  sectionTag: string,
  action: string,
  text: string,
  samples: Array<{ label: string; value: string }>,
): string {
  const escapedTag = JSON.stringify(sectionTag);
  const escapedAction = JSON.stringify(action);
  const escapedText = JSON.stringify(text);
  const escapedSamples = JSON.stringify(samples);

  return `return (async () => {
  const sectionTag = ${escapedTag};
  const action = ${escapedAction};
  const text = ${escapedText};
  const samples = ${escapedSamples};

  // Find or create "Design System" page
  await figma.loadAllPagesAsync();
  let dsPage = figma.root.children.find(p => p.name === 'Design System');
  if (!dsPage) {
    dsPage = figma.createPage();
    dsPage.name = 'Design System';
  }

  await figma.setCurrentPageAsync(dsPage);

  // Find or create section frame with tag
  let sectionFrame = dsPage.children.find(n => n.type === 'FRAME' && n.name.includes(sectionTag));
  if (!sectionFrame || action === 'create') {
    if (sectionFrame && action === 'create') {
      sectionFrame.remove();
    }
    sectionFrame = figma.createFrame();
    sectionFrame.name = sectionTag;
    sectionFrame.layoutMode = 'VERTICAL';
    sectionFrame.primaryAxisSizingMode = 'AUTO';
    sectionFrame.counterAxisSizingMode = 'FIXED';
    sectionFrame.resize(800, 100);
    sectionFrame.paddingTop = 24;
    sectionFrame.paddingBottom = 24;
    sectionFrame.paddingLeft = 24;
    sectionFrame.paddingRight = 24;
    sectionFrame.itemSpacing = 16;
    sectionFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

    // Position below existing sections
    const existingFrames = dsPage.children.filter(n => n.type === 'FRAME');
    const lastY = existingFrames.reduce((y, f) => Math.max(y, f.y + f.height), 0);
    sectionFrame.x = 0;
    sectionFrame.y = lastY + 32;
  }

  // Add/replace text content (and remove old Samples frames to avoid duplicates)
  if (action !== 'append') {
    for (let i = sectionFrame.children.length - 1; i >= 0; i--) {
      sectionFrame.children[i].remove();
    }
  }

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  const titleNode = figma.createText();
  titleNode.fontName = { family: 'Inter', style: 'Bold' };
  titleNode.fontSize = 18;
  titleNode.characters = sectionTag.replace('[DS::', '').replace(']', '').toUpperCase();
  sectionFrame.appendChild(titleNode);

  const contentNode = figma.createText();
  contentNode.fontName = { family: 'Inter', style: 'Regular' };
  contentNode.fontSize = 14;
  contentNode.characters = text;
  sectionFrame.appendChild(contentNode);

  // Create visual samples
  if (samples && samples.length > 0) {
    const samplesFrame = figma.createFrame();
    samplesFrame.name = 'Samples';
    samplesFrame.layoutMode = 'HORIZONTAL';
    samplesFrame.primaryAxisSizingMode = 'AUTO';
    samplesFrame.counterAxisSizingMode = 'AUTO';
    samplesFrame.itemSpacing = 12;
    samplesFrame.fills = [];

    for (const sample of samples) {
      const swatch = figma.createFrame();
      swatch.name = sample.label;
      swatch.layoutMode = 'VERTICAL';
      swatch.primaryAxisSizingMode = 'AUTO';
      swatch.counterAxisSizingMode = 'FIXED';
      swatch.resize(80, 80);
      swatch.itemSpacing = 4;

      // If value looks like a hex color, set fill (only accept 6-char hex to avoid NaN from shorthand)
      if (/^#[0-9a-fA-F]{6}$/.test(sample.value.trim())) {
        const hex = sample.value.trim().replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        swatch.fills = [{ type: 'SOLID', color: { r, g, b } }];
      }

      const labelNode = figma.createText();
      labelNode.fontName = { family: 'Inter', style: 'Regular' };
      labelNode.fontSize = 11;
      labelNode.characters = sample.label;
      swatch.appendChild(labelNode);

      samplesFrame.appendChild(swatch);
    }

    sectionFrame.appendChild(samplesFrame);
  }

  return JSON.stringify({ success: true, sectionId: sectionFrame.id, sectionName: sectionFrame.name });
})()`;
}
