import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ImageGenerator } from '../image-gen/image-generator.js';
import {
  buildBatchPrompts,
  buildDiagramPrompt,
  buildIconPrompt,
  buildPatternPrompt,
  buildStoryStepPrompt,
} from '../image-gen/prompt-builders.js';
import { getVisionMaxDimension } from './core.js';
import { type ToolDeps, textResult } from './index.js';

function requireImageGen(deps: ToolDeps): ImageGenerator {
  const gen = deps.getImageGenerator?.();
  if (!gen)
    throw new Error('Image generation not configured. Add a Gemini API key in Settings \u2192 Image Generation.');
  return gen;
}

/** Export a Figma node as base64 PNG via the existing captureScreenshot connector. */
async function exportNodeBase64(deps: ToolDeps, nodeId: string): Promise<string> {
  const maxDimension = getVisionMaxDimension(deps.getProvider?.() ?? '');
  const result = await deps.connector.captureScreenshot(nodeId, { format: 'PNG', maxDimension });
  const base64 = result?.image?.base64 ?? result?.imageData;
  if (!base64) throw new Error('Failed to export node image');
  return base64;
}

/** Shared logic for edit and restore tools: export node → AI edit → re-apply. */
async function editNodeImage(deps: ToolDeps, params: { prompt: string; nodeId: string }, hint: string) {
  const gen = requireImageGen(deps);
  const { connector, operationQueue } = deps;

  const sourceBase64 = await exportNodeBase64(deps, params.nodeId);

  const result = await gen.edit(params.prompt, sourceBase64);
  if (!result.success || result.images.length === 0) {
    return textResult({ success: false, error: result.error ?? 'No images generated' });
  }

  await operationQueue.execute(async () => {
    await connector.setImageFill([params.nodeId], result.images[0]!, 'FILL');
  });

  return textResult({ success: true, hint });
}

export function createImageGenTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    // ── figma_generate_image ──────────────────
    {
      name: 'figma_generate_image',
      label: 'Generate Image',
      description: `Generate images from text prompts using Gemini's Nano Banana models. Supports multiple artistic styles and variation types. Optionally applies the result directly as an image fill on Figma nodes.`,
      promptSnippet:
        'figma_generate_image: AI image generation with styles/variations, optional auto-apply to Figma nodes',
      promptGuidelines: [
        'Use for hero images, illustrations, photos, backgrounds, and any raster content.',
        'Provide detailed prompts: subject, style, mood, lighting, composition, camera angle.',
        'Use styles (photorealistic, watercolor, oil-painting, sketch, pixel-art, anime, vintage, modern, abstract, minimalist) for artistic control.',
        'Use variations (lighting, angle, color-palette, composition, mood, season, time-of-day) for creative exploration.',
        'Set nodeIds to auto-apply the first image as fill. Without nodeIds, the agent must use figma_set_image_fill manually.',
      ],
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          description:
            'Detailed image description. Include subject, style, mood, lighting, and composition for best results.',
        }),
        outputCount: Type.Optional(
          Type.Number({ description: 'Number of variations to generate (1-8, default: 1)', minimum: 1, maximum: 8 }),
        ),
        styles: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 5,
            description:
              'Artistic styles: photorealistic, watercolor, oil-painting, sketch, pixel-art, anime, vintage, modern, abstract, minimalist',
          }),
        ),
        variations: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 5,
            description: 'Variation types: lighting, angle, color-palette, composition, mood, season, time-of-day',
          }),
        ),
        nodeIds: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Figma node IDs to apply the generated image as fill (first image used)',
          }),
        ),
        scaleMode: Type.Optional(
          StringEnum(['FILL', 'FIT', 'CROP', 'TILE'] as const, {
            description: 'How the image fills the node (default: FILL)',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, signal, _onUpdate, _ctx) {
        const gen = requireImageGen(deps);
        const prompts = buildBatchPrompts(params.prompt, {
          styles: params.styles,
          variations: params.variations,
          outputCount: params.outputCount,
        });

        const result = await gen.generateBatch(prompts, signal);
        if (!result.success) return textResult({ success: false, error: result.error });

        if (params.nodeIds?.length && result.images.length > 0) {
          await operationQueue.execute(async () => {
            await connector.setImageFill(params.nodeIds, result.images[0]!, params.scaleMode ?? 'FILL');
          });
        }

        return textResult({
          success: true,
          imageCount: result.images.length,
          appliedToNodes: params.nodeIds || [],
          hint: params.nodeIds?.length
            ? 'Image applied to nodes. Use figma_screenshot to verify.'
            : 'Use figma_set_image_fill to apply images to nodes.',
        });
      },
    },

    // ── figma_edit_image ──────────────────────
    {
      name: 'figma_edit_image',
      label: 'Edit Image',
      description:
        'Edit an existing image in Figma using AI. Extracts the current image from a node, applies AI edits via text prompt, and re-applies the result to the same node.',
      promptSnippet: 'figma_edit_image: AI-edit an image on a Figma node (extract \u2192 edit \u2192 re-apply)',
      promptGuidelines: [
        'The source node must have an image fill or be exportable as PNG.',
        'Describe changes clearly: "remove the background", "change sky to sunset", "add snow on the mountains".',
        'The edited image is automatically re-applied to the same node.',
        'To revert an edit, use figma_restore_image on the same node — it can regenerate the original.',
      ],
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          description: 'Editing instructions. Describe what to change in the image.',
        }),
        nodeId: Type.String({ description: 'Figma node ID with an image to edit' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return editNodeImage(deps, params, 'Edited image applied. Use figma_screenshot to verify the result.');
      },
    },

    // ── figma_restore_image ──────────────────
    {
      name: 'figma_restore_image',
      label: 'Restore Image',
      description:
        'Restore or enhance an image in Figma using AI. Upscale, denoise, fix artifacts, or improve overall quality.',
      promptSnippet: 'figma_restore_image: AI-enhance/restore an image on a Figma node (upscale, denoise, fix)',
      promptGuidelines: [
        'Works on any node with an image fill or exportable content.',
        'Describe restoration goals: "enhance quality", "remove noise", "sharpen details", "fix compression artifacts".',
      ],
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          description: 'Restoration instructions: "enhance quality", "remove noise", "sharpen", "fix artifacts"',
        }),
        nodeId: Type.String({ description: 'Figma node ID with an image to restore' }),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return editNodeImage(deps, params, 'Restored image applied. Use figma_screenshot to verify.');
      },
    },

    // ── figma_generate_icon ──────────────────
    {
      name: 'figma_generate_icon',
      label: 'Generate Icon',
      description:
        'Generate app icons, favicons, and UI elements with AI. Supports different styles, backgrounds, and corner options.',
      promptSnippet: 'figma_generate_icon: AI-generate app icons, favicons, UI elements with style control',
      promptGuidelines: [
        'Describe the icon subject clearly: "a mountain landscape", "a chat bubble", "a shopping cart".',
        'Choose style (flat/skeuomorphic/minimal/modern) to match the app aesthetic.',
        'For app store icons, use type: app-icon with rounded corners.',
        'Set nodeId to auto-apply the icon as image fill on a Figma node.',
      ],
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          description: 'Icon description. Be specific about the subject and visual elements.',
        }),
        type: Type.Optional(
          StringEnum(['app-icon', 'favicon', 'ui-element'] as const, { description: 'Icon type (default: app-icon)' }),
        ),
        style: Type.Optional(
          StringEnum(['flat', 'skeuomorphic', 'minimal', 'modern'] as const, {
            description: 'Visual style (default: modern)',
          }),
        ),
        background: Type.Optional(
          Type.String({ description: 'Background: transparent, white, black, or a color name (default: transparent)' }),
        ),
        corners: Type.Optional(
          StringEnum(['rounded', 'sharp'] as const, { description: 'Corner style for app icons (default: rounded)' }),
        ),
        nodeId: Type.Optional(Type.String({ description: 'Figma node ID to apply the icon as fill' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const gen = requireImageGen(deps);
        const prompt = buildIconPrompt(params.prompt, {
          type: params.type,
          style: params.style,
          background: params.background,
          corners: params.corners,
        });

        const result = await gen.generate(prompt);
        if (!result.success || result.images.length === 0) {
          return textResult({ success: false, error: result.error ?? 'No images generated' });
        }

        if (params.nodeId) {
          await operationQueue.execute(async () => {
            await connector.setImageFill([params.nodeId], result.images[0]!, 'FILL');
          });
        }

        return textResult({
          success: true,
          appliedToNode: params.nodeId || null,
          hint: params.nodeId
            ? 'Icon applied. Use figma_screenshot to verify.'
            : 'Use figma_set_image_fill to place the icon on a node.',
        });
      },
    },

    // ── figma_generate_pattern ────────────────
    {
      name: 'figma_generate_pattern',
      label: 'Generate Pattern',
      description:
        'Generate seamless patterns and textures for backgrounds and design elements. Supports tiling for seamless repeat.',
      promptSnippet: 'figma_generate_pattern: AI-generate seamless patterns, textures, wallpapers for Figma fills',
      promptGuidelines: [
        'Describe the pattern: "geometric triangles", "floral watercolor", "tech circuit board".',
        'Use type: seamless for tileable backgrounds, texture for surfaces, wallpaper for full-bleed.',
        'Set nodeIds with scaleMode: TILE for seamless repeating fills.',
      ],
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, description: 'Pattern description' }),
        type: Type.Optional(
          StringEnum(['seamless', 'texture', 'wallpaper'] as const, {
            description: 'Pattern type (default: seamless)',
          }),
        ),
        style: Type.Optional(
          StringEnum(['geometric', 'organic', 'abstract', 'floral', 'tech'] as const, {
            description: 'Pattern style (default: abstract)',
          }),
        ),
        density: Type.Optional(
          StringEnum(['sparse', 'medium', 'dense'] as const, { description: 'Element density (default: medium)' }),
        ),
        colors: Type.Optional(
          StringEnum(['mono', 'duotone', 'colorful'] as const, { description: 'Color scheme (default: colorful)' }),
        ),
        size: Type.Optional(
          Type.String({ description: 'Tile dimensions, e.g. "256x256" or "512x512" (default: 256x256)' }),
        ),
        nodeIds: Type.Optional(
          Type.Array(Type.String(), { description: 'Figma node IDs to apply the pattern as fill' }),
        ),
        scaleMode: Type.Optional(
          StringEnum(['FILL', 'FIT', 'CROP', 'TILE'] as const, {
            description: 'Fill mode (default: TILE for seamless, FILL otherwise)',
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const gen = requireImageGen(deps);
        const prompt = buildPatternPrompt(params.prompt, {
          type: params.type,
          style: params.style,
          density: params.density,
          colors: params.colors,
          size: params.size,
        });

        const result = await gen.generate(prompt);
        if (!result.success || result.images.length === 0) {
          return textResult({ success: false, error: result.error ?? 'No images generated' });
        }

        if (params.nodeIds?.length) {
          const mode = params.scaleMode ?? (params.type === 'seamless' ? 'TILE' : 'FILL');
          await operationQueue.execute(async () => {
            await connector.setImageFill(params.nodeIds, result.images[0]!, mode);
          });
        }

        return textResult({
          success: true,
          appliedToNodes: params.nodeIds || [],
          hint: params.nodeIds?.length
            ? 'Pattern applied. Use figma_screenshot to verify.'
            : 'Use figma_set_image_fill with scaleMode: TILE for seamless patterns.',
        });
      },
    },

    // ── figma_generate_story ─────────────────
    {
      name: 'figma_generate_story',
      label: 'Generate Story',
      description:
        'Generate a sequence of related images telling a visual story or showing a process. Creates frames in Figma with each step applied as an image fill.',
      promptSnippet: 'figma_generate_story: AI-generate sequential image story/process/tutorial as Figma frames',
      promptGuidelines: [
        'Describe the complete narrative or process. Each step is generated with sequential context.',
        'Use type: story for narratives, process for step-by-step, tutorial for educational, timeline for chronological.',
        'Set parentId to create frames inside a specific Figma container.',
        'Creates a horizontal auto-layout container with one frame per step.',
      ],
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, description: 'Story or process description' }),
        steps: Type.Optional(Type.Number({ description: 'Number of steps (2-8, default: 4)', minimum: 2, maximum: 8 })),
        type: Type.Optional(
          StringEnum(['story', 'process', 'tutorial', 'timeline'] as const, {
            description: 'Sequence type (default: story)',
          }),
        ),
        style: Type.Optional(
          StringEnum(['consistent', 'evolving'] as const, { description: 'Visual consistency (default: consistent)' }),
        ),
        transition: Type.Optional(
          StringEnum(['smooth', 'dramatic', 'fade'] as const, {
            description: 'Transition style between steps (default: smooth)',
          }),
        ),
        parentId: Type.Optional(
          Type.String({ description: 'Parent Figma node ID to place the story container inside' }),
        ),
        frameWidth: Type.Optional(Type.Number({ description: 'Width of each story frame in px (default: 400)' })),
        frameHeight: Type.Optional(Type.Number({ description: 'Height of each story frame in px (default: 300)' })),
      }),
      async execute(_toolCallId, params: any, signal, _onUpdate, _ctx) {
        const gen = requireImageGen(deps);
        const numSteps = params.steps || 4;
        const type = params.type || 'story';
        const style = params.style || 'consistent';
        const transition = params.transition || 'smooth';
        const w = params.frameWidth || 400;
        const h = params.frameHeight || 300;

        // Generate images sequentially (each step depends on sequence context)
        const images: string[] = [];
        for (let i = 1; i <= numSteps; i++) {
          if (signal?.aborted) break;
          const stepPrompt = buildStoryStepPrompt(params.prompt, i, numSteps, { type, style, transition });
          const result = await gen.generate(stepPrompt);
          if (result.success && result.images.length > 0) {
            images.push(result.images[0]!);
          }
        }

        if (images.length === 0) {
          return textResult({ success: false, error: 'Failed to generate any story images' });
        }

        // Truncate prompt for container name
        const shortPrompt = params.prompt.length > 30 ? params.prompt.slice(0, 30) + '\u2026' : params.prompt;
        const containerName = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${shortPrompt}`;

        // Create frames in Figma
        // nosemgrep: missing-template-string-indicator — code generation: builds plugin code sent to Figma
        const createCode = `return (async () => {
          const parent = ${params.parentId ? `await figma.getNodeByIdAsync(${JSON.stringify(params.parentId)})` : 'figma.currentPage'}; // nosemgrep
          if (!parent) return JSON.stringify({ error: "Parent not found" });

          const container = figma.createFrame();
          container.name = ${JSON.stringify(containerName)};
          container.layoutMode = "HORIZONTAL";
          container.itemSpacing = 16;
          container.paddingTop = container.paddingBottom = container.paddingLeft = container.paddingRight = 0;
          container.primaryAxisSizingMode = "AUTO";
          container.counterAxisSizingMode = "AUTO";
          parent.appendChild(container);

          const frameIds = [];
          for (let i = 0; i < ${images.length}; i++) {
            const frame = figma.createFrame();
            frame.name = "Step " + (i + 1);
            frame.resize(${w}, ${h}); // nosemgrep
            container.appendChild(frame);
            frameIds.push(frame.id);
          }

          figma.viewport.scrollAndZoomIntoView([container]);
          return JSON.stringify({ containerId: container.id, frameIds });
        })()`;

        const createResult = await operationQueue.execute(async () => {
          return connector.executeCodeViaUI(createCode, 15000);
        });

        let parsed: any;
        try {
          parsed = typeof createResult === 'string' ? JSON.parse(createResult) : createResult;
        } catch {
          parsed = createResult;
        }
        if (parsed?.error) return textResult({ success: false, error: parsed.error });

        // Apply images to frames (single queue lock for all fills)
        if (parsed?.frameIds) {
          await operationQueue.execute(async () => {
            for (let i = 0; i < Math.min(images.length, parsed.frameIds.length); i++) {
              await connector.setImageFill([parsed.frameIds[i]!], images[i]!, 'FILL');
            }
          });
        }

        return textResult({
          success: true,
          stepsGenerated: images.length,
          stepsRequested: numSteps,
          containerId: parsed?.containerId,
          hint: 'Story frames created. Use figma_screenshot to verify.',
        });
      },
    },

    // ── figma_generate_diagram ────────────────
    {
      name: 'figma_generate_diagram',
      label: 'Generate Diagram',
      description: 'Generate technical diagrams, flowcharts, and architectural mockups using AI image generation.',
      promptSnippet:
        'figma_generate_diagram: AI-generate flowcharts, architecture diagrams, wireframes, network diagrams',
      promptGuidelines: [
        'Describe diagram content and relationships clearly.',
        'Choose appropriate type: flowchart, architecture, network, database, wireframe, mindmap, sequence.',
        'For technical accuracy, list specific components and their connections.',
      ],
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, description: 'Diagram description with components and relationships' }),
        type: Type.Optional(
          StringEnum(
            ['flowchart', 'architecture', 'network', 'database', 'wireframe', 'mindmap', 'sequence'] as const,
            { description: 'Diagram type (default: flowchart)' },
          ),
        ),
        style: Type.Optional(
          StringEnum(['professional', 'clean', 'hand-drawn', 'technical'] as const, {
            description: 'Visual style (default: professional)',
          }),
        ),
        layout: Type.Optional(
          StringEnum(['horizontal', 'vertical', 'hierarchical', 'circular'] as const, {
            description: 'Layout orientation (default: hierarchical)',
          }),
        ),
        complexity: Type.Optional(
          StringEnum(['simple', 'detailed', 'comprehensive'] as const, {
            description: 'Detail level (default: detailed)',
          }),
        ),
        colors: Type.Optional(
          StringEnum(['mono', 'accent', 'categorical'] as const, { description: 'Color scheme (default: accent)' }),
        ),
        annotations: Type.Optional(
          StringEnum(['minimal', 'detailed'] as const, { description: 'Annotation level (default: detailed)' }),
        ),
        nodeId: Type.Optional(Type.String({ description: 'Figma node ID to apply the diagram as fill' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const gen = requireImageGen(deps);
        const prompt = buildDiagramPrompt(params.prompt, {
          type: params.type,
          style: params.style,
          layout: params.layout,
          complexity: params.complexity,
          colors: params.colors,
          annotations: params.annotations,
        });

        const result = await gen.generate(prompt);
        if (!result.success || result.images.length === 0) {
          return textResult({ success: false, error: result.error ?? 'No images generated' });
        }

        if (params.nodeId) {
          await operationQueue.execute(async () => {
            await connector.setImageFill([params.nodeId], result.images[0]!, 'FILL');
          });
        }

        return textResult({
          success: true,
          appliedToNode: params.nodeId || null,
          hint: params.nodeId
            ? 'Diagram applied. Use figma_screenshot to verify.'
            : 'Use figma_set_image_fill to place the diagram on a Figma node.',
        });
      },
    },
  ];
}
