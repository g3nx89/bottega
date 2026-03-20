import { createAgentSession, type CreateAgentSessionResult, SessionManager, AuthStorage, DefaultResourceLoader, ModelRegistry } from '@mariozechner/pi-coding-agent';
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

  // Auth: resolves API key from auth.json → env vars → fallback
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

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
    cwd: process.cwd(),
    model: getModel('anthropic', 'claude-sonnet-4-5'),
    thinkingLevel: 'medium',
    tools: [],              // No built-in coding tools (no bash, read, edit, write)
    customTools: figmaTools, // Only our Figma tools
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  return result;
}
