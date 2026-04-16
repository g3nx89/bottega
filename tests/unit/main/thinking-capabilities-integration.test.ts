/**
 * Integration test — Pi SDK thinking-capability surface.
 *
 * Guards the assumptions the Bottega UI relies on when rendering the
 * per-model effort dropdown:
 *
 *   - `supportsThinking()` + `supportsXhighThinking()` classify models
 *     correctly across Anthropic / OpenAI / Google families.
 *   - `getAvailableThinkingLevels()` returns the exact set we filter against
 *     (["off", ...]) and adds "xhigh" only for models that support it.
 *   - `setThinkingLevel()` silently clamps unsupported requests, and the
 *     `thinkingLevel` getter reflects the clamp so `agent:set-thinking` can
 *     echo the effective level back to the renderer.
 *
 * These guards break loudly if Pi SDK renames a method, reshapes the level
 * list, or changes clamp behaviour — all of which the UI would otherwise
 * silently misrender.
 */

import os from 'node:os';
import { getModel } from '@mariozechner/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

type Provider = 'anthropic' | 'openai-codex' | 'google-gemini-cli';
type AnySession = Awaited<ReturnType<typeof createAgentSession>>['session'];

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length) {
    try {
      disposers.pop()?.();
    } catch {
      // best-effort cleanup — tests should not fail on dispose quirks.
    }
  }
});

async function createSession(provider: Provider, modelId: string): Promise<AnySession> {
  // Pi SDK validates API keys at construction. Populate harmless dummies for
  // every provider this test exercises — the playbook never issues real calls.
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
  if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'test-key-not-used';
  if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = 'test-key-not-used';

  const model = getModel(provider as any, modelId as any);
  const resourceLoader = new DefaultResourceLoader({
    cwd: os.tmpdir(),
    systemPrompt: 'capability probe',
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: os.tmpdir(),
    model,
    tools: [],
    customTools: [],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });

  // Bypass auth checks so setThinkingLevel doesn't probe credentials.
  const registry = (session as any)._modelRegistry;
  if (registry) registry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: 'test-key', headers: {} });

  disposers.push(() => session.dispose());
  return session;
}

describe('Pi SDK thinking capabilities — Bottega contract', () => {
  it('Claude Sonnet 4.6 exposes the standard 5-level set, no xhigh', async () => {
    const session = await createSession('anthropic', 'claude-sonnet-4-6');
    const s = session as any;
    expect(s.supportsThinking()).toBe(true);
    expect(s.supportsXhighThinking()).toBe(false);
    expect(s.getAvailableThinkingLevels()).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
  });

  it('Claude Opus 4.6 adds xhigh to the level set', async () => {
    const session = await createSession('anthropic', 'claude-opus-4-6');
    const s = session as any;
    expect(s.supportsXhighThinking()).toBe(true);
    expect(s.getAvailableThinkingLevels()).toContain('xhigh');
  });

  it('GPT-5.4 (OpenAI) adds xhigh to the level set', async () => {
    const session = await createSession('openai-codex', 'gpt-5.4');
    const s = session as any;
    expect(s.supportsThinking()).toBe(true);
    expect(s.supportsXhighThinking()).toBe(true);
    expect(s.getAvailableThinkingLevels()).toContain('xhigh');
  });

  it('setThinkingLevel silently clamps xhigh → high on a non-xhigh model', async () => {
    const session = await createSession('anthropic', 'claude-sonnet-4-6');
    const s = session as any;
    s.setThinkingLevel('xhigh');
    // Contract: thinkingLevel getter reflects the *post-clamp* value.
    expect(s.thinkingLevel).toBe('high');
  });

  it('setThinkingLevel honours a requested level that is supported', async () => {
    const session = await createSession('anthropic', 'claude-sonnet-4-6');
    const s = session as any;
    s.setThinkingLevel('low');
    expect(s.thinkingLevel).toBe('low');
    s.setThinkingLevel('high');
    expect(s.thinkingLevel).toBe('high');
  });

  it('availableLevels always starts with "off" so the UI can guarantee a disable option', async () => {
    const session = await createSession('anthropic', 'claude-sonnet-4-6');
    const s = session as any;
    expect(s.getAvailableThinkingLevels()[0]).toBe('off');
  });
});
