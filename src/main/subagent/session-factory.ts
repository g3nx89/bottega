/**
 * Session factory — creates ephemeral Pi SDK sessions for subagents.
 *
 * Key differences from parent session (agent.ts buildAgentSession):
 * - No compression extension (subagents are short-lived)
 * - Lighter system prompts (role-specific)
 * - Read-only tool set
 */

import os from 'node:os';
import { getModel } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import {
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { type AgentInfra, resolveSdkModelId } from '../agent.js';
import type { SubagentModelConfig } from './config.js';

/**
 * Create an ephemeral Pi SDK session for a subagent.
 * No compression extension, no session persistence, role-specific system prompt.
 */
export async function createSubagentSession(
  infra: AgentInfra,
  tools: ToolDefinition[],
  modelConfig: SubagentModelConfig,
  systemPrompt: string,
  thinkingLevel: 'low' | 'medium' | 'high' = 'medium',
): Promise<CreateAgentSessionResult> {
  const model = getModel(modelConfig.provider as any, resolveSdkModelId(modelConfig.modelId) as any);

  const resourceLoader = new DefaultResourceLoader({
    cwd: os.tmpdir(),
    systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    // No extensionFactories — subagents don't need compression
  });
  await resourceLoader.reload();

  return createAgentSession({
    cwd: os.tmpdir(),
    model,
    thinkingLevel,
    tools: [],
    customTools: tools,
    resourceLoader,
    sessionManager: infra.sessionManager,
    authStorage: infra.authStorage,
    modelRegistry: infra.modelRegistry,
  });
}
