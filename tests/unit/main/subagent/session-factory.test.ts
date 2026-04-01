/**
 * 10e. Session Factory unit tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReload = vi.fn().mockResolvedValue(undefined);
const constructorCalls: any[] = [];

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn().mockReturnValue({ id: 'test-model' }),
}));

vi.mock('@mariozechner/pi-coding-agent', () => {
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: { subscribe: vi.fn(), newSession: vi.fn(), prompt: vi.fn() },
    }),
    DefaultResourceLoader: class MockResourceLoader {
      reload = mockReload;
      constructor(args: any) {
        constructorCalls.push(args);
      }
    },
  };
});

import { getModel } from '@mariozechner/pi-ai';
import { createAgentSession } from '@mariozechner/pi-coding-agent';
import { createSubagentSession } from '../../../../src/main/subagent/session-factory.js';

const mockInfra = {
  authStorage: { get: vi.fn() },
  modelRegistry: {},
  sessionManager: {},
} as any;

describe('Session Factory', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    vi.clearAllMocks();
  });

  it('creates session with correct model from config', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(getModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
  });

  it('passes system prompt through to DefaultResourceLoader', async () => {
    const systemPrompt = 'You are a read-only specialist...';
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, systemPrompt);
    expect(constructorCalls[0]).toMatchObject({ systemPrompt });
  });

  it('disables extensions, skills, prompt templates, and themes', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(constructorCalls[0]).toMatchObject({
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
  });

  it('does not include extensionFactories (no compression for subagents)', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(constructorCalls[0].extensionFactories).toBeUndefined();
  });

  it('creates session with medium thinking level', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: 'medium' }));
  });

  it('passes tools as customTools with empty built-in tools', async () => {
    const tools = [{ name: 'figma_screenshot' }] as any;
    await createSubagentSession(mockInfra, tools, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ tools: [], customTools: tools }));
  });

  it('passes infra auth/session/model references', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionManager: mockInfra.sessionManager,
        authStorage: mockInfra.authStorage,
        modelRegistry: mockInfra.modelRegistry,
      }),
    );
  });

  it('reloads resource loader before creating session', async () => {
    await createSubagentSession(mockInfra, [], { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }, 'test');
    expect(mockReload).toHaveBeenCalled();
  });
});
