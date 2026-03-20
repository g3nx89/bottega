import { createAgentSession, type CreateAgentSessionResult, SessionManager } from '@mariozechner/pi-coding-agent';
import { DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { createFigmaTools } from './tools/index.js';
import { FIGMA_SYSTEM_PROMPT } from './system-prompt.js';
import type { FigmaCore } from './figma-core.js';
import { OperationQueue } from './operation-queue.js';

export async function createFigmaAgent(figmaCore: FigmaCore): Promise<CreateAgentSessionResult> {
  const operationQueue = new OperationQueue();

  const figmaTools = createFigmaTools({
    connector: figmaCore.connector,
    figmaAPI: figmaCore.figmaAPI,
    operationQueue,
    wsServer: figmaCore.wsServer,
  });

  // Use DefaultResourceLoader with our custom system prompt
  // Disable extensions/skills/prompts since we provide our own
  const resourceLoader = new DefaultResourceLoader({
    systemPrompt: FIGMA_SYSTEM_PROMPT,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const result = await createAgentSession({
    model: getModel('anthropic', 'claude-sonnet-4-5'),
    thinkingLevel: 'medium',
    tools: [],              // No built-in coding tools (no bash, read, edit, write)
    customTools: figmaTools, // Only our Figma tools
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  return result;
}
